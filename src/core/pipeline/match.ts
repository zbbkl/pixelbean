import type { CellImage, ConvertOptions, Pattern } from '../../types';
import { ciede2000, ciede76 } from '../color/ciede2000';
import { srgbRgbToLab } from '../color/lab';
import type { LoadedPalette } from '../palette/types';

export interface MatchDetails {
  /** 每个格子的 Lab，长 = 格数 * 3。 */
  labs: Float64Array;
}

function makeContentOptions(options: ConvertOptions, width: number, height: number): ConvertOptions {
  return {
    ...options,
    width,
    height,
    contain: undefined
  };
}

function nearestPaletteCandidates(
  lab: readonly [number, number, number],
  labs: Float64Array,
  count: number,
  k = 8
): number[] {
  const best = new Array<number>(k).fill(Number.POSITIVE_INFINITY);
  const bestIdx = new Array<number>(k).fill(0);
  for (let i = 0; i < count; i += 1) {
    const d = ciede76(lab, [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]]);
    if (d < best[k - 1]) {
      let j = k - 1;
      while (j > 0 && d < best[j - 1]) j -= 1;
      if (d < best[j]) {
        best.splice(j, 0, d);
        bestIdx.splice(j, 0, i);
        best.length = k;
        bestIdx.length = k;
      }
    }
  }
  return bestIdx;
}

export function nearestPaletteIndex(lab: readonly [number, number, number], palette: LoadedPalette): number {
  const candidates = nearestPaletteCandidates(lab, palette.labs, palette.solids.length);
  let best = candidates[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const lab2 = palette.labs.subarray(index * 3, index * 3 + 3) as unknown as [number, number, number];
    const delta = ciede2000(lab, lab2);
    if (delta < bestDelta || (delta === bestDelta && index < best)) {
      best = index;
      bestDelta = delta;
    }
  }
  return best;
}

export function matchGridDetailed(
  image: CellImage,
  palette: LoadedPalette,
  options: ConvertOptions
): { pattern: Pattern; details: MatchDetails } {
  const width = image.width;
  const height = image.height;
  const cells = new Int16Array(width * height);
  const labs = new Float64Array(width * height * 3);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    const rgb: [number, number, number] = [
      image.data[offset],
      image.data[offset + 1],
      image.data[offset + 2]
    ];
    const lab = srgbRgbToLab(rgb);
    labs[i * 3] = lab[0];
    labs[i * 3 + 1] = lab[1];
    labs[i * 3 + 2] = lab[2];
    cells[i] = nearestPaletteIndex(lab, palette);
  }

  return {
    pattern: {
      paletteId: options.paletteId,
      width,
      height,
      cells,
      codes: palette.codes,
      options: makeContentOptions(options, width, height)
    },
    details: { labs }
  };
}

export function matchGrid(
  image: CellImage,
  palette: LoadedPalette,
  options?: ConvertOptions
): Pattern {
  const base = options ?? {
    paletteId: palette.set.id,
    width: image.width,
    height: image.height,
    bg: 'white' as const,
    mode: 'average' as const,
    maxColors: null,
    dither: 'none' as const
  };
  return matchGridDetailed(image, palette, base).pattern;
}
