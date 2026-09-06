import type { ColorStat } from '../types';

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM CSV，Excel 可直接打开中文。 */
export function exportCsv(stats: ColorStat[], ownedCodes: Set<string>): Blob {
  const header = ['序号', '色号', 'HEX', '数量', '占比', '已有', '待购'];
  const lines = [header.join(',')];
  for (const [index, stat] of stats.entries()) {
    const owned = ownedCodes.has(stat.code) ? '是' : '否';
    const remaining = owned ? 0 : stat.count;
    lines.push(
      [
        index + 1,
        stat.code,
        stat.hex ?? '',
        stat.count,
        `${(stat.ratio * 100).toFixed(2)}%`,
        owned,
        remaining
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
