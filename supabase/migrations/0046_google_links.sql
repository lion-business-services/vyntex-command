-- 0046 Google links: the calendar link map and the inbound hand over
-- Two small tables used only by the server (service role), for api/_lib/integrations/google/state.js.
--
-- app.gcal_links      which local record is which Google Calendar event, with the versions both sides had when they
--                     last agreed. Prevents duplicates and lets a conflict be seen instead of overwritten.
-- app.google_inbound  changes found at Google (a new email, a moved event, a new review). The adapters put a row here;
--                     the module that owns the records applies it. (tenant, provider, ref) is unique, so the same
--                     change arriving twice (a webhook and the daily sync, a retried job) is stored once.

create table app.gcal_links (
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  local_id        text not null check (local_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  calendar_id     text not null check (pg_catalog.length(calendar_id) between 1 and 200),
  event_id        text not null check (pg_catalog.length(event_id) between 1 and 1024),
  etag            text check (pg_catalog.length(etag) <= 200),
  remote_updated  timestamptz,
  local_updated   timestamptz,
  hash            text check (pg_catalog.length(hash) <= 64),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, local_id),
  unique (tenant_id, event_id)
);
alter table app.gcal_links enable row level security;
alter table app.gcal_links force row level security;
revoke all on app.gcal_links from public, anon, authenticated, service_role;

create or replace function public.gcal_link_get(p_tenant uuid, p_local text) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select pg_catalog.to_jsonb(l) from app.gcal_links l where l.tenant_id = p_tenant and l.local_id = p_local $$;

create or replace function public.gcal_link_by_event(p_tenant uuid, p_event text) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select pg_catalog.to_jsonb(l) from app.gcal_links l where l.tenant_id = p_tenant and l.event_id = p_event $$;

create or replace function public.gcal_link_put(p_tenant uuid, p_row jsonb) returns jsonb
language sql security definer
set search_path = ''
as $$
  insert into app.gcal_links as l (tenant_id, local_id, calendar_id, event_id, etag, remote_updated, local_updated, hash, updated_at)
  values (p_tenant, p_row ->> 'local_id', p_row ->> 'calendar_id', p_row ->> 'event_id', p_row ->> 'etag',
          (p_row ->> 'remote_updated')::timestamptz, (p_row ->> 'local_updated')::timestamptz, p_row ->> 'hash', pg_catalog.now())
  on conflict (tenant_id, local_id) do update set
    calendar_id = excluded.calendar_id, event_id = excluded.event_id, etag = excluded.etag,
    remote_updated = excluded.remote_updated, local_updated = excluded.local_updated, hash = excluded.hash, updated_at = pg_catalog.now()
  returning pg_catalog.to_jsonb(l)
$$;

create or replace function public.gcal_link_delete(p_tenant uuid, p_local text) returns boolean
language sql security definer
set search_path = ''
as $$ with d as (delete from app.gcal_links l where l.tenant_id = p_tenant and l.local_id = p_local returning 1) select exists (select 1 from d) $$;

create table app.google_inbound (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  provider    text not null check (provider in ('gmail', 'gcal', 'gbp')),
  kind        text not null check (kind ~ '^[a-z][a-z0-9_.]{1,40}$'),
  -- The change's own id at the provider (a message id, an event id with its version, a review id with its time).
  ref         text not null check (pg_catalog.length(ref) between 1 and 400),
  -- Ids, times and lookup input only. Message text, subjects, reviewer names and review text stay at Google.
  data        jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(data) = 'object' and pg_catalog.length(data::text) <= 8000),
  status      text not null default 'new' check (status in ('new', 'applied', 'conflict', 'ignored')),
  note        text check (note ~ '^[a-z][a-z0-9_.]{1,60}$'),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  unique (tenant_id, provider, ref)
);
create index google_inbound_new_idx on app.google_inbound (tenant_id, provider, created_at) where status = 'new';
alter table app.google_inbound enable row level security;
alter table app.google_inbound force row level security;
revoke all on app.google_inbound from public, anon, authenticated, service_role;

-- True when the change is new, false when it was already stored.
create or replace function public.google_inbound_put(p_tenant uuid, p_provider text, p_kind text, p_ref text, p_data jsonb) returns boolean
language sql security definer
set search_path = ''
as $$
  with i as (
    insert into app.google_inbound (tenant_id, provider, kind, ref, data)
    values (p_tenant, p_provider, p_kind, p_ref, coalesce(p_data, '{}'::jsonb))
    on conflict (tenant_id, provider, ref) do nothing
    returning 1)
  select exists (select 1 from i)
$$;

-- The oldest changes not handled yet, for the module that applies them.
create or replace function public.google_inbound_pending(p_tenant uuid, p_provider text, p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
    select g.id, g.provider, g.kind, g.ref, g.data, g.created_at
    from app.google_inbound g
    where g.tenant_id = p_tenant and g.provider = p_provider and g.status = 'new'
    order by g.created_at limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

create or replace function public.google_inbound_mark(p_id uuid, p_status text, p_note text default null) returns void
language sql security definer
set search_path = ''
as $$ update app.google_inbound g set status = p_status, note = p_note, handled_at = pg_catalog.now() where g.id = p_id $$;

revoke all on function public.gcal_link_get(uuid, text), public.gcal_link_by_event(uuid, text), public.gcal_link_put(uuid, jsonb),
  public.gcal_link_delete(uuid, text), public.google_inbound_put(uuid, text, text, text, jsonb),
  public.google_inbound_pending(uuid, text, integer), public.google_inbound_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gcal_link_get(uuid, text), public.gcal_link_by_event(uuid, text), public.gcal_link_put(uuid, jsonb),
  public.gcal_link_delete(uuid, text), public.google_inbound_put(uuid, text, text, text, jsonb),
  public.google_inbound_pending(uuid, text, integer), public.google_inbound_mark(uuid, text, text) to service_role;
