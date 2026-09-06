import { describe, expect, it } from 'vitest';
import mard from '../../data/palettes/mard-291.json';
import { displayCode } from '../../src/core/palette/codeStyle';
import { loadPalette, PaletteValidationError } from '../../src/core/palette/loader';

describe('mard-291 palette', () => {
  it('loads 291 solid colors and indexes codes', () => {
    const loaded = loadPalette(mard);
    expect(loaded.solids).toHaveLength(291);
    expect(loaded.indexByCode.get('A01')).toBe(0);
    expect(loaded.indexByCode.get('ZG08')).toBe(290);
  });

  it('rejects duplicate codes with Chinese error', () => {
    const bad = {
      ...mard,
      colors: [...mard.colors, { ...mard.colors[0] }]
    };
    expect(() => loadPalette(bad)).toThrowError(PaletteValidationError);
  });
});

describe('displayCode', () => {
  it('zero pads MARD digits only for presentation', () => {
    expect(displayCode('A1', { zeroPad: 2 })).toBe('A01');
  });
  it('can strip leading brand series letter', () => {
    expect(displayCode('MA1', { stripLeadingBrandChar: true, zeroPad: 2 })).toBe('A01');
  });
});
