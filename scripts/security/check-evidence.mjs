#!/usr/bin/env node
// Keeps the security documents honest in two ways the owner's brief asks for (sections 54 and 108):
//
//   1. Evidence. Every file a security document points at must exist, and every test it names must be in the file it
//      names. A document that says "proved by <file>" while the file is gone is an unsupported claim.
//   2. Claims. The screens and pages of the product must not say "IRS compliant", "SOC 2 certified" and the like.
//      The platform supports a compliance review; it does not certify anything.
//
//   node scripts/security/check-evidence.mjs            check this repository
//   node scripts/security/check-evidence.mjs --json
//
// Exit code: 0 clean, 1 something is wrong, 2 the check itself could not run.
//
// How a document cites evidence:
//   a path in backticks                      `supabase/tests/rls_isolation.sql`      the file must exist
//   a test name, on the same line as a path   test: "anon cannot read clients"        the words must be in that file
// A line that says "not yet", "planned" or "to reconcile" is describing something that does not exist yet, and its
// paths are not checked. Such a line is an open item, not evidence. The same goes for a line that says
// "in the NOVA repository": it names a file of the older system, not of this one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { walk, readText, parseArgs, lineOf, report } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// Documents whose citations are checked.
const DOCS = [/^docs\/security\/[^/]+\.md$/, /^docs\/DEPLOYMENT\.md$/, /^SECURITY\.md$/, /^deploy\/[^/]+\/README\.md$/];
// Things a document may name that are never in the repository: build output, local files, installed packages.
const NOT_IN_REPO = /^(dist|dist-lbs|node_modules|backups|\.env\.local|\.env|\.vercel|package-lock\.json)(\/|$)/;
const OPEN_ITEM = /not yet|planned|to reconcile|does not exist|when it exists|once it exists/i;
// A line about a file of the older system's repository is not a citation of this one.
const OTHER_REPO = /in the NOVA repository/i;
// Where a claim would be displayed to a customer.
const CLAIM_DIRS = ['src', 'public', 'public-lbs', 'api'];
const CLAIM = /\b(?:IRS|HIPAA|PCI(?:[ -]DSS)?|SOC[ -]?(?:2|II)|GLBA|FTC|ISO[ -]?27001|GDPR|CCPA|WISP)[ -]+(?:compliant|certified|approved)\b|\b(?:legally|fully)[ -]compliant\b|\bbank[- ]level security\b|\bmilitary[- ]grade\b/gi;

/** Paths cited in one line of Markdown: tokens in backticks whose first part is a real top-level name of the repository. */
export function citedPaths(line, topLevel) {
  const out = [];
  for (const m of line.matchAll(/`([^`\s]+)`/g)) {
    const token = m[1].replace(/[.,;:]$/, '');
    if (!/^\.?[A-Za-z0-9_-][A-Za-z0-9_.@-]*(\/[A-Za-z0-9_.@*-]+)*\/?$/.test(token)) continue;
    const first = token.split('/')[0];
    if (!topLevel.has(first) || NOT_IN_REPO.test(token)) continue;
    out.push(token.replace(/\/$/, ''));
  }
  return out;
}

function exists(root, rel) {
  if (!rel.includes('*')) return fs.existsSync(path.join(root, rel));
  // a simple pattern such as tests/security/*.test.mjs: at least one file must match
  const dir = path.dirname(rel);
  const re = new RegExp('^' + path.basename(rel).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  try { return fs.readdirSync(path.join(root, dir)).some((f) => re.test(f)); } catch { return false; }
}

/** Checks one document. Returns findings. */
export function checkDocument(root, rel, text, topLevel) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced || OPEN_ITEM.test(line) || OTHER_REPO.test(line)) return;
    const paths = citedPaths(line, topLevel);
    for (const p of paths) {
      if (!exists(root, p)) findings.push({ file: rel, line: i + 1, rule: 'missing-file', message: `points at ${p}, which does not exist`, fingerprint: null });
    }
    for (const m of line.matchAll(/test: "([^"]+)"/g)) {
      const files = paths.filter((p) => !p.includes('*') && fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isFile());
      if (!files.length) { findings.push({ file: rel, line: i + 1, rule: 'test-without-file', message: `names the test "${m[1]}" without naming the file it is in`, fingerprint: null }); continue; }
      if (!files.some((f) => fs.readFileSync(path.join(root, f), 'utf8').includes(m[1]))) {
        findings.push({ file: rel, line: i + 1, rule: 'missing-test', message: `names the test "${m[1]}", which is not in ${files.join(' or ')}`, fingerprint: null });
      }
    }
  });
  return findings;
}

/** Compliance claims in the files a customer sees. */
export function checkClaims(root) {
  const findings = [];
  let checked = 0;
  for (const dir of CLAIM_DIRS) {
    if (!fs.existsSync(path.join(root, dir))) continue;
    for (const rel of walk(path.join(root, dir))) {
      const text = readText(path.join(root, dir, rel));
      if (text === null) continue;
      checked++;
      CLAIM.lastIndex = 0;
      for (let m; (m = CLAIM.exec(text));) {
        findings.push({ file: `${dir}/${rel}`, line: lineOf(text, m.index), rule: 'compliance-claim', message: `"${m[0]}": the product must not claim a certification or compliance that has not been assessed`, fingerprint: null });
      }
    }
  }
  return { findings, checked };
}

export function checkAll(root = repoRoot) {
  const topLevel = new Set(fs.readdirSync(root));
  const findings = [];
  let checked = 0;
  for (const rel of walk(root)) {
    if (!DOCS.some((re) => re.test(rel))) continue;
    checked++;
    findings.push(...checkDocument(root, rel, fs.readFileSync(path.join(root, rel), 'utf8'), topLevel));
  }
  const claims = checkClaims(root);
  return { findings: [...findings, ...claims.findings], checked: checked + claims.checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { opts } = parseArgs(process.argv.slice(2), ['root']);
    const { findings, checked } = checkAll(opts.root ? path.resolve(opts.root) : repoRoot);
    process.exit(report('evidence check', findings, { json: !!opts.json, checked }));
  } catch (e) {
    console.error('evidence check could not run: ' + e.message);
    process.exit(2);
  }
}
