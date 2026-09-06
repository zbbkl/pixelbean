import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const provenance = join(root, 'provenance');
const sourcePath = join(provenance, 'jettwu-palette.ts');
const outPath = join(root, 'palettes', 'mard-291.json');

const source = await readFile(sourcePath, 'utf8');

function extractCsv(name) {
  const match = source.match(new RegExp(`${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`missing ${name} in ${sourcePath}`);
  return match[1]
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [code, hex] = line.trim().split(',');
      return { code: code.trim(), hex: hex.trim() };
    });
}

function padCode(raw) {
  const match = raw.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) throw new Error(`unexpected code ${raw}`);
  const letters = match[1].toUpperCase();
  return `${letters}${match[2].padStart(2, '0')}`;
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const raw = [...extractCsv('rawColorsCsv'), ...extractCsv('rawExtendedColorsCsv')];
if (raw.length !== 291) {
  throw new Error(`MARD 源数据应为 291 色，实际 ${raw.length}`);
}
const seen = new Set();
const colors = raw.map(({ code, hex }, index) => {
  const padded = padCode(code);
  if (seen.has(padded)) throw new Error(`duplicate code ${padded}`);
  seen.add(padded);
  const family = padded.startsWith('ZG') ? 'ZG' : padded.slice(0, 1);
  return {
    code: padded,
    hex: hex.toUpperCase(),
    rgb: hexToRgb(hex),
    kind: 'solid',
    family,
    sortKey: index + 1
  };
});

const palette = {
  $schema: '../palette.schema.json',
  schemaVersion: '1.0',
  id: 'mard-291',
  label: 'MARD 291（店家通用）',
  brand: 'MARD',
  standard: '291',
  beadSizeMm: 5,
  quality: 'community-verified',
  source:
    'Jett-Wu Perler_Beads_Generator src/palette.ts(MIT) + maxcleme/beadcolors gen/v1/mard.csv(MIT) 交叉核对',
  license: 'MIT',
  licenseNote:
    '数据段复制自 MIT 项目并保留上游版权声明；快照与 SHA-256 见 data/provenance/',
  codeStyle: { stripLeadingBrandChar: false, zeroPad: 2 },
  notes: 'hex 为工程近似色，与实物存在色差；图纸以 code 为准。特殊/透明色默认不参与自动匹配。',
  colors
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(palette, null, 2)}\n`, 'utf8');
console.log(`wrote ${outPath}: ${colors.length} colors`);
