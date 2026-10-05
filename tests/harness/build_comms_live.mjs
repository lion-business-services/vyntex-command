// Builds the test page of tests/harness/comms_live.tsx into <out>/harness-comms/ (next to a build of the app, so the
// preview server serves it). Usage: node tests/harness/build_comms_live.mjs <out folder of scripts/build.mjs>
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(path.resolve(process.argv[2] || 'dist'), 'harness-comms');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: { app: path.join(root, 'tests/harness/comms_live.tsx') }, outdir: out, bundle: true, format: 'esm', splitting: true, target: ['es2020'], jsx: 'automatic', minify: false,
  define: { 'process.env.NODE_ENV': '"production"', __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false', __VX_LINK_BOOKKEEPING__: '""', __VX_LINK_PAYROLL__: '""' },
  loader: { '.json': 'json', '.css': 'css' }, alias: { '@': path.join(root, 'src') }, logLevel: 'warning',
});
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test page: live stand-in</title><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>');
console.log('built the test page into', out);
