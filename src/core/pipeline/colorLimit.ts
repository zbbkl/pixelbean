import type { ConvertOptions, Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';
import type { MatchDetails } from './match';

interface UsedColor {
  index: number;
  count: number;
  lumSum: number;
  chromaSum: number;
}

function labL(index: number, palette: LoadedPalette): number {
  return palette.labs[index * 3];
}

function labChroma(index: number, palette: LoadedPalette): number {
  return Math.hypot(palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]);
}

function collectUsed(pattern: Pattern, palette: LoadedPalette, details?: MatchDetails): UsedColor[] {
  const stats = new Map<number, UsedColor>();
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const index = pattern.cells[i];
    if (index < 0) continue;
    const stat = stats.get(index) ?? {
      index,
      count: 0,
      lumSum: 0,
      chromaSum: 0
    };
    stat.count += 1;
    if (details) {
      stat.lumSum += details.labs[i * 3];
      stat.chromaSum += Math.hypot(details.labs[i * 3 + 1], details.labs[i * 3 + 2]);
    }
    stats.set(index, stat);
  }
  return [...stats.values()].map((stat) =>
    details
      ? stat
      : { ...stat, lumSum: stat.count * labL(stat.index, palette), chromaSum: stat.count * labChroma(stat.index, palette) }
  );
}

function protectColors(
  colors: UsedColor[],
  total: number,
  ratio: number,
  metric: 'lumLow' | 'lumHigh' | 'chromaHigh',
  target: Set<number>
): void {
  const sorted = [...colors].sort((a, b) => {
    const aLum = a.lumSum / a.count;
    const bLum = b.lumSum / b.count;
    const aChroma = a.chromaSum / a.count;
    const bChroma = b.chromaSum / b.count;
    if (metric === 'lumLow') return aLum - bLum || a.index - b.index;
    if (metric === 'lumHigh') return bLum - aLum || a.index - b.index;
    return bChroma - aChroma || a.index - b.index;
  });
  const targetCount = Math.max(1, Math.ceil(total * ratio));
  let taken = 0;
  for (const color of sorted) {
    target.add(color.index);
    taken += color.count;
    if (taken >= targetCount) break;
  }
}

function nearestInSet(lab: [number, number, number], set: Set<number>, palette: LoadedPalette): number {
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const index of set) {
    const candidate: [number, number, number] = [
      palette.labs[index * 3],
      palette.labs[index * 3 + 1],
      palette.labs[index * 3 + 2]
    ];
    const delta = ciede2000(lab, candidate);
    if (delta < bestDelta || (delta === bestDelta && index < best)) {
      best = index;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * 确定性限色启发式：保护实际用到的暗/亮/饱和关键色，再按用量取余下名额。
 * details 携带每个格子的源代表 Lab；缺省时用已匹配豆色的 Lab 兜底。
 */
export function limitColors(
  pattern: Pattern,
  palette: LoadedPalette,
  maxK: number,
  details?: MatchDetails
): Pattern {
  if (maxK === null || maxK <= 0) return pattern;
  const used = collectUsed(pattern, palette, details);
  if (used.length <= maxK) return pattern;
  const total = used.reduce((sum, item) => sum + item.count, 0);

  const protectedSet = new Set<number>();
  protectColors(used, total, 0.04, 'lumLow', protectedSet);
  protectColors(used, total, 0.04, 'lumHigh', protectedSet);
  protectColors(used, total, 0.03, 'chromaHigh', protectedSet);

  const remaining = [...used]
    .filter((item) => !protectedSet.has(item.index))
    .sort((a, b) => b.count - a.count || pattern.codes[a.index].localeCompare(pattern.codes[b.index]));
  let slot = Math.max(0, maxK - protectedSet.size);
  for (const color of remaining) {
    if (slot === 0) break;
    protectedSet.add(color.index);
    slot -= 1;
  }

  const cells = new Int16Array(pattern.cells.length);
  for (let i = 0; i < pattern.cells.length; i += 1) {
    const original = pattern.cells[i];
    if (original < 0 || protectedSet.has(original)) {
      cells[i] = original;
      continue;
    }
    const lab: [number, number, number] = details
      ? [details.labs[i * 3], details.labs[i * 3 + 1], details.labs[i * 3 + 2]]
      : [palette.labs[original * 3], palette.labs[original * 3 + 1], palette.labs[original * 3 + 2]];
    cells[i] = nearestInSet(lab, protectedSet, palette);
  }

  return {
    ...pattern,
    cells,
    options: { ...pattern.options, maxColors: maxK } as ConvertOptions
  };
}
