// Tests of scripts/security/scan-bundle.mjs against small builds made at run time.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanBundle, serverOnlyNames } from '../../scripts/security/scan-bundle.mjs';
import { tempDir, write, rand, fakeJwt, run } from './helpers.mjs';

const page = (extra = '') => `<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div>${extra}<script type="module" src="/assets/app.js"></script></body></html>`;
const build = (t, files = {}) => write(tempDir(t), { 'index.html': page(), 'assets/app.js': 'console.log("ok");\n', 'assets/app.css': 'body{margin:0}\n', ...files });
const rules = (dir, opts) => [...new Set(scanBundle(dir, opts).findings.map((f) => f.rule))].sort();

test('a plain build is clean for both deployments', (t) => {
  const dir = build(t);
  assert.deepEqual(rules(dir, { deploy: 'vyntex' }), []);
  assert.deepEqual(rules(dir, { deploy: 'lbs' }), []);
});

test('finds a key, a server setting name, a database address and leftover server code', (t) => {
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': `const k="${fakeJwt('service_role')}";` })), ['supabase-service-role-jwt']);
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': `const k="${'sk' + '_live_' + rand(24)}";` })), ['stripe-key']);
  const name = 'SUPABASE_' + 'SERVICE_ROLE_KEY';
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': `const n="${name}";` })), ['server-setting-name']);
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': 'fetch(u,{headers:{role:"service' + '_role"}})' })), ['server-setting-name']);
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': 'const u=process' + '.env.SOMETHING_ELSE;' })), ['server-code']);
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': 'fetch("https://abcdefghijklmnopqrst.supa' + 'base.co/rest/v1/clients")' })), ['database-address']);
  assert.ok(serverOnlyNames(path.join('missing', '.env.example')).includes(name), 'the fixed list applies even without .env.example');
});

test('reads secret-looking names from an environment example file', (t) => {
  const dir = write(tempDir(t), { '.env.example': 'VX_DEPLOY=\nDIALPAD_API_KEY=\nQUICKBOOKS_CLIENT_SECRET=\nDEMO_REQUEST_TO=\n' });
  const names = serverOnlyNames(path.join(dir, '.env.example'));
  assert.ok(names.includes('DIALPAD_API_KEY') && names.includes('QUICKBOOKS_CLIENT_SECRET'));
  assert.ok(!names.includes('VX_DEPLOY') && !names.includes('DEMO_REQUEST_TO'));
});

test('finds source maps', (t) => {
  assert.deepEqual(rules(build(t, { 'assets/app.js.map': '{"version":3}' })), ['source-map']);
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': 'console.log(1);\n//# sourceMapping' + 'URL=chunk-a.js.map\n' })), ['source-map']);
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': 'console.log(1);\n//# sourceMapping' + 'URL=data:application/json;base64,e30=\n' })), ['source-map']);
});

test('finds scripts written inside the page, and allows data blocks', (t) => {
  assert.deepEqual(rules(build(t, { 'index.html': page('<script>alert(1)</script>') })), ['inline-script']);
  assert.deepEqual(rules(build(t, { 'index.html': page('<button onclick="go()">x</button>') })), ['inline-script']);
  assert.deepEqual(rules(build(t, { 'index.html': page('<script src="https://cdn.example.com/x.js"></script>') })), ['external-script']);
  assert.deepEqual(rules(build(t, { 'index.html': page('<script type="application/ld+json">{"a":1}</script>') })), []);
});

test('finds the other deployment\'s brand, as words and as files', (t) => {
  const withVyntex = build(t, { 'assets/chunk-a.js': 'const n="VYNTEX ' + 'Command";', 'brand/vyntex-logo.jpg': 'x' });
  assert.deepEqual(rules(withVyntex, { deploy: 'vyntex' }), [], 'its own brand is fine');
  const lbs = scanBundle(withVyntex, { deploy: 'lbs' }).findings;
  assert.deepEqual([...new Set(lbs.map((f) => f.rule))], ['other-brand']);
  assert.deepEqual(lbs.map((f) => f.file).sort(), ['assets/chunk-a.js', 'brand/vyntex-logo.jpg']);
  const withLbs = build(t, { 'assets/chunk-a.js': 'const n="LBS ' + 'Command";', 'brand-lbs/lion-96.png': 'x' });
  assert.deepEqual(rules(withLbs, { deploy: 'lbs' }), []);
  assert.deepEqual(rules(withLbs, { deploy: 'vyntex' }), ['other-brand']);
  // the firm's name is allowed in the VYNTEX build (the pricing rules name it); only the product name and files are not
  assert.deepEqual(rules(build(t, { 'assets/chunk-a.js': 'const n="Lion Business Services";' }), { deploy: 'vyntex' }), []);
  assert.deepEqual(rules(build(t), { deploy: 'vyntex', forbid: ['console.log'] }), ['other-brand']);
});

test('a folder that is not a build is reported', (t) => {
  const dir = write(tempDir(t), { 'readme.txt': 'x' });
  assert.deepEqual(rules(dir), ['not-a-build']);
});

test('command line exit codes', (t) => {
  const ok = build(t);
  assert.equal(run('scan-bundle.mjs', [ok, '--deploy', 'vyntex']).code, 0);
  assert.equal(run('scan-bundle.mjs', [ok, '--deploy', 'other']).code, 2);
  assert.equal(run('scan-bundle.mjs', []).code, 2);
  assert.equal(run('scan-bundle.mjs', [path.join(ok, 'missing'), '--deploy', 'lbs']).code, 2);
  const value = fakeJwt('service_role');
  const bad = build(t, { 'assets/chunk-a.js': `const k="${value}";` });
  const r = run('scan-bundle.mjs', [bad, '--deploy', 'lbs']);
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes(value));
});
