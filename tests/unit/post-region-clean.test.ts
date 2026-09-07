import { describe, expect, it } from 'vitest';
import type { LoadedPalette } from '../../src/core/palette/types';
import type { Pattern } from '../../src/types';
import { regionClean } from '../../src/core/post/regionClean';
import { convertPipeline } from '../../src/core/pipeline/index';
import { loadPalette } from '../../src/core/palette/loader';

function labPalette(labs: [number, number, number][]): LoadedPalette {
  return {
    set: {
      schemaVersion: '1.0', id: 'region-clean', label: 'Region clean', brand: 'Test',
      standard: '1', quality: 'community-legacy', source: 'test', license: 'MIT', colors: []
    },
    solids: [],
    codes: labs.map((_, index) => `R${String(index + 1).padStart(2, '0')}`),
    indexByCode: new Map(labs.map((_, index) => [`R${String(index + 1).padStart(2, '0')}`, index])),
    labs: new Float64Array(labs.flat()),
    linearRgb: new Float64Array(labs.length)
  };
}

const palette = labPalette([
  [80, 6, 10],     // main skin
  [82, 7, 12],     // near-skin wrong cell
  [30, 4, 6],      // far dark
  [88, 4, 4]       // light unused
]);

function boardOf(index: number): Pattern {
  const main = 0;
  const cells = new Int16Array(9).fill(main);
  cells[4] = index;
  return {
    paletteId: palette.set.id,
    width: 3,
    height: 3,
    cells,
    codes: palette.codes,
    options: {
      paletteId: palette.set.id, width: 3, height: 3, bg: 'white',
      mode: 'average', maxColors: null, dither: 'none'
    }
  };
}

describe('regionClean', () => {
  it('merges a near-color cell surrounded by three same neighbors', () => {
    const result = regionClean(boardOf(1), palette, null, 8, 3);
    expect(result.cells[4]).toBe(0);
  });

  it('keeps a far-color detail and protects masked cells', () => {
    expect(regionClean(boardOf(2), palette, null, 8, 3).cells[4]).toBe(2);
    const protect = new Uint8Array(9);
    protect[4] = 1;
    expect(regionClean(boardOf(1), palette, protect, 8, 3).cells[4]).toBe(1);
  });

  it('keeps empty board cells empty and is idempotent', () => {
    const cells = new Int16Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const pattern: Pattern = {
      paletteId: palette.set.id,
      width: 3,
      height: 3,
      cells,
      codes: palette.codes,
      options: {
        paletteId: palette.set.id, width: 3, height: 3, bg: 'white',
        mode: 'average', maxColors: null, dither: 'none'
      }
    };
    const result = regionClean(pattern, palette, null, 8, 3);
    const twice = regionClean(result, palette, null, 8, 3);
    expect(twice.cells).toBe(result.cells);
    const empty = new Int16Array([-1, 0, -1, 0, 1, 0, -1, 0, -1]);
    const emptyPattern: Pattern = { ...pattern, cells: empty };
    expect(regionClean(emptyPattern, palette, null, 8, 3).cells[0]).toBe(-1);
  });

  it('does not rewrite when the same color is not the 3-neighbor majority', () => {
    const cells = new Int16Array([1, 1, 2, 1, 2, 1, 0, 0, 0]);
    const pattern: Pattern = {
      paletteId: palette.set.id,
      width: 3,
      height: 3,
      cells,
      codes: palette.codes,
      options: {
        paletteId: palette.set.id, width: 3, height: 3, bg: 'white',
        mode: 'average', maxColors: null, dither: 'none'
      }
    };
    expect(regionClean(pattern, palette, null, 8, 3).cells).toBe(pattern.cells);
  });

  it('runs as an opt-in convertPipeline stage without changing default calls', () => {
    const testPalette = loadPalette({
      schemaVersion: '1.0',
      id: 'region-pipeline',
      label: 'Region pipeline',
      brand: 'Test',
      standard: '1',
      quality: 'community-legacy',
      source: 'test',
      license: 'MIT',
      colors: [
        { code: 'MAIN', hex: '#D8C8A8', kind: 'solid' },
        { code: 'NEAR', hex: '#D5C4A3', kind: 'solid' },
        { code: 'DARK', hex: '#202020', kind: 'solid' }
      ]
    });
    const rgbOf = (hex: string): [number, number, number] => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16)
    ];
    const main = rgbOf('#D8C8A8');
    const near = rgbOf('#D5C4A3');
    const data = new Uint8ClampedArray(9 * 4);
    for (let i = 0; i < 9; i += 1) {
      const color = i === 4 ? near : main;
      data.set(color, i * 4);
      data[i * 4 + 3] = 255;
    }
    const source = { width: 3, height: 3, data };
    const options = {
      paletteId: testPalette.set.id,
      width: 3,
      height: 3,
      bg: 'white' as const,
      mode: 'average' as const,
      maxColors: null,
      dither: 'none' as const
    };
    const defaultResult = convertPipeline(source, options, testPalette);
    const cleaned = convertPipeline(source, options, testPalette, true);
    const mainIndex = testPalette.indexByCode.get('MAIN')!;
    expect(defaultResult.cells[4]).toBe(testPalette.indexByCode.get('NEAR')!);
    expect(cleaned.cells[4]).toBe(mainIndex);
    expect(cleaned.cells[0]).toBe(mainIndex);
  });
});
