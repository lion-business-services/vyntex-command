// Proves the two deployments are separate bundles: builds both into temporary folders and reads every file that was written.
//   LBS Command      no sales pages (their wording, their styles, their code), no VYNTEX brand pictures, no /demo address,
//                    no other edition's sample business; its own brand files are there.
//   VYNTEX Command   no LBS brand files, no "LBS Command", and "Lion Business Services" only where the product has always
//                    named the firm: the 1099 service of the pricing file is performed by it.
// Usage: node tests/deploy_split.mjs      (npm run test:split)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-split-'));
const build = (name, args, env = {}) => {
  const out = path.join(tmp, name);
  execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--out', out, ...args], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VX_DEPLOY: '', VX_SAMPLE_PREVIEW: '', ...env } });
  return out;
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const isText = (f) => /\.(js|css|html|json|txt|svg|map)$/.test(f);
/** Every text file of a build as { file, text }, and the list of all file names. */
const read = (dir) => { const files = walk(dir); return { dir, names: files.map((f) => path.relative(dir, f)), texts: files.filter(isText).map((f) => ({ file: path.relative(dir, f), text: fs.readFileSync(f, 'utf8') })) }; };
const where = (b, needle) => b.texts.filter((t) => t.text.includes(needle)).map((t) => t.file);

let bad = 0; let checks = 0;
const check = (ok, what, detail = '') => { checks++; if (!ok) { bad++; console.error(`  ✗ ${what}${detail ? ': ' + detail : ''}`); } else console.log(`  ✓ ${what}`); };
const absent = (b, label, needles) => { for (const n of needles) { const hit = where(b, n); check(!hit.length, `${label}: no "${n}"`, hit.slice(0, 3).join(', ')); } };

console.log('building VYNTEX Command, LBS Command, and LBS Command with the sample preview');
const vyntex = read(build('vyntex', []));
const lbs = read(build('lbs', ['--deploy', 'lbs']));
const lbsPreview = read(build('lbs-preview', ['--deploy', 'lbs'], { VX_SAMPLE_PREVIEW: '1' }));

// strings that only the sales pages have: a heading, their style prefix, their wording keys, the request form
const MARKETING = ['Run your entire business from one intelligent command center', 'mk-hero', 'mkp-plans', 'mks-pl', 'mk.title.home', 'mk.rd.consent', 'rd-submit', 'pr-industry'];
const VYNTEX_BRAND = ['vyntex-v.webp', 'vyntex-v-sm.webp', 'vyntex-v-xs.webp', 'brand/vyntex', 'vyntex-logo', 'vyntex-wordmark'];
const DEMO_ROUTE = ['"/demo"', "'/demo'", '`/demo', '/demo/', '"/pricing"', '"/request-demo"'];
const OTHER_EDITIONS = ['Sample Builders LLC', 'VB-J-', 'Sparkle Sample Cleaning'];
// the other product's name, the names of its editions, and lines only the pricing file and its wording have
const VYNTEX_PRODUCT = ['VYNTEX Command', 'VYNTEX BUILD', 'VYNTEX CLEAN', 'test mode first', 'VYNTEX absorbs', 'price.f.core'];

for (const [label, b] of [['LBS', lbs], ['LBS preview', lbsPreview]]) {
  console.log(label);
  absent(b, 'sales pages', MARKETING);
  absent(b, 'VYNTEX brand pictures', VYNTEX_BRAND);
  absent(b, 'demo and sales addresses', DEMO_ROUTE.slice(0, 4));
  absent(b, 'other editions', OTHER_EDITIONS);
  absent(b, 'VYNTEX product and plans', VYNTEX_PRODUCT);
  check(!b.names.some((n) => n.startsWith('brand' + path.sep) || n === 'favicon.png'), 'no VYNTEX brand files are shipped', b.names.filter((n) => n.startsWith('brand' + path.sep)).slice(0, 3).join(', '));
  check(b.names.some((n) => n.startsWith('brand-lbs' + path.sep)), 'the LBS brand files are shipped');
  check(where(b, '/brand-lbs/').includes('index.html'), 'the page shell points at /brand-lbs/');
  check(where(b, 'LBS Command').length > 0, 'the product is named LBS Command');
  check(/<title>LBS Command<\/title>/.test(b.texts.find((t) => t.file === 'index.html').text), 'the page title is LBS Command');
  check(!b.names.some((n) => /chunk-(marketing|tour|landing|pricing|request)-/.test(n)), 'no sales-page or tour script file', b.names.filter((n) => /chunk-(marketing|tour)-/.test(n)).join(', '));
}
console.log('LBS without the sample preview');
check(!where(lbs, 'Gabriela Montes').length, 'the sample records are not in the bundle', where(lbs, 'Gabriela Montes').join(', '));
check(!where(lbs, '"/preview"').length && !where(lbs, "'/preview'").length, 'no /preview address', where(lbs, '"/preview"').join(', '));
check(!lbs.names.some((n) => /chunk-seed-/.test(n)), 'no sample-data script file');
console.log('LBS with the sample preview');
check(where(lbsPreview, 'demo.preview.note').length > 0 || where(lbsPreview, 'No client data is loaded').length > 0, 'the sample notice is there');
check(where(lbsPreview, 'Gabriela Montes').length > 0, 'the sample records are there');

console.log('VYNTEX');
absent(vyntex, 'LBS', ['brand-lbs', 'LBS Command', 'lion-768', 'wordmark-360']);
check(!vyntex.names.some((n) => n.startsWith('brand-lbs')), 'no LBS brand files are shipped');
// "Lion Business Services" is allowed only in the sentences about the 1099 service, which the pricing file itself states
const stray = [];
for (const t of vyntex.texts) for (const m of t.text.matchAll(/Lion Business/g)) { const around = t.text.slice(Math.max(0, m.index - 260), m.index + 200); if (!/1099/.test(around)) stray.push(`${t.file}: …${t.text.slice(Math.max(0, m.index - 50), m.index + 40)}…`); }
check(!stray.length, 'no "Lion Business" outside the 1099 service wording', stray.slice(0, 2).join(' | '));
check(where(vyntex, 'mk-hero').length > 0 && where(vyntex, '/demo').length > 0, 'the sales pages and the demo are there');
check(vyntex.names.some((n) => n === path.join('brand', 'vyntex-v.webp')), 'the VYNTEX brand files are shipped');

fs.rmSync(tmp, { recursive: true, force: true });
if (bad) { console.error(`\n${bad} of ${checks} checks failed`); process.exit(1); }
console.log(`\ndeployment split verified (${checks} checks)`);
