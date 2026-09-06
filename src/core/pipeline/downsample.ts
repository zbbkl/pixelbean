import type { BgMode, CellImage, DownsampleMode } from '../../types';
import type { AdjustOptions } from '../../types';
import { adjustRgb } from '../color/adjust';
import { linearRgbToSrgbByte, srgbByteToLinear } from '../color/srgb';

const WHITE: readonly [number, number, number] = [255, 255, 255];
const BLACK: readonly [number, number, number] = [0, 0, 0];

function backgroundRgb(bg: BgMode): readonly [number, number, number] {
  return bg === 'white' ? WHITE : BLACK;
}

export function compositeCell(
  r: number,
  g: number,
  b: number,
  a: number,
  bg: BgMode
): [number, number, number] {
  if (a <= 0) return [...backgroundRgb(bg)] as [number, number, number];
  if (a >= 128) return [r, g, b];
  const t = a / 255;
  const back = backgroundRgb(bg);
  return [
    Math.round(r * t + back[0] * (1 - t)),
    Math.round(g * t + back[1] * (1 - t)),
    Math.round(b * t + back[2] * (1 - t))
  ];
}

function effectiveRgb(
  r: number,
  g: number,
  b: number,
  a: number,
  bg: BgMode,
  adjust?: AdjustOptions
): [number, number, number] {
  const rgb = compositeCell(r, g, b, a, bg);
  return adjust ? adjustRgb(rgb, adjust) : rgb;
}

export function downsampleAverage(
  image: CellImage,
  width: number,
  height: number,
  bg: BgMode,
  adjust?: AdjustOptions
): Uint8ClampedArray {
  const { width: sw, height: sh, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let gy = 0; gy < height; gy += 1) {
    const y0 = Math.floor((gy * sh) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sh) / height));
    for (let gx = 0; gx < width; gx += 1) {
      const x0 = Math.floor((gx * sw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / width));
      let linR = 0;
      let linG = 0;
      let linB = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        const row = y * sw * 4;
        for (let x = x0; x < x1; x += 1) {
          const offset = row + x * 4;
          const [r, g, b] = effectiveRgb(data[offset], data[offset + 1], data[offset + 2], data[offset + 3], bg, adjust);
          linR += srgbByteToLinear(r);
          linG += srgbByteToLinear(g);
          linB += srgbByteToLinear(b);
          n += 1;
        }
      }
      const [r, g, b] = linearRgbToSrgbByte([linR / n, linG / n, linB / n]);
      const cell = (gy * width + gx) * 4;
      out[cell] = r;
      out[cell + 1] = g;
      out[cell + 2] = b;
      out[cell + 3] = 255;
    }
  }
  return out;
}

interface BucketStat {
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
}

function bucketIndex(r: number, g: number, b: number): number {
  return (r << 12) | (g << 6) | b;
}

export function downsampleDominant(
  image: CellImage,
  width: number,
  height: number,
  bg: BgMode,
  adjust?: AdjustOptions
): Uint8ClampedArray {
  const { width: sw, height: sh, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let gy = 0; gy < height; gy += 1) {
    const y0 = Math.floor((gy * sh) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sh) / height));
    for (let gx = 0; gx < width; gx += 1) {
      const x0 = Math.floor((gx * sw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / width));
      const buckets = new Map<number, BucketStat>();
      for (let y = y0; y < y1; y += 1) {
        const row = y * sw * 4;
        for (let x = x0; x < x1; x += 1) {
          const offset = row + x * 4;
          const [r8, g8, b8] = effectiveRgb(data[offset], data[offset + 1], data[offset + 2], data[offset + 3], bg, adjust);
          const r = srgbByteToLinear(r8);
          const g = srgbByteToLinear(g8);
          const b = srgbByteToLinear(b8);
          const key = bucketIndex(Math.round(r * 63), Math.round(g * 63), Math.round(b * 63));
          const stat = buckets.get(key) ?? { count: 0, sumR: 0, sumG: 0, sumB: 0 };
          stat.count += 1;
          stat.sumR += r;
          stat.sumG += g;
          stat.sumB += b;
          buckets.set(key, stat);
        }
      }

      let bestKey = -1;
      let bestStat: BucketStat | undefined;
      for (const [key, stat] of buckets) {
        if (!bestStat || stat.count > bestStat.count || (stat.count === bestStat.count && key < bestKey)) {
          bestKey = key;
          bestStat = stat;
        }
      }
      const fallback = { count: 1, sumR: 0, sumG: 0, sumB: 0 };
      const winner = bestStat ?? fallback;
      const [r, g, b] = linearRgbToSrgbByte([winner.sumR / winner.count, winner.sumG / winner.count, winner.sumB / winner.count]);
      const cell = (gy * width + gx) * 4;
      out[cell] = r;
      out[cell + 1] = g;
      out[cell + 2] = b;
      out[cell + 3] = 255;
    }
  }
  return out;
}

export function downsample(
  image: CellImage,
  width: number,
  height: number,
  mode: DownsampleMode,
  bg: BgMode,
  adjust?: AdjustOptions
): Uint8ClampedArray {
  return mode === 'dominant'
    ? downsampleDominant(image, width, height, bg, adjust)
    : downsampleAverage(image, width, height, bg, adjust);
}
