import type { PaletteColor, PaletteSet } from './types';

const hexPattern = /^#[0-9A-Fa-f]{6}$/;
const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isRgbTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  );
}

export function validatePaletteSet(json: unknown): string[] {
  const errors: string[] = [];
  if (typeof json !== 'object' || json === null) {
    return ['色表必须是 JSON 对象'];
  }
  const palette = json as Partial<PaletteSet>;
  const at = (msg: string) => errors.push(msg);

  if (palette.schemaVersion !== '1.0') at('schemaVersion 必须为 "1.0"');
  if (typeof palette.id !== 'string' || !idPattern.test(palette.id)) {
    at(`id 无效：${String(palette.id)}`);
  }
  if (typeof palette.label !== 'string' || !palette.label) at('label 不能为空');
  if (typeof palette.brand !== 'string' || !palette.brand) at('brand 不能为空');
  if (typeof palette.standard !== 'string' || !palette.standard) at('standard 不能为空');
  if (!['official', 'community-verified', 'community-legacy'].includes(String(palette.quality))) {
    at(`quality 无效：${String(palette.quality)}`);
  }
  if (typeof palette.source !== 'string' || !palette.source) at('source 不能为空');
  if (typeof palette.license !== 'string' || !palette.license) at('license 不能为空');
  if (palette.beadSizeMm !== undefined && typeof palette.beadSizeMm !== 'number') {
    at('beadSizeMm 必须是数字');
  }
  if (palette.beadType !== undefined && !['round', 'square', 'mix'].includes(palette.beadType)) {
    at(`beadType 无效：${String(palette.beadType)}`);
  }
  if (
    palette.codeStyle !== undefined &&
    (typeof palette.codeStyle !== 'object' ||
      (palette.codeStyle.zeroPad !== undefined && typeof palette.codeStyle.zeroPad !== 'number'))
  ) {
    at('codeStyle 格式无效');
  }
  if (!Array.isArray(palette.colors) || palette.colors.length === 0) {
    at('colors 必须是至少包含 1 项的颜色数组');
    return errors;
  }

  const codes = new Set<string>();
  palette.colors.forEach((color, index) => {
    const label = `colors[${index}]`;
    const validKinds = ['solid', 'special', 'transparent'];
    if (!color || typeof color !== 'object') {
      at(`${label} 不是对象`);
      return;
    }
    if (typeof color.code !== 'string' || !color.code) {
      at(`${label} 缺少 code`);
    } else if (codes.has(color.code)) {
      at(`${label} 的 code 重复：${color.code}`);
    } else {
      codes.add(color.code);
    }
    if (!validKinds.includes(color.kind)) {
      at(`${label} kind 无效：${String(color.kind)}`);
    }

    const hasHex = typeof color.hex === 'string' && hexPattern.test(color.hex);
    const rgbTuple = isRgbTuple(color.rgb) ? color.rgb : null;
    const hasRgb = rgbTuple !== null;
    const transparentNoHex = color.kind === 'transparent' && color.hex === null;
    if (!hasHex && !hasRgb && !transparentNoHex) {
      at(`${label} ${color.code ?? ''}：solid/special 色必须给 hex 或 rgb；transparent 可给 hex=null`);
    }
    if (color.hex !== null && color.hex !== undefined && !hasHex) {
      at(`${label} ${color.code ?? ''}：hex 必须是 #RRGGBB 或 null，实际为 ${String(color.hex)}`);
    }
    const rawHex = typeof color.hex === 'string' ? color.hex : '';
    if (hasHex && rgbTuple) {
      const n = Number.parseInt(rawHex.slice(1), 16);
      const fromHex: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      if (fromHex.join(',') !== rgbTuple.join(',')) {
        at(`${label} ${color.code}：hex 与 rgb 不一致`);
      }
    }
  });
  return errors;
}

export function withRgb(color: PaletteColor): PaletteColor {
  if (color.rgb) return color;
  if (!color.hex) {
    return { ...color, rgb: undefined };
  }
  const n = Number.parseInt(color.hex.slice(1), 16);
  return {
    ...color,
    rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  };
}
