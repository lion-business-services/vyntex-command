-- Stage 30: one outcome for every staged record. Writes migrate.outcomes only.
--
--   created       will be inserted by the load
--   skipped       will not be inserted, with the reason (a known sample or test record, already imported, a parent that
--                 is not loaded, a decision)
--   duplicate     matches a record that is already there or an earlier record of the same import; names the match
--   invalid       cannot be stored as it is; names the field
--   needs_review  a person has to answer the question first
--
-- Order of the checks for a client: already imported, decided "skip", sample or test, invalid field, marked for
-- review in NOVA, duplicate. A decision "load" (migrate.decisions) overrides sample, review and duplicate, which is
-- how a legitimate duplicate is let through by an explicit choice. "load_without_field" loads an invalid record with
-- the bad email or phone left empty.
--
-- Duplicates are found the way public.client_find_duplicate finds them (app.norm_email, app.norm_phone,
-- app.norm_name of the target): email first, then phone, then name together with address.
--
-- Variables: tenant, batch, criteria (the JSON of sample-criteria.json).
begin;
set local search_path = migrate, public, extensions;
delete from outcomes where batch_id = :'batch';

drop table if exists cfg_sample cascade;
create table cfg_sample (kind text not null, value text not null);
insert into cfg_sample select e.key, v.value from jsonb_each(:'criteria'::jsonb) e cross join lateral jsonb_array_elements_text(e.value) v
  where jsonb_typeof(e.value) = 'array';

create function pg_temp.sample_reason(p_id text, p_name text, p_email text, p_phone text) returns text language sql stable as $f$
  select coalesce(
    (select 'sample:listed_id' from migrate.cfg_sample where kind = 'recordIds' and value = p_id limit 1),
    (select 'sample:email_domain:' || value from migrate.cfg_sample where kind = 'emailDomains' and split_part(lower(coalesce(p_email, '')), '@', 2) = value limit 1),
    (select 'sample:email_tld:' || value from migrate.cfg_sample where kind = 'emailTlds' and lower(coalesce(p_email, '')) ~ ('\.' || value || '$') limit 1),
    (select 'sample:phone_pattern' from migrate.cfg_sample where kind = 'phonePatterns' and coalesce(p_phone, '') ~ value limit 1),
    (select 'sample:name_word:' || value from migrate.cfg_sample where kind = 'nameWords' and coalesce(p_name, '') ~* ('\m' || value || '\M') limit 1))
$f$;
create function pg_temp.bad_field(p_name text, p_email text, p_phone text) returns text language sql immutable as $f$
  select case when btrim(coalesce(p_name, '')) = '' then 'name'
              when coalesce(p_email, '') <> '' and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]{2,}$' then 'email'
              when coalesce(p_phone, '') <> '' and length(regexp_replace(p_phone, '[^0-9]', '', 'g')) not between 7 and 15 then 'phone' end
$f$;
-- "Is the parent there?": it is being created by this batch, or an earlier run already created it.
create function pg_temp.parent_state(p_batch uuid, p_tenant uuid, p_entity text, p_id text) returns text language sql stable as $f$
  select case when exists (select 1 from migrate.id_map i where i.tenant_id = p_tenant and i.entity = p_entity and i.source_id = p_id) then 'created'
              else coalesce((select o.outcome from migrate.outcomes o where o.batch_id = p_batch and o.entity = p_entity and o.source_id = p_id), 'missing') end
$f$;
create function pg_temp.imported(p_tenant uuid, p_entity text, p_id text) returns boolean language sql stable as $f$
  select exists (select 1 from migrate.id_map i where i.tenant_id = p_tenant and i.entity = p_entity and i.source_id = p_id)
$f$;

-- a decision "load_without_field" empties the field that cannot be stored
update map_clients m set email = '' from decisions d
 where d.tenant_id = :'tenant' and d.entity = 'client' and d.source_id = m.source_id and d.decision = 'load_without_field' and pg_temp.bad_field(m.name, m.email, '') = 'email';
update map_clients m set phone = '' from decisions d
 where d.tenant_id = :'tenant' and d.entity = 'client' and d.source_id = m.source_id and d.decision = 'load_without_field' and pg_temp.bad_field(m.name, '', m.phone) = 'phone';

-- ---- team and offices ----
insert into outcomes (batch_id, entity, source_id, outcome, reason, question, matched_kind, matched_id, matched_on)
select :'batch', 'staff', s.source_id,
       case when s.member_id is not null then 'duplicate' when d.decision is not null then 'skipped' else 'needs_review' end,
       case when s.member_id is not null then 'matched_member_by_email' when d.decision is not null then 'accepted_unassigned' else 'no_member_with_this_email' end,
       case when s.member_id is null and d.decision is null then 'No team member of LBS Command has this email. Invite the person first and run stage 20 again, or accept that what they owned in NOVA arrives unassigned.' end,
       case when s.member_id is not null then 'target' end, s.member_id::text, case when s.member_id is not null then array['email'] end
from map_staff s left join decisions d on d.tenant_id = :'tenant' and d.entity = 'staff' and d.source_id = s.source_id;

insert into outcomes (batch_id, entity, source_id, outcome, reason, field, matched_kind, matched_id, matched_on)
select :'batch', 'office', o.source_id,
       case when pg_temp.imported(:'tenant', 'office', o.source_id) then 'skipped' when o.existing_id is not null then 'duplicate' when btrim(o.name) = '' then 'invalid' else 'created' end,
       case when pg_temp.imported(:'tenant', 'office', o.source_id) then 'already_imported' when o.existing_id is not null then 'same_name_in_target' else '' end,
       case when o.existing_id is null and btrim(o.name) = '' then 'name' end,
       case when o.existing_id is not null then 'target' end, o.existing_id::text, case when o.existing_id is not null then array['name'] end
from map_offices o;

-- ---- clients ----
create temp table w_clients on commit drop as
select m.source_id, m.name, m.created_at, m.nova_needs_review, d.decision,
       pg_temp.imported(:'tenant', 'client', m.source_id) as already,
       pg_temp.sample_reason(m.source_id, concat_ws(' ', m.name, m.company), m.email, m.phone) as sample,
       pg_temp.bad_field(m.name, m.email, m.phone) as bad,
       app.norm_email(m.email) as e,
       case when length(app.norm_phone(m.phone)) >= 7 then app.norm_phone(m.phone) end as p,
       app.norm_name(m.name) as n,
       app.norm_name(nullif(m.address_key, '')) as a
from map_clients m left join decisions d on d.tenant_id = :'tenant' and d.entity = 'client' and d.source_id = m.source_id;

create temp table w_first on commit drop as
select w.*,
       case when w.already then 'already_imported'
            when w.decision = 'skip' then 'decided_skip'
            when w.sample is not null and w.decision is distinct from 'load' then w.sample end as skip_reason,
       null::text as stop
from w_clients w;
update w_first set stop = case when skip_reason is not null then 'skipped' when bad is not null then 'invalid'
                               when nova_needs_review and decision is distinct from 'load' then 'needs_review' end;

create temp table w_dups on commit drop as
with eligible as (select * from w_first where stop is null),
tgt as (
  select c.id, app.norm_email(c.email) as e, case when length(app.norm_phone(c.phone)) >= 7 then app.norm_phone(c.phone) end as p, app.norm_name(c.name) as n,
         (select array_agg(app.norm_name(ad)) from unnest(c.addresses) ad) as addrs
  from public.clients c where c.tenant_id = :'tenant' and not exists (select 1 from id_map i where i.target_table = 'clients' and i.target_id = c.id)
),
ranked as (
  select x.*,
         case when x.e is not null then first_value(x.source_id) over (partition by x.e order by x.created_at, x.source_id) end as first_e,
         case when x.p is not null then first_value(x.source_id) over (partition by x.p order by x.created_at, x.source_id) end as first_p,
         case when x.n is not null and x.a is not null then first_value(x.source_id) over (partition by x.n, x.a order by x.created_at, x.source_id) end as first_na
  from eligible x
)
select r.source_id,
       coalesce(t.kind, case when r.first_e <> r.source_id or r.first_p <> r.source_id or r.first_na <> r.source_id then 'source' end) as matched_kind,
       coalesce(t.id, case when r.first_e <> r.source_id then r.first_e when r.first_p <> r.source_id then r.first_p when r.first_na <> r.source_id then r.first_na end) as matched_id,
       coalesce(t.matched_on, case when r.first_e <> r.source_id then array['email'] when r.first_p <> r.source_id then array['phone'] when r.first_na <> r.source_id then array['name', 'address'] end) as matched_on,
       r.n
from ranked r
left join lateral (
  select 'target'::text as kind, x.id::text as id, x.matched_on from (
    select g.id, array['email'] as matched_on, 1 as rank from tgt g where r.e is not null and g.e = r.e
    union all select pp.client_id, array['contact_email'], 2 from public.client_people pp where r.e is not null and pp.tenant_id = :'tenant' and app.norm_email(pp.email) = r.e
    union all select g.id, array['phone'], 3 from tgt g where r.p is not null and g.p = r.p
    union all select g.id, array['name', 'address'], 4 from tgt g where r.n is not null and r.a is not null and g.n = r.n and r.a = any (g.addrs)
  ) x order by x.rank, x.id limit 1) t on true
where r.decision is distinct from 'load';

insert into outcomes (batch_id, entity, source_id, outcome, reason, field, question, matched_kind, matched_id, matched_on)
select :'batch', 'client', w.source_id,
       coalesce(w.stop, case when d.matched_id is not null then 'duplicate' else 'created' end),
       case when w.stop = 'skipped' then w.skip_reason
            when w.stop = 'invalid' then 'cannot_store_' || w.bad
            when w.stop = 'needs_review' then 'marked_for_review_in_nova'
            when d.matched_id is not null then 'same_' || array_to_string(d.matched_on, '_and_')
                 || case when d.matched_kind = 'source' and d.matched_on <> array['name', 'address']
                              and (select o.n from w_clients o where o.source_id = d.matched_id) is distinct from w.n then ':names_differ' else '' end
            when w.decision = 'load' then 'decided_load' else '' end,
       case when w.stop = 'invalid' then w.bad end,
       case when w.stop = 'needs_review' then 'NOVA marked this record for review when it was imported from Square. Is it a real client? Answer load or skip.'
            when w.stop is null and d.matched_id is not null then 'Same person or company as the matched record? Answer skip to keep one, or load to keep both (for example two relatives who share an email).' end,
       case when w.stop is null then d.matched_kind end, case when w.stop is null then d.matched_id end, case when w.stop is null then d.matched_on end
from w_first w left join w_dups d on d.source_id = w.source_id;

-- ---- children of a client ----
insert into outcomes (batch_id, entity, source_id, outcome, reason, field)
select :'batch', p.entity, p.source_id,
       case when pg_temp.imported(:'tenant', p.entity, p.source_id) then 'skipped' when st.s <> 'created' then 'skipped' when btrim(p.name) = '' then 'invalid' else 'created' end,
       case when pg_temp.imported(:'tenant', p.entity, p.source_id) then 'already_imported' when st.s <> 'created' then 'parent_' || st.s else '' end,
       case when st.s = 'created' and btrim(p.name) = '' and not pg_temp.imported(:'tenant', p.entity, p.source_id) then 'name' end
from map_client_people p cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', 'client', p.parent_id) as s) st;

-- ---- catalog ----
insert into outcomes (batch_id, entity, source_id, outcome, reason, field, matched_kind, matched_id, matched_on)
select :'batch', 'service', x.source_id,
       case when x.already then 'skipped' when x.decision = 'skip' then 'skipped' when x.sample is not null and x.decision is distinct from 'load' then 'skipped'
            when btrim(x.name) = '' then 'invalid' when x.dup_id is not null and x.decision is distinct from 'load' then 'duplicate' else 'created' end,
       case when x.already then 'already_imported' when x.decision = 'skip' then 'decided_skip' when x.sample is not null and x.decision is distinct from 'load' then x.sample
            when x.dup_id is not null and x.decision is distinct from 'load' then 'same_name' else '' end,
       case when not x.already and x.sample is null and btrim(x.name) = '' then 'name' end,
       case when not x.already and x.sample is null and x.decision is null and btrim(x.name) <> '' then x.dup_kind end,
       case when not x.already and x.sample is null and x.decision is null and btrim(x.name) <> '' then x.dup_id end,
       case when not x.already and x.sample is null and x.decision is null and btrim(x.name) <> '' and x.dup_id is not null then array['name'] end
from (
  select y.*, coalesce(y.tgt_id, case when y.first_src <> y.source_id then y.first_src end) as dup_id,
         case when y.tgt_id is not null then 'target' when y.first_src <> y.source_id then 'source' end as dup_kind
  from (
    select s.source_id, s.name, d.decision, pg_temp.imported(:'tenant', 'service', s.source_id) as already,
           coalesce((select 'sample:listed_id' from cfg_sample c where c.kind = 'recordIds' and c.value = s.source_id limit 1),
                    (select 'sample:listed_legacy_service' from cfg_sample c where c.kind = 'legacyServiceNames' and s.nova_source = 'legacy' and lower(c.value) = lower(s.name) limit 1),
                    (select 'sample:name_word:' || c.value from cfg_sample c where c.kind = 'nameWords' and s.name ~* ('\m' || c.value || '\M') limit 1)) as sample,
           (select t.id::text from public.catalog_services t where t.tenant_id = :'tenant' and lower(btrim(t.name)) = lower(s.name)
              and not exists (select 1 from id_map i where i.target_table = 'catalog_services' and i.target_id = t.id) limit 1) as tgt_id,
           first_value(s.source_id) over (partition by lower(s.name), (s.nova_source = 'legacy') order by s.created_at, s.source_id) as first_src
    from map_services s left join decisions d on d.tenant_id = :'tenant' and d.entity = 'service' and d.source_id = s.source_id
  ) y
) x;

insert into outcomes (batch_id, entity, source_id, outcome, reason, field)
select :'batch', t.entity, t.source_id,
       case when pg_temp.imported(:'tenant', t.entity, t.source_id) then 'skipped' when st.s <> 'created' then 'skipped' when t.nova_price_cents < 0 then 'invalid' else 'created' end,
       case when pg_temp.imported(:'tenant', t.entity, t.source_id) then 'already_imported' when st.s <> 'created' then 'parent_' || st.s else '' end,
       case when st.s = 'created' and t.nova_price_cents < 0 then 'price' end
from map_tiers t cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', 'service', t.parent_id) as s) st;

insert into outcomes (batch_id, entity, source_id, outcome, reason, field, matched_kind, matched_id, matched_on)
select :'batch', 'appointment_type', a.source_id,
       case when pg_temp.imported(:'tenant', 'appointment_type', a.source_id) then 'skipped' when a.existing_id is not null then 'duplicate'
            when a.minutes is null or a.minutes not between 5 and 1440 then 'invalid' when a.name ->> 'en' is null or a.name ->> 'es' is null or a.name ->> 'en' = '' then 'invalid' else 'created' end,
       case when pg_temp.imported(:'tenant', 'appointment_type', a.source_id) then 'already_imported' when a.existing_id is not null then 'same_type_in_target' else '' end,
       case when a.existing_id is null and (a.minutes is null or a.minutes not between 5 and 1440) then 'minutes'
            when a.existing_id is null and (a.name ->> 'en' is null or a.name ->> 'es' is null or a.name ->> 'en' = '') then 'name' end,
       case when a.existing_id is not null then 'target' end, a.existing_id::text, case when a.existing_id is not null then array['name'] end
from map_appointment_types a;

-- ---- leads ----
insert into outcomes (batch_id, entity, source_id, outcome, reason, field, question, matched_kind, matched_id, matched_on)
select :'batch', 'lead', x.source_id, x.outcome, x.reason, x.field, x.question,
       case when x.outcome = 'duplicate' then 'target' end, case when x.outcome = 'duplicate' then x.dup_id end, case when x.outcome = 'duplicate' then x.dup_on end
from (
  select y.*,
         case when y.already then 'skipped' when y.decision = 'skip' then 'skipped' when y.sample is not null and y.decision is distinct from 'load' then 'skipped'
              when y.parent is not null and y.parent <> 'created' then 'skipped'
              when y.bad = 'name' then 'invalid' when y.ticket_taken then 'invalid'
              when y.status is null or y.stage_kind is null then 'needs_review' when not y.source_ok then 'needs_review'
              when y.dup_id is not null and y.decision is distinct from 'load' then 'duplicate' else 'created' end as outcome,
         case when y.already then 'already_imported' when y.decision = 'skip' then 'decided_skip' when y.sample is not null and y.decision is distinct from 'load' then y.sample
              when y.parent is not null and y.parent <> 'created' then 'parent_' || y.parent
              when y.bad = 'name' then 'cannot_store_name' when y.ticket_taken then 'ticket_taken'
              when y.status is null or y.stage_kind is null then 'stage_not_configured' when not y.source_ok then 'source_not_configured'
              when y.dup_id is not null and y.decision is distinct from 'load' then 'same_' || array_to_string(y.dup_on, '_and_')
              when y.source_unmapped then 'source_unmapped_kept_as_other' else '' end as reason,
         case when not y.already and y.sample is null and y.bad = 'name' then 'name' when not y.already and y.sample is null and y.ticket_taken then 'ticket' end as field,
         case when y.status is null or y.stage_kind is null then 'This lead is in a NOVA stage that the company has no stage for. Add the stage in Settings or tell us which stage to use.'
              when not y.source_ok then 'The lead source is not one of the company''s sources. Add it in Settings or accept "other".' end as question
  from (
    select l.source_id, l.status, l.source_unmapped, d.decision,
           pg_temp.imported(:'tenant', 'lead', l.source_id) as already,
           case when l.open_lead then pg_temp.sample_reason(l.source_id, concat_ws(' ', l.name, l.company), l.email, l.phone) end as sample,
           case when not l.open_lead then pg_temp.parent_state(:'batch', :'tenant', 'client', l.client_source_id) end as parent,
           pg_temp.bad_field(l.name, '', '') as bad,
           app.stage_kind(:'tenant', l.status) as stage_kind,
           l.source = any (app.tenant_sources(:'tenant')) as source_ok,
           exists (select 1 from public.leads t where t.tenant_id = :'tenant' and t.ticket = l.ticket) as ticket_taken,
           case when l.open_lead then dup.id end as dup_id, dup.matched_on as dup_on
    from map_leads l
    left join decisions d on d.tenant_id = :'tenant' and d.entity = 'lead' and d.source_id = l.source_id
    left join lateral (
      select t.id::text as id, case when app.norm_email(l.email) is not null and app.norm_email(t.email) = app.norm_email(l.email) then array['email'] else array['phone'] end as matched_on
      from public.leads t
      where t.tenant_id = :'tenant' and not exists (select 1 from id_map i where i.target_table = 'leads' and i.target_id = t.id)
        and ((app.norm_email(l.email) is not null and app.norm_email(t.email) = app.norm_email(l.email))
          or (length(app.norm_phone(l.phone)) >= 7 and app.norm_phone(t.phone) = app.norm_phone(l.phone)))
      order by t.created_at limit 1) dup on true
  ) y
) x;

insert into outcomes (batch_id, entity, source_id, outcome, reason)
select :'batch', 'handoff', h.source_id,
       case when pg_temp.imported(:'tenant', 'handoff', h.source_id) then 'skipped' when st.s <> 'created' then 'skipped' else 'created' end,
       case when pg_temp.imported(:'tenant', 'handoff', h.source_id) then 'already_imported' when st.s <> 'created' then 'parent_' || st.s else '' end
from map_handoffs h cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', 'lead', h.parent_id) as s) st;

insert into outcomes (batch_id, entity, source_id, outcome, reason)
select :'batch', n.entity, n.source_id,
       case when pg_temp.imported(:'tenant', n.entity, n.source_id) then 'skipped' when st.s <> 'created' then 'skipped' else 'created' end,
       case when pg_temp.imported(:'tenant', n.entity, n.source_id) then 'already_imported' when st.s <> 'created' then 'parent_' || st.s else '' end
from map_notes n cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', n.parent_type, n.parent_id) as s) st;

insert into outcomes (batch_id, entity, source_id, outcome, reason)
select :'batch', 'lead_activity', a.source_id,
       case when pg_temp.imported(:'tenant', 'lead_activity', a.source_id) then 'skipped' when a.nova_type = 'assignment' then 'skipped' when a.kind is null then 'skipped'
            when st.s <> 'created' then 'skipped' else 'created' end,
       case when pg_temp.imported(:'tenant', 'lead_activity', a.source_id) then 'already_imported' when a.nova_type = 'assignment' then 'recorded_as_handoff'
            when a.kind is null then 'no_equivalent_entry' when st.s <> 'created' then 'parent_' || st.s else '' end
from map_activity a cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', 'lead', a.parent_id) as s) st;

-- ---- invoices and payments: the audit found only the demo firm's rows. Anything else waits for the owner. ----
insert into outcomes (batch_id, entity, source_id, outcome, reason, question)
select :'batch', 'invoice', i.id::text,
       case when st.s = 'skipped' then 'skipped' else 'needs_review' end,
       case when st.s = 'skipped' then 'parent_skipped' else 'no_place_without_an_engagement' end,
       case when st.s <> 'skipped' then 'An invoice in the new platform belongs to an engagement. Should this NOVA invoice be re-entered under an engagement, or left in NOVA as history?' end
from src_invoices i cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', 'client', i.client_id::text) as s) st;
insert into outcomes (batch_id, entity, source_id, outcome, reason, question)
select :'batch', 'payment', p.id::text,
       case when st.s = 'skipped' then 'skipped' else 'needs_review' end,
       case when st.s = 'skipped' then 'parent_skipped' else 'no_place_without_an_engagement' end,
       case when st.s <> 'skipped' then 'A payment in the new platform belongs to an engagement. Should this NOVA payment be re-entered under an engagement, or left in NOVA as history?' end
from src_payments p cross join lateral (select pg_temp.parent_state(:'batch', :'tenant', 'client', p.client_id::text) as s) st;

grant select on migrate.cfg_sample to service_role;
update batches set dry_run_at = null, dry_run_hash = null, plan_hash = null where id = :'batch';
commit;

select jsonb_build_object(
  'totals', (select jsonb_object_agg(entity, per) from (
      select entity, jsonb_object_agg(outcome, n) as per from (select entity, outcome, count(*) n from migrate.outcomes where batch_id = :'batch' group by 1, 2) a group by 1) b),
  'reasons', (select jsonb_agg(jsonb_build_object('entity', entity, 'outcome', outcome, 'reason', reason, 'rows', n) order by entity, outcome, reason) from (
      select entity, outcome, regexp_replace(reason, '^(sample:[a-z_]+).*$', '\1') as reason, count(*) n from migrate.outcomes where batch_id = :'batch' group by 1, 2, 3) c),
  'clientsWithoutOffice', (select count(*) from migrate.map_clients m join migrate.outcomes o on o.batch_id = :'batch' and o.entity = 'client' and o.source_id = m.source_id and o.outcome = 'created' where m.office_source_id is null),
  'clientsCreated', (select count(*) from migrate.outcomes where batch_id = :'batch' and entity = 'client' and outcome = 'created'));
