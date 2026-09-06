import type { ConvertOptions } from '../../src/types';

export function optionsFixture(): ConvertOptions {
  return {
    paletteId: 'mard-291',
    width: 4,
    height: 4,
    bg: 'white',
    mode: 'average',
    maxColors: null,
    dither: 'none'
  };
}
