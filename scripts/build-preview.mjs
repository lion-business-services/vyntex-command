// Builds an embeddable preview of the site: the same app, started in preview mode (the page lives in memory instead of the
// address bar, files are referenced relatively). Used to share a clickable preview inside another page; the hosted site uses build.mjs.
// Usage: node scripts/build-preview.mjs <folder>   -> writes <folder>/preview.html plus assets/ and brand/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'preview'));
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--out', out], { stdio: 'inherit' });
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const css = html.match(/\/assets\/(app-[A-Z0-9]+\.css)/)[1];
const js = html.match(/\/assets\/(app-[A-Z0-9]+\.js)/)[1];
fs.writeFileSync(path.join(out, 'preview.html'), `<title>VYNTEX Platform Demo</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700;800&display=swap">
<link rel="stylesheet" href="assets/${css}">
<style>:root{color-scheme:dark}body{background:#05070B}</style>
<div id="root"></div>
<script>window.__VX_PREVIEW__ = true;</script>
<script type="module" src="assets/${js}"></script>
`);
const files = {};
for (const dir of ['assets', 'brand']) for (const f of fs.readdirSync(path.join(out, dir))) files[`${dir}/${f}`] = `${dir}/${f}`;
fs.writeFileSync(path.join(out, 'preview-files.json'), JSON.stringify(files, null, 1));
console.log(`preview written to ${out} (${Object.keys(files).length} supporting files)`);
