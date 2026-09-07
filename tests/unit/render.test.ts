import { describe, expect, it, vi } from 'vitest';
import mard from '../../data/palettes/mard-291.json';
import { loadPalette } from '../../src/core/palette/loader';
import { drawGrid } from '../../src/core/render/drawGrid';
import { optionsFixture } from './fixture-options';
import { solidPattern } from './fixture-pattern';

function mockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn()
  } as unknown as CanvasRenderingContext2D;
}

describe('drawGrid LOD', () => {
  it('draws no text below 14 px cells', () => {
    const palette = loadPalette(mard);
    const ctx = mockContext();
    drawGrid(ctx, solidPattern(4, 4, optionsFixture()), palette, {
      cellPx: 13,
      offsetX: 0,
      offsetY: 0,
      showCodes: true,
      showGridLines: false
    });
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('draws codes above the LOD threshold', () => {
    const palette = loadPalette(mard);
    const ctx = mockContext();
    drawGrid(ctx, solidPattern(4, 4, optionsFixture()), palette, {
      cellPx: 16,
      offsetX: 0,
      offsetY: 0,
      showCodes: true,
      showGridLines: false
    });
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('honors the optional visible range without drawing outside it', () => {
    const palette = loadPalette(mard);
    const ctx = mockContext();
    drawGrid(ctx, solidPattern(10, 10, optionsFixture()), palette, {
      cellPx: 10,
      offsetX: 0,
      offsetY: 0,
      showCodes: false,
      showGridLines: false
    }, { col0: 2, row0: 3, col1: 5, row1: 6 });
    expect(ctx.fillRect).toHaveBeenCalledTimes(9);
  });
});
