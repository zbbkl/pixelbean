import { describe, expect, it } from 'vitest';
import { ciede2000, ciede2000Weighted } from '../../src/core/color/ciede2000';
import { nearestPaletteIndexWeighted } from '../../src/core/pipeline/match';
import type { LoadedPalette } from '../../src/core/palette/types';

const palette: LoadedPalette = {
  set: {
    schemaVersion: '1.0', id: 'weighted-test', label: 'Weighted', brand: 'Test',
    standard: '1', quality: 'community-legacy', source: 'test', license: 'MIT', colors: []
  },
  solids: [{ code: 'W', hex: null, kind: 'solid' }, { code: 'P', hex: null, kind: 'solid' }, { code: 'G', hex: null, kind: 'solid' }],
  codes: ['W', 'P', 'G'],
  indexByCode: new Map([['W', 0], ['P', 1], ['G', 2]]),
  labs: new Float64Array([95, 2, 4, 87, 14, 8, 90, 1, 2]),
  linearRgb: new Float64Array(9)
};

describe('ciede2000Weighted', () => {
  it('matches ciede2000 when all weights are one', () => {
    const a: [number, number, number] = [82, 12, 7];
    const b: [number, number, number] = [90, 3, 4];
    expect(ciede2000Weighted(a, b)).toBeCloseTo(ciede2000(a, b), 10);
  });

  it('ranks the hue-correct low-chroma candidate first', () => {
    const lab: [number, number, number] = [86, 12, 6];
    const index = nearestPaletteIndexWeighted(lab, palette);
    expect(index).toBe(1);
  });

  it('keeps the original unweighted function untouched', () => {
    expect(ciede2000([95, 2, 4], [87, 14, 8])).toBeGreaterThan(0);
    expect(ciede2000Weighted([95, 2, 4], [87, 14, 8], { kL: 0.85, kC: 1.05, kH: 1.15 })).toBeGreaterThan(0);
  });
});
