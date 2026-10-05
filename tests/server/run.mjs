// Runs the server tests:  node tests/server/run.mjs            everything (npm run test:server)
//                         node tests/server/run.mjs --unit     the unit tests only (no database needed)
// The end-to-end tests share one throwaway PostgreSQL, started here once and stopped at the end. Each test file can
// also be run on its own (node --test tests/server/<file>): it then starts and stops the database itself.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const unitOnly = process.argv.includes('--unit');
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
const unit = files.filter((f) => f.startsWith('unit.'));
const e2e = files.filter((f) => f.includes('.e2e.'));
const pgEnv = { ...process.env, PGTEST_DIR: '/tmp/vx-pg-server', MIGRATIONS_MODE: 'isolated' };

let status = 0;
const run = (list, env) => {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...list.map((f) => path.join(here, f))], { stdio: 'inherit', env });
  if (r.status !== 0) status = r.status || 1;
};

console.log(`== unit tests (${unit.length} files, no database)`);
run(unit, process.env);
if (!unitOnly) {
  console.log('== starting the throwaway PostgreSQL (tests/server/pg_local.sh)');
  const pg = spawnSync('bash', [path.join(here, 'pg_local.sh'), 'start'], { env: pgEnv, encoding: 'utf8' });
  if (pg.status !== 0) { console.error(pg.stdout + pg.stderr); process.exit(1); }
  try {
    console.log(`== end-to-end tests (${e2e.length} files) against the local stand-ins. Nothing here talks to Supabase or to a provider.`);
    run(e2e, { ...process.env, VX_PG_READY: '1' });
  } finally {
    spawnSync('bash', [path.join(here, 'pg_local.sh'), 'stop'], { env: pgEnv });
  }
}
if (unitOnly) process.exit(status);

// ---- appended: the public endpoints and server workflows (tests/server/e2e.public.test.mjs) -------------------------
// This file needs EVERY migration (the signing, review, message and intake functions sit on the module tables), so it
// gets its own throwaway PostgreSQL in its own folder, started after the runs above and stopped at the end. The
// process.exit above is replaced by the one at the bottom, so its result counts.
{
  const publicEnv = { ...process.env, PGTEST_DIR: '/tmp/vx-pg-public', MIGRATIONS_MODE: 'all' };
  console.log('== starting a second throwaway PostgreSQL with every migration, for the public endpoints');
  const pg = spawnSync('bash', [path.join(here, 'pg_local.sh'), 'start'], { env: publicEnv, encoding: 'utf8' });
  if (pg.status !== 0) { console.error(pg.stdout + pg.stderr); process.exit(1); }
  try {
    console.log('== end-to-end tests of the public endpoints (e2e.public.test.mjs) against the local stand-ins');
    run(['e2e.public.test.mjs'], { ...process.env, VX_PG_PUBLIC_READY: '1' });
  } finally {
    spawnSync('bash', [path.join(here, 'pg_local.sh'), 'stop'], { env: publicEnv });
  }
}
process.exit(status);
