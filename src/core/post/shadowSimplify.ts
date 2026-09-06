import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';

const DARK_L = 45;
const GRAY_CHROMA = 8;

function usedIndices(pattern: Pattern): number[] {
  const used = new Set<number>();
  for (const cell of pattern.cells) if (cell >= 0) used.add(cell);
  return [...used].sort((a, b) => a - b);
}

function labOf(palette: LoadedPalette, index: number): [number, number, number] {
  return [palette.labs[index * 3], palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]];
}

function pickAnchor(palette: LoadedPalette, used: number[]): number | null {
  const sortedByL = [...used].sort((a, b) => palette.labs[a * 3] - palette.labs[b * 3] || a - b);
  const darkest = sortedByL[0];
  if (darkest === undefined || palette.labs[darkest * 3] >= DARK_L) return null;
  const chroma = Math.hypot(palette.labs[darkest * 3 + 1], palette.labs[darkest * 3 + 2]);
  if (chroma < GRAY_CHROMA) return darkest;

  let best = -1;
  let bestC = Number.POSITIVE_INFINITY;
  for (const index of used) {
    const L = palette.labs[index * 3];
    if (L >= DARK_L) continue;
    const C = Math.hypot(palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]);
    if (C < bestC || (C === bestC && index < best)) {
      best = index;
      bestC = C;
    }
  }
  return best >= 0 ? best : null;
}

/**
 * §9.2：把接近统一暗部锚点的灰/棕暗部并入锚点；彩色暗部因 ΔE 远而保留。
 * level=1 阈值 18，level=2 阈值 28；level=0 恒等。
 */
export function shadowSimplify(pattern: Pattern, palette: LoadedPalette, level: 0 | 1 | 2): Pattern {
  if (level === 0) return pattern;
  const used = usedIndices(pattern);
  const anchor = pickAnchor(palette, used);
  if (anchor === null) return pattern;
  const threshold = level === 1 ? 18 : 28;
  const anchorLab = labOf(palette, anchor);
  const targets = new Set<number>();

  for (const index of used) {
    if (index === anchor) continue;
    const L = palette.labs[index * 3];
    if (L >= DARK_L) continue;
    if (ciede2000(labOf(palette, index), anchorLab) <= threshold) targets.add(index);
  }
  if (!targets.size) return pattern;

  const cells = new Int16Array(pattern.cells.length);
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const cell = pattern.cells[i];
    cells[i] = cell >= 0 && targets.has(cell) ? anchor : cell;
  }
  return { ...pattern, cells };
}
