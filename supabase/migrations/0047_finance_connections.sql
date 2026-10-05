-- 0047 Finance connections: Square and QuickBooks Online (the brief, sections 25, 26, 79, 89 and 90)
-- What the two adapters (api/_lib/integrations/providers/square.js, quickbooks.js) keep, and the rules they cannot break.
--
--   finance_links     one row per object of a connected system and the local record it belongs to (or is proposed
--                     for). A sync writes proposals here and nothing else. The local record gets the id only through
--                     fin_links_apply, which fills an empty slot and never replaces a value.
--   finance_payments  the ledger of money a connected system reported: one row per provider payment and per refund,
--                     unique by the provider's id. A repeat inserts nothing and changes nothing. A matched payment is
--                     applied to its appointment or engagement in the same transaction, from sums the database
--                     computes itself.
--   finance_intents   provider orders this platform created for one record (a payment link).
--   finance_sync_log  append only: every write to a connected system, and every refusal and conflict.
--
-- Money is numeric(12,2) at rest. The server sends and receives whole cents (bigint); app.fin_cents and
-- app.fin_amount convert exactly. No card data has a column anywhere here.
-- The four tables are server tables (schema app, no policy, no privilege): reached through the functions below.
-- Those are SECURITY DEFINER because they write things no person writes directly (a provider payment, the payment
-- of an appointment, an id of a connected system) and because webhooks and jobs run with nobody signed in.

create or replace function app.fin_cents(p numeric) returns bigint
language sql immutable
set search_path = ''
as $$ select (pg_catalog.round(p, 2) * 100)::bigint $$;

create or replace function app.fin_amount(p bigint) returns numeric
language sql immutable
set search_path = ''
as $$ select (p::numeric / 100)::numeric(12,2) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- finance_links
-- ---------------------------------------------------------------------------------------------------------------------
create table app.finance_links (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  provider      text not null check (provider in ('square', 'quickbooks')),
  kind          text not null check (kind in ('customer', 'service', 'tier', 'invoice', 'payment')),
  -- The provider's id. NULL only while a person has approved creating the object and it does not exist there yet.
  external_id   text check (pg_catalog.length(external_id) between 1 and 192),
  -- The local record, one column per kind so each is a real foreign key.
  client_id     uuid,
  service_id    uuid,
  tier_id       uuid,
  job_id        uuid,
  payment_id    uuid,
  state         text not null check (state in ('proposed', 'approved', 'created', 'linked', 'needs_review', 'unlinked', 'conflict')),
  rule          text not null default 'none' check (rule ~ '^[a-z][a-z_]{1,40}$'),
  -- Names of the fields that differ between the two sides. Never their values.
  differences   text[] not null default '{}'::text[] check (pg_catalog.cardinality(differences) <= 20),
  -- QuickBooks: the version this platform last wrote or read. An update goes out with exactly this value.
  sync_token    text check (pg_catalog.length(sync_token) <= 64),
  -- A hash of what was last sent, to know whether the local figures changed since.
  hash          text check (hash ~ '^[0-9a-f]{64}$'),
  -- For an item nobody has locally: its name and prices, for a person to approve as a new service.
  proposal      jsonb check (proposal is null or pg_catalog.pg_column_size(proposal) < 8192),
  applied_at    timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint finance_links_one_local check (pg_catalog.num_nonnulls(client_id, service_id, tier_id, job_id, payment_id) <= 1),
  constraint finance_links_local_kind check (
    (client_id is null or kind = 'customer') and (service_id is null or kind = 'service') and (tier_id is null or kind = 'tier')
    and (job_id is null or kind = 'invoice') and (payment_id is null or kind = 'payment')),
  constraint finance_links_approved_shape check (external_id is not null or state = 'approved'),
  constraint finance_links_extra_shape check (pg_catalog.jsonb_typeof(extra) = 'object' and pg_catalog.octet_length(extra::text) <= 65536),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.catalog_services (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tier_id) references public.catalog_tiers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, payment_id) references public.client_payments (tenant_id, id) on delete cascade
);
create unique index finance_links_external_uidx on app.finance_links (tenant_id, provider, kind, external_id) where external_id is not null;
create unique index finance_links_pending_uidx on app.finance_links (tenant_id, provider, kind, client_id) where external_id is null;
create index finance_links_client_idx on app.finance_links (tenant_id, client_id);
create index finance_links_service_idx on app.finance_links (tenant_id, service_id);
create index finance_links_tier_idx on app.finance_links (tenant_id, tier_id);
create index finance_links_job_idx on app.finance_links (tenant_id, job_id);
create index finance_links_payment_idx on app.finance_links (tenant_id, payment_id);
create index finance_links_state_idx on app.finance_links (tenant_id, provider, kind, state);

-- ---------------------------------------------------------------------------------------------------------------------
-- finance_payments: the ledger
-- ---------------------------------------------------------------------------------------------------------------------
create table app.finance_payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  provider            text not null check (provider in ('square', 'quickbooks')),
  entry               text not null check (entry in ('payment', 'refund')),
  -- The provider's payment id or refund id. With the provider and the kind of entry: the unique reference.
  external_id         text not null check (pg_catalog.length(external_id) between 1 and 192),
  -- A refund: the provider's id of the payment it takes from.
  parent_external_id  text check (pg_catalog.length(parent_external_id) between 1 and 192),
  amount              numeric(12,2) not null check (amount > 0),
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  status              text not null check (status in ('matched', 'unmatched', 'ambiguous', 'recorded')),
  rule                text check (rule ~ '^[a-z][a-z_]{1,40}$'),
  reason              text check (reason ~ '^[a-z][a-z_]{1,40}$'),
  appointment_id      uuid,
  job_id              uuid,
  -- The local client linked to the payer, when there is one.
  client_id           uuid,
  -- The row this payment created on an engagement.
  client_payment_id   uuid,
  -- Ambiguous: the records a person chooses between, as [{ "kind", "id" }].
  candidates          jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(candidates) = 'array' and pg_catalog.pg_column_size(candidates) < 8192),
  occurred_at         timestamptz,
  -- The webhook event that brought it (app.webhook_events.event_id), or NULL for a scheduled run.
  source_event        text check (pg_catalog.length(source_event) <= 200),
  assigned_by         uuid,
  assigned_at         timestamptz,
  extra               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, entry, external_id),
  constraint finance_payments_one_context check (appointment_id is null or job_id is null),
  constraint finance_payments_matched_has_context check (status <> 'matched' or appointment_id is not null or job_id is not null),
  constraint finance_payments_refund_shape check ((entry = 'refund') = (parent_external_id is not null)),
  constraint finance_payments_extra_shape check (pg_catalog.jsonb_typeof(extra) = 'object' and pg_catalog.octet_length(extra::text) <= 65536),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete restrict,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete restrict,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, client_payment_id) references public.client_payments (tenant_id, id) on delete set null (client_payment_id),
  foreign key (tenant_id, assigned_by) references public.tenant_members (tenant_id, id) on delete set null (assigned_by)
);
create index finance_payments_appointment_idx on app.finance_payments (tenant_id, appointment_id);
create index finance_payments_job_idx on app.finance_payments (tenant_id, job_id);
create index finance_payments_client_idx on app.finance_payments (tenant_id, client_id);
create index finance_payments_client_payment_idx on app.finance_payments (tenant_id, client_payment_id);
create index finance_payments_assigned_idx on app.finance_payments (tenant_id, assigned_by);
create index finance_payments_open_idx on app.finance_payments (tenant_id, status, created_at desc) where status in ('unmatched', 'ambiguous');
create index finance_payments_parent_idx on app.finance_payments (tenant_id, provider, parent_external_id) where parent_external_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- finance_intents and finance_sync_log
-- ---------------------------------------------------------------------------------------------------------------------
create table app.finance_intents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  provider        text not null check (provider in ('square', 'quickbooks')),
  order_id        text not null check (pg_catalog.length(order_id) between 1 and 192),
  link_id         text check (pg_catalog.length(link_id) <= 192),
  appointment_id  uuid,
  job_id          uuid,
  amount          numeric(12,2) not null check (amount > 0),
  extra           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, order_id),
  constraint finance_intents_one_context check (pg_catalog.num_nonnulls(appointment_id, job_id) = 1),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade
);
create index finance_intents_appointment_idx on app.finance_intents (tenant_id, appointment_id);
create index finance_intents_job_idx on app.finance_intents (tenant_id, job_id);

create table app.finance_sync_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  provider     text not null check (provider in ('square', 'quickbooks')),
  direction    text not null check (direction in ('in', 'out')),
  action       text not null check (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  entity       text not null check (entity ~ '^[a-z][a-z_]{1,40}$'),
  local_id     uuid,
  external_id  text check (pg_catalog.length(external_id) <= 192),
  -- The idempotency key or request id sent to the provider with the write.
  request_id   text check (pg_catalog.length(request_id) <= 200),
  outcome      text not null check (outcome in ('ok', 'refused', 'conflict', 'failed')),
  code         text check (code ~ '^[a-z][a-z0-9_.]{1,60}$'),
  at           timestamptz not null default now()
);
create index finance_sync_log_tenant_idx on app.finance_sync_log (tenant_id, at desc);

do $tables$
declare t text;
begin
  foreach t in array array['finance_links', 'finance_payments', 'finance_intents', 'finance_sync_log'] loop
    execute pg_catalog.format('alter table app.%I enable row level security', t);
    execute pg_catalog.format('alter table app.%I force row level security', t);
    execute pg_catalog.format('revoke all on app.%I from public, anon, authenticated, service_role', t);
  end loop;
  foreach t in array array['finance_links', 'finance_payments', 'finance_intents'] loop
    execute pg_catalog.format('create trigger %I before update on app.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute pg_catalog.format('create trigger %I before update on app.%I for each row execute function app.tenant_id_immutable()', t || '_tenant_fixed', t);
  end loop;
end
$tables$;

-- The ledger and the log are evidence. For every caller, the server key included:
--   a ledger row keeps its provider, kind, id, amount and currency for ever and is never deleted;
--   a log row is never changed or deleted.
create or replace function app.finance_evidence_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'finance_sync_log' or tg_op = 'DELETE' then
    raise exception 'append only' using errcode = '23514', constraint = 'finance_append_only';
  end if;
  if new.provider is distinct from old.provider or new.entry is distinct from old.entry or new.external_id is distinct from old.external_id
     or new.amount is distinct from old.amount or new.currency is distinct from old.currency or new.parent_external_id is distinct from old.parent_external_id then
    raise exception 'append only' using errcode = '23514', constraint = 'finance_append_only';
  end if;
  return new;
end
$$;
create trigger finance_payments_evidence before update or delete on app.finance_payments for each row execute function app.finance_evidence_guard();
create trigger finance_sync_log_evidence before update or delete on app.finance_sync_log for each row execute function app.finance_evidence_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- Reading: what the adapters need to match, and nothing more
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.fin_clients(p_tenant uuid, p_provider text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'external_id', c.external_ids ->> p_provider) order by c.id), '[]'::jsonb)
  from public.clients c where c.tenant_id = p_tenant
$$;

create or replace function public.fin_services(p_tenant uuid, p_provider text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'name', s.name, 'active', s.active, 'external_id', s.external_ids ->> p_provider,
    'tiers', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', t.id, 'name', t.name, 'price_cents', app.fin_cents(t.price), 'external_id', t.external_ids ->> p_provider) order by t.position, t.id), '[]'::jsonb)
              from public.catalog_tiers t where t.tenant_id = p_tenant and t.service_id = s.id)) order by s.id), '[]'::jsonb)
  from public.catalog_services s where s.tenant_id = p_tenant
$$;

-- What one record is owed and what it has received, in cents. NULL when the record is not there.
--   appointment  due = fee. received = what a person took for it (at most the fee) when that was not recorded from
--                the ledger, plus the ledger's payments for it, minus the ledger's refunds.
--   job          due = price. received = its payments (the ledger's are among them), minus the ledger's refunds.
create or replace function app.fin_context(p_tenant uuid, p_kind text, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'appointment' then (
      select pg_catalog.jsonb_build_object('kind', 'appointment', 'id', a.id, 'client_id', a.client_id, 'currency', 'USD',
        'open', a.status in ('requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed'),
        'due_cents', app.fin_cents(a.fee),
        'paid_cents', app.fin_cents(
          case when a.paid_at is not null and coalesce(a.paid_ref, '') !~ '^(square|quickbooks):' then least(a.paid_amount, a.fee) else 0 end
          + coalesce((select pg_catalog.sum(case when p.entry = 'payment' then p.amount else -p.amount end) from app.finance_payments p
                      where p.tenant_id = p_tenant and p.appointment_id = a.id and p.status in ('matched', 'recorded')), 0)))
      from public.appointments a where a.tenant_id = p_tenant and a.id = p_id)
    when 'job' then (
      select pg_catalog.jsonb_build_object('kind', 'job', 'id', j.id, 'client_id', j.client_id, 'currency', 'USD', 'open', true,
        'due_cents', app.fin_cents(j.price),
        'paid_cents', app.fin_cents(
          coalesce((select pg_catalog.sum(cp.amount) from public.client_payments cp where cp.tenant_id = p_tenant and cp.job_id = j.id), 0)
          - coalesce((select pg_catalog.sum(p.amount) from app.finance_payments p
                      where p.tenant_id = p_tenant and p.job_id = j.id and p.entry = 'refund' and p.status = 'recorded'), 0)))
      from public.jobs j where j.tenant_id = p_tenant and j.id = p_id)
  end
$$;

create or replace function public.fin_context(p_tenant uuid, p_kind text, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select app.fin_context(p_tenant, p_kind, p_id) $$;

-- The records a payment could belong to: the ones its references and its order name, and the open records of the
-- client linked to the payer that still owe something.
create or replace function public.fin_candidates(p_tenant uuid, p_provider text, p_refs jsonb default '[]'::jsonb, p_order_id text default null, p_customer_id text default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_intents jsonb;
  v_contexts jsonb;
begin
  if p_customer_id is not null then
    select c.id into v_client from public.clients c where c.tenant_id = p_tenant and c.external_ids ->> p_provider = p_customer_id;
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('order_id', i.order_id, 'kind', case when i.appointment_id is not null then 'appointment' else 'job' end, 'id', coalesce(i.appointment_id, i.job_id))), '[]'::jsonb)
    into v_intents from app.finance_intents i where i.tenant_id = p_tenant and i.provider = p_provider and p_order_id is not null and i.order_id = p_order_id;
  with wanted as (
    select r ->> 'kind' as kind, (r ->> 'id')::uuid as id
    from pg_catalog.jsonb_array_elements(coalesce(p_refs, '[]'::jsonb) || v_intents) r
    where r ->> 'kind' in ('appointment', 'job') and r ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select 'appointment', x.id from (select a.id from public.appointments a
      where v_client is not null and a.tenant_id = p_tenant and a.client_id = v_client and a.fee > 0
        and a.status in ('requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed') order by a.date desc limit 50) x
    union
    select 'job', x.id from (select j.id from public.jobs j
      where v_client is not null and j.tenant_id = p_tenant and j.client_id = v_client and j.price > 0 order by j.created desc limit 50) x
  )
  select coalesce(pg_catalog.jsonb_agg(c.ctx), '[]'::jsonb) into v_contexts
  from (select app.fin_context(p_tenant, w.kind, w.id) as ctx from wanted w) c where c.ctx is not null;
  return pg_catalog.jsonb_build_object('currency', 'USD', 'client_id', v_client, 'intents', v_intents, 'contexts', v_contexts);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Links
-- ---------------------------------------------------------------------------------------------------------------------
-- Writes a proposal, a state or a version for one provider object. Touches app.finance_links only.
-- A link a person or an apply already settled is not put back to "proposed" by a later sync.
create or replace function public.fin_link_put(
  p_tenant uuid, p_provider text, p_kind text, p_external_id text, p_local_id uuid, p_state text, p_rule text default 'none',
  p_differences text[] default '{}'::text[], p_sync_token text default null, p_hash text default null, p_proposal jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_fresh boolean := false;
begin
  if p_external_id is null or p_state = 'approved' then raise exception 'invalid' using errcode = '22023'; end if;
  select l.id into v_id from app.finance_links l
   where l.tenant_id = p_tenant and l.provider = p_provider and l.kind = p_kind and l.external_id = p_external_id for update;
  if v_id is null and p_kind = 'customer' and p_local_id is not null then
    -- the approval a person gave for creating this customer becomes the link
    select l.id into v_id from app.finance_links l
     where l.tenant_id = p_tenant and l.provider = p_provider and l.kind = 'customer' and l.external_id is null and l.client_id = p_local_id for update;
  end if;
  if v_id is null then
    insert into app.finance_links (tenant_id, provider, kind, external_id, client_id, service_id, tier_id, job_id, payment_id, state, rule, differences, sync_token, hash, proposal)
    values (p_tenant, p_provider, p_kind, p_external_id,
            case when p_kind = 'customer' then p_local_id end, case when p_kind = 'service' then p_local_id end, case when p_kind = 'tier' then p_local_id end,
            case when p_kind = 'invoice' then p_local_id end, case when p_kind = 'payment' then p_local_id end,
            p_state, coalesce(p_rule, 'none'), coalesce(p_differences, '{}'::text[]), p_sync_token, p_hash, p_proposal)
    returning id into v_id;
    v_fresh := true;
  else
    update app.finance_links l
       set external_id = p_external_id,
           client_id = case when p_kind = 'customer' then coalesce(p_local_id, l.client_id) else l.client_id end,
           service_id = case when p_kind = 'service' then coalesce(p_local_id, l.service_id) else l.service_id end,
           tier_id = case when p_kind = 'tier' then coalesce(p_local_id, l.tier_id) else l.tier_id end,
           job_id = case when p_kind = 'invoice' then coalesce(p_local_id, l.job_id) else l.job_id end,
           payment_id = case when p_kind = 'payment' then coalesce(p_local_id, l.payment_id) else l.payment_id end,
           state = case when l.applied_at is not null and p_state = 'proposed' then l.state else p_state end,
           rule = case when l.applied_at is not null and p_state = 'proposed' then l.rule else coalesce(p_rule, 'none') end,
           differences = coalesce(p_differences, '{}'::text[]),
           sync_token = coalesce(p_sync_token, l.sync_token), hash = coalesce(p_hash, l.hash), proposal = coalesce(p_proposal, l.proposal)
     where l.id = v_id;
  end if;
  return pg_catalog.jsonb_build_object('fresh', v_fresh, 'id', v_id);
end
$$;

create or replace function public.fin_link_get(p_tenant uuid, p_provider text, p_kind text, p_local_id uuid default null, p_external_id text default null) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('external_id', l.external_id, 'local_id', coalesce(l.client_id, l.service_id, l.tier_id, l.job_id, l.payment_id),
                                       'state', l.state, 'rule', l.rule, 'sync_token', l.sync_token, 'hash', l.hash)
  from app.finance_links l
  where l.tenant_id = p_tenant and l.provider = p_provider and l.kind = p_kind and l.external_id is not null
    and ((p_external_id is not null and l.external_id = p_external_id)
      or (p_external_id is null and p_local_id is not null and coalesce(l.client_id, l.service_id, l.tier_id, l.job_id, l.payment_id) = p_local_id))
  order by l.created_at limit 1
$$;

-- Writes the provider's id onto the local record for links in the given states. Insert only in spirit: the slot must
-- be empty and the id must not be on another record; otherwise the link goes to a person and nothing is written.
-- No name, email, phone or price is ever copied.
create or replace function public.fin_links_apply(p_tenant uuid, p_provider text, p_kind text, p_states text[] default array['proposed']) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  l record;
  v_done integer := 0;
  v_rows integer;
  v_patch jsonb;
begin
  if p_kind not in ('customer', 'service', 'tier') or p_provider not in ('square', 'quickbooks') or not (p_states <@ array['proposed', 'created']) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  for l in
    select * from app.finance_links x
     where x.tenant_id = p_tenant and x.provider = p_provider and x.kind = p_kind and x.applied_at is null and x.external_id is not null
       and x.state = any (p_states) and coalesce(x.client_id, x.service_id, x.tier_id) is not null
     order by x.created_at, x.id for update
  loop
    v_patch := pg_catalog.jsonb_build_object(p_provider, l.external_id);
    v_rows := 0;
    begin
      if p_kind = 'customer' then
        update public.clients c set external_ids = coalesce(c.external_ids, '{}'::jsonb) || v_patch
         where c.tenant_id = p_tenant and c.id = l.client_id and c.external_ids ->> p_provider is null;
      elsif p_kind = 'service' then
        update public.catalog_services c set external_ids = coalesce(c.external_ids, '{}'::jsonb) || v_patch
         where c.tenant_id = p_tenant and c.id = l.service_id and c.external_ids ->> p_provider is null
           and not exists (select 1 from public.catalog_services o where o.tenant_id = p_tenant and o.external_ids ->> p_provider = l.external_id);
      else
        update public.catalog_tiers c set external_ids = coalesce(c.external_ids, '{}'::jsonb) || v_patch
         where c.tenant_id = p_tenant and c.id = l.tier_id and c.external_ids ->> p_provider is null
           and not exists (select 1 from public.catalog_tiers o where o.tenant_id = p_tenant and o.external_ids ->> p_provider = l.external_id);
      end if;
      get diagnostics v_rows = row_count;
    exception when unique_violation then
      -- the same provider customer is already on another client (the unique index of 0012)
      v_rows := 0;
    end;
    if v_rows = 1 then
      update app.finance_links x set applied_at = pg_catalog.now(), state = case when pg_catalog.cardinality(x.differences) > 0 then 'needs_review' else 'linked' end where x.id = l.id;
      v_done := v_done + 1;
    else
      update app.finance_links x set state = 'needs_review', rule = 'already_linked' where x.id = l.id;
    end if;
  end loop;
  if v_done > 0 then
    perform app.audit_write(p_tenant, 'finance.links_applied', 'finance_links', null, null,
      pg_catalog.jsonb_build_object('provider', p_provider, 'kind', p_kind, 'count', v_done));
  end if;
  return v_done;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The ledger: recording and applying
-- ---------------------------------------------------------------------------------------------------------------------
-- Applies one matched ledger payment to its record. Locks the record, computes what it had received WITHOUT this
-- payment from the tables, and only then writes. A record that is closed or already paid in full is not touched:
-- the payment goes back to the unmatched list with the reason. Internal.
create or replace function app.fin_apply(p_tenant uuid, p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r app.finance_payments%rowtype;
  a public.appointments%rowtype;
  j public.jobs%rowtype;
  v_ref text;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_cp uuid;
  v_why text;
begin
  select * into r from app.finance_payments p where p.tenant_id = p_tenant and p.id = p_id for update;
  if not found or r.entry <> 'payment' or r.status <> 'matched' then raise exception 'invalid' using errcode = '22023'; end if;
  v_ref := r.provider || ':' || r.external_id;
  if r.appointment_id is not null then
    select * into a from public.appointments x where x.tenant_id = p_tenant and x.id = r.appointment_id for update;
    v_before := case when a.paid_at is not null and coalesce(a.paid_ref, '') !~ '^(square|quickbooks):' then least(a.paid_amount, a.fee) else 0 end
      + coalesce((select pg_catalog.sum(case when p.entry = 'payment' then p.amount else -p.amount end) from app.finance_payments p
                  where p.tenant_id = p_tenant and p.appointment_id = a.id and p.status in ('matched', 'recorded') and p.id <> r.id), 0);
    if a.status not in ('requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed') then v_why := 'context_closed';
    elsif v_before >= a.fee then v_why := 'already_settled';
    end if;
    if v_why is null then
      v_after := v_before + r.amount;
      if v_after >= a.fee and a.paid_at is null then
        update public.appointments x
           set paid_at = pg_catalog.now(), paid_method = 'card', paid_ref = v_ref, paid_amount = v_after,
               status = case when x.status in ('awaiting_payment', 'scheduled') then 'confirmed' else x.status end
         where x.tenant_id = p_tenant and x.id = a.id;
        -- more than the fee is the client's, as a credit (the rule of appt_mark_paid)
        if v_after > a.fee and a.client_id is not null then
          perform app.credit_write(p_tenant, a.client_id, v_after - a.fee, 'overpayment', a.id, null, app.credit_expiry(p_tenant));
        end if;
      end if;
      perform app.audit_write(p_tenant, 'finance.payment_applied', 'appointments', a.id, null,
        pg_catalog.jsonb_build_object('provider', r.provider, 'reference', v_ref, 'rule', r.rule, 'settled', v_after >= a.fee));
      return pg_catalog.jsonb_build_object('applied', true, 'balance_cents', app.fin_cents(greatest(a.fee - v_after, 0)), 'settled', v_after >= a.fee);
    end if;
  else
    select * into j from public.jobs x where x.tenant_id = p_tenant and x.id = r.job_id for update;
    v_before := coalesce((select pg_catalog.sum(cp.amount) from public.client_payments cp where cp.tenant_id = p_tenant and cp.job_id = j.id), 0)
      - coalesce((select pg_catalog.sum(p.amount) from app.finance_payments p where p.tenant_id = p_tenant and p.job_id = j.id and p.entry = 'refund' and p.status = 'recorded'), 0);
    if v_before >= j.price then v_why := 'already_settled'; end if;
    if v_why is null then
      v_after := v_before + r.amount;
      insert into public.client_payments (tenant_id, job_id, date, method, ref, amount)
      values (p_tenant, j.id, coalesce((r.occurred_at at time zone 'UTC')::date, current_date), 'card', v_ref, r.amount)
      returning id into v_cp;
      update app.finance_payments p set client_payment_id = v_cp where p.id = r.id;
      perform app.audit_write(p_tenant, 'finance.payment_applied', 'jobs', j.id, null,
        pg_catalog.jsonb_build_object('provider', r.provider, 'reference', v_ref, 'rule', r.rule, 'settled', v_after >= j.price));
      return pg_catalog.jsonb_build_object('applied', true, 'balance_cents', app.fin_cents(greatest(j.price - v_after, 0)), 'settled', v_after >= j.price);
    end if;
  end if;
  update app.finance_payments p set status = 'unmatched', rule = null, reason = v_why, appointment_id = null, job_id = null,
         candidates = pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind', case when r.appointment_id is not null then 'appointment' else 'job' end, 'id', coalesce(r.appointment_id, r.job_id)))
   where p.id = r.id;
  return pg_catalog.jsonb_build_object('applied', false, 'reason', v_why);
end
$$;

-- Records a provider payment ONCE (unique by provider and payment id) and, when the rules matched it, applies it.
-- A repeat answers { fresh: false } and changes nothing. Amounts arrive in whole cents.
create or replace function public.fin_payment_record(
  p_tenant uuid, p_provider text, p_external_id text, p_cents bigint, p_currency text, p_occurred_at timestamptz, p_status text,
  p_rule text default null, p_reason text default null, p_kind text default null, p_context_id uuid default null, p_client uuid default null,
  p_candidates jsonb default '[]'::jsonb, p_event text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_kind text;
  v_ctx uuid;
  v_out jsonb;
begin
  if p_cents is null or p_cents <= 0 or p_cents > 999999999999 or p_status not in ('matched', 'unmatched', 'ambiguous')
     or (p_status = 'matched' and (p_kind is null or p_kind not in ('appointment', 'job') or p_context_id is null)) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into app.finance_payments (tenant_id, provider, entry, external_id, amount, currency, status, rule, reason, appointment_id, job_id, client_id, candidates, occurred_at, source_event)
  values (p_tenant, p_provider, 'payment', p_external_id, app.fin_amount(p_cents), p_currency, p_status,
          case when p_status = 'matched' then p_rule end, case when p_status <> 'matched' then p_reason end,
          case when p_status = 'matched' and p_kind = 'appointment' then p_context_id end, case when p_status = 'matched' and p_kind = 'job' then p_context_id end,
          p_client, coalesce(p_candidates, '[]'::jsonb), p_occurred_at, p_event)
  on conflict (tenant_id, provider, entry, external_id) do nothing
  returning id into v_id;
  if v_id is null then
    select p.status, case when p.appointment_id is not null then 'appointment' when p.job_id is not null then 'job' end, coalesce(p.appointment_id, p.job_id)
      into v_status, v_kind, v_ctx
      from app.finance_payments p where p.tenant_id = p_tenant and p.provider = p_provider and p.entry = 'payment' and p.external_id = p_external_id;
    return pg_catalog.jsonb_build_object('fresh', false, 'status', v_status,
      'balance_cents', case when v_ctx is not null then greatest(((app.fin_context(p_tenant, v_kind, v_ctx)) ->> 'due_cents')::bigint - ((app.fin_context(p_tenant, v_kind, v_ctx)) ->> 'paid_cents')::bigint, 0) end);
  end if;
  if p_status <> 'matched' then
    return pg_catalog.jsonb_build_object('fresh', true, 'status', p_status, 'balance_cents', null, 'settled', false);
  end if;
  v_out := app.fin_apply(p_tenant, v_id);
  if not (v_out ->> 'applied')::boolean then
    return pg_catalog.jsonb_build_object('fresh', true, 'status', 'unmatched', 'reason', v_out ->> 'reason', 'balance_cents', null, 'settled', false);
  end if;
  return pg_catalog.jsonb_build_object('fresh', true, 'status', 'matched', 'balance_cents', (v_out ->> 'balance_cents')::bigint, 'settled', (v_out ->> 'settled')::boolean);
end
$$;

create or replace function public.fin_payment_get(p_tenant uuid, p_provider text, p_external_id text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('cents', app.fin_cents(p.amount), 'currency', p.currency, 'status', p.status,
    'kind', case when p.appointment_id is not null then 'appointment' when p.job_id is not null then 'job' end, 'context_id', coalesce(p.appointment_id, p.job_id),
    'refunded_cents', app.fin_cents(coalesce((select pg_catalog.sum(r.amount) from app.finance_payments r
       where r.tenant_id = p_tenant and r.provider = p_provider and r.entry = 'refund' and r.parent_external_id = p.external_id and r.status = 'recorded'), 0)))
  from app.finance_payments p where p.tenant_id = p_tenant and p.provider = p_provider and p.entry = 'payment' and p.external_id = p_external_id
$$;

-- Records a refund ONCE. It lowers what its payment's record has received (the sums above read it) and writes an
-- audit entry. It does not un-pay or rewrite the local record: a person sees the new balance and decides.
create or replace function public.fin_refund_record(
  p_tenant uuid, p_provider text, p_external_id text, p_payment_external_id text, p_cents bigint, p_currency text, p_status text,
  p_reason text default null, p_event text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  pay app.finance_payments%rowtype;
  v_id uuid;
  v_status text := p_status;
  v_reason text := p_reason;
  v_taken numeric(12,2);
  v_kind text;
  v_ctx jsonb;
begin
  if p_cents is null or p_cents <= 0 or p_status not in ('recorded', 'unmatched') or p_payment_external_id is null then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into pay from app.finance_payments p
   where p.tenant_id = p_tenant and p.provider = p_provider and p.entry = 'payment' and p.external_id = p_payment_external_id for update;
  if not found then v_status := 'unmatched'; v_reason := 'payment_unknown';
  else
    select coalesce(pg_catalog.sum(r.amount), 0) into v_taken from app.finance_payments r
     where r.tenant_id = p_tenant and r.provider = p_provider and r.entry = 'refund' and r.parent_external_id = p_payment_external_id and r.status = 'recorded';
    if v_status = 'recorded' and v_taken + app.fin_amount(p_cents) > pay.amount then v_status := 'unmatched'; v_reason := 'refund_exceeds_payment'; end if;
  end if;
  insert into app.finance_payments (tenant_id, provider, entry, external_id, parent_external_id, amount, currency, status, reason, appointment_id, job_id, client_id, source_event)
  values (p_tenant, p_provider, 'refund', p_external_id, p_payment_external_id, app.fin_amount(p_cents), p_currency, v_status,
          case when v_status = 'unmatched' then coalesce(v_reason, 'unmatched') end,
          case when v_status = 'recorded' then pay.appointment_id end, case when v_status = 'recorded' then pay.job_id end, pay.client_id, p_event)
  on conflict (tenant_id, provider, entry, external_id) do nothing
  returning id into v_id;
  if v_id is null then
    return pg_catalog.jsonb_build_object('fresh', false, 'status', (select r.status from app.finance_payments r
      where r.tenant_id = p_tenant and r.provider = p_provider and r.entry = 'refund' and r.external_id = p_external_id));
  end if;
  if v_status = 'recorded' and coalesce(pay.appointment_id, pay.job_id) is not null then
    v_kind := case when pay.appointment_id is not null then 'appointment' else 'job' end;
    v_ctx := app.fin_context(p_tenant, v_kind, coalesce(pay.appointment_id, pay.job_id));
    perform app.audit_write(p_tenant, 'finance.refund_recorded', case when v_kind = 'appointment' then 'appointments' else 'jobs' end, coalesce(pay.appointment_id, pay.job_id), null,
      pg_catalog.jsonb_build_object('provider', p_provider, 'reference', p_provider || ':' || p_external_id, 'payment', p_provider || ':' || p_payment_external_id));
  end if;
  return pg_catalog.jsonb_build_object('fresh', true, 'status', v_status, 'reason', v_reason,
    'balance_cents', case when v_ctx is not null then greatest((v_ctx ->> 'due_cents')::bigint - (v_ctx ->> 'paid_cents')::bigint, 0) end);
end
$$;

create or replace function public.fin_intent_put(p_tenant uuid, p_provider text, p_order_id text, p_link_id text, p_kind text, p_context_id uuid, p_cents bigint) returns void
language sql security definer
set search_path = ''
as $$
  insert into app.finance_intents (tenant_id, provider, order_id, link_id, appointment_id, job_id, amount)
  values (p_tenant, p_provider, p_order_id, p_link_id, case when p_kind = 'appointment' then p_context_id end, case when p_kind = 'job' then p_context_id end, app.fin_amount(p_cents))
  on conflict (tenant_id, provider, order_id) do nothing
$$;

-- One line of the sync log, and the same fact in the company's audit log.
create or replace function public.fin_audit(
  p_tenant uuid, p_provider text, p_direction text, p_action text, p_entity text, p_local_id uuid default null, p_external_id text default null,
  p_request_id text default null, p_outcome text default 'ok', p_code text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.finance_sync_log (tenant_id, provider, direction, action, entity, local_id, external_id, request_id, outcome, code)
  values (p_tenant, p_provider, p_direction, p_action, p_entity, p_local_id, p_external_id, p_request_id, p_outcome, p_code);
  perform app.audit_write(p_tenant, 'finance.' || p_action, 'finance_sync_log', p_local_id, null,
    pg_catalog.jsonb_build_object('provider', p_provider, 'direction', p_direction, 'entity', p_entity, 'external_id', p_external_id, 'request_id', p_request_id, 'outcome', p_outcome, 'code', p_code));
end
$$;

-- What a push to the accounting system needs about one local record.
create or replace function public.fin_push_source(p_tenant uuid, p_provider text, p_kind text, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'customer' then (
      select pg_catalog.jsonb_build_object('id', c.id, 'client_id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'cents', 0,
        'customer_external_id', c.external_ids ->> p_provider,
        'approved', exists (select 1 from app.finance_links l where l.tenant_id = p_tenant and l.provider = p_provider and l.kind = 'customer' and l.client_id = c.id and l.state = 'approved'))
      from public.clients c where c.tenant_id = p_tenant and c.id = p_id)
    when 'invoice' then (
      select pg_catalog.jsonb_build_object('id', j.id, 'client_id', j.client_id, 'number', j.number, 'cents', app.fin_cents(j.price), 'date', j.created,
        'customer_external_id', c.external_ids ->> p_provider,
        'item_external_id', (select s.external_ids ->> p_provider from public.catalog_services s where s.tenant_id = p_tenant and s.id = j.service_id))
      from public.jobs j join public.clients c on c.tenant_id = j.tenant_id and c.id = j.client_id
      where j.tenant_id = p_tenant and j.id = p_id)
    when 'payment' then (
      select pg_catalog.jsonb_build_object('id', cp.id, 'client_id', j.client_id, 'cents', app.fin_cents(cp.amount), 'date', cp.date,
        'customer_external_id', c.external_ids ->> p_provider,
        'invoice_external_id', (select l.external_id from app.finance_links l where l.tenant_id = p_tenant and l.provider = p_provider and l.kind = 'invoice' and l.job_id = j.id and l.external_id is not null limit 1))
      from public.client_payments cp
      join public.jobs j on j.tenant_id = cp.tenant_id and j.id = cp.job_id
      join public.clients c on c.tenant_id = j.tenant_id and c.id = j.client_id
      where cp.tenant_id = p_tenant and cp.id = p_id)
  end
$$;

revoke all on function app.fin_cents(numeric), app.fin_amount(bigint), app.finance_evidence_guard(), app.fin_context(uuid, text, uuid), app.fin_apply(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.fin_clients(uuid, text), public.fin_services(uuid, text), public.fin_context(uuid, text, uuid), public.fin_candidates(uuid, text, jsonb, text, text),
  public.fin_link_put(uuid, text, text, text, uuid, text, text, text[], text, text, jsonb), public.fin_link_get(uuid, text, text, uuid, text),
  public.fin_links_apply(uuid, text, text, text[]),
  public.fin_payment_record(uuid, text, text, bigint, text, timestamptz, text, text, text, text, uuid, uuid, jsonb, text), public.fin_payment_get(uuid, text, text),
  public.fin_refund_record(uuid, text, text, text, bigint, text, text, text, text), public.fin_intent_put(uuid, text, text, text, text, uuid, bigint),
  public.fin_audit(uuid, text, text, text, text, uuid, text, text, text, text), public.fin_push_source(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.fin_clients(uuid, text), public.fin_services(uuid, text), public.fin_context(uuid, text, uuid), public.fin_candidates(uuid, text, jsonb, text, text),
  public.fin_link_put(uuid, text, text, text, uuid, text, text, text[], text, text, jsonb), public.fin_link_get(uuid, text, text, uuid, text),
  public.fin_links_apply(uuid, text, text, text[]),
  public.fin_payment_record(uuid, text, text, bigint, text, timestamptz, text, text, text, text, uuid, uuid, jsonb, text), public.fin_payment_get(uuid, text, text),
  public.fin_refund_record(uuid, text, text, text, bigint, text, text, text, text), public.fin_intent_put(uuid, text, text, text, text, uuid, bigint),
  public.fin_audit(uuid, text, text, text, text, uuid, text, text, text, text), public.fin_push_source(uuid, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- For people (rules of docs/DATABASE.md 11.1): the unmatched list, assigning a payment, approving a customer
-- ---------------------------------------------------------------------------------------------------------------------
-- Payments the rules could not place, newest first. Needs "money".
create or replace function public.finance_unmatched(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'money');
begin
  return (select coalesce(pg_catalog.jsonb_agg(x.row order by x.at desc), '[]'::jsonb) from (
    select pg_catalog.jsonb_build_object('id', p.id, 'provider', p.provider, 'entry', p.entry, 'externalId', p.external_id, 'cents', app.fin_cents(p.amount), 'currency', p.currency,
             'status', p.status, 'reason', p.reason, 'candidates', p.candidates, 'occurredAt', p.occurred_at, 'clientId', p.client_id) as row, p.created_at as at
    from app.finance_payments p where p.tenant_id = p_tenant and p.status in ('unmatched', 'ambiguous') order by p.created_at desc limit 500) x);
end
$$;

-- A person gives an unmatched or ambiguous payment its record. Once: a placed payment is not moved, and a record
-- that is closed or already paid in full refuses it (conflict). Needs "money" and "write".
create or replace function public.finance_payment_assign(p_tenant uuid, p_payment uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'money', 'write');
  r app.finance_payments%rowtype;
  v_client uuid;
  v_out jsonb;
begin
  if p_kind is null or p_kind not in ('appointment', 'job') or p_id is null then perform app.module_refuse('invalid'); end if;
  select * into r from app.finance_payments p where p.tenant_id = p_tenant and p.id = p_payment for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if r.entry <> 'payment' or r.status not in ('unmatched', 'ambiguous') then perform app.module_refuse('conflict'); end if;
  if p_kind = 'appointment' then select a.client_id into v_client from public.appointments a where a.tenant_id = p_tenant and a.id = p_id;
  else select j.client_id into v_client from public.jobs j where j.tenant_id = p_tenant and j.id = p_id; end if;
  if not found then perform app.module_refuse('not_found'); end if;
  if v_client is not null and not app.client_visible(p_tenant, v_client) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update app.finance_payments p
     set status = 'matched', rule = 'person', reason = null, assigned_by = v_me, assigned_at = pg_catalog.now(),
         appointment_id = case when p_kind = 'appointment' then p_id end, job_id = case when p_kind = 'job' then p_id end
   where p.id = r.id;
  v_out := app.fin_apply(p_tenant, r.id);
  -- raising undoes the assignment above: nothing half done stays
  if not (v_out ->> 'applied')::boolean then perform app.module_refuse('conflict'); end if;
  perform app.module_event(p_tenant, 'finance.payment_assigned', case when p_kind = 'appointment' then 'appointment' else 'job' end, p_id,
    pg_catalog.jsonb_build_object('provider', r.provider, 'reference', r.provider || ':' || r.external_id));
  return pg_catalog.jsonb_build_object('id', r.id, 'status', 'matched', 'kind', p_kind, 'contextId', p_id, 'balanceCents', (v_out ->> 'balance_cents')::bigint, 'settled', (v_out ->> 'settled')::boolean);
end
$$;

-- A person approves creating one client as a customer in the accounting system. Needs "clients", "money", "write".
create or replace function public.finance_customer_approve(p_tenant uuid, p_provider text, p_client uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'clients', 'money', 'write');
begin
  if p_provider is null or p_provider not in ('quickbooks') then perform app.module_refuse('invalid'); end if;
  if not app.client_visible(p_tenant, p_client) then perform app.module_refuse('not_found'); end if;
  if exists (select 1 from public.clients c where c.tenant_id = p_tenant and c.id = p_client and c.external_ids ->> p_provider is not null) then perform app.module_refuse('conflict'); end if;
  insert into app.finance_links (tenant_id, provider, kind, client_id, state, rule)
  values (p_tenant, p_provider, 'customer', p_client, 'approved', 'person')
  on conflict (tenant_id, provider, kind, client_id) where external_id is null do nothing;
  perform app.module_event(p_tenant, 'finance.customer_approved', 'client', p_client, pg_catalog.jsonb_build_object('provider', p_provider));
  return pg_catalog.jsonb_build_object('clientId', p_client, 'provider', p_provider, 'state', 'approved');
end
$$;

revoke all on function public.finance_unmatched(uuid), public.finance_payment_assign(uuid, uuid, text, uuid), public.finance_customer_approve(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.finance_unmatched(uuid), public.finance_payment_assign(uuid, uuid, text, uuid), public.finance_customer_approve(uuid, text, uuid)
  to authenticated;

select app.lockdown_check();
