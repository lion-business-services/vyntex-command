// Shared setup for the server tests.
//   unit tests        import setTestEnv() only: no database, no network
//   end-to-end tests  call startStack(): the throwaway local PostgreSQL (tests/server/pg_local.sh), the test double of
//                     the Supabase HTTP surface (scripts/dev-supabase.mjs) and a stand-in OAuth provider, then drive
//                     the real handlers in api/ through a small cookie-keeping client.
// Nothing here reaches the internet: any call to an address that is not one of the local stand-ins fails the test.
import { spawnSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIABLES } from '../../api/_lib/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const ORIGIN = 'http://localhost:4620';
export const PORTS = { site: 4620, supabase: 4621, provider: 4622, serve: 4623 };

/** Environment for a test run: made-up secrets, test mode, no real service configured. */
/** Every setting a provider adapter reads. A test starts with none of them, whatever the machine it runs on has set. */
const PROVIDER_SETTINGS = Object.entries(VARIABLES).filter(([, v]) => v.provider).map(([k]) => k);

export function setTestEnv(extra = {}) {
  const env = {
    VX_ENV: 'test', VX_DEPLOY: 'vyntex', APP_ORIGIN: ORIGIN,
    SESSION_SECRET: 'test-session-secret-' + randomBytes(24).toString('hex'),
    TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
    IP_HASH_SALT: 'test-ip-salt-' + randomBytes(16).toString('hex'),
    CRON_SECRET: 'test-cron-secret-' + randomBytes(16).toString('hex'),
    ...extra,
  };
  for (const k of ['VERCEL_ENV', 'SESSION_SECRET_PREVIOUS', 'TOKEN_ENC_KEY_PREVIOUS', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'RESEND_API_KEY', 'SYSTEM_EMAIL_FROM', 'RESEND_WEBHOOK_SECRET', 'MOCK_OAUTH_BASE', 'MOCK_CLIENT_ID', 'MOCK_CLIENT_SECRET', 'MOCK_WEBHOOK_SECRET', 'MOCK_NEEDS_APPROVAL', 'MOCK_APPROVED', 'SESSION_MAX_HOURS',
    'ANTHROPIC_API_KEY', 'ASSISTANT_MODEL', 'AI_TIMEOUT_MS', ...PROVIDER_SETTINGS]) delete process.env[k];
  Object.assign(process.env, env);
  return env;
}

/** Every response body and header seen by a test client, kept so the leak test can search all of them at the end. */
export const seen = [];

/** Values that must never appear in anything sent to a browser. Collected as the stack creates them. */
export const secrets = new Set();
export function assertNoLeak(assert) {
  const all = seen.join('\n');
  for (const s of secrets) {
    if (s && s.length >= 12) assert.ok(!all.includes(s), `a secret value appears in a response (starts with ${s.slice(0, 6)}...)`);
  }
  assert.ok(!/at .*\(.*\.(js|mjs):\d+:\d+\)/.test(all), 'a stack trace appears in a response');
  assert.ok(!/relation "|syntax error at|violates .* constraint|permission denied for/i.test(all), 'a database error text appears in a response');
}

let pgStartedHere = false;
export function startPostgres() {
  if (process.env.VX_PG_READY === '1') return;   // tests/server/run.mjs already started it for the whole run
  const r = spawnSync('bash', [path.join(here, 'pg_local.sh'), 'start'], { env: { ...process.env, PGTEST_DIR: '/tmp/vx-pg-server', MIGRATIONS_MODE: 'isolated' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('the local PostgreSQL did not start:\n' + r.stdout + r.stderr);
  pgStartedHere = true;
}
export function stopPostgres() {
  if (pgStartedHere) spawnSync('bash', [path.join(here, 'pg_local.sh'), 'stop'], { env: { ...process.env, PGTEST_DIR: '/tmp/vx-pg-server' } });
}

/**
 * A browser, as far as the server can tell: it keeps cookies, sends Origin on requests that change something, and
 * copies the csrf cookie into the header the way the page's script does. `address` is its network address.
 */
export class Browser {
  constructor(api, { address, origin = ORIGIN } = {}) {
    this.api = api; this.jar = new Map(); this.origin = origin;
    this.address = address || `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  /** opts: body (JSON), raw (Buffer), headers, origin (false = send none, string = send that), csrf (false = send none, string = send that) */
  async call(method, url, opts = {}) {
    const name = url.split('/')[2].split('?')[0];
    const mod = this.api[name];
    if (!mod) throw new Error('no handler for ' + url);
    const headers = { 'x-real-ip': this.address, ...(opts.headers || {}) };
    if (this.jar.size) headers.cookie = this.cookieHeader();
    if (!['GET', 'HEAD'].includes(method)) {
      if (opts.origin !== false) headers.origin = typeof opts.origin === 'string' ? opts.origin : this.origin;
      const csrf = opts.csrf === undefined ? this.jar.get('vx-csrf') : opts.csrf;
      if (csrf) headers['x-vx-csrf'] = csrf;
    }
    let body;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = headers['content-type'] || 'application/json'; }
    const handler = mod[method];
    const res = await handler(new Request(this.origin + url, { method, headers, body, redirect: 'manual' }));
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
      if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || v === '') this.jar.delete(k); else this.jar.set(k, v);
      seen.push('set-cookie: ' + c);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    seen.push(`${res.status} ${url}\n${[...res.headers].filter(([k]) => k !== 'set-cookie').map(([k, v]) => `${k}: ${v}`).join('\n')}\n${text.slice(0, 20000)}`);
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json: data, text, bytes: buf, headers: res.headers };
  }
  get(url, opts) { return this.call('GET', url, opts); }
  post(url, body, opts = {}) { return this.call('POST', url, { ...opts, body }); }
  /** First call of any page: get a csrf value. */
  async open() { return this.get('/api/auth/session'); }
}

/**
 * Starts the local stack and returns what the end-to-end tests use.
 *   api          the real handlers of api/
 *   sb           the Supabase test double (sb.set({ jwtExp }) changes token lifetimes)
 *   provider     the stand-in OAuth provider
 *   mail         emails "sent" through Resend (calls to api.resend.com are answered here, never sent)
 *   sql(text)    runs SQL as the local superuser and returns the value of  select '@@R@@' || <json>
 *   company()    makes a company and signs its first owner in through the real invitation flow
 */
export async function startStack({ jwtExp = 3600 } = {}) {
  setTestEnv({ RESEND_API_KEY: 're_test_' + randomBytes(16).toString('hex'), SYSTEM_EMAIL_FROM: 'VYNTEX Command <system@mail.example.com>' });
  startPostgres();
  const { startDevSupabase, totp } = await import('../../scripts/dev-supabase.mjs');
  const { startMockProvider } = await import('./mock_provider.mjs');
  const sb = await startDevSupabase({ port: PORTS.supabase, jwtExp, host: '/tmp/vx-pg-server/sock' });
  const provider = await startMockProvider({ port: PORTS.provider });
  Object.assign(process.env, {
    SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey,
    MOCK_OAUTH_BASE: provider.base, MOCK_CLIENT_ID: provider.clientId, MOCK_CLIENT_SECRET: provider.clientSecret,
    MOCK_WEBHOOK_SECRET: 'mock-webhook-secret-' + randomBytes(12).toString('hex'),
    RESEND_WEBHOOK_SECRET: 'whsec_' + randomBytes(24).toString('base64'),
  });
  for (const k of ['SESSION_SECRET', 'TOKEN_ENC_KEY', 'IP_HASH_SALT', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'MOCK_CLIENT_SECRET', 'MOCK_WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET']) secrets.add(process.env[k]);
  // and any provider secret a test set, so the leak search covers it too
  for (const [k, v] of Object.entries(VARIABLES)) if (v.secret && process.env[k] && process.env[k].length >= 12) secrets.add(process.env[k]);
  secrets.add(sb.jwtSecret);

  // Outbound calls: the two local stand-ins, and api.resend.com answered from memory. Anything else is a failure.
  const mail = { sent: [], status: 200, domains: [{ id: 'dom_1', name: 'mail.example.com', status: 'verified' }], domainsStatus: 200, domainsBody: null };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) {
      const p = new URL(u).pathname;
      if (p === '/emails') {
        const body = JSON.parse(init.body);
        if (mail.status !== 200) return new Response(JSON.stringify({ statusCode: mail.status, name: 'application_error', message: 'internal detail from the email provider that must not leak' }), { status: mail.status });
        const key = init.headers['idempotency-key'];
        const dup = key && mail.sent.find((m) => m.idem === key);
        if (dup) return new Response(JSON.stringify({ id: dup.id }), { status: 200 });
        const id = 'email_' + randomBytes(6).toString('hex');
        mail.sent.push({ id, idem: key || null, ...body });
        return new Response(JSON.stringify({ id }), { status: 200 });
      }
      if (p === '/domains') return new Response(JSON.stringify(mail.domainsBody || { data: mail.domains }), { status: mail.domainsStatus });
      return new Response('{}', { status: 404 });
    }
    const local = [sb.url, provider.base, `http://127.0.0.1:${PORTS.serve}`, `http://127.0.0.1:${PORTS.serve + 1}`, `http://127.0.0.1:${PORTS.serve + 2}`];
    if (!local.some((base) => u.startsWith(base))) throw new Error('a test tried to reach an outside address: ' + u.slice(0, 60));
    return realFetch(url, init);
  };

  const api = {
    auth: await import('../../api/auth.js'), ws: await import('../../api/ws.js'), integrations: await import('../../api/integrations.js'),
    webhooks: await import('../../api/webhooks.js'), cron: await import('../../api/cron.js'), health: await import('../../api/health.js'),
  };
  const sql = (text, data = {}) => sb.db.run('supabase_admin', [text], data);
  const plan = 'builder';
  let n = 0;

  /** The link in the newest email to an address. */
  const linkFor = (email) => {
    const m = [...mail.sent].reverse().find((x) => x.to.includes(email));
    if (!m) throw new Error('no email was sent to ' + email);
    return /https?:\/\/\S+/.exec(m.text)[0];
  };
  const tokenOfInvite = (link) => link.split('/invite/')[1];

  /** A new company. The owner is created through the operator's first-owner invitation and the real accept route. */
  async function company({ industry = 'build', password = 'Quiet-harbor-lamp-41' } = {}) {
    n += 1;
    const slug = `e2e-${Date.now().toString(36)}-${n}`;
    const email = `owner-${slug}@example.com`;
    const made = await sql(String.raw`
      with t as (insert into public.tenants (slug, name, industry_id, plan_id, status)
                 values ((select v from _in where k = 'slug'), 'Sample Company ' || (select v from _in where k = 'slug'), (select v from _in where k = 'industry'), (select v from _in where k = 'plan'), 'active') returning id)
      select '@@R@@' || jsonb_build_object('id', (select id from t))::text;`, { slug, industry, plan });
    const boot = await sql(String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select v from _in where k = 'id')::uuid, (select v from _in where k = 'email')))::text;`, { id: made.id, email });
    const owner = new Browser(api);
    await owner.open();
    const accepted = await owner.post('/api/auth/invite/accept', { token: boot, password, name: 'Sample Owner' });
    if (accepted.status !== 200 || !accepted.json.signedIn) throw new Error('could not create the owner: ' + accepted.text);
    return { tenantId: made.id, slug, owner, email, password };
  }

  /** Signs a browser in with email and password (no second step). */
  async function signIn(email, password, opts) {
    const b = new Browser(api, opts);
    await b.open();
    const r = await b.post('/api/auth/signin', { email, password });
    return { browser: b, res: r };
  }
  /** Passes the fresh identity check with the password. */
  const stepUp = (browser, password) => browser.post('/api/auth/stepup', { password });

  /** Invites an address into a company as the owner and accepts with a new browser. Returns that browser. */
  async function addMember(co, role, { password = 'Maple-river-stone-88' } = {}) {
    n += 1;
    const email = `${role}-${n}-${co.slug}@example.com`;
    await stepUp(co.owner, co.password);
    const inv = await co.owner.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email, role, name: 'Sample ' + role } });
    if (inv.status !== 200) throw new Error('invite failed: ' + inv.text);
    const b = new Browser(api);
    await b.open();
    const acc = await b.post('/api/auth/invite/accept', { token: tokenOfInvite(linkFor(email)), password });
    if (acc.status !== 200) throw new Error('accept failed: ' + acc.text);
    return { browser: b, email, password };
  }

  return {
    api, sb, provider, mail, sql, company, signIn, stepUp, addMember, linkFor, tokenOfInvite, totp,
    browser: (opts) => new Browser(api, opts),
    async stop() {
      globalThis.fetch = realFetch;
      await sb.stop(); await provider.stop(); stopPostgres();
    },
  };
}

/** A Svix-style signature for a body, as Resend sends it. */
export function svixHeaders(secret, body, { id = 'msg_' + randomBytes(8).toString('hex'), at = Math.floor(Date.now() / 1000) } = {}) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(at), 'svix-signature': 'v1,' + sig, 'content-type': 'application/json' };
}
/** The "t=...,v1=..." signature of the test provider. */
export function mockSignature(secret, body, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}
