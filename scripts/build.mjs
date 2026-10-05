// Builds the single-page app into dist/. No framework CLI needed: esbuild bundles src/main.tsx.
// Every file in dist/assets carries a content hash in its name, so it can be cached forever; index.html points at the current ones.
// The build is prepared in a temporary folder and swapped in only when it succeeds, so a failed build never takes down a working dist/.
// Usage: node scripts/build.mjs [--watch] [--out <folder>]
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeServerDomain } from './build-server-domain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
// Which deployment to build: `vyntex` (default) or `lbs`. See src/config/deployment.ts and docs/MASTER-BUILD-SPEC.md, section 1.
const deployArg = process.argv.indexOf('--deploy');
const deploy = (deployArg > -1 ? process.argv[deployArg + 1] : process.env.VX_DEPLOY) === 'lbs' ? 'lbs' : 'vyntex';
const samplePreview = process.env.VX_SAMPLE_PREVIEW === '1';
const dist = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.join(root, deploy === 'lbs' ? 'dist-lbs' : 'dist');
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
  // the LBS deployment has its own page shell, icons and brand files; the VYNTEX brand files are not shipped with it
  if (deploy === 'lbs') {
    fs.rmSync(path.join(stage, 'brand'), { recursive: true, force: true });
    fs.rmSync(path.join(stage, 'favicon.png'), { force: true });   // the VYNTEX tab icon; the LBS page shell names its own in brand-lbs/
    copyDir(path.join(root, 'public-lbs'), stage);
  }
  // find the entry files esbuild wrote (app-<hash>.js and its stylesheet)
  let js = '', css = '';
  for (const [file, info] of Object.entries(meta.outputs)) {
    if (info.entryPoint && /src[\\/]main\.tsx$/.test(info.entryPoint) && file.endsWith('.js')) { js = path.basename(file); css = info.cssBundle ? path.basename(info.cssBundle) : ''; }
  }
  if (!js || !css) throw new Error('build: entry files not found in the output');
  const lbsShell = path.join(root, 'public-lbs/index.html');
  let html = fs.readFileSync(deploy === 'lbs' && fs.existsSync(lbsShell) ? lbsShell : path.join(root, 'public/index.html'), 'utf8');
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
  console.log(`built ${path.relative(root, dist) || dist} [${deploy}${samplePreview ? ', sample preview' : ''}] (${js} ${kb(js)} KB, ${css} ${kb(css)} KB, ${chunks} script files)`);
}
const options = {
  entryPoints: { app: path.join(root, 'src/main.tsx') },
  outdir: path.join(stage, 'assets'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[name]-[hash]',
  assetNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  // one script file instead of many when the build is embedded somewhere that lists every file by hand (scripts/build-preview.mjs)
  splitting: process.env.VX_SINGLE_FILE !== '1',
  metafile: true,
  target: ['es2020'],
  jsx: 'automatic',
  minify: prod,
  sourcemap: prod ? false : 'inline',
  define: {
    'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
    __VX_DEPLOY__: JSON.stringify(deploy),
    __VX_SAMPLE_PREVIEW__: JSON.stringify(samplePreview),
    // addresses of the bookkeeping and payroll client links shown on the LBS home screen; empty means "not set"
    __VX_LINK_BOOKKEEPING__: JSON.stringify(process.env.VX_LINK_BOOKKEEPING || ''),
    __VX_LINK_PAYROLL__: JSON.stringify(process.env.VX_LINK_PAYROLL || ''),
  },
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
  await writeServerDomain();   // the signing rules the server functions run (api/_lib/domain.bundle.mjs), from the same sources
  prepare();
  try { const r = await build(options); finish(r.metafile); }
  catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
}
