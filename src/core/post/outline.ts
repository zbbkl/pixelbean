import type { Pattern } from '../../types';
import { relativeLuminance } from '../color/srgb';
import type { LoadedPalette } from '../palette/types';

const NEW_OUTLINE_MAX_L = 25;
const NEW_OUTLINE_MAX_C = 60;

function lumaOf(palette: LoadedPalette, index: number): number {
  const rgb = palette.solids[index]?.rgb;
  return rgb ? relativeLuminance(rgb) : 1;
}

function backgroundLuma(pattern: Pattern): number {
  return pattern.options.bg === 'white' ? 1 : 0;
}

function pickOutline(
  pattern: Pattern,
  palette: LoadedPalette,
  used: Set<number>
): number {
  const usedCandidates = [...used].sort(
    (a, b) => palette.labs[a * 3] - palette.labs[b * 3] || a - b
  );
  const usedDarkest = usedCandidates[0];
  if (usedDarkest !== undefined && palette.labs[usedDarkest * 3] <= 30) {
    return usedDarkest;
  }

  let newCandidate = -1;
  let bestL = Number.POSITIVE_INFINITY;
  let bestC = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.solids.length; index += 1) {
    if (used.has(index)) continue;
    const L = palette.labs[index * 3];
    const C = Math.hypot(palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]);
    if (L <= NEW_OUTLINE_MAX_L && C <= NEW_OUTLINE_MAX_C) {
      if (L < bestL || (L === bestL && (C < bestC || (C === bestC && index < newCandidate)))) {
        newCandidate = index;
        bestL = L;
        bestC = C;
      }
    }
  }
  if (newCandidate >= 0) return newCandidate;
  return usedDarkest ?? 0;
}

/**
 * §9.4：给亮度交界加 1px 深色描边；空格 -1 保持空格，不新增到空行。
 */
export function outline(
  pattern: Pattern,
  palette: LoadedPalette,
  tau = 0.18
): Pattern {
  const used = new Set<number>();
  for (const cell of pattern.cells) if (cell >= 0) used.add(cell);
  if (used.size <= 1) return pattern;

  const outlineIndex = pickOutline(pattern, palette, used);
  const { width, height, cells } = pattern;
  const bg = backgroundLuma(pattern);
  const marked = new Uint8Array(cells.length);

  for (let i = 0; i < cells.length; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    const selfLuma = cells[i] >= 0 ? lumaOf(palette, cells[i]) : bg;
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1
    ];
    for (const next of neighbors) {
      const nextLuma = next < 0 || cells[next] < 0 ? bg : lumaOf(palette, cells[next]);
      if (Math.abs(selfLuma - nextLuma) > tau) {
        marked[i] = cells[i] >= 0 ? 1 : 0;
        break;
      }
    }
  }

  let changed = false;
  const result = new Int16Array(cells.length);
  for (let i = 0; i < cells.length; i += 1) {
    if (marked[i]) {
      result[i] = outlineIndex;
      changed = true;
    } else {
      result[i] = cells[i];
    }
  }
  return changed ? { ...pattern, cells: result } : pattern;
}
