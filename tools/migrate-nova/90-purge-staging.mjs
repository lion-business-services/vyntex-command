// After LBS has confirmed the new platform: remove the staged copy of NOVA from the target database.
// Keeps migrate.batches, migrate.id_map, migrate.outcomes and migrate.decisions (ids and counts, no client data).
//
//   node tools/migrate-nova/90-purge-staging.mjs --confirm "REMOVE STAGING"
import { runStage, refuse, target } from './lib.mjs';

runStage('90-purge-staging', () => {
  if (process.argv[process.argv.indexOf('--confirm') + 1] !== 'REMOVE STAGING' || !process.argv.includes('--confirm')) refuse('--confirm "REMOVE STAGING" is required.');
  const n = target(`do $p$ declare r record; begin
      for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'migrate' and c.relkind = 'r' and (c.relname like 'src\\_%' or c.relname like 'map\\_%' or c.relname like 'cfg\\_%') loop
        execute format('drop table migrate.%I cascade', r.relname);
      end loop; end $p$;
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'migrate' and c.relkind = 'r';`);
  return { tablesLeft: Number(n) };
});
