/**
 * 可选 AI 抠图 · **服务端推理**客户端（docs/47）。
 *
 * 架构变更（2026-09）：原先在用户浏览器里跑 ONNX（需要用户下载 44MB 模型；实测该服务器上行
 * 仅 ~142KB/s ⇒ 首下约 5 分钟、HTTP 下还因 `caches`/`crypto.subtle` 限定安全上下文而每次重下）。
 * 现改为**把图片交给自家服务器算**：
 *   - 用户**零下载**；
 *   - 服务器可用 fp32 更好质量的模型，且 320² 输入比 1024² 省算力（2 核机器实测 3.6s/张）；
 *   - 代价：**图片会上传到服务器**（服务端不落盘、不记录像素，见 server/ai-mask/README.md）。
 *
 * 协议：客户端把图片**解码并缩放到模型输入尺寸后的 RGBA** POST 给 `/api/mask`，
 * 服务端只做归一化 + 推理 + 阈值，返回 size² 的 0/1 掩码字节。
 * 这样服务端**不需要任何图像编解码库**（客户端本来就已经把像素解码好了）。
 */
import type { AIMaskInput } from '../core/pipeline/subject';

export interface AiModelOption {
  id: string;
  label: string;
  /** 模型输入边长（客户端据此缩放后再上传）。 */
  inputSize: number;
}

/** 与服务端 `MODELS` 表保持一致；`app` 侧只用到 id/label/inputSize。 */
export const AI_MODELS: AiModelOption[] = [
  { id: 'u2net-quality', label: '高质量（u2net，约 4 秒）', inputSize: 320 },
  { id: 'u2netp-fast', label: '快速（u2netp，约 2 秒）', inputSize: 320 }
];

export const DEFAULT_AI_MODEL_ID = 'u2net-quality';

export function aiModelById(id: string | undefined): AiModelOption {
  return AI_MODELS.find((model) => model.id === id) ?? AI_MODELS[0];
}

/** 双线性缩放到 size² 的 RGBA（与既有实现同源，已验证）。 */
function resizeRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  size: number
): Uint8Array {
  const out = new Uint8Array(size * size * 4);
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
      for (let c = 0; c < 4; c += 1) {
        const p00 = data[(y0 * width + x0) * 4 + c];
        const p01 = data[(y0 * width + x1) * 4 + c];
        const p10 = data[(y1 * width + x0) * 4 + c];
        const p11 = data[(y1 * width + x1) * 4 + c];
        const top = p00 * (1 - wx) + p01 * wx;
        const bottom = p10 * (1 - wx) + p11 * wx;
        out[(y * size + x) * 4 + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
  return out;
}

export type AiProgress = { stage: 'inference'; uploaded: boolean };

/**
 * 调服务端算掩码。`assetBase` 是资源基址（主线程的 `document.baseURI`），
 * 因此部署在子路径（`/pixelbean/`）时请求会打到 `/pixelbean/api/mask` ✓。
 *
 * 任何失败（离线 / 服务未部署 / 限流 / 超时）都向上抛，调用方必须落回现有行为（红线）。
 */
export async function runAiMask(
  source: { width: number; height: number; data: Uint8ClampedArray },
  model: AiModelOption,
  onProgress: (progress: AiProgress) => void,
  assetBase: string
): Promise<AIMaskInput> {
  const size = model.inputSize;
  const rgba = resizeRgba(source.data, source.width, source.height, size);
  const endpoint = new URL(`api/mask?model=${encodeURIComponent(model.id)}&size=${size}`, assetBase);
  onProgress({ stage: 'inference', uploaded: false });

  const response = await fetch(endpoint.href, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI 抠图服务返回 ${response.status}${detail ? `：${detail.slice(0, 80)}` : ''}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.length !== size * size) {
    throw new Error(`AI 抠图服务返回的掩码长度不符（${buffer.length} ≠ ${size * size}）`);
  }
  return { width: size, height: size, data: buffer };
}
