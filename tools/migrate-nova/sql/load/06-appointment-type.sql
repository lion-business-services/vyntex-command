-- One batch of this entity. Insert only. A row is taken when stage 30 said "created" and the id map does not know it
-- yet, so running the load again inserts nothing twice. Runs as service_role (see 50-apply.mjs).
-- Variables: tenant, batch, batch_size.
with pick as (
  select m.*, ('appointment_type')::text as ent from migrate.map_appointment_types m
  join migrate.outcomes o on o.batch_id = :'batch' and o.entity = ('appointment_type')::text and o.source_id = m.source_id and o.outcome = 'created'
  where not exists (select 1 from migrate.id_map i where i.tenant_id = :'tenant' and i.entity = ('appointment_type')::text and i.source_id = m.source_id)
  order by m.source_id limit :batch_size
), ids as (
  insert into migrate.id_map (tenant_id, entity, source_id, target_table, target_id, batch_id)
  select :'tenant', p.ent, p.source_id, 'appointment_types', gen_random_uuid(), :'batch' from pick p
  returning entity, source_id, target_id
), ins as (
  insert into public.appointment_types (id, tenant_id, name, minutes, fee, prepay, mode, active, extra)
  select i.target_id, :'tenant', p.name, p.minutes, p.fee, p.prepay, p.mode, p.active, p.extra
  from pick p join ids i on i.entity = p.ent and i.source_id = p.source_id
  returning 1
)
select count(*) from ins;
