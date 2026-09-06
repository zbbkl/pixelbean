import { describe, expect, it } from 'vitest';
import hama from '../../data/palettes/hama-midi.json';
import perler from '../../data/palettes/perler-standard.json';
import { loadPalette } from '../../src/core/palette/loader';
import { builtinPaletteSets } from '../../src/generated/palettes';

describe('v1.1 multi-brand palettes', () => {
  it('ships Perler standard and Hama midi in the generated registry', () => {
    expect(Object.keys(builtinPaletteSets)).toEqual(
      expect.arrayContaining(['mard-291', 'perler-standard', 'hama-midi'])
    );
  });

  it('loads Perler 103 solid colors with unique retail codes', () => {
    expect(perler.colors).toHaveLength(103);
    const loaded = loadPalette(perler);
    expect(loaded.solids).toHaveLength(103);
    expect(new Set(perler.colors.map((color) => color.code)).size).toBe(103);
    expect(perler.colors[0].code).toMatch(/^80-/);
  });

  it('loads Hama 92 entries and excludes special/transparent from matching', () => {
    expect(hama.colors).toHaveLength(92);
    const loaded = loadPalette(hama);
    expect(loaded.solids).toHaveLength(82);
    expect(hama.colors.some((color) => color.kind === 'transparent' && color.nameEn === 'Clear')).toBe(true);
    expect(loaded.indexByCode.get('H19')).toBeUndefined();
  });

  it('keeps provenance and quality fields for both new palettes', () => {
    expect(perler.license).toBe('MIT');
    expect(hama.license).toBe('MIT');
    expect(hama.quality).toBe('community-legacy');
    expect(perler.quality).toBe('community-legacy');
    expect(perler.source).toContain('maxcleme');
    expect(hama.source).toContain('beadmachine');
  });
});
