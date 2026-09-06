import { describe, expect, it } from 'vitest';
import mard from '../../data/palettes/mard-291.json';
import { loadPalette } from '../../src/core/palette/loader';
import { speckleClean } from '../../src/core/post/speckle';
import type { Pattern } from '../../src/types';

const palette = loadPalette(mard);

function patternFrom(rows: number[][]): Pattern {
  const height = rows.length;
  const width = rows[0].length;
  const cells = new Int16Array(width * height);
  rows.forEach((row, y) => {
    row.forEach((value, x) => {
      cells[y * width + x] = value;
    });
  });
  return {
    paletteId: 'mard-291',
    width,
    height,
    cells,
    codes: palette.codes,
    options: {
      paletteId: 'mard-291',
      width,
      height,
      bg: 'white',
      mode: 'average',
      maxColors: null,
      dither: 'none'
    }
  };
}

const white = palette.indexByCode.get('H02')!;
const yellow = palette.indexByCode.get('A04')!;
const orange = palette.indexByCode.get('A06')!;
const red = palette.indexByCode.get('F05')!;
const black = palette.indexByCode.get('H07')!;
const blue = palette.indexByCode.get('C08')!;

describe('speckleClean', () => {
  it('fills a one-cell near-color speckle with its majority neighbor', () => {
    const pattern = patternFrom([
      [white, white, white],
      [white, yellow, white],
      [white, white, white]
    ]);
    const cleaned = speckleClean(pattern, palette, 2, 30);
    expect(cleaned.cells[4]).toBe(white);
  });

  it('keeps an isolated dark eye when ΔE exceeds the threshold', () => {
    const pattern = patternFrom([
      [yellow, yellow, yellow],
      [yellow, black, yellow],
      [yellow, yellow, yellow]
    ]);
    const cleaned = speckleClean(pattern, palette, 2, 30);
    expect(cleaned.cells[4]).toBe(black);
  });

  it('does not erase a three-cell feature when noiseMax=2', () => {
    const pattern = patternFrom([
      [white, white, white],
      [white, red, white],
      [white, red, white],
      [white, red, white]
    ]);
    const cleaned = speckleClean(pattern, palette, 2, 30);
    expect(cleaned.cells[4]).toBe(red);
    expect(cleaned.cells[7]).toBe(red);
    expect(cleaned.cells[10]).toBe(red);
  });

  it('clears one-cell noise at noiseMax=1 and keeps two-cell detail at noiseMax=1', () => {
    const oneNoise = patternFrom([
      [yellow, orange, orange],
      [orange, orange, orange],
      [orange, orange, orange]
    ]);
    expect(speckleClean(oneNoise, palette, 1, 30).cells[0]).toBe(orange);
    const twoCell = patternFrom([
      [yellow, yellow, orange],
      [yellow, orange, orange],
      [orange, orange, orange]
    ]);
    const cleaned = speckleClean(twoCell, palette, 1, 30);
    expect(cleaned.cells[0]).toBe(yellow);
    expect(cleaned.cells[1]).toBe(yellow);
    expect(cleaned.cells[3]).toBe(yellow);
  });

  it('does not modify -1 board cells or all-empty patterns', () => {
    const pattern = patternFrom([
      [-1, -1, -1],
      [-1, white, -1],
      [-1, -1, -1]
    ]);
    const cleaned = speckleClean(pattern, palette, 2, 30);
    expect(cleaned.cells[4]).toBe(white);
    expect(cleaned.cells.every((cell, index) => index !== 4 ? cell === -1 : true)).toBe(true);
  });

  it('is deterministic and never uses random sources', () => {
    const pattern = patternFrom([
      [yellow, white, white],
      [white, yellow, blue],
      [blue, blue, blue]
    ]);
    const first = speckleClean(pattern, palette, 2, 30);
    const second = speckleClean(pattern, palette, 2, 30);
    expect([...first.cells]).toEqual([...second.cells]);
  });
});
