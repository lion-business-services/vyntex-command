-- 0020 Server core: settings and security events
-- First file of the server range (0020 to 0029). These tables belong to the backend in api/, not to a screen:
-- sessions, invitations, rate limits, the job queue, connections to outside services, webhook events.
--
-- Where they live, and why: schema "app", not "public". Schema app is not listed in the Data API "exposed schemas",
-- so no browser key and no signed-in person can read or write these tables directly, whatever a policy says.
-- Row level security is still enabled and forced on each of them with no policy at all (deny everything), and no
-- application role holds a table privilege. The only way in is a function in this range that checks who is asking.
-- Functions meant for the server alone are granted to service_role only. Nothing is executable by anon.
--
-- Custom error codes raised by the guards in this range (api/_lib/respond.js maps them to answers for the browser):
--   VX401  the session was revoked            VX402  a second sign-in step is required
--   VX403  a fresh identity check is required  VX429  too many attempts

-- ---------------------------------------------------------------------------------------------------------------------
-- Server settings: a few values the platform operator sets per database (VYNTEX and LBS are separate databases).
--   security.defaults  used when a company has not chosen its own value
--   security.required  always enforced on top of the company's choice: a company can add roles, never remove these
-- LBS sets security.required.mfaRoles to every office role at setup (docs/SERVER.md).
-- ---------------------------------------------------------------------------------------------------------------------
create table app.server_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  value       jsonb not null check (pg_catalog.jsonb_typeof(value) = 'object'),
  updated_at  timestamptz not null default now()
);
alter table app.server_settings enable row level security;
alter table app.server_settings force row level security;
revoke all on app.server_settings from public, anon, authenticated, service_role;
create trigger server_settings_touch before update on app.server_settings for each row execute function app.touch_updated_at();

insert into app.server_settings (key, value) values
  ('security.defaults', '{"mfaRoles": [], "idleMinutes": 30}'::jsonb),
  ('security.required', '{"mfaRoles": []}'::jsonb)
on conflict (key) do nothing;

create or replace function app.server_setting(p_key text) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select coalesce((select s.value from app.server_settings s where s.key = p_key), '{}'::jsonb) $$;
revoke all on function app.server_setting(text) from public, anon, authenticated, service_role;

-- The "security" part of a company's configuration, merged over the defaults.
-- The configuration column (tenants.config) is added by the gateway range (0010 to 0019). On a database that does not
-- have it yet the older settings column is read, so this file applies cleanly either way.
create or replace function app.tenant_security(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.tenants'::pg_catalog.regclass and a.attname = 'config' and not a.attisdropped
  ) then
    execute 'select t.config -> ''security'' from public.tenants t where t.id = $1' into v using p_tenant;
  end if;
  if v is null or pg_catalog.jsonb_typeof(v) <> 'object' then
    select t.settings -> 'security' into v from public.tenants t where t.id = p_tenant;
  end if;
  if v is null or pg_catalog.jsonb_typeof(v) <> 'object' then
    v := '{}'::jsonb;
  end if;
  return app.server_setting('security.defaults') || v;
end
$$;

-- Roles that must pass the second sign-in step in this company: the company's list plus the operator's required list.
create or replace function app.mfa_roles(p_tenant uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct r.role), '{}'::text[])
  from (
    select pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(app.tenant_security(p_tenant) -> 'mfaRoles') = 'array'
           then app.tenant_security(p_tenant) -> 'mfaRoles' else '[]'::jsonb end) as role
    union all
    select pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(app.server_setting('security.required') -> 'mfaRoles') = 'array'
           then app.server_setting('security.required') -> 'mfaRoles' else '[]'::jsonb end)
  ) r
$$;

-- Minutes without activity before a session ends: the company's value, kept between 5 minutes and 12 hours, and
-- never longer than the operator's required value when one is set.
create or replace function app.idle_minutes(p_tenant uuid) returns integer
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_company text := app.tenant_security(p_tenant) ->> 'idleMinutes';
  v_cap text := app.server_setting('security.required') ->> 'idleMinutes';
  v integer := 30;
begin
  if v_company ~ '^[0-9]{1,4}$' then v := v_company::integer; end if;
  if v_cap ~ '^[0-9]{1,4}$' then v := least(v, v_cap::integer); end if;
  return greatest(5, least(v, 720));
end
$$;

revoke all on function app.tenant_security(uuid), app.mfa_roles(uuid), app.idle_minutes(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Security events: failed sign-ins, lockouts, changes to the second sign-in step, role changes, exports, rejected
-- webhooks. Typed and indexed so trends can be counted (docs/SERVER.md, "monitoring"). Each event that belongs to a
-- company or a known person is also copied into the audit log of 0004, which stays the one trail an owner reads.
-- Append only, like the audit log: no update, no delete, no truncate, for anyone.
-- ---------------------------------------------------------------------------------------------------------------------
create table app.security_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  -- NULL when the event belongs to no company (a failed sign-in for an address nobody has).
  tenant_id     uuid references public.tenants (id) on delete restrict,
  -- auth.users id of the person concerned, when known.
  user_id       uuid,
  kind          text not null check (kind ~ '^[a-z][a-z0-9_.]{2,60}$'),
  outcome       text not null check (outcome in ('ok', 'denied', 'failed', 'locked', 'info')),
  severity      text not null check (severity in ('info', 'notice', 'warning', 'high')),
  -- Keyed hash of the caller address, made by the server. Never the address.
  ip_hash       text check (ip_hash ~ '^[0-9a-f]{16,128}$'),
  -- Keyed hash of what was typed as the account (the email at sign-in), so attempts on one account can be counted
  -- without storing an address that may belong to nobody.
  subject_hash  text check (subject_hash ~ '^[0-9a-f]{16,128}$'),
  -- Small facts about the event. Never a secret: app.safe_meta() drops anything that looks like one.
  meta          jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(meta) = 'object')
);
create index security_events_tenant_idx on app.security_events (tenant_id, at desc);
create index security_events_kind_idx on app.security_events (kind, at desc);
create index security_events_user_idx on app.security_events (user_id, at desc) where user_id is not null;
create index security_events_subject_idx on app.security_events (subject_hash, at desc) where subject_hash is not null;

alter table app.security_events enable row level security;
alter table app.security_events force row level security;
revoke all on app.security_events from public, anon, authenticated, service_role;
create trigger security_events_append_only before update or delete on app.security_events
  for each row execute function app.block_change();
create trigger security_events_no_truncate before truncate on app.security_events
  for each statement execute function app.block_change();

-- Keeps only short, harmless facts: drops any key whose name suggests a secret or an identity number, cuts long text,
-- and keeps one level only. This is a second line of defence: callers are expected to pass nothing sensitive.
create or replace function app.safe_meta(p_meta jsonb) returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(
    e.key,
    case pg_catalog.jsonb_typeof(e.value)
      when 'string' then pg_catalog.to_jsonb(pg_catalog.left(e.value #>> '{}', 200))
      when 'number' then e.value
      when 'boolean' then e.value
      else pg_catalog.to_jsonb(pg_catalog.left(e.value::text, 200))
    end), '{}'::jsonb)
  from (
    select x.key, x.value
    from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end) x
    where x.key !~* '(pass|secret|token|code|key|authorization|cookie|ssn|tax|otp|verifier|signature)'
      and pg_catalog.jsonb_typeof(x.value) <> 'null'
    order by x.key
    limit 20
  ) e
$$;

create or replace function app.security_severity(p_kind text, p_outcome text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_outcome = 'locked' then 'warning'
    when p_kind in ('member.role_changed', 'member.removed', 'member.disabled', 'mfa.recovery_used', 'mfa.removed',
                    'session.revoked_by_admin', 'integration.disconnected', 'password.reset') then 'warning'
    when p_kind like 'export.%' or p_kind like 'vault.%' then 'warning'
    when p_outcome in ('denied', 'failed') then 'notice'
    else 'info'
  end
$$;

-- Records one security event. With a person but no company, one row is written per company the person belongs to,
-- so the owner of each company sees what concerns their member. Internal: reached only through the functions below.
create or replace function app.security_event(
  p_tenant uuid, p_user uuid, p_kind text, p_outcome text,
  p_ip_hash text default null, p_meta jsonb default '{}'::jsonb, p_subject_hash text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_meta jsonb := app.safe_meta(p_meta);
  v_sev text := app.security_severity(p_kind, p_outcome);
  v_ip text := case when p_ip_hash ~ '^[0-9a-f]{16,128}$' then p_ip_hash end;
  v_subject text := case when p_subject_hash ~ '^[0-9a-f]{16,128}$' then p_subject_hash end;
  v_tenants uuid[];
  t uuid;
begin
  if p_tenant is not null then
    v_tenants := array[p_tenant];
  elsif p_user is not null then
    select pg_catalog.array_agg(m.tenant_id) into v_tenants from public.tenant_members m where m.user_id = p_user;
  end if;

  if v_tenants is null or pg_catalog.cardinality(v_tenants) = 0 then
    insert into app.security_events (tenant_id, user_id, kind, outcome, severity, ip_hash, subject_hash, meta)
    values (null, p_user, p_kind, p_outcome, v_sev, v_ip, v_subject, v_meta);
    -- An event with a known person and no company still belongs in the audit trail. One with neither stays here only.
    if p_user is not null then
      insert into public.audit_log (tenant_id, actor, actor_role, action, table_name, row_id, old_data, new_data, ip_hash)
      values (null, p_user, 'system', p_kind, 'security', null, null, v_meta || pg_catalog.jsonb_build_object('outcome', p_outcome), v_ip);
    end if;
    return;
  end if;

  foreach t in array v_tenants loop
    insert into app.security_events (tenant_id, user_id, kind, outcome, severity, ip_hash, subject_hash, meta)
    values (t, p_user, p_kind, p_outcome, v_sev, v_ip, v_subject, v_meta);
    insert into public.audit_log (tenant_id, actor, actor_role, action, table_name, row_id, old_data, new_data, ip_hash)
    values (
      t, p_user,
      coalesce((select m.role from public.tenant_members m where m.tenant_id = t and m.user_id = p_user), 'system'),
      p_kind, 'security', null, null, v_meta || pg_catalog.jsonb_build_object('outcome', p_outcome), v_ip);
  end loop;
end
$$;
revoke all on function app.safe_meta(jsonb), app.security_severity(text, text),
  app.security_event(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated, service_role;

-- The server's door to app.security_event. Service role only: an event must be recordable when nobody is signed in
-- (a failed sign-in), and a signed-in person must not be able to write or leave out events about themselves.
create or replace function public.security_event(
  p_tenant uuid, p_user uuid, p_kind text, p_outcome text,
  p_ip_hash text default null, p_meta jsonb default '{}'::jsonb, p_subject_hash text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.security_event(p_tenant, p_user, p_kind, p_outcome, p_ip_hash, p_meta, p_subject_hash);
end
$$;
revoke all on function public.security_event(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.security_event(uuid, uuid, text, text, text, jsonb, text) to service_role;

-- Membership changes become security events as well (the row change itself is already in the audit log, 0004).
create or replace function app.member_security_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    perform app.security_event(new.tenant_id, v_actor, 'member.added', 'ok', null,
      pg_catalog.jsonb_build_object('member', new.id, 'role', new.role));
  elsif tg_op = 'DELETE' then
    perform app.security_event(old.tenant_id, v_actor, 'member.removed', 'ok', null,
      pg_catalog.jsonb_build_object('member', old.id, 'role', old.role));
  else
    if new.role is distinct from old.role then
      perform app.security_event(new.tenant_id, v_actor, 'member.role_changed', 'ok', null,
        pg_catalog.jsonb_build_object('member', new.id, 'from', old.role, 'to', new.role));
    end if;
    if new.status is distinct from old.status then
      perform app.security_event(new.tenant_id, v_actor,
        case when new.status = 'disabled' then 'member.disabled' else 'member.status_changed' end, 'ok', null,
        pg_catalog.jsonb_build_object('member', new.id, 'from', old.status, 'to', new.status));
    end if;
  end if;
  return null;
end
$$;
revoke all on function app.member_security_event() from public, anon, authenticated, service_role;
create trigger tenant_members_security_event after insert or update of role, status or delete on public.tenant_members
  for each row execute function app.member_security_event();

-- May this person read the security trail of this company? The "audit" capability arrives with the gateway range;
-- the owner can always read it.
create or replace function app.can_read_security(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(app.can(p_tenant, 'audit'), false) or coalesce(app.has_role(p_tenant, array['owner']), false) $$;
revoke all on function app.can_read_security(uuid) from public, anon, authenticated, service_role;

-- Recent security events of one company, newest first. Read only, for the security screen.
create or replace function public.security_events_list(p_tenant uuid, p_limit integer default 100, p_before bigint default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.can_read_security(p_tenant) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id desc)
    from (
      select s.id, s.at, s.user_id, s.kind, s.outcome, s.severity, s.meta
      from app.security_events s
      where s.tenant_id = p_tenant and (p_before is null or s.id < p_before)
      order by s.id desc
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) e), '[]'::jsonb);
end
$$;

-- Counts per day and kind for the last days, for the trend view (failed sign-ins, reveals, exports, webhook failures).
create or replace function public.security_summary(p_tenant uuid, p_days integer default 7) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.can_read_security(p_tenant) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.day desc, x.kind)
    from (
      select (s.at at time zone 'UTC')::date as day, s.kind, s.outcome, pg_catalog.count(*) as count
      from app.security_events s
      where s.tenant_id = p_tenant and s.at > pg_catalog.now() - pg_catalog.make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
      group by 1, 2, 3
    ) x), '[]'::jsonb);
end
$$;
revoke all on function public.security_events_list(uuid, integer, bigint), public.security_summary(uuid, integer) from public, anon, service_role;
grant execute on function public.security_events_list(uuid, integer, bigint), public.security_summary(uuid, integer) to authenticated;

-- Companies whose recent events crossed a line worth telling the owner about. Read by the scheduled job
-- "security.alerts" (api/_lib/jobs/handlers.js), which sends one notice per company, kind and hour.
create or replace function public.security_alerts_due(p_minutes integer default 60) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a)), '[]'::jsonb)
  from (
    select s.tenant_id, s.kind, pg_catalog.count(*) as count,
           (select coalesce(pg_catalog.jsonb_agg(m.email), '[]'::jsonb) from public.tenant_members m
             where m.tenant_id = s.tenant_id and m.role = 'owner' and m.status = 'active' and m.email is not null) as owners
    from app.security_events s
    where s.tenant_id is not null
      and s.at > pg_catalog.now() - pg_catalog.make_interval(mins => greatest(5, least(coalesce(p_minutes, 60), 1440)))
    group by s.tenant_id, s.kind
    having pg_catalog.count(*) >= case
      when s.kind = 'signin.failed' then 10
      when s.kind = 'signin.locked' then 1
      when s.kind like 'vault.reveal%' then 10
      when s.kind like 'export.%' then 5
      when s.kind = 'webhook.rejected' then 20
      when s.kind = 'integration.error' then 5
      when s.kind in ('member.role_changed', 'mfa.recovery_used') then 1
      else 2147483647
    end
  ) a
$$;
revoke all on function public.security_alerts_due(integer) from public, anon, authenticated;
grant execute on function public.security_alerts_due(integer) to service_role;
