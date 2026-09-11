import type { AdjustOptions, BgMode, CellImage, DownsampleMode } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import { srgbRgbToLab } from '../color/lab';
import { adjustRgb } from '../color/adjust';
import { linearRgbToSrgbByte, srgbByteToLinear } from '../color/srgb';
import { downsample, type DownsampleOpts } from './downsample';
import { classifyChromaFeature, CHROMA_DOT_MIN_TOTAL } from './chromaFeatures';

export const FEATURE_REGION_MIN_PX = 8;
export const FEATURE_CONTRAST_MIN = 0.1;
export const FEATURE_SHARE_MIN = 0.02;
export const FEATURE_SHARE_MAX = 0.5;
export const FEATURE_SHAPE_FRAC = 0.35;
export const FEATURE_LINE_DE = 12;
export const FEATURE_DOT_DE = 12;
export const FEATURE_DOT_MIN_TOTAL = 4;
export const FEATURE_DOT_CONTRAST_MIN = 0.35;
export const BOUNDARY_DE_Y = 0.15;
export const BOUNDARY_SHARE_MIN = 0.3;
export const BOUNDARY_MARGIN = 3;
export const SOFT_MIN_Y = 0.03;
export const SOFT_MARGIN = 2;

export interface FeatureOptions {
  enabled: boolean;
}

export interface FeaturesResult {
  cells: Uint8ClampedArray;
  protect: Uint8Array;
}

interface Pixel {
  x: number;
  row: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

type FeatureKind = 'dot' | 'vline' | 'hline' | 'boundary' | 'soft';

interface CellCandidate {
  kind: FeatureKind;
  meanF: [number, number, number];
  meanM?: [number, number, number];
  deltaY: number;
  chroma?: boolean;
}

function meanRgbOf(pixels: Pixel[]): [number, number, number] {
  let linR = 0;
  let linG = 0;
  let linB = 0;
  for (const pixel of pixels) {
    linR += srgbByteToLinear(pixel.r);
    linG += srgbByteToLinear(pixel.g);
    linB += srgbByteToLinear(pixel.b);
  }
  return linearRgbToSrgbByte([
    linR / pixels.length,
    linG / pixels.length,
    linB / pixels.length
  ]);
}

function meanRgbTuples(colors: [number, number, number][]): [number, number, number] {
  let linR = 0;
  let linG = 0;
  let linB = 0;
  for (const color of colors) {
    linR += srgbByteToLinear(color[0]);
    linG += srgbByteToLinear(color[1]);
    linB += srgbByteToLinear(color[2]);
  }
  return linearRgbToSrgbByte([
    linR / colors.length,
    linG / colors.length,
    linB / colors.length
  ]);
}

function regionRgb(
  data: Uint8ClampedArray,
  offset: number,
  bg: BgMode,
  adjust?: AdjustOptions,
  transparentSource = false
): [number, number, number] {
  const alpha = data[offset + 3];
  if (transparentSource && alpha > 0 && alpha < 255) {
    const raw: [number, number, number] = [data[offset], data[offset + 1], data[offset + 2]];
    return adjust ? adjustRgb(raw, adjust) : raw;
  }
  if (alpha <= 0) return bg === 'white' ? [255, 255, 255] : [0, 0, 0];
  const raw: [number, number, number] = [data[offset], data[offset + 1], data[offset + 2]];
  let rgb: [number, number, number];
  if (alpha >= 128) {
    rgb = raw;
  } else {
    const back = bg === 'white' ? 255 : 0;
    const t = alpha / 255;
    rgb = [
      Math.round(raw[0] * t + back * (1 - t)),
      Math.round(raw[1] * t + back * (1 - t)),
      Math.round(raw[2] * t + back * (1 - t))
    ];
  }
  return adjust ? adjustRgb(rgb, adjust) : rgb;
}

function classifyRegion(
  pixels: Pixel[],
  regionW: number,
  regionH: number
): CellCandidate | null {
  if (pixels.length < FEATURE_REGION_MIN_PX || regionW <= 0 || regionH <= 0) return null;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const pixel of pixels) {
    yMin = Math.min(yMin, pixel.y);
    yMax = Math.max(yMax, pixel.y);
  }
  if (yMax - yMin < SOFT_MIN_Y) return null;
  let threshold = (yMin + yMax) / 2;
  for (let round = 0; round < 2; round += 1) {
    const low: Pixel[] = [];
    const high: Pixel[] = [];
    for (const pixel of pixels) (pixel.y <= threshold ? low : high).push(pixel);
    if (!low.length || !high.length) return null;
    const meanLow = low.reduce((sum, pixel) => sum + pixel.y, 0) / low.length;
    const meanHigh = high.reduce((sum, pixel) => sum + pixel.y, 0) / high.length;
    threshold = (meanLow + meanHigh) / 2;
  }

  const feature = pixels.filter((pixel) => pixel.y <= threshold);
  const body = pixels.filter((pixel) => pixel.y > threshold);
  if (!feature.length || !body.length) return null;
  const featureIsSmall = feature.length <= body.length;
  const smallSide = featureIsSmall ? feature : body;
  const otherSide = featureIsSmall ? body : feature;
  const deltaY = Math.abs(
    smallSide.reduce((sum, pixel) => sum + pixel.y, 0) / smallSide.length -
    otherSide.reduce((sum, pixel) => sum + pixel.y, 0) / otherSide.length
  );
  if (deltaY < FEATURE_CONTRAST_MIN) return null;
  const share = smallSide.length / pixels.length;
  if (share < FEATURE_SHARE_MIN || share > FEATURE_SHARE_MAX) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pixel of smallSide) {
    minX = Math.min(minX, pixel.x);
    maxX = Math.max(maxX, pixel.x);
    minY = Math.min(minY, pixel.row);
    maxY = Math.max(maxY, pixel.row);
  }
  const meanF = meanRgbOf(smallSide);
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const fracW = bw / regionW;
  const fracH = bh / regionH;
  const shapeBlock = fracW > FEATURE_SHAPE_FRAC && fracH > FEATURE_SHAPE_FRAC;
  if (deltaY < FEATURE_CONTRAST_MIN) {
    if (share >= BOUNDARY_SHARE_MIN && shapeBlock) {
      return { kind: 'soft', meanF, meanM: meanRgbOf(otherSide), deltaY };
    }
    return null;
  }
  if (fracW <= FEATURE_SHAPE_FRAC && fracH <= FEATURE_SHAPE_FRAC) return { kind: 'dot', meanF, deltaY };
  if (fracW <= FEATURE_SHAPE_FRAC && fracH > FEATURE_SHAPE_FRAC) return { kind: 'vline', meanF, deltaY };
  if (fracW > FEATURE_SHAPE_FRAC && fracH <= FEATURE_SHAPE_FRAC) return { kind: 'hline', meanF, deltaY };
  if (share >= BOUNDARY_SHARE_MIN && shapeBlock) {
    if (deltaY >= BOUNDARY_DE_Y) {
      return { kind: 'boundary', meanF, meanM: meanRgbOf(otherSide), deltaY };
    }
    return { kind: 'soft', meanF, meanM: meanRgbOf(otherSide), deltaY };
  }
  return null;
}

function cellLab(rgb: [number, number, number]): [number, number, number] {
  return srgbRgbToLab(rgb);
}

function deltaBetween(
  a: [number, number, number] | undefined,
  b: [number, number, number]
): number | null {
  if (!a) return null;
  return ciede2000(cellLab(a), cellLab(b));
}

export function downsampleWithFeatures(
  image: CellImage,
  width: number,
  height: number,
  mode: DownsampleMode,
  bg: BgMode,
  adjust?: AdjustOptions,
  opts: DownsampleOpts = {}
): FeaturesResult {
  const transparentSource = opts.transparentSource === true;
  const cells = downsample(image, width, height, mode, bg, adjust, opts);
  const protect = new Uint8Array(width * height);
  const { width: sw, height: sh, data } = image;
  const candidates = new Array<CellCandidate | null>(width * height);

  for (let gy = 0; gy < height; gy += 1) {
    const y0 = Math.floor((gy * sh) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sh) / height));
    for (let gx = 0; gx < width; gx += 1) {
      const x0 = Math.floor((gx * sw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / width));
      const pixels: Pixel[] = [];
      for (let y = y0; y < y1; y += 1) {
        const row = y * sw * 4;
        for (let x = x0; x < x1; x += 1) {
          const offset = row + x * 4;
          if (transparentSource && data[offset + 3] <= 0) continue;
          const rgb = regionRgb(data, offset, bg, adjust, transparentSource);
          pixels.push({
            x: x - x0,
            row: y - y0,
            y:
              0.2126 * srgbByteToLinear(rgb[0]) +
              0.7152 * srgbByteToLinear(rgb[1]) +
              0.0722 * srgbByteToLinear(rgb[2]),
            r: rgb[0],
            g: rgb[1],
            b: rgb[2]
          });
        }
      }
      const index = gy * width + gx;
      candidates[index] =
        classifyRegion(pixels, x1 - x0, y1 - y0) ??
        classifyChromaFeature(pixels, x1 - x0, y1 - y0);
    }
  }

  const cap = Math.max(24, Math.round(width * height * 0.02));
  let written = 0;
  const writeFeature = (index: number, rgb: [number, number, number]) => {
    if (written >= cap) return;
    const offset = index * 4;
    cells[offset] = rgb[0];
    cells[offset + 1] = rgb[1];
    cells[offset + 2] = rgb[2];
    cells[offset + 3] = 255;
    protect[index] = 1;
    written += 1;
  };

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate || (candidate.kind !== 'vline' && candidate.kind !== 'hline')) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = candidate.kind === 'vline'
      ? [index - width, index + width]
      : [index - 1, index + 1];
    for (const nextIndex of neighbors) {
      if (x === 0 && candidate.kind === 'hline' && nextIndex === index - 1) continue;
      if (x === width - 1 && candidate.kind === 'hline' && nextIndex === index + 1) continue;
      if (y === 0 && candidate.kind === 'vline' && nextIndex === index - width) continue;
      if (y === height - 1 && candidate.kind === 'vline' && nextIndex === index + width) continue;
      const next = candidates[nextIndex];
      let delta: number | null;
      if (next && next.kind === candidate.kind) {
        delta = deltaBetween(next.meanF, candidate.meanF);
      } else if (!next) {
        const offset = nextIndex * 4;
        delta = deltaBetween(
          [cells[offset], cells[offset + 1], cells[offset + 2]] as [number, number, number],
          candidate.meanF
        );
      } else {
        continue;
      }
      if (delta !== null && delta <= FEATURE_LINE_DE) {
        writeFeature(index, candidate.meanF);
        break;
      }
    }
  }

  const dotClusters: { anchor: [number, number, number]; members: number[]; chroma: boolean }[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate || candidate.kind !== 'dot') continue;
    if (!candidate.chroma && candidate.deltaY < FEATURE_DOT_CONTRAST_MIN) continue;
    let nearest = -1;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let clusterIndex = 0; clusterIndex < dotClusters.length; clusterIndex += 1) {
      const delta = deltaBetween(dotClusters[clusterIndex].anchor, candidate.meanF);
      if (delta !== null && delta < nearestDelta) {
        nearest = clusterIndex;
        nearestDelta = delta;
      }
    }
    if (nearest >= 0 && nearestDelta <= FEATURE_DOT_DE) {
      dotClusters[nearest].members.push(index);
    } else {
      dotClusters.push({ anchor: candidate.meanF, members: [index], chroma: candidate.chroma === true });
    }
  }

  for (const cluster of dotClusters) {
    const minTotal = cluster.chroma ? CHROMA_DOT_MIN_TOTAL : FEATURE_DOT_MIN_TOTAL;
    if (cluster.members.length < minTotal) continue;
    const meanF = meanRgbTuples(
      cluster.members
        .map((index) => candidates[index]?.meanF)
        .filter((value): value is [number, number, number] => value !== undefined)
    );
    for (const index of cluster.members) {
      writeFeature(index, meanF);
    }
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate || (candidate.kind !== 'boundary' && candidate.kind !== 'soft') || !candidate.meanM) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const neighborIndices = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1
    ];
    let dF = 0;
    let dM = 0;
    let n = 0;
    for (const nextIndex of neighborIndices) {
      if (nextIndex < 0) continue;
      const offset = nextIndex * 4;
      const rgb: [number, number, number] = [
        cells[offset],
        cells[offset + 1],
        cells[offset + 2]
      ];
      const fDelta = deltaBetween(rgb, candidate.meanF);
      const mDelta = deltaBetween(rgb, candidate.meanM);
      if (fDelta === null || mDelta === null) continue;
      dF += fDelta;
      dM += mDelta;
      n += 1;
    }
    if (!n) continue;
    dF /= n;
    dM /= n;
    const margin = candidate.kind === 'soft' ? SOFT_MARGIN : BOUNDARY_MARGIN;
    const offset = index * 4;
    if (dF + margin <= dM) {
      cells[offset] = candidate.meanF[0];
      cells[offset + 1] = candidate.meanF[1];
      cells[offset + 2] = candidate.meanF[2];
      cells[offset + 3] = 255;
    } else if (dM + margin <= dF) {
      cells[offset] = candidate.meanM[0];
      cells[offset + 1] = candidate.meanM[1];
      cells[offset + 2] = candidate.meanM[2];
      cells[offset + 3] = 255;
    }
  }

  return { cells, protect };
}

/** 与 placeContain 同式地把内容掩码搬到方形底板（空白区保持 0）。 */
export function placeProtectMask(
  mask: Uint8Array | null,
  contentW: number,
  contentH: number,
  boardW: number,
  boardH: number
): Uint8Array | null {
  if (!mask) return null;
  const out = new Uint8Array(boardW * boardH);
  const ox = Math.max(0, Math.floor((boardW - contentW) / 2));
  const oy = Math.max(0, Math.floor((boardH - contentH) / 2));
  for (let y = 0; y < contentH; y += 1) {
    if (oy + y >= boardH) break;
    for (let x = 0; x < contentW; x += 1) {
      if (ox + x >= boardW) break;
      out[(oy + y) * boardW + ox + x] = mask[y * contentW + x];
    }
  }
  return out;
}
