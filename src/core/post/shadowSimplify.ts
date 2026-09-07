import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';
import { familyOf } from './clusterLimit';

const DARK_L = 45;
const GRAY_CHROMA = 8;
const DARK_C_NEUTRAL = 45;
const T_STD = 18;
const T_STRONG = 28;
const T_COLOR = 14;
const COLOR_SURPLUS_RATIO = 0.2;

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

/**
 * v1.2 暗部简化：近中性暗部（L<45、C<=45）按锚点收敛，标准档存活 ≤2 层、
 * 强档 ≤1 层；高彩度暗部只允许同色相族内的小份额收敛（docs/19 §3）。
 */
export function shadowSimplifyV2(
  pattern: Pattern,
  palette: LoadedPalette,
  level: 0 | 1 | 2,
  protect: Uint8Array | null = null
): Pattern {
  if (level === 0) return pattern;
  const counts = new Map<number, number>();
  for (const cell of pattern.cells) {
    if (cell >= 0) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  const used = [...counts.keys()];
  const poolA: number[] = [];
  const poolB: number[] = [];
  for (const index of used) {
    const L = palette.labs[index * 3];
    if (L >= DARK_L) continue;
    const C = Math.hypot(palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]);
    (C <= DARK_C_NEUTRAL ? poolA : poolB).push(index);
  }
  if (!poolA.length && !poolB.length) return pattern;

  const targets = new Map<number, number>();
  const threshold = level === 1 ? T_STD : T_STRONG;
  const allowLayers = level === 1 ? 2 : 1;
  poolA.sort((a, b) => palette.labs[a * 3] - palette.labs[b * 3] || a - b);
  const anchors: number[] = [];
  for (const color of poolA) {
    const anchorLab = labOf(palette, color);
    let best = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      const delta = ciede2000(anchorLab, labOf(palette, anchor));
      if (delta < bestDelta) {
        best = anchor;
        bestDelta = delta;
      }
    }
    if (best >= 0 && bestDelta <= threshold) {
      targets.set(color, best);
    } else if (anchors.length < allowLayers) {
      anchors.push(color);
    } else {
      targets.set(color, best >= 0 ? best : anchors[anchors.length - 1]);
    }
  }

  const families = familyOf(
    poolB.map((index) => {
      const a = palette.labs[index * 3 + 1];
      const b = palette.labs[index * 3 + 2];
      return {
        index,
        L: palette.labs[index * 3],
        C: Math.hypot(a, b),
        hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
      };
    })
  );
  for (const family of families) {
    let main = family[0];
    for (const index of family) {
      const count = counts.get(index) ?? 0;
      const mainCount = counts.get(main) ?? 1;
      if (count > mainCount || (count === mainCount && index < main)) main = index;
    }
    for (const color of family) {
      if (color === main) continue;
      const count = counts.get(color) ?? 0;
      const mainCount = counts.get(main) ?? 1;
      if (
        count < mainCount * COLOR_SURPLUS_RATIO &&
        ciede2000(labOf(palette, color), labOf(palette, main)) <= T_COLOR
      ) {
        targets.set(color, main);
      }
    }
  }
  if (!targets.size) return pattern;

  if (protect) {
    for (let i = 0; i < pattern.cells.length; i += 1) {
      if (protect[i] !== 1) continue;
      const color = pattern.cells[i];
      if (color < 0) continue;
      const target = targets.get(color);
      if (target === undefined) continue;
      if (poolA.includes(color) && ciede2000(labOf(palette, color), labOf(palette, target)) > threshold) {
        targets.delete(color);
      }
    }
  }

  const cells = new Int16Array(pattern.cells.length);
  let changed = false;
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const cell = pattern.cells[i];
    const target = cell >= 0 ? targets.get(cell) : undefined;
    cells[i] = target === undefined ? cell : target;
    if (target !== undefined) changed = true;
  }
  return changed ? { ...pattern, cells } : pattern;
}
