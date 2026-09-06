import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function deg(rad) {
  return (rad * 180) / Math.PI;
}

function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbar = h1p + h2p;
  if (C1p * C2p === 0) hbar = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbar = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbar = (h1p + h2p + 360) / 2;
  else hbar = (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(((hbar - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbar * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbar + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbar - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(((2 * dTheta) * Math.PI) / 180) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH)
  );
}

function srgbToLab(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x / 95.047);
  const fy = f(y / 100);
  const fz = f(z / 108.883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function padCode(raw) {
  const m = raw.match(/^([A-Za-z]+)(\d+)$/);
  return `${m[1].toUpperCase()}${m[2].padStart(2, '0')}`;
}

async function readRows(file) {
  const text = await readFile(join(root, 'provenance', file), 'utf8');
  return text.trim().split(/\r?\n/);
}

async function compareSet(name, paletteFile, secondary, secondaryName) {
  const palette = JSON.parse(await readFile(join(root, 'palettes', paletteFile), 'utf8'));
  const byCode = new Map(palette.colors.map((color) => [color.code, color]));
  const byName = new Map(
    palette.colors
      .filter((color) => color.nameEn)
      .map((color) => [color.nameEn.toLowerCase(), color])
  );
  const checked = [];
  const mismatches = [];
  for (const row of secondary) {
    let primary = row.code !== undefined ? byCode.get(row.code) : byName.get(row.name);
    if (primary === undefined) continue;
    const delta = ciede2000(srgbToLab(row.rgb), srgbToLab(primary.rgb));
    checked.push(primary.code);
    if (delta > 10 || delta < 0) mismatches.push({ code: primary.code, delta });
  }
  return {
    name,
    secondarySource: secondaryName,
    checked,
    mismatches,
    summary: {
      secondaryRows: secondary.length,
      codesChecked: checked.length,
      mismatches: mismatches.length,
      thresholdDeltaE2000: 10
    }
  };
}

const mardSecondary = (await readRows('beadcolors-mard.csv')).map((line) => {
  const parts = line.split(',');
  return { code: padCode(parts[0].trim()), rgb: [parts[2], parts[3], parts[4]].map(Number) };
});

const beadmachine = JSON.parse(await readFile(join(root, 'provenance', 'beadmachine-colors_hama.json'), 'utf8'));
const hamaSecondary = Object.entries(beadmachine).map(([key, value]) => ({
  code: padCode(key.split(' ')[0]),
  rgb: [value.r, value.g, value.b]
}));

const hankLines = await readRows('hank-beads.hex.txt');
const hankPerler = [];
const hankHama = [];
for (const line of hankLines) {
  const [name, brand, hex] = line.split('\t');
  if (brand === 'Perler') {
    hankPerler.push({
      name: name.toLowerCase(),
      rgb: [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
    });
  }
  if (brand === 'Hama') {
    hankHama.push({
      name: name.toLowerCase(),
      rgb: [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
    });
  }
}

const reports = [];
reports.push(await compareSet(
  'mard-291',
  'mard-291.json',
  mardSecondary,
  'maxcleme/beadcolors gen/v1/mard.csv'
));
reports.push(await compareSet(
  'hama-midi',
  'hama-midi.json',
  hamaSecondary,
  'cornelk/beadmachine colors_hama.json'
));
reports.push(await compareSet(
  'hama-midi',
  'hama-midi.json',
  hankHama,
  'hank/perler-bead-map beads.hex.txt (Hama)'
));
reports.push(await compareSet(
  'perler-standard',
  'perler-standard.json',
  hankPerler,
  'hank/perler-bead-map beads.hex.txt (Perler)'
));

await writeFile(
  join(root, 'provenance', 'crosscheck-report.json'),
  `${JSON.stringify({ generatedAt: '2026-09-06', reports }, null, 2)}\n`,
  'utf8'
);
const totalMismatches = reports.reduce((sum, report) => sum + report.mismatches.length, 0);
for (const report of reports) {
  console.log(`crosscheck ${report.name}: checked ${report.summary.codesChecked}, mismatches ${report.summary.mismatches}`);
}
if (totalMismatches) {
  console.warn(`crosscheck differences (${totalMismatches}) recorded for human arbitration`);
  console.warn(JSON.stringify(reports.flatMap((report) => report.mismatches), null, 2));
  console.log('crosscheck complete with differences (see report)');
} else {
  console.log('crosscheck ok: all overlapping sets ΔE2000 < 10');
}
