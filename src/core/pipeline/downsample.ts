import type { BgMode, CellImage, DownsampleMode } from '../../types';
import type { AdjustOptions } from '../../types';
import { adjustRgb } from '../color/adjust';
import { linearRgbToSrgbByte, srgbByteToLinear } from '../color/srgb';
import { srgbRgbToLab } from '../color/lab';

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

export interface DownsampleOpts {
  /** 若源图已把背景置 alpha=0，则跳过透明像素，避免被当白/黑垫底。 */
  transparentSource?: boolean;
  emptySmooth?: number;
}

function sampleRgb(
  data: Uint8ClampedArray,
  offset: number,
  bg: BgMode,
  adjust: AdjustOptions | undefined,
  transparentSource: boolean
): [number, number, number] | null {
  const alpha = data[offset + 3];
  if (transparentSource) {
    if (alpha <= 0) return null;
    const raw: [number, number, number] = [data[offset], data[offset + 1], data[offset + 2]];
    return adjust ? adjustRgb(raw, adjust) : raw;
  }
  return effectiveRgb(data[offset], data[offset + 1], data[offset + 2], alpha, bg, adjust);
}

function emptyRgb(): [number, number, number] {
  return [255, 255, 255];
}

function labFInverse(value: number): number {
  const cube = value ** 3;
  return cube > 216 / 24389
    ? cube
    : ((116 * value - 16) / 24389) * 27;
}

function labToSrgb(lab: readonly [number, number, number]): [number, number, number] {
  const [L, a, b] = lab;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = 0.95047 * labFInverse(fx);
  const y = labFInverse(fy);
  const z = 1.08883 * labFInverse(fz);
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return linearRgbToSrgbByte([r, g, bl]);
}

function averageRegionRgb(
  data: Uint8ClampedArray,
  sw: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  bg: BgMode,
  adjust?: AdjustOptions,
  transparentSource = false
): [number, number, number] {
  let linR = 0;
  let linG = 0;
  let linB = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    const row = y * sw * 4;
    for (let x = x0; x < x1; x += 1) {
      const offset = row + x * 4;
      const rgb = sampleRgb(data, offset, bg, adjust, transparentSource);
      if (!rgb) continue;
      linR += srgbByteToLinear(rgb[0]);
      linG += srgbByteToLinear(rgb[1]);
      linB += srgbByteToLinear(rgb[2]);
      n += 1;
    }
  }
  if (!n) return emptyRgb();
  return linearRgbToSrgbByte([linR / n, linG / n, linB / n]);
}

export function downsampleAverage(
  image: CellImage,
  width: number,
  height: number,
  bg: BgMode,
  adjust?: AdjustOptions,
  opts: DownsampleOpts = {}
): Uint8ClampedArray {
  const transparentSource = opts.transparentSource === true;
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
          const rgb = sampleRgb(data, offset, bg, adjust, transparentSource);
          if (!rgb) continue;
          const [r, g, b] = rgb;
          linR += srgbByteToLinear(r);
          linG += srgbByteToLinear(g);
          linB += srgbByteToLinear(b);
          n += 1;
        }
      }
      const [r, g, b] = n ? linearRgbToSrgbByte([linR / n, linG / n, linB / n]) : emptyRgb();
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
  adjust?: AdjustOptions,
  opts: DownsampleOpts = {}
): Uint8ClampedArray {
  const transparentSource = opts.transparentSource === true;
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
          const rgb = sampleRgb(data, offset, bg, adjust, transparentSource);
          if (!rgb) continue;
          const [r8, g8, b8] = rgb;
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

const LAB_BUCKETS_L = 10;
const LAB_BUCKETS_A = 12;
const LAB_BUCKETS_B = 12;
const LAB_BUCKET_COUNT = LAB_BUCKETS_L * LAB_BUCKETS_A * LAB_BUCKETS_B;
const LAB_NEIGHBOR_WEIGHT = [0.5, 0.5, 0.5] as const;

function labBucket(lab: readonly [number, number, number]): number {
  const l = Math.max(0, Math.min(LAB_BUCKETS_L - 1, Math.floor(lab[0] / 10)));
  const a = Math.max(0, Math.min(LAB_BUCKETS_A - 1, Math.floor((lab[1] + 128) * LAB_BUCKETS_A / 256)));
  const b = Math.max(0, Math.min(LAB_BUCKETS_B - 1, Math.floor((lab[2] + 128) * LAB_BUCKETS_B / 256)));
  return l * LAB_BUCKETS_A * LAB_BUCKETS_B + a * LAB_BUCKETS_B + b;
}

/**
 * v1.2-final E1：Lab 感知桶主导色 + 空桶平滑插值。
 * dominant 语义从 linear RGB 6bit 桶升级为 L*10×a*12×b*12 桶，
 * 稀疏区域（<4 源像素）回退 average 防抖动。
 */
export function downsampleDominantV2(
  image: CellImage,
  width: number,
  height: number,
  bg: BgMode,
  adjust?: AdjustOptions,
  opts: DownsampleOpts = {}
): Uint8ClampedArray {
  const emptySmooth = opts.emptySmooth ?? 0.5;
  const transparentSource = opts.transparentSource === true;
  const { width: sw, height: sh, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let gy = 0; gy < height; gy += 1) {
    const y0 = Math.floor((gy * sh) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sh) / height));
    for (let gx = 0; gx < width; gx += 1) {
      const x0 = Math.floor((gx * sw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / width));
      const counts = new Int32Array(LAB_BUCKET_COUNT);
      const sumL = new Float64Array(LAB_BUCKET_COUNT);
      const sumA = new Float64Array(LAB_BUCKET_COUNT);
      const sumB = new Float64Array(LAB_BUCKET_COUNT);
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        const row = y * sw * 4;
        for (let x = x0; x < x1; x += 1) {
          const offset = row + x * 4;
          const rgb = sampleRgb(data, offset, bg, adjust, transparentSource);
          if (!rgb) continue;
          const lab = srgbRgbToLab(rgb);
          const key = labBucket(lab);
          counts[key] += 1;
          sumL[key] += lab[0];
          sumA[key] += lab[1];
          sumB[key] += lab[2];
          n += 1;
        }
      }

      let rgb: [number, number, number];
      if (n < 4) {
        rgb = averageRegionRgb(data, sw, x0, x1, y0, y1, bg, adjust, transparentSource);
      } else {
        let best = -1;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let key = 0; key < LAB_BUCKET_COUNT; key += 1) {
          if (!counts[key]) continue;
          let score = counts[key];
          const baseL = Math.floor(key / (LAB_BUCKETS_A * LAB_BUCKETS_B));
          const rest = key - baseL * LAB_BUCKETS_A * LAB_BUCKETS_B;
          const baseA = Math.floor(rest / LAB_BUCKETS_B);
          const baseB = rest - baseA * LAB_BUCKETS_B;
          for (let dl = -1; dl <= 1; dl += 1) {
            const l = baseL + dl;
            if (l < 0 || l >= LAB_BUCKETS_L) continue;
            for (let da = -1; da <= 1; da += 1) {
              const a = baseA + da;
              if (a < 0 || a >= LAB_BUCKETS_A) continue;
              for (let db = -1; db <= 1; db += 1) {
                const b = baseB + db;
                if (b < 0 || b >= LAB_BUCKETS_B) continue;
                if (!dl && !da && !db) continue;
                const neighbor = l * LAB_BUCKETS_A * LAB_BUCKETS_B + a * LAB_BUCKETS_B + b;
                const weight =
                  (dl === 0 ? 1 : LAB_NEIGHBOR_WEIGHT[0]) *
                  (da === 0 ? 1 : LAB_NEIGHBOR_WEIGHT[1]) *
                  (db === 0 ? 1 : LAB_NEIGHBOR_WEIGHT[2]);
                score += emptySmooth * counts[neighbor] * weight;
              }
            }
          }
          if (score > bestScore || (score === bestScore && (best < 0 || key < best))) {
            best = key;
            bestScore = score;
          }
        }
        if (best < 0) {
          rgb = averageRegionRgb(data, sw, x0, x1, y0, y1, bg, adjust, transparentSource);
        } else {
          rgb = labToSrgb([
            sumL[best] / counts[best],
            sumA[best] / counts[best],
            sumB[best] / counts[best]
          ]);
        }
      }
      const cell = (gy * width + gx) * 4;
      out[cell] = rgb[0];
      out[cell + 1] = rgb[1];
      out[cell + 2] = rgb[2];
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
  adjust?: AdjustOptions,
  opts: DownsampleOpts = {}
): Uint8ClampedArray {
  return mode === 'dominant'
    ? downsampleDominantV2(image, width, height, bg, adjust, opts)
    : downsampleAverage(image, width, height, bg, adjust, opts);
}
