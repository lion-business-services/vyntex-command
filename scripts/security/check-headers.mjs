#!/usr/bin/env node
// Checks that vercel.json still sends the browser protections this platform relies on. It reads the file; it does not
// call a website. Run it on every change, because one edited line in vercel.json can switch a protection off for
// every page without any screen looking different.
//
//   node scripts/security/check-headers.mjs                  check vercel.json in this repository
//   node scripts/security/check-headers.mjs --file <path>    check another file
//   node scripts/security/check-headers.mjs --json
//
// Exit code: 0 every required check passed, 1 at least one failed, 2 the file could not be read.
//
// To check what a running site really sends (after a deployment), see docs/security/security-test-plan.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const YEAR = 31536000;

/** "default-src 'self'; img-src 'self' data:" as { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] } */
export function parseCsp(value) {
  const out = {};
  for (const part of String(value || '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) out[name.toLowerCase()] = sources;
  }
  return out;
}

/** The headers vercel.json sends for a path, later rules replacing earlier ones, as Vercel applies them. */
export function headersFor(config, pathname) {
  const out = {};
  for (const rule of config.headers || []) {
    let re; try { re = new RegExp('^' + rule.source + '$'); } catch { continue; }
    if (re.test(pathname)) for (const h of rule.headers || []) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

/** Returns a list of { id, ok, level: 'required' | 'advice', message }. */
export function checkConfig(config) {
  const results = [];
  const check = (id, ok, message, level = 'required') => results.push({ id, ok: !!ok, level, message });
  const page = headersFor(config, '/any/page');
  const csp = parseCsp(page['content-security-policy']);
  const has = (d) => Array.isArray(csp[d]);
  const src = (d) => csp[d] || csp['default-src'] || [];
  const only = (d, allowed) => has(d) && csp[d].length > 0 && csp[d].every((s) => allowed.includes(s));
  const loose = (list) => list.filter((s) => ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", '*', 'data:', 'blob:', 'http:', 'https:', 'filesystem:'].includes(s));

  check('csp-present', !!page['content-security-policy'], 'a Content-Security-Policy is sent on every page');
  check('csp-default', only('default-src', ["'self'", "'none'"]), "default-src is 'self' (or 'none')");
  check('csp-script', src('script-src').length > 0 && loose(src('script-src')).length === 0,
    `script-src allows no inline script, no eval and no open source${loose(src('script-src')).length ? ' (found ' + loose(src('script-src')).join(' ') + ')' : ''}`);
  check('csp-script-self', src('script-src').every((s) => s === "'self'" || /^'(nonce|sha(256|384|512))-/.test(s)), "script-src loads scripts from this site only");
  for (const d of ['script-src-elem', 'script-src-attr']) if (has(d)) check('csp-' + d, loose(csp[d]).length === 0, `${d} allows no inline script`);
  check('csp-connect', only('connect-src', ["'self'"]), "connect-src is exactly 'self': the pages call this site only, never the database or a provider");
  check('csp-frame-ancestors', only('frame-ancestors', ["'none'"]), "frame-ancestors is 'none': the site cannot be shown inside another site");
  check('csp-object', only('object-src', ["'none'"]), "object-src is 'none'");
  check('csp-base', only('base-uri', ["'self'", "'none'"]), "base-uri is 'self' (or 'none')");
  check('csp-form', only('form-action', ["'self'", "'none'"]), "form-action is 'self' (or 'none')");
  check('csp-style', !src('style-src').includes("'unsafe-inline'"), "style-src allows no inline styles", 'advice');

  const hsts = String(page['strict-transport-security'] || '');
  const age = Number((/max-age=(\d+)/i.exec(hsts) || [])[1] || 0);
  check('hsts', age >= YEAR && /includeSubDomains/i.test(hsts), `Strict-Transport-Security lasts a year or more and covers subdomains (max-age=${age})`);
  check('nosniff', String(page['x-content-type-options'] || '').toLowerCase() === 'nosniff', 'X-Content-Type-Options is nosniff');
  check('frame-options', String(page['x-frame-options'] || '').toUpperCase() === 'DENY', 'X-Frame-Options is DENY');
  check('referrer', ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes(String(page['referrer-policy'] || '').toLowerCase()), 'Referrer-Policy does not send full addresses to other sites');
  const perms = String(page['permissions-policy'] || '');
  check('permissions', ['camera', 'microphone', 'geolocation'].every((f) => new RegExp(`${f}=\\(\\)`).test(perms)), 'Permissions-Policy turns off camera, microphone and location');

  const api = headersFor(config, '/api/health');
  check('api-no-store', /no-store/i.test(String(api['cache-control'] || '')), 'answers of /api/ are never cached (Cache-Control: no-store)');
  check('api-csp', !!api['content-security-policy'], 'the Content-Security-Policy also covers /api/');
  const index = headersFor(config, '/index.html');
  check('index-revalidate', /no-cache|no-store|max-age=0/i.test(String(index['cache-control'] || '')), 'index.html is checked for a new version on every visit');

  const all = (config.headers || []).flatMap((r) => r.headers || []);
  check('no-open-cors', !all.some((h) => h.key.toLowerCase() === 'access-control-allow-origin' && h.value.trim() === '*'), 'no rule opens the site to requests from every origin (Access-Control-Allow-Origin: *)');
  check('no-powered-by', !all.some((h) => ['server', 'x-powered-by'].includes(h.key.toLowerCase())), 'no header advertises the server software');
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config, file;
  try {
    const { opts } = parseArgs(process.argv.slice(2), ['file']);
    file = path.resolve(opts.file || path.join(repoRoot, 'vercel.json'));
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const results = checkConfig(config);
    const failed = results.filter((r) => !r.ok && r.level === 'required');
    if (opts.json) console.log(JSON.stringify({ file, results }, null, 2));
    else {
      for (const r of results) console.log(`${r.ok ? 'ok  ' : r.level === 'advice' ? 'note' : 'FAIL'}  ${r.message}`);
      console.log(`header check: ${results.filter((r) => r.ok).length} of ${results.length} passed${failed.length ? `, ${failed.length} required check(s) failed` : ''} (${path.relative(process.cwd(), file) || file})`);
    }
    process.exit(failed.length ? 1 : 0);
  } catch (e) {
    console.error(`header check could not run${file ? ' on ' + file : ''}: ${e.message}`);
    process.exit(2);
  }
}
