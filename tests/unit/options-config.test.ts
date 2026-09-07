import { describe, expect, it } from 'vitest';
import { MAX_CELLS, MAX_COLOR_STEPS } from '../../src/app/options';
import { boardPresets } from '../../src/app/boardPresets';
import { defaultSettings } from '../../src/app/state';

describe('v1.2.1 config constants', () => {
  it('exposes the mainstream color steps', () => {
    expect(MAX_COLOR_STEPS).toEqual([24, 48, 72, 96, 120, 144, 168, 221, 313]);
    expect(MAX_COLOR_STEPS).toContain(24);
    expect(MAX_COLOR_STEPS).toContain(313);
  });

  it('keeps square-board defaults inside the preset list', () => {
    expect(boardPresets.some((preset) => preset.side === defaultSettings.boardSide)).toBe(true);
  });

  it('keeps the largest board below the cell budget', () => {
    const largest = Math.max(...boardPresets.map((preset) => preset.side));
    expect(largest * largest).toBeLessThanOrEqual(MAX_CELLS);
  });
});
