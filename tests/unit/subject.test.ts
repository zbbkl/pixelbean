import { describe, expect, it } from 'vitest';
import { convertPipeline } from '../../src/core/pipeline';
import {
  buildRidge,
  despillEdge,
  downsampleMask,
  extractSubject,
  refineMaskGuided,
  SUBJECT_COMPONENT_MIN,
  SUBJECT_RATIO_MIN
} from '../../src/core/pipeline/subject';
import { loadPalette } from '../../src/core/palette/loader';
import { countByColor, sumOccupied } from '../../src/core/pattern';
import { hardSquare, rabbitLike, recovery, softWhiteSubject } from '../support/fixtures';
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

  it('标注去背景实际结果：可信→applied、回退→fallback、关闭态不带该字段', () => {
    const applied = convertPipeline(
      hardSquare().image,
      options(58, 58, { removeBackground: true }),
      palette
    );
    expect(applied.backgroundRemoval).toBe('applied');

    // 近白软边图判不可信 → 兜底回退，界面据此提示「已按不去背景出图」
    const fallback = convertPipeline(
      softWhiteSubject().image,
      options(58, 58, { removeBackground: true }),
      palette
    );
    expect(fallback.backgroundRemoval).toBe('fallback');

    // 关闭态不带该字段（保证关闭态输出与上一版逐格一致，也避免污染 golden）
    const off = convertPipeline(
      hardSquare().image,
      options(58, 58, { removeBackground: false }),
      palette
    );
    expect(off.backgroundRemoval).toBeUndefined();
    expect('backgroundRemoval' in off).toBe(false);
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

/**
 * docs/43 §4：白底白身软边类图的**结果级红线门**。
 * 这类图（docs/39 的核心失败样例）不允许出现「认了可信、但主体被吃掉大半」——
 * 那正是 docs/39 P0「去背景变去主体」。允许的只有两种结局：
 * ① 不可信 → 完全回退全主体（等价未去背景）；② 可信 → 主体基本保全。
 */
describe('extractSubject 门禁（docs/43 §4 软边/近白类图）', () => {
  const cases = [
    ['softWhiteSubject（§4.1 白底白身软边）', softWhiteSubject],
    ['rabbitLike（白底白身 + 软阴影 + 噪点）', rabbitLike]
  ] as const;

  for (const [name, make] of cases) {
    it(`不吞主体、不产空图纸：${name}`, () => {
      const fixture = make();
      const result = extractSubject(fixture.image);
      const quality = recovery(result.mask, fixture.truth);

      expect(result.mask.some((value) => value === 1)).toBe(true);
      if (result.reliable) {
        expect(quality.recovery).toBeGreaterThanOrEqual(0.9);
      } else {
        expect([...result.mask].every((value) => value === 1)).toBe(true);
        expect(result.bbox).toEqual({
          x0: 0,
          y0: 0,
          x1: fixture.image.width - 1,
          y1: fixture.image.height - 1
        });
      }
    });
  }

  it('可信时主体连通、覆盖中心且占比达标', () => {
    const fixture = hardSquare();
    const result = extractSubject(fixture.image);
    expect(result.reliable).toBe(true);
    expect(result.subjectRatio).toBeGreaterThanOrEqual(SUBJECT_RATIO_MIN);
    expect(result.largestComponentRatio).toBeGreaterThan(0.9);
    const center =
      Math.floor(fixture.image.height / 2) * fixture.image.width +
      Math.floor(fixture.image.width / 2);
    expect(result.mask[center]).toBe(1);
  });

  it('硬边主体逐格精确：既不侵蚀也不外扩（B-2 接入方式的回归门）', () => {
    const fixture = hardSquare();
    const result = extractSubject(fixture.image);
    let subject = 0;
    let truth = 0;
    let extra = 0;
    for (let i = 0; i < fixture.truth.length; i += 1) {
      if (result.mask[i]) subject += 1;
      if (fixture.truth[i]) truth += 1;
      else if (result.mask[i]) extra += 1;
    }
    expect(subject).toBe(truth);
    expect(extra).toBe(0);
  });
});

describe('B-1 多尺度结构脊', () => {
  it('平坦背景不成脊', () => {
    const image = makeImage(64, 64, [250, 250, 250]);
    const ridge = buildRidge(image.data, 64, 64);
    let max = 0;
    for (const value of ridge) if (value > max) max = value;
    expect(max).toBeLessThan(0.1);
  });

  it('宽软边成脊，且脊峰值落在过渡带内、远高于平坦区', () => {
    const width = 96;
    const height = 48;
    const image = makeImage(width, height, [250, 250, 250]);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= 60) setPx(image, x, y, [200, 200, 200]);
        else if (x >= 36) {
          const t = (x - 36) / 24;
          const v = Math.round(250 - 50 * t);
          setPx(image, x, y, [v, v, v]);
        }
      }
    }
    const ridge = buildRidge(image.data, width, height);
    const at = (x: number, y: number) => ridge[y * width + x];
    let flatMax = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 24; x += 1) if (at(x, y) > flatMax) flatMax = at(x, y);
    }
    let bandMax = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 36; x < 60; x += 1) if (at(x, y) > bandMax) bandMax = at(x, y);
    }
    expect(flatMax).toBeLessThan(0.5);
    expect(bandMax).toBeGreaterThan(1);
    expect(bandMax).toBeGreaterThan(flatMax * 10);
  });

  it('脊屏障只可能保留像素（阈值越低，保留的主体越多）', () => {
    const fixture = hardSquare();
    const strict = extractSubject(fixture.image, { edge: 8 });
    const loose = extractSubject(fixture.image, { edge: 12 });
    let strictCount = 0;
    let looseCount = 0;
    for (let i = 0; i < strict.mask.length; i += 1) {
      if (strict.mask[i]) strictCount += 1;
      if (loose.mask[i]) looseCount += 1;
    }
    expect(strictCount).toBeGreaterThanOrEqual(looseCount);
  });
});

describe('B-2 引导滤波掩码精修', () => {
  it('平坦引导区直接阈值化会侵蚀掩码（故接入时只取并集，不收缩）', () => {
    const width = 32;
    const height = 32;
    const image = makeImage(width, height, [250, 250, 250]);
    const mask = new Uint8Array(width * height);
    for (let y = 12; y < 20; y += 1) {
      for (let x = 12; x < 20; x += 1) mask[y * width + x] = 1;
    }
    const refined = refineMaskGuided(image.data, mask, width, height);
    let input = 0;
    let output = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (mask[i]) input += 1;
      if (refined[i]) output += 1;
    }
    expect(output).toBeLessThan(input);
    expect(refined[12 * width + 12]).toBe(0);
  });
});

describe('B-4 边缘 despill', () => {
  it('贴背景的主体边缘像素按强度拉向主体中值色；内部与背景不动', () => {
    const width = 7;
    const height = 7;
    const cells = new Uint8ClampedArray(width * height * 4).fill(255);
    const mask = new Uint8Array(width * height);
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        const offset = (y * width + x) * 4;
        cells[offset] = 235;
        cells[offset + 1] = 196;
        cells[offset + 2] = 160;
        mask[y * width + x] = 1;
      }
    }
    const corner = (2 * width + 2) * 4;
    cells[corner] = 250;
    cells[corner + 1] = 245;
    cells[corner + 2] = 240;
    despillEdge(cells, mask, width, height);
    expect([cells[corner], cells[corner + 1], cells[corner + 2]]).toEqual([241, 216, 192]);
    const interior = (3 * width + 3) * 4;
    expect([cells[interior], cells[interior + 1], cells[interior + 2]]).toEqual([235, 196, 160]);
    expect([cells[0], cells[1], cells[2]]).toEqual([255, 255, 255]);
  });
});
