import { describe, expect, it } from 'vitest';
import { loadPalette } from '../../src/core/palette/loader';
import type { LoadedPalette } from '../../src/core/palette/types';
import { shadowSimplify } from '../../src/core/post/shadowSimplify';
import type { Pattern } from '../../src/types';
import { ciede2000 } from '../../src/core/color/ciede2000';

function paletteWith(hexes: string[]): LoadedPalette {
  const colors = hexes.map((hex, index) => ({
    code: `T${String(index + 1).padStart(2, '0')}`,
    hex,
    kind: 'solid' as const,
    family: 'T'
  }));
  return loadPalette({
    schemaVersion: '1.0',
    id: 'shadow-test',
    label: 'Shadow test',
    brand: 'Test',
    standard: '1',
    quality: 'community-legacy',
    source: 'test',
    license: 'MIT',
    colors
  });
}

const palette = paletteWith([
  '#F4DCA0',
  '#4B2E18',
  '#5C4024',
  '#C00020',
  '#D9C98E'
]);

function patternFrom(values: number[]): Pattern {
  const cells = new Int16Array(values);
  return {
    paletteId: 'shadow-test',
    width: values.length,
    height: 1,
    cells,
    codes: palette.codes,
    options: {
      paletteId: 'shadow-test',
      width: values.length,
      height: 1,
      bg: 'white',
      mode: 'average',
      maxColors: null,
      dither: 'none'
    }
  };
}

const light = 0;
const darkBrown = 1;
const grayBrown = 2;
const darkRed = 3;
const paleYellow = 4;

describe('shadowSimplify', () => {
  it('level 0 is identity', () => {
    const input = patternFrom([light, paleYellow, darkRed]);
    const result = shadowSimplify(input, palette, 0);
    expect([...result.cells]).toEqual([...input.cells]);
  });

  it('standard level folds gray-brown dark into the unified anchor', () => {
    const result = shadowSimplify(patternFrom([light, darkBrown, grayBrown, darkRed]), palette, 1);
    expect(result.cells[2]).toBe(darkBrown);
  });

  it('keeps clearly colored dark red at standard level', () => {
    const result = shadowSimplify(patternFrom([light, darkBrown, grayBrown, darkRed]), palette, 1);
    expect(result.cells[3]).toBe(darkRed);
  });

  it('keeps light and pale colors untouched', () => {
    const input = patternFrom([light, paleYellow, darkBrown]);
    const result = shadowSimplify(input, palette, 1);
    expect(result.cells[0]).toBe(light);
    expect(result.cells[1]).toBe(paleYellow);
    expect(result.cells[2]).toBe(darkBrown);
  });

  it('does not create outlines on empty board cells', () => {
    const cells = new Int16Array([darkBrown, -1, grayBrown]);
    const pattern: Pattern = {
      paletteId: 'shadow-test',
      width: 3,
      height: 1,
      cells,
      codes: palette.codes,
      options: patternFrom([]).options
    };
    const result = shadowSimplify(pattern, palette, 1);
    expect(result.cells[0]).toBe(darkBrown);
    expect(result.cells[1]).toBe(-1);
    expect(result.cells[2]).toBe(darkBrown);
  });

  it('is deterministic for equal input', () => {
    const input = patternFrom([light, darkBrown, grayBrown, darkRed, paleYellow]);
    const a = shadowSimplify(input, palette, 1);
    const b = shadowSimplify(input, palette, 1);
    expect([...a.cells]).toEqual([...b.cells]);
  });

  it('strong level absorbs an extra gray-yellow that standard level keeps', () => {
    const anchorLab: [number, number, number] = [20, 4, 4];
    const yellowDarkLab: [number, number, number] = [38, 42, 12];
    const redDarkLab: [number, number, number] = [38, 90, 50];
    expect(ciede2000(anchorLab, yellowDarkLab)).toBeGreaterThan(18);
    expect(ciede2000(anchorLab, yellowDarkLab)).toBeLessThan(28);

    const synthetic: LoadedPalette = {
      set: {
        schemaVersion: '1.0',
        id: 'synthetic',
        label: 'synthetic',
        brand: 'Test',
        standard: '1',
        quality: 'community-legacy',
        source: 'test',
        license: 'MIT',
        colors: []
      },
      solids: [],
      codes: ['D01', 'Y01', 'R01'],
      indexByCode: new Map([['D01', 0], ['Y01', 1], ['R01', 2]]),
      labs: new Float64Array([...anchorLab, ...yellowDarkLab, ...redDarkLab]),
      linearRgb: new Float64Array(9)
    };
    const pattern: Pattern = {
      paletteId: 'synthetic',
      width: 3,
      height: 1,
      cells: new Int16Array([0, 1, 2]),
      codes: synthetic.codes,
      options: {
        paletteId: 'synthetic',
        width: 3,
        height: 1,
        bg: 'white',
        mode: 'average',
        maxColors: null,
        dither: 'none'
      }
    };
    const standard = shadowSimplify(pattern, synthetic, 1);
    const strong = shadowSimplify(pattern, synthetic, 2);
    expect(standard.cells[1]).toBe(1);
    expect(strong.cells[1]).toBe(0);
    expect(standard.cells[2]).toBe(2);
    expect(strong.cells[2]).toBe(2);
  });
});
