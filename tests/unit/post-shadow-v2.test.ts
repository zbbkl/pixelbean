import { describe, expect, it } from 'vitest';
import type { LoadedPalette } from '../../src/core/palette/types';
import type { Pattern } from '../../src/types';
import { shadowSimplifyV2 } from '../../src/core/post/shadowSimplify';

function labPalette(labs: [number, number, number][]): LoadedPalette {
  return {
    set: {
      schemaVersion: '1.0', id: 'shadow-v2', label: 'Shadow v2', brand: 'Test',
      standard: '1', quality: 'community-legacy', source: 'test', license: 'MIT', colors: []
    },
    solids: [],
    codes: labs.map((_, index) => `S${String(index + 1).padStart(2, '0')}`),
    indexByCode: new Map(labs.map((_, index) => [`S${String(index + 1).padStart(2, '0')}`, index])),
    labs: new Float64Array(labs.flat()),
    linearRgb: new Float64Array(labs.length)
  };
}

function oneRow(values: number[], palette: LoadedPalette): Pattern {
  return {
    paletteId: palette.set.id,
    width: values.length,
    height: 1,
    cells: new Int16Array(values),
    codes: palette.codes,
    options: {
      paletteId: palette.set.id, width: values.length, height: 1, bg: 'white',
      mode: 'average', maxColors: null, dither: 'none'
    }
  };
}

const palette = labPalette([
  [88, 2, 4],    // light
  [8, 3, 3],     // dark neutral anchor
  [36, 10, 8],   // neutral layer
  [42, 20, 12],  // near-neutral boundary
  [36, 60, 42],  // colored dark
  [38, 64, 46]   // colored same-family dark
]);

describe('shadowSimplifyV2', () => {
  it('standard keeps at most two neutral dark layers', () => {
    const result = shadowSimplifyV2(oneRow([0, 1, 2, 3, 4, 5], palette), palette, 1);
    const neutral = [...new Set(result.cells)].filter((index) => index >= 0 && palette.labs[index * 3] < 45 &&
      Math.hypot(palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]) <= 45);
    expect(neutral.length).toBeLessThanOrEqual(2);
  });

  it('strong forces all neutral dark layers into one anchor', () => {
    const result = shadowSimplifyV2(oneRow([0, 1, 2, 3, 4, 5], palette), palette, 2);
    const neutral = [...new Set(result.cells)].filter((index) => index >= 0 && palette.labs[index * 3] < 45 &&
      Math.hypot(palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]) <= 45);
    expect(neutral.length).toBe(1);
  });

  it('does not merge colored darks into the neutral anchor', () => {
    const result = shadowSimplifyV2(oneRow([0, 1, 2, 4], palette), palette, 1);
    expect(result.cells[3]).toBe(4);
  });

  it('a protected far dark color is not forced into a mismatched anchor', () => {
    const pattern = oneRow([0, 1, 3], palette);
    const protect = new Uint8Array([0, 0, 1]);
    const result = shadowSimplifyV2(pattern, palette, 2, protect);
    expect(result.cells[2]).toBe(3);
  });
});
