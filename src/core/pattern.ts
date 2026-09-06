import type { ColorStat, ConvertOptions, Pattern } from '../types';
import type { LoadedPalette } from './palette/types';
import { hexOf } from './palette/codeStyle';

export function emptyPattern(options: ConvertOptions): Pattern {
  return {
    paletteId: options.paletteId,
    width: options.width,
    height: options.height,
    cells: new Int16Array(options.width * options.height).fill(-1),
    codes: [],
    options
  };
}

export function countCells(pattern: Pattern): { index: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const cell of pattern.cells) {
    if (cell < 0) continue;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([index, count]) => ({ index, count }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
}

export function countByColor(pattern: Pattern, palette?: LoadedPalette): ColorStat[] {
  const total = pattern.cells.reduce((sum, cell) => (cell < 0 ? sum : sum + 1), 0);
  return countCells(pattern).map(({ index, count }) => ({
    index,
    code: pattern.codes[index] ?? String(index),
    hex: palette?.solids[index] ? hexOf(palette.solids[index]) : null,
    count,
    ratio: total > 0 ? count / total : 0
  }));
}

export function sumOccupied(pattern: Pattern): number {
  let count = 0;
  for (const cell of pattern.cells) if (cell >= 0) count += 1;
  return count;
}

/** 逐段 RLE：非空格存 delta 变体，供草稿/工程 JSON 压缩。 */
export function encodeCellsRle(cells: Int16Array): string {
  const runs: string[] = [];
  let runStart = 0;
  for (let i = 1; i <= cells.length; i += 1) {
    if (i === cells.length || cells[i] !== cells[runStart]) {
      runs.push(`${runStart},${i - runStart},${cells[runStart]}`);
      runStart = i;
    }
  }
  return runs.join(';');
}

export function decodeCellsRle(encoded: string, length: number): Int16Array {
  const cells = new Int16Array(length);
  for (const part of encoded.split(';')) {
    if (!part) continue;
    const [startText, lenText, valueText] = part.split(',');
    const start = Number(startText);
    const len = Number(lenText);
    const value = Number(valueText);
    cells.fill(value, start, start + len);
  }
  return cells;
}
