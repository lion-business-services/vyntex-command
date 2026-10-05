import { build } from 'esbuild'; import fs from 'node:fs'; import path from 'node:path';
const S = '/tmp/claude-0/-home-claude/94014889-6396-5951-a153-f13fef057bc9/scratchpad/fnd/dce';
const out = path.join(S, 'out-b'); fs.rmSync(out, { recursive: true, force: true });
await build({ entryPoints: [path.join(S, 'b.tsx')], bundle: true, format: 'esm', splitting: true, outdir: out, define: { __VX_DEPLOY__: '"lbs"' }, minify: false, jsx: 'automatic', logLevel: 'error', external: ['react', 'react/jsx-runtime'] });
console.log(fs.readdirSync(out).filter((f) => fs.readFileSync(path.join(out, f), 'utf8').includes('MARKETING_UNIQUE')).length, 'files with marketing');
console.log(fs.readFileSync(path.join(out, 'b.js'), 'utf8').slice(0, 400));
