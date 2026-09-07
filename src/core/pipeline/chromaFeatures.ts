import { srgbRgbToLab } from '../color/lab';
import { linearRgbToSrgbByte, srgbByteToLinear } from '../color/srgb';

export const CHROMA_HUE_GAP = 25;
export const CHROMA_DC_MIN = 0.12;
export const CHROMA_DOT_MIN = 0.1;
export const CHROMA_DOT_MIN_TOTAL = 3;

export interface ChromaPixel {
  x: number;
  row: number;
  r: number;
  g: number;
  b: number;
}

export interface ChromaCandidate {
  kind: 'dot' | 'vline' | 'hline';
  meanF: [number, number, number];
  meanM: [number, number, number];
  deltaY: number;
  chroma: true;
}

interface LabInfo {
  pixel: ChromaPixel;
  C: number;
  hue: number;
}

function meanRgbOf(pixels: ChromaPixel[]): [number, number, number] {
  let linR = 0;
  let linG = 0;
  let linB = 0;
  for (const pixel of pixels) {
    linR += srgbByteToLinear(pixel.r);
    linG += srgbByteToLinear(pixel.g);
    linB += srgbByteToLinear(pixel.b);
  }
  return linearRgbToSrgbByte([
    linR / Math.max(1, pixels.length),
    linG / Math.max(1, pixels.length),
    linB / Math.max(1, pixels.length)
  ]);
}

function shapeKind(
  pixels: ChromaPixel[],
  regionW: number,
  regionH: number
): 'dot' | 'vline' | 'hline' | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pixel of pixels) {
    minX = Math.min(minX, pixel.x);
    maxX = Math.max(maxX, pixel.x);
    minY = Math.min(minY, pixel.row);
    maxY = Math.max(maxY, pixel.row);
  }
  const fracW = (maxX - minX + 1) / regionW;
  const fracH = (maxY - minY + 1) / regionH;
  if (fracW <= 0.35 && fracH <= 0.35) return 'dot';
  if (fracW <= 0.35 && fracH > 0.35) return 'vline';
  if (fracW > 0.35 && fracH <= 0.35) return 'hline';
  return null;
}

function circularHueGap(a: number, b: number): number {
  return (b - a + 360) % 360;
}

/**
 * v1.2-final E2：彩度小特征（低饱和小点/细线）。亮度双类失败的格
 * 在此按彩度离群簇识别，产出 dot/vline/hline 候选。
 */
export function classifyChromaFeature(
  pixels: ChromaPixel[],
  regionW: number,
  regionH: number
): ChromaCandidate | null {
  if (pixels.length < 8 || regionW <= 0 || regionH <= 0) return null;
  const infos: LabInfo[] = [];
  let colored: LabInfo[] = [];
  let lowChroma: LabInfo[] = [];
  for (const pixel of pixels) {
    const lab = srgbRgbToLab([pixel.r, pixel.g, pixel.b]);
    const C = Math.hypot(lab[1], lab[2]) / 128;
    const hue = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
    const info = { pixel, C, hue };
    infos.push(info);
    (C >= CHROMA_DOT_MIN ? colored : lowChroma).push(info);
  }
  if (!colored.length) return null;

  let small: LabInfo[] | null = null;
  let big: LabInfo[] | null = null;
  const coloredShare = colored.length / pixels.length;
  if (coloredShare >= 0.02 && coloredShare <= 0.45) {
    small = colored;
    big = lowChroma;
  } else if (coloredShare > 0.45 && coloredShare < 1) {
    return null; // 大块为彩色时低彩度小片并非本通道要保留的特征
  } else {
    const sorted = [...colored].sort((a, b) => a.hue - b.hue);
    const n = sorted.length;
    let largest = -1;
    let splitAt = 0;
    for (let i = 0; i < n; i += 1) {
      const gap = circularHueGap(sorted[i].hue, sorted[(i + 1) % n].hue);
      if (gap > largest) {
        largest = gap;
        splitAt = (i + 1) % n;
      }
    }
    if (largest <= CHROMA_HUE_GAP) return null;
    const reordered = [...sorted.slice(splitAt), ...sorted.slice(0, splitAt)];
    const first = reordered.slice(0, Math.floor(n / 2));
    const second = reordered.slice(Math.floor(n / 2));
    if (first.length && second.length) {
      small = first.length <= second.length ? first : second;
      big = small === first ? second : first;
    }
  }
  if (!small || !big) return null;

  const meanC = (group: LabInfo[]) =>
    group.reduce((sum, info) => sum + info.C, 0) / group.length;
  const dC = Math.abs(meanC(small) - meanC(big));
  const hueOf = (group: LabInfo[]) =>
    group.reduce((sum, info) => sum + info.hue, 0) / group.length;
  const hueGap = circularHueGap(hueOf(big), hueOf(small));
  const qualifies =
    dC >= CHROMA_DC_MIN ||
    (meanC(small) >= CHROMA_DOT_MIN && hueGap >= CHROMA_HUE_GAP);
  if (!qualifies) return null;

  const smallPixels = small.map((info) => info.pixel);
  const kind = shapeKind(smallPixels, regionW, regionH);
  if (!kind) return null;
  return {
    kind,
    meanF: meanRgbOf(smallPixels),
    meanM: meanRgbOf(big.map((info) => info.pixel)),
    deltaY: 0,
    chroma: true
  };
}
