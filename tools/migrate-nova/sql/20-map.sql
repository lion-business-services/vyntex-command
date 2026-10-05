-- Stage 20: turn the staged NOVA rows into rows in the shape of this platform.
-- Reads migrate.src_* and the target's configuration. Writes migrate.map_* only. No live table is touched.
--
-- Every map table has source_id (the NOVA id as text) and, where a row hangs under another, the NOVA id of the
-- parent (parent_id). All other columns have the names and types of the target table, so the load is a plain copy and
-- the reconciliation can compare column by column. Links to other records are resolved at load time through
-- migrate.id_map, never guessed here.
--
-- Variables: tenant (uuid of the LBS company).
begin;
set local search_path = migrate, public, extensions;

-- ---- team: NOVA staff are matched to existing members by email. The tool never creates a member. ----
drop table if exists map_staff cascade;
create table map_staff as
select p.id::text as source_id, p.id as nova_id, p.role as nova_role, p.accepts_new_leads,
       (select m.id from public.tenant_members m
         where m.tenant_id = :'tenant' and m.role <> 'worker' and lower(btrim(m.email)) = lower(btrim(p.email))
         order by m.created_at limit 1) as member_id
from src_profiles p;
alter table map_staff add primary key (source_id);

-- ---- offices: an office with the same name in the target is the same office ----
drop table if exists map_offices cascade;
create table map_offices as
select o.id::text as source_id,
       (select t.id from public.offices t where t.tenant_id = :'tenant' and lower(btrim(t.name)) = lower(btrim(o.name)) limit 1) as existing_id,
       btrim(o.name) as name,
       left(concat_ws(', ', nullif(btrim(o.address_line1), ''), nullif(btrim(o.address_line2), ''), nullif(btrim(o.city), ''),
            nullif(btrim(concat_ws(' ', o.state, o.postal_code)), '')), 400) as address,
       left(nullif(btrim(o.phone), ''), 40) as phone,
       false as main,
       jsonb_strip_nulls(jsonb_build_object('novaId', o.id, 'novaCode', nullif(btrim(o.code), ''), 'novaActive', o.active)) as extra,
       o.created_at, o.updated_at
from src_offices o;
alter table map_offices add primary key (source_id);

-- ---- clients (everything in NOVA's clients table that is not an open lead) ----
drop table if exists map_clients cascade;
create table map_clients as
with base as (
  select c.*,
         nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), '') as person,
         nullif(btrim(c.business_name), '') as biz
  from src_clients c
  where coalesce(c.lifecycle_stage, 'active_client') not in ('lead', 'qualified_lead')
), shaped as (
  select b.*, case when b.client_kind = 'business' or (b.person is null and b.biz is not null) then 'business' else 'individual' end as k
  from base b
)
select s.id::text as source_id,
       s.office_id::text as office_source_id,
       s.assigned_to::text as assigned_source_id,
       coalesce(case when s.k = 'business' then coalesce(s.biz, s.person) else coalesce(s.person, s.biz) end, '') as name,
       case when s.k = 'individual' and s.person is not null then s.biz end as company,
       coalesce(btrim(s.phone), '') as phone,
       coalesce(lower(btrim(s.email)), '') as email,
       case when coalesce(nullif(btrim(s.address_line1), ''), nullif(btrim(s.city), ''), nullif(btrim(s.postal_code), '')) is null then '{}'::text[]
            else array[concat_ws(', ', nullif(btrim(s.address_line1), ''), nullif(btrim(s.address_line2), ''), nullif(btrim(s.city), ''),
                 nullif(btrim(concat_ws(' ', nullif(btrim(s.state), ''), nullif(btrim(s.postal_code), ''))), ''))] end as addresses,
       coalesce(s.client_since_date, (s.source_created_at at time zone 'UTC')::date, (s.created_at at time zone 'UTC')::date) as since,
       not coalesce(s.email_opt_in, true) as email_opt_out,
       s.k as kind,
       -- NOVA's "type" mixed a legal form with a commercial relationship. The legal form maps to the practice edition's
       -- client types when the free text says which one; the relationship (vip, partner...) becomes a tag.
       case when s.k = 'individual' then 'individual'
            when s.business_type ~* '^\s*l\.?l\.?c' then 'llc'
            when s.business_type ~* 's[ -]?corp' then 's_corp'
            when s.business_type ~* 'c[ -]?corp' then 'c_corp'
            when s.business_type ~* 'partner' then 'partnership'
            when s.business_type ~* 'sole' then 'sole_prop'
            when s.business_type ~* 'non[ -]?profit' then 'nonprofit' end as client_type,
       s.date_of_birth as birthday,
       case when s.preferred_language in ('en', 'es', 'zh') then s.preferred_language end as lang,
       coalesce(s.sms_opt_in, false) as sms_opt_in,
       left(nullif(btrim(s.whatsapp_phone), ''), 40) as whatsapp,
       nullif(jsonb_strip_nulls(jsonb_build_object('facebook', nullif(btrim(s.social_facebook_url), ''), 'instagram', nullif(btrim(s.social_instagram_url), ''),
              'tiktok', nullif(btrim(s.social_tiktok_url), ''), 'linkedin', nullif(btrim(s.social_linkedin_url), ''))), '{}'::jsonb) as social,
       case when s.lifecycle_stage = 'inactive_client' then 'inactive' else 'active' end as lifecycle,
       case when s.client_type in ('partner', 'wholesale', 'vip', 'referral_source') then array[s.client_type] end as tags,
       jsonb_strip_nulls(jsonb_build_object('nova', s.id::text, 'square', nullif(btrim(s.square_customer_id), ''))) as external_ids,
       jsonb_strip_nulls(jsonb_build_object('importedFrom', 'nova', 'novaSource', s.source, 'website', nullif(btrim(s.website), ''),
              'businessType', nullif(btrim(s.business_type), ''), 'partnerTerms', nullif(btrim(s.partner_terms), ''),
              'documentsFolderUrl', nullif(btrim(s.documents_folder_url), ''), 'lastContactAt', s.last_contact_at,
              'country', nullif(nullif(btrim(s.country), ''), 'US'))) as extra,
       s.created_at, s.updated_at,
       -- kept for the checks of stage 30, never loaded:
       coalesce(s.needs_review, false) as nova_needs_review,
       s.person as contact_name,
       concat_ws(', ', nullif(btrim(s.address_line1), ''), nullif(btrim(s.city), ''), nullif(btrim(s.postal_code), '')) as address_key
from shaped s;
alter table map_clients add primary key (source_id);

-- ---- people of a client: NOVA's owners, plus the person named on a business record as a contact ----
drop table if exists map_client_people cascade;
create table map_client_people as
select o.id::text as source_id, 'client_owner'::text as entity, o.client_id::text as parent_id,
       'owner'::text as role, coalesce(btrim(o.full_name), '') as name, nullif(btrim(o.title), '') as title,
       nullif(btrim(o.phone), '') as phone, nullif(lower(btrim(o.email)), '') as email,
       case when o.is_primary then true end as is_primary,
       (row_number() over (partition by o.client_id order by o.is_primary desc, o.created_at, o.id))::int - 1 as position,
       jsonb_build_object('importedFrom', 'nova', 'novaId', o.id) as extra, o.created_at, o.updated_at
from src_client_owners o
union all
select m.source_id, 'client_contact', m.source_id, 'contact', m.contact_name, null, null, null,
       case when not exists (select 1 from src_client_owners o where o.client_id::text = m.source_id and o.is_primary) then true end,
       100, jsonb_build_object('importedFrom', 'nova'), m.created_at, m.updated_at
from map_clients m
where m.kind = 'business' and m.contact_name is not null and m.contact_name <> m.name;
alter table map_client_people add primary key (entity, source_id);

-- ---- catalog ----
drop table if exists map_services cascade;
create table map_services as
select s.id::text as source_id, left(btrim(s.name), 200) as name, left(coalesce(btrim(s.category), ''), 120) as category,
       left(nullif(btrim(s.description), ''), 4000) as description,
       (coalesce(s.active, true) and coalesce(s.is_active, true)) as active,
       jsonb_strip_nulls(jsonb_build_object('nova', s.id::text, 'novaCode', nullif(btrim(s.code), ''))) as external_ids,
       jsonb_strip_nulls(jsonb_build_object('importedFrom', 'nova', 'conversionTrigger', s.conversion_trigger, 'novaSource', s.source,
              'subcategory', nullif(btrim(s.subcategory), ''), 'novaUnit', nullif(s.unit, 'each'))) as extra,
       s.created_at, s.created_at as updated_at,
       s.source as nova_source, s.default_price_cents
from src_services s;
alter table map_services add primary key (source_id);

drop table if exists map_tiers cascade;
create table map_tiers as
select v.id::text as source_id, 'tier'::text as entity, v.service_id::text as parent_id, left(coalesce(nullif(btrim(v.name), ''), 'Standard'), 200) as name,
       round(coalesce(v.price_cents, 0) / 100.0, 2)::numeric(12,2) as price, 'flat'::text as unit,
       case when v.pricing_type = 'VARIABLE_PRICING' then 'Price set per engagement' end as note,
       nullif(jsonb_strip_nulls(jsonb_build_object('square', nullif(btrim(v.square_variation_id), ''))), '{}'::jsonb) as external_ids,
       (row_number() over (partition by v.service_id order by v.created_at, v.id))::int - 1 as position,
       jsonb_strip_nulls(jsonb_build_object('importedFrom', 'nova', 'novaId', v.id, 'pricingType', v.pricing_type, 'sku', nullif(btrim(v.sku), ''),
              'novaActive', v.is_active)) as extra,
       v.created_at, v.created_at as updated_at, v.price_cents as nova_price_cents
from src_service_variations v
union all
-- a service that has a price of its own and no tier gets one tier, so no price is lost
select s.id::text, 'tier_default', s.id::text, 'Standard', round(s.default_price_cents / 100.0, 2)::numeric(12,2), 'flat', null, null, 0,
       jsonb_build_object('importedFrom', 'nova', 'fromDefaultPrice', true), s.created_at, s.created_at, s.default_price_cents
from src_services s
where coalesce(s.default_price_cents, 0) > 0 and not exists (select 1 from src_service_variations v where v.service_id = s.id);
alter table map_tiers add primary key (entity, source_id);

drop table if exists map_appointment_types cascade;
create table map_appointment_types as
select a.id::text as source_id,
       jsonb_strip_nulls(jsonb_build_object('en', btrim(a.name_en), 'es', btrim(a.name_es), 'zh', nullif(btrim(a.name_zh), ''))) as name,
       a.default_duration_minutes as minutes, round(coalesce(a.default_fee_cents, 0) / 100.0, 2)::numeric(12,2) as fee,
       coalesce(a.default_fee_cents, 0) > 0 as prepay, 'office'::text as mode, coalesce(a.is_active, true) as active,
       jsonb_build_object('importedFrom', 'nova', 'novaCode', a.code, 'sortOrder', a.sort_order) as extra,
       (select t.id from public.appointment_types t where t.tenant_id = :'tenant'
          and (t.extra ->> 'novaCode' = a.code or lower(t.name ->> 'en') = lower(btrim(a.name_en))) limit 1) as existing_id
from src_appointment_types a;
alter table map_appointment_types add primary key (source_id);

-- ---- leads: NOVA's open leads, plus one closed (won) lead for every client that has handoff or lead history, so
--      that history has a record to hang under. The lookup tables are the whole mapping; anything else is reported. ----
drop table if exists cfg_stage_map cascade;
create table cfg_stage_map (nova text primary key, target text not null);
insert into cfg_stage_map values ('new', 'new'), ('contacted', 'contacted'), ('appointment_set', 'appointment'), ('proposal_sent', 'proposal'),
  ('negotiating', 'negotiating'), ('won', 'won'), ('lost', 'lost');
drop table if exists cfg_source_map cascade;
create table cfg_source_map (nova text primary key, target text not null);
insert into cfg_source_map values ('website', 'website'), ('web', 'website'), ('phone', 'phone'), ('call', 'phone'), ('walk_in', 'walk_in'), ('walk-in', 'walk_in'),
  ('walk in', 'walk_in'), ('referral', 'referral'), ('google', 'google'), ('facebook', 'facebook'), ('instagram', 'instagram'), ('whatsapp', 'whatsapp'),
  ('existing_client', 'existing_client'), ('existing client', 'existing_client'), ('other', 'other'), ('', 'other');

drop table if exists map_leads cascade;
create table map_leads as
with src as (
  select c.*, true as open_lead from src_clients c where c.lifecycle_stage in ('lead', 'qualified_lead')
  union all
  select c.*, false from src_clients c
  where coalesce(c.lifecycle_stage, 'active_client') not in ('lead', 'qualified_lead')
    and (exists (select 1 from src_lead_assignments a where a.client_id = c.id) or exists (select 1 from src_lead_activities a where a.client_id = c.id))
), shaped as (
  select s.*,
         nullif(btrim(concat_ws(' ', nullif(btrim(s.first_name), ''), nullif(btrim(s.last_name), ''))), '') as person,
         nullif(btrim(s.business_name), '') as biz,
         lower(btrim(coalesce(s.lead_source, ''))) as src_key,
         case when s.open_lead then coalesce(s.lead_status, 'new') else 'won' end as status_key
  from src s
)
select s.id::text as source_id,
       case when s.open_lead then null else s.id::text end as client_source_id,
       s.assigned_to::text as owner_source_id, s.original_assigned_to::text as original_owner_source_id, s.office_id::text as office_source_id,
       'NOVA-' || lpad((row_number() over (order by s.created_at, s.id))::text, 4, '0') as ticket,
       coalesce(case when s.client_kind = 'business' then coalesce(s.biz, s.person) else coalesce(s.person, s.biz) end, '') as name,
       case when s.client_kind <> 'business' and s.person is not null then s.biz end as company,
       coalesce(btrim(s.phone), '') as phone, coalesce(lower(btrim(s.email)), '') as email,
       coalesce(concat_ws(', ', nullif(btrim(s.address_line1), ''), nullif(btrim(s.city), ''), nullif(btrim(concat_ws(' ', s.state, s.postal_code)), '')), '') as address,
       'other'::text as type,
       coalesce(sm.target, 'other') as source,
       (select g.target from cfg_stage_map g where g.nova = s.status_key) as status,
       'medium'::text as pri,
       round(s.deal_value_cents / 100.0, 2)::numeric(12,2) as value,
       s.next_action_due as follow_up,
       (s.created_at at time zone 'UTC')::date as created,
       left(nullif(btrim(s.lost_reason), ''), 2000) as lost_reason,
       left(nullif(btrim(s.next_action), ''), 500) as next_action_text, s.next_action_due,
       s.last_contact_at as last_contact,
       (s.lost_at at time zone 'UTC')::date as lost_at,
       left(nullif(concat_ws(' · ', nullif(btrim(s.lead_source_detail), ''), case when sm.target is null then 'NOVA source: ' || s.src_key end), ''), 300) as source_detail,
       case when s.preferred_language in ('en', 'es', 'zh') then s.preferred_language end as lang,
       case when s.client_kind = 'business' then 'business' else 'individual' end as kind,
       coalesce(s.sms_opt_in, false) as sms_opt_in,
       jsonb_strip_nulls(jsonb_build_object('importedFrom', 'nova', 'novaId', s.id, 'novaHistorical', case when not s.open_lead then true end,
              'novaStage', s.lead_status, 'novaLifecycle', s.lifecycle_stage)) as extra,
       s.created_at, s.updated_at,
       s.open_lead, s.status_key as nova_status, s.src_key as nova_source, sm.target is null as source_unmapped
from shaped s left join cfg_source_map sm on sm.nova = s.src_key;
alter table map_leads add primary key (source_id);

drop table if exists map_handoffs cascade;
create table map_handoffs as
select a.id::text as source_id, a.client_id::text as parent_id,
       a.from_user_id::text as from_source_id, a.to_user_id::text as to_source_id, a.assigned_by::text as by_source_id,
       a.created_at as at,
       left(nullif(concat_ws(': ', nullif(btrim(a.reason), ''), nullif(btrim(a.note), '')), ''), 500) as reason,
       'manual'::text as how,
       jsonb_build_object('importedFrom', 'nova', 'novaId', a.id) as extra, a.created_at
from src_lead_assignments a;
alter table map_handoffs add primary key (source_id);

-- ---- notes: the note field of a client, staff comments, and the notes and contact attempts of a lead ----
drop table if exists map_notes cascade;
create table map_notes as
select c.id::text as source_id, 'client_note'::text as entity, 'client'::text as parent_type, c.id::text as parent_id, null::text as by_source_id,
       c.created_at as at, 'note'::text as kind, btrim(c.notes) as text, jsonb_build_object('importedFrom', 'nova', 'novaField', 'clients.notes') as extra,
       c.created_at, c.updated_at
from src_clients c
where nullif(btrim(c.notes), '') is not null and coalesce(c.lifecycle_stage, 'active_client') not in ('lead', 'qualified_lead')
union all
select c.id::text, 'lead_note', 'lead', c.id::text, null, c.created_at, 'note', btrim(c.notes), jsonb_build_object('importedFrom', 'nova', 'novaField', 'clients.notes'),
       c.created_at, c.updated_at
from src_clients c
where nullif(btrim(c.notes), '') is not null and c.lifecycle_stage in ('lead', 'qualified_lead')
union all
select m.id::text, 'comment', 'client', m.client_id::text, m.author_id::text, m.created_at, 'note', btrim(m.body),
       jsonb_build_object('importedFrom', 'nova', 'novaId', m.id), m.created_at, m.updated_at
from src_client_comments m
union all
select a.id::text, 'lead_contact', 'lead', a.client_id::text, a.actor_user_id::text, a.created_at,
       case a.channel when 'call' then 'call' when 'sms' then 'text' when 'whatsapp' then 'text' when 'email' then 'email' when 'in_person' then 'visit' else 'note' end,
       coalesce(nullif(btrim(a.note), ''), 'Contact recorded in NOVA' || coalesce(' (' || a.channel || ')', '')),
       jsonb_strip_nulls(jsonb_build_object('importedFrom', 'nova', 'novaId', a.id, 'novaType', a.activity_type, 'novaChannel', a.channel)), a.created_at, a.created_at
from src_lead_activities a
where a.activity_type in ('note', 'contact_attempt');
alter table map_notes add primary key (entity, source_id);

-- ---- lead timeline: stage changes, conversion and loss become entries of the activity feed, with their own dates ----
drop table if exists map_activity cascade;
create table map_activity as
select a.id::text as source_id, a.client_id::text as parent_id, a.actor_user_id::text as by_source_id, a.created_at as at,
       case a.activity_type when 'stage_change' then 'lead.stage' when 'conversion' then 'lead.won' when 'lost' then 'lead.lost' end as kind,
       jsonb_strip_nulls(jsonb_build_object(
         'from', (select g.target from cfg_stage_map g where g.nova = a.from_value),
         'to', (select g.target from cfg_stage_map g where g.nova = a.to_value),
         'reason', case when a.activity_type = 'lost' then left(nullif(btrim(a.note), ''), 500) end)) as params,
       'lead'::text as ref_type,
       jsonb_build_object('importedFrom', 'nova', 'novaId', a.id, 'novaType', a.activity_type) as extra,
       a.created_at, a.activity_type as nova_type
from src_lead_activities a
where a.activity_type not in ('note', 'contact_attempt');
alter table map_activity add primary key (source_id);

revoke all on all tables in schema migrate from public, anon, authenticated;
grant select on all tables in schema migrate to service_role;
revoke all on migrate.src_profiles, migrate.src_clients, migrate.src_client_owners, migrate.src_client_comments, migrate.src_lead_assignments,
  migrate.src_lead_activities, migrate.src_invoices, migrate.src_payments, migrate.src_offices, migrate.src_services, migrate.src_service_variations,
  migrate.src_appointment_types from service_role;
grant select, insert on migrate.id_map to service_role;
commit;

select jsonb_build_object(
  'staff', (select count(*) from migrate.map_staff), 'staffMatched', (select count(*) from migrate.map_staff where member_id is not null),
  'offices', (select count(*) from migrate.map_offices), 'clients', (select count(*) from migrate.map_clients),
  'clientPeople', (select count(*) from migrate.map_client_people), 'services', (select count(*) from migrate.map_services),
  'tiers', (select count(*) from migrate.map_tiers), 'appointmentTypes', (select count(*) from migrate.map_appointment_types),
  'leads', (select count(*) from migrate.map_leads), 'handoffs', (select count(*) from migrate.map_handoffs),
  'notes', (select count(*) from migrate.map_notes), 'activity', (select count(*) from migrate.map_activity),
  'clientsWithoutOffice', (select count(*) from migrate.map_clients where office_source_id is null),
  'unmappedSources', (select coalesce(jsonb_object_agg(nova_source, n), '{}'::jsonb) from (select nova_source, count(*) n from migrate.map_leads where source_unmapped group by 1) x),
  'unmappedStages', (select coalesce(jsonb_object_agg(nova_status, n), '{}'::jsonb) from (select nova_status, count(*) n from migrate.map_leads where status is null group by 1) x));
