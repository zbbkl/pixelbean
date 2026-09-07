import { describe, expect, it } from 'vitest';
import { boardPresets, longEdgePresets } from '../../src/app/boardPresets';

describe('board presets v1.2.1', () => {
  it('exposes mainstream square-board sizes in contract order', () => {
    expect(boardPresets.map((preset) => preset.side)).toEqual([32, 52, 78, 104, 120]);
    expect(boardPresets.map((preset) => preset.label)).toEqual([
      '32 × 32',
      '52 × 52',
      '78 × 78',
      '104 × 104',
      '120 × 120'
    ]);
  });

  it('defaults to the 52 board', () => {
    expect(boardPresets[1]).toMatchObject({ id: 'board-52', side: 52 });
  });

  it('still exposes long-edge presets', () => {
    expect(longEdgePresets.map((preset) => preset.value)).toContain(200);
  });
});
