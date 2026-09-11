/**
 * 去背景验收门禁 G1–G7（docs/41 §B.4 / docs/43 §4.3）。
 *
 * 与 docs/43 §4.3 的三处差异（诚实说明，详见 docs/44）：
 * 1. 真实样例 `.tools/diag-v12final/rabbit-source.png` 是本地工具产物（`.tools/` 被 .gitignore 忽略），
 *    本仓库不存在 → G1–G3 由**确定性替身** `rabbitLike()`（白底 + 近白主体 + 软接触阴影 + 噪点）承担，
 *    真实样例侧改用仓库自带 `public/samples/sample-cartoon.png` 与 `tests/fixtures/sample-photo.png`
 *    （后者由 `public/samples/sample-photo.jpg` 无损转码）。
 * 2. `.tools/acceptance/gate-b.mjs` 无法入库 → 门禁改为可进 CI 的 vitest。
 * 3. G4 的「关闭态主体格数」按「关闭态不受去背景影响，其主体格数即掩码判定的主体格数」理解。
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { convertPipeline } from '../../src/core/pipeline';
import { downsampleMask, extractSubject } from '../../src/core/pipeline/subject';
import { loadPalette } from '../../src/core/palette/loader';
import { sumOccupied } from '../../src/core/pattern';
import { MODE_PRESETS } from '../../src/core/post/modePresets';
import { defaultSettings } from '../../src/app/state';
import { hardSquare, rabbitLike, recovery, softWhiteSubject, type Fixture } from '../support/fixtures';
import { maskToImage, readPng, writePng } from '../support/png';
import type { CellImage, ConvertOptions, Pattern } from '../../src/types';

const BOARD = 58;

const palette = loadPalette({
  schemaVersion: '1.0',
  id: 'gate',
  label: 'Gate',
  brand: 'Test',
  standard: '1',
  quality: 'community-legacy',
  source: 'test',
  license: 'MIT',
  colors: [
    { code: 'WHITE', hex: '#FFFFFF', kind: 'solid' },
    { code: 'BODY', hex: '#F7F3EE', kind: 'solid' },
    { code: 'DARK', hex: '#27313C', kind: 'solid' },
    { code: 'PINK', hex: '#F2CDD2', kind: 'solid' },
    { code: 'SKIN', hex: '#EBC4A0', kind: 'solid' }
  ]
});

function options(overrides: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    paletteId: 'gate',
    width: BOARD,
    height: BOARD,
    bg: 'white',
    mode: 'dominant',
    maxColors: null,
    dither: 'none',
    ...overrides
  };
}

function realSample(relative: string): CellImage {
  return readPng(resolve(process.cwd(), relative));
}

/**
 * 可选证据落盘（供人工目检，docs/43 §4.3）：设置 EVIDENCE_DIR 后把掩码/主体写成 PNG。
 * 例：`$env:EVIDENCE_DIR='.tools/acceptance/out'; npx vitest run tests/acceptance/subject-gate.test.ts`
 */
function dumpEvidence(label: string, image: CellImage): void {
  const dir = process.env.EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const subject = extractSubject(image);
  writePng(resolve(dir, `mask-${label}.png`), maskToImage(subject.mask, image.width, image.height));
  writePng(resolve(dir, `subject-${label}.png`), {
    width: image.width,
    height: image.height,
    data: subject.cells
  });
}

function downsampledSubject(image: CellImage, width = BOARD, height = BOARD): Uint8Array {
  const subject = extractSubject(image);
  return downsampleMask(subject.mask, image.width, image.height, width, height);
}

function transparentIndices(pattern: Pattern): number[] {
  const out: number[] = [];
  for (let i = 0; i < pattern.cells.length; i += 1) if (pattern.cells[i] < 0) out.push(i);
  return out;
}

function occupiedIndices(pattern: Pattern): number[] {
  const out: number[] = [];
  for (let i = 0; i < pattern.cells.length; i += 1) if (pattern.cells[i] >= 0) out.push(i);
  return out;
}

function countOnes(mask: Uint8Array): number {
  let n = 0;
  for (const value of mask) if (value) n += 1;
  return n;
}

/** 4 连通分量数 + 是否触板边。 */
function shape(indices: number[], width: number, height: number): { count: number; touchesBorder: boolean } {
  const set = new Set(indices);
  const seen = new Set<number>();
  let count = 0;
  let touchesBorder = false;
  for (const start of indices) {
    if (seen.has(start)) continue;
    count += 1;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const at = stack.pop()!;
      const x = at % width;
      const y = Math.floor(at / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const neighbours = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        y > 0 ? at - width : -1,
        y < height - 1 ? at + width : -1
      ];
      for (const next of neighbours) {
        if (next >= 0 && set.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return { count, touchesBorder };
}

describe('去背景验收门禁 G1–G7（docs/41 §B.4 / docs/43 §4.3）', () => {
  it('G1–G3：近白软边类图逐项实测 + 结果级红线', () => {
    const cases: [string, Fixture][] = [
      ['softWhiteSubject（§4.1）', softWhiteSubject()],
      ['rabbitLike（替身）', rabbitLike()]
    ];
    for (const [name, fixture] of cases) {
      const subject = extractSubject(fixture.image);
      const quality = recovery(subject.mask, fixture.truth);
      const pattern = convertPipeline(fixture.image, options({ removeBackground: true }), palette);
      dumpEvidence(name, fixture.image);
      console.log(
        `G1 reliable=${subject.reliable} G1 subjectRatio=${subject.subjectRatio.toFixed(3)} G3 largestComponentRatio=${subject.largestComponentRatio.toFixed(3)} | ${name}: 真值主体=${quality.truth}px 掩码保回=${(quality.recovery * 100).toFixed(1)}% 出图占用=${sumOccupied(pattern)}`
      );
      expect(subject.mask.some((value) => value === 1)).toBe(true);
      if (subject.reliable) {
        // 红线：认了可信就必须基本保住主体
        expect(quality.recovery).toBeGreaterThanOrEqual(0.9);
      } else {
        // 不可信 → 开启态必须逐格等于「未去背景」
        const off = convertPipeline(fixture.image, options({ removeBackground: false }), palette);
        expect([...pattern.cells]).toEqual([...off.cells]);
        expect(transparentIndices(pattern).length).toBe(0);
      }
    }
  });

  it('G4：开启态主体格数 ≥ 掩码主体格数 × 0.9（不吞主体）', () => {
    const cases: [string, Fixture][] = [
      ['hardSquare', hardSquare()],
      ['sample-photo', { image: realSample('tests/fixtures/sample-photo.png'), truth: new Uint8Array(0) }],
      ['sample-cartoon', { image: realSample('public/samples/sample-cartoon.png'), truth: new Uint8Array(0) }]
    ];
    for (const [name, fixture] of cases) {
      const grid = downsampledSubject(fixture.image);
      const maskCells = countOnes(grid);
      const on = convertPipeline(fixture.image, options({ removeBackground: true }), palette);
      const off = convertPipeline(fixture.image, options({ removeBackground: false }), palette);
      let kept = 0;
      for (let i = 0; i < grid.length; i += 1) if (grid[i] && on.cells[i] >= 0) kept += 1;
      console.log(
        `G4 ${name}: 掩码主体格=${maskCells} 开启态保住=${kept} 开启态占用=${sumOccupied(on)} 关闭态占用=${sumOccupied(off)}`
      );
      if (maskCells > 0) expect(kept).toBeGreaterThanOrEqual(Math.floor(maskCells * 0.9));
    }
  });

  it('G5：真实样例无「透明锯齿边框 + 背景残块环绕」', () => {
    for (const relative of ['tests/fixtures/sample-photo.png', 'public/samples/sample-cartoon.png']) {
      const image = realSample(relative);
      const pattern = convertPipeline(image, options({ removeBackground: true }), palette);
      dumpEvidence(relative.replace(/[\\/]/g, '_'), image);
      const cleared = transparentIndices(pattern);
      const kept = occupiedIndices(pattern);
      const clearedShape = shape(cleared, BOARD, BOARD);
      const keptShape = shape(kept, BOARD, BOARD);
      console.log(
        `G5 ${relative}: 透明格=${cleared.length} 透明分量=${clearedShape.count} 透明触边=${clearedShape.touchesBorder} 主体分量=${keptShape.count}`
      );
      expect(sumOccupied(pattern)).toBeGreaterThan(0);
      if (cleared.length > 0) {
        // 抠掉的必须是一整片连着板边的背景；剩下的主体必须单连通（无残块/锯齿）
        expect(clearedShape.count).toBe(1);
        expect(clearedShape.touchesBorder).toBe(true);
        expect(keptShape.count).toBe(1);
      }
    }
  });

  it('G6：纯色/极简图不产空图纸', () => {
    const data = new Uint8ClampedArray(60 * 60 * 4);
    for (let i = 0; i < 60 * 60; i += 1) {
      data[i * 4] = 220;
      data[i * 4 + 1] = 30;
      data[i * 4 + 2] = 30;
      data[i * 4 + 3] = 255;
    }
    const flat: CellImage = { width: 60, height: 60, data };
    const on = convertPipeline(flat, options({ removeBackground: true }), palette);
    const off = convertPipeline(flat, options({ removeBackground: false }), palette);
    expect(sumOccupied(on)).toBeGreaterThan(0);
    expect(transparentIndices(on).length).toBe(0);
    expect(sumOccupied(on)).toBe(sumOccupied(off));
  });

  it('G7：确定性 + 关闭态不走抠图分支 + 默认关闭决策锁', () => {
    const fixtures = [rabbitLike(), softWhiteSubject(), hardSquare()];
    for (const fixture of fixtures) {
      const first = convertPipeline(fixture.image, options({ removeBackground: true }), palette);
      const second = convertPipeline(fixture.image, options({ removeBackground: true }), palette);
      expect([...first.cells]).toEqual([...second.cells]);

      // 关闭态：绝不产生透明格（= 不走抠图分支，逐格等价上一版）
      const off = convertPipeline(fixture.image, options({ removeBackground: false }), palette);
      expect(transparentIndices(off).length).toBe(0);
    }

    // G1–G4 未通过（实测见 docs/44）→ 默认必须保持关闭
    expect(defaultSettings.removeBackground).toBe(false);
    expect(MODE_PRESETS.photo.removeBackground).toBe(false);
    expect(MODE_PRESETS.cartoon.removeBackground).toBe(false);
  });
});
