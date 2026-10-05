-- 0021 Sessions, the second sign-in step, and fresh identity checks
-- The server in api/ keeps the session in a sealed cookie. The database cannot see that cookie, so the rules that
-- must hold even if the server had a bug are enforced here, from what the database can see: the signed token of the
-- request (auth.jwt()) and a few server-written rows.
--
--   app.session_aal()        'aal1' or 'aal2', from the token's "aal" claim (aal2 = the second step was passed)
--   app.require_mfa(tenant)  raises unless the caller is an active member with a live session and, when the role is
--                            listed in the company's security.mfaRoles (or the person has an authenticator enrolled),
--                            a token at aal2. FOR THE GATEWAY: call it first in ws_load, ws_apply and protected functions.
--   app.require_stepup()     raises unless the server stamped this session after a fresh identity check in the last
--                            5 minutes. FOR PROTECTED FUNCTIONS: tax ID reveal, role changes, exports, connections.

-- ---------------------------------------------------------------------------------------------------------------------
-- Reading the token
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.session_aal() returns text
language sql stable
set search_path = ''
as $$ select case when (select auth.jwt()) ->> 'aal' = 'aal2' then 'aal2' else 'aal1' end $$;

create or replace function app.session_id() returns uuid
language sql stable
set search_path = ''
as $$
  select case when (select auth.jwt()) ->> 'session_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then ((select auth.jwt()) ->> 'session_id')::uuid end
$$;

-- When the token was issued, or NULL when the claim is missing.
create or replace function app.session_issued_at() returns timestamptz
language sql stable
set search_path = ''
as $$
  select case when (select auth.jwt()) ->> 'iat' ~ '^[0-9]{9,11}$'
              then pg_catalog.to_timestamp(((select auth.jwt()) ->> 'iat')::double precision) end
$$;

revoke all on function app.session_aal(), app.session_id(), app.session_issued_at() from public, anon;
grant execute on function app.session_aal(), app.session_id(), app.session_issued_at() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Revocations and fresh-check stamps
-- ---------------------------------------------------------------------------------------------------------------------

-- "Sign out everywhere": every token of this person issued before the mark is refused by the database at once.
-- (Supabase Auth revokes the refresh tokens, but an access token already issued stays valid until it expires.
-- This closes that gap for everything that goes through app.require_mfa.)
create table app.session_revocations (
  user_id         uuid primary key,
  revoked_before  timestamptz not null default now(),
  reason          text check (pg_catalog.length(reason) <= 60),
  by_user         uuid,
  updated_at      timestamptz not null default now()
);
alter table app.session_revocations enable row level security;
alter table app.session_revocations force row level security;
revoke all on app.session_revocations from public, anon, authenticated, service_role;

-- One row per session that passed a fresh identity check. Written only by the server (service role), after it
-- verified an authenticator code or the password again. A signed-in person cannot stamp their own session.
create table app.session_stamps (
  session_id  uuid primary key,
  user_id     uuid not null,
  stepup_at   timestamptz not null default now(),
  method      text not null check (method in ('totp', 'password')),
  created_at  timestamptz not null default now()
);
create index session_stamps_user_idx on app.session_stamps (user_id);
alter table app.session_stamps enable row level security;
alter table app.session_stamps force row level security;
revoke all on app.session_stamps from public, anon, authenticated, service_role;

-- Is the session behind this request still good?
--   1. no "sign out everywhere" mark newer than the token
--   2. where Supabase Auth's session table can be read, the session row still exists (it is deleted on sign-out)
create or replace function app.session_live() returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sid uuid := app.session_id();
  v_iat timestamptz := app.session_issued_at();
  v_found boolean;
begin
  if v_uid is null then return false; end if;
  if exists (
    select 1 from app.session_revocations r
    where r.user_id = v_uid and (v_iat is null or v_iat < pg_catalog.date_trunc('second', r.revoked_before))
  ) then
    return false;
  end if;
  if v_sid is not null and pg_catalog.to_regclass('auth.sessions') is not null then
    begin
      execute 'select exists (select 1 from auth.sessions s where s.id = $1 and s.user_id = $2)' into v_found using v_sid, v_uid;
      if not v_found then return false; end if;
    exception when insufficient_privilege or undefined_column then
      -- The migration role cannot read that table on this project: the revocation mark above is the rule that holds.
      null;
    end;
  end if;
  return true;
end
$$;

-- Does this person have an authenticator that finished enrolment? Read from Supabase Auth where it can be read.
create or replace function app.has_verified_factor() returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_found boolean := false;
begin
  if v_uid is null or pg_catalog.to_regclass('auth.mfa_factors') is null then return false; end if;
  begin
    execute 'select exists (select 1 from auth.mfa_factors f where f.user_id = $1 and f.status::text = ''verified'')' into v_found using v_uid;
  exception when insufficient_privilege or undefined_column then
    v_found := false;
  end;
  return coalesce(v_found, false);
end
$$;

-- Must this person pass the second step to use this company? Yes when their role is on the list, or when they have
-- an authenticator enrolled (once someone turns the second step on, a password alone is never enough again).
create or replace function app.mfa_needed(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(app.member_role(p_tenant) = any (app.mfa_roles(p_tenant)), false) or app.has_verified_factor() $$;

-- The guard. Calls from the server key or from a direct database session are let through: they are not a person,
-- and they are already outside row level security.
create or replace function app.require_mfa(p_tenant uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if app.jwt_role() in ('service_role', '') then return; end if;
  if app.member_role(p_tenant) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not app.session_live() then
    raise exception 'session_revoked' using errcode = 'VX401';
  end if;
  if app.session_aal() <> 'aal2' and app.mfa_needed(p_tenant) then
    raise exception 'mfa_required' using errcode = 'VX402';
  end if;
end
$$;

create or replace function app.require_stepup(p_seconds integer default 300) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if app.jwt_role() in ('service_role', '') then return; end if;
  if not exists (
    select 1 from app.session_stamps s
    where s.session_id = app.session_id() and s.user_id = (select auth.uid())
      and s.stepup_at > pg_catalog.now() - pg_catalog.make_interval(secs => greatest(30, least(coalesce(p_seconds, 300), 900)))
  ) then
    raise exception 'stepup_required' using errcode = 'VX403';
  end if;
end
$$;

revoke all on function app.session_live(), app.has_verified_factor(), app.mfa_needed(uuid), app.require_mfa(uuid), app.require_stepup(integer)
  from public, anon;
grant execute on function app.session_live(), app.has_verified_factor(), app.mfa_needed(uuid), app.require_mfa(uuid), app.require_stepup(integer)
  to authenticated, service_role;

-- Server only: stamp a session after a fresh identity check.
create or replace function public.session_stepup_mark(p_user uuid, p_session uuid, p_method text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_user is null or p_session is null then
    raise exception 'A person and a session are required' using errcode = '22023';
  end if;
  insert into app.session_stamps (session_id, user_id, stepup_at, method)
  values (p_session, p_user, pg_catalog.now(), p_method)
  on conflict (session_id) do update set stepup_at = pg_catalog.now(), method = excluded.method, user_id = excluded.user_id;
  perform app.security_event(null, p_user, 'stepup.ok', 'ok', null, pg_catalog.jsonb_build_object('method', p_method));
end
$$;

-- Server only: "sign out everywhere" for one person (their own request, a password reset, or offboarding).
create or replace function public.session_revoke_user(p_user uuid, p_reason text default 'signout_all', p_ip_hash text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_user is null then raise exception 'A person is required' using errcode = '22023'; end if;
  insert into app.session_revocations (user_id, revoked_before, reason, by_user, updated_at)
  values (p_user, pg_catalog.now(), pg_catalog.left(p_reason, 60), null, pg_catalog.now())
  on conflict (user_id) do update set revoked_before = pg_catalog.now(), reason = excluded.reason, by_user = null, updated_at = pg_catalog.now();
  delete from app.session_stamps s where s.user_id = p_user;
  perform app.security_event(null, p_user, 'session.revoked_all', 'ok', p_ip_hash, pg_catalog.jsonb_build_object('reason', pg_catalog.left(p_reason, 60)));
end
$$;
revoke all on function public.session_stepup_mark(uuid, uuid, text), public.session_revoke_user(uuid, text, text) from public, anon, authenticated;
grant execute on function public.session_stepup_mark(uuid, uuid, text), public.session_revoke_user(uuid, text, text) to service_role;

-- A member with the "users" capability ends every session of another member of the same company (a lost laptop,
-- someone leaving). Needs a fresh identity check. The person can sign in again unless they were also disabled.
create or replace function public.session_revoke_member(p_tenant uuid, p_member uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'users'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform app.require_stepup();
  select m.user_id into v_user from public.tenant_members m where m.tenant_id = p_tenant and m.id = p_member;
  if v_user is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into app.session_revocations (user_id, revoked_before, reason, by_user, updated_at)
  values (v_user, pg_catalog.now(), 'by_admin', (select auth.uid()), pg_catalog.now())
  on conflict (user_id) do update set revoked_before = pg_catalog.now(), reason = 'by_admin', by_user = (select auth.uid()), updated_at = pg_catalog.now();
  delete from app.session_stamps s where s.user_id = v_user;
  perform app.security_event(p_tenant, (select auth.uid()), 'session.revoked_by_admin', 'ok', null, pg_catalog.jsonb_build_object('member', p_member));
end
$$;
revoke all on function public.session_revoke_member(uuid, uuid) from public, anon, service_role;
grant execute on function public.session_revoke_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Recovery codes for the second step. Ten one-time codes, shown once at enrolment. Only a hash is stored
-- (SHA-256 of "<user id>:<code>"; a code carries 80 random bits, so a plain hash cannot be reversed by guessing).
-- ---------------------------------------------------------------------------------------------------------------------
create table app.mfa_recovery_codes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  unique (user_id, code_hash)
);
alter table app.mfa_recovery_codes enable row level security;
alter table app.mfa_recovery_codes force row level security;
revoke all on app.mfa_recovery_codes from public, anon, authenticated, service_role;

-- Replaces the caller's codes with a new set. Only right after the second step was passed (aal2), with a live session.
create or replace function public.mfa_recovery_set(p_hashes text[]) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  h text;
begin
  if v_uid is null or app.session_aal() <> 'aal2' or not app.session_live() then
    raise exception 'mfa_required' using errcode = 'VX402';
  end if;
  if p_hashes is null or pg_catalog.cardinality(p_hashes) not between 5 and 20 then
    raise exception 'Between 5 and 20 codes are required' using errcode = '22023';
  end if;
  delete from app.mfa_recovery_codes c where c.user_id = v_uid;
  foreach h in array p_hashes loop
    insert into app.mfa_recovery_codes (user_id, code_hash) values (v_uid, h) on conflict do nothing;
  end loop;
  perform app.security_event(null, v_uid, 'mfa.recovery_codes_set', 'ok', null, pg_catalog.jsonb_build_object('count', pg_catalog.cardinality(p_hashes)));
  return pg_catalog.cardinality(p_hashes);
end
$$;
revoke all on function public.mfa_recovery_set(text[]) from public, anon, service_role;
grant execute on function public.mfa_recovery_set(text[]) to authenticated;

-- Server only: uses one code, once. True when the code was valid and unused. The update is the test, so two requests
-- with the same code cannot both win.
create or replace function public.mfa_recovery_use(p_user uuid, p_hash text, p_ip_hash text default null) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  update app.mfa_recovery_codes c set used_at = pg_catalog.now()
   where c.user_id = p_user and c.code_hash = p_hash and c.used_at is null
  returning c.id into v_id;
  if v_id is null then
    perform app.security_event(null, p_user, 'mfa.recovery_failed', 'failed', p_ip_hash, '{}'::jsonb);
    return false;
  end if;
  perform app.security_event(null, p_user, 'mfa.recovery_used', 'ok', p_ip_hash,
    pg_catalog.jsonb_build_object('left', (select pg_catalog.count(*) from app.mfa_recovery_codes c where c.user_id = p_user and c.used_at is null)));
  return true;
end
$$;

-- Server only: forget a person's codes (when their authenticator is removed).
create or replace function public.mfa_recovery_clear(p_user uuid) returns void
language sql security definer
set search_path = ''
as $$ delete from app.mfa_recovery_codes c where c.user_id = p_user $$;
revoke all on function public.mfa_recovery_use(uuid, text, text), public.mfa_recovery_clear(uuid) from public, anon, authenticated;
grant execute on function public.mfa_recovery_use(uuid, text, text), public.mfa_recovery_clear(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- public.auth_context(): everything the server needs to answer "who am I" in one call, made with the person's token.
-- For each company: role, capabilities (with the company's own overrides applied), whether the second
-- step is required there, and the idle timeout. Nothing here is taken from the browser.
-- ---------------------------------------------------------------------------------------------------------------------
-- Capabilities of the caller in one company, as a JSON list. The gateway range (0010) keeps them in
-- app.my_permissions; on a database without that range they are worked out from the role matrix of 0003.
create or replace function app.capabilities_of(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if pg_catalog.to_regprocedure('app.my_permissions(uuid)') is not null then
    execute 'select pg_catalog.to_jsonb(app.my_permissions($1))' into v using p_tenant;
  else
    v := pg_catalog.to_jsonb(app.role_permissions(app.member_role(p_tenant)));
  end if;
  return coalesce(v, '[]'::jsonb);
end
$$;
revoke all on function app.capabilities_of(uuid) from public, anon, authenticated, service_role;

create or replace function public.auth_context() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'user_id', v_uid,
    'aal', app.session_aal(),
    'session_id', app.session_id(),
    'live', app.session_live(),
    'has_factor', app.has_verified_factor(),
    'recovery_codes_left', (select pg_catalog.count(*) from app.mfa_recovery_codes c where c.user_id = v_uid and c.used_at is null),
    'stepup_at', (select s.stepup_at from app.session_stamps s where s.session_id = app.session_id() and s.user_id = v_uid),
    'memberships', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'industry', t.industry_id, 'plan', t.plan_id, 'status', t.status,
        'member_id', m.id, 'role', m.role, 'worker_id', m.worker_id, 'member_name', m.name,
        'capabilities', app.capabilities_of(t.id),
        'mfa_required', app.mfa_needed(t.id),
        'idle_minutes', app.idle_minutes(t.id)
      ) order by t.name)
      from public.tenant_members m
      join public.tenants t on t.id = m.tenant_id
      where m.user_id = v_uid and m.status = 'active' and t.status <> 'closed'), '[]'::jsonb)
  );
end
$$;
revoke all on function public.auth_context() from public, anon, service_role;
grant execute on function public.auth_context() to authenticated;
