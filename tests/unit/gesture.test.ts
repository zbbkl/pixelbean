import { describe, expect, it } from 'vitest';
import { clampPan, PADDING } from '../../src/app/gesture';

const MARGIN = 24;

describe('clampPan', () => {
  it('keeps at least a margin of the grid visible when panned far off-screen', () => {
    // 116×116 网格在 zoom=12 下为 1392px，视口 390×600；拖到极端也不应整张消失。
    const result = clampPan(1392, 1392, 390, 600, -9999, 9999);
    expect(result.panX).toBe(MARGIN - PADDING - 1392); // -1408
    expect(result.panY).toBe(600 - MARGIN - PADDING); // 536
  });

  it('leaves in-bounds pan unchanged', () => {
    const result = clampPan(1392, 1392, 390, 600, 0, 0);
    expect(result).toEqual({ panX: 0, panY: 0 });
  });

  it('clamps each axis independently', () => {
    const result = clampPan(1392, 1000, 390, 600, -5000, 42);
    expect(result.panX).toBe(-1408);
    expect(result.panY).toBe(42); // 42 在 [-1016, 536] 内，保持不变
  });
});
