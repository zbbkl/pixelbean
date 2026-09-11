import { describe, expect, it } from 'vitest';
import { convertPipeline } from '../../src/core/pipeline';
import { downsampleMask, extractSubject, SUBJECT_COMPONENT_MIN } from '../../src/core/pipeline/subject';
import { loadPalette } from '../../src/core/palette/loader';
import { countByColor, sumOccupied } from '../../src/core/pattern';
import type { CellImage, ConvertOptions } from '../../src/types';

function makeImage(width: number, height: number, fill: [number, number, number], alpha = 255): CellImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = alpha;
  }
  return { width, height, data };
}

function setPx(image: CellImage, x: number, y: number, color: [number, number, number], alpha = 255): void {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = alpha;
}

function options(width: number, height: number, overrides: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    paletteId: 'mard-291',
    width,
    height,
    bg: 'white',
    mode: 'dominant',
    maxColors: null,
    dither: 'none',
    ...overrides
  };
}

describe('extractSubject', () => {
  it('removes a solid white background while keeping the interior body', () => {
    const image = makeImage(30, 30, [255, 255, 255]);
    for (let y = 6; y < 24; y += 1) {
      for (let x = 6; x < 24; x += 1) {
        setPx(image, x, y, [235, 196, 160]);
      }
    }
    const result = extractSubject(image);
    expect(result.bbox).toEqual({ x0: 6, y0: 6, x1: 23, y1: 23 });
    expect(result.mask[0]).toBe(0);
    expect(result.mask[11 * 30 + 11]).toBe(1);
    expect(result.cells[0 + 3]).toBe(0);
    expect(result.cells[(11 * 30 + 11) * 4 + 3]).toBe(255);
  });

  it('keeps a near-white body from being swallowed when it is separated by a contour', () => {
    const image = makeImage(32, 32, [255, 255, 255]);
    for (let y = 7; y < 25; y += 1) {
      for (let x = 7; x < 25; x += 1) {
        if (x === 7 || y === 7 || x === 24 || y === 24) {
          setPx(image, x, y, [170, 170, 170]);
        } else {
          setPx(image, x, y, [249, 247, 242]);
        }
      }
    }
    const result = extractSubject(image);
    expect(result.mask[8 * 32 + 8]).toBe(1);
    expect(result.bbox && result.bbox.x0).toBeLessThanOrEqual(7);
    expect(result.mask[0]).toBe(0);
  });

  it('keeps already-transparent PNG backgrounds transparent', () => {
    const image = makeImage(24, 24, [0, 0, 0], 0);
    for (let y = 5; y < 19; y += 1) {
      for (let x = 5; x < 19; x += 1) {
        setPx(image, x, y, [245, 190, 80]);
      }
    }
    const result = extractSubject(image);
    expect(result.bbox).toEqual({ x0: 5, y0: 5, x1: 18, y1: 18 });
    expect(result.mask[0]).toBe(0);
    expect(result.cells[3]).toBe(0);
  });

  it('downsamples a subject mask deterministically', () => {
    const mask = new Uint8Array(4 * 4);
    for (let i = 6; i < 12; i += 1) mask[i] = 1;
    const down = downsampleMask(mask, 4, 4, 2, 2);
    expect([...down]).toEqual([0, 1, 1, 1]);
  });
});

describe('removeBackground pipeline', () => {
  const palette = loadPalette({
    schemaVersion: '1.0',
    id: 'subject-test',
    label: 'Subject test',
    brand: 'Test',
    standard: '1',
    quality: 'community-legacy',
    source: 'test',
    license: 'MIT',
    colors: [
      { code: 'SKIN', hex: '#EBC4A0', kind: 'solid' },
      { code: 'DARK', hex: '#27313C', kind: 'solid' },
      { code: 'BODY', hex: '#F7F3EE', kind: 'solid' },
      { code: 'RED', hex: '#D8272B', kind: 'solid' }
    ]
  });

  it('marks background grid cells empty when enabled and keeps them when disabled', () => {
    const image = makeImage(60, 60, [255, 255, 255]);
    for (let y = 27; y < 45; y += 1) {
      for (let x = 21; x < 39; x += 1) {
        setPx(image, x, y, [235, 196, 160]);
      }
    }
    const withBg = convertPipeline(image, options(20, 20, { removeBackground: true }), palette);
    const withoutBg = convertPipeline(image, options(20, 20, { removeBackground: false }), palette);
    expect(sumOccupied(withBg)).toBe(6 * 6);
    expect(sumOccupied(withoutBg)).toBe(20 * 20);
    expect(withBg.cells[0]).toBe(-1);
    expect(withBg.cells[11 * 20 + 10]).toBeGreaterThanOrEqual(0);
    expect(countByColor(withBg).every((stat) => stat.count > 0)).toBe(true);
  });

  it('keeps the subject box within a square board without stretching', () => {
    const image = makeImage(100, 200, [255, 255, 255]);
    for (let y = 20; y < 60; y += 1) {
      for (let x = 50; x < 70; x += 1) {
        setPx(image, x, y, [235, 196, 160]);
      }
    }
    const pattern = convertPipeline(
      image,
      options(40, 40, {
        removeBackground: true,
        contain: { contentWidth: 20, contentHeight: 40 }
      }),
      palette
    );
    expect(pattern.width).toBe(40);
    expect(pattern.height).toBe(40);
    expect(sumOccupied(pattern)).toBeLessThan(40 * 40);
    expect(pattern.cells[0]).toBe(-1);
    expect(pattern.cells[0 * 40 + 20]).toBeGreaterThanOrEqual(0);
    expect(pattern.cells[39 * 40 + 20]).toBeGreaterThanOrEqual(0);
  });

  it('keeps a near-white body and a high-contrast red eye', () => {
    const image = makeImage(80, 80, [255, 255, 255]);
    for (let y = 20; y < 60; y += 1) {
      for (let x = 20; x < 60; x += 1) {
        const edge = x === 20 || x === 59 || y === 20 || y === 59;
        setPx(image, x, y, edge ? [100, 100, 100] : [249, 247, 242]);
      }
    }
    for (let y = 34; y < 40; y += 1) {
      for (let x = 36; x < 42; x += 1) {
        setPx(image, x, y, [216, 39, 43]);
      }
    }

    const pattern = convertPipeline(
      image,
      options(40, 40, { removeBackground: true, features: { enabled: true } }),
      palette
    );
    const red = palette.set.colors.findIndex((color) => color.code === 'RED');
    expect(red).toBeGreaterThanOrEqual(0);
    expect([...pattern.cells]).toContain(red);
    expect(pattern.cells[0]).toBe(-1);
    expect(sumOccupied(pattern)).toBeGreaterThan(15 * 15);
    expect(sumOccupied(pattern)).toBeLessThan(21 * 21);
  });
});

describe('extractSubject 可信度门（A.2）', () => {
  function rabbitLike(): CellImage {
    const size = 240;
    const image = makeImage(size, size, [250, 250, 250]);
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.36;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (Math.hypot(x - cx, y - cy) <= r) setPx(image, x, y, [253, 252, 250]);
      }
    }
    const rect = (x0: number, y0: number, w: number, h: number, c: [number, number, number]) => {
      for (let y = y0; y < y0 + h; y += 1) {
        for (let x = x0; x < x0 + w; x += 1) setPx(image, x, y, c);
      }
    };
    rect(cx - 42, cy - 40, 16, 16, [230, 120, 160]);
    rect(cx + 26, cy - 40, 16, 16, [230, 120, 160]);
    rect(cx - 24, cy - 10, 10, 10, [35, 40, 48]);
    rect(cx + 14, cy - 10, 10, 10, [35, 40, 48]);
    rect(cx - 18, cy + 26, 36, 14, [40, 180, 180]);
    return image;
  }

  it('近白主体被打碎时判不可信并回退全主体（不吞主体）', () => {
    const result = extractSubject(rabbitLike());
    expect(result.reliable).toBe(false);
    expect(result.largestComponentRatio).toBeLessThan(SUBJECT_COMPONENT_MIN);
    expect([...result.mask].every((v) => v === 1)).toBe(true);
    expect(result.bbox).toEqual({ x0: 0, y0: 0, x1: 239, y1: 239 });
  });

  it('纯色图不产生空图纸（回退全主体）', () => {
    const result = extractSubject(makeImage(60, 60, [220, 30, 30]));
    expect([...result.mask].filter((v) => v === 1).length).toBe(60 * 60);
  });

  it('可信抠图：单一连通主体给出 reliable=true', () => {
    const image = makeImage(60, 60, [255, 255, 255]);
    for (let y = 20; y < 40; y += 1) {
      for (let x = 20; x < 40; x += 1) setPx(image, x, y, [235, 196, 160]);
    }
    const result = extractSubject(image);
    expect(result.reliable).toBe(true);
    expect(result.largestComponentRatio).toBeGreaterThanOrEqual(SUBJECT_COMPONENT_MIN);
    expect(result.mask[30 * 60 + 30]).toBe(1);
  });
});
