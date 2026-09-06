import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';

const GRAY_CHROMA = 8;
const HUE_GAP = 20;
const MAX_FAMILY_LAYERS = 3;

interface UsedColor {
  index: number;
  count: number;
  L: number;
  C: number;
  hue: number;
}

function labOf(palette: LoadedPalette, index: number): [number, number, number] {
  return [palette.labs[index * 3], palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]];
}

function collectUsed(pattern: Pattern, palette: LoadedPalette): Map<number, number> {
  const counts = new Map<number, number>();
  for (const cell of pattern.cells) {
    if (cell < 0) continue;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return counts;
}

function usedColors(counts: Map<number, number>, palette: LoadedPalette): UsedColor[] {
  return [...counts.entries()].map(([index, count]) => {
    const a = palette.labs[index * 3 + 1];
    const b = palette.labs[index * 3 + 2];
    const C = Math.hypot(a, b);
    return {
      index,
      count,
      L: palette.labs[index * 3],
      C,
      hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    };
  });
}

function angleDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

function familyOf(colors: UsedColor[], palette: LoadedPalette): number[][] {
  const sorted = [...colors].sort((a, b) => a.hue - b.hue || a.index - b.index);
  const n = sorted.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    const a = sorted[i];
    const b = sorted[next];
    if (a.C > GRAY_CHROMA && b.C > GRAY_CHROMA && angleDistance(a.hue, b.hue) <= HUE_GAP) {
      union(i, next);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(sorted[i].index);
    groups.set(root, list);
  }
  return [...groups.values()];
}

function representativesForFamily(
  family: number[],
  counts: Map<number, number>,
  palette: LoadedPalette,
  familyUsage: number,
  total: number,
  K: number
): number[] {
  const sorted = [...family].sort((a, b) => palette.labs[a * 3] - palette.labs[b * 3] || a - b);
  const usageQuota = Math.max(1, Math.round((familyUsage / total) * K));
  const layerLimit = Math.min(usageQuota, MAX_FAMILY_LAYERS, sorted.length);
  if (layerLimit === sorted.length) return sorted;
  if (layerLimit === 1) {
    let best = sorted[0];
    let bestCount = -1;
    for (const index of sorted) {
      const count = counts.get(index) ?? 0;
      if (count > bestCount || (count === bestCount && index < best)) {
        best = index;
        bestCount = count;
      }
    }
    return [best];
  }

  const result = new Set<number>();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  result.add(first);
  result.add(last);
  const n = sorted.length;
  const extra = layerLimit - 2;
  if (extra > 0) {
    for (let slot = 1; slot <= extra; slot += 1) {
      const target = (slot * (n - 1)) / (extra + 1);
      let chosen = -1;
      let chosenDelta = Number.POSITIVE_INFINITY;
      for (const index of sorted) {
        if (result.has(index)) continue;
        const pos = sorted.indexOf(index);
        const delta = Math.abs(pos - target);
        if (delta < chosenDelta || (delta === chosenDelta && index < chosen)) {
          chosen = index;
          chosenDelta = delta;
        }
      }
      if (chosen >= 0) result.add(chosen);
    }
  }
  return [...result];
}

function protectedIndices(used: UsedColor[]): Set<number> {
  const result = new Set<number>();
  if (!used.length) return result;
  let dark = used[0];
  let bright = used[0];
  let saturated = used[0];
  for (const color of used) {
    if (color.L < dark.L) dark = color;
    if (color.L > bright.L) bright = color;
    if (color.C > saturated.C || (color.C === saturated.C && color.index < saturated.index)) saturated = color;
  }
  result.add(dark.index);
  result.add(bright.index);
  result.add(saturated.index);
  return result;
}

function nearestInSet(lab: [number, number, number], final: Set<number>, palette: LoadedPalette): number {
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const index of final) {
    const delta = ciede2000(lab, labOf(palette, index));
    if (delta < bestDelta || (delta === bestDelta && index < best)) {
      best = index;
      bestDelta = delta;
    }
  }
  return best;
}

function removeUntilLimit(final: Set<number>, protectedSet: Set<number>, K: number, palette: LoadedPalette): Set<number> {
  while (final.size > K) {
    let remove = -1;
    let removeCost = Number.POSITIVE_INFINITY;
    for (const index of final) {
      if (protectedSet.has(index)) continue;
      let cost = Number.POSITIVE_INFINITY;
      for (const other of final) {
        if (other === index) continue;
        const delta = ciede2000(labOf(palette, index), labOf(palette, other));
        if (delta < cost) cost = delta;
      }
      if (cost < removeCost || (cost === removeCost && index < remove)) {
        remove = index;
        removeCost = cost;
      }
    }
    if (remove < 0) break;
    final.delete(remove);
  }
  return final;
}

/**
 * §9.3 智能限色：按色相族聚类、族内 ≤3 层，再做全局压缩到 K；可保护最暗/最亮/最饱和。
 */
export function clusterLimit(pattern: Pattern, palette: LoadedPalette, K: number, protect = true): Pattern {
  const counts = collectUsed(pattern, palette);
  if (K <= 0 || counts.size <= K) return pattern;
  const used = usedColors(counts, palette);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const groups = familyOf(used, palette);

  let final = new Set<number>();
  for (const group of groups) {
    const familyUsage = group.reduce((sum, index) => sum + (counts.get(index) ?? 0), 0);
    for (const representative of representativesForFamily(group, counts, palette, familyUsage, total, K)) {
      final.add(representative);
    }
  }

  const protectedSet = protect ? protectedIndices(used) : new Set<number>();
  for (const index of protectedSet) final.add(index);
  final = removeUntilLimit(final, protectedSet, K, palette);

  const cells = new Int16Array(pattern.cells.length);
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const cell = pattern.cells[i];
    if (cell < 0 || final.has(cell)) {
      cells[i] = cell;
    } else {
      cells[i] = nearestInSet(labOf(palette, cell), final, palette);
    }
  }

  return {
    ...pattern,
    cells,
    options: { ...pattern.options, maxColors: K }
  };
}
