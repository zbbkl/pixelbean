import { srgbByteToLinear } from '../color/srgb';
import { srgbRgbToLab } from '../color/lab';
import type { LoadedPalette, PaletteColor, PaletteSet } from './types';
import { validatePaletteSet, withRgb } from './validate';

export class PaletteValidationError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(`色表校验失败：${errors.join('；')}`);
    this.name = 'PaletteValidationError';
    this.errors = errors;
  }
}

export function loadPalette(json: unknown): LoadedPalette {
  const errors = validatePaletteSet(json);
  if (errors.length) throw new PaletteValidationError(errors);
  const set = json as PaletteSet;
  const solids: PaletteColor[] = [];
  const indexByCode = new Map<string, number>();

  for (const color of set.colors) {
    if (color.kind !== 'solid') continue;
    const normalized = withRgb(color);
    indexByCode.set(normalized.code, solids.length);
    solids.push(normalized);
  }
  if (!solids.length) {
    throw new PaletteValidationError(['至少需要一个 kind=solid 的参与匹配色']);
  }

  const labs = new Float64Array(solids.length * 3);
  const linearRgb = new Float64Array(solids.length * 3);
  for (let i = 0; i < solids.length; i += 1) {
    const rgb = solids[i].rgb!;
    const lab = srgbRgbToLab(rgb);
    labs[i * 3] = lab[0];
    labs[i * 3 + 1] = lab[1];
    labs[i * 3 + 2] = lab[2];
    linearRgb[i * 3] = srgbByteToLinear(rgb[0]);
    linearRgb[i * 3 + 1] = srgbByteToLinear(rgb[1]);
    linearRgb[i * 3 + 2] = srgbByteToLinear(rgb[2]);
  }

  return {
    set,
    solids,
    codes: solids.map((color) => color.code),
    indexByCode,
    labs,
    linearRgb
  };
}
