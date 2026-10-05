-- The needs-review list: every record a person has to look at, with its values in full. This is the one output of the
-- tool that shows personal data, which is why the file is written with owner-only permissions and must never be
-- committed or emailed. Variables: batch.
select coalesce(jsonb_agg(to_jsonb(r) order by r.entity, r.outcome, r.reason, r.source_id), '[]'::jsonb) from (
  select o.entity, o.source_id, o.outcome, o.reason, o.field, o.question,
         coalesce(mc.name, ml.name, ms.name, pp.name, st.full_name) as name, coalesce(mc.company, ml.company) as company,
         coalesce(sc.email, st.email, pp.email) as email, coalesce(sc.phone, pp.phone) as phone,
         coalesce(inv.number, pay.reference) as reference, coalesce(inv.amount_cents, pay.amount_cents) as amount_cents,
         o.matched_kind, o.matched_id, array_to_string(o.matched_on, '+') as matched_on,
         coalesce(xs.name, xt.name, xsv.name, xtv.name) as matched_name, coalesce(xsrc.email, xt.email) as matched_email, coalesce(xsrc.phone, xt.phone) as matched_phone,
         ''::text as decision
  from migrate.outcomes o
  left join migrate.map_clients mc on o.entity = 'client' and mc.source_id = o.source_id
  left join migrate.map_leads ml on o.entity = 'lead' and ml.source_id = o.source_id
  left join migrate.map_services ms on o.entity = 'service' and ms.source_id = o.source_id
  left join migrate.map_client_people pp on o.entity = pp.entity and pp.source_id = o.source_id
  left join migrate.src_profiles st on o.entity = 'staff' and st.id::text = o.source_id
  left join migrate.src_clients sc on o.entity in ('client', 'lead') and sc.id::text = o.source_id
  left join migrate.src_invoices inv on o.entity = 'invoice' and inv.id::text = o.source_id
  left join migrate.src_payments pay on o.entity = 'payment' and pay.id::text = o.source_id
  left join migrate.map_clients xs on o.entity = 'client' and o.matched_kind = 'source' and xs.source_id = o.matched_id
  left join migrate.src_clients xsrc on o.entity = 'client' and o.matched_kind = 'source' and xsrc.id::text = o.matched_id
  left join public.clients xt on o.entity = 'client' and o.matched_kind = 'target' and xt.id::text = o.matched_id
  left join migrate.map_services xsv on o.entity = 'service' and o.matched_kind = 'source' and xsv.source_id = o.matched_id
  left join public.catalog_services xtv on o.entity = 'service' and o.matched_kind = 'target' and xtv.id::text = o.matched_id
  where o.batch_id = :'batch'
    and (o.outcome in ('needs_review', 'invalid') or (o.outcome = 'duplicate' and o.entity in ('client', 'lead', 'service'))
      or (o.outcome = 'skipped' and o.reason like 'sample:%'))
) r;
