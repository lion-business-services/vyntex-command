-- 0026 Connections to outside services
-- One row per company and provider (Gmail, Square, QuickBooks ...). The state is the honest one from ConnState in
-- src/domain/types.ts, and only the server writes it: "connected" is set after the provider answered a real status
-- call for that account, never before (the check constraint below refuses a connected row without that proof).
--
-- Provider tokens: stored only as a sealed blob (AES-256-GCM, done by the server with a key that exists only in the
-- server environment, api/_lib/crypto.js). The database never sees a token, a backup never contains one in clear,
-- and no function in this file returns the blob to a signed-in person.

create table app.integration_connections (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  provider           text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  state              text not null default 'not_connected'
                     check (state in ('not_connected', 'setup', 'connected', 'attention', 'reauth', 'error', 'pending_approval')),
  -- Short code that says why the state is what it is (token_expired, scope_missing, provider_down ...).
  reason             text check (reason ~ '^[a-z][a-z0-9_.]{1,60}$'),
  -- What the screen shows as "account": an email address, a business name, a phone number.
  account_label      text check (pg_catalog.length(account_label) <= 200),
  -- The provider's own id for that account. Incoming webhooks are matched to a company with it.
  account_ref        text check (pg_catalog.length(account_ref) <= 200),
  scopes             text[] not null default '{}'::text[],
  token_enc          text check (pg_catalog.length(token_enc) <= 16000),
  token_expires_at   timestamptz,
  connected_at       timestamptz,
  -- tenant_members.id of the person who connected it.
  connected_by       uuid,
  last_sync_at       timestamptz,
  last_error         text check (last_error ~ '^[a-z][a-z0-9_.]{1,60}$'),
  last_error_at      timestamptz,
  health             text not null default 'unknown' check (health in ('unknown', 'ok', 'degraded', 'down')),
  health_checked_at  timestamptz,
  settings           jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(settings) = 'object'),
  extra              jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(extra) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, provider),
  unique (tenant_id, id),
  constraint integration_connections_member_fk foreign key (tenant_id, connected_by) references public.tenant_members (tenant_id, id) on delete restrict,
  -- "Connected" needs proof: the moment it was connected and the moment a status call last succeeded.
  constraint integration_connections_connected_proof check (state <> 'connected' or (connected_at is not null and health_checked_at is not null))
);
create index integration_connections_account_idx on app.integration_connections (provider, account_ref) where account_ref is not null;
create index integration_connections_expiry_idx on app.integration_connections (token_expires_at) where token_enc is not null;
alter table app.integration_connections enable row level security;
alter table app.integration_connections force row level security;
revoke all on app.integration_connections from public, anon, authenticated, service_role;
create trigger integration_connections_touch before update on app.integration_connections for each row execute function app.touch_updated_at();
create trigger integration_connections_00_tenant_fixed before update of tenant_id on app.integration_connections
  for each row execute function app.tenant_id_immutable();

-- A connection as the screens see it (Connection in src/domain/types.ts plus health). No token, sealed or not.
create or replace function app.connection_json(c app.integration_connections) returns jsonb
language sql stable
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'id', c.provider, 'state', c.state, 'reason', c.reason, 'account', c.account_label, 'scopes', pg_catalog.to_jsonb(c.scopes),
    'connectedAt', c.connected_at, 'lastSyncAt', c.last_sync_at, 'lastError', c.last_error, 'lastErrorAt', c.last_error_at,
    'health', c.health, 'healthCheckedAt', c.health_checked_at, 'settings', c.settings, 'by', c.connected_by))
$$;
revoke all on function app.connection_json(app.integration_connections) from public, anon, authenticated, service_role;

-- What a company has connected. Any office member may see the states (the email screen needs to know whether email
-- is connected); nothing here is secret. FOR THE GATEWAY: this is the source for the "connections" collection.
create or replace function public.connections_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.is_office(p_tenant), false) and not coalesce(app.can(p_tenant, 'integrations'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(app.connection_json(c) order by c.provider)
    from app.integration_connections c where c.tenant_id = p_tenant), '[]'::jsonb);
end
$$;

-- Asked by the server before it changes a connection on a person's behalf: may this person do that, here, now?
-- Returns their member id. Connecting and disconnecting change credentials, so they need a fresh identity check.
create or replace function public.integration_authorize(p_tenant uuid, p_action text) returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'integrations'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_action in ('connect', 'disconnect') then
    perform app.require_stepup();
  elsif p_action not in ('sync', 'test', 'read') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  return app.current_member(p_tenant);
end
$$;
revoke all on function public.connections_list(uuid), public.integration_authorize(uuid, text) from public, anon, service_role;
grant execute on function public.connections_list(uuid), public.integration_authorize(uuid, text) to authenticated;

-- ---- Server only (service role): the server holds the provider tokens, so it is the only writer. ----

-- Creates or updates a connection from a patch. Only the listed fields can be set; anything else in the patch is ignored.
create or replace function public.conn_put(p_tenant uuid, p_provider text, p_patch jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c app.integration_connections%rowtype;
  p jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  insert into app.integration_connections (tenant_id, provider) values (p_tenant, p_provider)
  on conflict (tenant_id, provider) do nothing;
  select * into c from app.integration_connections x where x.tenant_id = p_tenant and x.provider = p_provider for update;
  if p ? 'state' then c.state := p ->> 'state'; end if;
  if p ? 'reason' then c.reason := p ->> 'reason'; end if;
  if p ? 'account_label' then c.account_label := pg_catalog.left(p ->> 'account_label', 200); end if;
  if p ? 'account_ref' then c.account_ref := pg_catalog.left(p ->> 'account_ref', 200); end if;
  if p ? 'scopes' then c.scopes := coalesce((select pg_catalog.array_agg(s) from pg_catalog.jsonb_array_elements_text(p -> 'scopes') s), '{}'::text[]); end if;
  if p ? 'token_enc' then c.token_enc := p ->> 'token_enc'; end if;
  if p ? 'token_expires_at' then c.token_expires_at := (p ->> 'token_expires_at')::timestamptz; end if;
  if p ? 'connected_at' then c.connected_at := (p ->> 'connected_at')::timestamptz; end if;
  if p ? 'connected_by' then c.connected_by := (p ->> 'connected_by')::uuid; end if;
  if p ? 'last_sync_at' then c.last_sync_at := (p ->> 'last_sync_at')::timestamptz; end if;
  if p ? 'last_error' then c.last_error := p ->> 'last_error'; c.last_error_at := case when p ->> 'last_error' is null then null else pg_catalog.now() end; end if;
  if p ? 'health' then c.health := p ->> 'health'; c.health_checked_at := pg_catalog.now(); end if;
  if p ? 'settings' and pg_catalog.jsonb_typeof(p -> 'settings') = 'object' then c.settings := p -> 'settings'; end if;
  update app.integration_connections x set
    state = c.state, reason = c.reason, account_label = c.account_label, account_ref = c.account_ref, scopes = c.scopes,
    token_enc = c.token_enc, token_expires_at = c.token_expires_at, connected_at = c.connected_at, connected_by = c.connected_by,
    last_sync_at = c.last_sync_at, last_error = c.last_error, last_error_at = c.last_error_at,
    health = c.health, health_checked_at = c.health_checked_at, settings = c.settings
  where x.id = c.id;
  return app.connection_json(c);
end
$$;

-- The row the server works with, including the sealed token blob. Never reaches a browser.
create or replace function public.conn_get(p_tenant uuid, p_provider text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.to_jsonb(x) from (
    select c.id, c.tenant_id, c.provider, c.state, c.reason, c.account_label, c.account_ref, c.scopes, c.token_enc,
           c.token_expires_at, c.connected_at, c.connected_by, c.last_sync_at, c.last_error, c.health, c.health_checked_at,
           c.settings, c.updated_at
    from app.integration_connections c where c.tenant_id = p_tenant and c.provider = p_provider
  ) x
$$;

-- Removes a connection and with it the sealed tokens.
create or replace function public.conn_delete(p_tenant uuid, p_provider text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from app.integration_connections c where c.tenant_id = p_tenant and c.provider = p_provider;
  return found;
end
$$;

-- Which company does an incoming webhook belong to? Matched on the provider's account id, connected rows only.
create or replace function public.conn_by_account(p_provider text, p_account_ref text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'state', c.state)
  from app.integration_connections c
  where c.provider = p_provider and c.account_ref = p_account_ref and c.state in ('connected', 'attention')
  order by c.connected_at desc nulls last
  limit 1
$$;

-- Connections whose token runs out soon (for the scheduled refresh), oldest first.
create or replace function public.conn_due_refresh(p_within_seconds integer default 900, p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenant_id', x.tenant_id, 'provider', x.provider)), '[]'::jsonb)
  from (
    select c.tenant_id, c.provider from app.integration_connections c
    where c.token_enc is not null and c.state in ('connected', 'attention') and c.token_expires_at is not null
      and c.token_expires_at < pg_catalog.now() + pg_catalog.make_interval(secs => greatest(60, least(coalesce(p_within_seconds, 900), 86400)))
    order by c.token_expires_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

-- Connected rows of every company (for the scheduled sync), by provider.
create or replace function public.conn_connected(p_limit integer default 200) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenant_id', x.tenant_id, 'provider', x.provider)), '[]'::jsonb)
  from (
    select c.tenant_id, c.provider from app.integration_connections c
    where c.state = 'connected'
    order by c.last_sync_at nulls first
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) x
$$;

revoke all on function public.conn_put(uuid, text, jsonb), public.conn_get(uuid, text), public.conn_delete(uuid, text),
  public.conn_by_account(text, text), public.conn_due_refresh(integer, integer), public.conn_connected(integer) from public, anon, authenticated;
grant execute on function public.conn_put(uuid, text, jsonb), public.conn_get(uuid, text), public.conn_delete(uuid, text),
  public.conn_by_account(text, text), public.conn_due_refresh(integer, integer), public.conn_connected(integer) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- OAuth state: one row per "Connect" click. Ties the provider's answer to the company, the provider and the person
-- who started it. Only the hash of the state value is stored; the PKCE verifier is sealed by the server; a row works
-- once and for ten minutes.
-- ---------------------------------------------------------------------------------------------------------------------
create table app.oauth_states (
  state_hash    text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  provider      text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  user_id       uuid not null,
  member_id     uuid not null,
  verifier_enc  text not null check (pg_catalog.length(verifier_enc) <= 1000),
  -- Where to send the browser afterwards. A path on this site only.
  return_to     text not null default '/' check (return_to ~ '^/[A-Za-z0-9/_?=&.-]{0,200}$' and return_to !~ '^//'),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  constraint oauth_states_member_fk foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade
);
create index oauth_states_tenant_idx on app.oauth_states (tenant_id, created_at desc);
create index oauth_states_expiry_idx on app.oauth_states (expires_at);
alter table app.oauth_states enable row level security;
alter table app.oauth_states force row level security;
revoke all on app.oauth_states from public, anon, authenticated, service_role;

-- Starts a connection. Called with the person's own token, so the database decides whether they may.
create or replace function public.oauth_state_put(
  p_tenant uuid, p_provider text, p_state_hash text, p_verifier_enc text, p_return_to text default '/', p_ttl_seconds integer default 600
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'integrations'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform app.require_stepup();
  v_member := app.current_member(p_tenant);
  insert into app.oauth_states (state_hash, tenant_id, provider, user_id, member_id, verifier_enc, return_to, expires_at)
  values (p_state_hash, p_tenant, p_provider, (select auth.uid()), v_member, p_verifier_enc, coalesce(p_return_to, '/'),
          pg_catalog.now() + pg_catalog.make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 600))));
  return v_member;
end
$$;
revoke all on function public.oauth_state_put(uuid, text, text, text, text, integer) from public, anon, service_role;
grant execute on function public.oauth_state_put(uuid, text, text, text, text, integer) to authenticated;

-- Uses a state up. Server only. The update is the test, so a state can never be taken twice.
create or replace function public.oauth_state_take(p_state_hash text, p_provider text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  update app.oauth_states s set used_at = pg_catalog.now()
   where s.state_hash = p_state_hash and s.provider = p_provider and s.used_at is null and s.expires_at > pg_catalog.now()
  returning s.tenant_id, s.provider, s.user_id, s.member_id, s.verifier_enc, s.return_to into r;
  if not found then return null; end if;
  return pg_catalog.to_jsonb(r);
end
$$;
revoke all on function public.oauth_state_take(text, text) from public, anon, authenticated;
grant execute on function public.oauth_state_take(text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Sync cursors: where each provider sync stopped (a page token, a history id, a timestamp), so the next run goes on
-- from there instead of starting over.
-- ---------------------------------------------------------------------------------------------------------------------
create table app.sync_cursors (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  provider    text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  resource    text not null check (resource ~ '^[a-z][a-z0-9_.]{1,60}$'),
  cursor      text check (pg_catalog.length(cursor) <= 2000),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, provider, resource)
);
alter table app.sync_cursors enable row level security;
alter table app.sync_cursors force row level security;
revoke all on app.sync_cursors from public, anon, authenticated, service_role;

create or replace function public.cursor_get(p_tenant uuid, p_provider text, p_resource text) returns text
language sql stable security definer
set search_path = ''
as $$ select c.cursor from app.sync_cursors c where c.tenant_id = p_tenant and c.provider = p_provider and c.resource = p_resource $$;

create or replace function public.cursor_set(p_tenant uuid, p_provider text, p_resource text, p_cursor text) returns void
language sql security definer
set search_path = ''
as $$
  insert into app.sync_cursors (tenant_id, provider, resource, cursor, updated_at)
  values (p_tenant, p_provider, p_resource, p_cursor, pg_catalog.now())
  on conflict (tenant_id, provider, resource) do update set cursor = excluded.cursor, updated_at = pg_catalog.now()
$$;
revoke all on function public.cursor_get(uuid, text, text), public.cursor_set(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cursor_get(uuid, text, text), public.cursor_set(uuid, text, text, text) to service_role;
