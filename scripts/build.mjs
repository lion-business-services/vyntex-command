// Builds the single-page app into dist/. No framework CLI needed: esbuild bundles src/main.tsx.
// Every file in dist/assets carries a content hash in its name, so it can be cached forever; index.html points at the current ones.
// The build is prepared in a temporary folder and swapped in only when it succeeds, so a failed build never takes down a working dist/.
// Usage: node scripts/build.mjs [--watch] [--out <folder>]
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const dist = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'dist');
const stage = dist + '.building';
const watch = process.argv.includes('--watch');
const prod = !watch;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function finish(meta) {
  copyDir(path.join(root, 'public'), stage);
  // find the entry files esbuild wrote (app-<hash>.js and its stylesheet)
  let js = '', css = '';
  for (const [file, info] of Object.entries(meta.outputs)) {
    if (info.entryPoint && /src[\\/]main\.tsx$/.test(info.entryPoint) && file.endsWith('.js')) { js = path.basename(file); css = info.cssBundle ? path.basename(info.cssBundle) : ''; }
  }
  if (!js || !css) throw new Error('build: entry files not found in the output');
  let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  html = html.replace('/assets/app.css', `/assets/${css}`).replace('/assets/app.js', `/assets/${js}`);
  // The files the entry script imports right away are announced in the page, so the browser fetches them alongside the entry
  // instead of discovering them one round trip later. Pages and sample data that load on demand are left out.
  const entryKey = Object.keys(meta.outputs).find((f) => path.basename(f) === js);
  const eager = new Set();
  const walk = (key) => { for (const im of meta.outputs[key]?.imports || []) if (im.kind === 'import-statement' && !eager.has(im.path)) { eager.add(im.path); walk(im.path); } };
  walk(entryKey);
  const hints = [...eager].map((f) => `<link rel="modulepreload" href="/assets/${path.basename(f)}">`).join('\n');
  if (hints) html = html.replace('</head>', `${hints}\n</head>`);
  fs.writeFileSync(path.join(stage, 'index.html'), html);
  // the entry stylesheet already contains every page's styles; the per-page copies esbuild also writes are never loaded
  for (const f of fs.readdirSync(path.join(stage, 'assets'))) if (/^chunk-.*\.css$/.test(f)) fs.rmSync(path.join(stage, 'assets', f));
  // swap the finished build in
  fs.rmSync(dist, { recursive: true, force: true });
  fs.renameSync(stage, dist);
  const kb = (f) => (fs.statSync(path.join(dist, 'assets', f)).size / 1024).toFixed(0);
  const chunks = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js')).length;
  console.log(`built ${path.relative(root, dist) || dist} (${js} ${kb(js)} KB, ${css} ${kb(css)} KB, ${chunks} script files)`);
}
const options = {
  entryPoints: { app: path.join(root, 'src/main.tsx') },
  outdir: path.join(stage, 'assets'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[name]-[hash]',
  assetNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  splitting: true,
  metafile: true,
  target: ['es2020'],
  jsx: 'automatic',
  minify: prod,
  sourcemap: prod ? false : 'inline',
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development') },
  loader: { '.json': 'json', '.css': 'css' },
  alias: { '@': path.join(root, 'src') },
  logLevel: 'warning',
  legalComments: 'none',
};
const prepare = () => { fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(path.join(stage, 'assets'), { recursive: true }); };
if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: 'finish', setup(b) { b.onStart(prepare); b.onEnd((r) => { if (!r.errors.length) finish(r.metafile); }); } }] });
  await ctx.watch();
  console.log('watching…');
} else {
  prepare();
  try { const r = await build(options); finish(r.metafile); }
  catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
}
