import { describe, expect, it } from 'vitest';
import {
  centerPan,
  fitZoom,
  visibleCellRange,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAround,
  zoomCentered
} from '../../src/app/viewport';
import { clampPan, PADDING } from '../../src/app/gesture';

describe('fitZoom', () => {
  it('fits to the width when width is the tighter constraint and floors >=1', () => {
    expect(fitZoom(1000, 800, 100, 50)).toBe(9);
  });

  it('fits to the height when height is the tighter constraint', () => {
    expect(fitZoom(800, 500, 100, 200)).toBe(2);
  });

  it('allows zoom below 1 for grids wider than a small viewport', () => {
    expect(fitZoom(70, 70, 200, 200)).toBeCloseTo(0.19, 2);
  });

  it('keeps zoom inside [ZOOM_MIN, ZOOM_MAX] for extreme viewports', () => {
    expect(fitZoom(10, 10, 2, 2)).toBe(ZOOM_MIN);
    expect(fitZoom(100000, 100000, 1, 1)).toBe(ZOOM_MAX);
  });
});

describe('centerPan', () => {
  it('centers the grid screen rectangle in the viewport', () => {
    const pan = centerPan(600, 400, 10, 40, 20);
    expect(Math.abs((600 - 40 * 10) / 2 - (PADDING + pan.panX))).toBeLessThan(1e-6);
    expect(Math.abs((400 - 20 * 10) / 2 - (PADDING + pan.panY))).toBeLessThan(1e-6);
  });
});

describe('zoomAround', () => {
  it('keeps the grid point under the local anchor stationary', () => {
    const view = { zoom: 4, panX: -200, panY: -90 };
    const localX = 611;
    const localY = 345;
    const wx = (localX - PADDING - view.panX) / view.zoom;
    const wy = (localY - PADDING - view.panY) / view.zoom;
    const next = zoomAround(view, localX, localY, 1.6);
    expect((localX - PADDING - next.panX) / next.zoom).toBeCloseTo(wx, 9);
    expect((localY - PADDING - next.panY) / next.zoom).toBeCloseTo(wy, 9);
  });

  it('clamps to ZOOM_MAX after repeated zoom-in and pan stays monotonic', () => {
    let view = { zoom: 1, panX: 0, panY: 0 };
    for (let i = 0; i < 60; i += 1) view = zoomAround(view, 300, 250, 1.12);
    expect(view.zoom).toBe(ZOOM_MAX);
    expect(view.panX).toBeLessThan(0);
    expect(view.panY).toBeLessThan(0);
  });

  it('zoomCentered keeps the viewport center anchored', () => {
    const view = { zoom: 5, panX: -100, panY: -50 };
    const next = zoomCentered(view, 800, 600, 2);
    const wx = (400 - PADDING - view.panX) / view.zoom;
    const wy = (300 - PADDING - view.panY) / view.zoom;
    expect((400 - PADDING - next.panX) / next.zoom).toBeCloseTo(wx, 9);
    expect((300 - PADDING - next.panY) / next.zoom).toBeCloseTo(wy, 9);
  });
});

describe('visibleCellRange', () => {
  const grid = { col0: 0, row0: 0, col1: 100, row1: 50 };

  it('returns the full grid when it covers a wider canvas', () => {
    expect(visibleCellRange(100, 50, 0, 0, 16, 2000, 1000)).toEqual(grid);
  });

  it('clips cells partly outside the canvas', () => {
    const range = visibleCellRange(100, 50, -120, 30, 16, 800, 600);
    expect(range?.col0).toBe(7);
    expect(range?.col1).toBe(58);
    expect(range?.row0).toBe(0);
    expect(range?.row1).toBe(36);
  });

  it('returns null when the whole grid is above-left of the canvas', () => {
    expect(visibleCellRange(100, 50, 5000, 3000, 16, 800, 600)).toBeNull();
  });

  it('keeps grid bounds intact after clampPan', () => {
    const pan = clampPan(19200, 19200, 900, 700, -90000, 90000);
    const range = visibleCellRange(200, 200, PADDING + pan.panX, 0, 96, 900, 700);
    expect(range).not.toBeNull();
    expect(range!.col0).toBeLessThan(range!.col1);
  });
});
