// The whole stack over HTTP: scripts/serve.mjs running the functions of api/ with the rewrites of vercel.json,
// the TEST DOUBLE of the Supabase HTTP surface, and the local PostgreSQL. Also checks vercel.json itself and that the
// functions which existed before this build still answer. Proved against the local stand-in, not on Vercel or Supabase.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStack, root, PORTS } from './helpers.mjs';

let st; let co; const servers = [];
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-serve-test-'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>test shell</title><div id="root"></div>');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

async function serve(port, extra = {}) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port), DIST: dist, APP_ORIGIN: origin, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  await new Promise((resolve, reject) => { child.stdout.on('data', (d) => { if (String(d).includes('preview on')) resolve(); }); child.on('exit', () => reject(new Error('serve.mjs stopped'))); setTimeout(() => reject(new Error('serve.mjs did not start')), 8000); });
  return origin;
}
/** A small cookie-keeping client over real HTTP. */
function client(origin) {
  const jar = new Map();
  return {
    jar,
    async call(method, url, body) {
      const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      if (method !== 'GET') { headers.origin = origin; headers['content-type'] = 'application/json'; if (jar.get('vx-csrf')) headers['x-vx-csrf'] = jar.get('vx-csrf'); }
      const res = await fetch(origin + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
      const set = res.headers.getSetCookie();
      for (const c of set) { const [pair, ...attrs] = c.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (!v || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), v); }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json, text, headers: res.headers, setCookies: set };
    },
  };
}

before(async () => { st = await startStack(); co = await st.company(); });
after(async () => { for (const s of servers) s.kill(); await st.stop(); fs.rmSync(dist, { recursive: true, force: true }); });

test('vercel.json: few functions, a rewrite for each, scheduled calls, and the strict browser policy kept', () => {
  const functions = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.ok(functions.length <= 12, `${functions.length} functions (the limit is 12)`);
  for (const name of ['auth', 'ws', 'integrations', 'webhooks', 'cron']) {
    assert.ok(functions.includes(name + '.js'));
    assert.ok(vercel.rewrites.some((r) => r.source === `/api/${name}/:path*` && r.destination === `/api/${name}?vxpath=:path*`), 'rewrite for ' + name);
  }
  for (const name of ['assistant', 'demo-request', 'health']) assert.ok(functions.includes(name + '.js'), name + ' is still there');
  const spa = vercel.rewrites.at(-1);
  assert.equal(spa.destination, '/index.html');
  assert.ok(new RegExp('^' + spa.source + '$').test('/some-company/leads') && !new RegExp('^' + spa.source + '$').test('/api/auth/session'), 'the page fallback does not swallow /api');
  assert.deepEqual(vercel.crons.map((c) => c.path).sort(), ['/api/cron/daily', '/api/cron/tick']);
  for (const c of vercel.crons) assert.match(c.schedule, /^(\S+\s){4}\S+$/);
  const csp = vercel.headers.find((h) => h.source === '/(.*)').headers.find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'self'(;|$)/, 'the browser may talk to this site only');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval|supabase|\*/.test(csp));
  for (const key of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(vercel.headers[0].headers.some((h) => h.key === key), key);
  assert.ok(vercel.headers.some((h) => h.source === '/api/(.*)' && h.headers.some((x) => x.key === 'Cache-Control' && x.value === 'no-store')));
  // a function file exports HTTP methods only: anything else would be an extra, unintended export on Vercel
  for (const f of functions) {
    const src = fs.readFileSync(path.join(root, 'api', f), 'utf8');
    for (const m of src.matchAll(/^export (?:async )?(?:const|function) (\w+)/gm)) assert.match(m[1], /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/, `${f} exports ${m[1]}`);
  }
});

test('over HTTP: sign in, cookies, load, sign out (the address style Vercel hands to a function is the original one)', async () => {
  const origin = await serve(PORTS.serve);
  const c = client(origin);
  const health = await c.call('GET', '/api/health');
  assert.equal(health.json.ok, true); assert.equal(health.json.configured.workspace, true);
  const s0 = await c.call('GET', '/api/auth/session');
  assert.equal(s0.json.signedIn, false);
  assert.ok(c.jar.get('vx-csrf'));
  const bad = await c.call('POST', '/api/auth/signin', { email: co.email, password: 'wrong-password-000' });
  assert.deepEqual([bad.status, bad.json], [401, { ok: false, error: 'invalid_credentials' }]);
  const ok = await c.call('POST', '/api/auth/signin', { email: co.email, password: co.password });
  assert.equal(ok.status, 200);
  assert.ok(ok.setCookies.length >= 2, 'several Set-Cookie headers arrive as separate headers');
  const sessionCookie = ok.setCookies.find((x) => x.startsWith('vx=s1.'));
  assert.match(sessionCookie, /HttpOnly/); assert.match(sessionCookie, /SameSite=Lax/); assert.match(sessionCookie, /Path=\//);
  const s1 = await c.call('GET', '/api/auth/session');
  assert.equal(s1.json.signedIn, true);
  assert.equal(s1.json.memberships[0].tenantId, co.tenantId);
  const load = await c.call('GET', '/api/ws/load?tenant=' + co.tenantId);
  assert.equal(load.status, 200);
  assert.equal(load.headers.get('cache-control'), 'no-store');
  const list = await c.call('GET', '/api/integrations?tenant=' + co.tenantId);
  assert.equal(list.json.connections.length, 14);
  assert.equal((await c.call('POST', '/api/ws/rpc/conn_get', { tenant: co.tenantId, args: {} })).status, 404);
  assert.equal((await c.call('GET', '/api/cron/tick')).status, 401);
  assert.equal((await c.call('POST', '/api/auth/signup', { email: 'new@example.com', password: 'Quiet-harbor-lamp-41' })).status, 404);
  assert.deepEqual((await c.call('POST', '/api/auth/signout', {})).json, { ok: true });
  assert.equal((await c.call('GET', '/api/auth/session')).json.signedIn, false);
  // pages: any address without a dot gets the single-page shell, and /api never does
  const page = await fetch(origin + '/some-company/leads');
  assert.match(await page.text(), /test shell/);
  assert.equal((await fetch(origin + '/api/nothing-here')).status, 404);
});

test('over HTTP, with the rewritten address style (/api/auth?vxpath=...): the same routes answer', async () => {
  const origin = await serve(PORTS.serve + 1, { VX_REWRITE_STYLE: 'destination' });
  const c = client(origin);
  assert.equal((await c.call('GET', '/api/auth/session')).json.signedIn, false);
  const ok = await c.call('POST', '/api/auth/signin', { email: co.email, password: co.password });
  assert.equal(ok.status, 200);
  assert.equal((await c.call('GET', '/api/ws/load?tenant=' + co.tenantId)).status, 200);
  assert.equal((await c.call('POST', '/api/auth/mfa/verify', { code: '123456' })).json.error, 'not_enrolled', 'a two-part path arrives whole');
  assert.equal((await c.call('GET', '/api/integrations?tenant=' + co.tenantId)).status, 200, 'the empty sub-path');
  assert.equal((await c.call('POST', '/api/integrations/mock/connect', { tenant: co.tenantId })).json.error, 'stepup_required', 'provider and action arrive whole');
  assert.equal((await c.call('POST', '/api/auth/register', {})).status, 404);
});

test('over HTTP, with the response headers of vercel.json switched on', async () => {
  const origin = await serve(PORTS.serve + 2, { VX_HEADERS: '1' });
  const page = await fetch(origin + '/');
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const apiRes = await fetch(origin + '/api/health');
  assert.equal(apiRes.headers.get('cache-control'), 'no-store');
  assert.match(apiRes.headers.get('content-security-policy'), /default-src 'self'/);
});

test('the functions that existed before this build still answer', async () => {
  const origin = `http://127.0.0.1:${PORTS.serve}`;
  const assistant = await (await fetch(origin + '/api/assistant')).json();
  assert.deepEqual(assistant, { ok: true, configured: false });
  const ask = await fetch(origin + '/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
  assert.deepEqual([ask.status, await ask.json()], [503, { ok: false, configured: false }]);
  const demo = await fetch(origin + '/api/demo-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
  assert.equal(demo.status, 400);
  assert.equal((await demo.json()).error, 'invalid');
  const valid = { name: 'Sample Person', business: 'Sample Company', industry: 'build', phone: '555-555-0100', email: 'person@example.com', language: 'en', contactMethod: 'email', teamSize: '2-5', consent: true };
  const sent = await fetch(origin + '/api/demo-request', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.44' }, body: JSON.stringify(valid) });
  assert.deepEqual(await sent.json(), { ok: true, delivered: false, reason: 'not_configured' }, 'DEMO_REQUEST_TO is not set in the test run: nothing is sent, and the answer says so');
  assert.equal((await fetch(origin + '/api/demo-request')).status, 405);
  const health = await (await fetch(origin + '/api/health')).json();
  for (const k of ['database', 'demoRequestEmail', 'assistant']) assert.equal(typeof health.configured[k], 'boolean', 'the keys the deployment checklist reads are still there');
  assert.equal((await fetch(origin + '/api/health', { method: 'HEAD' })).status, 200);
});
