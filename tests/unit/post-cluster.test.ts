import { describe, expect, it } from 'vitest';
import { clusterLimit } from '../../src/core/post/clusterLimit';
import type { LoadedPalette } from '../../src/core/palette/types';
import type { Pattern } from '../../src/types';

function labPalette(labs: [number, number, number][]): LoadedPalette {
  const values = labs.flat();
  return {
    set: {
      schemaVersion: '1.0',
      id: 'cluster-test',
      label: 'Cluster test',
      brand: 'Test',
      standard: '1',
      quality: 'community-legacy',
      source: 'test',
      license: 'MIT',
      colors: []
    },
    solids: [],
    codes: labs.map((_, index) => `C${String(index + 1).padStart(2, '0')}`),
    indexByCode: new Map(labs.map((_, index) => [`C${String(index + 1).padStart(2, '0')}`, index])),
    labs: new Float64Array(values),
    linearRgb: new Float64Array(values.length)
  };
}

const yellowLayers = Array.from({ length: 9 }, (_, i) => [18 + i * 10, 9, 38] as [number, number, number]);
const red: [number, number, number] = [45, 42, 4];
const green: [number, number, number] = [48, -20, 24];
const blue: [number, number, number] = [45, -4, -42];
const palette = labPalette([...yellowLayers, red, green, blue]);

function fullPattern(codes: string[]): Pattern {
  const width = codes.length;
  const cells = new Int16Array(width);
  codes.forEach((code, index) => {
    cells[index] = palette.indexByCode.get(code)!;
  });
  return {
    paletteId: 'cluster-test',
    width,
    height: 1,
    cells,
    codes: palette.codes,
    options: {
      paletteId: 'cluster-test',
      width,
      height: 1,
      bg: 'white',
      mode: 'average',
      maxColors: null,
      dither: 'none'
    }
  };
}

const allCodes = [...palette.codes];
const yellowCodes = palette.codes.slice(0, 9);
const yellowSet = new Set(yellowCodes.map((code) => palette.indexByCode.get(code)!));

function usedIndices(pattern: Pattern): Set<number> {
  return new Set(pattern.cells.filter((cell) => cell >= 0));
}

describe('clusterLimit', () => {
  it('returns unchanged when used colors are within K', () => {
    const pattern = fullPattern(['C01', 'C10', 'C11']);
    const result = clusterLimit(pattern, palette, 8);
    expect([...result.cells]).toEqual([...pattern.cells]);
  });

  it('reduces the 12-color set to at most 4 colors', () => {
    const result = clusterLimit(fullPattern(allCodes), palette, 4, false);
    expect(usedIndices(result).size).toBeLessThanOrEqual(4);
  });

  it('keeps no more than three layers in the yellow hue family', () => {
    const result = clusterLimit(fullPattern(allCodes), palette, 4, false);
    const yellows = [...usedIndices(result)].filter((index) => yellowSet.has(index));
    expect(yellows.length).toBeLessThanOrEqual(3);
  });

  it('protects the darkest and brightest used colors when protect=true', () => {
    const result = clusterLimit(fullPattern(allCodes), palette, 4, true);
    const used = usedIndices(result);
    expect(used.has(palette.indexByCode.get('C01')!)).toBe(true);
    expect(used.has(palette.indexByCode.get('C09')!)).toBe(true);
  });

  it('preserves empty cells and total occupied count', () => {
    const pattern = fullPattern(allCodes);
    const empty = new Int16Array(pattern.width + 3).fill(-1);
    empty.set(pattern.cells, 1);
    const board: Pattern = { ...pattern, width: pattern.width + 3, cells: empty };
    const result = clusterLimit(board, palette, 4, true);
    expect(result.cells[0]).toBe(-1);
    expect(result.cells[13]).toBe(-1);
    expect(result.cells[14]).toBe(-1);
    const occupied = result.cells.filter((cell) => cell >= 0).length;
    expect(occupied).toBe(allCodes.length);
  });

  it('is deterministic for the same input', () => {
    const first = clusterLimit(fullPattern(allCodes), palette, 4, true);
    const second = clusterLimit(fullPattern(allCodes), palette, 4, true);
    expect([...first.cells]).toEqual([...second.cells]);
  });

  it('never exceeds K when dark/bright/saturated protection are three distinct colors (small K)', () => {
    // 回归：K < 保护色数量时不得违反 ≤K（docs/01 §9 DoD「色数统计 ≤ 设定值」）。
    const distinct = labPalette([
      [90, 4, 45],  // 亮（bright）
      [25, 16, 6],  // 暗（dark）
      [55, 5, -55]  // 饱和（saturated）
    ]);
    const pattern: Pattern = {
      paletteId: distinct.set.id,
      width: 3,
      height: 1,
      cells: new Int16Array([0, 1, 2]),
      codes: distinct.codes,
      options: {
        paletteId: distinct.set.id,
        width: 3,
        height: 1,
        bg: 'white',
        mode: 'average',
        maxColors: null,
        dither: 'none'
      }
    };
    const result = clusterLimit(pattern, distinct, 2, true);
    const used = new Set(result.cells.filter((cell) => cell >= 0));
    expect(used.size).toBeLessThanOrEqual(2);
  });
});
