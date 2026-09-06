import { describe, expect, it } from 'vitest';
import { loadPalette } from '../../src/core/palette/loader';
import { runPostPipeline } from '../../src/core/post';
import { convertPipeline } from '../../src/core/pipeline';
import type { CellImage, ConvertOptions, Pattern, PostOptions } from '../../src/types';

const palette = loadPalette({
  schemaVersion: '1.0',
  id: 'post-pipeline-test',
  label: 'Pipeline test',
  brand: 'Test',
  standard: '1',
  quality: 'community-legacy',
  source: 'test',
  license: 'MIT',
  colors: [
    { code: 'W01', hex: '#FFFFFF', kind: 'solid' },
    { code: 'Y01', hex: '#F5E6A8', kind: 'solid' },
    { code: 'R01', hex: '#D9352B', kind: 'solid' },
    { code: 'K01', hex: '#1C1A17', kind: 'solid' }
  ]
});

const W = palette.indexByCode.get('W01')!;
const Y = palette.indexByCode.get('Y01')!;
const R = palette.indexByCode.get('R01')!;
const K = palette.indexByCode.get('K01')!;

function patternFrom(rows: number[][]): Pattern {
  const height = rows.length;
  const width = rows[0].length;
  const cells = new Int16Array(width * height);
  rows.forEach((row, y) => row.forEach((value, x) => {
    cells[y * width + x] = value;
  }));
  return {
    paletteId: 'post-pipeline-test',
    width,
    height,
    cells,
    codes: palette.codes,
    options: {
      paletteId: 'post-pipeline-test',
      width,
      height,
      bg: 'white',
      mode: 'average',
      maxColors: null,
      dither: 'none'
    }
  };
}

const postOff: PostOptions = {
  speckleClean: false,
  speckleMax: 2,
  speckleDeltaE: 30,
  shadowSimplify: 0,
  maxColors: null,
  outline: false,
  outlineTau: 0.18
};

const postCartoon: PostOptions = {
  speckleClean: true,
  speckleMax: 2,
  speckleDeltaE: 30,
  shadowSimplify: 1,
  maxColors: 2,
  outline: true,
  outlineTau: 0.18
};

function makeOptions(overrides: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    paletteId: 'post-pipeline-test',
    width: 5,
    height: 5,
    bg: 'white',
    mode: 'average',
    maxColors: null,
    dither: 'none',
    ...overrides
  };
}

describe('runPostPipeline', () => {
  it('applies H1-H4 in fixed order and stays within the color budget', () => {
    const pattern = patternFrom([
      [W, Y, W, W, W],
      [Y, R, Y, W, W],
      [W, Y, W, W, W],
      [W, W, W, R, R],
      [W, W, W, R, R]
    ]);
    const result = runPostPipeline(pattern, palette, postCartoon);
    const used = new Set(result.cells.filter((cell) => cell >= 0));
    expect(used.size).toBeLessThanOrEqual(3); // K=2 + possible outline color
    expect(result.cells[0]).toBeGreaterThanOrEqual(0);
  });

  it('keeps -1 empty cells empty', () => {
    const pattern = patternFrom([
      [-1, -1, -1],
      [-1, W, Y],
      [-1, W, Y]
    ]);
    const result = runPostPipeline(pattern, palette, postCartoon);
    expect(result.cells[0]).toBe(-1);
    expect(result.cells[1]).toBe(-1);
    expect(result.cells[2]).toBe(-1);
    expect(result.cells[3]).toBe(-1);
  });
});

describe('convertPipeline post integration', () => {
  const source: CellImage = {
    width: 5,
    height: 5,
    data: (() => {
      const data = new Uint8ClampedArray(5 * 5 * 4);
      for (let y = 0; y < 5; y += 1) {
        for (let x = 0; x < 5; x += 1) {
          const rgb = x < 2 ? [255, 240, 200] : x < 4 ? [220, 70, 50] : [25, 25, 25];
          const i = (y * 5 + x) * 4;
          data.set(rgb, i);
          data[i + 3] = 255;
        }
      }
      return data;
    })()
  };

  it('all-off post produces the same cells as omitting post', () => {
    const without = convertPipeline(source, makeOptions(), palette);
    const withPost = convertPipeline(source, makeOptions({ post: postOff }), palette);
    expect([...withPost.cells]).toEqual([...without.cells]);
  });

  it('enabled cartoon post runs deterministically through the full pipeline', () => {
    const first = convertPipeline(source, makeOptions({ post: postCartoon }), palette);
    const second = convertPipeline(source, makeOptions({ post: postCartoon }), palette);
    expect([...first.cells]).toEqual([...second.cells]);
    expect(first.cells.every((cell) => cell === -1 || cell >= 0)).toBe(true);
  });

  it('board contain blanks remain untouched after outline', () => {
    const result = convertPipeline(
      source,
      makeOptions({
        width: 7,
        height: 7,
        post: postCartoon,
        contain: { contentWidth: 5, contentHeight: 5 }
      }),
      palette
    );
    const blankIndices = [
      0, 1, 2, 3, 4, 5, 6,
      7, 13, 14, 20, 21, 27, 28, 34, 35, 41,
      42, 43, 44, 45, 46, 47, 48
    ];
    expect(blankIndices.map((index) => result.cells[index]).every((cell) => cell === -1)).toBe(true);
  });
});
