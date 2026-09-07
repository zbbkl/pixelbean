import { describe, expect, it } from 'vitest';
import { applyUiSettingsPatch, defaultSettings, initialState, appReducer } from '../../src/app/state';

describe('target-mode custom linkage', () => {
  it('defaults to the photo preset with the v1.2.1 profile', () => {
    expect(defaultSettings).toMatchObject({
      targetMode: 'photo',
      gridMode: 'long-edge',
      longEdge: 58,
      boardSide: 52,
      maxColorsEnabled: false,
      maxColors: 32,
      speckleClean: false,
      shadowSimplify: 0,
      outline: false,
      protectFeatures: true
    });
  });

  it('keeps the current preset when a new preset is selected', () => {
    const patch = applyUiSettingsPatch({ targetMode: 'cartoon', maxColors: 24 });
    expect(patch.targetMode).toBe('cartoon');
  });

  it('marks settings custom after any manual conversion parameter change', () => {
    const patch = applyUiSettingsPatch({ maxColors: 12 });
    expect(patch.targetMode).toBe('custom');
  });

  it('does not mark view-only toggles as custom', () => {
    expect(applyUiSettingsPatch({ showCodes: false })).toEqual({ showCodes: false });
    expect(applyUiSettingsPatch({ showGridLines: true })).toEqual({ showGridLines: true });
  });

  it('stores new post defaults through the reducer', () => {
    const state = initialState({});
    const next = appReducer(state, {
      type: 'settings',
      patch: { targetMode: 'cartoon', shadowSimplify: 1 }
    });
    expect(next.settings).toMatchObject({
      targetMode: 'cartoon',
      shadowSimplify: 1,
      speckleClean: defaultSettings.speckleClean,
      outline: defaultSettings.outline
    });
  });

  it('marks palette changes as custom through the reducer', () => {
    const state = initialState({});
    const next = appReducer(state, { type: 'setPalette', id: 'another-brand' });
    expect(next.settings.paletteId).toBe('another-brand');
    expect(next.settings.targetMode).toBe('custom');
  });
});
