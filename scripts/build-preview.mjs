// Builds an embeddable preview of the site: the same app, started in preview mode (the page lives in memory instead of the
// address bar, files are referenced relatively). Used to share a clickable preview inside another page; the hosted site uses build.mjs.
// Usage: node scripts/build-preview.mjs <folder> [--deploy lbs]   -> writes <folder>/preview.html plus assets/ and the brand folder
// With `--deploy lbs` (or VX_DEPLOY=lbs) it builds the LBS Command preview: the sample preview is switched on, the page opens
// on /preview, and the brand files are the LBS ones.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const deployArg = args.indexOf('--deploy');
const deploy = (deployArg > -1 ? args[deployArg + 1] : process.env.VX_DEPLOY) === 'lbs' ? 'lbs' : 'vyntex';
const folder = args.find((a, i) => !a.startsWith('--') && (deployArg < 0 || i !== deployArg + 1));
const out = path.resolve(folder || path.join(root, deploy === 'lbs' ? 'preview-lbs' : 'preview'));
// the LBS preview is a sample workspace by definition: there is nobody to sign in inside an embedded page
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--out', out, '--deploy', deploy], { stdio: 'inherit', env: { ...process.env, VX_SINGLE_FILE: '1', ...(deploy === 'lbs' ? { VX_SAMPLE_PREVIEW: '1' } : {}) } });
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const css = html.match(/\/assets\/(app-[A-Z0-9]+\.css)/)[1];
const js = html.match(/\/assets\/(app-[A-Z0-9]+\.js)/)[1];
const lbs = deploy === 'lbs';
const fonts = lbs ? 'family=Playfair+Display:wght@700&family=Poppins:wght@400;500;600&display=swap' : 'family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700;800&display=swap';
fs.writeFileSync(path.join(out, 'preview.html'), `<title>${lbs ? 'LBS Command Preview' : 'VYNTEX Command Demo'}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}">
<link rel="stylesheet" href="assets/${css}">
<style>:root{color-scheme:dark}body{background:${lbs ? '#06160E' : '#111829'}}</style>
<div id="root"></div>
<script>window.__VX_PREVIEW__ = true;${lbs ? " document.documentElement.dataset.brand = 'lbs';" : ''}</script>
<script type="module" src="assets/${js}"></script>
`);
const files = {};
for (const dir of ['assets', lbs ? 'brand-lbs' : 'brand']) for (const f of fs.readdirSync(path.join(out, dir))) files[`${dir}/${f}`] = `${dir}/${f}`;
fs.writeFileSync(path.join(out, 'preview-files.json'), JSON.stringify(files, null, 1));
console.log(`preview written to ${out} [${deploy}] (${Object.keys(files).length} supporting files)`);
