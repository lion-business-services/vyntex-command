// Stage 20: staged NOVA rows to rows in the shape of this platform (migrate.map_*). No live table is touched.
//
//   node tools/migrate-nova/20-map.mjs
import { runStage, currentBatch, targetJson, sqlFile, writeReport, mdTable } from './lib.mjs';

runStage('20-map', (s) => {
  const batch = currentBatch(s);
  const r = targetJson(sqlFile('20-map.sql'), { tenant: batch.tenant_id });
  const pairs = Object.entries(r).filter(([, v]) => typeof v === 'number').map(([what, rows]) => ({ what, rows }));
  const list = (o) => Object.entries(o || {}).map(([value, rows]) => ({ value, rows }));
  writeReport(s.reportDir, '20-map.md', [
    '# Map: staged rows in the shape of the new platform', '', `Batch: \`${batch.id}\``, '', mdTable(pairs, ['what', 'rows']), '',
    '## Lead sources in NOVA with no source in the company configuration (kept as "other", the original text stays in the detail field)', '',
    list(r.unmappedSources).length ? mdTable(list(r.unmappedSources), ['value', 'rows']) : 'None.', '',
    '## Lead stages in NOVA with no stage in the company configuration (these leads wait for a decision)', '',
    list(r.unmappedStages).length ? mdTable(list(r.unmappedStages), ['value', 'rows']) : 'None.', '',
    `Staff matched to team members by email: ${r.staffMatched} of ${r.staff}. Clients without an office (visible to the whole team): ${r.clientsWithoutOffice}.`, '',
  ].join('\n'));
  return { batch: batch.id, clients: r.clients, leads: r.leads, services: r.services, tiers: r.tiers, staffMatched: r.staffMatched,
    unmappedSources: Object.keys(r.unmappedSources || {}).length, unmappedStages: Object.keys(r.unmappedStages || {}).length };
});
