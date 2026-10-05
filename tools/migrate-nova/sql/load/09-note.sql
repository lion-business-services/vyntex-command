-- One batch of this entity. Insert only. A row is taken when stage 30 said "created" and the id map does not know it
-- yet, so running the load again inserts nothing twice. Runs as service_role (see 50-apply.mjs).
-- Variables: tenant, batch, batch_size.
with pick as (
  select m.*, (m.entity)::text as ent from migrate.map_notes m
  join migrate.outcomes o on o.batch_id = :'batch' and o.entity = (m.entity)::text and o.source_id = m.source_id and o.outcome = 'created'
  where not exists (select 1 from migrate.id_map i where i.tenant_id = :'tenant' and i.entity = (m.entity)::text and i.source_id = m.source_id)
  order by m.source_id limit :batch_size
), ids as (
  insert into migrate.id_map (tenant_id, entity, source_id, target_table, target_id, batch_id)
  select :'tenant', p.ent, p.source_id, 'notes', gen_random_uuid(), :'batch' from pick p
  returning entity, source_id, target_id
), ins as (
  insert into public.notes (id, tenant_id, parent_type, lead_id, client_id, at, kind, text, by_member_id, extra, created_at, updated_at)
  select i.target_id, :'tenant', p.parent_type, case when p.parent_type = 'lead' then par.target_id end, case when p.parent_type = 'client' then par.target_id end,
         p.at, p.kind, p.text, (select s.member_id from migrate.map_staff s where s.source_id = p.by_source_id), p.extra, p.created_at, p.updated_at
  from pick p join ids i on i.entity = p.ent and i.source_id = p.source_id
  join migrate.id_map par on par.tenant_id = :'tenant' and par.entity = p.parent_type and par.source_id = p.parent_id
  returning 1
)
select count(*) from ins;
