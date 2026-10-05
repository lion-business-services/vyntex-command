// Tests of scripts/security/check-headers.mjs. The first test reads the real vercel.json, so a change that weakens
// a browser protection fails here. The others break one protection at a time and expect the check to notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkConfig, parseCsp, headersFor } from '../../scripts/security/check-headers.mjs';
import { repoRoot, tempDir, run } from './helpers.mjs';

const real = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
const failed = (config) => checkConfig(config).filter((r) => !r.ok && r.level === 'required').map((r) => r.id);
// a copy of the real file with one header changed
function withHeader(key, change) {
  const c = real();
  const rule = c.headers.find((r) => r.source === '/(.*)');
  const h = rule.headers.find((x) => x.key === key);
  if (change === null) rule.headers = rule.headers.filter((x) => x.key !== key); else h.value = change(h.value);
  return c;
}
const csp = (change) => withHeader('Content-Security-Policy', change);

test('vercel.json in this repository passes every required check', () => {
  assert.deepEqual(failed(real()), []);
});

test('reading a policy and matching a path', () => {
  assert.deepEqual(parseCsp("default-src 'self'; img-src 'self' data:;"), { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] });
  const h = headersFor(real(), '/api/health');
  assert.equal(h['cache-control'], 'no-store');
  assert.ok(h['content-security-policy']);
  assert.match(headersFor(real(), '/assets/app-ABC.js')['cache-control'], /immutable/);
});

const BREAKS = [
  ['inline scripts allowed', csp((v) => v.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")), 'csp-script'],
  ['eval allowed', csp((v) => v.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")), 'csp-script'],
  ['scripts from any https site', csp((v) => v.replace("script-src 'self'", "script-src 'self' https:")), 'csp-script'],
  ['scripts from another site', csp((v) => v.replace("script-src 'self'", "script-src 'self' https://cdn.example.com")), 'csp-script-self'],
  ['script-src removed while default-src is open', csp((v) => v.replace("script-src 'self'; ", '').replace("default-src 'self'", 'default-src *')), 'csp-script'],
  ['pages may call the database directly', csp((v) => v.replace("connect-src 'self'", "connect-src 'self' https://abc.supabase.co")), 'csp-connect'],
  ['pages may call anything', csp((v) => v.replace("connect-src 'self'", 'connect-src *')), 'csp-connect'],
  ['connect-src removed', csp((v) => v.replace("connect-src 'self'; ", '')), 'csp-connect'],
  ['framing allowed', csp((v) => v.replace("frame-ancestors 'none'", "frame-ancestors 'self'")), 'csp-frame-ancestors'],
  ['plugins allowed', csp((v) => v.replace("object-src 'none'", "object-src 'self'")), 'csp-object'],
  ['forms may post elsewhere', csp((v) => v.replace("form-action 'self'", 'form-action *')), 'csp-form'],
  ['policy removed', withHeader('Content-Security-Policy', null), 'csp-present'],
  ['HSTS removed', withHeader('Strict-Transport-Security', null), 'hsts'],
  ['HSTS too short', withHeader('Strict-Transport-Security', () => 'max-age=3600; includeSubDomains'), 'hsts'],
  ['HSTS without subdomains', withHeader('Strict-Transport-Security', () => 'max-age=63072000'), 'hsts'],
  ['content sniffing allowed', withHeader('X-Content-Type-Options', null), 'nosniff'],
  ['frame header weakened', withHeader('X-Frame-Options', () => 'SAMEORIGIN'), 'frame-options'],
  ['full addresses sent to other sites', withHeader('Referrer-Policy', () => 'unsafe-url'), 'referrer'],
  ['camera allowed', withHeader('Permissions-Policy', (v) => v.replace('camera=()', 'camera=(self)')), 'permissions'],
];
for (const [name, config, id] of BREAKS) {
  test(`notices: ${name}`, () => {
    assert.ok(failed(config).includes(id), `expected ${id} to fail, got ${JSON.stringify(failed(config))}`);
  });
}

test('notices: answers of /api/ may be cached, and an open cross-origin rule', () => {
  const a = real(); a.headers = a.headers.filter((r) => r.source !== '/api/(.*)');
  assert.ok(failed(a).includes('api-no-store'));
  const b = real(); b.headers.push({ source: '/api/(.*)', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] });
  assert.ok(failed(b).includes('no-open-cors'));
});

test('inline styles are reported as advice, not as a failure', () => {
  const c = csp((v) => v.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"));
  assert.deepEqual(failed(c), []);
  assert.equal(checkConfig(c).find((r) => r.id === 'csp-style').ok, false);
});

test('command line exit codes', (t) => {
  assert.equal(run('check-headers.mjs').code, 0);
  const dir = tempDir(t);
  const bad = path.join(dir, 'vercel.json');
  fs.writeFileSync(bad, JSON.stringify(csp((v) => v.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))));
  const r = run('check-headers.mjs', ['--file', bad]);
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL/);
  fs.writeFileSync(bad, '{ not json');
  assert.equal(run('check-headers.mjs', ['--file', bad]).code, 2);
  assert.equal(run('check-headers.mjs', ['--file', path.join(dir, 'missing.json')]).code, 2);
});
