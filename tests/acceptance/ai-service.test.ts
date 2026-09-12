/**
 * 服务端 AI 抠图接口验收（docs/47）。
 *
 * 这套门禁跑的是**线上/本机的常驻服务**，不是浏览器：把真实图片缩到模型输入尺寸后
 * POST 原始 RGBA，校验返回的掩码是否合理。用 env 指定服务地址，缺省则整个文件 skip。
 *
 *   $env:AI_SERVICE_URL='http://39.104.21.103/pixelbean/api'
 *   npx vitest run tests/acceptance/ai-service.test.ts
 *
 * 为什么走 RGBA 而不是图片：服务端因此**不需要任何图像编解码库**（无需 sharp/jpeg-js），
 * 客户端本来就已经解码好了像素。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPng, type RasterImage } from '../support/png';

const SERVICE = process.env.AI_SERVICE_URL?.replace(/\/$/, '');
const INPUT_SIZE = 320;
const SAMPLE_CANDIDATES = [
  '.tools/diag-v12final/rabbit-source.png', // 权威样例全分辨率（本地，gitignored）
  'tests/fixtures/rabbit-soft.png' // 1/4 降采样夹具（入库）
];

function samplePath(): string {
  return (
    SAMPLE_CANDIDATES.find((candidate) => existsSync(resolve(process.cwd(), candidate))) ??
    SAMPLE_CANDIDATES[1]
  );
}

/** 双线性缩放到 size²，返回 RGB（丢弃 alpha，服务端只吃 RGB 三通道）。 */
function resizeRgba(image: RasterImage, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sy = ((y + 0.5) * image.height) / size - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < size; x += 1) {
      const sx = ((x + 0.5) * image.width) / size - 0.5;
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
        out[(y * size + x) * 4 + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
      out[(y * size + x) * 4 + 3] = 255;
    }
  }
  return out;
}

function stats(mask: Uint8Array, size: number) {
  let ones = 0;
  for (const value of mask) if (value) ones += 1;
  const at = (x: number, y: number) => mask[y * size + x];
  return {
    ratio: ones / mask.length,
    center: at(Math.floor(size / 2), Math.floor(size / 2)),
    corner: at(2, 2),
    bottomLeft: at(2, size - 3)
  };
}

async function requestMask(model: string, rgba: Uint8Array, size = INPUT_SIZE) {
  const started = Date.now();
  // 显式切出独立 ArrayBuffer：TS 5.7 的 Uint8Array 泛型不接受 ArrayBufferLike，
  // 且 subarray 视图必须按其 byteOffset/byteLength 切，否则「长度不符」用例会失效。
  const payload = rgba.buffer.slice(
    rgba.byteOffset,
    rgba.byteOffset + rgba.byteLength
  ) as ArrayBuffer;
  const response = await fetch(`${SERVICE}/mask?model=${model}&size=${size}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: payload
  });
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, buffer, ms: Date.now() - started };
}

describe.skipIf(!SERVICE)('服务端 AI 抠图接口', () => {
  it('高质量档：真实样例 → 掩码合理（覆盖主体中心、排除背景角）', async () => {
    const image = readPng(resolve(process.cwd(), samplePath()));
    const rgba = resizeRgba(image, INPUT_SIZE);
    const { status, buffer, ms } = await requestMask('u2net-quality', rgba);
    expect(status).toBe(200);
    expect(buffer.length).toBe(INPUT_SIZE * INPUT_SIZE);
    const s = stats(buffer, INPUT_SIZE);
    console.log(
      `SERVICE u2net-quality ${ms}ms 主体占比=${(s.ratio * 100).toFixed(1)}% 中心=${s.center} 角=${s.corner} 左下=${s.bottomLeft}`
    );
    expect(s.ratio).toBeGreaterThan(0.35);
    expect(s.ratio).toBeLessThan(0.65);
    expect(s.center).toBe(1);
    expect(s.corner).toBe(0);
  }, 120000);

  it('快速档：同样的输入也能出合理掩码', async () => {
    const image = readPng(resolve(process.cwd(), samplePath()));
    const rgba = resizeRgba(image, INPUT_SIZE);
    const { status, buffer, ms } = await requestMask('u2netp-fast', rgba);
    expect(status).toBe(200);
    const s = stats(buffer, INPUT_SIZE);
    console.log(
      `SERVICE u2netp-fast ${ms}ms 主体占比=${(s.ratio * 100).toFixed(1)}% 中心=${s.center} 角=${s.corner}`
    );
    expect(s.ratio).toBeGreaterThan(0.3);
    expect(s.center).toBe(1);
    expect(s.corner).toBe(0);
  }, 120000);

  it('参数校验：未知模型 / 尺寸不符 / 长度不符 都要被拒', async () => {
    const image = readPng(resolve(process.cwd(), samplePath()));
    const rgba = resizeRgba(image, INPUT_SIZE);
    expect((await requestMask('nope', rgba)).status).toBe(400);
    expect((await requestMask('u2net-quality', rgba, 512)).status).toBe(400);
    const short = rgba.subarray(0, rgba.length - 8);
    expect((await requestMask('u2net-quality', short)).status).toBe(400);
  }, 120000);
});
