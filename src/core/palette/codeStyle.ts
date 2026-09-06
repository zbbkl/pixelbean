import type { PaletteCodeStyle } from './types';

export function displayCode(code: string, style?: PaletteCodeStyle): string {
  let out = code;
  if (style?.stripLeadingBrandChar && /^[A-Z][A-Z]/.test(out)) {
    out = out.slice(1);
  }
  const pad = style?.zeroPad ?? 0;
  if (pad > 0) {
    const match = out.match(/^([A-Za-z]+)(\d+)$/);
    if (match) out = `${match[1].toUpperCase()}${match[2].padStart(pad, '0')}`;
  }
  return out;
}

export function hexOf(color: { hex: string | null; rgb?: [number, number, number] }): string | null {
  if (color.hex) return color.hex.toUpperCase();
  if (color.rgb) {
    return `#${color.rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return null;
}
