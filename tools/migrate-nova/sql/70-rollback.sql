-- Stage 70: take ONE batch out of the target again. Removes exactly the rows whose ids the id map recorded for that
-- batch, children before parents, and checks that the number removed is the number recorded. One transaction: if
-- anything does not add up, nothing is removed. NOVA is not involved at all.
--
-- Runs as the owner of the tables (role "postgres"), not as service_role: imported entries of the activity feed are
-- append-only for every role, so the rule is lifted for this one table for the length of this transaction, and only
-- rows of this batch are removed. The table is locked meanwhile; do this while nobody is working.
-- The audit log keeps the record of both the import and its removal: audit entries are never removed.
--
-- Variables: tenant, batch, discard_edits (true to remove records that people changed after the import).
begin;
set local lock_timeout = '10s';
set local request.jwt.claims = '';

do $check$
declare
  v_batch uuid := current_setting('migrate.batch')::uuid;
  v_edits int;
begin
  -- A record somebody changed after the import has a newer "updated" time than the one the import gave it.
  select (select count(*) from migrate.id_map i join public.clients t on t.id = i.target_id join migrate.map_clients m on m.source_id = i.source_id
           where i.batch_id = v_batch and i.entity = 'client' and t.updated_at is distinct from m.updated_at)
       + (select count(*) from migrate.id_map i join public.leads t on t.id = i.target_id join migrate.map_leads m on m.source_id = i.source_id
           where i.batch_id = v_batch and i.entity = 'lead' and t.updated_at is distinct from m.updated_at)
       + (select count(*) from migrate.id_map i join public.catalog_services t on t.id = i.target_id join migrate.map_services m on m.source_id = i.source_id
           where i.batch_id = v_batch and i.entity = 'service' and t.updated_at is distinct from m.updated_at)
    into v_edits;
  if v_edits > 0 and current_setting('migrate.discard_edits') <> 'true' then
    raise exception 'rollback_refused_edited:%', v_edits using errcode = 'P0001';
  end if;
end
$check$;

create temp table removed (target_table text, n bigint) on commit drop;
alter table public.activity disable trigger activity_append_only;
with d as (delete from public.activity t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'activity' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'activity', count(*) from d;
alter table public.activity enable trigger activity_append_only;
with d as (delete from public.notes t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'notes' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'notes', count(*) from d;
with d as (delete from public.lead_handoffs t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'lead_handoffs' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'lead_handoffs', count(*) from d;
with d as (delete from public.leads t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'leads' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'leads', count(*) from d;
with d as (delete from public.appointment_types t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'appointment_types' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'appointment_types', count(*) from d;
with d as (delete from public.catalog_tiers t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'catalog_tiers' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'catalog_tiers', count(*) from d;
with d as (delete from public.catalog_services t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'catalog_services' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'catalog_services', count(*) from d;
with d as (delete from public.client_people t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'client_people' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'client_people', count(*) from d;
with d as (delete from public.clients t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'clients' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'clients', count(*) from d;
with d as (delete from public.offices t using migrate.id_map i where i.batch_id = :'batch' and i.target_table = 'offices' and t.id = i.target_id and t.tenant_id = :'tenant' returning 1)
  insert into removed select 'offices', count(*) from d;

do $verify$
declare
  v_batch uuid := current_setting('migrate.batch')::uuid;
  r record;
begin
  for r in select i.target_table, count(*) as mapped, coalesce(max(x.n), 0) as gone
           from migrate.id_map i left join removed x on x.target_table = i.target_table where i.batch_id = v_batch group by 1 loop
    if r.mapped <> r.gone and current_setting('migrate.discard_edits') <> 'true' then
      raise exception 'rollback_refused_count:%', r.target_table using errcode = 'P0001';
    end if;
  end loop;
end
$verify$;

select coalesce(jsonb_object_agg(target_table, n), '{}'::jsonb) from removed;
delete from migrate.id_map where batch_id = :'batch';
update migrate.batches set rolled_back_at = now(), is_current = false where id = :'batch';
commit;
