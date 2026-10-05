// Stage 50: the load. Insert only, in batches, each batch one transaction. Safe to run again: the id map remembers
// every record that was created, so a second run inserts nothing.
//
//   node tools/migrate-nova/50-apply.mjs --approve <token of the dry run> --approver "Full Name" --backup-sha256 <checksum>
//
// Refuses without all three, when the report on disk is not the one that was approved, when stage 30 was run again
// after the dry run, or when the backup file no longer matches its checksum.
//
// Role and settings: connect as the project's role "postgres" over the direct connection (not the pooler in
// transaction mode). Each batch runs SET LOCAL ROLE service_role with no request.jwt.claims: that is the server path
// of docs/DATABASE.md section 10, the one that keeps original dates and authors on history rows.
import fs from 'node:fs';
import path from 'node:path';
import { runStage, refuse, currentBatch, target, sha256File, log } from './lib.mjs';
import { LOADS, loadSql, AS_SERVER, PLAN_HASH } from './loads.mjs';

runStage('50-apply', (s) => {
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? String(args[i + 1] || '') : ''; };
  const token = at('--approve'); const approver = at('--approver').trim(); const backup = at('--backup-sha256');
  if (!/^[0-9a-f]{64}$/.test(token)) refuse('--approve <token> is required: the approval token printed by the dry run.');
  if (approver.length < 2) refuse('--approver "Full Name" is required: the person who read the report and approved it.');
  if (!/^[0-9a-f]{64}$/.test(backup)) refuse('--backup-sha256 <checksum> is required: the checksum of the encrypted NOVA backup.');
  const batch = currentBatch(s);
  const vars = { tenant: batch.tenant_id, batch: batch.id, batch_size: s.batchSize };
  if (batch.rolled_back_at) refuse('This batch was rolled back. Start again from 10-extract.');
  if (!batch.dry_run_hash) refuse('There is no dry run for this batch (or stage 30 ran after it). Run 40-dry-run and have its report approved.');
  if (token !== batch.dry_run_hash) refuse('The approval token is not the token of the latest dry run of this batch.');
  const report = path.join(s.reportDir, '40-dry-run.md');
  if (!fs.existsSync(report) || sha256File(report) !== token) refuse('The dry-run report in the report folder is not the one that was approved.');
  if (backup !== batch.backup_sha256) refuse('The backup checksum is not the one this batch was extracted under.');
  if (!s.backupFile || !fs.existsSync(s.backupFile) || sha256File(s.backupFile) !== backup) refuse('The backup file (MIGRATE_BACKUP_FILE) is missing or does not match the checksum.');
  if (target(PLAN_HASH, vars) !== batch.plan_hash) refuse('The outcomes changed after the dry run. Run 40-dry-run again and have the new report approved.');

  target(`update migrate.batches set approved_by = :'approver', approved_at = coalesce(approved_at, now()) where id = :'batch'`, { ...vars, approver });
  const totals = {};
  for (const name of LOADS) {
    totals[name] = 0;
    for (let round = 1; ; round += 1) {
      const started = Date.now();
      const n = Number(target(`begin;\n${AS_SERVER}\n${loadSql(name)};\ncommit;`, vars).split('\n').filter(Boolean).pop());
      if (!Number.isFinite(n)) refuse('The load answered something unexpected. Stop and run 60-reconcile to see what is there.');
      totals[name] += n;
      log('50-apply', 'batch', { entity: name, round, rows: n, ms: Date.now() - started });
      if (n < s.batchSize) break;
    }
  }
  target(`update migrate.batches set applied_at = now() where id = :'batch'`, vars);
  return { batch: batch.id, ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [`rows_${k}`, v])), inserted: Object.values(totals).reduce((a, b) => a + b, 0) };
});
