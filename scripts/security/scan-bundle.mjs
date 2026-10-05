#!/usr/bin/env node
// Inspects a finished build (the folder that is published to visitors) for things a browser must never receive.
//
//   node scripts/security/scan-bundle.mjs dist --deploy vyntex
//   node scripts/security/scan-bundle.mjs dist-lbs --deploy lbs
//   node scripts/security/scan-bundle.mjs <folder> --deploy <vyntex|lbs> [--json] [--forbid "text one,text two"]
//
// Exit code: 0 nothing found, 1 something found, 2 the scan itself could not run.
//
// What it checks:
//   1. keys and tokens (the same patterns as scan-secrets.mjs)
//   2. the names of server-only settings such as the service role key. A name is not a secret, but a server setting's
//      name inside browser code means server code was bundled by mistake, and the value may follow next time.
//   3. source maps. They would publish the readable source code.
//   4. any address of the database service. The pages talk to this site only (Content-Security-Policy connect-src 'self').
//   5. scripts written inside the page. The Content-Security-Policy blocks them, so one would be a bug or an injection.
//   6. the other deployment's brand: LBS Command must not carry VYNTEX Command's name and logo files, and the reverse.
//
// Everything in the build folder is public by definition, so this scan reads every file in it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { walk, readText, parseArgs, lineOf, report } from './lib.mjs';
import { scanText as scanSecrets, scanName } from './scan-secrets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// Settings that only server functions may read. More are added from .env.example when that file is present.
const SERVER_ONLY = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SESSION_SECRET', 'RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'IP_HASH_SALT', 'PII_ENCRYPTION_KEY', 'CRON_SECRET'];
const SECRET_LOOKING = /(SECRET|SERVICE_ROLE|_KEY$|TOKEN|PASSWORD|SALT)/;

// What each deployment must not contain: words in any text file, and folders of the other brand's files.
export const OTHER_BRAND = {
  vyntex: { label: 'LBS Command', text: ['LBS Command', 'brand-lbs', 'lbscommand'], folders: ['brand-lbs/'] },
  lbs: { label: 'VYNTEX Command', text: ['VYNTEX Command', 'vyntex-logo', 'vyntex-mark', 'vyntex-wordmark', 'vyntex-v.webp', 'vyntex-v-sm', 'vyntex-v-xs'], folders: ['brand/'] },
};

/** Names of server-only settings: the fixed list plus every secret-looking name in .env.example. */
export function serverOnlyNames(envExample = path.join(repoRoot, '.env.example')) {
  const names = new Set(SERVER_ONLY);
  if (fs.existsSync(envExample)) {
    for (const m of fs.readFileSync(envExample, 'utf8').matchAll(/^[ \t]*([A-Z][A-Z0-9_]+)[ \t]*=/gm)) if (SECRET_LOOKING.test(m[1])) names.add(m[1]);
  }
  return [...names];
}

function each(text, needle, fn) {
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) fn(i);
}

/** Scans a build folder. `deploy` is 'vyntex', 'lbs' or null (skips the brand check). */
export function scanBundle(dir, { deploy = null, forbid = [], names = serverOnlyNames() } = {}) {
  const findings = [];
  const files = walk(dir, { skip: () => false });
  let checked = 0;
  const brand = deploy ? OTHER_BRAND[deploy] : null;
  for (const rel of files) {
    if (/\.map$/i.test(rel)) findings.push({ file: rel, line: 0, rule: 'source-map', message: 'source map file. It publishes the readable source code.', fingerprint: null });
    for (const f of scanName(rel)) findings.push(f);
    if (brand && brand.folders.some((d) => rel.startsWith(d))) findings.push({ file: rel, line: 0, rule: 'other-brand', message: `brand file of ${brand.label} in the ${deploy} build`, fingerprint: null });
    const text = readText(path.join(dir, rel));
    if (text === null) continue;
    checked++;
    findings.push(...scanSecrets(text, rel));
    const add = (rule, index, message) => findings.push({ file: rel, line: lineOf(text, index), rule, message, fingerprint: null });
    for (const n of names) each(text, n, (i) => add('server-setting-name', i, `the name of a server-only setting, ${n}, is in the build`));
    each(text, 'service_role', (i) => add('server-setting-name', i, 'the database role "service_role" is named in the build'));
    each(text, 'sourceMappingURL=', (i) => add('source-map', i, 'a source map reference'));
    for (const m of text.matchAll(/\bprocess\.env\.[A-Z0-9_]+/g)) add('server-code', m.index, `a read of ${m[0]} was left in browser code`);
    for (const m of text.matchAll(/[a-z0-9]{12,}\.supabase\.(?:co|in)\b|\/(?:rest|auth|storage)\/v1\//g)) add('database-address', m.index, 'an address of the database service. The pages must call this site only.');
    if (/\.html?$/i.test(rel)) {
      for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(m[1]);
        const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1]);
        const data = type && /json|template/i.test(type[1]); // data blocks are not run
        if (!src && !data && m[2].trim()) add('inline-script', m.index, 'a script written inside the page. The Content-Security-Policy blocks it.');
        if (src && /^(https?:)?\/\//i.test(src[1])) add('external-script', m.index, 'a script loaded from another site');
      }
      for (const m of text.matchAll(/\son[a-z]+\s*=\s*["']/gi)) add('inline-script', m.index, 'an inline event handler (onclick and similar). The Content-Security-Policy blocks it.');
    }
    if (brand) for (const word of [...brand.text, ...forbid]) each(text, word, (i) => add('other-brand', i, `"${word}" belongs to ${brand.label} and is in the ${deploy} build`));
    else for (const word of forbid) each(text, word, (i) => add('forbidden-text', i, `"${word}" is in the build`));
  }
  if (!files.includes('index.html')) findings.push({ file: 'index.html', line: 0, rule: 'not-a-build', message: 'no index.html in this folder: it does not look like a finished build', fingerprint: null });
  return { findings, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { opts, rest } = parseArgs(process.argv.slice(2), ['deploy', 'forbid']);
    if (!rest[0]) throw new Error('give the build folder, for example: node scripts/security/scan-bundle.mjs dist --deploy vyntex');
    const dir = path.resolve(rest[0]);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`folder not found: ${dir}`);
    if (opts.deploy && !OTHER_BRAND[opts.deploy]) throw new Error('--deploy must be vyntex or lbs');
    if (!opts.deploy) console.error('note: no --deploy given, so the check for the other deployment\'s brand is skipped');
    const forbid = opts.forbid ? String(opts.forbid).split(',').map((s) => s.trim()).filter(Boolean) : [];
    const { findings, checked } = scanBundle(dir, { deploy: opts.deploy || null, forbid });
    process.exit(report(`bundle scan (${opts.deploy || 'no deployment given'})`, findings, { json: !!opts.json, checked }));
  } catch (e) {
    console.error('bundle scan could not run: ' + e.message);
    process.exit(2);
  }
}
