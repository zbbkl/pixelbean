import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import mard from '../../data/palettes/mard-291.json';
import { downsample } from '../../src/core/pipeline/downsample';
import { deriveContainContent, deriveLongEdgeGrid } from '../../src/core/pipeline/geometry';
import { convertPipeline } from '../../src/core/pipeline/index';
import { ditherFloydSteinberg } from '../../src/core/pipeline/dither';
import { limitColors } from '../../src/core/pipeline/colorLimit';
import { countByColor, sumOccupied } from '../../src/core/pattern';
import type { CellImage, ConvertOptions, Pattern } from '../../src/types';
import { loadPalette } from '../../src/core/palette/loader';

function options(width: number, height: number, overrides: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    paletteId: 'mard-291',
    width,
    height,
    bg: 'white',
    mode: 'average',
    maxColors: null,
    dither: 'none',
    ...overrides
  };
}

function solidImage(width: number, height: number, color: [number, number, number]): CellImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('geometry', () => {
  it('keeps ultra-wide aspect ratio', () => {
    expect(deriveLongEdgeGrid(4000, 400, 29)).toEqual({ width: 29, height: 3 });
  });
  it('contains image inside a square board without stretching', () => {
    expect(deriveContainContent(4000, 400, 29, 29)).toEqual({ width: 29, height: 3 });
    expect(deriveContainContent(100, 100, 29, 29)).toEqual({ width: 29, height: 29 });
  });
});

describe('downsample', () => {
  it('averages four pixels in linear RGB deterministically', () => {
    const data = new Uint8ClampedArray(16);
    data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
    const result = downsample({ width: 2, height: 2, data }, 1, 1, 'average', 'white');
    expect(result[3]).toBe(255);
    expect(result[0]).toBeGreaterThan(0);
    expect(result[1]).toBeGreaterThan(0);
    expect(result[2]).toBeGreaterThan(0);
  });

  it('pads transparent pixels with white by default', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0]);
    const result = downsample({ width: 1, height: 1, data }, 1, 1, 'average', 'white');
    expect([...result.slice(0, 3)]).toEqual([255, 255, 255]);
  });
});

describe('pipeline determinism and invariants', () => {
  const palette = loadPalette(mard);
  const source = solidImage(64, 48, [210, 38, 48]);
  const converted = convertPipeline(source, options(58, 43), palette);

  it('runs the full conversion and produces exact grid statistics', () => {
    const stats = countByColor(converted, palette);
    const total = sumOccupied(converted);
    expect(total).toBe(58 * 43);
    expect(stats.reduce((sum, stat) => sum + stat.count, 0)).toBe(total);
    expect(stats.every((stat) => stat.code.length > 0)).toBe(true);
  });

  it('is deterministic for the same source', () => {
    const again = convertPipeline(source, options(58, 43), palette);
    expect([...again.cells]).toEqual([...converted.cells]);
  });

  it('golden fixture sha-256 matches', () => {
    const payload = `${converted.width}x${converted.height}:${[...converted.cells].join(',')}`;
    const hash = createHash('sha256').update(payload).digest('hex');
    // tests/fixtures/golden-solid-red-64x48.json（solid rgb 210,38,48 → 58×43）
    expect(hash).toBe('8937b1185c340581356a96d557768b1f3f785d94c40d29e776305c0391c1c6d8');
  });
});

describe('dither', () => {
  it('quantizes serially and is deterministic', () => {
    const palette = loadPalette(mard);
    const data = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < 12; i += 1) {
      data[i * 4] = [255, 0, 0, 0, 0, 255, 255, 255, 30, 120, 220, 60][i] ?? 128;
      data[i * 4 + 1] = [0, 0, 255, 255, 0, 120, 220, 30, 60, 220, 120, 0][i] ?? 128;
      data[i * 4 + 2] = [0, 255, 0, 255, 120, 0, 30, 220, 220, 60, 30, 120][i] ?? 128;
      data[i * 4 + 3] = 255;
    }
    const image = { width: 4, height: 3, data };
    const first = ditherFloydSteinberg(image, palette, options(4, 3, { dither: 'floyd-steinberg' }));
    const second = ditherFloydSteinberg(image, palette, options(4, 3, { dither: 'floyd-steinberg' }));
    expect([...first.cells]).toEqual([...second.cells]);
    expect(first.cells.every((cell) => cell >= 0 && cell < palette.solids.length)).toBe(true);
  });
});

describe('limitColors protection', () => {
  it('keeps dark and bright key colors while reducing used set', () => {
    const palette = loadPalette(mard);
    const codes = ['A04', 'B08', 'C08', 'G06', 'H02', 'H07'];
    const indices = codes.map((code) => palette.indexByCode.get(code)!);
    const width = codes.length;
    const cells = new Int16Array(indices);
    const pattern: Pattern = {
      paletteId: 'mard-291',
      width,
      height: 1,
      cells,
      codes: palette.codes,
      options: options(width, 1, { maxColors: 4 })
    };
    const limited = limitColors(pattern, palette, 4);
    const used = new Set([...limited.cells]);
    expect(used.size).toBeLessThanOrEqual(4);
    expect(used.has(palette.indexByCode.get('H07')!)).toBe(true);
    expect(used.has(palette.indexByCode.get('H02')!)).toBe(true);
    expect(countByColor(limited).reduce((sum, stat) => sum + stat.count, 0)).toBe(width);
  });
});

describe('contain board', () => {
  it('places a wide pattern centered with empty cells', () => {
    const palette = loadPalette(mard);
    const image = solidImage(4000, 400, [20, 20, 20]);
    const pattern = convertPipeline(
      image,
      options(29, 29, {
        contain: { contentWidth: 29, contentHeight: 3 }
      }),
      palette
    );
    expect(pattern.width).toBe(29);
    expect(pattern.height).toBe(29);
    expect(sumOccupied(pattern)).toBe(29 * 3);
    expect(pattern.cells[0]).toBe(-1);
    expect(pattern.cells[(13 * 29) + 0]).toBeGreaterThanOrEqual(0);
  });
});
