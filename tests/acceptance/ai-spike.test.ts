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
import type { CellImage } from '../../src/types';

const SAMPLE_CANDIDATES = [
  '.tools/diag-v12final/rabbit-source.png', // 权威样例全分辨率（本地，gitignored）
  'tests/fixtures/rabbit-soft.png' // 1/4 降采样夹具（入库，CI 可用）
];
const MODEL = '.tools/ai-spike/u2netp.onnx';
const OUT = '.tools/ai-spike';
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

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

describe.skipIf(!ready)('AI 抠图 S1 spike（u2netp）', () => {
  it('权威样例上跑一次，回答「掩码是否完整覆盖主体」', async () => {
    const ort = await import('onnxruntime-node');
    const samplePath = SAMPLE_CANDIDATES.find((candidate) => existsSync(resolve(process.cwd(), candidate))) ?? SAMPLE_CANDIDATES[1];
    const modelPath = resolve(process.cwd(), MODEL);
    const hash = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
    const bytes = readFileSync(modelPath).length;
    console.log(`MODEL u2netp.onnx ${(bytes / 1024 / 1024).toFixed(2)}MB sha256=${hash}`);

    const source = readPng(resolve(process.cwd(), samplePath));
    console.log(`SAMPLE ${samplePath} ${source.width}x${source.height}`);

    // 预处理：缩到 320、/255、ImageNet 归一化、NCHW
    const small = resizeBilinear(source, SIZE, SIZE);
    const input = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const value = small.data[i * 4 + c] / 255;
        input[c * SIZE * SIZE + i] = (value - MEAN[c]) / STD[c];
      }
    }

    const session = await ort.InferenceSession.create(modelPath);
    const started = Date.now();
    const outputs = await session.run({
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE])
    });
    const elapsed = Date.now() - started;
    const first = outputs[session.outputNames[0]];
    const raw = first.data as Float32Array;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of raw) {
      if (value < min) min = value;
      if (value > max) max = value;
    }

    // 后处理：min-max 归一化 → 阈值 0.5（与 rembg 的 u2net 会话一致）
    const smallMask = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      smallMask[i] = (raw[i] - min) / Math.max(max - min, 1e-6) > 0.5 ? 1 : 0;
    }
    const smallMaskImage: RasterImage = {
      width: SIZE,
      height: SIZE,
      data: (() => {
        const data = new Uint8ClampedArray(SIZE * SIZE * 4);
        for (let i = 0; i < SIZE * SIZE; i += 1) {
          const value = smallMask[i] ? 0 : 255;
          data.set([value, value, value, 255], i * 4);
        }
        return data;
      })()
    };
    const upMask = resizeBilinear(smallMaskImage, source.width, source.height);
    const mask = new Uint8Array(source.width * source.height);
    for (let i = 0; i < mask.length; i += 1) mask[i] = upMask.data[i * 4] < 128 ? 1 : 0;

    const stats = geometry(mask, source.width, source.height);
    console.log(
      `RESULT 推理=${elapsed}ms 输出范围=[${min.toFixed(3)}, ${max.toFixed(3)}] 掩码=${stats.pixels}px (${(stats.ratio * 100).toFixed(1)}%) bbox=${stats.bbox} 触边=${stats.touchesBorder} 紧致度=${stats.compactness.toFixed(3)}`
    );

    // 探针像素：背景/主体中心/地面阴影
    const probe = (x: number, y: number) => {
      const value = mask[y * source.width + x];
      const offset = (y * source.width + x) * 4;
      return `(${x},${y}) rgb=${source.data[offset]},${source.data[offset + 1]},${source.data[offset + 2]} → mask=${value}`;
    };
    console.log(`PROBE 左上角(背景应=0)   ${probe(2, 2)}`);
    console.log(`PROBE 画面中心(主体应=1) ${probe(Math.floor(source.width / 2), Math.floor(source.height / 2))}`);
    console.log(`PROBE 底部地面(阴影)     ${probe(2, source.height - 3)}`);

    // 底边诊断：掩码是否"糊到画面底边"（残留的典型特征）
    let bottomRow = 0;
    let bottomMin = Number.POSITIVE_INFINITY;
    let bottomMax = Number.NEGATIVE_INFINITY;
    for (let x = 0; x < source.width; x += 1) {
      if (mask[(source.height - 1) * source.width + x]) {
        bottomRow += 1;
        bottomMin = Math.min(bottomMin, x);
        bottomMax = Math.max(bottomMax, x);
      }
    }
    const bboxArea =
      (Number(stats.bbox.split(',')[2]) - Number(stats.bbox.split(',')[0]) + 1) *
      (Number(stats.bbox.split(',')[3]) - Number(stats.bbox.split(',')[1]) + 1);
    console.log(
      `DIAG 底边行掩码像素=${bottomRow}/${source.width}${bottomRow ? ` x范围=${bottomMin}..${bottomMax}` : ''}；bbox 内填充率=${(stats.pixels / bboxArea).toFixed(3)}`
    );

    mkdirSync(resolve(process.cwd(), OUT), { recursive: true });
    writePng(resolve(process.cwd(), OUT, 'mask-u2netp.png'), maskToImage(mask, source.width, source.height));
    const subject = new Uint8ClampedArray(source.data);
    for (let i = 0; i < mask.length; i += 1) if (!mask[i]) subject[i * 4 + 3] = 0;
    writePng(
      resolve(process.cwd(), OUT, 'subject-u2netp.png'),
      overGray(subject, source.width, source.height)
    );
    console.log(`EVIDENCE ${OUT}/mask-u2netp.png 与 ${OUT}/subject-u2netp.png`);

    expect(stats.pixels).toBeGreaterThan(0);
  }, 180000);
});

