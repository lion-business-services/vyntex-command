// The ONLY door to the NOVA database. Everything the tool asks of NOVA goes through read() or copyOut() below.
//
// Three independent locks keep the source unchanged, so one mistake cannot become a write:
//   1. the statement is checked here before it is sent: one statement, starting with SELECT or COPY (SELECT ...) TO
//      STDOUT, containing none of the words that change data;
//   2. the session is opened with default_transaction_read_only = on, and the statement runs inside
//      BEGIN TRANSACTION READ ONLY: PostgreSQL itself refuses any write, whatever the role is allowed to do;
//   3. 00-preflight refuses to continue when the source role holds a write privilege on any table.
// tests/migrate proves lock 2 with a role that may write, and greps this folder to prove no other file connects to
// the source.
import { spawn, spawnSync } from 'node:child_process';
import { connEnv, psqlBin, refuse, scrub } from './lib.mjs';

const READ_ONLY_OPTIONS = '-c default_transaction_read_only=on -c statement_timeout=600000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000';
const FORBIDDEN = /\b(insert|update|delete|truncate|merge|drop|alter|create|grant|revoke|comment|vacuum|reindex|cluster|refresh|call|do|lock|listen|notify|copy\s+[a-z_."]+\s+from|nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|dblink|into)\b/i;
const ARGS = ['-X', '-q', '-At', '--no-password', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'];

/** Refuses anything that is not a single read. Exported so the tests can prove what it refuses. */
export function assertReadOnlySql(sql) {
  const text = String(sql).replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.includes(';')) refuse('source guard: one statement at a time');
  if (!/^(select\b|with\b|copy \(select\b)/i.test(text)) refuse('source guard: only SELECT and COPY (SELECT ...) TO STDOUT are sent to the source');
  if (/^copy/i.test(text) && !/\) to stdout$/i.test(text)) refuse('source guard: COPY must end with TO STDOUT');
  if (FORBIDDEN.test(text.replace(/'(?:[^']|'')*'/g, "''"))) refuse('source guard: the statement contains a word that changes data');
  return text;
}
const wrap = (text) => `begin transaction isolation level repeatable read read only;\n${text};\ncommit;\n`;

/** Runs one read on the source and returns what it printed. */
export function read(sql) {
  const text = assertReadOnlySql(sql);
  const r = spawnSync(psqlBin(), [...ARGS, '-f', '-'], { env: connEnv('NOVA', READ_ONLY_OPTIONS), input: wrap(text), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) refuse(`psql could not be started (${r.error.code || 'error'}).`);
  if (r.status !== 0) refuse(`source database refused: ${scrub(r.stderr)}`);
  return r.stdout.trim();
}
export function readJson(sql) {
  const line = read(sql).split('\n').filter(Boolean).pop();
  return line ? JSON.parse(line) : null;
}

/**
 * Streams COPY (SELECT ...) TO STDOUT from the source straight into COPY ... FROM STDIN on the target.
 * The rows never touch the disk of this computer and never pass through a JavaScript string.
 */
export function copyOut(selectSql, targetCopySql) {
  const text = assertReadOnlySql(`copy (${selectSql}) to stdout`);
  return new Promise((resolve, reject) => {
    const src = spawn(psqlBin(), [...ARGS, '-f', '-'], { env: connEnv('NOVA', READ_ONLY_OPTIONS), stdio: ['pipe', 'pipe', 'pipe'] });
    const dst = spawn(psqlBin(), [...ARGS, '-c', targetCopySql], { env: connEnv('LBS'), stdio: ['pipe', 'pipe', 'pipe'] });
    let srcErr = ''; let dstErr = ''; let done = 0; const codes = {};
    src.stderr.on('data', (d) => { srcErr += d; });
    dst.stderr.on('data', (d) => { dstErr += d; });
    src.stdout.pipe(dst.stdin);
    dst.stdin.on('error', () => { /* the target closed early: its exit code tells why */ });
    const finish = (which, code) => {
      codes[which] = code; done += 1;
      if (done < 2) return;
      if (codes.src !== 0) reject(new Error(`source database refused: ${scrub(srcErr)}`));
      else if (codes.dst !== 0) reject(new Error(`target database refused: ${scrub(dstErr)}`));
      else resolve();
    };
    src.on('error', reject); dst.on('error', reject);
    src.on('close', (c) => finish('src', c));
    dst.on('close', (c) => finish('dst', c));
    src.stdin.end(wrap(text));
  });
}
