const E = 0.04045;
const E_INV = 0.0031308;
const ALPHA = 0.055;

export function srgbByteToLinear(value: number): number {
  const c = Math.max(0, Math.min(255, value)) / 255;
  if (c <= E) return c / 12.92;
  return ((c + ALPHA) / 1.055) ** 2.4;
}

export function linearToSrgbByte(value: number): number {
  const c = Math.max(0, Math.min(1, value));
  const out = c <= E_INV ? c * 12.92 : 1.055 * c ** (1 / 2.4) - ALPHA;
  return Math.round(out * 255);
}

export function srgbToLinearRgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [srgbByteToLinear(rgb[0]), srgbByteToLinear(rgb[1]), srgbByteToLinear(rgb[2])];
}

export function linearRgbToSrgbByte(rgb: readonly [number, number, number]): [number, number, number] {
  return [linearToSrgbByte(rgb[0]), linearToSrgbByte(rgb[1]), linearToSrgbByte(rgb[2])];
}

/** WCAG 相对亮度（0..1）；<0.45 用白字，否则黑字。 */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = srgbToLinearRgb(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
