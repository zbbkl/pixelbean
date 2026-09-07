import { describe, expect, it } from 'vitest';
import {
  downsampleAverage,
  downsampleDominantV2
} from '../../src/core/pipeline/downsample';
import type { CellImage } from '../../src/types';

function solidImage(width: number, height: number, color: [number, number, number]): CellImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set(color, i * 4);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function mixedImage(width: number, height: number, pixels: [number, number, number, number][]): CellImage {
  const image = solidImage(width, height, [255, 255, 255]);
  for (const [x, y, r, g] of pixels) {
    const offset = (y * width + x) * 4;
    image.data.set([r, g, 100], offset);
  }
  return image;
}

describe('downsampleDominantV2', () => {
  it('is deterministic and keeps alpha opaque', () => {
    const image = mixedImage(2, 2, [[0, 0, 20, 20], [1, 1, 20, 20], [0, 1, 240, 240]]);
    const first = downsampleDominantV2(image, 1, 1, 'white');
    const second = downsampleDominantV2(image, 1, 1, 'white');
    expect([...first]).toEqual([...second]);
    expect(first[3]).toBe(255);
  });

  it('falls back to average for regions with fewer than four source pixels', () => {
    const image = mixedImage(2, 1, [[0, 0, 10, 10], [1, 0, 250, 250]]);
    const dominant = downsampleDominantV2(image, 1, 1, 'white');
    const average = downsampleAverage(image, 1, 1, 'white');
    expect([...dominant.slice(0, 3)]).toEqual([...average.slice(0, 3)]);
  });

  it('keeps the dominant Lab bucket for a region with four or more pixels', () => {
    const image = mixedImage(2, 2, [
      [0, 0, 15, 18],
      [0, 1, 18, 22],
      [1, 0, 20, 25],
      [1, 1, 245, 240]
    ]);
    const result = downsampleDominantV2(image, 1, 1, 'white');
    expect(result[0]).toBeLessThan(120);
    expect(result[1]).toBeLessThan(120);
  });
});
