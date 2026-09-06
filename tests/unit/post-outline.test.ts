import { describe, expect, it } from 'vitest';
import { loadPalette } from '../../src/core/palette/loader';
import { outline } from '../../src/core/post/outline';
import type { Pattern } from '../../src/types';

const palette = loadPalette({
  schemaVersion: '1.0',
  id: 'outline-test',
  label: 'Outline test',
  brand: 'Test',
  standard: '1',
  quality: 'community-legacy',
  source: 'test',
  license: 'MIT',
  codeStyle: { zeroPad: 2 },
  colors: [
    { code: 'W01', hex: '#FFFFFF', kind: 'solid' },
    { code: 'L01', hex: '#C9C1B6', kind: 'solid' },
    { code: 'K01', hex: '#171311', kind: 'solid' }
  ]
});

const white = palette.indexByCode.get('W01')!;
const light = palette.indexByCode.get('L01')!;
const black = palette.indexByCode.get('K01')!;

function patternFrom(rows: number[][]): Pattern {
  const width = rows[0].length;
  const height = rows.length;
  const cells = new Int16Array(width * height);
  rows.forEach((row, y) => row.forEach((value, x) => {
    cells[y * width + x] = value;
  }));
  return {
    paletteId: 'outline-test',
    width,
    height,
    cells,
    codes: palette.codes,
    options: {
      paletteId: 'outline-test',
      width,
      height,
      bg: 'white',
      mode: 'average',
      maxColors: null,
      dither: 'none'
    }
  };
}

describe('outline', () => {
  it('adds a dark in-palette outline on a high-contrast boundary', () => {
    const result = outline(
      patternFrom([
        [white, white, light],
        [white, white, light],
        [white, white, light]
      ]),
      palette,
      0.18
    );
    expect(result.cells[1]).toBe(black);
    expect(result.cells[2]).toBe(black);
    expect(result.cells[0]).toBe(white);
    expect(result.cells[3]).toBe(white);
    expect(result.cells[4]).toBe(black);
    expect(result.cells[5]).toBe(black);
    expect(result.cells[6]).toBe(white);
    expect(result.cells[7]).toBe(black);
    expect(result.cells[8]).toBe(black);
  });

  it('is identity for a single-color pattern', () => {
    const pattern = patternFrom([
      [white, white, white],
      [white, white, white],
      [white, white, white]
    ]);
    expect(outline(pattern, palette, 0.18)).toBe(pattern);
  });

  it('does not paint outline color onto -1 board blanks', () => {
    const pattern = patternFrom([
      [-1, -1, -1],
      [-1, white, light],
      [-1, white, light]
    ]);
    const result = outline(pattern, palette, 0.18);
    expect(result.cells[0]).toBe(-1);
    expect(result.cells[1]).toBe(-1);
    expect(result.cells[2]).toBe(-1);
    expect(result.cells[3]).toBe(-1);
    expect(result.cells[4]).toBe(black);
  });

  it('does nothing when the tau threshold is above all luminance gaps', () => {
    const pattern = patternFrom([
      [white, light, light],
      [white, light, light],
      [white, light, light]
    ]);
    const result = outline(pattern, palette, 0.9);
    expect(result).toBe(pattern);
  });

  it('chooses a palette dark when only light colors are used', () => {
    const pattern = patternFrom([
      [white, light],
      [light, white]
    ]);
    const result = outline(pattern, palette, 0.18);
    const used = new Set(result.cells.filter((cell) => cell >= 0));
    expect(used.has(black)).toBe(true);
  });

  it('is deterministic', () => {
    const pattern = patternFrom([
      [white, light, white],
      [light, white, light],
      [white, light, white]
    ]);
    const a = outline(pattern, palette, 0.18);
    const b = outline(pattern, palette, 0.18);
    expect([...a.cells]).toEqual([...b.cells]);
  });
});
