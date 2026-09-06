import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const palette = JSON.parse(await readFile(join(root, 'palettes', 'mard-291.json'), 'utf8'));
const csv = (await readFile(join(root, 'provenance', 'beadcolors-mard.csv'), 'utf8')).trim().split(/\r?\n/);
const expected = new Map(palette.colors.map((c) => [c.code, c]));

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
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t + 16 / 116);
  const fx = f(x / 95.047);
  const fy = f(y / 100);
  const fz = f(z / 108.883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function padCode(raw) {
  const m = raw.match(/^([A-Za-z]+)(\d+)$/);
  return `${m[1].toUpperCase()}${m[2].padStart(2, '0')}`;
}

const checked = [];
const mismatches = [];
for (const line of csv) {
  const parts = line.split(',');
  if (parts.length < 6) continue;
  const code = padCode(parts[0].trim());
  const rgb = [parts[2], parts[3], parts[4]].map(Number);
  const row = expected.get(code);
  if (!row) {
    mismatches.push({ code, reason: 'missing-in-normalized' });
    continue;
  }
  const delta = ciede2000(srgbToLab(rgb), srgbToLab(row.rgb));
  checked.push(code);
  if (delta > 10 || delta < 0) mismatches.push({ code, delta });
}

const report = {
  primarySource: 'Jett-Wu Perler_Beads_Generator palette.ts',
  secondarySource: 'maxcleme/beadcolors gen/v1/mard.csv',
  checked,
  mismatches,
  summary: {
    secondaryRows: csv.length,
    codesChecked: checked.length,
    mismatches: mismatches.length,
    thresholdDeltaE2000: 10
  }
};
await writeFile(join(root, 'provenance', 'crosscheck-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (mismatches.length) {
  console.error(JSON.stringify(mismatches, null, 2));
  process.exit(1);
}
console.log(`crosscheck ok: ${checked.length} overlapping MARD codes, ΔE2000 < 10`);
