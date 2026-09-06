import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { srgbRgbToLab } from '../../src/core/color/lab';
import { loadPalette } from '../../src/core/palette/loader';
import type { LoadedPalette } from '../../src/core/palette/types';
import { convertPipeline } from '../../src/core/pipeline';
import { countCells } from '../../src/core/pattern';
import type { CellImage, ConvertOptions, PostOptions } from '../../src/types';

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((value) => Math.round((value + m) * 255)) as [number, number, number];
}

function makePalette(): LoadedPalette {
  const colors = Array.from({ length: 40 }, (_, index) => {
    const l = 0.04 + (0.91 * index) / 39;
    const s = 0.8;
    const rgb = hslToRgb(48, s, l);
    return {
      code: `Y${String(index + 1).padStart(2, '0')}`,
      nameEn: `Yellow ${index + 1}`,
      hex: `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
      rgb,
      kind: 'solid' as const
    };
  });
  return loadPalette({
    schemaVersion: '1.0',
    id: 'golden-yellow',
    label: 'Golden yellow',
    brand: 'Test',
    standard: '40',
    quality: 'community-legacy',
    source: 'synthetic test fixture',
    license: 'MIT',
    colors
  });
}

const palette = makePalette();

function makeSource(): CellImage {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const l = 0.06 + (0.88 * y) / 63;
      const s = 0.8;
      const rgb = hslToRgb(48, s, l);
      const i = (y * 64 + x) * 4;
      data.set(rgb, i);
      data[i + 3] = 255;
    }
  }
  return { width: 64, height: 64, data };
}

function options(): ConvertOptions {
  const post: PostOptions = {
    speckleClean: true,
    speckleMax: 2,
    speckleDeltaE: 30,
    shadowSimplify: 1,
    maxColors: 24,
    outline: false,
    outlineTau: 0.18
  };
  return {
    paletteId: 'golden-yellow',
    width: 64,
    height: 64,
    bg: 'white',
    mode: 'average',
    maxColors: 24,
    dither: 'none',
    post
  };
}

function yellowHue(index: number): boolean {
  const [a, b] = [palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]];
  const C = Math.hypot(a, b);
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return C > 15 && hue >= 45 && hue <= 100;
}

describe('golden yellow-gradient fixture', () => {
  it('keeps ≤24 colors, ≤3 yellow layers and one dark anchor', () => {
    const result = convertPipeline(makeSource(), options(), palette);
    const used = countCells(result).map((stat) => stat.index);
    expect(used.length).toBeLessThanOrEqual(24);
    expect(used.filter(yellowHue).length).toBeLessThanOrEqual(3);
    expect(used.filter((index) => palette.labs[index * 3] < 45).length).toBeLessThanOrEqual(1);
  });

  it('golden sha-256 is stable and deterministic', () => {
    const result = convertPipeline(makeSource(), options(), palette);
    const hash = createHash('sha256')
      .update(`${result.width}x${result.height}:${[...result.cells].join(',')}`)
      .digest('hex');
    const again = convertPipeline(makeSource(), options(), palette);
    const hash2 = createHash('sha256')
      .update(`${again.width}x${again.height}:${[...again.cells].join(',')}`)
      .digest('hex');
    expect(hash).toBe(hash2);
    expect(hash).toBe('2f9046a13bb3198684030ecba359ffc000c5d1cf9de10db3102755417886944b');
  });

  it('uses the real sRGB-to-Lab conversion for the fixture palette', () => {
    const dark = srgbRgbToLab(hslToRgb(48, 0.55, 0.05));
    expect(dark[0]).toBeGreaterThan(0);
    expect(dark[0]).toBeLessThan(15);
  });
});
