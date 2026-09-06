import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const palettesDir = join(root, 'data', 'palettes');
const outDir = join(root, 'src', 'generated');
const files = (await readdir(palettesDir)).filter((name) => name.endsWith('.json') && name !== 'palette.schema.json');

const imports = [];
const ids = [];
for (const file of files.sort()) {
  const json = JSON.parse(await readFile(join(palettesDir, file), 'utf8'));
  const safeId = json.id.replace(/[^a-zA-Z0-9_]/g, '_');
  imports.push(`import ${safeId} from '../../data/palettes/${file}';`);
  ids.push(`  '${json.id}': ${safeId},`);
}

await mkdir(outDir, { recursive: true });
const body = `// 自动生成：npm run generate:palettes，勿手改。\n${imports.join('\n')}\n\nexport const builtinPaletteSets = {\n${ids.join('\n')}\n} as const;\n`;
await writeFile(join(outDir, 'palettes.ts'), body, 'utf8');
console.log(`generated src/generated/palettes.ts (${files.length} palette sets)`);
