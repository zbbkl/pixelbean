import type { Pattern } from '../../src/types';
import type { ConvertOptions } from '../../src/types';

export function solidPattern(width: number, height: number, options: ConvertOptions): Pattern {
  const cells = new Int16Array(width * height).fill(0);
  return {
    paletteId: options.paletteId,
    width,
    height,
    cells,
    codes: ['A01'],
    options
  };
}
