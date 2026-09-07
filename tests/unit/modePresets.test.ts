import { describe, expect, it } from 'vitest';
import {
  MODE_PRESETS,
  applyMode,
  modeOptions
} from '../../src/core/post/modePresets';
import { defaultSettings } from '../../src/app/state';

describe('modePresets', () => {
  it('exposes the four one-click modes', () => {
    expect(modeOptions.map((option) => option.id)).toEqual(['photo', 'cartoon', 'lineart', 'pixel']);
  });

  it('cartoon preset applies post-processing defaults', () => {
    const patch = applyMode('cartoon', defaultSettings);
    expect(patch).toMatchObject({
      targetMode: 'cartoon',
      mode: 'dominant',
      maxColorsEnabled: true,
      maxColors: 24,
      shadowSimplify: 1,
      speckleClean: true,
      speckleMax: 2,
      outline: true,
      outlineTau: 0.18,
      dither: 'none',
      protectFeatures: true
    });
  });

  it('protectFeatures defaults follow the mode table', () => {
    expect(MODE_PRESETS.cartoon.protectFeatures).toBe(true);
    expect(MODE_PRESETS.photo.protectFeatures).toBe(true);
    expect(MODE_PRESETS.lineart.protectFeatures).toBe(false);
    expect(MODE_PRESETS.pixel.protectFeatures).toBe(false);
  });

  it('photo preset carries the v1.2.1 default photo profile', () => {
    const patch = applyMode('photo', defaultSettings);
    expect(patch).toMatchObject({
      targetMode: 'photo',
      mode: 'dominant',
      maxColorsEnabled: false,
      maxColors: 32,
      shadowSimplify: 0,
      speckleClean: false,
      speckleMax: 2,
      outline: false,
      protectFeatures: true
    });
  });

  it('lineart and pixel use dominant sampling', () => {
    expect(MODE_PRESETS.lineart.mode).toBe('dominant');
    expect(MODE_PRESETS.lineart.maxColors).toBe(16);
    expect(MODE_PRESETS.pixel.mode).toBe('dominant');
    expect(MODE_PRESETS.pixel.maxColorsEnabled).toBe(false);
  });

  it('photo preset leaves dither at none for deterministic base', () => {
    const patch = applyMode('photo', defaultSettings);
    expect(patch.dither).toBe('none');
    expect(patch.speckleClean).toBe(false);
    expect(patch.shadowSimplify).toBe(0);
    expect(patch.protectFeatures).toBe(true);
  });

  it('applyMode keeps current color adjustments', () => {
    const current = {
      ...defaultSettings,
      adjust: { brightness: 10, contrast: -5, saturation: 7 }
    };
    expect(applyMode('cartoon', current).adjust).toEqual(current.adjust);
  });
});
