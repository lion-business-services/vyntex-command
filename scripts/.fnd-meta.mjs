import { build } from 'esbuild'; import path from 'node:path'; import fs from 'node:fs';
const root = process.cwd(); const out = '/tmp/claude-0/-home-claude/94014889-6396-5951-a153-f13fef057bc9/scratchpad/fnd/meta-out';
fs.rmSync(out, { recursive: true, force: true });
const r = await build({ entryPoints: { app: path.join(root, 'src/main.tsx') }, outdir: out, bundle: true, format: 'esm', splitting: true, metafile: true, target: ['es2020'], jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"', __VX_DEPLOY__: '"lbs"', __VX_SAMPLE_PREVIEW__: 'true', __VX_LINK_BOOKKEEPING__: '""', __VX_LINK_PAYROLL__: '""' }, loader: { '.json': 'json', '.css': 'css' }, alias: { '@': path.join(root, 'src') }, logLevel: 'error' });
const want = process.argv.slice(2);
for (const [file, info] of Object.entries(r.metafile.inputs)) for (const im of info.imports) if (want.some((w) => im.path.includes(w))) console.log(file, '->', im.path, im.kind);
