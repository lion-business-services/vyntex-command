// Translation check: every English key has a Spanish twin, and every literal key used in the code exists.
// Run with `node scripts/check-i18n.mjs`. Exits with an error code when something is missing.
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-i18n-')), 'i18n.mjs');
buildSync({
  stdin: { contents: `import { sharedKeys } from '@/i18n'; import { PACK_LIST } from '@/packs';
    globalThis.__out = { shared: sharedKeys(), packs: PACK_LIST.map((p) => ({ id: p.id, en: Object.keys(p.terms.en), es: Object.keys(p.terms.es), types: p.serviceTypes.map((s) => 'ty_' + s.id) })) };`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', outfile: out, alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json', '.css': 'empty' }, logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' }, platform: 'node',
});
await import(pathToFileURL(out).href);
const { shared, packs } = globalThis.__out;
let bad = 0;
const en = new Set(shared.en), es = new Set(shared.es);
const missingEs = shared.en.filter((k) => !es.has(k));
const extraEs = shared.es.filter((k) => !en.has(k));
if (missingEs.length) { bad++; console.error(`Missing in Spanish (${missingEs.length}):\n  ` + missingEs.join('\n  ')); }
if (extraEs.length) { bad++; console.error(`Spanish keys without English (${extraEs.length}):\n  ` + extraEs.join('\n  ')); }
for (const p of packs) {
  const a = new Set(p.en), b = new Set(p.es);
  const m = p.en.filter((k) => !b.has(k)).concat(p.es.filter((k) => !a.has(k)));
  if (m.length) { bad++; console.error(`Pack ${p.id}: wording not in both languages: ${m.join(', ')}`); }
}
// literal keys used in code
const known = new Set([...shared.en, ...packs.flatMap((p) => [...p.en, ...p.types])]);
const files = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.tsx?$/.test(e.name) && !/i18n/.test(f) && !/packs[\\/]/.test(f)) files.push(f); } })(path.join(root, 'src'));
const unknown = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?<![A-Za-z0-9_.])t\(\s*'([^'\\]+)'\s*[,)]/g)) if (!known.has(m[1])) { const k = path.relative(root, f); unknown.set(k, [...(unknown.get(k) || []), m[1]]); }
}
if (unknown.size) { bad++; console.error('Keys used in code but not defined:'); for (const [f, ks] of unknown) console.error(`  ${f}: ${[...new Set(ks)].join(', ')}`); }
if (bad) process.exit(1);
console.log(`translation check passed (${shared.en.length} shared keys, ${packs.length} packs)`);
