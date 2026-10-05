// Stage 10: copy the carried NOVA tables into the staging schema of the TARGET database.
//
//   node tools/migrate-nova/10-extract.mjs
//
// NOVA is read through COPY (SELECT ...) TO STDOUT inside a read-only transaction. Nothing is written to NOVA and
// nothing is written to a live table of the target: only migrate.src_* and one row in migrate.batches.
// Needs the preflight report of this folder (so the backup checksum travels with the batch).
import fs from 'node:fs';
import path from 'node:path';
import { runStage, refuse, log, target, tenantId, writeReport, mdTable } from './lib.mjs';
import { read, copyOut } from './source.mjs';
import { CARRIED, COUNTED, columnList, selectFor, checksumSql, stagingDdl } from './source-tables.mjs';

runStage('10-extract', async (s) => {
  const pre = path.join(s.reportDir, '00-preflight.json');
  if (!fs.existsSync(pre)) refuse('Run 00-preflight first: its report is not in the report folder.');
  const preflight = JSON.parse(fs.readFileSync(pre, 'utf8'));
  const tenant = tenantId(s);
  const applied = target(`select count(*) from migrate.batches where tenant_id = :'tenant' and is_current and applied_at is not null and rolled_back_at is null and reconciled_at is null`, { tenant });
  if (applied !== '0') refuse('The batch in progress was applied and not yet reconciled. Run 60-reconcile (or 70-rollback) before a new extract.');

  target(`begin;\n${stagingDdl()}\nrevoke all on all tables in schema migrate from public, anon, authenticated;\ncommit;`);
  const rows = [];
  for (const table of Object.keys(CARRIED)) {
    const started = Date.now();
    await copyOut(selectFor(table), `copy migrate.src_${table} (${columnList(table)}) from stdin`).catch((e) => refuse(e.message));
    const source = read(checksumSql(`public.${table}`, table));
    const staged = target(checksumSql(`migrate.src_${table}`, table));
    if (source !== staged) refuse(`Table ${table} changed while it was being read, or did not arrive whole. Run the extract again when nobody is working in NOVA.`);
    rows.push({ table, rows: Number(source.split(':')[0]), checksum: source.split(':')[1], ms: Date.now() - started });
    log('10-extract', 'table', { table, rows: Number(source.split(':')[0]), ms: Date.now() - started });
  }
  const counts = Object.fromEntries(rows.map((r) => [r.table, r.rows]));
  for (const table of Object.keys(COUNTED)) counts[table] = Number(read(`select count(*) from public.${table}`));
  const checks = Object.fromEntries(rows.map((r) => [r.table, `${r.rows}:${r.checksum}`]));
  const batch = target(`begin;
    update migrate.batches set is_current = false where tenant_id = :'tenant' and is_current;
    insert into migrate.batches (tenant_id, label, source_counts, backup_sha256, notes)
      values (:'tenant', :'label', :'counts'::jsonb, :'backup', jsonb_build_object('checksums', :'checks'::jsonb)) returning id;
    commit;`, { tenant, label: s.label, counts: JSON.stringify(counts), backup: preflight.backup.sha256, checks: JSON.stringify(checks) });
  writeReport(s.reportDir, '10-extract.md', ['# Extract: NOVA to staging', '', `Batch: \`${batch}\``, '', 'Every table was compared with the source after copying (row count and a checksum over every carried column).', '', mdTable(rows, ['table', 'rows', 'checksum', 'ms']), ''].join('\n'));
  return { batch, tables: rows.length, rows: rows.reduce((a, r) => a + r.rows, 0) };
});
