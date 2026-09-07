import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';
import { familyOf } from './clusterLimit';

const GRAY_CHROMA = 8;
const HUE_GAP = 20;
const MAX_FAMILY_SPAN = 60;
const MAX_FAMILY_LAYERS = 3;
const DUPE_DE = 2;
const MARGINAL_SHARE = 0.002;
const MARGINAL_DE = 24;
const MAIN_SHARE = 0.05;

interface Counted {
  index: number;
  count: number;
}

interface HueColor {
  index: number;
  L: number;
  C: number;
  hue: number;
}

function labOf(palette: LoadedPalette, index: number): [number, number, number] {
  return [palette.labs[index * 3], palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]];
}

function hueColor(palette: LoadedPalette, index: number): HueColor {
  const a = palette.labs[index * 3 + 1];
  const b = palette.labs[index * 3 + 2];
  return {
    index,
    L: palette.labs[index * 3],
    C: Math.hypot(a, b),
    hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  };
}

function sortedUsed(counts: Map<number, number>): Counted[] {
  return [...counts.entries()]
    .map(([index, count]) => ({ index, count }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
}

function nearestInSet(lab: [number, number, number], set: Set<number>, palette: LoadedPalette): number {
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const index of set) {
    const delta = ciede2000(lab, labOf(palette, index));
    if (delta < bestDelta || (delta === bestDelta && index < best)) {
      best = index;
      bestDelta = delta;
    }
  }
  return best;
}

function extremeProtection(colors: HueColor[]): { set: Set<number>; ordered: number[] } {
  const ordered: number[] = [];
  const set = new Set<number>();
  if (!colors.length) return { set, ordered };
  const byL = (a: number, b: number) => colors[a].L - colors[b].L || colors[a].index - colors[b].index;
  const picks = [
    [...colors.keys()].sort(byL)[0],
    [...colors.keys()].sort((a, b) => colors[b].L - colors[a].L || colors[a].index - colors[b].index)[0],
    [...colors.keys()].sort((a, b) => colors[b].C - colors[a].C || colors[a].index - colors[b].index)[0]
  ];
  for (const pick of picks) {
    const index = colors[pick].index;
    if (!set.has(index)) {
      ordered.push(index);
      set.add(index);
    }
  }
  return { set, ordered };
}

function keepFamilyLimit(
  final: Set<number>,
  groups: number[][],
  protectedSet: Set<number>,
  palette: LoadedPalette
): void {
  for (const group of groups) {
    const members = new Set(group);
    const present = [...final].filter((index) => members.has(index));
    while (present.length > MAX_FAMILY_LAYERS) {
      let remove = -1;
      let removeCost = Number.POSITIVE_INFINITY;
      for (const index of present) {
        if (protectedSet.has(index)) continue;
        let cost = Number.POSITIVE_INFINITY;
        for (const other of present) {
          if (other === index) continue;
          cost = Math.min(cost, ciede2000(labOf(palette, index), labOf(palette, other)));
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
}

function trimToK(
  final: Set<number>,
  protectedSet: Set<number>,
  protectedOrder: number[],
  K: number,
  palette: LoadedPalette
): void {
  while (final.size > K) {
    let remove = -1;
    let removeCost = Number.POSITIVE_INFINITY;
    for (const index of final) {
      if (protectedSet.has(index)) continue;
      let cost = Number.POSITIVE_INFINITY;
      for (const other of final) {
        if (other === index) continue;
        cost = Math.min(cost, ciede2000(labOf(palette, index), labOf(palette, other)));
      }
      if (cost < removeCost || (cost === removeCost && index < remove)) {
        remove = index;
        removeCost = cost;
      }
    }
    if (remove < 0) {
      for (let i = protectedOrder.length - 1; i >= 0; i -= 1) {
        if (final.has(protectedOrder[i])) {
          remove = protectedOrder[i];
          break;
        }
      }
    }
    if (remove < 0) break;
    final.delete(remove);
  }
}

function familyRepresentatives(
  family: number[],
  counts: Map<number, number>,
  palette: LoadedPalette,
  familyUsage: number,
  total: number,
  K: number
): number[] {
  const sorted = [...family].sort((a, b) => palette.labs[a * 3] - palette.labs[b * 3] || a - b);
  const quota = Math.max(1, Math.round((familyUsage / total) * K));
  const limit = Math.min(quota, MAX_FAMILY_LAYERS, sorted.length);
  if (limit === sorted.length) return sorted;

  const byUsage = [...family].sort(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b
  );
  const main = byUsage[0];
  if (limit === 1) return [main];

  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const reps = new Set<number>([main]);
  if (main === lo) {
    reps.add(hi);
  } else if (main === hi) {
    reps.add(lo);
  } else {
    const far =
      palette.labs[hi * 3] - palette.labs[main * 3] >=
      palette.labs[main * 3] - palette.labs[lo * 3]
        ? hi
        : lo;
    const near = far === hi ? lo : hi;
    reps.add(far);
    if (limit === 3) reps.add(near);
  }
  const missing = Math.max(0, limit - reps.size);
  if (missing > 0) {
    const extras = byUsage.filter((index) => !reps.has(index));
    for (const extra of extras.slice(0, missing)) reps.add(extra);
  }
  return [...reps];
}

/**
 * v1.2 智能限色：近似重复色预合并 + 边缘小份额色预归并 +
 * 用量 ≥5% 主色进保护集 + 族内“主色必保”代表选法（docs/19 §5）。
 */
export function clusterLimitV2(
  pattern: Pattern,
  palette: LoadedPalette,
  K: number,
  protect = true,
  protectMask: Uint8Array | null = null
): Pattern {
  if (K <= 0) return pattern;
  const original = new Map<number, number>();
  const protectColors = new Set<number>();
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const cell = pattern.cells[i];
    if (cell < 0) continue;
    original.set(cell, (original.get(cell) ?? 0) + 1);
    if (protectMask?.[i] === 1) protectColors.add(cell);
  }
  if (!original.size) return pattern;
  const originalOverK = original.size > K;

  const remap = new Map<number, number>();
  const used = sortedUsed(original);
  const occupied = [...original.values()].reduce((sum, count) => sum + count, 0);
  for (const item of used) {
    if (remap.has(item.index) || protectColors.has(item.index)) continue;
    let target = -1;
    let targetCount = -1;
    let delta = Number.POSITIVE_INFINITY;
    for (const other of used) {
      if (other.index === item.index) continue;
      const d = ciede2000(labOf(palette, item.index), labOf(palette, other.index));
      const targetWins =
        other.count > item.count ||
        (other.count === item.count && other.index < item.index);
      if (d < delta && targetWins) {
        target = other.index;
        targetCount = other.count;
        delta = d;
      }
    }
    if (target >= 0 && delta <= DUPE_DE && targetCount >= item.count) remap.set(item.index, target);
  }

  const marginalCells = Math.max(2, Math.round(occupied * MARGINAL_SHARE));
  for (const item of used) {
    if (remap.has(item.index) || item.count > marginalCells || protectColors.has(item.index)) continue;
    let target = -1;
    let delta = Number.POSITIVE_INFINITY;
    for (const other of used) {
      if (other.index === item.index) continue;
      const d = ciede2000(labOf(palette, item.index), labOf(palette, other.index));
      const targetWins =
        other.count > item.count ||
        (other.count === item.count && other.index < item.index);
      if (d < delta && targetWins) {
        target = other.index;
        delta = d;
      }
    }
    if (target >= 0 && delta <= MARGINAL_DE) remap.set(item.index, target);
  }

  const mergedCounts = new Map<number, number>();
  for (const item of used) {
    let merged = item.index;
    let hops = 0;
    while (remap.has(merged) && hops < used.length) {
      merged = remap.get(merged)!;
      hops += 1;
    }
    mergedCounts.set(merged, (mergedCounts.get(merged) ?? 0) + item.count);
    if (merged !== item.index) mergedCounts.delete(item.index);
    remap.set(item.index, merged);
  }
  if (!originalOverK) {
    const cells = new Int16Array(pattern.cells.length);
    for (let i = 0; i < cells.length; i += 1) {
      const cell = pattern.cells[i];
      cells[i] = cell < 0 ? cell : (remap.get(cell) ?? cell);
    }
    return { ...pattern, cells, options: { ...pattern.options, maxColors: K } };
  }
  const mergedUsed = sortedUsed(mergedCounts);
  const total = mergedUsed.reduce((sum, item) => sum + item.count, 0);
  const groups = familyOf(mergedUsed.map((item) => hueColor(palette, item.index)));
  const final = new Set<number>();
  for (const group of groups) {
    const familyUsage = group.reduce((sum, index) => sum + (mergedCounts.get(index) ?? 0), 0);
    for (const index of familyRepresentatives(group, mergedCounts, palette, familyUsage, total, K)) {
      final.add(index);
    }
  }

  const extremes = protect ? extremeProtection(mergedUsed.map((item) => hueColor(palette, item.index))) : { set: new Set<number>(), ordered: [] as number[] };
  const protectedSet = new Set(extremes.set);
  const protectedOrder = [...extremes.ordered];
  for (const index of protectColors) protectedSet.add(index);
  const mainGuarantee = Math.max(1, Math.floor(K / 2));
  const mains = mergedUsed.filter((item) => item.count / total >= MAIN_SHARE).slice(0, mainGuarantee);
  const mainsDesc = [...mains].sort((a, b) => b.count - a.count || a.index - b.index);
  for (const item of mains) protectedSet.add(item.index);
  protectedOrder.push(...mainsDesc.map((item) => item.index));
  for (const index of extremes.set) final.add(index);
  for (const index of protectColors) final.add(index);

  keepFamilyLimit(final, groups, protectedSet, palette);
  trimToK(final, protectedSet, protectedOrder, K, palette);

  const cells = new Int16Array(pattern.cells.length);
  for (let i = 0; i < cells.length; i += 1) {
    const originalIndex = pattern.cells[i];
    if (originalIndex < 0) {
      cells[i] = -1;
      continue;
    }
    const merged = remap.get(originalIndex) ?? originalIndex;
    cells[i] = final.has(merged)
      ? merged
      : nearestInSet(labOf(palette, merged), final, palette);
  }
  return { ...pattern, cells, options: { ...pattern.options, maxColors: K } };
}
