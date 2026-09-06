import { describe, expect, it } from 'vitest';
import { ciede2000 } from '../../src/core/color/ciede2000';
import { linearToSrgbByte, srgbByteToLinear } from '../../src/core/color/srgb';
import { ciede2000Vectors } from './ciede2000-vectors';

describe('ciede2000 Sharma vectors', () => {
  it.each(ciede2000Vectors.map((row, i) => ({ row, i })))('vector $i+1', ({ row, i }) => {
    const actual = ciede2000(
      [row[0], row[1], row[2]],
      [row[3], row[4], row[5]]
    );
    expect(actual).toBeCloseTo(row[6], 4);
    expect(Math.abs(actual - row[6])).toBeLessThan(0.0005);
  });
});

describe('srgb conversion', () => {
  it('matches IEC 61966 anchors', () => {
    expect(srgbByteToLinear(0)).toBe(0);
    expect(srgbByteToLinear(255)).toBeCloseTo(1, 10);
    expect(linearToSrgbByte(0)).toBe(0);
    expect(linearToSrgbByte(1)).toBe(255);
  });

  it('round-trips within 8-bit quantization error', () => {
    for (const byte of [0, 1, 17, 128, 200, 255]) {
      const round = linearToSrgbByte(srgbByteToLinear(byte));
      expect(Math.abs(round - byte)).toBeLessThanOrEqual(1);
    }
  });
});
