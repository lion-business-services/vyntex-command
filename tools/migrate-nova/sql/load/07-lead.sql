-- One batch of this entity. Insert only. A row is taken when stage 30 said "created" and the id map does not know it
-- yet, so running the load again inserts nothing twice. Runs as service_role (see 50-apply.mjs).
-- Variables: tenant, batch, batch_size.
with pick as (
  select m.*, ('lead')::text as ent from migrate.map_leads m
  join migrate.outcomes o on o.batch_id = :'batch' and o.entity = ('lead')::text and o.source_id = m.source_id and o.outcome = 'created'
  where not exists (select 1 from migrate.id_map i where i.tenant_id = :'tenant' and i.entity = ('lead')::text and i.source_id = m.source_id)
  order by m.source_id limit :batch_size
), ids as (
  insert into migrate.id_map (tenant_id, entity, source_id, target_table, target_id, batch_id)
  select :'tenant', p.ent, p.source_id, 'leads', gen_random_uuid(), :'batch' from pick p
  returning entity, source_id, target_id
), ins as (
  insert into public.leads (id, tenant_id, ticket, name, company, phone, email, address, type, source, status, pri, owner_id, original_owner_id, value,
                            follow_up, created, client_id, lost_reason, next_action_text, next_action_due, last_contact, lost_at, source_detail, lang, kind,
                            sms_opt_in, office_id, extra, created_at, updated_at)
  select i.target_id, :'tenant', p.ticket, p.name, p.company, p.phone, p.email, p.address, p.type, p.source, p.status, p.pri,
         (select s.member_id from migrate.map_staff s where s.source_id = p.owner_source_id), (select s.member_id from migrate.map_staff s where s.source_id = p.original_owner_source_id), p.value, p.follow_up, p.created,
         (select x.target_id from migrate.id_map x where x.tenant_id = :'tenant' and x.entity = 'client' and x.source_id = p.client_source_id),
         p.lost_reason, p.next_action_text, p.next_action_due, p.last_contact, p.lost_at, p.source_detail, p.lang, p.kind, p.sms_opt_in,
         coalesce((select x.target_id from migrate.id_map x where x.tenant_id = :'tenant' and x.entity = 'office' and x.source_id = p.office_source_id), (select o.existing_id from migrate.map_offices o where o.source_id = p.office_source_id)), p.extra, p.created_at, p.updated_at
  from pick p join ids i on i.entity = p.ent and i.source_id = p.source_id
  returning 1
)
select count(*) from ins;
