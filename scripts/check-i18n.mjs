// Translation check: every English key has a Spanish twin, every literal key used in the code exists, and Chinese (optional,
// it falls back to English) never has a key English does not have. Covers the shared dictionaries and all nine editions.
// Run with `node scripts/check-i18n.mjs`. Exits with an error code when something is missing.
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-i18n-')), 'i18n.mjs');
buildSync({
  stdin: { contents: `import { sharedKeys } from '@/i18n'; import { PACK_LIST } from '@/packs'; import { dict as lbsSettings } from '@/features/settings/i18n-lbs';
    const labels = (p) => [...p.leadStages.map((s) => ['ls_' + s.id, s.label]), ...p.leadSources.map((s) => ['src_' + s.id, s.label]), ...p.lostReasons.map((s) => ['lr_' + s.id, s.label]),
      ...p.taskTypes.map((s) => ['tt_' + s.id, s.label]), ...p.clientTypes.map((s) => ['ct_' + s.id, s.label]), ...Object.entries(p.roleLabels).map(([r, l]) => ['role.' + r, l]),
      ...p.appointmentTypes.map((a, i) => ['appointment type ' + (i + 1), a.name]), ...p.rules.map((r) => ['rule ' + r.id, r.name]), ['label', p.label], ['blurb', p.blurb]];
    globalThis.__out = { shared: sharedKeys(), overrides: [['settings (LBS Command)', lbsSettings]].map(([name, d]) => ({ name, en: Object.keys(d.en), es: Object.keys(d.es), zh: Object.keys(d.zh || {}) })), packs: PACK_LIST.map((p) => ({ id: p.id, en: Object.keys(p.terms.en), es: Object.keys(p.terms.es), zh: Object.keys(p.terms.zh || {}),
      types: p.serviceTypes.map((s) => 'ty_' + s.id), typesMissingEs: p.serviceTypes.filter((s) => !s.en || !s.es).map((s) => s.id), labels: labels(p) })) };`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', outfile: out, alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json', '.css': 'empty' }, logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"', __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false' }, platform: 'node',
});
await import(pathToFileURL(out).href);
const { shared, packs, overrides } = globalThis.__out;
let bad = 0;
const en = new Set(shared.en), es = new Set(shared.es);
const missingEs = shared.en.filter((k) => !es.has(k));
const extraEs = shared.es.filter((k) => !en.has(k));
if (missingEs.length) { bad++; console.error(`Missing in Spanish (${missingEs.length}):\n  ` + missingEs.join('\n  ')); }
if (extraEs.length) { bad++; console.error(`Spanish keys without English (${extraEs.length}):\n  ` + extraEs.join('\n  ')); }
// Chinese is optional and falls back to English, so a missing key is fine; a key that English does not have is a typo
const extraZh = (shared.zh || []).filter((k) => !en.has(k));
if (extraZh.length) { bad++; console.error(`Chinese keys without English (${extraZh.length}):\n  ` + extraZh.join('\n  ')); }
// wording that replaces shared lines in one deployment: both languages, and only keys the shared wording already has
for (const o of overrides) {
  const a = new Set(o.en), b = new Set(o.es);
  const m = o.en.filter((k) => !b.has(k)).concat(o.es.filter((k) => !a.has(k)));
  if (m.length) { bad++; console.error(`Wording of ${o.name}: not in both languages: ${m.join(', ')}`); }
  const stray = [...o.en, ...o.zh].filter((k) => !en.has(k));
  if (stray.length) { bad++; console.error(`Wording of ${o.name}: replaces a key that does not exist: ${stray.join(', ')}`); }
}
for (const p of packs) {
  const a = new Set(p.en), b = new Set(p.es);
  const m = p.en.filter((k) => !b.has(k)).concat(p.es.filter((k) => !a.has(k)));
  if (m.length) { bad++; console.error(`Pack ${p.id}: wording not in both languages: ${m.join(', ')}`); }
  const z = p.zh.filter((k) => !a.has(k));
  if (z.length) { bad++; console.error(`Pack ${p.id}: Chinese wording without English: ${z.join(', ')}`); }
  if (p.typesMissingEs.length) { bad++; console.error(`Pack ${p.id}: service types without English or Spanish: ${p.typesMissingEs.join(', ')}`); }
  // blueprint labels (stages, sources, reasons, types, roles, appointment types, rules): English and Spanish always, Chinese optional
  const thin = p.labels.filter(([, l]) => !l || !l.en || !l.es).map(([k]) => k);
  if (thin.length) { bad++; console.error(`Pack ${p.id}: labels without English or Spanish: ${thin.join(', ')}`); }
}
// literal keys used in code
const known = new Set([...shared.en, ...packs.flatMap((p) => [...p.en, ...p.types, ...p.labels.map(([k]) => k)])]);
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
