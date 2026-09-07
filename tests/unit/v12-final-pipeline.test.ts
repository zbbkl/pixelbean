import { describe, expect, it } from 'vitest';
import { loadPalette } from '../../src/core/palette/loader';
import { convertPipeline } from '../../src/core/pipeline';
import type { CellImage, ConvertOptions } from '../../src/types';

function solidSource(width: number, height: number, rgb: [number, number, number]): CellImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set(rgb, i * 4);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('v1.2-final pipeline', () => {
  it('runs the E3 merge stage on the dominant photo path', () => {
    const palette = loadPalette({
      schemaVersion: '1.0',
      id: 'final-merge',
      label: 'Final merge',
      brand: 'Test',
      standard: '1',
      quality: 'community-legacy',
      source: 'test',
      license: 'MIT',
      colors: [
        { code: 'MAIN', hex: '#E8DCC4', kind: 'solid' },
        { code: 'NEAR', hex: '#E4D7BE', kind: 'solid' },
        { code: 'FAR', hex: '#243048', kind: 'solid' }
      ]
    });
    const near = [228, 215, 190] as [number, number, number];
    const main = [232, 220, 196] as [number, number, number];
    const image = solidSource(5, 5, main);
    for (const index of [6, 7, 8]) {
      const x = index % 5;
      const y = Math.floor(index / 5);
      const offset = (y * 5 + x) * 4;
      image.data.set(near, offset);
    }
    const options: ConvertOptions = {
      paletteId: palette.set.id,
      width: 5,
      height: 5,
      bg: 'white',
      mode: 'dominant',
      maxColors: null,
      dither: 'none',
      features: { enabled: true }
    };
    const averageOptions: ConvertOptions = { ...options, mode: 'average' };
    const merged = convertPipeline(image, options, palette);
    const unmerged = convertPipeline(image, averageOptions, palette);
    expect(merged.cells[7]).toBe(palette.indexByCode.get('MAIN')!);
    expect(unmerged.cells[7]).toBe(palette.indexByCode.get('NEAR')!);
  });

  it('is deterministic through the full final path', () => {
    const palette = loadPalette({
      schemaVersion: '1.0',
      id: 'final-det',
      label: 'Final det',
      brand: 'Test',
      standard: '1',
      quality: 'community-legacy',
      source: 'test',
      license: 'MIT',
      colors: [
        { code: 'L1', hex: '#E9DDC4', kind: 'solid' },
        { code: 'L2', hex: '#C9A86A', kind: 'solid' },
        { code: 'D1', hex: '#3C3F4A', kind: 'solid' }
      ]
    });
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i += 1) {
      const color = i % 3 === 0 ? [233, 221, 196] : i % 3 === 1 ? [201, 168, 106] : [60, 63, 74];
      data.set(color, i * 4);
      data[i * 4 + 3] = 255;
    }
    const source = { width: 8, height: 8, data };
    const options: ConvertOptions = {
      paletteId: palette.set.id,
      width: 4,
      height: 4,
      bg: 'white',
      mode: 'dominant',
      maxColors: null,
      dither: 'none',
      features: { enabled: true }
    };
    const first = convertPipeline(source, options, palette);
    const second = convertPipeline(source, options, palette);
    expect([...first.cells]).toEqual([...second.cells]);
  });
});
