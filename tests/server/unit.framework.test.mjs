// The integration framework without a database: the provider list, honest states, environment safety rules,
// error answers, and the routes that must not exist. Supabase is pointed at an address nothing listens on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv, ORIGIN } from './helpers.mjs';

setTestEnv({ SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon-key-for-unit-tests', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-unit-tests-0123456789' });
const E = await import('../../api/_lib/env.js');
const P = await import('../../api/_lib/integrations/providers/index.js');
const C = await import('../../api/_lib/integrations/core.js');
const R = await import('../../api/_lib/respond.js');
const auth = await import('../../api/auth.js');
const ws = await import('../../api/ws.js');
const integrations = await import('../../api/integrations.js');
const webhooks = await import('../../api/webhooks.js');
const cron = await import('../../api/cron.js');
const health = await import('../../api/health.js');
const { RPCS } = await import('../../api/_lib/rpc-allowlist.js');

const withEnv = async (vars, fn) => {
  const keep = {};
  for (const [k, v] of Object.entries(vars)) { keep[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('the provider list has every provider of the data model, in order, and every one is built', async () => {
  const list = await withEnv({ VX_ENV: 'local' }, () => P.catalog());
  assert.deepEqual(list.map((p) => p.id), ['gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai']);
  assert.deepEqual(list.filter((p) => !p.built).map((p) => p.id), [], 'no placeholder is left');
  for (const n of ['GOOGLE_GMAIL_APPROVED', 'QUICKBOOKS_APPROVED', 'META_APPROVED', 'WHATSAPP_APPROVED', 'SMS_APPROVED']) assert.ok(P.providerEnvNames().includes(n), n + ': the approval settings of built adapters are listed too');
  for (const p of list) {
    assert.ok(['oauth', 'key', 'platform'].includes(p.kind), p.id);
    assert.ok(Array.isArray(p.env) && p.env.length > 0 && p.env.every((n) => /^[A-Z][A-Z0-9_]+$/.test(n)), p.id + ' lists the settings it needs');
  }
});

test('the test provider exists only in a test run', async () => {
  assert.equal((await P.getAdapter('mock')).id, 'mock');
  for (const mode of ['local', 'development', 'preview', 'staging', 'production']) {
    await withEnv({ VX_ENV: mode }, async () => {
      assert.equal(await P.getAdapter('mock'), null, mode);
      assert.ok(!(await P.catalog()).some((p) => p.id === 'mock'), mode);
      assert.equal(await P.webhookAdapter('mock'), null, mode);
    });
  }
  await withEnv({ VX_ENV: 'test', VERCEL_ENV: 'production' }, async () => assert.equal(await P.getAdapter('mock'), null, 'a production deployment never loads it, whatever VX_ENV says'));
  assert.equal((await P.getAdapter('gmail')).id, 'gmail');
  assert.equal(await P.getAdapter('stripe'), null, 'a provider that is not on the list is not an adapter');
  assert.equal(await P.getAdapter('constructor'), null);
  assert.equal(await P.getAdapter('__proto__'), null);
});

test('honest states from the deployment settings alone', async () => {
  const list = await P.catalog();
  const by = Object.fromEntries(list.map((p) => [p.id, p]));
  // an entry without an adapter (none is left on the list, the rule stays): not built, whatever is set
  const later = { id: 'later', name: 'Later', kind: 'oauth', env: ['LATER_CLIENT_ID'], built: false };
  assert.deepEqual(C.configState(later), { state: 'not_connected', reason: 'not_built', missing: ['LATER_CLIENT_ID'] });
  assert.deepEqual(C.configState(by.gmail), { state: 'not_connected', reason: 'not_configured', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] });
  // settings in place is not approval: Google has to verify the app before anybody can connect
  await withEnv({ GOOGLE_CLIENT_ID: 'id.apps.example.com', GOOGLE_CLIENT_SECRET: 'x' }, async () => {
    assert.deepEqual(C.configState(by.gmail), { state: 'pending_approval', reason: 'provider_review', missing: [] });
    await withEnv({ GOOGLE_GMAIL_APPROVED: 'true' }, async () => assert.equal(C.configState(by.gmail).state, 'setup'));
  });
  // with nothing set, every provider says which settings are missing, and none is further than that
  for (const p of list) assert.deepEqual([p.id, C.configState(p).state, C.configState(p).missing.length > 0], [p.id, 'not_connected', true]);
  assert.deepEqual(C.configState(by.resend), { state: 'not_connected', reason: 'not_configured', missing: ['RESEND_API_KEY', 'SYSTEM_EMAIL_FROM'] });
  await withEnv({ RESEND_API_KEY: 're_x', SYSTEM_EMAIL_FROM: 'a@example.com' }, async () => {
    assert.deepEqual(C.configState((await P.getAdapter('resend'))), { state: 'setup', reason: 'ready_to_connect', missing: [] });
  });
  await withEnv({ MOCK_OAUTH_BASE: 'http://127.0.0.1:1', MOCK_CLIENT_ID: 'a', MOCK_CLIENT_SECRET: 'b', MOCK_NEEDS_APPROVAL: '1' }, async () => {
    assert.deepEqual(C.configState(await P.getAdapter('mock')), { state: 'pending_approval', reason: 'provider_review', missing: [] });
    await withEnv({ MOCK_APPROVED: 'true' }, async () => assert.equal(C.configState(await P.getAdapter('mock')).state, 'setup'));
  });
});

test('a card never says "connected" unless a stored, verified row says so', async () => {
  const list = await withEnv({ RESEND_API_KEY: 're_x', SYSTEM_EMAIL_FROM: 'a@example.com', MOCK_OAUTH_BASE: 'http://127.0.0.1:1', MOCK_CLIENT_ID: 'a', MOCK_CLIENT_SECRET: 'b' }, async () => {
    const cat = await P.catalog();
    return cat.map((p) => C.describe(p, undefined));
  });
  for (const card of list) assert.notEqual(card.state, 'connected', card.id);
  const later = { id: 'later', name: 'Later', kind: 'oauth', env: ['LATER_CLIENT_ID'], built: false };
  assert.equal(C.describe(later, { id: 'later', state: 'connected' }).state, 'not_connected', 'an entry without an adapter never shows a stored state');
  const gmail = (await P.catalog()).find((p) => p.id === 'gmail');
  assert.equal(C.describe(gmail, { id: 'gmail', state: 'connected' }).state, 'error', 'the same for a built provider whose settings are gone');
  const resend = await P.getAdapter('resend');
  assert.equal(C.describe(resend, { id: 'resend', state: 'connected' }).state, 'error', 'a stored connection on a deployment that lost its settings is an error, not "connected"');
  await withEnv({ RESEND_API_KEY: 're_x', SYSTEM_EMAIL_FROM: 'a@example.com' }, async () => {
    const card = C.describe(await P.getAdapter('resend'), { id: 'resend', state: 'connected', account: 'a@example.com', health: 'ok' });
    assert.equal(card.state, 'connected'); assert.equal(card.reason, 'verified'); assert.equal(card.account, 'a@example.com');
    assert.ok(!('token_enc' in card) && !JSON.stringify(card).includes('token'));
  });
});

test('environment rules: a production deployment refuses test and development settings', async () => {
  assert.deepEqual(E.problems(), [], 'the test environment itself is complete');
  await withEnv({ SESSION_SECRET: undefined }, () => assert.ok(E.problems().includes('missing:SESSION_SECRET')));
  await withEnv({ SESSION_SECRET: 'short' }, () => assert.ok(E.problems().includes('weak:SESSION_SECRET')));
  await withEnv({ TOKEN_ENC_KEY: 'bm90IDMyIGJ5dGVz' }, () => assert.ok(E.problems().includes('invalid:TOKEN_ENC_KEY')));
  await withEnv({ VX_DEPLOY: 'other' }, () => assert.ok(E.problems().includes('invalid:VX_DEPLOY')));
  const prod = { VERCEL_ENV: 'production', VX_ENV: undefined, SUPABASE_URL: 'https://abcd.supabase.co', APP_ORIGIN: 'https://command.example.com' };
  await withEnv(prod, () => assert.deepEqual(E.problems(), []));
  await withEnv({ ...prod, VX_ENV: 'test' }, () => assert.ok(E.problems().includes('mismatch:VX_ENV')));
  await withEnv({ ...prod, SUPABASE_URL: 'http://127.0.0.1:4621' }, () => assert.ok(E.problems().includes('unsafe:SUPABASE_URL')));
  await withEnv({ ...prod, APP_ORIGIN: 'http://command.example.com' }, () => assert.ok(E.problems().includes('unsafe:APP_ORIGIN')));
  await withEnv({ ...prod, MOCK_OAUTH_BASE: 'http://127.0.0.1:4622' }, () => assert.ok(E.problems().includes('unsafe:MOCK_OAUTH_BASE')));
  await withEnv({ ...prod, CRON_SECRET: process.env.SESSION_SECRET }, () => assert.ok(E.problems().includes('reused:CRON_SECRET')));
  await withEnv({ ...prod, APP_ORIGIN: undefined }, () => { assert.ok(E.problems().includes('missing:APP_ORIGIN')); assert.throws(() => E.appOrigin(new Request('https://x.example.com/')), (e) => e.code === 'not_configured'); });
  for (const p of E.problems()) assert.match(p, /^[a-z]+:[A-Z0-9_]+$/, 'a problem is a rule and a name, never a value');
});

test('a deployment with a problem serves no workspace route', async () => {
  await withEnv({ VERCEL_ENV: 'production', VX_ENV: 'test' }, async () => {
    for (const [mod, url, method] of [[auth, '/api/auth/session', 'GET'], [auth, '/api/auth/signin', 'POST'], [ws, '/api/ws/load?tenant=11111111-1111-4111-8111-111111111111', 'GET'], [integrations, '/api/integrations?tenant=11111111-1111-4111-8111-111111111111', 'GET']]) {
      const res = await mod[method](new Request(ORIGIN + url, { method, headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }));
      assert.equal(res.status, 503, url);
      assert.deepEqual(await res.json(), { ok: false, error: 'not_configured' });
    }
  });
});

test('env helpers never return or print a value by accident', () => {
  const list = E.checklist(P.providerEnvNames());
  assert.ok(list.length > 25);
  for (const item of list) { assert.deepEqual(Object.keys(item).sort(), ['name', 'need', 'secret', 'set']); assert.equal(typeof item.set, 'boolean'); }
  assert.ok(!JSON.stringify(list).includes(process.env.SESSION_SECRET));
  const err = new E.ConfigError('TOKEN_ENC_KEY', 'must be 32 bytes, base64 encoded');
  assert.ok(!err.message.includes(process.env.TOKEN_ENC_KEY));
  assert.equal(E.envInt('SESSION_MAX_HOURS', 12, 1, 72), 12);
  process.env.SESSION_MAX_HOURS = '500'; assert.equal(E.envInt('SESSION_MAX_HOURS', 12, 1, 72), 72);
  process.env.SESSION_MAX_HOURS = 'abc'; assert.equal(E.envInt('SESSION_MAX_HOURS', 12, 1, 72), 12);
  delete process.env.SESSION_MAX_HOURS;
});

test('.env.example lists every setting, with no value', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  for (const l of lines) assert.match(l, /^[A-Z][A-Z0-9_]*=$/, `"${l.slice(0, 30)}" must be a name with nothing after the equals sign`);
  const names = new Set(lines.map((l) => l.slice(0, -1)));
  for (const n of [...Object.keys(E.VARIABLES), ...P.providerEnvNames()]) assert.ok(names.has(n), n + ' is listed');
  assert.ok(!names.has('MOCK_OAUTH_BASE'), 'the test provider is not a deployment setting');
});

test('the sub-path is found in the original address and in the rewritten one, and odd paths are refused', () => {
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth/mfa/verify'), 'auth'), 'mfa/verify');
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth?vxpath=mfa/verify'), 'auth'), 'mfa/verify');
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth?vxpath=mfa%2Fverify'), 'auth'), 'mfa/verify');
  assert.equal(R.subPath(new Request(ORIGIN + '/api/integrations'), 'integrations'), '');
  // ".." is resolved by the address parser before the function sees it: this address is not under /api/auth/ at all
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth/../ws/load'), 'auth'), '');
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth?vxpath=a/../../b'), 'auth'), null);
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth?vxpath=a b'), 'auth'), null);
  assert.equal(R.subPath(new Request(ORIGIN + '/api/auth/a/b/c/d/e/f'), 'auth'), null);
});

test('database and auth failures become codes; nothing of the upstream text survives', () => {
  const map = (r) => { const e = R.upstreamError({ status: 400, sqlstate: '', code: '', word: '', ...r }); return [e.status, e.code, e.more.reason]; };
  assert.deepEqual(map({ sqlstate: 'VX401' }), [401, 'session_revoked', undefined]);
  assert.deepEqual(map({ sqlstate: 'VX402' }), [403, 'mfa_required', undefined]);
  assert.deepEqual(map({ sqlstate: 'VX403' }), [403, 'stepup_required', undefined]);
  assert.deepEqual(map({ sqlstate: '42501' }), [403, 'forbidden', undefined]);
  assert.deepEqual(map({ sqlstate: '23505', word: 'already_member' }), [409, 'conflict', 'already_member']);
  assert.deepEqual(map({ sqlstate: '22023', word: 'invalid_role' }), [400, 'invalid', 'invalid_role']);
  assert.deepEqual(map({ sqlstate: 'P0001' }), [409, 'rejected', undefined]);
  assert.deepEqual(map({ sqlstate: 'PGRST202', status: 404 }), [501, 'not_available', undefined]);
  assert.deepEqual(map({ status: 401 }), [401, 'session_expired', undefined]);
  assert.deepEqual(map({ status: 0 }), [503, 'upstream_unreachable', undefined]);
  assert.deepEqual(map({ status: 500 }), [502, 'upstream_error', undefined]);
});

test('an unexpected error inside a handler becomes "server_error" with no detail', async () => {
  const handle = R.entry('x', async () => { throw new Error('connection string postgres://admin:hunter2hunter2@db.internal:5432 failed at /srv/app/secret.js:42'); });
  const res = await handle(new Request(ORIGIN + '/api/x/y'));
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(text, '{"ok":false,"error":"server_error"}');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const res2 = await R.entry('x', async () => { throw new E.ConfigError('SESSION_SECRET'); })(new Request(ORIGIN + '/api/x/y'));
  assert.equal(res2.status, 503); assert.equal(await res2.text(), '{"ok":false,"error":"not_configured"}');
});

test('request bodies: wrong type, too large, not JSON, not an object', async () => {
  const mk = (body, type = 'application/json') => new Request(ORIGIN + '/x', { method: 'POST', headers: { 'content-type': type }, body });
  await assert.rejects(R.readJson(mk('{}', 'text/plain')), (e) => e.status === 415);
  await assert.rejects(R.readJson(mk('x'.repeat(5000)), 1000), (e) => e.status === 413 && e.code === 'too_large');
  await assert.rejects(R.readJson(mk('{not json')), (e) => e.status === 400 && e.code === 'invalid_json');
  await assert.rejects(R.readJson(mk('[1,2]')), (e) => e.code === 'invalid_json');
  assert.deepEqual(await R.readJson(mk('{"a":1}')), { a: 1 });
});

test('there is no sign-up: no route creates an account without an invitation', async () => {
  for (const path of ['signup', 'sign-up', 'register', 'users', 'user', 'admin/users', 'invite', 'invite/create', 'accounts', 'token', 'verify', 'otp', 'magiclink', 'callback']) {
    for (const method of ['POST', 'GET', 'PUT']) {
      const res = await auth[method](new Request(`${ORIGIN}/api/auth/${path}`, { method, headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify({ email: 'new@example.com', password: 'Quiet-harbor-lamp-41' }) }));
      assert.equal(res.status, 404, `${method} /api/auth/${path}`);
      assert.deepEqual(await res.json(), { ok: false, error: 'not_found' });
    }
  }
  assert.ok(!Object.keys(RPCS).some((n) => /signup|register|create_user|admin/.test(n)), 'and no allow-listed database function does');
});

test('the allow-list: every name is a plain function name, and the sensitive ones need a fresh identity check', () => {
  for (const [name, spec] of Object.entries(RPCS)) { assert.match(name, /^[a-z][a-z0-9_]+$/); assert.equal(typeof spec.stepUp, 'boolean', name); }
  for (const name of ['vault_reveal', 'vault_decide', 'member_invite', 'member_set_role', 'member_disable', 'export_request', 'export_1099_data', 'get_worker_tax_id', 'set_worker_tax_id', 'session_revoke_member']) {
    assert.equal(RPCS[name].stepUp, true, name);
  }
  for (const name of ['conn_put', 'conn_get', 'rate_hit', 'job_claim', 'security_event', 'session_stepup_mark', 'invite_claim', 'invite_complete', 'invite_bootstrap', 'auth_context', 'ws_load', 'ws_apply', 'vx_ws_load', 'oauth_state_take', 'mfa_recovery_use', 'server_sweep']) {
    assert.ok(!Object.hasOwn(RPCS, name), name + ' is not reachable through rpc/<name>');
  }
});

test('scheduled addresses refuse anything without the exact secret, before saying whether the job exists', async () => {
  const call = (path, headers = {}) => cron.GET(new Request(`${ORIGIN}/api/cron/${path}`, { headers }));
  for (const path of ['tick', 'daily', 'nothing-here']) {
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: process.env.CRON_SECRET }, { authorization: 'Bearer ' + process.env.CRON_SECRET + 'x' }, { 'x-cron-secret': process.env.CRON_SECRET }]) {
      const res = await call(path, headers);
      assert.equal(res.status, 401, path);
      assert.deepEqual(await res.json(), { ok: false, error: 'unauthorised' });
    }
  }
  assert.equal((await call('nothing-here', { authorization: 'Bearer ' + process.env.CRON_SECRET })).status, 404);
  await withEnv({ CRON_SECRET: 'short' }, async () => assert.equal((await call('tick', { authorization: 'Bearer short' })).status, 401, 'a weak secret is treated as none'));
});

test('webhooks: unknown providers and wrong methods', async () => {
  for (const p of ['nothing', 'stripe', 'constructor']) {
    const res = await webhooks.POST(new Request(`${ORIGIN}/api/webhooks/${p}`, { method: 'POST', body: '{}' }));
    assert.equal(res.status, 404, p);
  }
  assert.equal((await webhooks.GET(new Request(`${ORIGIN}/api/webhooks/resend`))).status, 405);
  assert.equal((await webhooks.POST(new Request(`${ORIGIN}/api/webhooks/a/b`, { method: 'POST', body: '{}' }))).status, 404);
  await withEnv({ VX_ENV: 'local' }, async () => assert.equal((await webhooks.POST(new Request(`${ORIGIN}/api/webhooks/mock`, { method: 'POST', body: '{}' }))).status, 404, 'the test provider has no webhook address outside a test run'));
});

test('workspace and integration routes need a session, and refuse wrong methods', async () => {
  const T = '11111111-1111-4111-8111-111111111111';
  const get = async (mod, url) => (await mod.GET(new Request(ORIGIN + url))).status;
  assert.equal(await get(ws, '/api/ws/load?tenant=' + T), 401);
  assert.equal(await get(ws, '/api/ws/file/get?k=x'), 401);
  assert.equal(await get(integrations, '/api/integrations?tenant=' + T), 401);
  assert.equal(await get(ws, '/api/ws/apply'), 405);
  assert.equal(await get(ws, '/api/ws/rpc/vault_reveal'), 405);
  assert.equal(await get(ws, '/api/ws/nothing'), 404);
  assert.equal(await get(integrations, '/api/integrations/resend/connect'), 405);
  assert.equal(await get(integrations, '/api/integrations/resend/nothing'), 404);
  assert.equal(await get(integrations, '/api/integrations/stripe/callback'), 404, 'a provider that is not on the list has nothing to call');
  assert.equal(await get(integrations, '/api/integrations/resend/callback'), 404, 'a provider without a sign-in step has no return address');
  const post = async (mod, url, headers = {}) => (await mod.POST(new Request(ORIGIN + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })));
  assert.equal((await post(ws, '/api/ws/apply')).status, 403, 'no Origin');
  assert.deepEqual(await (await post(ws, '/api/ws/apply')).json(), { ok: false, error: 'bad_origin' });
  assert.equal((await post(ws, '/api/ws/apply', { origin: 'https://evil.example.com' })).status, 403);
  assert.equal((await post(ws, '/api/ws/apply', { origin: ORIGIN })).status, 403, 'right Origin, no csrf value');
  assert.equal((await post(ws, '/api/ws/rpc/not_on_the_list', { origin: ORIGIN })).status, 404);
  assert.deepEqual(await (await post(ws, '/api/ws/rpc/conn_get', { origin: ORIGIN })).json(), { ok: false, error: 'unknown_operation' });
});

test('the health answer shows yes or no only', async () => {
  const res = await health.GET(new Request(ORIGIN + '/api/health'));
  const body = await res.json();
  assert.equal(body.ok, true); assert.equal(body.deployment, 'vyntex');
  for (const v of Object.values(body.configured)) assert.equal(typeof v, 'boolean');
  assert.equal(body.configured.workspace, true);
  const text = JSON.stringify(body);
  for (const name of ['SESSION_SECRET', 'TOKEN_ENC_KEY', 'IP_HASH_SALT', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) { assert.ok(!text.includes(process.env[name])); assert.ok(!text.includes(name), 'not even the names of settings'); }
  const deepNoAuth = await (await health.GET(new Request(ORIGIN + '/api/health?deep=1'))).json();
  assert.ok(!('database' in deepNoAuth) && !('jobs' in deepNoAuth), 'the deep part needs the scheduled-call secret');
  const lbs = await withEnv({ VX_DEPLOY: 'lbs' }, async () => (await health.GET(new Request(ORIGIN + '/api/health'))).json());
  assert.equal(lbs.deployment, 'lbs');
});
