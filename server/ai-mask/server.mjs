/**
 * PixelBean · 服务端 AI 抠图（可选增强）
 *
 * 为什么有它：浏览器内推理要用户先下载模型（44MB，实测该服务器上行只有 ~142KB/s ⇒ 约 5 分钟）。
 * 改成服务端推理后：**用户零下载**，服务器可用 fp32 更好质量的模型，移动端也不吃算力。
 * 代价是**图片会上传到服务器**（已在 README/docs 明确告知；服务端不落盘、不记录像素）。
 *
 * 协议（极小，服务端**不做图像编解码**，因此无需任何图像库）：
 *   POST /mask?model=<id>&size=<n>
 *     body = RGBA 原始字节（size × size × 4，客户端已解码并缩放到模型输入尺寸）
 *     200  = 掩码原始字节（size × size，每字节 0/1）
 *     400/413/429/503 = 参数错误 / 过大 / 限流 / 忙
 *   GET /health → { ok, models, loaded }
 *
 * 设计约束（这台服务器只有 2 核 / 3.4GB，且还跑着别的服务）：
 *   - 常驻只保留**一个**模型会话（换模型时换入换出），内存恒定；
 *   - 并发上限 1 + 队列上限 4，超出直接 503（宁可快速失败，不拖垮同机服务）；
 *   - 单 IP 限流；
 *   - **不落盘**：像素只在内存中处理，请求结束即释放，日志只记状态/耗时/模型/尺寸。
 *
 * 运行：node server.mjs（默认 127.0.0.1:8790，仅由 nginx 反代暴露）
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? '127.0.0.1';
const MODEL_DIR = process.env.MODEL_DIR ?? '/opt/pixelbean-ai/models';
const MAX_BODY = Number(process.env.MAX_BODY ?? 8 * 1024 * 1024); // 8MB（1024² RGBA = 4MB）
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 1);
const QUEUE_LIMIT = Number(process.env.QUEUE_LIMIT ?? 4);
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 40); // 每 IP 每分钟
const RATE_WINDOW_MS = 60_000;

/** 模型表：预处理参数（mean/std）在**服务端**，客户端只需按 inputSize 缩放并送 RGBA。 */
const MODELS = {
  'u2net-quality': {
    file: `${MODEL_DIR}/u2net.onnx`,
    label: '高质量（u2net fp32）',
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225]
  },
  'u2netp-fast': {
    file: `${MODEL_DIR}/u2netp.onnx`,
    label: '快速（u2netp）',
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225]
  }
};
const DEFAULT_MODEL = 'u2net-quality';

ort.env.wasm.numThreads = Number(process.env.WASM_THREADS ?? 2);
ort.env.wasm.wasmPaths = process.env.ORT_WASM_DIR ?? '/opt/pixelbean-ai/node_modules/onnxruntime-web/dist/';

/** 常驻一个会话（LRU=1）：内存恒定，换模型时换入换出。 */
let loaded = null; // { id, session }
let queue = 0;
const rate = new Map(); // ip -> number[]（时间戳）

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rate.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rate.set(ip, hits);
  if (rate.size > 5000) rate.clear();
  return hits.length > RATE_LIMIT;
}

async function sessionFor(id) {
  if (loaded?.id === id) return loaded.session;
  const spec = MODELS[id];
  const started = Date.now();
  const session = await ort.InferenceSession.create(readFileSync(spec.file), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
  console.log(`[model] 载入 ${id}（${((Date.now() - started) / 1000).toFixed(2)}s）`);
  loaded = { id, session }; // 释放旧会话（不再被引用，交由 GC）
  return session;
}

/** 与浏览器侧验证过的实现一致：/255 → 逐通道 (x-mean)/std → NCHW。 */
function toTensor(rgba, spec) {
  const size = spec.inputSize;
  const input = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgba[i * 4 + c] / 255;
      input[c * size * size + i] = (value - spec.mean[c]) / spec.std[c];
    }
  }
  return new ort.Tensor('float32', input, [1, 3, size, size]);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').toString().split(',')[0].trim();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  const reply = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
    console.log(`[req] ${req.method} ${url.pathname} ${status} ${Date.now() - started}ms ${type.startsWith('text') ? String(body).slice(0, 120) : `${body.length}B`}`);
  };

  if (url.pathname === '/health') {
    reply(200, JSON.stringify({ ok: true, models: Object.keys(MODELS), loaded: loaded?.id ?? null }), 'application/json');
    return;
  }
  if (url.pathname !== '/mask' || req.method !== 'POST') {
    reply(404, 'not found');
    return;
  }
  if (rateLimited(ip)) {
    reply(429, '请求过于频繁，请稍后再试');
    return;
  }

  const modelId = url.searchParams.get('model') ?? DEFAULT_MODEL;
  const spec = MODELS[modelId];
  if (!spec) {
    reply(400, `未知模型：${modelId}`);
    return;
  }
  const size = Number(url.searchParams.get('size') ?? spec.inputSize);
  if (size !== spec.inputSize) {
    reply(400, `尺寸不符：${modelId} 需要 ${spec.inputSize}`);
    return;
  }
  if (queue >= CONCURRENCY + QUEUE_LIMIT) {
    reply(503, '服务器正忙，请稍后再试');
    return;
  }

  queue += 1;
  try {
    const body = await readBody(req);
    if (body.length !== size * size * 4) {
      reply(400, `RGBA 长度不符：期望 ${size * size * 4}，收到 ${body.length}`);
      return;
    }
    const session = await sessionFor(modelId);
    const outputs = await session.run({ [session.inputNames[0]]: toTensor(body, spec) });
    const raw = outputs[session.outputNames[0]].data;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of raw) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const span = Math.max(max - min, 1e-6);
    const mask = Buffer.allocUnsafe(size * size);
    let ones = 0;
    for (let i = 0; i < mask.length; i += 1) {
      const bit = (raw[i] - min) / span > 0.5 ? 1 : 0;
      mask[i] = bit;
      ones += bit;
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'x-mask-size': String(size),
      'x-mask-model': modelId,
      'cache-control': 'no-store'
    });
    res.end(mask);
    console.log(
      `[req] POST /mask model=${modelId} size=${size} 主体占比=${((ones / mask.length) * 100).toFixed(1)}% ${Date.now() - started}ms`
    );
  } catch (error) {
    reply(error?.status ?? 500, `处理失败：${error?.message ?? error}`);
  } finally {
    queue -= 1;
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[boot] pixelbean-ai 监听 http://${HOST}:${PORT}（模型：${Object.keys(MODELS).join(', ')}）`);
  // 预热默认模型，避免第一个用户等载入
  sessionFor(DEFAULT_MODEL).catch((error) => console.error('[boot] 预热失败：', error.message));
});
