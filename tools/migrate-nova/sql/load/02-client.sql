-- One batch of this entity. Insert only. A row is taken when stage 30 said "created" and the id map does not know it
-- yet, so running the load again inserts nothing twice. Runs as service_role (see 50-apply.mjs).
-- Variables: tenant, batch, batch_size.
with pick as (
  select m.*, ('client')::text as ent from migrate.map_clients m
  join migrate.outcomes o on o.batch_id = :'batch' and o.entity = ('client')::text and o.source_id = m.source_id and o.outcome = 'created'
  where not exists (select 1 from migrate.id_map i where i.tenant_id = :'tenant' and i.entity = ('client')::text and i.source_id = m.source_id)
  order by m.source_id limit :batch_size
), ids as (
  insert into migrate.id_map (tenant_id, entity, source_id, target_table, target_id, batch_id)
  select :'tenant', p.ent, p.source_id, 'clients', gen_random_uuid(), :'batch' from pick p
  returning entity, source_id, target_id
), ins as (
  insert into public.clients (id, tenant_id, name, company, phone, email, addresses, since, email_opt_out, kind, client_type, birthday, lang,
                              sms_opt_in, whatsapp, social, office_id, assigned_to, lifecycle, tags, external_ids, extra, created_at, updated_at)
  select i.target_id, :'tenant', p.name, p.company, p.phone, p.email, p.addresses, p.since, p.email_opt_out, p.kind, p.client_type, p.birthday, p.lang,
         p.sms_opt_in, p.whatsapp, p.social, coalesce((select x.target_id from migrate.id_map x where x.tenant_id = :'tenant' and x.entity = 'office' and x.source_id = p.office_source_id), (select o.existing_id from migrate.map_offices o where o.source_id = p.office_source_id)), (select s.member_id from migrate.map_staff s where s.source_id = p.assigned_source_id), p.lifecycle, p.tags, p.external_ids, p.extra, p.created_at, p.updated_at
  from pick p join ids i on i.entity = p.ent and i.source_id = p.source_id
  returning 1
)
select count(*) from ins;
