// Stage 40: the rehearsal. Runs the whole load inside one transaction on the target and rolls it back, so every
// constraint, trigger and rule of the real tables has its say and nothing stays. Writes the migration report
// (Markdown and CSV) and the needs-review file. Prints the approval token: the SHA-256 of the report.
//
//   node tools/migrate-nova/40-dry-run.mjs
import { runStage, refuse, currentBatch, target, targetJson, sqlFile, writeReport, mdTable, csv, sha256Text, log } from './lib.mjs';
import { LOADS, loadSql, AS_SERVER, PLAN_HASH, TARGET_COUNTS, TABLE_OF } from './loads.mjs';

runStage('40-dry-run', (s) => {
  const batch = currentBatch(s);
  const vars = { tenant: batch.tenant_id, batch: batch.id, batch_size: 2147483647 };
  const have = target(`select count(*) from migrate.outcomes where batch_id = :'batch'`, vars);
  if (have === '0') refuse('Run 30-validate first: there is no outcome for this batch.');
  const started = Date.now();
  const script = ['begin;', `${TARGET_COUNTS};`, AS_SERVER, ...LOADS.map((l) => `${loadSql(l)};`), 'reset role;', sqlFile('40-report.sql'), 'rollback;'].join('\n');
  const lines = target(script, vars).split('\n').filter(Boolean);
  const before = JSON.parse(lines[0]);
  const inserted = Object.fromEntries(LOADS.map((l, i) => [l, Number(lines[1 + i])]));
  const after = JSON.parse(lines[lines.length - 1]);
  const left = targetJson(TARGET_COUNTS, vars);
  if (JSON.stringify(left) !== JSON.stringify(before)) refuse('The target changed during the dry run. Nobody should be working in it yet: stop and find out who is.');
  const stillMapped = target(`select count(*) from migrate.id_map where batch_id = :'batch'`, vars);

  const kinds = ['created', 'skipped', 'duplicate', 'invalid', 'needs_review'];
  const totalsRaw = targetJson(`select jsonb_object_agg(entity, per) from (select entity, jsonb_object_agg(outcome, n) as per from (
    select entity, outcome, count(*) n from migrate.outcomes where batch_id = :'batch' group by 1, 2) a group by 1) b`, vars) || {};
  const totals = Object.entries(totalsRaw).sort().map(([entity, per]) => ({ entity, source_rows: kinds.reduce((n, k) => n + (per[k] || 0), 0), ...Object.fromEntries(kinds.map((k) => [k, per[k] || 0])) }));
  const alreadyMapped = Number(stillMapped);
  const compare = Object.keys(before).map((table) => {
    const created = totals.filter((t) => TABLE_OF[t.entity] === table).reduce((n, t) => n + t.created, 0);
    return { target_table: table, before: before[table], to_create: created, after_dry_run: after.after[table], expected: before[table] + created, match: after.after[table] === before[table] + created ? 'yes' : 'NO' };
  });
  const review = targetJson(sqlFile('40-review.sql'), vars);
  const reviewCols = ['entity', 'source_id', 'outcome', 'reason', 'field', 'question', 'name', 'company', 'email', 'phone', 'reference', 'amount_cents', 'matched_kind', 'matched_id', 'matched_on', 'matched_name', 'matched_email', 'matched_phone', 'decision'];
  const reviewCount = (o) => review.filter((r) => r.outcome === o).length;
  const planHash = target(PLAN_HASH, vars);
  const sourceCounts = batch.source_counts || {};
  const notCarried = Object.entries(sourceCounts).filter(([t]) => !['profiles', 'offices', 'clients', 'client_owners', 'services', 'service_variations', 'appointment_types', 'lead_assignments', 'lead_activities', 'client_comments', 'invoices', 'payments'].includes(t)).map(([table, rows]) => ({ table, rows }));
  const bySample = {};
  for (const x of after.samples) (bySample[x.entity] ||= []).push(x);

  const md = [
    '# Migration report: NOVA to LBS Command (dry run)', '',
    `Batch \`${batch.id}\`. Plan \`${planHash}\`. Backup checksum \`${batch.backup_sha256}\`.`, '',
    'Nothing was changed: the whole load ran inside one transaction on the target and was rolled back. NOVA was only read.', '',
    '## 1. Totals per kind of record', '', mdTable(totals, ['entity', 'source_rows', ...kinds]), '',
    '`created` means "will be created when this report is approved". Every source row has exactly one outcome.', '',
    '## 2. Counts: source against the target as it would be', '', mdTable(compare, ['target_table', 'before', 'to_create', 'after_dry_run', 'expected', 'match']), '',
    `Clients that arrive without an office (visible to the whole team): ${after.withoutOffice}. Clients whose NOVA owner has no team member yet (arrive unassigned): ${after.unassignedOwners}. Tax ID fields set by the load: ${after.taxFieldsSet}.`, '',
    '## 3. What a person has to decide before approval', '',
    `The list is in \`40-needs-review.csv\` (${review.length} rows; values in full, keep it private): needs review ${reviewCount('needs_review')}, duplicate ${reviewCount('duplicate')}, invalid ${reviewCount('invalid')}, skipped as sample or test ${reviewCount('skipped')}.`,
    'Fill the `decision` column (load, skip, load_without_field) and run stage 30 again with `--decisions`. A row without an answer is not loaded.', '',
    '## 4. NOVA tables that are counted and not carried', '', mdTable(notCarried, ['table', 'rows']), '',
    '## 5. Twenty samples per kind of record, source next to target (personal fields masked)', '',
    ...Object.entries(bySample).flatMap(([entity, rows]) => [`### ${entity}`, '', mdTable(rows, ['id', 'source', 'target']), '']),
  ].join('\n');
  if (compare.some((c) => c.match !== 'yes')) refuse('The dry run created a different number of rows than the plan says. Do not approve: report this.');
  if (after.taxFieldsSet !== 0) refuse('The dry run set a tax ID field. That must never happen: report this.');
  writeReport(s.reportDir, '40-dry-run.md', md);
  writeReport(s.reportDir, '40-dry-run-totals.csv', csv(totals, ['entity', 'source_rows', ...kinds]));
  writeReport(s.reportDir, '40-dry-run-counts.csv', csv(compare, ['target_table', 'before', 'to_create', 'after_dry_run', 'expected', 'match']));
  writeReport(s.reportDir, '40-dry-run-samples.csv', csv(after.samples, ['entity', 'id', 'source', 'target']));
  writeReport(s.reportDir, '40-needs-review.csv', csv(review, reviewCols), { restricted: true });
  const token = sha256Text(md);
  target(`update migrate.batches set dry_run_at = now(), dry_run_hash = :'hash', plan_hash = :'plan' where id = :'batch'`, { ...vars, hash: token, plan: planHash });
  log('40-dry-run', 'rehearsed', { ms: Date.now() - started, ...Object.fromEntries(Object.entries(inserted).map(([k, v]) => [`rows_${k}`, v])), needsReviewRows: review.length, alreadyMapped });
  process.stdout.write(`APPROVAL TOKEN: ${token}\n`);
  return { batch: batch.id, token };
});
