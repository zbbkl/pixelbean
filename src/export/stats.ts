import type { ColorStat } from '../types';

export function statsText(stats: ColorStat[]): string {
  return stats
    .map((stat, index) => `${index + 1}. ${stat.code}\t${stat.count} 颗\t${Math.round(stat.ratio * 100)}%`)
    .join('\n');
}

export function copyStats(stats: ColorStat[]): Promise<void> {
  const text = `PixelBean 用量清单\n\n${statsText(stats)}`;
  return navigator.clipboard.writeText(text);
}
