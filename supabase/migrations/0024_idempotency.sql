-- 0024 Idempotency keys for server operations
-- A critical action must survive a retry: a double click, a browser that sends twice, a provider that calls a
-- webhook again. The caller picks a key for the action; the first request with that key does the work and stores
-- its answer; a repeat with the same key gets the stored answer and nothing is done twice.
-- (Workspace changes carry their own key through ws_apply; this table is for what the server itself does:
-- sending an email, creating an invitation, starting a sync, storing a file.)
--
--   app.idem_begin(scope, key, request_hash, tenant)  -> { state: 'new' | 'replay' | 'in_progress' | 'mismatch', response }
--   app.idem_finish(scope, key, response)             stores the answer
--   app.idem_abort(scope, key)                        the work failed before anything happened: the key is free again

create table app.idempotency_keys (
  scope         text not null check (scope ~ '^[a-z][a-z0-9_.:-]{1,60}$'),
  key           text not null check (pg_catalog.length(key) between 8 and 200),
  tenant_id     uuid references public.tenants (id) on delete cascade,
  -- Hash of what was asked. The same key with a different request is a mistake in the caller and is refused.
  request_hash  text not null check (request_hash ~ '^[0-9a-f]{16,128}$'),
  status        text not null default 'started' check (status in ('started', 'done')),
  -- The answer given the first time. Never holds a secret: callers store codes and ids only.
  response      jsonb,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  primary key (scope, key)
);
create index idempotency_keys_expiry_idx on app.idempotency_keys (expires_at);
create index idempotency_keys_tenant_idx on app.idempotency_keys (tenant_id);
alter table app.idempotency_keys enable row level security;
alter table app.idempotency_keys force row level security;
revoke all on app.idempotency_keys from public, anon, authenticated, service_role;

create or replace function app.idem_begin(
  p_scope text, p_key text, p_request_hash text, p_tenant uuid default null, p_ttl_seconds integer default 86400
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r app.idempotency_keys%rowtype;
  v_ttl interval := pg_catalog.make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 86400), 2592000)));
begin
  delete from app.idempotency_keys k where k.scope = p_scope and k.key = p_key and k.expires_at <= pg_catalog.now();
  insert into app.idempotency_keys (scope, key, tenant_id, request_hash, expires_at)
  values (p_scope, p_key, p_tenant, p_request_hash, pg_catalog.now() + v_ttl)
  on conflict (scope, key) do nothing;
  if found then
    return pg_catalog.jsonb_build_object('state', 'new');
  end if;
  select * into r from app.idempotency_keys k where k.scope = p_scope and k.key = p_key for update;
  if r.request_hash <> p_request_hash or r.tenant_id is distinct from p_tenant then
    return pg_catalog.jsonb_build_object('state', 'mismatch');
  end if;
  if r.status = 'done' then
    return pg_catalog.jsonb_build_object('state', 'replay', 'response', r.response);
  end if;
  -- Started and never finished: the first request died. After two minutes the next one may take over.
  if r.created_at < pg_catalog.now() - interval '2 minutes' then
    update app.idempotency_keys k set created_at = pg_catalog.now() where k.scope = p_scope and k.key = p_key;
    return pg_catalog.jsonb_build_object('state', 'new');
  end if;
  return pg_catalog.jsonb_build_object('state', 'in_progress');
end
$$;

create or replace function app.idem_finish(p_scope text, p_key text, p_response jsonb) returns void
language sql security definer
set search_path = ''
as $$ update app.idempotency_keys k set status = 'done', response = p_response where k.scope = p_scope and k.key = p_key $$;

create or replace function app.idem_abort(p_scope text, p_key text) returns void
language sql security definer
set search_path = ''
as $$ delete from app.idempotency_keys k where k.scope = p_scope and k.key = p_key and k.status = 'started' $$;

revoke all on function app.idem_begin(text, text, text, uuid, integer), app.idem_finish(text, text, jsonb), app.idem_abort(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.idem_begin(p_scope text, p_key text, p_request_hash text, p_tenant uuid default null, p_ttl_seconds integer default 86400)
returns jsonb language sql security definer set search_path = ''
as $$ select app.idem_begin(p_scope, p_key, p_request_hash, p_tenant, p_ttl_seconds) $$;

create or replace function public.idem_finish(p_scope text, p_key text, p_response jsonb)
returns void language sql security definer set search_path = ''
as $$ select app.idem_finish(p_scope, p_key, p_response) $$;

create or replace function public.idem_abort(p_scope text, p_key text)
returns void language sql security definer set search_path = ''
as $$ select app.idem_abort(p_scope, p_key) $$;

revoke all on function public.idem_begin(text, text, text, uuid, integer), public.idem_finish(text, text, jsonb), public.idem_abort(text, text)
  from public, anon, authenticated;
grant execute on function public.idem_begin(text, text, text, uuid, integer), public.idem_finish(text, text, jsonb), public.idem_abort(text, text)
  to service_role;
