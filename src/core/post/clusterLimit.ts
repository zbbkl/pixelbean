import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';

const GRAY_CHROMA = 8;
const HUE_GAP = 20;
const MAX_FAMILY_LAYERS = 3;
// 偏差记录（docs/11）：docs/03 §9.3 只写"相邻 hue 差 ≤20°"；实现额外约束
// "同族跨度 ≤60°"，避免一族横跨过大色相范围，确保"黄色系 ≤3 层"可稳定达成。
const MAX_FAMILY_SPAN = 60;

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

function familyOf(colors: UsedColor[], palette: LoadedPalette): number[][] {
  const sorted = [...colors].sort((a, b) => a.hue - b.hue || a.index - b.index);
  const n = sorted.length;
  if (!n) return [];
  let start = 0;
  let largestGap = -1;
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    const gap = (sorted[next].hue - sorted[i].hue + 360) % 360;
    if (gap > largestGap) {
      largestGap = gap;
      start = next;
    }
  }

  const groups: number[][] = [];
  let current: number[] = [];
  let span = 0;
  let previous = -1;
  for (let step = 0; step < n; step += 1) {
    const color = sorted[(start + step) % n];
    const canMerge =
      current.length > 0 &&
      color.C > GRAY_CHROMA &&
      sorted[(start + step - 1 + n) % n].C > GRAY_CHROMA;
    const delta = previous >= 0 ? (color.hue - previous + 360) % 360 : 0;
    if (canMerge && delta <= HUE_GAP && span + delta <= MAX_FAMILY_SPAN) {
      current.push(color.index);
      span += delta;
    } else {
      if (current.length) groups.push(current);
      current = [color.index];
      span = 0;
    }
    previous = color.hue;
  }
  if (current.length) groups.push(current);
  return groups;
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

function protectedIndices(used: UsedColor[]): { set: Set<number>; ordered: number[] } {
  const set = new Set<number>();
  if (!used.length) return { set, ordered: [] };
  let dark = used[0];
  let bright = used[0];
  let saturated = used[0];
  for (const color of used) {
    if (color.L < dark.L) dark = color;
    if (color.L > bright.L) bright = color;
    if (color.C > saturated.C || (color.C === saturated.C && color.index < saturated.index)) saturated = color;
  }
  // 重要性递减：暗 > 亮 > 饱和（在 K 过小时按此顺序舍弃）
  const ordered = [dark.index];
  set.add(dark.index);
  if (bright.index !== dark.index) {
    ordered.push(bright.index);
    set.add(bright.index);
  }
  if (saturated.index !== dark.index && saturated.index !== bright.index) {
    ordered.push(saturated.index);
    set.add(saturated.index);
  }
  return { set, ordered };
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

function removeUntilLimit(
  final: Set<number>,
  protectedSet: Set<number>,
  protectedOrder: number[],
  K: number,
  palette: LoadedPalette
): Set<number> {
  while (final.size > K) {
    let remove = -1;
    let removeCost = Number.POSITIVE_INFINITY;
    // 1) 优先删除非保护色（与自身 ΔE2000 最近者，最不伤色彩结构）
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
    // 2) 兜底：K 过小（< 保护色数量）时，按"饱和 → 亮 → 暗"顺序舍弃保护色，保证 ≤K
    if (remove < 0) {
      for (let i = protectedOrder.length - 1; i >= 0; i -= 1) {
        const index = protectedOrder[i];
        if (final.has(index)) {
          remove = index;
          break;
        }
      }
    }
    if (remove < 0) break;
    final.delete(remove);
  }
  return final;
}

function keepFamilyLayerLimit(
  final: Set<number>,
  families: number[][],
  protectedSet: Set<number>,
  palette: LoadedPalette
): Set<number> {
  for (const family of families) {
    const members = new Set(family);
    const present = [...final].filter((index) => members.has(index));
    while (present.length > MAX_FAMILY_LAYERS) {
      let remove = -1;
      let removeCost = Number.POSITIVE_INFINITY;
      for (const index of present) {
        if (protectedSet.has(index)) continue;
        let cost = Number.POSITIVE_INFINITY;
        for (const other of present) {
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
      present.splice(present.indexOf(remove), 1);
    }
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

  const protection = protect ? protectedIndices(used) : { set: new Set<number>(), ordered: [] as number[] };
  const protectedSet = protection.set;
  for (const index of protectedSet) final.add(index);
  final = keepFamilyLayerLimit(final, groups, protectedSet, palette);
  final = removeUntilLimit(final, protectedSet, protection.ordered, K, palette);

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
