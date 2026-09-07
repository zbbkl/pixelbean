import { describe, expect, it } from 'vitest';
import {
  downsampleWithFeatures,
  placeProtectMask
} from '../../src/core/pipeline/features';
import { downsample } from '../../src/core/pipeline/downsample';
import type { CellImage } from '../../src/types';

const BG: [number, number, number] = [150, 152, 155];
const DARK: [number, number, number] = [12, 12, 14];
const LIGHT: [number, number, number] = [235, 232, 220];

function fillBlock(image: CellImage, color: [number, number, number]): void {
  for (let i = 0; i < image.data.length; i += 4) {
    image.data.set(color, i);
    image.data[i + 3] = 255;
  }
}

function blankSource(width: number, height: number): CellImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set(BG, i * 4);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function setPixel(image: CellImage, x: number, y: number, color: [number, number, number]): void {
  const offset = (y * image.width + x) * 4;
  image.data.set(color, offset);
}

function featureSource(): CellImage {
  const image = blankSource(24, 24);
  for (let y = 0; y < 24; y += 1) setPixel(image, 4, y, DARK);       // vertical line
  for (let x = 0; x < 24; x += 1) setPixel(image, x, 13, DARK);       // horizontal line
  const dots: [number, number][] = [[1, 1], [7, 1], [1, 7], [7, 7]];
  for (const [x, y] of dots) setPixel(image, x, y, DARK);
  return image;
}

describe('downsampleWithFeatures', () => {
  it('writes protected line and dot feature cells in average mode', () => {
    const result = downsampleWithFeatures(featureSource(), 8, 8, 'average', 'white');
    const darkCells = [];
    for (let i = 0; i < 64; i += 1) {
      if (result.protect[i] === 1) darkCells.push(result.cells[i * 4]);
    }
    expect(darkCells.length).toBeGreaterThanOrEqual(6);
    expect(darkCells.every((value) => value < 50)).toBe(true);
    expect(darkCells.length).toBeLessThanOrEqual(Math.max(24, Math.round(64 * 0.02)));
  });

  it('is deterministic and leaves no protect cells when details are disabled', () => {
    const first = downsampleWithFeatures(featureSource(), 8, 8, 'average', 'white');
    const second = downsampleWithFeatures(featureSource(), 8, 8, 'average', 'white');
    expect([...first.cells]).toEqual([...second.cells]);
    expect([...first.protect]).toEqual([...second.protect]);
  });

  it('moves the mask with the same offset used by placeContain', () => {
    const mask = new Uint8Array(6);
    mask.fill(1, 0, 6);
    const placed = placeProtectMask(mask, 2, 3, 7, 7);
    expect(placed![0]).toBe(0);
    expect(placed![0 + 7 * 2]).toBe(0);
    expect(placed![(2 + 2) * 7 + 2]).toBe(1);
  });
});

function boundarySource(featureLight: boolean): CellImage {
  const image = blankSource(42, 42);
  const feature = featureLight ? LIGHT : DARK;
  const main = featureLight ? DARK : LIGHT;
  fillBlock(image, main);
  for (let y = 0; y < 42; y += 1) {
    for (let x = 0; x < 42; x += 1) {
      const rx = x % 6;
      const ry = y % 6;
      const inCenterCell = Math.floor(x / 6) === 3 && Math.floor(y / 6) === 3;
      if (inCenterCell && rx < 3 && ry >= 1 && ry < 5) setPixel(image, x, y, feature);
    }
  }
  return image;
}

describe('balanced boundary arbitration', () => {
  it('keeps a balanced boundary cell on the majority side when neighbors agree', () => {
    const source = boundarySource(false);
    const base = downsample(source, 7, 7, 'average', 'white');
    const featured = downsampleWithFeatures(source, 7, 7, 'average', 'white');
    const center = (3 * 7 + 3) * 4;
    expect(base[center]).toBeLessThan(225);
    expect(featured.cells[center]).toBeGreaterThan(220);
    expect(featured.protect[3 * 7 + 3]).toBe(0);
  });

  it('restores a minority feature block when it is surrounded by that color', () => {
    const source = boundarySource(true);
    const featured = downsampleWithFeatures(source, 7, 7, 'average', 'white');
    const center = (3 * 7 + 3) * 4;
    expect(featured.cells[center]).toBeLessThan(60);
  });
});
