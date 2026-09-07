import { describe, expect, it } from 'vitest';
import mard from '../../data/palettes/mard-291.json';
import { loadPalette } from '../../src/core/palette/loader';
import { speckleCleanV2 } from '../../src/core/post/speckle';
import type { Pattern } from '../../src/types';

const palette = loadPalette(mard);
function patternFrom(rows: number[][]): Pattern {
  const height = rows.length;
  const width = rows[0].length;
  const cells = new Int16Array(width * height);
  rows.forEach((row, y) => row.forEach((value, x) => { cells[y * width + x] = value; }));
  return {
    paletteId: 'mard-291',
    width,
    height,
    cells,
    codes: palette.codes,
    options: {
      paletteId: 'mard-291', width, height, bg: 'white', mode: 'average',
      maxColors: null, dither: 'none'
    }
  };
}

const white = palette.indexByCode.get('H02')!;
const yellow = palette.indexByCode.get('A04')!;
const orange = palette.indexByCode.get('A06')!;
const red = palette.indexByCode.get('F05')!;
const blue = palette.indexByCode.get('C08')!;

describe('speckleCleanV2', () => {
  it('removes a one-cell speckle when at least two edges touch the same neighbor', () => {
    const cleaned = speckleCleanV2(patternFrom([
      [white, white, white],
      [white, yellow, white],
      [white, white, white]
    ]), palette, 2, 30);
    expect(cleaned.cells[4]).toBe(white);
  });

  it('keeps a one-cell boundary detail surrounded by four different colors', () => {
    const cleaned = speckleCleanV2(patternFrom([
      [white, yellow, white],
      [orange, yellow, red],
      [white, blue, white]
    ]), palette, 2, 30);
    expect(cleaned.cells[4]).toBe(yellow);
  });

  it('merges a two-cell attached pair into the main block', () => {
    const pattern = patternFrom([
      [yellow, orange, orange],
      [yellow, orange, orange],
      [orange, orange, orange]
    ]);
    const cleaned = speckleCleanV2(pattern, palette, 2, 30);
    expect(cleaned.cells[0]).toBe(orange);
    expect(cleaned.cells[3]).toBe(orange);
  });

  it('skips protected cells even when the color difference is small', () => {
    const pattern = patternFrom([
      [yellow, yellow, yellow],
      [yellow, orange, yellow],
      [yellow, yellow, yellow]
    ]);
    const protect = new Uint8Array(pattern.cells.length);
    protect[4] = 1;
    const cleaned = speckleCleanV2(pattern, palette, 2, 30, protect);
    expect(cleaned.cells[4]).toBe(orange);
  });

  it('does not erase a three-cell detail at noiseMax=2', () => {
    const cleaned = speckleCleanV2(patternFrom([
      [white, white, white],
      [white, red, white],
      [white, red, white],
      [white, red, white]
    ]), palette, 2, 30);
    expect([...cleaned.cells]).toContain(red);
  });
});
