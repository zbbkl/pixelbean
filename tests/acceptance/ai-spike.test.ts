/**
 * docs/45 §9 **S1 廉价否决点**：用 u2netp 对权威样例跑一次，只回答一个问题——
 * **掩码是否完整覆盖主体？** 不接入产品代码、不做 UI、不改默认行为。
 *
 * 依赖（均不入 package.json）：
 *   npm i --no-save onnxruntime-node          # MIT，本机 CPU 推理
 *   权重: .tools/ai-spike/u2netp.onnx          # 见 docs/45 §1 的许可链，sha256 记录在输出里
 *
 * 运行：
 *   npx vitest run tests/acceptance/ai-spike.test.ts
 * 产物（供目检）：
 *   .tools/ai-spike/mask-u2netp.png     二值掩码（黑=主体，白=背景）
 *   .tools/ai-spike/subject-u2netp.png  抠出主体合成到中灰底
 *
 * 缺席时自动跳过（未装 onnxruntime-node 或未下权重 → skip，不污染 CI）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskToImage, readPng, writePng, type RasterImage } from '../support/png';
import { refineMaskGuided } from '../../src/core/pipeline/subject';
import type { CellImage } from '../../src/types';

const SAMPLE_CANDIDATES = [
  '.tools/diag-v12final/rabbit-source.png', // 权威样例全分辨率（本地，gitignored）
  'tests/fixtures/rabbit-soft.png' // 1/4 降采样夹具（入库，CI 可用）
];
const MODEL = process.env.AI_MODEL ?? '.tools/ai-spike/u2netp.onnx';
const OUT = '.tools/ai-spike';
/**
 * 模型输入边长。**每个模型的 ONNX 导出是固定输入尺寸**，喂错尺寸 ONNX Runtime 会直接拒绝：
 * u2net / u2netp = 320；isnet-general-use = 1024。用 AI_INPUT_SIZE 覆盖。
 */
const DEFAULT_SIZE = Number(process.env.AI_INPUT_SIZE ?? 320);
/**
 * 输入边长可扫：缺块很可能来自「1104×1424 被压到 320×320」的过度降采样。
 * 用法：AI_SIZES=320,640,960 npx vitest run tests/acceptance/ai-spike.test.ts
 */
const SIZES = (process.env.AI_SIZES ?? String(DEFAULT_SIZE))
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => value > 0);
/**
 * 归一化参数**每个模型不同**（u2net 系 = ImageNet；isnet-general-use = mean 0.5 / std 1.0）。
 * 用 AI_MEAN / AI_STD 覆盖，逗号分隔。
 */
const MEAN = (process.env.AI_MEAN ?? '0.485,0.456,0.406').split(',').map(Number);
const STD = (process.env.AI_STD ?? '0.229,0.224,0.225').split(',').map(Number);

function hasModule(name: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

const ready = hasModule('onnxruntime-node') && existsSync(resolve(process.cwd(), MODEL));

/** 双线性缩放（输入降采样 + 掩码上采样都用它；无第三方依赖）。 */
function resizeBilinear(image: RasterImage, width: number, height: number): RasterImage {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * image.height) / height - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * image.width) / width - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, sx - x0));
      for (let c = 0; c < 3; c += 1) {
        const p00 = image.data[(y0 * image.width + x0) * 4 + c];
        const p01 = image.data[(y0 * image.width + x1) * 4 + c];
        const p10 = image.data[(y1 * image.width + x0) * 4 + c];
        const p11 = image.data[(y1 * image.width + x1) * 4 + c];
        const top = p00 * (1 - wx) + p01 * wx;
        const bottom = p10 * (1 - wx) + p11 * wx;
        out[(y * width + x) * 4 + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
      out[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function geometry(mask: Uint8Array, width: number, height: number) {
  let pixels = 0;
  let perimeter = 0;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let touchesBorder = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (!mask[at]) continue;
      pixels += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      if (x === 0 || !mask[at - 1]) perimeter += 1;
      if (x === width - 1 || !mask[at + 1]) perimeter += 1;
      if (y === 0 || !mask[at - width]) perimeter += 1;
      if (y === height - 1 || !mask[at + width]) perimeter += 1;
    }
  }
  return {
    pixels,
    ratio: pixels / (width * height),
    bbox: pixels ? `${x0},${y0},${x1},${y1}` : 'null',
    touchesBorder,
    compactness: perimeter ? (4 * Math.PI * pixels) / (perimeter * perimeter) : 0
  };
}

function overGray(cells: Uint8ClampedArray, width: number, height: number): RasterImage {
  const out = new Uint8ClampedArray(cells.length);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    const alpha = cells[offset + 3] / 255;
    for (let c = 0; c < 3; c += 1) {
      out[offset + c] = Math.round(cells[offset + c] * alpha + 128 * (1 - alpha));
    }
    out[offset + 3] = 255;
  }
  return { width, height, data: out };
}

interface Inference {
  elapsed: number;
  min: number;
  max: number;
  /** 输入边的原始 320 掩码（未上采样）。 */
  small: Uint8Array;
  size: number;
}

/**
 * 一次推理：把给定图像缩到 320×320（u2netp 的 ONNX 导出是**固定 320 输入**，
 * 直接喂 640 会被 ONNX Runtime 拒绝）、ImageNet 归一化、取输出 0、min-max 归一化后阈值 0.5。
 */
async function infer(
  ort: OrtLike,
  session: OrtSessionLike,
  image: RasterImage,
  size: number,
  mean: number[] = MEAN,
  std: number[] = STD
): Promise<Inference> {
  const small = resizeBilinear(image, size, size);
  const input = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = small.data[i * 4 + c] / 255;
      input[c * size * size + i] = (value - mean[c]) / std[c];
    }
  }
  const started = Date.now();
  const outputs = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size])
  });
  const elapsed = Date.now() - started;
  const raw = outputs[session.outputNames[0]].data as Float32Array;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    mask[i] = (raw[i] - min) / Math.max(max - min, 1e-6) > 0.5 ? 1 : 0;
  }
  return { elapsed, min, max, small: mask, size };
}

/** 把小掩码上采样回目标尺寸并二值化。 */
function upsampleMask(inference: Inference, width: number, height: number): Uint8Array {
  const data = new Uint8ClampedArray(inference.size * inference.size * 4);
  for (let i = 0; i < inference.size * inference.size; i += 1) {
    const value = inference.small[i] ? 0 : 255;
    data.set([value, value, value, 255], i * 4);
  }
  const up = resizeBilinear(
    { width: inference.size, height: inference.size, data },
    width,
    height
  );
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = up.data[i * 4] < 128 ? 1 : 0;
  return out;
}

/** 裁剪一块区域（带边距），并记录映射回原图的参数。 */
function cropImage(
  image: RasterImage,
  box: { x0: number; y0: number; x1: number; y1: number }
): { crop: RasterImage; originX: number; originY: number } {
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((box.y0 + y) * image.width + (box.x0 + x)) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = 255;
    }
  }
  return { crop: { width, height, data }, originX: box.x0, originY: box.y0 };
}

/** 等比缩放到 size（长边=size），用**背景色**补成正方形，记录填充偏移。 */
function fitSquare(image: RasterImage, size: number): { square: RasterImage; offsetX: number; offsetY: number; scale: number } {
  const scale = size / Math.max(image.width, image.height);
  const innerWidth = Math.max(1, Math.round(image.width * scale));
  const innerHeight = Math.max(1, Math.round(image.height * scale));
  const resized = resizeBilinear(image, innerWidth, innerHeight);
  const offsetX = Math.floor((size - innerWidth) / 2);
  const offsetY = Math.floor((size - innerHeight) / 2);
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < innerHeight; y += 1) {
    for (let x = 0; x < innerWidth; x += 1) {
      const from = (y * innerWidth + x) * 4;
      const to = ((y + offsetY) * size + (x + offsetX)) * 4;
      data[to] = resized.data[from];
      data[to + 1] = resized.data[from + 1];
      data[to + 2] = resized.data[from + 2];
      data[to + 3] = 255;
    }
  }
  return { square: { width: size, height: size, data }, offsetX, offsetY, scale };
}

/** 把小掩码按裁剪时的映射放回主图。 */
function placeBack(
  pass: Inference,
  box: { x0: number; y0: number; x1: number; y1: number },
  fit: { offsetX: number; offsetY: number; scale: number },
  target: Uint8Array,
  width: number
): void {
  const cropWidth = box.x1 - box.x0 + 1;
  const cropHeight = box.y1 - box.y0 + 1;
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const sx = Math.round((x + 0.5) * fit.scale - 0.5) + fit.offsetX;
      const sy = Math.round((y + 0.5) * fit.scale - 0.5) + fit.offsetY;
      if (sx < 0 || sy < 0 || sx >= pass.size || sy >= pass.size) continue;
      if (pass.small[sy * pass.size + sx]) target[(box.y0 + y) * width + box.x0 + x] = 1;
    }
  }
}

/** 把 a 有、b 没有的像素染绿（= 新方案多覆盖的地方，用来定位缺块）。 */
function tintDifference(a: Uint8Array, b: Uint8Array, source: RasterImage): RasterImage {
  const out = new Uint8ClampedArray(source.data.length);
  out.set(source.data);
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i] || b[i]) continue;
    const offset = i * 4;
    out[offset] = Math.round(out[offset] * 0.2);
    out[offset + 1] = 255;
    out[offset + 2] = Math.round(out[offset + 2] * 0.2);
  }
  return { width: source.width, height: source.height, data: out };
}


/** 求「被掩码包围的 0 区域」= 轮廓内部的洞（不触画面边界者），按面积降序列出前几个。 */
function enclosedHoles(
  mask: Uint8Array,
  width: number,
  height: number
): { pixels: number; box: string }[] {
  const seen = new Uint8Array(mask.length);
  const holes: { pixels: number; box: string }[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    let touches = false;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    while (stack.length) {
      const at = stack.pop()!;
      size += 1;
      const x = at % width;
      const y = Math.floor(at / width);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;
      const neighbours = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        y > 0 ? at - width : -1,
        y < height - 1 ? at + width : -1
      ];
      for (const next of neighbours) {
        if (next >= 0 && !mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (!touches && size > 16) holes.push({ pixels: size, box: `${x0},${y0},${x1},${y1}` });
  }
  return holes.sort((a, b) => b.pixels - a.pixels);
}

/** 把洞染红叠在原图上（供确认「这就是我看到的缺块」）。 */
function tintHoles(mask: Uint8Array, source: RasterImage): RasterImage {
  const out = new Uint8ClampedArray(source.data.length);
  out.set(source.data);
  const seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const component: number[] = [];
    let touches = false;
    while (stack.length) {
      const at = stack.pop()!;
      component.push(at);
      const x = at % source.width;
      const y = Math.floor(at / source.width);
      if (x === 0 || y === 0 || x === source.width - 1 || y === source.height - 1) touches = true;
      const neighbours = [
        x > 0 ? at - 1 : -1,
        x < source.width - 1 ? at + 1 : -1,
        y > 0 ? at - source.width : -1,
        y < source.height - 1 ? at + source.width : -1
      ];
      for (const next of neighbours) {
        if (next >= 0 && !mask[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (touches || component.length <= 16) continue;
    for (const at of component) {
      const offset = at * 4;
      out[offset] = 255;
      out[offset + 1] = Math.round(out[offset + 1] * 0.2);
      out[offset + 2] = Math.round(out[offset + 2] * 0.2);
    }
  }
  return { width: source.width, height: source.height, data: out };
}


/**
 * onnxruntime-node **不是项目依赖**（用 `npm i --no-save` 临时装）。因此这里只用**结构化本地类型**，
 * 不写 `typeof import('onnxruntime-node')`——那会让**干净检出**的仓库 `tsc --noEmit` 直接失败。
 * 运行时用变量化 specifier 动态 import；未安装时由 `ready` 守卫整体 skip。
 */
interface OrtTensorLike {
  data: Float32Array;
}
interface OrtSessionLike {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
}
interface OrtLike {
  InferenceSession: { create(path: string): Promise<OrtSessionLike> };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

async function loadOrtNode(): Promise<OrtLike> {
  const moduleName = 'onnxruntime-node';
  return (await import(/* @vite-ignore */ moduleName)) as unknown as OrtLike;
}

describe.skipIf(!ready)('AI 抠图 S1 spike（u2netp）', () => {
  /**
   * 诊断：u2net 系 ONNX 有多个输出（d0…d6），而管线只取 `outputNames[0]`。
   * 若顺序不保证，掩码就会取错头 —— 直接污染模型对比结论。先把各模型输入/输出列清楚。
   */
  it('诊断：各模型的输入/输出名与数量', async () => {
    const ort = await loadOrtNode();
    const names = [
      'u2netp.onnx',
      'u2net.onnx',
      'u2net-int8.onnx',
      'isnet-general-use.onnx',
      'isnet-general-use-int8.onnx'
    ];
    for (const name of names) {
      const path = resolve(process.cwd(), '.tools/ai-spike', name);
      if (!existsSync(path)) {
        console.log(`MODELS ${name}: 缺失，跳过`);
        continue;
      }
      const session = await ort.InferenceSession.create(path);
      console.log(
        `MODELS ${name}: inputs=[${session.inputNames.join(', ')}] outputs(${session.outputNames.length})=[${session.outputNames.join(', ')}]`
      );
    }
    expect(true).toBe(true);
  }, 300000);

  it('权威样例上跑一次，回答「掩码是否完整覆盖主体」', async () => {
    const ort = await loadOrtNode();
    const samplePath = SAMPLE_CANDIDATES.find((candidate) => existsSync(resolve(process.cwd(), candidate))) ?? SAMPLE_CANDIDATES[1];
    const modelPath = resolve(process.cwd(), MODEL);
    const hash = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
    const bytes = readFileSync(modelPath).length;
    console.log(`MODEL ${MODEL} ${(bytes / 1024 / 1024).toFixed(2)}MB sha256=${hash}`);

    const source = readPng(resolve(process.cwd(), samplePath));
    console.log(`SAMPLE ${samplePath} ${source.width}x${source.height}`);

    const session = await ort.InferenceSession.create(modelPath);
    mkdirSync(resolve(process.cwd(), OUT), { recursive: true });
    // 模型短名（u2netp / u2net / isnet-general-use），用于区分落盘产物
    const tag = MODEL.split(/[\\/]/).pop()!.replace(/\.onnx$/, '');

    const report = (
      label: string,
      mask: Uint8Array,
      elapsed: number,
      bounds = { min: 0, max: 1 }
    ) => {
      const stats = geometry(mask, source.width, source.height);
      let bottomRow = 0;
      for (let x = 0; x < source.width; x += 1) {
        if (mask[(source.height - 1) * source.width + x]) bottomRow += 1;
      }
      const parts = stats.bbox.split(',').map(Number);
      const bboxArea = (parts[2] - parts[0] + 1) * (parts[3] - parts[1] + 1);
      console.log(
        `RESULT ${label} 推理=${elapsed}ms 输出范围=[${bounds.min.toFixed(3)}, ${bounds.max.toFixed(3)}] 掩码=${stats.pixels}px (${(stats.ratio * 100).toFixed(1)}%) bbox=${stats.bbox} 触边=${stats.touchesBorder} 紧致度=${stats.compactness.toFixed(3)} bbox填充=${(stats.pixels / bboxArea).toFixed(3)} 底边行=${bottomRow}`
      );
      const probe = (x: number, y: number) => {
        const value = mask[y * source.width + x];
        const offset = (y * source.width + x) * 4;
        return `(${x},${y}) rgb=${source.data[offset]},${source.data[offset + 1]},${source.data[offset + 2]} → ${value}`;
      };
      console.log(`  PROBE 左上角(背景应=0)   ${probe(2, 2)}`);
      console.log(`  PROBE 画面中心(主体应=1) ${probe(Math.floor(source.width / 2), Math.floor(source.height / 2))}`);
      console.log(`  PROBE 底部地面(阴影)     ${probe(2, source.height - 3)}`);

      // 缺块定位：被掩码包围的 0 区域
      const holes = enclosedHoles(mask, source.width, source.height);
      const holePixels = holes.reduce((sum, hole) => sum + hole.pixels, 0);
      console.log(
        `  HOLES 内部洞=${holes.length} 个 合计=${holePixels}px（占掩码 ${((holePixels / Math.max(stats.pixels, 1)) * 100).toFixed(2)}%）` +
          (holes.length ? ` 前几个: ${holes.slice(0, 5).map((h) => `${h.pixels}px@${h.box}`).join(' | ')}` : '')
      );

      writePng(resolve(process.cwd(), OUT, `mask-${tag}-${label}.png`), maskToImage(mask, source.width, source.height));
      writePng(resolve(process.cwd(), OUT, `holes-${tag}-${label}.png`), tintHoles(mask, source));
      const subject = new Uint8ClampedArray(source.data);
      for (let i = 0; i < mask.length; i += 1) if (!mask[i]) subject[i * 4 + 3] = 0;
      writePng(resolve(process.cwd(), OUT, `subject-${tag}-${label}.png`), overGray(subject, source.width, source.height));
      console.log(`  EVIDENCE ${OUT}/mask-${tag}-${label}.png 与 holes-${tag}-${label}.png（缺块染红）`);
      return stats;
    };

    // ---- 第 1 趟：全图 → 320（u2netp 的 ONNX 导出固定 320 输入，640 会被 ORT 拒绝）----
    const pass1 = await infer(ort, session, source, DEFAULT_SIZE);
    const mask1 = upsampleMask(pass1, source.width, source.height);
    const stats1 = report('pass1-full320', mask1, pass1.elapsed, pass1);
    // 落盘「模型原始输出掩码」（未上采样，DEFAULT_SIZE²）：将作为 CI 夹具，
    // 让 S2 的后处理链即使在没装 onnxruntime / 没下 44MB 模型的环境里也能被测到。
    writePng(
      resolve(process.cwd(), OUT, `raw-mask-${tag}-${DEFAULT_SIZE}.png`),
      maskToImage(pass1.small, DEFAULT_SIZE, DEFAULT_SIZE)
    );

    // ---- 第 2 趟：按第 1 趟的 bbox 裁出主体（+12% 边距）等比缩到 320 再推理，细节分辨率翻倍 ----
    const bbox1 = stats1.bbox.split(',').map(Number);
    const marginX = Math.round((bbox1[2] - bbox1[0]) * 0.12);
    const marginY = Math.round((bbox1[3] - bbox1[1]) * 0.12);
    const box = {
      x0: Math.max(0, bbox1[0] - marginX),
      y0: Math.max(0, bbox1[1] - marginY),
      x1: Math.min(source.width - 1, bbox1[2] + marginX),
      y1: Math.min(source.height - 1, bbox1[3] + marginY)
    };
    const { crop, originX, originY } = cropImage(source, box);
    const { square, offsetX, offsetY, scale } = fitSquare(crop, DEFAULT_SIZE);
    console.log(
      `CROP 区域=${box.x0},${box.y0}..${box.x1},${box.y1} (${crop.width}x${crop.height}) → 等比 ${scale.toFixed(3)} 补白到 ${DEFAULT_SIZE}×${DEFAULT_SIZE}（偏移 ${offsetX},${offsetY}）⇒ 主体在输入里的占比提升约 ${(DEFAULT_SIZE / Math.max(crop.width, crop.height) / (DEFAULT_SIZE / Math.max(source.width, source.height))).toFixed(1)}×`
    );
    const pass2 = await infer(ort, session, square, DEFAULT_SIZE);

    // 把第 2 趟的小掩码映射回主图坐标
    const mask2 = new Uint8Array(source.width * source.height);
    for (let y = 0; y < crop.height; y += 1) {
      for (let x = 0; x < crop.width; x += 1) {
        const sx = Math.round((x + 0.5) * scale - 0.5) + offsetX;
        const sy = Math.round((y + 0.5) * scale - 0.5) + offsetY;
        if (sx < 0 || sy < 0 || sx >= DEFAULT_SIZE || sy >= DEFAULT_SIZE) continue;
        if (pass2.small[sy * DEFAULT_SIZE + sx]) mask2[(originY + y) * source.width + (originX + x)] = 1;
      }
    }
    const stats2 = report('pass2-crop320', mask2, pass2.elapsed, pass2);

    // 两趟并集：第 2 趟负责细节，第 1 趟负责兜住外层轮廓
    const union = new Uint8Array(mask1.length);
    for (let i = 0; i < union.length; i += 1) union[i] = mask1[i] || mask2[i] ? 1 : 0;
    report('union', union, pass1.elapsed + pass2.elapsed, pass1);

    console.log(
      `DELTA 第1趟=${stats1.pixels}px → 第2趟(裁裁重推)=${stats2.pixels}px → 并集=${geometry(union, source.width, source.height).pixels}px`
    );

    // ---- 第 3 趟：2×2 分块推理（每块单独缩到 320 -> 主体分辨率提升 ~1.9×），再与第 1 趟并集 ----
    const tiled = new Uint8Array(mask1.length);
    let tileMs = 0;
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        const tileWidth = Math.ceil(source.width / 2);
        const tileHeight = Math.ceil(source.height / 2);
        const overX = Math.round(tileWidth * 0.2);
        const overY = Math.round(tileHeight * 0.2);
        const box = {
          x0: Math.max(0, col * tileWidth - overX),
          y0: Math.max(0, row * tileHeight - overY),
          x1: Math.min(source.width - 1, (col + 1) * tileWidth + overX),
          y1: Math.min(source.height - 1, (row + 1) * tileHeight + overY)
        };
        const { crop } = cropImage(source, box);
        const fit = fitSquare(crop, DEFAULT_SIZE);
        const pass = await infer(ort, session, fit.square, DEFAULT_SIZE);
        tileMs += pass.elapsed;
        placeBack(pass, box, fit, tiled, source.width);
      }
    }
    const statsTiled = report('pass3-tiles2x2', tiled, tileMs, pass1);
    const tiledUnion = new Uint8Array(mask1.length);
    for (let i = 0; i < tiledUnion.length; i += 1) {
      tiledUnion[i] = mask1[i] || tiled[i] ? 1 : 0;
    }
    report('pass3-union-with-full', tiledUnion, pass1.elapsed + tileMs, pass1);
    writePng(
      resolve(process.cwd(), OUT, 'diff-tiles-minus-full.png'),
      tintDifference(tiled, mask1, source)
    );
    console.log(
      `TILING 分块=${statsTiled.pixels}px 分块∪全图=${geometry(tiledUnion, source.width, source.height).pixels}px（相对全图 ${stats1.pixels}px，第 3 趟净增 ${geometry(tiledUnion, source.width, source.height).pixels - stats1.pixels}px）；差异图 EVIDENCE diff-tiles-minus-full.png（绿=分块多覆盖的地方）`
    );

    expect(stats1.pixels).toBeGreaterThan(0);
  }, 900000);

  /**
   * 选型决策实验：**ISNet 比 u2netp 多覆盖的区域在哪？** 以及**现成的引导滤波能不能把 u2netp 补上**？
   * 目的：判断值不值得为「ISNet 的 170MB + 1024 输入」买单，还是「4.36MB + 后处理」就够。
   */
  it('u2netp vs isnet：差异区域定位 + 引导滤波补全能力', async () => {
    const ort = await loadOrtNode();
    const samplePath =
      SAMPLE_CANDIDATES.find((candidate) => existsSync(resolve(process.cwd(), candidate))) ??
      SAMPLE_CANDIDATES[1];
    const source = readPng(resolve(process.cwd(), samplePath));
    const modelA = process.env.AI_MODEL_A ?? '.tools/ai-spike/u2netp.onnx';
    const modelB = process.env.AI_MODEL_B ?? '.tools/ai-spike/isnet-general-use.onnx';
    const sizeA = Number(process.env.AI_SIZE_A ?? 320);
    const sizeB = Number(process.env.AI_SIZE_B ?? 1024);
    const meanA = (process.env.AI_MEAN_A ?? '0.485,0.456,0.406').split(',').map(Number);
    const stdA = (process.env.AI_STD_A ?? '0.229,0.224,0.225').split(',').map(Number);
    // 默认与 A 一致（ImageNet）；测 ISNet 时必须显式传 AI_MEAN_B=0.5,0.5,0.5 
    const meanB = (process.env.AI_MEAN_B ?? process.env.AI_MEAN ?? '0.485,0.456,0.406').split(',').map(Number);
    const stdB = (process.env.AI_STD_B ?? process.env.AI_STD ?? '0.229,0.224,0.225').split(',').map(Number);
    const tagA = modelA.split(/[\\/]/).pop()!.replace(/\.onnx$/, '');
    const tagB = modelB.split(/[\\/]/).pop()!.replace(/\.onnx$/, '');
    const smallModel = resolve(process.cwd(), modelA);
    const bigModel = resolve(process.cwd(), modelB);
    if (!existsSync(smallModel) || !existsSync(bigModel)) {
      console.log(`SKIP 需要两个模型都在 .tools/ai-spike/ 下（缺 ${existsSync(smallModel) ? tagB : tagA}）`);
      return;
    }

    const smallSession = await ort.InferenceSession.create(smallModel);
    const bigSession = await ort.InferenceSession.create(bigModel);
    const smallPass = await infer(ort, smallSession, source, sizeA, meanA, stdA);
    const maskSmall = upsampleMask(smallPass, source.width, source.height);
    const bigPass = await infer(ort, bigSession, source, sizeB, meanB, stdB);
    const maskBig = upsampleMask(bigPass, source.width, source.height);

    const statsSmall = geometry(maskSmall, source.width, source.height);
    const statsBig = geometry(maskBig, source.width, source.height);
    console.log(
      `CMP ${tagA}@${sizeA}(${smallPass.elapsed}ms)=${statsSmall.pixels}px (${(statsSmall.ratio * 100).toFixed(1)}%) vs ${tagB}@${sizeB}(${bigPass.elapsed}ms)=${statsBig.pixels}px (${(statsBig.ratio * 100).toFixed(1)}%) Δ=${statsBig.pixels - statsSmall.pixels}px`
    );

    // ISNet 有、u2netp 没有的地方 = 小模型漏掉的区域
    const missed = new Uint8Array(maskSmall.length);
    for (let i = 0; i < missed.length; i += 1) {
      missed[i] = maskBig[i] && !maskSmall[i] ? 1 : 0;
    }
    const missedPixels = missed.reduce((sum, value) => sum + value, 0);
    const missedHoles = enclosedHoles(missed, source.width, source.height);
    console.log(
      `CMP 小模型漏掉（ISNet 多覆盖）=${missedPixels}px（占 ISNet 掩码 ${((missedPixels / statsBig.pixels) * 100).toFixed(1)}%）; 其中「内部洞」${missedHoles.length} 个 ${missedHoles.reduce((s, h) => s + h.pixels, 0)}px`
    );
    if (missedHoles.length) {
      console.log(
        `CMP 最大几处: ${missedHoles.slice(0, 6).map((h) => `${h.pixels}px@${h.box}`).join(' | ')}`
      );
    }

    // 引导滤波能否补上：把 u2netp 掩码用原图做引导精修
    const refinedOnly = refineMaskGuided(source.data, maskSmall, source.width, source.height);
    const unionRefined = new Uint8Array(maskSmall.length);
    for (let i = 0; i < unionRefined.length; i += 1) {
      unionRefined[i] = maskSmall[i] || refinedOnly[i] ? 1 : 0;
    }
    const recoveredRefined = (() => {
      let hit = 0;
      for (let i = 0; i < missed.length; i += 1) if (missed[i] && refinedOnly[i]) hit += 1;
      return hit;
    })();
    const recoveredUnion = (() => {
      let hit = 0;
      for (let i = 0; i < missed.length; i += 1) if (missed[i] && unionRefined[i]) hit += 1;
      return hit;
    })();
    const statsRefined = geometry(refinedOnly, source.width, source.height);
    const statsUnion = geometry(unionRefined, source.width, source.height);
    console.log(
      `REFINE 引导滤波单独=${statsRefined.pixels}px（补回漏区 ${recoveredRefined}/${missedPixels}px = ${((recoveredRefined / Math.max(missedPixels, 1)) * 100).toFixed(1)}%）; 并集=${statsUnion.pixels}px（补回 ${recoveredUnion}px = ${((recoveredUnion / Math.max(missedPixels, 1)) * 100).toFixed(1)}%）`
    );

    mkdirSync(resolve(process.cwd(), OUT), { recursive: true });
    writePng(resolve(process.cwd(), OUT, 'cmp-isnet-minus-u2netp.png'), tintDifference(maskBig, maskSmall, source));
    writePng(resolve(process.cwd(), OUT, 'cmp-u2netp-refined.png'), maskToImage(unionRefined, source.width, source.height));
    writePng(resolve(process.cwd(), OUT, 'cmp-u2netp-refined-tint.png'), tintDifference(unionRefined, maskBig, source));
    console.log(
      `EVIDENCE ${OUT}/cmp-isnet-minus-u2netp.png（绿=ISNet 多覆盖）与 cmp-u2netp-refined*.png`
    );

    // 差异到底是「整体边界胖 ~2px」还是「真漏了结构」？用膨胀逼近 ISNet 并算 IoU
    const dilate = (mask: Uint8Array, radius: number): Uint8Array => {
      let current = mask;
      for (let step = 0; step < radius; step += 1) {
        const next = new Uint8Array(current.length);
        for (let y = 0; y < source.height; y += 1) {
          for (let x = 0; x < source.width; x += 1) {
            const at = y * source.width + x;
            if (current[at]) {
              next[at] = 1;
              continue;
            }
            const near =
              (x > 0 && current[at - 1]) ||
              (x < source.width - 1 && current[at + 1]) ||
              (y > 0 && current[at - source.width]) ||
              (y < source.height - 1 && current[at + source.width]) ||
              (x > 0 && y > 0 && current[at - source.width - 1]) ||
              (x < source.width - 1 && y > 0 && current[at - source.width + 1]) ||
              (x > 0 && y < source.height - 1 && current[at + source.width - 1]) ||
              (x < source.width - 1 && y < source.height - 1 && current[at + source.width + 1]);
            if (near) next[at] = 1;
          }
        }
        current = next;
      }
      return current;
    };
    const iou = (a: Uint8Array, b: Uint8Array): number => {
      let intersection = 0;
      let unionCount = 0;
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] && b[i]) intersection += 1;
        if (a[i] || b[i]) unionCount += 1;
      }
      return intersection / Math.max(unionCount, 1);
    };
    for (const radius of [0, 1, 2, 3, 4]) {
      const grown = radius === 0 ? maskSmall : dilate(maskSmall, radius);
      const stats = geometry(grown, source.width, source.height);
      let stillMissing = 0;
      for (let i = 0; i < missed.length; i += 1) if (missed[i] && !grown[i]) stillMissing += 1;
      console.log(
        `DILATE u2netp+${radius}px 掩码=${stats.pixels}px IoU(vs isnet)=${iou(grown, maskBig).toFixed(4)} 仍漏=${stillMissing}px（原漏 ${missedPixels}px，补回 ${(((missedPixels - stillMissing) / Math.max(missedPixels, 1)) * 100).toFixed(1)}%）`
      );
      if (radius === 2) {
        writePng(
          resolve(process.cwd(), OUT, 'cmp-u2netp-dilate2-tint.png'),
          tintDifference(grown, maskBig, source)
        );
      }
    }
    expect(missedPixels).toBeGreaterThanOrEqual(0);
  }, 900000);
});





