import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';

export const REGION_DE = 8;
export const REGION_MIN_SAME = 3;

function labOf(palette: LoadedPalette, index: number): [number, number, number] {
  return [palette.labs[index * 3], palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]];
}

/**
 * v1.2.1 可选“区域一致性多数修正”：把区域内部被 3 个同色邻格包围、
 * 且与邻格 ΔE≤deThr 的零星错色并入邻格；单遍、不迭代、不动 protect/空格。
 * 默认不进入任何模式预设，仅作为可编程后处理供效果对照使用。
 */
export function regionClean(
  pattern: Pattern,
  palette: LoadedPalette,
  protect: Uint8Array | null = null,
  deThr = REGION_DE,
  minSame = REGION_MIN_SAME
): Pattern {
  const { width, height, cells } = pattern;
  const out = new Int16Array(cells.length);
  let changed = false;
  for (let i = 0; i < cells.length; i += 1) {
    const current = cells[i];
    if (current < 0 || protect?.[i] === 1) {
      out[i] = current;
      continue;
    }
    const x = i % width;
    const y = Math.floor(i / width);
    const counts = new Map<number, number>();
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1
    ];
    for (const next of neighbors) {
      if (next < 0) continue;
      const color = cells[next];
      if (color < 0 || color === current) continue;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    let best = -1;
    let bestCount = 0;
    for (const [color, count] of counts) {
      if (count > bestCount || (count === bestCount && color < best)) {
        best = color;
        bestCount = count;
      }
    }
    if (best >= 0 && bestCount >= minSame &&
        ciede2000(labOf(palette, current), labOf(palette, best)) <= deThr) {
      out[i] = best;
      changed = true;
    } else {
      out[i] = current;
    }
  }
  return changed ? { ...pattern, cells: out } : pattern;
}
