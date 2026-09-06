import { describe, expect, it } from 'vitest';
import { boardPresets, longEdgePresets } from '../../src/app/boardPresets';

describe('board presets v1.1', () => {
  it('adds the 116x116 square board preset', () => {
    const board116 = boardPresets.find((preset) => preset.side === 116);
    expect(board116?.label).toBe('116 × 116');
  });

  it('keeps board sides unique', () => {
    const sides = boardPresets.map((preset) => preset.side);
    expect(new Set(sides).size).toBe(sides.length);
  });

  it('still exposes long-edge presets', () => {
    expect(longEdgePresets.map((preset) => preset.value)).toContain(200);
  });
});
