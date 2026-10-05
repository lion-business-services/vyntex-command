// Tests of deploy/container/server.mjs, the server that runs the platform outside Vercel. Each test starts it on a free
// port against a small build and small functions made at run time. What matters here: the browser protections of
// vercel.json reach every answer, nothing outside the build can be read, and the log holds no address and no message.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createApp, compileSource, fillDestination } from '../../deploy/container/server.mjs';
import { repoRoot, tempDir, write } from './helpers.mjs';

const realConfig = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
const SECRET_IN_ERROR = 'provider said: key ' + 'abc' + '123 is wrong';

/** A small site: the real vercel.json plus one sub-path rewrite, a build, and functions that show what they received. */
function site(t, { config = {}, env = {} } = {}) {
  const root = tempDir(t);
  const cfg = { ...realConfig(), ...config };
  cfg.rewrites = [{ source: '/api/echo/(.*)', destination: '/api/echo?vxpath=$1' }, ...(cfg.rewrites || [])];
  write(root, {
    'package.json': '{ "type": "module" }',
    'vercel.json': JSON.stringify(cfg),
    'top-secret.txt': 'outside the build',
    'dist/index.html': '<!doctype html><title>app shell</title>',
    'dist/assets/app-ABC123.js': 'console.log("app")',
    'dist/brand/logo.png': 'png',
    'dist/.env': 'LEFT_BEHIND=1',
    'api/echo.js': `
      const answer = async (request) => new Response(JSON.stringify({
        method: request.method, url: request.url, ip: request.headers.get('x-real-ip'), forwarded: request.headers.get('x-forwarded-for'),
        proto: request.headers.get('x-forwarded-proto'), vercel: request.headers.get('x-vercel-something'),
        body: request.method === 'POST' ? await request.text() : null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      export const GET = answer; export const POST = answer;`,
    'api/cookie.js': `export function GET() { const h = new Headers({ 'content-type': 'text/plain', 'cache-control': 'private, max-age=5' }); h.append('set-cookie', 'a=1; Path=/; HttpOnly'); h.append('set-cookie', 'b=2; Path=/; HttpOnly'); return new Response('ok', { headers: h }); }`,
    'api/boom.js': `export function GET() { throw new Error(${JSON.stringify(SECRET_IN_ERROR)}); }`,
    'api/slow.js': `export const GET = () => new Promise((resolve) => setTimeout(() => resolve(new Response('late')), 1500));`,
    'api/cron.js': `export function GET(request) { const ok = request.headers.get('authorization') === 'Bearer ' + process.env.TEST_CRON_EXPECTED; return new Response(JSON.stringify({ ok, job: new URL(request.url).pathname.split('/').pop() }), { status: ok ? 200 : 401 }); }`,
    'api/_lib/helper.js': `export const GET = () => new Response('a helper must not be reachable');`,
  });
  const lines = [];
  const app = createApp({ root, dist: path.join(root, 'dist'), config: cfg, env, log: (l) => lines.push(l) });
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
    const port = server.address().port;
    // a raw request: fetch() would tidy "../" out of the address before sending it
    const raw = (target, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, bad) => {
      const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', bad); if (body) req.write(body); req.end();
    });
    resolve({ raw, lines, app, cfg, root, port });
  }));
}
const pageHeaders = (cfg) => Object.fromEntries(cfg.headers.find((r) => r.source === '/(.*)').headers.map((h) => [h.key.toLowerCase(), h.value]));
const hasProtections = (res, cfg) => { for (const [k, v] of Object.entries(pageHeaders(cfg))) assert.equal(res.headers[k], v, `header ${k}`); };

test('pages: the app shell answers every page address, with the headers of vercel.json', async (t) => {
  const { raw, cfg } = await site(t);
  for (const target of ['/', '/demo/jobs', '/pricing', '/some-company/clients/123', '/sign/abcDEF']) {
    const r = await raw(target);
    assert.equal(r.status, 200, target);
    assert.match(r.text, /app shell/);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.headers['cache-control'], /max-age=0/);
    hasProtections(r, cfg);
  }
  const head = await raw('/demo', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.text, '');
});

test('files: hashed assets are cached for a year, a missing asset is a 404 and not the app shell', async (t) => {
  const { raw, cfg } = await site(t);
  const asset = await raw('/assets/app-ABC123.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /javascript/);
  assert.match(asset.headers['cache-control'], /immutable/);
  hasProtections(asset, cfg);
  const missing = await raw('/assets/nope.js');
  assert.equal(missing.status, 404);
  assert.ok(!/app shell/.test(missing.text));
  hasProtections(missing, cfg);
  assert.equal((await raw('/assets/app-ABC123.js', { method: 'POST' })).status, 405);
});

test('nothing outside the build can be read', async (t) => {
  const { raw } = await site(t);
  const attempts = ['/../top-secret.txt', '/..%2ftop-secret.txt', '/%2e%2e/top-secret.txt', '/assets/..%2f..%2ftop-secret.txt', '/assets/../../top-secret.txt',
    '/..%5ctop-secret.txt', '/assets/%2e%2e/%2e%2e/vercel.json', '/..%2fapi%2fecho.js', '/%00', '/.env', '/assets/..%2f.env', '//top-secret.txt', '/api/../top-secret.txt'];
  for (const target of attempts) {
    const r = await raw(target);
    assert.ok(!/outside the build|LEFT_BEHIND|vxpath|export const/.test(r.text), `${target} leaked a file (status ${r.status})`);
    assert.ok([200, 308, 400, 404].includes(r.status), `${target} gave ${r.status}`);
  }
});

test('functions: reached by name, helpers are not, answers are never cached and carry the protections', async (t) => {
  const { raw, cfg } = await site(t);
  const r = await raw('/api/echo?x=1');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  hasProtections(r, cfg);
  assert.equal(new URL(JSON.parse(r.text).url).search, '?x=1');
  for (const target of ['/api/_lib/helper', '/api/_lib/helper.js', '/api/nope', '/api/echo.js', '/api/']) {
    const miss = await raw(target);
    assert.ok(miss.status === 404 || (target === '/api/' && miss.status === 308), `${target} gave ${miss.status}`);
    assert.ok(!/must not be reachable/.test(miss.text));
  }
  assert.equal((await raw('/api/echo', { method: 'DELETE' })).status, 405);
  assert.equal((await raw('/api/echo', { method: 'TRACE' })).status, 405);
  const posted = await raw('/api/echo', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' });
  assert.equal(JSON.parse(posted.text).body, 'hello');
});

test('functions: a rewrite of /api/<name>/<rest> keeps the address and adds the value the rewrite names', async (t) => {
  const { raw } = await site(t);
  const seen = JSON.parse((await raw('/api/echo/mfa/verify?a=b')).text);
  const url = new URL(seen.url);
  assert.equal(url.pathname, '/api/echo/mfa/verify');
  assert.equal(url.searchParams.get('vxpath'), 'mfa/verify');
  assert.equal(url.searchParams.get('a'), 'b');
});

test('the caller\'s address comes from the connection unless the proxy is trusted', async (t) => {
  const spoof = { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9', 'x-forwarded-proto': 'https', 'x-vercel-something': 'spoofed' };
  const plain = await site(t);
  const a = JSON.parse((await plain.raw('/api/echo', { headers: spoof })).text);
  assert.equal(a.ip, '127.0.0.1'); assert.equal(a.forwarded, '127.0.0.1'); assert.equal(a.proto, 'http'); assert.equal(a.vercel, null);
  const trusted = await site(t, { env: { TRUST_PROXY: '1' } });
  const b = JSON.parse((await trusted.raw('/api/echo', { headers: spoof })).text);
  assert.equal(b.ip, '203.0.113.9'); assert.equal(b.proto, 'https'); assert.equal(b.vercel, null);
});

test('a failing function gives a plain answer, and neither the answer nor the log repeats the error text', async (t) => {
  const { raw, lines } = await site(t);
  const r = await raw('/api/boom');
  assert.equal(r.status, 500);
  assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'server_error' });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(!lines.join('\n').includes('abc' + '123'));
  assert.ok(lines.some((l) => JSON.parse(l).level === 'error'));
});

test('limits: a body that is too large is refused, a function that takes too long is cut off', async (t) => {
  const cfg = realConfig(); cfg.functions = { 'api/*.js': { maxDuration: 1 } };
  const { raw } = await site(t, { config: { functions: cfg.functions }, env: { MAX_BODY_BYTES: '10' } });
  assert.equal((await raw('/api/echo', { method: 'POST', body: 'x'.repeat(50), headers: { 'content-length': '50' } })).status, 413);
  const slow = await raw('/api/slow');
  assert.equal(slow.status, 504);
  assert.deepEqual(JSON.parse(slow.text), { ok: false, error: 'timeout' });
});

test('limits: a function with its own time limit in vercel.json gets that limit', async (t) => {
  const { raw } = await site(t, { config: { functions: { 'api/*.js': { maxDuration: 1 }, 'api/slow.js': { maxDuration: 5 } } } });
  const slow = await raw('/api/slow');
  assert.equal(slow.status, 200);
  assert.equal(slow.text, 'late');
});

test('scheduled calls: cron-call.mjs sends the secret, reports success and failure by exit code, and never prints the secret', async (t) => {
  const secret = 'cron-' + 'fixture-' + Math.random().toString(36).slice(2).padEnd(12, 'x') + '-0123456789';
  process.env.TEST_CRON_EXPECTED = secret;
  t.after(() => { delete process.env.TEST_CRON_EXPECTED; });
  const { port } = await site(t);
  const call = (job, env) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(repoRoot, 'deploy/container/cron-call.mjs'), job], { env: { PATH: process.env.PATH, CRON_TARGET: `http://127.0.0.1:${port}`, ...env } },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, out: stdout + stderr }));
  });
  const good = await call('tick', { CRON_SECRET: secret });
  assert.equal(good.code, 0, good.out);
  assert.equal(JSON.parse(good.out).status, 200);
  assert.ok(!good.out.includes(secret));
  const wrong = await call('daily', { CRON_SECRET: 'not-the-right-value-0123456789' });
  assert.equal(wrong.code, 1);
  assert.equal(JSON.parse(wrong.out).status, 401);
  assert.equal((await call('tick', {})).code, 1, 'no secret set');
  assert.equal((await call('../etc', { CRON_SECRET: secret })).code, 1, 'a job name is a plain word');
  assert.equal((await call('tick', { CRON_SECRET: secret, CRON_TARGET: 'http://127.0.0.1:9' })).code, 1, 'nothing listening');
});

test('the schedules in the Kubernetes reference are the ones in vercel.json', () => {
  const yaml = fs.readFileSync(path.join(repoRoot, 'deploy/k8s/base/cronjobs.yaml'), 'utf8');
  const jobs = [...yaml.matchAll(/schedule: "([^"]+)"[\s\S]*?cron-call\.mjs", "([a-z]+)"/g)].map((m) => `${m[2]} ${m[1]}`).sort();
  const wanted = (realConfig().crons || []).map((c) => `${c.path.split('/').pop()} ${c.schedule}`).sort();
  assert.ok(wanted.length > 0, 'vercel.json lists scheduled calls');
  assert.deepEqual(jobs, wanted);
});

test('cookies: every Set-Cookie of a function is passed on, and its own cache rule is kept', async (t) => {
  const { raw } = await site(t);
  const r = await raw('/api/cookie');
  assert.deepEqual(r.headers['set-cookie'], ['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly']);
  assert.equal(r.headers['cache-control'], 'private, max-age=5');
  assert.ok(r.headers['content-security-policy']);
});

test('the request log holds the kind of route and the status, never the address', async (t) => {
  const { raw, lines } = await site(t);
  const token = 'tok' + 'EN-' + 'q7w8e9';
  await raw(`/sign/${token}?also=${token}`);
  await raw(`/api/echo/${token}`);
  const text = lines.join('\n');
  assert.ok(!text.includes(token));
  assert.deepEqual(lines.map((l) => JSON.parse(l).route), ['spa', 'api:echo']);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['m', 'ms', 'route', 's', 't']);
});

test('health and stopping: /healthz answers 200, then 503 once the server was told to stop', async (t) => {
  const { raw, app, lines } = await site(t);
  assert.equal((await raw('/healthz')).status, 200);
  app.stop();
  assert.equal((await raw('/healthz')).status, 503);
  assert.equal(lines.length, 0, 'health checks are not logged');
});

test('a trailing slash is redirected, as "trailingSlash": false asks', async (t) => {
  const { raw } = await site(t);
  const r = await raw('/pricing/?a=1');
  assert.equal(r.status, 308);
  assert.equal(r.headers.location, '/pricing?a=1');
});

test('a rule this server cannot follow stops it at start, instead of being ignored', (t) => {
  const root = write(tempDir(t), { 'dist/index.html': 'x' });
  const base = { root, dist: path.join(root, 'dist'), env: {}, log: () => {} };
  assert.throws(() => createApp({ ...base, config: { headers: [{ source: '/(.*)', has: [{ type: 'host', value: 'x' }], headers: [] }] } }), /has/);
  assert.throws(() => createApp({ ...base, config: { rewrites: [{ source: '/a', missing: [{ type: 'cookie', key: 'x' }], destination: '/b' }] } }), /missing/);
  assert.throws(() => createApp({ ...base, config: { cleanUrls: true } }), /cleanUrls/);
  assert.throws(() => createApp({ ...base, config: { rewrites: [{ source: '/a(b', destination: '/b' }] } }), /unbalanced/);
});

test('reading the address patterns of vercel.json', () => {
  const spa = compileSource('/((?!api/|assets/|brand/)[^.]*)');
  for (const p of ['/', '/demo', '/demo/jobs/j1']) assert.ok(spa.test(p), p);
  for (const p of ['/api/health', '/assets/app.js', '/brand/logo.png', '/favicon.png']) assert.ok(!spa.test(p), p);
  const sub = compileSource('/api/auth/:path*');
  assert.equal(sub.exec('/api/auth/mfa/verify').groups.path, 'mfa/verify');
  assert.ok(sub.test('/api/auth'));
  assert.ok(!sub.test('/api/authx'));
  assert.equal(compileSource('/sign/:token').exec('/sign/abc').groups.token, 'abc');
  assert.ok(!compileSource('/sign/:token').test('/sign/a/b'));
  assert.ok(compileSource('/index.html').test('/index.html'));
  assert.ok(!compileSource('/index.html').test('/indexXhtml'), 'a dot is a dot');
  assert.equal(fillDestination('/api/auth?vxpath=:path*', sub.exec('/api/auth/a/b')), '/api/auth?vxpath=a/b');
  assert.equal(fillDestination('/api/x?p=$1', compileSource('/api/x/(.*)').exec('/api/x/y/z')), '/api/x?p=y/z');
});

test('the vercel.json of this repository can be followed by this server', (t) => {
  const root = write(tempDir(t), { 'dist/index.html': 'x' });
  assert.doesNotThrow(() => createApp({ root, dist: path.join(root, 'dist'), config: realConfig(), env: {}, log: () => {} }));
});
