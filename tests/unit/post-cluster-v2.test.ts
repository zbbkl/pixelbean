import { describe, expect, it } from 'vitest';
import { clusterLimitV2 } from '../../src/core/post/clusterLimitV2';
import type { LoadedPalette } from '../../src/core/palette/types';
import type { Pattern } from '../../src/types';

function labPalette(labs: [number, number, number][]): LoadedPalette {
  return {
    set: {
      schemaVersion: '1.0', id: 'cluster-v2', label: 'Cluster v2', brand: 'Test',
      standard: '1', quality: 'community-legacy', source: 'test', license: 'MIT', colors: []
    },
    solids: [],
    codes: labs.map((_, index) => `C${String(index + 1).padStart(2, '0')}`),
    indexByCode: new Map(labs.map((_, index) => [`C${String(index + 1).padStart(2, '0')}`, index])),
    labs: new Float64Array(labs.flat()),
    linearRgb: new Float64Array(labs.length)
  };
}

const yellow = Array.from({ length: 10 }, (_, i) => [20 + i * 7, 8, 40] as [number, number, number]);
const red: [number, number, number] = [45, 42, 4];
const blue: [number, number, number] = [45, -4, -42];
const palette = labPalette([...yellow, red, blue]);

function patternOf(counts: Record<string, number>): Pattern {
  const entries = Object.entries(counts);
  const cells: number[] = [];
  entries.forEach(([code, count]) => {
    const index = palette.indexByCode.get(code)!;
    for (let i = 0; i < count; i += 1) cells.push(index);
  });
  return {
    paletteId: palette.set.id,
    width: cells.length,
    height: 1,
    cells: new Int16Array(cells),
    codes: palette.codes,
    options: {
      paletteId: palette.set.id, width: cells.length, height: 1, bg: 'white',
      mode: 'average', maxColors: null, dither: 'none'
    }
  };
}

describe('clusterLimitV2', () => {
  it('reduces a yellow-heavy image to K colors with at most three yellow layers and keeps the top main color', () => {
    const counts: Record<string, number> = {
      C03: 80,
      C04: 100,
      C05: 600,
      C06: 100,
      C07: 90,
      C11: 30,
      C12: 30
    };
    const result = clusterLimitV2(patternOf(counts), palette, 6);
    const used = new Set(result.cells.filter((cell) => cell >= 0));
    expect(used.size).toBeLessThanOrEqual(6);
    const yellowIndices = [...used].filter((index) => index < 10);
    expect(yellowIndices.length).toBeLessThanOrEqual(3);
    expect(used.has(palette.indexByCode.get('C05')!)).toBe(true);
  });

  it('keeps exact duplicate colors only as their larger counterpart', () => {
    const paletteSmall = labPalette([
      [56, 20, 60],
      [56.5, 20.5, 60.5],
      [80, 4, 40],
      [30, -50, -20]
    ]);
    const pattern = {
      paletteId: paletteSmall.set.id,
      width: 5,
      height: 1,
      cells: new Int16Array([0, 0, 1, 2, 3]),
      codes: paletteSmall.codes,
      options: {
        paletteId: paletteSmall.set.id, width: 5, height: 1, bg: 'white' as const,
        mode: 'average' as const, maxColors: null, dither: 'none' as const
      }
    };
    const result = clusterLimitV2(pattern, paletteSmall, 3);
    const used = new Set(result.cells.filter((cell) => cell >= 0));
    expect(used.size).toBeLessThanOrEqual(3);
    expect(used.has(0)).toBe(true);
    expect(used.has(1)).toBe(false);
  });

  it('returns unchanged when the color count is already within K', () => {
    const paletteSmall = labPalette([[56, 20, 60], [56.5, 20.5, 60.5], [80, 4, 40]]);
    const pattern = {
      paletteId: paletteSmall.set.id,
      width: 4,
      height: 1,
      cells: new Int16Array([0, 0, 1, 2]),
      codes: paletteSmall.codes,
      options: {
        paletteId: paletteSmall.set.id, width: 4, height: 1, bg: 'white' as const,
        mode: 'average' as const, maxColors: null, dither: 'none' as const
      }
    };
    const result = clusterLimitV2(pattern, paletteSmall, 3);
    expect([...result.cells]).toEqual([0, 0, 1, 2]);
  });

  it('protects feature-mask colors from marginal premerging', () => {
    const counts: Record<string, number> = {
      C01: 200,
      C02: 200,
      C03: 1,
      C11: 1
    };
    const pattern = patternOf(counts);
    const protect = new Uint8Array(pattern.cells.length);
    protect[400] = 1;
    const result = clusterLimitV2(pattern, palette, 3, true, protect);
    expect(result.cells[400]).toBe(palette.indexByCode.get('C03')!);
  });
});
