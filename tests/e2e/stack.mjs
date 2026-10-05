// The local stack the end-to-end tests drive a real browser against. Nothing here talks to Supabase, to Vercel or to a
// provider: every part is a local stand-in, and anything proved with it is "proved against the local stand-in".
//
//   PostgreSQL        a throwaway local server per deployment with every migration applied (tests/server/pg_local.sh)
//   Supabase          scripts/dev-supabase.mjs, the TEST DOUBLE of the few Supabase addresses the server calls
//   the site          scripts/serve.mjs serving a build of the app and running the real handlers of api/
//
// Two deployments are started, each with its own database, its own double, its own secrets and its own build, the
// way the two products are deployed: VYNTEX Command (companies under /<slug>) and LBS Command (one company under /app).
// A third site has no Supabase settings at all: the state of any preview build.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');

export const PORTS = { vyntex: 4720, vyntexSb: 4721, lbs: 4722, lbsSb: 4723, bare: 4724 };
export const DIRS = {
  vyntexDist: process.env.E2E_DIST || '/tmp/vx-live', lbsDist: process.env.E2E_DIST_LBS || '/tmp/vx-live-lbs',
  vyntexPg: process.env.PGTEST_DIR || '/tmp/vx-pg-live', lbsPg: (process.env.PGTEST_DIR || '/tmp/vx-pg-live') + '-lbs',
};
const DB = 'vyntex_server';

function sh(cmd, args, env) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${path.basename(args[0] || cmd)} failed:\n${(r.stdout + r.stderr).slice(-3000)}`);
  return r.stdout;
}

/** Builds both deployments into their own folders (never dist/). Skipped with E2E_SKIP_BUILD=1 when they are fresh. */
export function buildBoth() {
  if (process.env.E2E_SKIP_BUILD === '1' && fs.existsSync(path.join(DIRS.vyntexDist, 'index.html')) && fs.existsSync(path.join(DIRS.lbsDist, 'index.html'))) return;
  sh(process.execPath, [path.join(root, 'scripts/build.mjs'), '--out', DIRS.vyntexDist], { VX_DEPLOY: 'vyntex', VX_SAMPLE_PREVIEW: '' });
  // the production shape of LBS Command: no sample preview in the bundle
  sh(process.execPath, [path.join(root, 'scripts/build.mjs'), '--deploy', 'lbs', '--out', DIRS.lbsDist], { VX_DEPLOY: 'lbs', VX_SAMPLE_PREVIEW: '' });
}

function secretsFor() {
  return {
    SESSION_SECRET: 'e2e-session-secret-' + randomBytes(24).toString('hex'), TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
    IP_HASH_SALT: 'e2e-ip-salt-' + randomBytes(16).toString('hex'), CRON_SECRET: 'e2e-cron-secret-' + randomBytes(16).toString('hex'),
  };
}

async function serve(port, dist, env) {
  const origin = `http://localhost:${port}`;
  const clean = { ...process.env };
  for (const k of ['VERCEL_ENV', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET', 'SESSION_SECRET_PREVIOUS', 'TOKEN_ENC_KEY', 'TOKEN_ENC_KEY_PREVIOUS',
    'IP_HASH_SALT', 'CRON_SECRET', 'RESEND_API_KEY', 'SYSTEM_EMAIL_FROM', 'MOCK_OAUTH_BASE', 'SESSION_MAX_HOURS', 'VX_DEPLOY', 'VX_ENV', 'APP_ORIGIN']) delete clean[k];
  const child = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], { env: { ...clean, PORT: String(port), DIST: dist, APP_ORIGIN: origin, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stderr.on('data', (d) => { log.push(String(d)); if (process.env.E2E_VERBOSE) process.stderr.write(d); });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('preview on')) resolve(); });
    child.on('exit', (code) => reject(new Error(`serve.mjs on ${port} stopped (${code}): ${log.join('').slice(-800)}`)));
    setTimeout(() => reject(new Error('serve.mjs did not start on ' + port)), 10000);
  });
  return { origin, child, log };
}

/** One deployment: database, double, site. `sql(text, data)` runs as the local superuser (values through _in, never in the text). */
async function deployment(id, { pgDir, sbPort, sitePort, dist }) {
  sh('bash', [path.join(root, 'tests/server/pg_local.sh'), 'start'], { PGTEST_DIR: pgDir, MIGRATIONS_MODE: process.env.E2E_MIGRATIONS || 'all' });
  const { startDevSupabase, totp } = await import('../../scripts/dev-supabase.mjs');
  const sb = await startDevSupabase({ port: sbPort, host: pgDir + '/sock', database: DB });
  const secrets = secretsFor();
  // VX_ENV=test: plain http cookies, and an invitation that cannot be emailed (no email provider here) hands its link
  // back to the caller instead of being withdrawn. That is the server's own test switch, see api/ws.js.
  const site = await serve(sitePort, dist, { VX_ENV: 'test', VX_HEADERS: '1', VX_DEPLOY: id, SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey, ...secrets });
  const sql = (text, data = {}) => sb.db.run('supabase_admin', [text], data);
  let n = 0;
  /**
   * A company and the operator's invitation for its first owner (docs/SERVER.md, section 4). Returns the link to open.
   * `plan` is a plan id from the pricing file for a priced edition; an edition that is quoted has no plan, and the
   * column only needs a word there.
   */
  async function company({ industry, name, slug, plan = 'quoted' }) {
    n += 1;
    const s = slug || `e2e-${industry}-${Date.now().toString(36)}${n}`;
    const email = `owner-${s}@example.com`;
    const made = await sql(String.raw`
      with t as (insert into public.tenants (slug, name, industry_id, plan_id, status)
                 values ((select v from _in where k = 'slug'), (select v from _in where k = 'name'), (select v from _in where k = 'industry'), (select v from _in where k = 'plan'), 'active') returning id)
      select '@@R@@' || jsonb_build_object('id', (select id from t))::text;`, { slug: s, name, industry, plan });
    const token = await sql(String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select v from _in where k = 'id')::uuid, (select v from _in where k = 'email')))::text;`, { id: made.id, email });
    return { tenantId: made.id, slug: s, name, industry, ownerEmail: email, inviteLink: `${site.origin}/invite/${token}` };
  }
  return {
    id, origin: site.origin, sb, sql, totp, company, secrets, serverLog: site.log,
    async stop() {
      site.child.kill();
      await sb.stop();
      spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'stop'], { env: { ...process.env, PGTEST_DIR: pgDir } });
    },
  };
}

export async function startStack() {
  buildBoth();
  const vyntex = await deployment('vyntex', { pgDir: DIRS.vyntexPg, sbPort: PORTS.vyntexSb, sitePort: PORTS.vyntex, dist: DIRS.vyntexDist });
  const lbs = await deployment('lbs', { pgDir: DIRS.lbsPg, sbPort: PORTS.lbsSb, sitePort: PORTS.lbs, dist: DIRS.lbsDist });
  // a deployment nobody configured: no Supabase settings, no secrets. The sign-in page must say so, calmly.
  const bare = await serve(PORTS.bare, DIRS.vyntexDist, { VX_ENV: 'test', VX_HEADERS: '1', VX_DEPLOY: 'vyntex' });
  return {
    vyntex, lbs, bare: { origin: bare.origin },
    async stop() { bare.child.kill(); await vyntex.stop(); await lbs.stop(); },
  };
}

// node tests/e2e/stack.mjs: keeps the stack up for looking at it by hand and prints an owner invitation for each product.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const st = await startStack();
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'config/vyntex-build-pricing.json'), 'utf8')).plans[0].id;
  const a = await st.vyntex.company({ industry: 'build', name: 'Sample Builders', slug: 'sample-builders', plan });
  const b = await st.lbs.company({ industry: 'practice', name: 'Sample Practice', slug: 'sample-practice' });
  console.log('LOCAL STAND-INS ONLY. This is not Supabase and not Vercel.');
  console.log('VYNTEX Command  ' + st.vyntex.origin + '   first owner: ' + a.inviteLink);
  console.log('LBS Command     ' + st.lbs.origin + '   first owner: ' + b.inviteLink);
  console.log('not configured  ' + st.bare.origin);
  const stop = async () => { await st.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
