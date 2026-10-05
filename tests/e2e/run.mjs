// npm run test:e2e
//   1. the QR encoder of the sign-in pages, read back by an independent decoder        tests/e2e/qr_check.mjs
//   2. the live half of the store against a stand-in for the server, no browser        tests/e2e/store.sync.test.mjs
//   3. the live client in a real browser against the local stack                       tests/e2e/live.e2e.test.mjs
// Local stand-ins only: a throwaway PostgreSQL with every migration, the test double of the Supabase addresses, and
// scripts/serve.mjs running the handlers of api/. Nothing here runs on Supabase or on Vercel.
//   E2E_SKIP_BUILD=1   use the builds already in /tmp/vx-live and /tmp/vx-live-lbs
//   E2E_SHOTS=<dir>    where the screenshots go (default: a folder under the temporary folder)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const step = (title, args, env = {}) => {
  console.log('== ' + title);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  console.log(`   ${r.status === 0 ? 'passed' : 'FAILED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return r.status === 0;
};
const results = [
  step('QR encoder, checked with OpenCV', [path.join(here, 'qr_check.mjs')]),
  step('the live store against a stand-in server (no browser)', ['--test', path.join(here, 'store.sync.test.mjs')]),
  step('the live client in a real browser, against local stand-ins (not Supabase, not Vercel)',
    ['--test', '--test-concurrency=1', '--test-timeout=900000', path.join(here, 'live.e2e.test.mjs')], { PGTEST_DIR: process.env.PGTEST_DIR || '/tmp/vx-pg-live' }),
];
console.log(`== finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(results.every(Boolean) ? 0 : 1);
