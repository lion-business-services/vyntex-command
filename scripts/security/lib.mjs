// Shared helpers for the security scans in this folder: which files to look at, the allow-list, and how a finding is printed.
// Nothing here ever prints the text that matched. A scan that printed the secret it found would copy that secret into the
// build log, which is one more place it would have to be cleaned from.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Folders that are never part of the product: installed packages, build output and local tool state.
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.vercel', '.branches', '.temp', 'preview']);
const SKIP_DIR_PATTERNS = [/^dist($|[-.])/];
// Files that cannot hold a readable key and would only slow the scan down.
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.zip', '.gz', '.mp4', '.mov', '.age']);
const MAX_BYTES = 4 * 1024 * 1024;

export function skipDir(name) {
  return SKIP_DIRS.has(name) || SKIP_DIR_PATTERNS.some((p) => p.test(name));
}

/** Every file under `root`, as paths relative to it with forward slashes. Folders in SKIP_DIRS are not entered. */
export function walk(root, { skip = skipDir } = {}) {
  const out = [];
  const visit = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // a link could lead outside the folder being checked
      if (e.isDirectory()) { if (!skip(e.name)) visit(abs); continue; }
      if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  visit(root);
  return out.sort();
}

/**
 * The files that are in Git or could be added to it: tracked files plus new files that .gitignore does not exclude.
 * Returns null when `root` is not a Git working tree, so the caller can fall back to walking the folder.
 * A file such as .env.local that Git ignores is left out on purpose: it is allowed to exist on a developer's computer.
 */
export function gitFiles(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (!top) return null;
    const raw = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).toString();
    // build output and installed packages are left out here too, whether or not .gitignore lists them yet
    return raw.split('\0').filter(Boolean).filter((f) => !f.split('/').slice(0, -1).some(skipDir)).filter((f) => fs.existsSync(path.join(root, f))).sort();
  } catch { return null; }
}

/** Reads a file as text, or returns null for a binary or oversized file. */
export function readText(abs) {
  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) return null;
  let st; try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > MAX_BYTES) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return null; // a zero byte means it is not text
  return buf.toString('utf8');
}

/** Short fingerprint of a matched value. Lets a reviewed false positive be allowed without writing the value anywhere. */
export function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

/** "abcd… (40 characters)": enough to find the place, never enough to use the value. */
export function redact(value) {
  const s = String(value);
  return `${s.slice(0, 4)}… (${s.length} characters)`;
}

/**
 * Allow-list file: one entry per line, `#` starts a comment.
 *   path:<file or folder/>            skip that file, or everything under that folder
 *   <rule>:<file>                     allow one rule in one file
 *   <rule>:<file>:<fingerprint>       allow one exact value (the fingerprint is printed with each finding)
 * Every entry should carry a comment that says who reviewed it and why it is not a real secret or a real person.
 */
export function loadAllowList(file) {
  const entries = [];
  if (!file || !fs.existsSync(file)) return { entries, allows: () => false, skips: () => false };
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const [rule, file_, fp] = line.split(':');
    if (!rule || !file_) throw new Error(`allow-list ${file}: cannot read the line "${raw}"`);
    entries.push({ rule, file: file_, fp: fp || null });
  }
  const skips = (rel) => entries.some((e) => e.rule === 'path' && (e.file.endsWith('/') ? rel.startsWith(e.file) : rel === e.file));
  const allows = (f) => entries.some((e) => e.rule === f.rule && e.file === f.file && (!e.fp || e.fp === f.fingerprint));
  return { entries, allows, skips };
}

/** Reads `--name value` and `--flag` arguments. Anything else is a positional argument. */
export function parseArgs(argv, valued = []) {
  const opts = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (valued.includes(name)) { opts[name] = argv[++i]; if (opts[name] === undefined) throw new Error(`--${name} needs a value`); }
      else opts[name] = true;
    } else rest.push(a);
  }
  return { opts, rest };
}

/** Line number (1-based) of a character position in a text. */
export function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Prints findings the same way in every scan and returns the exit code: 0 clean, 1 findings. */
export function report(name, findings, { json = false, checked = 0, out = console.log } = {}) {
  if (json) { out(JSON.stringify({ scan: name, checked, findings }, null, 2)); return findings.length ? 1 : 0; }
  if (!findings.length) { out(`${name}: clean (${checked} files checked)`); return 0; }
  for (const f of findings) out(`${f.file}${f.line ? ':' + f.line : ''}  [${f.rule}]  ${f.message}${f.fingerprint ? `  fingerprint ${f.fingerprint}` : ''}`);
  out(`${name}: ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${new Set(findings.map((f) => f.file)).size} file(s), ${checked} files checked`);
  return 1;
}
