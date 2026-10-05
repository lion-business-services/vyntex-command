// Shared helpers of the NOVA to LBS migration tool.
//
// There is no database driver in this project, so every database call starts one `psql` process (the same way
// scripts/dev-supabase.mjs does). Passwords never appear on a command line: each side's connection settings are read
// from environment variables with a prefix (NOVA_ for the source, LBS_ for the target) and handed to psql through
// its own environment (PGHOST, PGPASSWORD and so on).
//
// The source is only ever reached through tools/migrate-nova/source.mjs. Nothing in this file can talk to it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
const CONN_KEYS = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGPASSFILE'];

export class StageError extends Error {}
/** Stops the stage with a message for the operator. Never put a value from a record in the message. */
export function refuse(message) { throw new StageError(message); }

export function psqlBin() {
  const dir = process.env.PGBIN || '';
  return dir ? path.join(dir, process.platform === 'win32' ? 'psql.exe' : 'psql') : 'psql';
}

/** The environment for one side's psql: only that side's connection settings, nothing inherited from the other. */
export function connEnv(prefix, extraOptions = '') {
  const env = { ...process.env };
  for (const k of CONN_KEYS) delete env[k];
  delete env.PGOPTIONS;
  let found = false;
  for (const k of CONN_KEYS) {
    const v = process.env[`${prefix}_${k}`];
    if (v !== undefined && v !== '') { env[k] = v; found = true; }
  }
  if (!found) refuse(`No connection settings for ${prefix}. Set ${prefix}_PGHOST, ${prefix}_PGPORT, ${prefix}_PGUSER, ${prefix}_PGDATABASE and ${prefix}_PGPASSWORD.`);
  env.PGOPTIONS = `-c client_min_messages=warning -c timezone=UTC -c datestyle=ISO ${extraOptions}`.trim();
  env.PGCONNECT_TIMEOUT = env.PGCONNECT_TIMEOUT || '15';
  env.PGAPPNAME = 'vyntex-migrate-nova';
  return env;
}

/** Error text from the database can quote the value that failed. Strip anything that could be personal data. */
export function scrub(text) {
  return String(text || '')
    .replace(/^(DETAIL|CONTEXT|HINT|QUERY|LINE \d+|STATEMENT):.*$/gim, '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .replace(/: ".*"$/gm, ': [value]')
    .replace(/\(.*\)=\(.*\)/g, '[key]')
    .split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' | ');
}

const PSQL_ARGS = ['-X', '-q', '-At', '--no-password', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'];

/**
 * Runs a script on the TARGET database and returns what it printed.
 * vars become psql variables (:'name'). They are ids, numbers and labels only, never record contents.
 */
export function target(sql, vars = {}, { input } = {}) {
  const args = [...PSQL_ARGS];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  const r = spawnSync(psqlBin(), args, { env: connEnv('LBS'), input: input ?? sql, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) refuse(`psql could not be started (${r.error.code || 'error'}). Install the PostgreSQL client tools or set PGBIN.`);
  if (r.status !== 0) refuse(`target database refused: ${scrub(r.stderr)}`);
  return r.stdout.trim();
}
/** One JSON document from the target. */
export function targetJson(sql, vars = {}) {
  const out = target(sql, vars);
  const line = out.split('\n').filter(Boolean).pop();
  return line ? JSON.parse(line) : null;
}
export function sqlFile(name) { return fs.readFileSync(path.join(here, 'sql', name), 'utf8'); }

// ---------------------------------------------------------------------------------------------------------------------
// Settings, reports, logs
// ---------------------------------------------------------------------------------------------------------------------
export function settings() {
  const reportDir = path.resolve(process.env.MIGRATE_REPORT_DIR || 'migration-reports');
  const tenant = process.env.LBS_TENANT_SLUG || '';
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(tenant)) refuse('LBS_TENANT_SLUG is not set (the slug of the Lion Business Services company in the target database).');
  return {
    reportDir, tenantSlug: tenant,
    label: process.env.MIGRATE_LABEL || 'nova-to-lbs',
    batchSize: Math.max(1, Math.min(5000, Number(process.env.MIGRATE_BATCH_SIZE || 200))),
    backupFile: process.env.MIGRATE_BACKUP_FILE || '',
    backupMaxAgeHours: Number(process.env.MIGRATE_BACKUP_MAX_AGE_HOURS || 24),
  };
}
export function ensureReportDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows has no mode bits: the folder inherits the user profile's rules */ }
  return dir;
}
export function writeReport(dir, name, content, { restricted = false } = {}) {
  const file = path.join(ensureReportDir(dir), name);
  fs.writeFileSync(file, content, { mode: restricted ? 0o600 : 0o640 });
  try { fs.chmodSync(file, restricted ? 0o600 : 0o640); } catch { /* see ensureReportDir */ }
  return file;
}
export function sha256File(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (n === 0) break; h.update(buf.subarray(0, n)); }
  fs.closeSync(fd);
  return h.digest('hex');
}
export const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Logs carry ids, labels and counts. A string is only let through when it looks like one of those; anything else is
// replaced, so a record's contents cannot reach the log even by mistake.
const SAFE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64}|[A-Za-z0-9_.:\/ -]{1,80})$/;
function safeValue(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return SAFE.test(v) && !/\d{7,}/.test(v.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{64}/g, '')) ? v : '[withheld]';
  if (Array.isArray(v)) return v.map(safeValue);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, safeValue(x)]));
  return '[withheld]';
}
let logFile = null;
export function openLog(dir) { logFile = path.join(ensureReportDir(dir), 'migrate.log'); }
export function log(stage, event, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), stage, event, ...safeValue(data) });
  process.stdout.write(line + '\n');
  if (logFile) fs.appendFileSync(logFile, line + '\n', { mode: 0o640 });
}

/** Runs a stage: prints the refusal and exits 1, or exits 0. A stage never prints a stack trace with data in it. */
export async function runStage(name, fn) {
  const started = Date.now();
  try {
    const s = settings();
    openLog(s.reportDir);
    log(name, 'start');
    const result = await fn(s);
    const { exit = 0, ...rest } = result || {};
    log(name, 'done', { ms: Date.now() - started, ...rest });
    process.exit(exit);
  } catch (e) {
    const message = e instanceof StageError ? e.message : `unexpected failure: ${scrub(e && e.message)}`;
    process.stderr.write(`REFUSED (${name}): ${message}\n`);
    try { log(name, 'refused', { ms: Date.now() - started }); } catch { /* the log folder may be what failed */ }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The batch in progress
// ---------------------------------------------------------------------------------------------------------------------
export function tenantId(s) {
  const id = target(`select id from public.tenants where slug = :'slug' and industry_id = 'practice'`, { slug: s.tenantSlug });
  if (!id) refuse('The target has no company with that slug and edition "practice". Create the LBS company first.');
  return id;
}
export function currentBatch(s) {
  const tenant = tenantId(s);
  const b = targetJson(`select to_jsonb(b) from migrate.batches b where tenant_id = :'tenant' and is_current`, { tenant });
  if (!b) refuse('No batch in progress. Run 10-extract first.');
  return b;
}

// ---------------------------------------------------------------------------------------------------------------------
// Masking for reports (the needs-review file is the one place where values are shown in full)
// ---------------------------------------------------------------------------------------------------------------------
export function csv(rows, columns) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let t = Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // a cell that starts like a formula is text, not a formula
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
export function mdTable(rows, columns) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${columns.map((c) => esc(r[c])).join(' | ')} |`)].join('\n');
}
