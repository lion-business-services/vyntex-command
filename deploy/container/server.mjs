#!/usr/bin/env node
// Runs the platform without Vercel: one small Node server that serves the built pages and runs the functions in api/.
//
// The recommended production path is Vercel + Supabase (deploy/k8s/README.md says when a container is justified).
// This file exists so the platform is not tied to one host: the same build, the same functions and the same browser
// protections can run in a container. It reads vercel.json and follows it, so the two ways of hosting cannot drift:
//
//   headers     every rule in vercel.json "headers" is applied to every answer, pages and functions alike
//   rewrites    followed in order, after real files, as Vercel does (the single-page fallback and /api/<name>/... routes)
//   redirects   followed, when there are any
//   functions   api/<name>.js, Web API style (export GET, POST ... or a default function), with the time limit from
//               "functions" in vercel.json
//   crons       NOT run by this server. On Vercel, "crons" in vercel.json calls /api/cron/<job> on a schedule. In a
//               container something else must make those calls: deploy/container/cron-call.mjs, started by the
//               scheduler of the platform (deploy/k8s/base/cronjobs.yaml).
//
//   node deploy/container/server.mjs
//
// Settings (environment variables):
//   PORT            port to listen on                                  default 8080
//   HOST            address to listen on                               default 0.0.0.0
//   DIST            folder with the build                              default dist (dist-lbs when VX_DEPLOY=lbs)
//   APP_ROOT        folder that holds vercel.json and api/             default the repository root
//   TRUST_PROXY=1   believe X-Forwarded-For / X-Forwarded-Proto / X-Forwarded-Host from the proxy in front.
//                   Set it ONLY when every request comes through your own ingress or load balancer. Without it the
//                   caller's address is taken from the connection, so a visitor cannot pretend to be someone else
//                   to the rate limits and the audit trail.
//   MAX_BODY_BYTES  largest request body accepted                      default 4500000 (the limit Vercel applies)
//   SHUTDOWN_GRACE_MS  time given to open requests when asked to stop  default 10000
//   LOG_REQUESTS=0  turn the request log off
//
// What it writes to the log: one line per request with the method, the kind of route, the status and the time taken.
// Never the address requested (it can hold a signing or invitation token), never a header, never a body.
//
// It writes nothing to disk, so the container can run with a read-only file system, and it needs no privileges.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf',
};
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
// Headers that describe one network hop, or that only the real platform may set.
const DROP_REQUEST = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|x-vercel-.*|x-real-ip|forwarded)$/i;

/**
 * Turns a "source" of vercel.json into a regular expression. Vercel writes these in path-to-regexp form:
 * plain text, groups in brackets that are regular expressions, and named parts (:name, :name*, :name+, :name(regex)).
 */
export function compileSource(source) {
  let out = '';
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === '(') {                                   // a regular expression group: copied as it is, to its closing bracket
      let depth = 0, j = i;
      for (; j < source.length; j++) {
        if (source[j] === '\\') { j++; continue; }
        if (source[j] === '(') depth++;
        else if (source[j] === ')' && --depth === 0) break;
      }
      if (depth !== 0) throw new Error(`unbalanced brackets in "${source}"`);
      out += source.slice(i, j + 1);
      i = j + 1;
      if ('*+?'.includes(source[i] || ' ')) out += source[i++];
    } else if (ch === ':' && /[A-Za-z_]/.test(source[i + 1] || '')) {   // a named part
      const m = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(i));
      i += m[0].length;
      let inner = '[^/]+';
      if (source[i] === '(') {
        let depth = 0, j = i;
        for (; j < source.length; j++) { if (source[j] === '\\') { j++; continue; } if (source[j] === '(') depth++; else if (source[j] === ')' && --depth === 0) break; }
        if (depth !== 0) throw new Error(`unbalanced brackets in "${source}"`);
        inner = source.slice(i + 1, j); i = j + 1;
      }
      const mod = '*+?'.includes(source[i] || ' ') ? source[i++] : '';
      const slash = out.endsWith('/');
      if (mod === '*' || mod === '?') {
        // "/api/auth/:path*" also matches "/api/auth": the slash before an optional part is optional too
        if (slash) out = out.slice(0, -1);
        out += `(?:${slash ? '/' : ''}(?<${m[1]}>${mod === '*' ? '.*' : inner}))?`;
      } else out += `(?<${m[1]}>${mod === '+' ? '.+' : inner})`;
    } else { out += /[.+*?^$|[\]{}\\]/.test(ch) ? '\\' + ch : ch; i++; }
  }
  return new RegExp('^' + out + '$');
}

/** Fills $1, $2 and :name in a rewrite or redirect destination from what the source matched. */
export function fillDestination(destination, match) {
  return destination
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)\*?/g, (whole, name) => (match.groups && name in match.groups ? (match.groups[name] ?? '') : whole))
    .replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '');
}

function compileRules(list, kind) {
  return (list || []).map((rule) => {
    if (rule.has || rule.missing) throw new Error(`a ${kind} rule for "${rule.source}" uses "has" or "missing", which this server does not support. Add support here before running it in a container.`);
    return { ...rule, re: compileSource(rule.source) };
  });
}

/** Builds the request handler. Everything it needs is passed in, so tests can run it on a temporary folder. */
export function createApp({ root, dist, config, env = process.env, log = (line) => process.stdout.write(line + '\n') }) {
  const headerRules = compileRules(config.headers, 'headers');
  const rewrites = compileRules(config.rewrites, 'rewrite');
  const redirects = compileRules(config.redirects, 'redirect');
  if (config.cleanUrls) throw new Error('"cleanUrls": true is not supported by this server');
  const apiDir = path.join(root, 'api');
  const functions = new Map();
  if (fs.existsSync(apiDir)) {
    for (const f of fs.readdirSync(apiDir)) if (/^[a-z0-9][a-z0-9-]*\.js$/i.test(f)) functions.set(f.slice(0, -3), path.join(apiDir, f));
  }
  // The time limit of a function: its own entry in "functions" when it has one, else the entry for all of them.
  const limits = config.functions || {};
  const maxSecondsFor = (name) => {
    for (const key of [`api/${name}.js`, 'api/*.js', 'api/**/*.js']) if (Number(limits[key]?.maxDuration) > 0) return Number(limits[key].maxDuration);
    return 30;
  };
  const maxBody = Number(env.MAX_BODY_BYTES) > 0 ? Number(env.MAX_BODY_BYTES) : 4_500_000;
  const trustProxy = env.TRUST_PROXY === '1';
  const logging = env.LOG_REQUESTS !== '0';
  const distRoot = path.resolve(dist);
  const modules = new Map();
  let stopping = false;

  const configHeaders = (pathname) => {
    const out = new Map();
    for (const rule of headerRules) if (rule.re.test(pathname)) for (const h of rule.headers || []) out.set(h.key.toLowerCase(), [h.key, h.value]);
    return out;
  };
  /** Sends an answer. Headers from vercel.json are added; a header the function set itself is kept. */
  const send = (res, pathname, status, headers, body) => {
    for (const [lower, [key, value]] of configHeaders(pathname)) if (!res.hasHeader(lower) && !(lower in headers)) res.setHeader(key, value);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.statusCode = status;
    res.end(body);
  };
  const sendJson = (res, pathname, status, body, extra = {}) =>
    send(res, pathname, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }, JSON.stringify(body));

  /** The file in the build that an address points at, or null. Never leaves the build folder. */
  const staticFile = (pathname) => {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    // hidden files are never served, whatever ended up in the build folder (/.well-known/ is the one standard exception)
    if (decoded.split('/').some((part) => part.startsWith('.') && part !== '.well-known')) return null;
    const file = path.resolve(distRoot, '.' + path.posix.normalize('/' + decoded));
    if (file !== distRoot && !file.startsWith(distRoot + path.sep)) return null;
    try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
  };
  const serveFile = (req, res, pathname, file) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, pathname, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Method not allowed');
    const st = fs.statSync(file);
    const headers = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': String(st.size), 'last-modified': st.mtime.toUTCString() };
    for (const [lower, [key, value]] of configHeaders(pathname)) if (!(lower in headers)) res.setHeader(key, value);
    if (!res.hasHeader('cache-control')) res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.statusCode = 200;
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBody) { req.resume(); return resolve(null); }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > maxBody) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const runFunction = async (req, res, name, url, extraQuery) => {
    const pathname = url.pathname;
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    if (body === null) return sendJson(res, pathname, 413, { ok: false, error: 'too_large' });
    let mod = modules.get(name);
    if (!mod) { mod = await import(pathToFileURL(functions.get(name)).href); modules.set(name, mod); }
    const handler = mod[req.method] || (typeof mod.default === 'function' ? mod.default : typeof mod.default?.fetch === 'function' ? mod.default.fetch.bind(mod.default) : null);
    if (!handler) return sendJson(res, pathname, 405, { ok: false, error: 'method_not_allowed' }, { allow: METHODS.filter((m) => typeof mod[m] === 'function').join(', ') });

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (DROP_REQUEST.test(k) || k === 'host' || k === 'content-length') continue;
      if (!trustProxy && /^x-forwarded-/i.test(k)) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    }
    // Who is calling: from the proxy when it is trusted, else from the connection itself.
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const address = forwarded || (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    headers.set('x-real-ip', address);
    headers.set('x-forwarded-for', address);
    const proto = trustProxy ? String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() : (req.socket.encrypted ? 'https' : 'http');
    const host = (trustProxy && req.headers['x-forwarded-host'] ? String(req.headers['x-forwarded-host']).split(',')[0].trim() : req.headers.host) || 'localhost';
    headers.set('host', host);
    headers.set('x-forwarded-proto', proto);
    headers.set('x-forwarded-host', host);

    // The function sees the address the visitor asked for. Values a rewrite adds (?name=...) are appended, as Vercel does.
    const target = new URL(pathname + url.search, `${proto}://${host}`);
    for (const [k, v] of extraQuery || []) if (!target.searchParams.has(k)) target.searchParams.append(k, v);
    const abort = new AbortController();
    const request = new Request(target, { method: req.method, headers, body: body && body.length ? body : undefined, signal: abort.signal });
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), maxSecondsFor(name) * 1000); });
    let out;
    try { out = await Promise.race([handler(request), timeout]); } finally { clearTimeout(timer); }
    if (out === 'timeout') { abort.abort(); return sendJson(res, pathname, 504, { ok: false, error: 'timeout' }); }
    if (!(out instanceof Response)) throw new TypeError('the function did not return a Response');

    const cookies = typeof out.headers.getSetCookie === 'function' ? out.headers.getSetCookie() : [];
    out.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
    if (cookies.length) res.setHeader('set-cookie', cookies);
    for (const [lower, [key, value]] of configHeaders(pathname)) if (!res.hasHeader(lower)) res.setHeader(key, value);
    res.statusCode = out.status;
    if (req.method === 'HEAD' || !out.body) return res.end();
    res.end(Buffer.from(await out.arrayBuffer()));
  };

  const functionFor = (pathname) => {
    const m = /^\/api\/([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(pathname);
    return m && functions.has(m[1]) ? m[1] : null;
  };

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    let route = 'none';
    res.on('close', () => {
      if (!logging || route === 'health') return;
      log(JSON.stringify({ t: new Date().toISOString(), m: req.method, route, s: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) }));
    });
    let url;
    try { url = new URL(req.url, 'http://internal'); } catch { route = 'bad'; res.statusCode = 400; return res.end(); }
    const pathname = url.pathname;
    try {
      // Liveness for the container platform. It answers without touching the database or a provider.
      if (pathname === '/healthz') { route = 'health'; res.setHeader('cache-control', 'no-store'); res.setHeader('content-type', 'text/plain; charset=utf-8'); res.statusCode = stopping ? 503 : 200; return res.end(stopping ? 'stopping' : 'ok'); }
      if (!METHODS.includes(req.method)) { route = 'bad'; return send(res, pathname, 405, { allow: METHODS.join(', '), 'content-type': 'text/plain; charset=utf-8' }, 'Method not allowed'); }

      // vercel.json has "trailingSlash": false: /pricing/ goes to /pricing
      if (config.trailingSlash === false && pathname.length > 1 && pathname.endsWith('/') && !pathname.startsWith('//')) {
        route = 'redirect';
        return send(res, pathname, 308, { location: pathname.replace(/\/+$/, '') + url.search }, '');
      }
      for (const rule of redirects) {
        const m = rule.re.exec(pathname);
        if (m) { route = 'redirect'; return send(res, pathname, rule.statusCode || (rule.permanent === false ? 307 : 308), { location: fillDestination(rule.destination, m) }, ''); }
      }

      // Real things first: a function, then a file of the build.
      let fn = functionFor(pathname);
      if (fn) { route = 'api:' + fn; return await runFunction(req, res, fn, url); }
      let file = pathname.startsWith('/api/') || pathname === '/' ? null : staticFile(pathname);
      if (file) { route = 'static'; return serveFile(req, res, pathname, file); }

      // Then the rewrites, first match wins.
      for (const rule of rewrites) {
        const m = rule.re.exec(pathname);
        if (!m) continue;
        const dest = new URL(fillDestination(rule.destination, m), 'http://internal');
        fn = functionFor(dest.pathname);
        if (fn) { route = 'api:' + fn; return await runFunction(req, res, fn, url, [...dest.searchParams]); }
        file = staticFile(dest.pathname);
        if (file) { route = dest.pathname === '/index.html' ? 'spa' : 'static'; return serveFile(req, res, pathname === '/' ? '/index.html' : pathname, file); }
        break;
      }
      if (pathname === '/') { file = staticFile('/index.html'); if (file) { route = 'spa'; return serveFile(req, res, '/index.html', file); } }
      if (pathname.startsWith('/api/')) return sendJson(res, pathname, 404, { ok: false, error: 'not_found' });
      return send(res, pathname, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Not found');
    } catch (e) {
      // The name and code of the error only. Its message can quote a provider or the database.
      log(JSON.stringify({ t: new Date().toISOString(), level: 'error', route, error: e?.name || 'Error', code: e?.code || null }));
      if (res.headersSent) return res.destroy();
      return sendJson(res, pathname, 500, { ok: false, error: 'server_error' });
    }
  }
  handle.stop = () => { stopping = true; };
  handle.functions = [...functions.keys()];
  return handle;
}

/** Reads the settings, checks that a build is there, and returns { server, app, port, host, dist }. Does not listen yet. */
export function createServer(env = process.env) {
  const root = path.resolve(env.APP_ROOT || path.join(here, '../..'));
  const configFile = path.join(root, 'vercel.json');
  if (!fs.existsSync(configFile)) throw new Error(`vercel.json not found in ${root}`);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const dist = path.resolve(root, env.DIST || (env.VX_DEPLOY === 'lbs' ? 'dist-lbs' : 'dist'));
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`no build found in ${dist} (index.html is missing). Build first: node scripts/build.mjs`);
  const app = createApp({ root, dist, config, env });
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;   // longer than the usual load balancer idle time, so it is the balancer that closes
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;
  return { server, app, dist, port: Number(env.PORT || 8080), host: env.HOST || '0.0.0.0' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let made;
  try { made = createServer(); } catch (e) { console.error('cannot start: ' + e.message); process.exit(1); }
  const { server, app, port, host, dist } = made;
  server.listen(port, host, () => console.log(JSON.stringify({ t: new Date().toISOString(), event: 'listening', port, deploy: process.env.VX_DEPLOY === 'lbs' ? 'lbs' : 'vyntex', build: path.basename(dist), functions: app.functions.length })));
  // Asked to stop (a new version is rolling out): refuse new work, let open requests finish, then leave.
  const stop = (signal) => {
    app.stop();
    console.log(JSON.stringify({ t: new Date().toISOString(), event: 'stopping', signal }));
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), Number(process.env.SHUTDOWN_GRACE_MS) > 0 ? Number(process.env.SHUTDOWN_GRACE_MS) : 10_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
