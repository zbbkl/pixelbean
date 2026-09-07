import { describe, expect, it } from 'vitest';
import type { LoadedPalette } from '../../src/core/palette/types';
import type { Pattern } from '../../src/types';
import { mergeAdjacent } from '../../src/core/post/merge';

function paletteOf(labs: [number, number, number][]): LoadedPalette {
  return {
    set: {
      schemaVersion: '1.0', id: 'merge-test', label: 'Merge test', brand: 'Test',
      standard: '1', quality: 'community-legacy', source: 'test', license: 'MIT', colors: []
    },
    solids: [],
    codes: labs.map((_, index) => `M${String(index + 1).padStart(2, '0')}`),
    indexByCode: new Map(labs.map((_, index) => [`M${String(index + 1).padStart(2, '0')}`, index])),
    labs: new Float64Array(labs.flat()),
    linearRgb: new Float64Array(labs.length)
  };
}

const palette = paletteOf([
  [88, 5, 8],     // white main
  [86, 8, 11],    // near-white gray
  [50, 20, 12],   // far brown
  [90, 3, 6]      // another light
]);

function patternWithCenter(index: number): Pattern {
  const cells = new Int16Array(25).fill(0);
  cells[6] = index;
  cells[7] = index;
  cells[8] = index;
  return {
    paletteId: palette.set.id,
    width: 5,
    height: 5,
    cells,
    codes: palette.codes,
    options: {
      paletteId: palette.set.id, width: 5, height: 5, bg: 'white',
      mode: 'average', maxColors: null, dither: 'none'
    }
  };
}

describe('mergeAdjacent', () => {
  it('merges a small near-color island into the adjacent main block', () => {
    const result = mergeAdjacent(patternWithCenter(1), palette);
    expect(result.cells[6]).toBe(0);
    expect(result.cells[7]).toBe(0);
    expect(result.cells[8]).toBe(0);
  });

  it('keeps far-color islands and protected islands', () => {
    expect(mergeAdjacent(patternWithCenter(2), palette).cells[7]).toBe(2);
    const pattern = patternWithCenter(1);
    const protect = new Uint8Array(25);
    protect[7] = 1;
    expect(mergeAdjacent(pattern, palette, protect).cells[7]).toBe(1);
  });

  it('never writes into empty board cells', () => {
    const cells = new Int16Array(25).fill(-1);
    cells[10] = 1;
    cells[11] = 1;
    cells[12] = 1;
    const pattern: Pattern = {
      paletteId: palette.set.id,
      width: 5,
      height: 5,
      cells,
      codes: palette.codes,
      options: {
        paletteId: palette.set.id, width: 5, height: 5, bg: 'white',
        mode: 'average', maxColors: null, dither: 'none'
      }
    };
    const result = mergeAdjacent(pattern, palette);
    expect(result.cells[11]).toBe(1);
    expect(result.cells[0]).toBe(-1);
  });

  it('returns the same reference when nothing changes', () => {
    const pattern = patternWithCenter(2);
    expect(mergeAdjacent(pattern, palette).cells).toBe(pattern.cells);
  });
});
