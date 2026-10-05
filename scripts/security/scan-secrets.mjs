#!/usr/bin/env node
// Looks for keys, tokens, passwords and private keys in the files of this repository, before they reach GitHub.
//
//   node scripts/security/scan-secrets.mjs                 scan this repository
//   node scripts/security/scan-secrets.mjs --root <folder> scan another folder
//   node scripts/security/scan-secrets.mjs --all           also scan files that Git ignores (for example .env.local)
//   node scripts/security/scan-secrets.mjs --json          machine-readable output
//   node scripts/security/scan-secrets.mjs --allow <file>  allow-list (default scripts/security/secrets-allowlist.txt)
//
// Exit code: 0 nothing found, 1 something found, 2 the scan itself could not run.
//
// What it checks: the working tree as it is now. In a Git folder that means every tracked file and every new file that
// .gitignore does not exclude. It does not read Git history; the gitleaks job in .github/workflows/secret-scan.yml does.
// A finding prints the file, the line, the rule and a fingerprint. It never prints the value.
//
// This is a pattern scan. It finds keys that look like keys. It cannot know that a short password typed into a file is
// a password, so it supports the rule "secrets live in environment variables" and does not replace it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { walk, gitFiles, readText, fingerprint, redact, loadAllowList, parseArgs, lineOf, report } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// A JSON Web Token is three base64url parts. Supabase's legacy anon and service_role keys are tokens of this shape,
// and the middle part says which one it is, so the finding can say "service role" when that is what it is.
function classifyJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload && payload.role === 'service_role') return { rule: 'supabase-service-role-jwt', what: 'Supabase service role key (bypasses row level security)' };
    if (payload && payload.role === 'anon') return { rule: 'supabase-anon-jwt', what: 'Supabase anon key (the browser never needs it here: it talks to this site only)' };
  } catch { /* not readable JSON: still a token */ }
  return { rule: 'jwt', what: 'signed token (JWT)' };
}

/** Provider key formats. Each `re` is global; group 1, when present, is the secret part of the match. */
export const RULES = [
  { id: 'private-key-block', what: 'private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'jwt', what: 'signed token (JWT)', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g, classify: classifyJwt },
  { id: 'supabase-secret-key', what: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  { id: 'supabase-access-token', what: 'Supabase account access token', re: /\bsbp_[a-f0-9]{40}\b/g },
  { id: 'resend-key', what: 'Resend API key', re: /\bre_[A-Za-z0-9]{6,12}_[A-Za-z0-9]{16,}\b/g },
  { id: 'square-token', what: 'Square access token or application secret', re: /\b(?:EAAA[A-Za-z0-9_-]{56,}|sq0(?:atp|csp)-[A-Za-z0-9_-]{22,})/g },
  { id: 'meta-token', what: 'Meta (Facebook, Instagram, WhatsApp) access token', re: /\bEAA[B-Zb-z0-9][A-Za-z0-9]{80,}\b/g },
  { id: 'google-api-key', what: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'google-oauth-secret', what: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{24,}/g },
  { id: 'google-refresh-token', what: 'Google OAuth refresh token', re: /(?<![A-Za-z0-9])1\/\/0[A-Za-z0-9_-]{40,}/g },
  { id: 'anthropic-key', what: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'stripe-key', what: 'Stripe secret or restricted key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'stripe-webhook-secret', what: 'Stripe webhook signing secret', re: /\bwhsec_[A-Za-z0-9]{24,}\b/g },
  { id: 'github-token', what: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { id: 'aws-access-key', what: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'age-secret-key', what: 'age private key (the backup decryption key)', re: /\bAGE-SECRET-KEY-1[A-Z0-9]{50,}\b/g },
  { id: 'npm-token', what: 'npm registry token', re: /_authToken\s*=\s*([^\s$<{][^\s]{15,})/g },
  { id: 'database-url-password', what: 'database address with a password in it', re: /\bpostgres(?:ql)?:\/\/[^\s:/@'"`]+:([^\s@/'"`]{6,})@/g, value: true },
];

const SECRET_NAME = '(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ROLE_?KEY|ENCRYPTION_?KEY|SIGNING_?KEY|SALT)';
// name = "value" in any file
const GENERIC_QUOTED = new RegExp(`\\b([A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_]*)["']?\\s*[:=]\\s*(["'\`])([^"'\`\\s]{20,})\\2`, 'gi');
// NAME=value without quotes, only in files where that is how settings are written
const GENERIC_BARE = new RegExp(`^[ \\t]*(?:export[ \\t]+|-[ \\t]+)?([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*)[ \\t]*[:=][ \\t]*([^\\s"'\`#]{20,})[ \\t]*$`, 'gim');
const SETTINGS_FILE = /(^|\/)\.env[^/]*$|\.(ya?ml|toml|ini|conf|cfg|properties|sh|bash|ps1|tfvars)$/i;

const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;
const ENV_EXAMPLE = /(^|\/)\.env(\.[^/]+)*\.(example|sample|template)$/;
const KEY_FILE = /(^|\/)(id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|p12|pfx|jks|keystore)|[^/]*service[-_]?account[^/]*\.json|credentials\.json)$/i;

/** True when a value is plainly a stand-in and not a real secret. */
export function isPlaceholder(v) {
  if (/[<>]|\$\{|\{\{|\$\(|%[A-Z_]+%/.test(v)) return true;                    // <your-key>, ${VAR}, {{ secret }}, $(command)
  if (/^\$[A-Za-z_]/.test(v)) return true;                                       // $VARIABLE
  if (/process\.env|import\.meta|secrets\.|vars\.|env\.[A-Z]/.test(v)) return true; // a reference to a setting, not a value
  if (/x{6,}|\*{4,}|\.{4,}|0{12,}/i.test(v)) return true;
  if (/example|placeholder|changeme|change[-_]me|replace|redacted|your[-_]|dummy|not[-_]a[-_]real|fixture/i.test(v)) return true;
  if (/(^|[-_.])(test|local|sample|demo|fake|mock)([-_.]|$)/i.test(v)) return true; // local-test-key-0123: says what it is
  if (new Set(v).size < 6) return true;                                          // aaaaaaaa
  return false;
}

/** Bits of surprise per character. Words and identifiers score low, random keys score high. */
export function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

/**
 * True for a value written as words: "another-session-secret-0123456789" or "at-PLAINTEXT-ACCESS-TOKEN-123456".
 * Tests use such values on purpose, so that nobody mistakes them for real ones. A random key does not contain two
 * or more whole words between its dashes.
 */
export function isWordy(v) {
  const words = v.split(/[-_.]/).filter((part) => /^[a-z]{3,}$/.test(part) || /^[A-Z]{3,}$/.test(part));
  return words.length >= 2;
}

function looksRandom(v) {
  if (isPlaceholder(v) || isWordy(v)) return false;
  if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;   // a key mixes letters and digits; a sentence or a path does not
  if (/^[a-z]+([._/-][a-z0-9]+)+$/i.test(v) && entropy(v) < 4.2) return false; // dotted or dashed names: app.settings.some_key
  return entropy(v) >= 3.6;
}

/** Scans one text. Returns findings without the matched value. `rel` is the path shown in the finding. */
export function scanText(text, rel) {
  const found = [];
  const seen = new Set();
  const add = (rule, index, value, what) => {
    const key = `${index}:${value.length}`;
    if (seen.has(key)) return;            // one place, one finding, even when two formats overlap
    seen.add(key);
    found.push({ file: rel, line: lineOf(text, index), rule, message: `${what}: ${redact(value)}`, fingerprint: fingerprint(value) });
  };
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (let m; (m = r.re.exec(text));) {
      const value = m[1] || m[0];
      if (r.value && isPlaceholder(value)) continue;
      const c = r.classify ? r.classify(m[0]) : { rule: r.id, what: r.what };
      add(c.rule, m.index, m[0], c.what);
    }
  }
  GENERIC_QUOTED.lastIndex = 0;
  for (let m; (m = GENERIC_QUOTED.exec(text));) {
    if (looksRandom(m[3])) add('generic-secret', m.index, m[3], `a value assigned to "${m[1]}" that looks like a real secret`);
  }
  if (SETTINGS_FILE.test(rel)) {
    GENERIC_BARE.lastIndex = 0;
    for (let m; (m = GENERIC_BARE.exec(text));) {
      if (looksRandom(m[2])) add('generic-secret', m.index, m[2], `a value assigned to "${m[1]}" that looks like a real secret`);
    }
  }
  // The example environment file lists names only. A value next to a secret-looking name means someone filled it in.
  if (ENV_EXAMPLE.test(rel)) {
    const re = new RegExp(`^[ \\t]*([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*)[ \\t]*=[ \\t]*(\\S+)[ \\t]*$`, 'gim');
    for (let m; (m = re.exec(text));) {
      if (!isPlaceholder(m[2])) add('env-example-has-value', m.index, m[2], `"${m[1]}" has a value in the example file, which must list names only`);
    }
  }
  return found;
}

/** Findings that come from the name of a file and not from its content. */
export function scanName(rel) {
  if (ENV_FILE.test(rel) && !ENV_EXAMPLE.test(rel)) {
    return [{ file: rel, line: 0, rule: 'env-file', message: 'environment file that Git does not ignore. Only .env.example belongs in the repository.', fingerprint: null }];
  }
  if (KEY_FILE.test(rel)) {
    return [{ file: rel, line: 0, rule: 'key-file', message: 'file type that normally holds a private key or account credentials', fingerprint: null }];
  }
  return [];
}

/** Scans a folder. `all: true` ignores Git and reads every file. */
export function scanTree(root, { all = false, allow = null } = {}) {
  const files = (all ? null : gitFiles(root)) || walk(root);
  const list = loadAllowList(allow);
  const findings = [];
  let checked = 0;
  for (const rel of files) {
    if (list.skips(rel)) continue;
    const here_ = [...scanName(rel)];
    const text = readText(path.join(root, rel));
    if (text !== null) { checked++; here_.push(...scanText(text, rel)); }
    for (const f of here_) if (!list.allows(f)) findings.push(f);
  }
  return { findings, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { opts } = parseArgs(process.argv.slice(2), ['root', 'allow']);
    const root = path.resolve(opts.root || repoRoot);
    if (!fs.existsSync(root)) throw new Error(`folder not found: ${root}`);
    const allow = opts.allow ? path.resolve(opts.allow) : path.join(here, 'secrets-allowlist.txt');
    const { findings, checked } = scanTree(root, { all: !!opts.all, allow });
    const code = report('secret scan', findings, { json: !!opts.json, checked });
    if (code && !opts.json) console.log('If a real key is listed: replace it at the provider first, then remove it from the file. See docs/security/secrets-and-environments.md.');
    process.exit(code);
  } catch (e) {
    console.error('secret scan could not run: ' + e.message);
    process.exit(2);
  }
}
