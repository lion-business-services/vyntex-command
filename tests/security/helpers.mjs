// Helpers for the tests in this folder. Every fixture is made when the test runs and deleted afterwards.
// No file in the repository contains a key-shaped or person-shaped value: the pieces are joined here, at run time,
// so the scans (and GitHub's own secret scanning) have nothing to find in the test files themselves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const script = (name) => path.join(repoRoot, 'scripts/security', name);

/** A temporary folder that is removed when the test (or suite) ends. Pass the test context `t`. */
export function tempDir(t, prefix = 'vx-sec-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes files given as { 'relative/path': 'content' } under a folder. */
export function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Random letters and digits. `alphabet` narrows it (for example hex). */
export function rand(n, alphabet = ALNUM) {
  const bytes = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
/** Random letters and digits that always hold at least one of each, so a test of "looks random" cannot fail by chance. */
export const mixed = (n) => 'q7' + rand(n - 2);
export const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
/** A token with the shape of a Supabase key for the given role. Signed with nothing: it opens nothing. */
export const fakeJwt = (role) => [b64u({ alg: 'HS256', typ: 'JWT' }), b64u({ iss: 'supabase', role, iat: 1 }), rand(43)].join('.');

/** Runs a script of scripts/security with node and returns { code, out }. */
export function run(name, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8', ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

export function hasGit() {
  return spawnSync('git', ['--version']).status === 0;
}
export function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
