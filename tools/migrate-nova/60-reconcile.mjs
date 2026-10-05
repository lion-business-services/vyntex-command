// Stage 60: is what arrived what was sent? Reads both sides, changes nothing but the batch's reconcile mark.
//
//   node tools/migrate-nova/60-reconcile.mjs
//
// Four comparisons:
//   A. NOVA now against the staged copy, table by table (row count and checksum over every carried column):
//      proves the extract was whole and tells whether NOVA changed since;
//   B. every source row has exactly one outcome;
//   C. every "created" outcome has one row in the id map and one row in the target, and the reverse;
//   D. every loaded row is compared with what the mapping said it should be, column by column (count of differences
//      and one checksum per side), and twenty samples per kind of record are listed field by field.
import { pathToFileURL } from 'node:url';
import { runStage, currentBatch, target, targetJson, writeReport, mdTable, csv, log } from './lib.mjs';
import { read } from './source.mjs';
import { CARRIED, checksumSql } from './source-tables.mjs';

const STAFF = (col) => `(select s.member_id from migrate.map_staff s where s.source_id = m.${col})`;
const OFFICE = (col) => `coalesce((select x.target_id from migrate.id_map x where x.tenant_id = :'tenant' and x.entity = 'office' and x.source_id = m.${col}), (select o.existing_id from migrate.map_offices o where o.source_id = m.${col}))`;
const PARENT = (entity, col) => `(select x.target_id from migrate.id_map x where x.tenant_id = :'tenant' and x.entity = ${entity} and x.source_id = m.${col})`;
// map table, entity expression, target table, map columns that are not target columns, links resolved the way the load resolves them
export const ENTITIES = [
  { name: 'office', map: 'map_offices', entity: `'office'`, table: 'offices', drop: ['source_id', 'existing_id'], links: {} },
  { name: 'client', map: 'map_clients', entity: `'client'`, table: 'clients', drop: ['source_id', 'office_source_id', 'assigned_source_id', 'nova_needs_review', 'contact_name', 'address_key'],
    links: { office_id: OFFICE('office_source_id'), assigned_to: STAFF('assigned_source_id') } },
  { name: 'client_people', map: 'map_client_people', entity: 'm.entity', table: 'client_people', drop: ['source_id', 'entity', 'parent_id'], links: { client_id: PARENT(`'client'`, 'parent_id') } },
  { name: 'service', map: 'map_services', entity: `'service'`, table: 'catalog_services', drop: ['source_id', 'nova_source', 'default_price_cents'], links: {} },
  { name: 'tier', map: 'map_tiers', entity: 'm.entity', table: 'catalog_tiers', drop: ['source_id', 'entity', 'parent_id', 'nova_price_cents'], links: { service_id: PARENT(`'service'`, 'parent_id') } },
  { name: 'appointment_type', map: 'map_appointment_types', entity: `'appointment_type'`, table: 'appointment_types', drop: ['source_id', 'existing_id'], links: {} },
  { name: 'lead', map: 'map_leads', entity: `'lead'`, table: 'leads', drop: ['source_id', 'client_source_id', 'owner_source_id', 'original_owner_source_id', 'office_source_id', 'open_lead', 'nova_status', 'nova_source', 'source_unmapped'],
    links: { owner_id: STAFF('owner_source_id'), original_owner_id: STAFF('original_owner_source_id'), office_id: OFFICE('office_source_id'), client_id: PARENT(`'client'`, 'client_source_id') } },
  { name: 'handoff', map: 'map_handoffs', entity: `'handoff'`, table: 'lead_handoffs', drop: ['source_id', 'parent_id', 'from_source_id', 'to_source_id', 'by_source_id'],
    links: { lead_id: PARENT(`'lead'`, 'parent_id'), from_member_id: STAFF('from_source_id'), to_member_id: STAFF('to_source_id'), by_member_id: STAFF('by_source_id') } },
  { name: 'note', map: 'map_notes', entity: 'm.entity', table: 'notes', drop: ['source_id', 'entity', 'parent_id', 'by_source_id'], links: { by_member_id: STAFF('by_source_id') } },
  { name: 'activity', map: 'map_activity', entity: `'lead_activity'`, table: 'activity', drop: ['source_id', 'parent_id', 'by_source_id', 'nova_type'], links: { ref_id: PARENT(`'lead'`, 'parent_id'), by_id: STAFF('by_source_id') } },
];
const expectedSql = (e) => `(to_jsonb(m) - array[${e.drop.map((d) => `'${d}'`).join(', ')}]::text[])${Object.keys(e.links).length ? ` || jsonb_build_object(${Object.entries(e.links).map(([k, v]) => `'${k}', ${v}`).join(', ')})` : ''}`;

export function compareEntity(e, vars) {
  return targetJson(`
    with planned as (
      select m.source_id, (${e.entity})::text as ent, ${expectedSql(e)} as expected,
             (select o.outcome from migrate.outcomes o where o.batch_id = :'batch' and o.entity = (${e.entity})::text and o.source_id = m.source_id) as outcome
      from migrate.${e.map} m
    ), joined as (
      select p.*, i.target_id, i.batch_id = :'batch' as this_batch, to_jsonb(t) as actual, t.id is not null as found
      from planned p
      left join migrate.id_map i on i.tenant_id = :'tenant' and i.entity = p.ent and i.source_id = p.source_id
      left join public.${e.table} t on t.id = i.target_id and t.tenant_id = :'tenant'
    ), diffs as (
      select j.source_id, j.ent,
             (select coalesce(array_agg(x.key order by x.key), '{}') from jsonb_each(j.expected) x where j.actual -> x.key is distinct from x.value) as keys,
             (select count(*) from jsonb_each(j.expected)) as fields,
             md5(j.expected::text) as h_expected,
             md5((select jsonb_object_agg(x.key, j.actual -> x.key) from jsonb_each(j.expected) x)::text) as h_actual
      from joined j where j.found
    )
    select jsonb_build_object(
      'entity', '${e.name}',
      'staged', (select count(*) from planned),
      'withoutOutcome', (select count(*) from planned where outcome is null),
      'created', (select count(*) from planned where outcome = 'created'),
      'createdNotLoaded', (select count(*) from joined where outcome = 'created' and not found),
      'loadedNotPlanned', (select count(*) from joined where found and this_batch and outcome is distinct from 'created'),
      'loaded', (select count(*) from joined where found and this_batch),
      'loadedEarlier', (select count(*) from joined where found and not this_batch),
      'mapWithoutRow', (select count(*) from joined where target_id is not null and not found),
      'rowsThatDiffer', (select count(*) from diffs where cardinality(keys) > 0),
      'fieldsCompared', (select coalesce(sum(fields), 0) from diffs),
      'checksumExpected', (select coalesce(md5(string_agg(h_expected, '' order by ent, source_id)), '-') from diffs),
      'checksumTarget', (select coalesce(md5(string_agg(h_actual, '' order by ent, source_id)), '-') from diffs),
      'differingColumns', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select k, count(*) n from diffs, unnest(keys) k group by 1) z),
      'samples', (select coalesce(jsonb_agg(jsonb_build_object('entity', '${e.name}', 'source_id', s.source_id, 'fields_compared', s.fields, 'fields_equal', s.fields - cardinality(s.keys), 'differing', array_to_string(s.keys, ' '))), '[]'::jsonb)
                  from (select * from diffs order by cardinality(keys) desc, md5(source_id || :'batch') limit 20) s))`, vars);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runStage('60-reconcile', (s) => {
  const batch = currentBatch(s);
  const vars = { tenant: batch.tenant_id, batch: batch.id };
  const recorded = (batch.notes && batch.notes.checksums) || {};
  const tables = Object.keys(CARRIED).map((table) => {
    const source = read(checksumSql(`public.${table}`, table));
    const staged = target(checksumSql(`migrate.src_${table}`, table));
    return { table, source_rows: Number(source.split(':')[0]), staged_rows: Number(staged.split(':')[0]), checksum_source: source.split(':')[1], checksum_staged: staged.split(':')[1],
      same: source === staged ? 'yes' : 'NO', same_as_at_extract: recorded[table] === source ? 'yes' : 'NO' };
  });
  const entities = ENTITIES.map((e) => compareEntity(e, vars));
  const orphan = Number(target(`select count(*) from migrate.outcomes o where o.batch_id = :'batch' and o.outcome <> 'created' and exists (
      select 1 from migrate.id_map i where i.batch_id = :'batch' and i.entity = o.entity and i.source_id = o.source_id)`, vars));
  const taxFields = Number(target(`select count(*) from public.clients c join migrate.id_map i on i.target_table = 'clients' and i.target_id = c.id and i.batch_id = :'batch' where c.tax_id_type is not null or c.tax_id_last4 is not null`, vars));
  const problems = [];
  for (const t of tables) if (t.same !== 'yes') problems.push(`NOVA table ${t.table} differs from the staged copy (it changed after the extract, or the extract was incomplete)`);
  for (const e of entities) {
    if (e.withoutOutcome) problems.push(`${e.entity}: ${e.withoutOutcome} staged row(s) have no outcome`);
    if (e.createdNotLoaded) problems.push(`${e.entity}: ${e.createdNotLoaded} row(s) planned as created are not in the target`);
    if (e.loadedNotPlanned) problems.push(`${e.entity}: ${e.loadedNotPlanned} row(s) are in the target without a "created" outcome`);
    if (e.mapWithoutRow) problems.push(`${e.entity}: ${e.mapWithoutRow} id map entries point at a row that is no longer there`);
    if (e.rowsThatDiffer) problems.push(`${e.entity}: ${e.rowsThatDiffer} loaded row(s) differ from the mapping in: ${Object.keys(e.differingColumns).join(', ')}`);
    if (e.checksumExpected !== e.checksumTarget) problems.push(`${e.entity}: checksums differ`);
  }
  if (orphan) problems.push(`${orphan} record(s) are in the id map although their outcome is not "created"`);
  if (taxFields) problems.push(`${taxFields} imported client(s) have a tax ID field set`);
  const ok = problems.length === 0;
  const cols = ['entity', 'staged', 'created', 'loaded', 'loadedEarlier', 'createdNotLoaded', 'loadedNotPlanned', 'rowsThatDiffer', 'fieldsCompared', 'checksumExpected', 'checksumTarget'];
  const samples = entities.flatMap((e) => e.samples);
  writeReport(s.reportDir, '60-reconcile.md', [
    '# Reconciliation: NOVA against LBS Command', '', `Batch \`${batch.id}\`. Result: **${ok ? 'equal' : 'DIFFERENCES FOUND'}**`, '',
    '## A. NOVA now against the staged copy', '', mdTable(tables, ['table', 'source_rows', 'staged_rows', 'checksum_source', 'checksum_staged', 'same', 'same_as_at_extract']), '',
    '## B to D. Staged, planned, loaded, compared', '', mdTable(entities, cols), '',
    `Critical samples compared field by field: ${samples.length} records, ${samples.reduce((n, x) => n + x.fields_compared, 0)} fields, ${samples.reduce((n, x) => n + x.fields_compared - x.fields_equal, 0)} differences (list: 60-reconcile-samples.csv).`, '',
    '## Unresolved differences', '', ok ? 'None.' : problems.map((p) => `* ${p}`).join('\n'), '',
  ].join('\n'));
  writeReport(s.reportDir, '60-reconcile.csv', csv(entities, cols));
  writeReport(s.reportDir, '60-reconcile-samples.csv', csv(samples, ['entity', 'source_id', 'fields_compared', 'fields_equal', 'differing']));
  target(`update migrate.batches set reconciled_at = now(), reconcile_ok = :'ok' where id = :'batch'`, { ...vars, ok: ok ? 'true' : 'false' });
  log('60-reconcile', 'result', { equal: ok, problems: problems.length, loaded: entities.reduce((n, e) => n + e.loaded, 0), fieldsCompared: entities.reduce((n, e) => n + Number(e.fieldsCompared), 0) });
  if (!ok) { process.stderr.write(`DIFFERENCES: ${problems.length} (see 60-reconcile.md)\n`); return { equal: false, exit: 1 }; }
  return { equal: true };
});
