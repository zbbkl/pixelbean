import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const palettesDir = join(root, 'palettes');
const files = (await readdir(palettesDir)).filter((name) => name.endsWith('.json'));

const errors = [];

function hexToRgb(hex) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

for (const file of files.sort()) {
  const json = JSON.parse(await readFile(join(palettesDir, file), 'utf8'));
  const expectedColors = { 'mard-291.json': 291, 'hama-midi.json': 92, 'perler-standard.json': 103 };
  if (expectedColors[file] !== undefined && json.colors?.length !== expectedColors[file]) {
    errors.push(`${file}: 色数应为 ${expectedColors[file]}，实际 ${json.colors?.length ?? 0}`);
  }
  const requiredTop = ['schemaVersion', 'id', 'label', 'brand', 'standard', 'quality', 'source', 'license', 'colors'];
  for (const key of requiredTop) {
    if (json[key] === undefined) errors.push(`${file}: missing top-level ${key}`);
  }
  if (json.schemaVersion !== '1.0') errors.push(`${file}: schemaVersion must be 1.0`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(json.id)) errors.push(`${file}: invalid id slug`);
  if (!Array.isArray(json.colors) || json.colors.length === 0) errors.push(`${file}: empty colors`);

  const codes = new Set();
  const hexes = new Map();
  const seenNames = new Map();
  const duplicateHexCodes = [];
  json.colors?.forEach((color, index) => {
    const at = `${file} colors[${index}] ${color.code ?? '?'}`;
    if (typeof color.code !== 'string' || !color.code) errors.push(`${at}: missing code`);
    if (codes.has(color.code)) errors.push(`${at}: duplicate code`);
    codes.add(color.code);
    if (!['solid', 'special', 'transparent'].includes(color.kind)) errors.push(`${at}: invalid kind`);

    let rgb = color.rgb;
    if (color.hex === null && color.kind === 'transparent') {
      rgb = null;
    } else if (color.hex !== undefined && color.hex !== null) {
      rgb = hexToRgb(color.hex);
      if (!rgb) errors.push(`${at}: invalid hex ${color.hex}`);
    }
    if (!rgb && color.hex !== null) {
      if (!Array.isArray(color.rgb) || color.rgb.length !== 3 || color.rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
        errors.push(`${at}: missing/invalid hex or rgb`);
      } else {
        rgb = color.rgb;
      }
    }
    if (rgb && color.hex && hexToRgb(color.hex)?.join() !== color.rgb?.join?.()) {
      errors.push(`${at}: hex/rgb mismatch`);
    }
    if (color.name && seenNames.has(color.name)) errors.push(`${at}: duplicate color name`);
    seenNames.set(color.name ?? '', index);

    if (rgb) {
      const key = rgb.join(',');
      if (hexes.has(key)) duplicateHexCodes.push(`${color.code} ≈ ${hexes.get(key)}`);
      else hexes.set(key, color.code);
    }
  });
  if (duplicateHexCodes.length) {
    console.warn(`${file}: 不同色号共用同一工程 hex（保留，code 仍唯一）: ${duplicateHexCodes.join(', ')}`);
  }
  console.log(`validated ${file}: ${json.colors?.length ?? 0} colors`);
}

if (errors.length) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(`all palette files valid (${files.length})`);
