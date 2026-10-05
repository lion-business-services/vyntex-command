-- 0027 Webhook event log
-- Every call a provider makes to /api/webhooks/<provider> leaves a row. The server checks the signature on the raw
-- body first (api/webhooks.js); what it found is recorded here.
--
--   idempotency   (provider, event_id) is unique. A provider that sends the same event again gets "already have it"
--                 and nothing runs twice.
--   payload       only a hash of the raw body and a redacted copy chosen by the adapter (ids and types, no personal
--                 data, no secrets). A body whose signature failed is never stored, only its hash.
--   processing    the event is handed to the job queue; attempts and the outcome are written back here.
-- A company never sees another company's events: the list function below filters on the company and checks the role.

create table app.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  -- The provider's id for the event. NULL only for a call that failed the signature check.
  event_id      text check (pg_catalog.length(event_id) between 1 and 200),
  -- NULL when the event could not be matched to a company (unknown account), or was rejected.
  tenant_id     uuid references public.tenants (id) on delete cascade,
  signature_ok  boolean not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'received' check (status in ('received', 'queued', 'processed', 'failed', 'ignored', 'rejected')),
  attempts      integer not null default 0 check (attempts >= 0),
  payload_hash  text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  redacted      jsonb check (redacted is null or pg_catalog.pg_column_size(redacted) < 16384),
  error         text check (error ~ '^[a-z][a-z0-9_.]{1,60}$'),
  job_id        uuid,
  constraint webhook_events_rejected_shape check (signature_ok or (status = 'rejected' and redacted is null and tenant_id is null))
);
create unique index webhook_events_event_uidx on app.webhook_events (provider, event_id) where event_id is not null;
create index webhook_events_tenant_idx on app.webhook_events (tenant_id, received_at desc);
create index webhook_events_received_idx on app.webhook_events (received_at);
alter table app.webhook_events enable row level security;
alter table app.webhook_events force row level security;
revoke all on app.webhook_events from public, anon, authenticated, service_role;

-- Records a verified event. { fresh: true, id } the first time; { fresh: false, id, status } for a repeat.
create or replace function public.webhook_receive(
  p_provider text, p_event_id text, p_tenant uuid, p_payload_hash text, p_redacted jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if p_event_id is null or pg_catalog.length(p_event_id) = 0 then
    raise exception 'An event id is required' using errcode = '22023';
  end if;
  insert into app.webhook_events (provider, event_id, tenant_id, signature_ok, payload_hash, redacted)
  values (p_provider, p_event_id, p_tenant, true, p_payload_hash, p_redacted)
  on conflict (provider, event_id) where event_id is not null do nothing
  returning id into v_id;
  if v_id is not null then
    return pg_catalog.jsonb_build_object('fresh', true, 'id', v_id);
  end if;
  select e.id, e.status into v_id, v_status from app.webhook_events e where e.provider = p_provider and e.event_id = p_event_id;
  return pg_catalog.jsonb_build_object('fresh', false, 'id', v_id, 'status', v_status);
end
$$;

-- Records a call that failed the signature check (or arrived outside the allowed time window). Hash only.
create or replace function public.webhook_reject(p_provider text, p_payload_hash text, p_error text, p_ip_hash text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.webhook_events (provider, event_id, tenant_id, signature_ok, status, payload_hash, error, processed_at)
  values (p_provider, null, null, false, 'rejected', p_payload_hash, p_error, pg_catalog.now());
  perform app.security_event(null, null, 'webhook.rejected', 'denied', p_ip_hash, pg_catalog.jsonb_build_object('provider', p_provider, 'why', p_error));
end
$$;

-- Outcome of processing, written by the job runner.
create or replace function public.webhook_mark(p_id uuid, p_status text, p_error text default null, p_job uuid default null) returns void
language sql security definer
set search_path = ''
as $$
  update app.webhook_events e
     set status = p_status,
         error = p_error,
         job_id = coalesce(p_job, e.job_id),
         attempts = e.attempts + case when p_status in ('processed', 'failed') then 1 else 0 end,
         processed_at = case when p_status in ('processed', 'ignored') then pg_catalog.now() else e.processed_at end
   where e.id = p_id and e.signature_ok
$$;

create or replace function public.webhook_get(p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.to_jsonb(x) from (
    select e.id, e.provider, e.event_id, e.tenant_id, e.status, e.attempts, e.redacted from app.webhook_events e where e.id = p_id and e.signature_ok
  ) x
$$;

revoke all on function public.webhook_receive(text, text, uuid, text, jsonb), public.webhook_reject(text, text, text, text),
  public.webhook_mark(uuid, text, text, uuid), public.webhook_get(uuid) from public, anon, authenticated;
grant execute on function public.webhook_receive(text, text, uuid, text, jsonb), public.webhook_reject(text, text, text, text),
  public.webhook_mark(uuid, text, text, uuid), public.webhook_get(uuid) to service_role;

-- A company's recent webhook events, for the diagnostics part of the Integrations screen. No payloads, only facts.
create or replace function public.webhook_log(p_tenant uuid, p_limit integer default 50) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not (coalesce(app.can(p_tenant, 'integrations'), false) or coalesce(app.has_role(p_tenant, array['owner']), false)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.received_at desc)
    from (
      select e.id, e.provider, e.event_id, e.received_at, e.processed_at, e.status, e.attempts, e.error
      from app.webhook_events e where e.tenant_id = p_tenant
      order by e.received_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x), '[]'::jsonb);
end
$$;
revoke all on function public.webhook_log(uuid, integer) from public, anon, service_role;
grant execute on function public.webhook_log(uuid, integer) to authenticated;
