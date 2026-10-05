#!/usr/bin/env node
// Looks for data about real people in the files of this repository: tax ID numbers and lists of customers.
//
// Why it exists: the older internal system (NOVA) has a migration file with about 200 real customers in it, names,
// emails, phones and addresses, and Git keeps every version of every file forever. This scan is the check that the same
// thing cannot happen here without someone noticing (owner's brief, sections 56 and 88).
//
//   node scripts/security/scan-pii.mjs                    scan this repository
//   node scripts/security/scan-pii.mjs --root <folder>    scan another folder (used to verify a cleaned repository)
//   node scripts/security/scan-pii.mjs --all              also scan files that Git ignores
//   node scripts/security/scan-pii.mjs --json             machine-readable output
//   node scripts/security/scan-pii.mjs --allow <file>     allow-list (default scripts/security/pii-allowlist.txt)
//   node scripts/security/scan-pii.mjs --threshold 5      how many different real-looking contacts in one file is a list
//
// Exit code: 0 nothing found, 1 something found, 2 the scan itself could not run.
//
// What counts as fictional, by the rule every sample record in this repository follows: an email on example.com,
// example.org, example.net or a reserved ending (.example, .test, .invalid), and a phone number with 555 in it.
// Anything else that looks like a contact is treated as possibly real. A finding never prints the value.
//
// Limits: it reads the files as they are now, not Git history, and it cannot tell a real name from an invented one.
// It measures the things that give a customer list away: many contacts in one file, and tax ID formats.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { walk, gitFiles, readText, fingerprint, loadAllowList, parseArgs, lineOf, report } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))/g;
// "icon@2x.png" and "pkg@1.2.3" are not addresses
const NOT_A_TLD = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'json', 'md', 'sql', 'html', 'yml', 'yaml', 'map', 'txt', 'sh']);
const PHONE = /(?<![\d.+-])(?:\+?1[ .-]?)?\(?([2-9]\d{2})\)?[ .-]([2-9]\d{2})[ .-](\d{4})(?![\d-])|(?<![\d.])\+1([2-9]\d{2})([2-9]\d{2})(\d{4})(?!\d)/g;
const SSN = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g;
const SSN_BARE = /\b(?:ssn|social[ _-]?security|itin|tax[ _-]?id|taxid|tin)\b[^\n\d]{0,40}?(?<!\d)(\d{9})(?!\d)/gi;
const EIN = /(?<![\d-])(\d{2})-(\d{7})(?![\d-])/g;
const EIN_WORDS = /\b(f?ein|tax[ _-]?id|taxid|tin|employer|taxpayer)\b/i;
// The two-digit prefixes the IRS has assigned to employer identification numbers.
const EIN_PREFIX = new Set([...range(1, 6), ...range(10, 16), ...range(20, 27), ...range(30, 48), ...range(50, 68), ...range(71, 77), ...range(80, 88), ...range(90, 95), 98, 99]);
// Columns that describe a person, and ids that only a live provider account hands out.
const PERSON_COL = /^(first_?name|last_?name|full_?name|given_?name|family_?name|email|email_?address|phone|phone_?number|mobile|address|address_?line_?1|street|dob|date_?of_?birth|birth_?date|ssn|tax_?id)$/i;
const PROVIDER_ID_COL = /^(square_customer_id|stripe_customer_id|qbo_customer_id|quickbooks_customer_id|customer_reference_id)$/i;
const SKIP_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const BULK_ROWS = 20;

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }

export function fictionalEmail(domain) {
  const d = domain.toLowerCase();
  return /(^|\.)example\.(com|org|net)$/.test(d) || /\.(example|test|invalid|localhost|local)$/.test(d) || d === 'localhost';
}
export function fictionalPhone(area, exchange) {
  return exchange === '555' || area === '555';
}
/** Numbers everyone uses as stand-ins: 123-45-6789, its reverse, and groups of one repeated digit such as 111-22-3333. */
export function dummySsn(a, g, s) {
  const all = a + g + s;
  if (all === '123456789' || all.startsWith('9876543') || all === '078051120' || all === '219099999') return true;
  return [a, g, s].every((part) => new Set(part).size === 1);
}
/** A number in the range the Social Security Administration issues, or an ITIN (starts with 9, set middle digits). */
export function plausibleSsn(a, g, s) {
  if (dummySsn(a, g, s)) return false;
  const area = Number(a), group = Number(g), serial = Number(s);
  if (group === 0 || serial === 0 || area === 0 || area === 666) return false;
  if (area >= 900) return (group >= 50 && group <= 65) || (group >= 70 && group <= 88) || (group >= 90 && group <= 92) || (group >= 94 && group <= 99);
  return true;
}

/** Counts the value rows of every `insert into t (cols) values (...), (...);` in a SQL text. Quotes are respected. */
export function sqlInserts(text) {
  const out = [];
  const head = /insert\s+into\s+([A-Za-z0-9_."]+)\s*\(([^)]*)\)\s*(?:overriding\s+\w+\s+value\s*)?values/gi;
  for (let m; (m = head.exec(text));) {
    const cols = m[2].split(',').map((c) => c.trim().replace(/"/g, ''));
    let i = head.lastIndex, depth = 0, rows = 0, quote = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) { if (ch === "'") { if (text[i + 1] === "'") i++; else quote = false; } continue; }
      if (ch === "'") quote = true;
      else if (ch === '(') { if (depth === 0) rows++; depth++; }
      else if (ch === ')') depth--;
      // between two rows there is only a comma; anything else (";", "on conflict", "returning") ends the list
      else if (depth === 0 && !/[\s,]/.test(ch)) {
        if (ch === '-' && text[i + 1] === '-') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue; }
        break;
      }
    }
    out.push({ table: m[1], cols, rows, index: m.index, end: i });
    head.lastIndex = i;
  }
  return out;
}

/** Scans one text. `rel` decides which file-type rules apply. */
export function scanText(text, rel, { threshold = 5 } = {}) {
  const found = [];
  const ext = path.extname(rel).toLowerCase();

  // 1. Tax ID numbers.
  SSN.lastIndex = 0;
  for (let m; (m = SSN.exec(text));) {
    if (!plausibleSsn(m[1], m[2], m[3])) continue;
    found.push({ file: rel, line: lineOf(text, m.index), rule: 'ssn', message: 'a full Social Security or ITIN number format. Records here hold the type and the last four digits only.', fingerprint: fingerprint(m[0]) });
  }
  SSN_BARE.lastIndex = 0;
  for (let m; (m = SSN_BARE.exec(text));) {
    if (!plausibleSsn(m[1].slice(0, 3), m[1].slice(3, 5), m[1].slice(5))) continue;
    found.push({ file: rel, line: lineOf(text, m.index), rule: 'ssn', message: 'nine digits next to a tax ID word', fingerprint: fingerprint(m[1]) });
  }
  EIN.lastIndex = 0;
  for (let m; (m = EIN.exec(text));) {
    if (!EIN_PREFIX.has(Number(m[1]))) continue;
    const start = text.lastIndexOf('\n', m.index) + 1;
    const end = text.indexOf('\n', m.index); const line = text.slice(start, end < 0 ? text.length : end);
    if (!EIN_WORDS.test(line)) continue; // two digits, a dash and seven digits also shows up in ids and version numbers
    found.push({ file: rel, line: lineOf(text, m.index), rule: 'ein', message: 'a full employer identification number format next to a tax ID word', fingerprint: fingerprint(m[0]) });
  }

  // 2. Many different real-looking contacts in one file.
  const emails = new Map(); const fictEmails = new Set();
  EMAIL.lastIndex = 0;
  for (let m; (m = EMAIL.exec(text));) {
    if (NOT_A_TLD.has(m[2].toLowerCase())) continue;
    const e = m[0].toLowerCase();
    if (fictionalEmail(m[1])) fictEmails.add(e); else if (!emails.has(e)) emails.set(e, m.index);
  }
  const phones = new Map(); const fictPhones = new Set();
  PHONE.lastIndex = 0;
  for (let m; (m = PHONE.exec(text));) {
    const area = m[1] || m[4], exch = m[2] || m[5], last = m[3] || m[6];
    const p = area + exch + last;
    if (fictionalPhone(area, exch)) fictPhones.add(p); else if (!phones.has(p)) phones.set(p, m.index);
  }
  if (emails.size >= threshold) {
    found.push({ file: rel, line: lineOf(text, Math.min(...emails.values())), rule: 'bulk-contacts', message: `${emails.size} different email addresses that are not on a sample domain. This looks like a list of real people.`, fingerprint: null });
  }
  if (phones.size >= threshold) {
    found.push({ file: rel, line: lineOf(text, Math.min(...phones.values())), rule: 'bulk-contacts', message: `${phones.size} different phone numbers that are not 555 sample numbers. This looks like a list of real people.`, fingerprint: null });
  }

  // 3. Shapes of an import: a large block of person rows, or ids handed out by a live provider account.
  const real = emails.size + phones.size, fict = fictEmails.size + fictPhones.size;
  const mostlySample = fict > 0 && fict >= real * 4;
  if (ext === '.sql') {
    for (const ins of sqlInserts(text)) {
      const person = ins.cols.filter((c) => PERSON_COL.test(c));
      const provider = ins.cols.filter((c) => PROVIDER_ID_COL.test(c));
      if (provider.length && ins.rows > 0) {
        found.push({ file: rel, line: lineOf(text, ins.index), rule: 'provider-export', message: `insert into ${ins.table} with ${ins.rows} row(s) carrying "${provider[0]}": rows exported from a live account do not belong in a migration.`, fingerprint: null });
      } else if (person.length >= 2 && ins.rows >= BULK_ROWS && !mostlySample) {
        found.push({ file: rel, line: lineOf(text, ins.index), rule: 'bulk-records', message: `insert into ${ins.table} with ${ins.rows} rows of person columns (${person.slice(0, 4).join(', ')}). Confirm every row is fictional, or load the data outside Git.`, fingerprint: null });
      }
    }
  }
  if (ext === '.csv' || ext === '.tsv') {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const cols = (lines[0] || '').split(ext === '.tsv' ? '\t' : ',').map((c) => c.trim().replace(/^"|"$/g, '').replace(/\s+/g, '_'));
    const person = cols.filter((c) => PERSON_COL.test(c));
    if (person.length >= 2 && lines.length - 1 >= BULK_ROWS && !mostlySample) {
      found.push({ file: rel, line: 1, rule: 'bulk-records', message: `${lines.length - 1} rows with person columns (${person.slice(0, 4).join(', ')}). Confirm every row is fictional, or keep the file outside Git.`, fingerprint: null });
    }
  }
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') {
    const keys = (text.match(/"(?:email|phone|first_?name|firstName|last_?name|lastName)"\s*:/g) || []).length;
    const records = (text.match(/"(?:email|phone)"\s*:\s*"[^"]+"/g) || []).length;
    if (keys >= BULK_ROWS * 2 && records >= BULK_ROWS && !mostlySample) {
      found.push({ file: rel, line: 1, rule: 'bulk-records', message: `about ${records} records with contact fields. Confirm every record is fictional, or keep the file outside Git.`, fingerprint: null });
    }
  }
  return found;
}

export function scanTree(root, { all = false, allow = null, threshold = 5 } = {}) {
  const files = (all ? null : gitFiles(root)) || walk(root);
  const list = loadAllowList(allow);
  const findings = [];
  let checked = 0;
  for (const rel of files) {
    if (list.skips(rel) || SKIP_FILE.test(rel)) continue;
    const text = readText(path.join(root, rel));
    if (text === null) continue;
    checked++;
    for (const f of scanText(text, rel, { threshold })) if (!list.allows(f)) findings.push(f);
  }
  return { findings, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { opts } = parseArgs(process.argv.slice(2), ['root', 'allow', 'threshold']);
    const root = path.resolve(opts.root || repoRoot);
    if (!fs.existsSync(root)) throw new Error(`folder not found: ${root}`);
    const allow = opts.allow ? path.resolve(opts.allow) : path.join(here, 'pii-allowlist.txt');
    const threshold = opts.threshold ? Number(opts.threshold) : 5;
    if (!Number.isInteger(threshold) || threshold < 1) throw new Error('--threshold must be a whole number of 1 or more');
    const { findings, checked } = scanTree(root, { all: !!opts.all, allow, threshold });
    const code = report('personal data scan', findings, { json: !!opts.json, checked });
    if (code && !opts.json) console.log('Real records never go into Git. If any were committed, follow docs/security/repository-cleaning.md.');
    process.exit(code);
  } catch (e) {
    console.error('personal data scan could not run: ' + e.message);
    process.exit(2);
  }
}
