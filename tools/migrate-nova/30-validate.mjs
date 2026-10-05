// Stage 30: one outcome per record (created, skipped, duplicate, invalid, needs_review). Writes migrate.outcomes.
//
//   node tools/migrate-nova/30-validate.mjs [--decisions answers.csv --decided-by "Full Name"]
//
// answers.csv is the needs-review file with the "decision" column filled in (load, skip or load_without_field).
// Only the columns entity, source_id and decision are read from it.
import fs from 'node:fs';
import path from 'node:path';
import { runStage, refuse, currentBatch, target, targetJson, sqlFile, writeReport, mdTable, here, log } from './lib.mjs';

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

runStage('30-validate', (s) => {
  const batch = currentBatch(s);
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : ''; };
  const decisionsFile = at('--decisions');
  if (decisionsFile) {
    const by = at('--decided-by');
    if (!by || by.length < 2) refuse('--decided-by "Full Name" is required with --decisions: every answer is recorded with the person who gave it.');
    const rows = parseCsv(fs.readFileSync(decisionsFile, 'utf8'));
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    const [e, i, d] = ['entity', 'source_id', 'decision'].map((h) => head.indexOf(h));
    if (e < 0 || i < 0 || d < 0) refuse('The decisions file needs the columns entity, source_id and decision.');
    const answers = rows.filter((r) => (r[d] || '').trim() !== '').map((r) => [r[e].trim(), r[i].trim(), r[d].trim().toLowerCase()]);
    const bad = answers.filter((a) => !['load', 'skip', 'load_without_field'].includes(a[2]) || !/^[a-z_]+$/.test(a[0]) || !/^[0-9a-f-]{36}$/.test(a[1]));
    if (bad.length) refuse(`${bad.length} answer(s) are not one of: load, skip, load_without_field.`);
    // Ids and one of three words only: nothing personal is stored with a decision.
    const data = answers.map((a) => a.join('\t')).join('\n');
    target(`begin;
      create temp table d (entity text, source_id text, decision text) on commit drop;
      copy d from stdin;
${data}
\\.
      insert into migrate.decisions (tenant_id, entity, source_id, decision, decided_by)
        select :'tenant', entity, source_id, decision, :'by' from d
        on conflict (tenant_id, entity, source_id) do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = now();
      commit;`, { tenant: batch.tenant_id, by });
    log('30-validate', 'decisions', { answers: answers.length });
  }
  const criteria = JSON.parse(fs.readFileSync(path.join(here, 'sample-criteria.json'), 'utf8'));
  delete criteria._readme;
  const r = targetJson(sqlFile('30-validate.sql'), { tenant: batch.tenant_id, batch: batch.id, criteria: JSON.stringify(criteria) });
  const kinds = ['created', 'skipped', 'duplicate', 'invalid', 'needs_review'];
  const totals = Object.entries(r.totals).sort().map(([entity, per]) => ({ entity, ...Object.fromEntries(kinds.map((k) => [k, per[k] || 0])), total: kinds.reduce((n, k) => n + (per[k] || 0), 0) }));
  writeReport(s.reportDir, '30-validate.md', [
    '# Validate: one outcome per record', '', `Batch: \`${batch.id}\``, '', mdTable(totals, ['entity', ...kinds, 'total']), '',
    `Clients that will be created without an office (visible to the whole team, as the access rule says): ${r.clientsWithoutOffice} of ${r.clientsCreated}.`, '',
    '## Why', '', mdTable(r.reasons.filter((x) => x.outcome !== 'created' || x.reason), ['entity', 'outcome', 'reason', 'rows']), '',
    '## What counts as a sample or test record', '', 'Exactly the rules in `tools/migrate-nova/sample-criteria.json`:', '',
    ...Object.entries(criteria).map(([k, v]) => `* ${k}: ${v.join(', ')}`), '',
  ].join('\n'));
  const sum = (k) => totals.reduce((n, t) => n + t[k], 0);
  return { batch: batch.id, created: sum('created'), skipped: sum('skipped'), duplicate: sum('duplicate'), invalid: sum('invalid'), needsReview: sum('needs_review') };
});
