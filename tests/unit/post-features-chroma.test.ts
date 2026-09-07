import { describe, expect, it } from 'vitest';
import { downsampleWithFeatures } from '../../src/core/pipeline/features';
import type { CellImage } from '../../src/types';

const SKIN: [number, number, number] = [244, 232, 218];
const PINK: [number, number, number] = [252, 138, 148];
const SOFT_LIGHT: [number, number, number] = [202, 200, 198];
const SOFT_DARK: [number, number, number] = [184, 182, 180];

function solidSource(width: number, height: number, color: [number, number, number]): CellImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set(color, i * 4);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function setPixel(image: CellImage, x: number, y: number, color: [number, number, number]): void {
  const offset = (y * image.width + x) * 4;
  image.data.set(color, offset);
}

describe('chroma feature channel', () => {
  it('recognizes and protects low-saturation pink dots', () => {
    const image = solidSource(20, 20, SKIN);
    for (const [x, y] of [[3, 3], [15, 3], [7, 15]]) {
      setPixel(image, x, y, PINK);
      setPixel(image, x + 1, y, PINK);
    }
    const result = downsampleWithFeatures(image, 5, 5, 'average', 'white');
    const protectedPink = [];
    for (let i = 0; i < 25; i += 1) {
      if (result.protect[i] === 1) {
        protectedPink.push(result.cells[i * 4]);
      }
    }
    expect(protectedPink.length).toBeGreaterThanOrEqual(3);
    expect(protectedPink.every((red) => red > 230)).toBe(true);
  });
});

describe('soft edge arbitration', () => {
  it('resolves a low-contrast boundary toward the agreeing neighbor side', () => {
    const image = solidSource(42, 42, SOFT_LIGHT);
    for (let y = 0; y < 42; y += 1) {
      for (let x = 0; x < 42; x += 1) {
        const rx = x % 6;
        const ry = y % 6;
        if (Math.floor(x / 6) === 3 && Math.floor(y / 6) === 3 && rx < 3 && ry >= 1 && ry < 5) {
          setPixel(image, x, y, SOFT_DARK);
        }
      }
    }
    const result = downsampleWithFeatures(image, 7, 7, 'average', 'white');
    const center = (3 * 7 + 3) * 4;
    expect(result.cells[center]).toBeGreaterThanOrEqual(198);
    expect(result.protect[3 * 7 + 3]).toBe(0);
  });
});
