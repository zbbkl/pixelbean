import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'provenance');

const sources = [
  {
    name: 'jettwu-palette.ts',
    repo: 'Jett-Wu/Perler_Beads_Generator',
    commit: '58988fb23cbaf3ade4a699e9e2f96a3208cd0dd3',
    license: 'MIT',
    path: 'src/palette.ts'
  },
  {
    name: 'jettwu-LICENSE',
    repo: 'Jett-Wu/Perler_Beads_Generator',
    commit: '36ac52d570246ab600611a79edd2236bccb954e5',
    license: 'MIT',
    path: 'LICENSE'
  },
  {
    name: 'beadcolors-mard.csv',
    repo: 'maxcleme/beadcolors',
    commit: '94b9999',
    license: 'MIT',
    path: 'gen/v1/mard.csv'
  },
  {
    name: 'beadcolors-LICENSE',
    repo: 'maxcleme/beadcolors',
    commit: '94b9999',
    license: 'MIT',
    path: 'LICENSE'
  }
];

await mkdir(outDir, { recursive: true });
const manifest = { fetchedAt: '2026-09-06T00:00:00+08:00', files: [] };

for (const source of sources) {
  const res = await fetch(
    `https://api.github.com/repos/${source.repo}/contents/${source.path}?ref=${source.commit}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PixelBean-fetch-sources' } }
  );
  if (!res.ok) {
    throw new Error(`${source.name}: HTTP ${res.status}`);
  }
  const payload = await res.json();
  if (!payload.content) throw new Error(`${source.name}: no content in API payload`);
  const text = Buffer.from(payload.content, 'base64').toString('utf8');
  const sha256 = createHash('sha256').update(text).digest('hex');
  await writeFile(join(outDir, source.name), text, 'utf8');
  manifest.files.push({
    name: source.name,
    repo: source.repo,
    commit: source.commit,
    license: source.license,
    sha256
  });
  console.log(`fetched ${source.name} ${sha256.slice(0, 12)}`);
}

await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
