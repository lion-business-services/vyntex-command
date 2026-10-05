-- The second half of the dry run: runs INSIDE the transaction that holds the would-be rows, right before ROLLBACK.
-- Personal fields are masked here, in the database, so unmasked values never reach the report writer.
-- Variables: tenant, batch.
create function pg_temp.m_name(t text) returns text language sql immutable as $f$ select nullif(regexp_replace(coalesce(t, ''), '(\S)\S*', '\1.', 'g'), '') $f$;
create function pg_temp.m_email(t text) returns text language sql immutable as $f$
  select case when coalesce(t, '') = '' then null when position('@' in t) = 0 then '***'
              else left(t, 1) || '***@' || left(split_part(t, '@', 2), 1) || '***.' || regexp_replace(split_part(t, '@', 2), '^.*\.', '') end $f$;
create function pg_temp.m_phone(t text) returns text language sql immutable as $f$
  select case when coalesce(t, '') = '' then null else '***-***-**' || right(regexp_replace(t, '[^0-9]', '', 'g'), 2) end $f$;
create function pg_temp.m_len(t text) returns text language sql immutable as $f$ select case when coalesce(t, '') = '' then null else '[' || length(t) || ' characters]' end $f$;
create function pg_temp.m_tail(t text) returns text language sql immutable as $f$ select case when coalesce(t, '') = '' then null else '***' || right(t, 4) end $f$;
create function pg_temp.kv(variadic p text[]) returns text language sql immutable as $f$
  select string_agg(p[i] || '=' || p[i + 1], '; ' order by i) from generate_series(1, array_length(p, 1), 2) i where p[i + 1] is not null $f$;

select jsonb_build_object(
 'after', jsonb_build_object(
    'office', (select count(*) from public.offices where tenant_id = :'tenant'), 'client', (select count(*) from public.clients where tenant_id = :'tenant'),
    'client_people', (select count(*) from public.client_people where tenant_id = :'tenant'), 'service', (select count(*) from public.catalog_services where tenant_id = :'tenant'),
    'tier', (select count(*) from public.catalog_tiers where tenant_id = :'tenant'), 'appointment_type', (select count(*) from public.appointment_types where tenant_id = :'tenant'),
    'lead', (select count(*) from public.leads where tenant_id = :'tenant'), 'handoff', (select count(*) from public.lead_handoffs where tenant_id = :'tenant'),
    'note', (select count(*) from public.notes where tenant_id = :'tenant'), 'activity', (select count(*) from public.activity where tenant_id = :'tenant')),
 'mapped', (select jsonb_object_agg(entity, n) from (select entity, count(*) n from migrate.id_map where batch_id = :'batch' group by 1) x),
 'withoutOffice', (select count(*) from public.clients c join migrate.id_map i on i.target_table = 'clients' and i.target_id = c.id and i.batch_id = :'batch' where c.office_id is null),
 'unassignedOwners', (select count(*) from migrate.map_clients m join migrate.id_map i on i.entity = 'client' and i.source_id = m.source_id and i.batch_id = :'batch'
                      join public.clients c on c.id = i.target_id where m.assigned_source_id is not null and c.assigned_to is null),
 'taxFieldsSet', (select count(*) from public.clients c join migrate.id_map i on i.target_table = 'clients' and i.target_id = c.id and i.batch_id = :'batch' where c.tax_id_type is not null or c.tax_id_last4 is not null),
 'samples', (select coalesce(jsonb_agg(to_jsonb(z) order by z.entity, z.id), '[]'::jsonb) from (
    (select 'client' as entity, left(s.id::text, 8) as id,
            pg_temp.kv('name', pg_temp.m_name(concat_ws(' ', s.first_name, s.last_name)), 'business', pg_temp.m_name(s.business_name), 'email', pg_temp.m_email(s.email), 'phone', pg_temp.m_phone(s.phone),
                       'city', pg_temp.m_len(s.city), 'language', s.preferred_language, 'stage', s.lifecycle_stage, 'kind', s.client_kind, 'square', pg_temp.m_tail(s.square_customer_id),
                       'office', case when s.office_id is null then 'none' else 'set' end, 'birthday', case when s.date_of_birth is not null then '****' end) as source,
            pg_temp.kv('name', pg_temp.m_name(c.name), 'company', pg_temp.m_name(c.company), 'email', pg_temp.m_email(c.email), 'phone', pg_temp.m_phone(c.phone),
                       'address', pg_temp.m_len(c.addresses[1]), 'lang', c.lang, 'lifecycle', c.lifecycle, 'kind', c.kind, 'square', pg_temp.m_tail(c.external_ids ->> 'square'),
                       'office', case when c.office_id is null then 'none' else 'set' end, 'birthday', case when c.birthday is not null then '****' end, 'since', c.since::text) as target
     from migrate.src_clients s join migrate.id_map i on i.entity = 'client' and i.source_id = s.id::text and i.batch_id = :'batch' join public.clients c on c.id = i.target_id
     order by md5(s.id::text || :'batch') limit 20)
    union all
    (select 'client_people', left(m.source_id, 8), pg_temp.kv('role', m.role, 'name', pg_temp.m_name(m.name), 'email', pg_temp.m_email(m.email), 'phone', pg_temp.m_phone(m.phone)),
            pg_temp.kv('role', p.role, 'name', pg_temp.m_name(p.name), 'email', pg_temp.m_email(p.email), 'phone', pg_temp.m_phone(p.phone), 'primary', p.is_primary::text)
     from migrate.map_client_people m join migrate.id_map i on i.entity = m.entity and i.source_id = m.source_id and i.batch_id = :'batch' join public.client_people p on p.id = i.target_id
     order by md5(m.source_id || :'batch') limit 20)
    union all
    (select 'service', left(s.id::text, 8), pg_temp.kv('name', s.name, 'category', s.category, 'active', s.active::text, 'trigger', s.conversion_trigger),
            pg_temp.kv('name', t.name, 'category', nullif(t.category, ''), 'active', t.active::text, 'trigger', t.extra ->> 'conversionTrigger')
     from migrate.src_services s join migrate.id_map i on i.entity = 'service' and i.source_id = s.id::text and i.batch_id = :'batch' join public.catalog_services t on t.id = i.target_id
     order by md5(s.id::text || :'batch') limit 20)
    union all
    (select 'tier', left(v.id::text, 8), pg_temp.kv('name', v.name, 'cents', v.price_cents::text, 'pricing', v.pricing_type),
            pg_temp.kv('name', t.name, 'price', t.price::text, 'unit', t.unit, 'pricing', t.extra ->> 'pricingType')
     from migrate.src_service_variations v join migrate.id_map i on i.entity = 'tier' and i.source_id = v.id::text and i.batch_id = :'batch' join public.catalog_tiers t on t.id = i.target_id
     order by md5(v.id::text || :'batch') limit 20)
    union all
    (select 'appointment_type', left(a.id::text, 8), pg_temp.kv('code', a.code, 'en', a.name_en, 'minutes', a.default_duration_minutes::text, 'fee_cents', a.default_fee_cents::text),
            pg_temp.kv('en', t.name ->> 'en', 'es', t.name ->> 'es', 'minutes', t.minutes::text, 'fee', t.fee::text, 'prepay', t.prepay::text)
     from migrate.src_appointment_types a join migrate.id_map i on i.entity = 'appointment_type' and i.source_id = a.id::text and i.batch_id = :'batch' join public.appointment_types t on t.id = i.target_id
     order by md5(a.id::text || :'batch') limit 20)
    union all
    (select 'lead', left(s.id::text, 8),
            pg_temp.kv('name', pg_temp.m_name(concat_ws(' ', s.first_name, s.last_name, s.business_name)), 'email', pg_temp.m_email(s.email), 'phone', pg_temp.m_phone(s.phone), 'stage', s.lead_status,
                       'source', s.lead_source, 'value_cents', s.deal_value_cents::text, 'lifecycle', s.lifecycle_stage),
            pg_temp.kv('ticket', l.ticket, 'name', pg_temp.m_name(l.name), 'email', pg_temp.m_email(l.email), 'phone', pg_temp.m_phone(l.phone), 'stage', l.status, 'source', l.source,
                       'value', l.value::text, 'owner', case when l.owner_id is null then 'none' else 'set' end, 'linked_client', case when l.client_id is null then 'no' else 'yes' end)
     from migrate.src_clients s join migrate.id_map i on i.entity = 'lead' and i.source_id = s.id::text and i.batch_id = :'batch' join public.leads l on l.id = i.target_id
     order by md5(s.id::text || :'batch') limit 20)
    union all
    (select 'handoff', left(a.id::text, 8), pg_temp.kv('at', a.created_at::text, 'reason', pg_temp.m_len(a.reason), 'to', case when a.to_user_id is null then 'none' else 'set' end),
            pg_temp.kv('at', h.at::text, 'reason', pg_temp.m_len(h.reason), 'to', case when h.to_member_id is null then 'none' else 'set' end, 'by', h.by_kind)
     from migrate.src_lead_assignments a join migrate.id_map i on i.entity = 'handoff' and i.source_id = a.id::text and i.batch_id = :'batch' join public.lead_handoffs h on h.id = i.target_id
     order by md5(a.id::text || :'batch') limit 20)
    union all
    (select 'note', left(m.source_id, 8), pg_temp.kv('from', m.entity, 'at', m.at::text, 'text', pg_temp.m_len(m.text)),
            pg_temp.kv('on', n.parent_type, 'kind', n.kind, 'at', n.at::text, 'text', pg_temp.m_len(n.text), 'author', case when n.by_member_id is null then 'none' else 'set' end)
     from migrate.map_notes m join migrate.id_map i on i.entity = m.entity and i.source_id = m.source_id and i.batch_id = :'batch' join public.notes n on n.id = i.target_id
     order by md5(m.source_id || :'batch') limit 20)
 ) z));
