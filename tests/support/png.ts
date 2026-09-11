/**
 * 测试用最小 PNG 编解码器（仅 node:zlib，零依赖）。
 * 目的：让「真实样例门禁」（docs/43 §4.3 / docs/41 §B.4 G1–G7）能直接吃真实图片字节，
 * 而不是把图片像素硬编码进测试。
 *
 * 支持：8 位灰度(0)/真彩(2)/索引(3)/灰度+alpha(4)/真彩+alpha(6)，非隔行。
 * 不支持：16 位、Adam7 隔行 —— 遇到即抛错（明确失败优于静默错误）。
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA，长度 = width * height * 4。 */
  data: Uint8ClampedArray;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const start = offset + 8;
    chunks.push({ type, data: bytes.subarray(start, start + length) });
    offset = start + length + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw: Uint8Array, width: number, height: number, bpp: number, stride: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[src + i];
      const left = i >= bpp ? out[dst + i - bpp] : 0;
      const above = y > 0 ? out[up + i] : 0;
      const upperLeft = y > 0 && i >= bpp ? out[up + i - bpp] : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + above;
          break;
        case 3:
          result = value + ((left + above) >> 1);
          break;
        case 4:
          result = value + paeth(left, above, upperLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter type ${filter}`);
      }
      out[dst + i] = result & 0xff;
    }
  }
  return out;
}

export function decodePng(bytes: Uint8Array): RasterImage {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr) throw new Error('PNG missing IHDR');
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');

  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);

  const idat = chunks.filter((chunk) => chunk.type === 'IDAT');
  if (!idat.length) throw new Error('PNG missing IDAT');
  const merged = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.data.length, 0));
  let cursor = 0;
  for (const chunk of idat) {
    merged.set(chunk.data, cursor);
    cursor += chunk.data.length;
  }
  const stride = width * channels;
  const flat = unfilter(inflateSync(Buffer.from(merged)), width, height, channels, stride);

  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  const transparency = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    const d = i * 4;
    switch (colorType) {
      case 0: {
        const v = flat[s];
        data[d] = v;
        data[d + 1] = v;
        data[d + 2] = v;
        data[d + 3] = 255;
        break;
      }
      case 2: {
        data[d] = flat[s];
        data[d + 1] = flat[s + 1];
        data[d + 2] = flat[s + 2];
        data[d + 3] = 255;
        break;
      }
      case 3: {
        if (!palette) throw new Error('indexed PNG missing PLTE');
        const index = flat[s];
        data[d] = palette[index * 3];
        data[d + 1] = palette[index * 3 + 1];
        data[d + 2] = palette[index * 3 + 2];
        data[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        break;
      }
      case 4: {
        const v = flat[s];
        data[d] = v;
        data[d + 1] = v;
        data[d + 2] = v;
        data[d + 3] = flat[s + 1];
        break;
      }
      default: {
        data[d] = flat[s];
        data[d + 1] = flat[s + 1];
        data[d + 2] = flat[s + 2];
        data[d + 3] = flat[s + 3];
        break;
      }
    }
  }
  return { width, height, data };
}

export function readPng(path: string): RasterImage {
  return decodePng(new Uint8Array(readFileSync(path)));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/** 写 8 位 RGBA、无隔行、filter=0 的 PNG（用于产出目检证据）。 */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raw), { level: 9 }))),
    chunk('IEND', new Uint8Array(0))
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function writePng(path: string, image: RasterImage): void {
  writeFileSync(path, encodePng(image));
}

/** 把 0/1 掩码渲染成可目检的 RGBA（主体=黑，背景=白）。 */
export function maskToImage(mask: Uint8Array, width: number, height: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const value = mask[i] ? 0 : 255;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
