// Stage 70: remove exactly the rows of one import batch from the target. Never touches NOVA (this file does not
// even import the source module).
//
//   node tools/migrate-nova/70-rollback.mjs --batch <batch id> --confirm "REMOVE THIS IMPORT" [--discard-edits]
//
// Refuses when records of the batch were changed by people after the import, unless --discard-edits is given.
import { runStage, refuse, target, tenantId, scrub, writeReport, mdTable, connEnv, psqlBin } from './lib.mjs';
import { sqlFile } from './lib.mjs';
import { spawnSync } from 'node:child_process';

runStage('70-rollback', (s) => {
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? String(args[i + 1] || '') : ''; };
  const batch = at('--batch');
  if (!/^[0-9a-f-]{36}$/.test(batch)) refuse('--batch <batch id> is required (it is printed by every stage and in every report).');
  if (at('--confirm') !== 'REMOVE THIS IMPORT') refuse('--confirm "REMOVE THIS IMPORT" is required.');
  const tenant = tenantId(s);
  const state = target(`select coalesce((select case when rolled_back_at is not null then 'rolled_back' else 'ok' end from migrate.batches where id = :'batch' and tenant_id = :'tenant'), 'unknown')`, { batch, tenant });
  if (state === 'unknown') refuse('No such batch for this company.');
  if (state === 'rolled_back') return { batch, removed: 0, already: true };
  const discard = args.includes('--discard-edits') ? 'true' : 'false';
  const env = connEnv('LBS');
  env.PGOPTIONS = `${env.PGOPTIONS} -c migrate.batch=${batch} -c migrate.discard_edits=${discard}`;
  const r = spawnSync(psqlBin(), ['-X', '-q', '-At', '--no-password', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-v', `tenant=${tenant}`, '-v', `batch=${batch}`, '-f', '-'],
    { env, input: sqlFile('70-rollback.sql'), encoding: 'utf8' });
  if (r.status !== 0) {
    const m = /rollback_refused_(edited|count):(\S+)/.exec(r.stderr || '');
    if (m && m[1] === 'edited') refuse(`${Number(m[2])} imported record(s) were changed by people after the import. Nothing was removed. Use --discard-edits only after the owner agrees to lose those changes.`);
    if (m) refuse(`The rows found in ${m[2].replace(/[^a-z_]/g, '')} are not the rows the id map recorded. Nothing was removed.`);
    refuse(`target database refused, nothing was removed: ${scrub(r.stderr)}`);
  }
  const removed = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
  const rows = Object.entries(removed).map(([table, n]) => ({ table, removed: n }));
  writeReport(s.reportDir, '70-rollback.md', ['# Rollback of one import batch', '', `Batch \`${batch}\`. NOVA was not touched. The audit log keeps the record of the import and of its removal.`, '', mdTable(rows, ['table', 'removed']), ''].join('\n'));
  return { batch, removed: rows.reduce((n, x) => n + Number(x.removed), 0) };
});
