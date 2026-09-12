/**
 * 可选 AI 抠图 · 浏览器内 ONNX 推理（docs/45 §12.3 的 S2-b）。
 *
 * 设计要点（都由实测决定，见 docs/45 §11）：
 * 1. **运行时与模型都不进首屏**：onnxruntime-web 走**动态 import**（CDN，配 `@vite-ignore`），
 *    模型走**自托管 + 按需下载 + sha256 校验 + Cache Storage 缓存**；未启用时首屏体积增量 = 0（GA5）。
 * 2. **每个模型的预处理参数不同**（输入尺寸 / mean / std 都必须按模型配，喂错直接出散点或报错）：
 *    u2net 系 = 320 + ImageNet；**ISNet = 1024 + mean0.5/std1**（当前主档）。
 * 3. 输出：min-max 归一化后阈值 0.5 → 0/1 掩码，交给 `extractSubjectFromAIMask`。
 * 4. 任何失败（离线、校验失败、后端不可用、推理异常）都**向上抛**，由调用方落回现有行为（红线）。
 */
import type { AIMaskInput } from '../core/pipeline/subject';

/** 模型档位。`path` 是**相对资源基址**的路径（部署在子路径时必须相对，见 §12.3 说明）。 */
export interface AiModelSpec {
  id: string;
  label: string;
  path: string;
  /** 期望的字节数（下载完整性初筛）与 sha256（强校验，仅安全上下文可用）。 */
  bytes: number;
  sha256: string;
  /** 该模型固定的输入边长。 */
  inputSize: number;
  mean: [number, number, number];
  std: [number, number, number];
}

/**
 * 主档：ISNet-int8（44.2MB）。量化脚本见 docs/45 §11.1（onnxruntime QUInt8，可复现）。
 * 许可链：DIS/ISNet = Apache-2.0 → rembg(MIT) 的 ONNX 转换 → 我们量化（onnxruntime, MIT）。
 */
export const AI_MODEL_ISNET_INT8: AiModelSpec = {
  id: 'isnet-general-use-int8',
  label: 'ISNet-int8（44MB）',
  path: 'models/isnet-general-use-int8.onnx',
  bytes: 46_360_717,
  sha256: 'f1b1c6f7656e532627697afc989d953be1e7ef8f55a718f3611e8c9fd50cdef7',
  inputSize: 1024,
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1]
};

/** onnxruntime-web 的固定版本（动态加载，避免进首屏；版本 pin 住以免上游漂移）。 */
const ORT_VERSION = '1.20.1';
const ORT_ESM_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.bundle.min.mjs`;
const CACHE_NAME = 'pixelbean-ai-model-v1';

type OrtModule = {
  env: { wasm: { wasmPaths?: string } };
  InferenceSession: {
    create: (
      data: Uint8Array,
      options?: Record<string, unknown>
    ) => Promise<{
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
    }>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
};

let ortPromise: Promise<OrtModule> | null = null;

/** 动态加载 onnxruntime-web（只加载一次）。失败时抛错，由调用方落回现有行为。 */
async function loadOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = (async () => {
      const module = (await import(/* @vite-ignore */ ORT_ESM_URL)) as unknown as OrtModule;
      // WASM 资源与运行时同源（同一 CDN 版本目录）
      module.env.wasm.wasmPaths = ORT_ESM_URL.replace(/ort[^/]*\.mjs$/, '');
      return module;
    })().catch((error: unknown) => {
      ortPromise = null;
      throw error instanceof Error ? error : new Error('AI 抠图运行时加载失败');
    });
  }
  return ortPromise;
}

/**
 * SHA-256 十六进制。**注意：`crypto.subtle` 只在安全上下文（HTTPS / localhost）可用**，
 * 而本站可能部署在 `http://<ip>/子路径`。这种情况下退化为「只校验字节数」并给出警告——
 * 因为在同一个明文 HTTP 通道上，哈希本身也会被一并篡改，强校验在此并不提供额外保护。
 * 线上建议启用 HTTPS（见 docs/08 与 docs/46 §5）。
 */
async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    console.warn('[AI 抠图] 当前不是安全上下文（HTTPS/localhost），无法做 sha256 校验，改为仅校验文件大小。');
    return null;
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export type AiProgress =
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'verify' }
  | { stage: 'inference' };

/**
 * 取模型字节：Cache Storage 命中直接用；未命中则带进度下载并**校验 sha256**（安全上下文下）
 * 后写入缓存。校验不通过 → 抛错并丢弃（绝不用来路不明的权重）。
 */
async function loadModelBytes(
  spec: AiModelSpec,
  modelUrl: string,
  onProgress: (progress: AiProgress) => void
): Promise<ArrayBuffer> {
  const cache = 'caches' in self ? await caches.open(CACHE_NAME) : null;
  const valid = async (bytes: ArrayBuffer): Promise<boolean> => {
    const hex = await sha256Hex(bytes);
    if (hex === null) return bytes.byteLength === spec.bytes; // 非安全上下文：只能查大小
    return hex.startsWith(spec.sha256.slice(0, 32));
  };

  const cached = await cache?.match(modelUrl);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    if (await valid(bytes)) return bytes;
    await cache?.delete(modelUrl);
  }

  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）`);
  const total = Number(response.headers.get('content-length') ?? spec.bytes);
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = await response.arrayBuffer();
    onProgress({ stage: 'download', loaded: bytes.byteLength, total });
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress({ stage: 'download', loaded, total });
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress({ stage: 'verify' });
  const buffer = merged.buffer as ArrayBuffer;
  if (!(await valid(buffer))) {
    throw new Error('模型校验失败（大小或 sha256 不匹配），已丢弃');
  }
  await cache?.put(modelUrl, new Response(buffer.slice(0)));
  return buffer;
}

/** 双线性缩放到 size×size 的 RGBA 缓冲（与 spike 中验证过的实现同源）。 */
function resizeBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  size: number
): Float32Array {
  const out = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    const sy = ((y + 0.5) * height) / size - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < size; x += 1) {
      const sx = ((x + 0.5) * width) / size - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, sx - x0));
      for (let c = 0; c < 3; c += 1) {
        const p00 = data[(y0 * width + x0) * 4 + c];
        const p01 = data[(y0 * width + x1) * 4 + c];
        const p10 = data[(y1 * width + x0) * 4 + c];
        const p11 = data[(y1 * width + x1) * 4 + c];
        const top = p00 * (1 - wx) + p01 * wx;
        const bottom = p10 * (1 - wx) + p11 * wx;
        out[(y * size + x) * 3 + c] = top * (1 - wy) + bottom * wy;
      }
    }
  }
  return out;
}

/**
 * 跑一次 AI 抠图，返回 0/1 掩码（尺寸 = inputSize²，交由 `extractSubjectFromAIMask` 对齐到原图）。
 *
 * `assetBase` 是**资源基址**（主线程传入 `document.baseURI`）：本站可能部署在子路径
 * （例如 `http://host/pixelbean/`），模型路径必须相对它解析，否则会打到域名根上去。
 * 任何异常都向上抛（离线/后端不可用/推理失败），调用方必须落回现有行为。
 */
export async function runAiMask(
  source: { width: number; height: number; data: Uint8ClampedArray },
  spec: AiModelSpec,
  onProgress: (progress: AiProgress) => void,
  assetBase: string
): Promise<AIMaskInput> {
  const modelUrl = new URL(spec.path, assetBase).href;
  const [ort, modelBytes] = await Promise.all([
    loadOrt(),
    loadModelBytes(spec, modelUrl, onProgress)
  ]);
  onProgress({ stage: 'inference' });

  const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
  const size = spec.inputSize;
  const rgb = resizeBilinear(source.data, source.width, source.height, size);
  const input = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgb[i * 3 + c] / 255;
      input[c * size * size + i] = (value - spec.mean[c]) / spec.std[c];
    }
  }
  const outputs = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size])
  });
  const raw = outputs[session.outputNames[0]].data;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = Math.max(max - min, 1e-6);
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = (raw[i] - min) / span > 0.5 ? 1 : 0;
  }
  return { width: size, height: size, data: mask };
}
