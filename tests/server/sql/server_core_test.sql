-- Database tests for the server range (supabase/migrations/0020 to 0029).
-- Run by tests/server/db.e2e.test.mjs as the local superuser, on the database prepared by tests/server/pg_local.sh.
-- Every check goes through t.ok() or t.is(), which RAISE on failure, so the run stops at the first broken rule.
-- A "signed-in person" is imitated the way the Data API does it: request.jwt.claims plus "set role authenticated".

\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

drop schema if exists t cascade;
create schema t;
grant usage on schema t to public;
create table t.results (n bigserial primary key, section text, label text not null);
create table t.ids (key text primary key, id uuid not null);
create table t.section (name text);
insert into t.section values ('setup');
grant select on t.ids to public;

create function t.id(k text) returns uuid language sql stable security definer set search_path = '' as $$ select i.id from t.ids i where i.key = k $$;
create function t.remember(k text, v uuid) returns uuid language plpgsql as $$ begin insert into t.ids values (k, v) on conflict (key) do update set id = excluded.id; return v; end $$;
create function t.section(s text) returns void language sql as $$ update t.section set name = s $$;
create function t.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', label; end if;
  insert into t.results (section, label) select name, label from t.section;
end $$;
create function t.is(got text, want text, label text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAILED: % (got %, expected %)', label, coalesce(got, 'NULL'), coalesce(want, 'NULL'); end if;
  insert into t.results (section, label) select name, label from t.section;
end $$;

-- who: a key in t.ids (signed-in person), 'anon', or 'service'. extra: more claims, for example {"aal":"aal2"}.
create function t.login(who text, extra jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin
  if who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', false);
    perform set_config('role', 'anon', false);
  elsif who = 'service' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
    perform set_config('role', 'service_role', false);
  else
    if t.id(who) is null then raise exception 'unknown test user %', who; end if;
    perform set_config('request.jwt.claims',
      (jsonb_build_object('sub', t.id(who), 'role', 'authenticated', 'iat', extract(epoch from now())::bigint, 'session_id', t.id(who || '.session')) || extra)::text, false);
    perform set_config('role', 'authenticated', false);
  end if;
end $$;
create function t.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
end $$;
-- Runs one statement as someone. 'rows:<n>', 'value:<text>' for a single value, or 'error:<sqlstate>'.
-- (A function that returns nothing is called as  <function>(...) is not null : that is true when it ran without raising.)
create function t.as(who text, q text, extra jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare r text; n bigint;
begin
  perform t.login(who, extra);
  begin
    if q ~* '^\s*select\M' then
      execute 'select (' || regexp_replace(q, '^\s*select\M', '', 'i') || ')::text' into r;
      r := 'value:' || coalesce(r, 'NULL');
    else
      execute q; get diagnostics n = row_count; r := 'rows:' || n;
    end if;
  exception when others then r := 'error:' || sqlstate;
  end;
  perform t.logout();
  return r;
end $$;
-- Runs one statement as the test runner (the local superuser). 'done', or 'error:<sqlstate>'.
create function t.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'done';
exception when others then
  return 'error:' || sqlstate;
end $$;
create function t.sha(s text) returns text language sql immutable as $$ select encode(extensions.digest(s, 'sha256'), 'hex') $$;

-- =====================================================================================================================
-- Sample data: two companies, each with an owner, a manager and a staff member; one person with no company.
-- =====================================================================================================================
create function t.user(k text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email) values (k || '@example.com') returning id into v;
  perform t.remember(k || '.session', gen_random_uuid());
  return t.remember(k, v);
end $$;
create function t.company(p text, p_slug text) returns void language plpgsql as $$
declare v_t uuid; v_m uuid; r text;
begin
  insert into public.tenants (slug, name, industry_id, plan_id, status) values (p_slug, 'Sample Company ' || upper(p), 'build', 'builder', 'active') returning id into v_t;
  perform t.remember(p, v_t);
  foreach r in array array['owner', 'manager', 'staff'] loop
    insert into public.tenant_members (tenant_id, user_id, role, name, email) values (v_t, t.user(p || '_' || r), r, initcap(r) || ' ' || upper(p), p || '_' || r || '@example.com') returning id into v_m;
    perform t.remember(p || '_' || r || '.member', v_m);
  end loop;
end $$;
select t.company('a', 'server-test-a') \g /dev/null
select t.company('b', 'server-test-b') \g /dev/null
select t.user('nobody') \g /dev/null

-- The local stand-in for Supabase Auth's session and factor tables (created by scripts/dev-supabase.mjs when it starts;
-- created here as well so this file can run on its own).
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz not null default now(), aal text not null default 'aal1', factor_id uuid);
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, friendly_name text, factor_type text not null, status text not null default 'unverified', secret text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
grant select on auth.sessions, auth.mfa_factors to postgres;
insert into auth.sessions (id, user_id) select t.id(k || '.session'), t.id(k) from unnest(array['a_owner', 'a_manager', 'a_staff', 'b_owner', 'b_manager', 'b_staff', 'nobody']) k on conflict do nothing;

-- a fresh identity check for the owners (what the server writes after verifying a code or the password)
create function t.stepup(who text) returns void language plpgsql as $$
begin
  perform t.login('service');
  perform public.session_stepup_mark(t.id(who), t.id(who || '.session'), 'password');
  perform t.logout();
end $$;

-- =====================================================================================================================
select t.section('1. catalog') \g /dev/null
-- =====================================================================================================================
select t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r'
               and c.relname in ('server_settings', 'security_events', 'session_revocations', 'session_stamps', 'mfa_recovery_codes', 'invitations',
                                 'rate_limits', 'rate_locks', 'idempotency_keys', 'jobs', 'integration_connections', 'oauth_states', 'sync_cursors', 'webhook_events')) = 14,
  'the 14 server tables exist in schema app') \g /dev/null
select t.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'app' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
  'every table in schema app has row level security enabled and forced') \g /dev/null
select t.ok(not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app'),
  'no table in schema app has a policy: deny everything, functions only') \g /dev/null
select t.ok(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['anon', 'authenticated', 'service_role']) r(role),
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
    where n.nspname = 'app' and c.relkind in ('r', 'p') and has_table_privilege(r.role, c.oid, p.priv)),
  'no application role holds any privilege on a table in schema app') \g /dev/null
-- (functions a later range lists in app.anon_functions, token-addressed public pages, are that range's decision)
create function t.anon_allowed(p_oid oid) returns boolean language plpgsql stable as $$
declare v boolean := false;
begin
  if to_regclass('app.anon_functions') is not null then
    execute 'select exists (select 1 from app.anon_functions a where a.signature = $1::regprocedure::text)' into v using p_oid;
  end if;
  return v;
end $$;
select t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE') and not t.anon_allowed(p.oid)),
  'anon cannot execute any function in public or app') \g /dev/null
select t.ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'anon cannot use schema app') \g /dev/null
select t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'app') and p.prosecdef
                 and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')),
  'every SECURITY DEFINER function has a fixed search_path') \g /dev/null
select t.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname in ('security_event', 'security_alerts_due', 'session_stepup_mark', 'session_revoke_user', 'mfa_recovery_use', 'mfa_recovery_clear',
        'invite_claim', 'invite_peek', 'invite_release', 'invite_complete', 'invite_bootstrap', 'rate_hit', 'rate_lock_state', 'rate_lock_fail', 'rate_lock_clear',
        'signin_gate', 'signin_result', 'idem_begin', 'idem_finish', 'idem_abort', 'job_enqueue', 'job_claim', 'job_finish', 'job_fail', 'job_requeue', 'job_stats',
        'conn_put', 'conn_get', 'conn_delete', 'conn_by_account', 'conn_due_refresh', 'conn_connected', 'oauth_state_take', 'cursor_get', 'cursor_set',
        'webhook_receive', 'webhook_reject', 'webhook_mark', 'webhook_get', 'server_sweep')),
  'the 40 server-only functions cannot be executed by a signed-in person') \g /dev/null
select t.ok(not has_function_privilege('service_role', 'public.invite_bootstrap(uuid, text, integer)', 'EXECUTE'),
  'the first-owner invitation can only be made by the platform operator, not by the server key') \g /dev/null
select t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'app' and p.proname in ('security_event', 'rate_hit', 'lock_fail', 'lock_clear', 'job_claim', 'job_enqueue', 'idem_begin', 'server_setting')
                 and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  'the internal functions in app cannot be called directly by any application role') \g /dev/null

-- direct table access is refused for everyone but the migration role
do $$
declare r record; who text; res text;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r'
             and c.relname in ('server_settings', 'security_events', 'session_revocations', 'session_stamps', 'mfa_recovery_codes', 'invitations',
                               'rate_limits', 'rate_locks', 'idempotency_keys', 'jobs', 'integration_connections', 'oauth_states', 'sync_cursors', 'webhook_events') loop
    foreach who in array array['a_owner', 'service', 'anon'] loop
      perform t.login(who);
      begin execute format('select count(*) from app.%I', r.relname) into res; exception when others then res := 'error:' || sqlstate; end;
      perform t.logout();
      perform t.is(res, 'error:42501', format('%s cannot read app.%s directly', who, r.relname));
      perform t.login(who);
      begin execute format('delete from app.%I', r.relname); res := 'done'; exception when others then res := 'error:' || sqlstate; end;
      perform t.logout();
      perform t.is(res, 'error:42501', format('%s cannot delete from app.%s directly', who, r.relname));
    end loop;
  end loop;
end $$;

-- =====================================================================================================================
select t.section('2. sign-in rules in SQL: member, live session, second step, fresh check') \g /dev/null
-- =====================================================================================================================
select t.is(app.session_aal(), 'aal1', 'no token means aal1') \g /dev/null
select t.is(t.as('a_owner', 'select app.session_aal()'), 'value:aal1', 'a token without the claim is aal1') \g /dev/null
select t.is(t.as('a_owner', 'select app.session_aal()', '{"aal":"aal2"}'), 'value:aal2', 'the aal claim is read') \g /dev/null
select t.is(t.as('a_owner', 'select app.session_aal()', '{"aal":"aal9"}'), 'value:aal1', 'an unknown aal value is treated as aal1') \g /dev/null

select t.is(t.as('a_owner', format('select app.require_mfa(%L) is not null', t.id('a'))), 'value:true', 'a member with a live session passes the guard when no second step is required') \g /dev/null
select t.is(t.as('a_owner', format('select app.require_mfa(%L) is not null', t.id('b'))), 'error:42501', 'the guard refuses a company the person does not belong to') \g /dev/null
select t.is(t.as('nobody', format('select app.require_mfa(%L) is not null', t.id('a'))), 'error:42501', 'the guard refuses a person with no company') \g /dev/null
select t.is(t.as('anon', format('select app.require_mfa(%L) is not null', t.id('a'))), 'error:42501', 'the guard is not callable by anon') \g /dev/null

-- second step required by the company's configuration
update public.tenants set config = jsonb_build_object('security', jsonb_build_object('mfaRoles', jsonb_build_array('owner', 'manager'), 'idleMinutes', 20)) where id = t.id('a');
select t.is(t.as('a_owner', format('select app.require_mfa(%L) is not null', t.id('a'))), 'error:VX402', 'role listed in security.mfaRoles: aal1 is refused (mfa_required)') \g /dev/null
select t.is(t.as('a_owner', format('select app.require_mfa(%L) is not null', t.id('a')), '{"aal":"aal2"}'), 'value:true', 'the same person at aal2 passes') \g /dev/null
select t.is(t.as('a_staff', format('select app.require_mfa(%L) is not null', t.id('a'))), 'value:true', 'a role not on the list passes at aal1') \g /dev/null
select t.is(t.as('a_owner', format('select public.vx_ws_load(%L) is not null', t.id('a'))), 'error:VX402', 'the workspace does not load below aal2 for a listed role') \g /dev/null
select t.is(t.as('a_owner', format('select public.vx_ws_load(%L) is not null', t.id('a')), '{"aal":"aal2"}'), 'value:true', 'and loads at aal2') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.vx_ws_apply(%L, '[]'::jsonb, 'k-00000001') is not null$q$, t.id('a'))), 'error:VX402', 'changes are refused below aal2 as well') \g /dev/null
select t.is(t.as('a_owner', 'select (public.auth_context() -> ''memberships'' -> 0 ->> ''mfa_required'')'), 'value:true', 'auth_context reports that the second step is required') \g /dev/null
select t.is(t.as('a_owner', 'select (public.auth_context() -> ''memberships'' -> 0 ->> ''idle_minutes'')'), 'value:20', 'auth_context reports the company idle timeout') \g /dev/null
select t.is(t.as('a_staff', 'select (public.auth_context() -> ''memberships'' -> 0 ->> ''mfa_required'')'), 'value:false', 'and that it is not required for staff') \g /dev/null

-- the operator's required list is added to the company's list and cannot be removed by the company
update app.server_settings set value = '{"mfaRoles": ["staff"], "idleMinutes": 15}' where key = 'security.required';
select t.is(t.as('a_staff', format('select app.require_mfa(%L) is not null', t.id('a'))), 'error:VX402', 'a role on the operator''s required list needs the second step whatever the company chose') \g /dev/null
select t.is(t.as('a_owner', 'select (public.auth_context() -> ''memberships'' -> 0 ->> ''idle_minutes'')'), 'value:15', 'the operator''s idle limit caps the company value') \g /dev/null
update app.server_settings set value = '{"mfaRoles": []}' where key = 'security.required';
update public.tenants set config = '{}'::jsonb where id = t.id('a');

-- a person with a verified authenticator always needs the second step
insert into auth.mfa_factors (user_id, factor_type, status) values (t.id('a_manager'), 'totp', 'unverified');
select t.is(t.as('a_manager', format('select app.require_mfa(%L) is not null', t.id('a'))), 'value:true', 'an authenticator that never finished enrolment changes nothing') \g /dev/null
update auth.mfa_factors set status = 'verified' where user_id = t.id('a_manager');
select t.is(t.as('a_manager', format('select app.require_mfa(%L) is not null', t.id('a'))), 'error:VX402', 'with a verified authenticator a password alone is refused') \g /dev/null
select t.is(t.as('a_manager', format('select app.require_mfa(%L) is not null', t.id('a')), '{"aal":"aal2"}'), 'value:true', 'and the code lets them in') \g /dev/null
delete from auth.mfa_factors where user_id = t.id('a_manager');

-- revocation: "sign out everywhere" and a deleted session
select t.as('service', format('select public.session_revoke_user(%L, %L) is not null', t.id('a_staff'), 'signout_all')) \g /dev/null
select t.is(t.as('a_staff', format('select app.require_mfa(%L) is not null', t.id('a')), jsonb_build_object('iat', extract(epoch from now() - interval '10 seconds')::bigint)),
  'error:VX401', 'a token issued before "sign out everywhere" is refused (session_revoked)') \g /dev/null
select t.is(t.as('a_staff', format('select app.require_mfa(%L) is not null', t.id('a')), jsonb_build_object('iat', extract(epoch from now() + interval '2 seconds')::bigint)),
  'value:true', 'a token issued after it (a new sign-in) passes') \g /dev/null
delete from app.session_revocations where user_id = t.id('a_staff');
delete from auth.sessions where id = t.id('b_staff.session');
select t.is(t.as('b_staff', format('select app.require_mfa(%L) is not null', t.id('b'))), 'error:VX401', 'a token whose session row is gone (signed out) is refused') \g /dev/null
select t.is(t.as('b_staff', 'select public.auth_context() ->> ''live'''), 'value:false', 'auth_context reports the session as not live') \g /dev/null
insert into auth.sessions (id, user_id) values (t.id('b_staff.session'), t.id('b_staff'));
select t.is(t.as('a_owner', 'select app.session_revoke_user is null'), 'error:42P01', 'control: a mistyped statement is reported as an error, not as a pass') \g /dev/null
select t.is(t.as('a_owner', format('select public.session_revoke_user(%L, %L) is not null', t.id('a_staff'), 'x')), 'error:42501', 'a person cannot revoke sessions through the server-only function') \g /dev/null

-- fresh identity check
select t.is(t.as('a_owner', 'select app.require_stepup() is not null'), 'error:VX403', 'no stamp: a protected operation is refused (stepup_required)') \g /dev/null
select t.is(t.as('a_owner', format('select public.session_stepup_mark(%L, %L, %L) is not null', t.id('a_owner'), t.id('a_owner.session'), 'password')), 'error:42501',
  'a person cannot stamp their own session') \g /dev/null
select t.stepup('a_owner') \g /dev/null
select t.is(t.as('a_owner', 'select app.require_stepup() is not null'), 'value:true', 'after the server stamped the session the operation passes') \g /dev/null
select t.is(t.as('a_owner', 'select app.require_stepup() is not null', jsonb_build_object('session_id', gen_random_uuid())), 'error:VX403', 'the stamp belongs to one session: another session of the same person is refused') \g /dev/null
update app.session_stamps set stepup_at = now() - interval '5 minutes 5 seconds' where session_id = t.id('a_owner.session');
select t.is(t.as('a_owner', 'select app.require_stepup() is not null'), 'error:VX403', 'the stamp is good for five minutes and no longer') \g /dev/null
select t.is(t.as('a_owner', format('select public.vault_reveal(%L, %L) is not null', t.id('a'), gen_random_uuid())), 'error:VX403', 'a protected function refuses without a fresh check') \g /dev/null
select t.stepup('a_owner') \g /dev/null
select t.is(t.as('a_owner', format('select public.vault_reveal(%L, %L) is not null', t.id('a'), gen_random_uuid())), 'value:true', 'and runs right after one') \g /dev/null
select t.is(t.as('a_owner', format('select public.vx_guard(%L, true)', t.id('a'))), 'value:owner', 'vx_guard with a fresh check returns the role') \g /dev/null
select t.is(t.as('a_manager', format('select public.vx_guard(%L, true)', t.id('a'))), 'error:VX403', 'vx_guard demands the fresh check when asked') \g /dev/null
select t.is(t.as('a_manager', format('select public.vx_guard(%L, false)', t.id('b'))), 'error:42501', 'vx_guard refuses another company') \g /dev/null

-- recovery codes
select t.is(t.as('a_owner', format('select public.mfa_recovery_set(array[%L, %L, %L, %L, %L])', t.sha('1'), t.sha('2'), t.sha('3'), t.sha('4'), t.sha('5'))), 'error:VX402',
  'recovery codes can only be set right after the second step (aal2)') \g /dev/null
select t.is(t.as('a_owner', format('select public.mfa_recovery_set(array[%L, %L, %L, %L, %L])', t.sha('1'), t.sha('2'), t.sha('3'), t.sha('4'), t.sha('5')), '{"aal":"aal2"}'), 'value:5',
  'five codes stored at aal2') \g /dev/null
select t.ok(not exists (select 1 from app.mfa_recovery_codes where code_hash !~ '^[0-9a-f]{64}$'), 'only hashes are stored') \g /dev/null
select t.is(t.as('a_owner', format('select public.mfa_recovery_use(%L, %L)', t.id('a_owner'), t.sha('1'))), 'error:42501', 'a person cannot use a code up through the server-only function') \g /dev/null
select t.is(t.as('service', format('select public.mfa_recovery_use(%L, %L)', t.id('a_owner'), t.sha('1'))), 'value:true', 'a valid code works') \g /dev/null
select t.is(t.as('service', format('select public.mfa_recovery_use(%L, %L)', t.id('a_owner'), t.sha('1'))), 'value:false', 'the same code does not work twice') \g /dev/null
select t.is(t.as('service', format('select public.mfa_recovery_use(%L, %L)', t.id('b_owner'), t.sha('2'))), 'value:false', 'a code of one person does not work for another') \g /dev/null
select t.is(t.as('service', format('select public.mfa_recovery_use(%L, %L)', t.id('a_owner'), t.sha('nope'))), 'value:false', 'an unknown code does not work') \g /dev/null
select t.is(t.as('a_owner', 'select public.auth_context() ->> ''recovery_codes_left'''), 'value:4', 'four codes are left') \g /dev/null
select t.ok(exists (select 1 from app.security_events where user_id = t.id('a_owner') and kind = 'mfa.recovery_used')
  and exists (select 1 from app.security_events where user_id = t.id('a_owner') and kind = 'mfa.recovery_failed'), 'used and failed recovery codes are security events') \g /dev/null

-- =====================================================================================================================
select t.section('3. invitations') \g /dev/null
-- =====================================================================================================================
select t.is(t.as('a_manager', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'new1@example.com', 'staff', 'New One', t.sha('tok-m'))),
  'error:42501', 'a member without the "users" capability cannot invite') \g /dev/null
update app.session_stamps set stepup_at = now() - interval '10 minutes' where session_id = t.id('a_owner.session');
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'new1@example.com', 'staff', 'New One', t.sha('tok-1'))),
  'error:VX403', 'inviting needs a fresh identity check') \g /dev/null
select t.stepup('a_owner') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('b'), 'new1@example.com', 'staff', 'New One', t.sha('tok-x'))),
  'error:42501', 'an owner cannot invite into another company') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'New1@Example.com ', 'staff', 'New One', t.sha('tok-1'))),
  'value:true', 'the owner invites an address with a role') \g /dev/null
select t.ok((select email = 'new1@example.com' and token_hash = t.sha('tok-1') and invited_by = t.id('a_owner.member') and expires_at > now() + interval '71 hours'
             from app.invitations where token_hash = t.sha('tok-1')), 'the invitation stores the hash, the inviter, a lowercase address and an expiry') \g /dev/null
select t.ok(not exists (select 1 from app.invitations where token_hash = 'tok-1'), 'the token itself is not stored') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'bad address', 'staff', '', t.sha('tok-2'))), 'error:22023', 'an invalid address is refused') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'x@example.com', 'superuser', '', t.sha('tok-2'))), 'error:22023', 'an unknown role is refused') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'a_staff@example.com', 'staff', '', t.sha('tok-2'))), 'error:23505', 'an active member cannot be invited again') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'x@example.com', 'staff', '', 'not-a-hash')), 'error:22023', 'the token hash must be a SHA-256 hash') \g /dev/null

-- list and revoke stay inside the company
select t.is(t.as('a_owner', format('select jsonb_array_length(public.invite_list(%L))', t.id('a'))), 'value:1', 'the owner lists the open invitation') \g /dev/null
select t.ok(t.as('a_owner', format('select public.invite_list(%L)::text', t.id('a'))) !~ 'token', 'the list never contains the token hash') \g /dev/null
select t.is(t.as('b_owner', format('select jsonb_array_length(public.invite_list(%L))', t.id('a'))), 'error:42501', 'the owner of B cannot list invitations of A') \g /dev/null
select t.is(t.as('b_owner', format('select public.invite_revoke(%L, %L)', t.id('a'), (select id from app.invitations where token_hash = t.sha('tok-1')))), 'error:42501', 'nor revoke one') \g /dev/null
select t.is(t.as('b_owner', format('select public.invite_revoke(%L, %L)', t.id('b'), (select id from app.invitations where token_hash = t.sha('tok-1')))), 'value:false', 'nor revoke it by naming their own company') \g /dev/null
select t.is(t.as('a_staff', format('select jsonb_array_length(public.invite_list(%L))', t.id('a'))), 'error:42501', 'staff cannot list invitations') \g /dev/null

-- accepting: server only, single use, expiry
select t.is(t.as('a_owner', format('select public.invite_claim(%L) is not null', t.sha('tok-1'))), 'error:42501', 'a signed-in person cannot claim an invitation through the database') \g /dev/null
select t.is(t.as('service', format('select public.invite_peek(%L) ->> ''email_hint''', t.sha('tok-1'))), 'value:n***@example.com', 'the accept page gets a masked address') \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) is null', t.sha('unknown'))), 'value:true', 'an unknown token claims nothing') \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) ->> ''email''', t.sha('tok-1'))), 'value:new1@example.com', 'the right token claims the invitation') \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) is null', t.sha('tok-1'))), 'value:true', 'a second request cannot claim it at the same time') \g /dev/null
select t.user('new1') \g /dev/null
select t.is(t.as('service', format('select public.invite_complete(%L, %L) is not null', t.sha('tok-1'), t.id('nobody'))), 'error:22023', 'an account with another address cannot complete it') \g /dev/null
select t.is(t.as('service', format('select public.invite_complete(%L, %L) ->> ''role''', t.sha('tok-1'), t.id('new1'))), 'value:staff', 'the invited account completes it and gets the invited role') \g /dev/null
select t.ok(exists (select 1 from public.tenant_members where tenant_id = t.id('a') and user_id = t.id('new1') and role = 'staff' and status = 'active'), 'the membership exists') \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) is null', t.sha('tok-1'))), 'value:true', 'a used invitation cannot be claimed again') \g /dev/null
select t.is(t.as('service', format('select public.invite_peek(%L) is null', t.sha('tok-1'))), 'value:true', 'nor looked at') \g /dev/null
select t.is(t.as('service', format('select public.invite_complete(%L, %L) is not null', t.sha('tok-1'), t.id('new1'))), 'error:22023', 'nor completed again') \g /dev/null

select t.stepup('a_owner') \g /dev/null
select t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'late@example.com', 'manager', '', t.sha('tok-late'))) \g /dev/null
update app.invitations set created_at = now() - interval '4 days', expires_at = now() - interval '1 minute' where token_hash = t.sha('tok-late');
select t.is(t.as('service', format('select public.invite_claim(%L) is null', t.sha('tok-late'))), 'value:true', 'an expired invitation cannot be claimed') \g /dev/null
select t.is(t.as('service', format('select public.invite_peek(%L) is null', t.sha('tok-late'))), 'value:true', 'nor looked at') \g /dev/null

select t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'twice@example.com', 'staff', '', t.sha('tok-first'))) \g /dev/null
select t.as('a_owner', format('select public.invite_create(%L, %L, %L, %L, %L) is not null', t.id('a'), 'twice@example.com', 'staff', '', t.sha('tok-second'))) \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) is null', t.sha('tok-first'))), 'value:true', 'inviting the same address again replaces the earlier invitation') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_revoke(%L, %L)', t.id('a'), (select id from app.invitations where token_hash = t.sha('tok-second')))), 'value:true', 'the owner revokes an invitation') \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) is null', t.sha('tok-second'))), 'value:true', 'a revoked invitation cannot be claimed') \g /dev/null

-- the first owner of a company
insert into public.tenants (slug, name, industry_id, plan_id, status) values ('server-test-new', 'Sample Company New', 'build', 'builder', 'active');
select t.remember('n', (select id from public.tenants where slug = 'server-test-new')) \g /dev/null
select t.is(t.as('service', format('select public.invite_bootstrap(%L, %L) is not null', t.id('n'), 'first@example.com')), 'error:42501', 'the server key cannot invite a first owner') \g /dev/null
select t.is(t.as('a_owner', format('select public.invite_bootstrap(%L, %L) is not null', t.id('n'), 'first@example.com')), 'error:42501', 'nor can a signed-in person') \g /dev/null
select public.invite_bootstrap(t.id('n'), 'first@example.com') as boot_token \gset
select t.ok(length(:'boot_token') >= 40 and not exists (select 1 from app.invitations where token_hash = :'boot_token'), 'the operator gets a token once, and only its hash is stored') \g /dev/null
select t.is(t.as('service', format('select public.invite_claim(%L) ->> ''role''', t.sha(:'boot_token'))), 'value:owner', 'the token is for the owner role') \g /dev/null
select t.is(t.try(format('select public.invite_bootstrap(%L, %L)', t.id('a'), 'another@example.com')), 'error:42501', 'a company that has an owner cannot get a first-owner invitation') \g /dev/null

-- =====================================================================================================================
select t.section('4. rate limits and lockouts') \g /dev/null
-- =====================================================================================================================
select t.is(t.as('a_owner', $q$select public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) is not null$q$), 'error:42501', 'a signed-in person cannot touch the counters') \g /dev/null
select t.is(t.as('service', $q$select public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) ->> 'allowed'$q$), 'value:true', 'hit 1 of 3 is allowed') \g /dev/null
select t.as('service', $q$select public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) ->> 'allowed'$q$) \g /dev/null
select t.is(t.as('service', $q$select public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) ->> 'allowed'$q$), 'value:true', 'hit 3 of 3 is allowed') \g /dev/null
select t.is(t.as('service', $q$select public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) ->> 'allowed'$q$), 'value:false', 'hit 4 is refused') \g /dev/null
select t.ok((t.as('service', $q$select (public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) ->> 'retry_after')::int between 1 and 60$q$)) = 'value:true', 'with a wait that ends with the window') \g /dev/null
select t.is(t.as('service', $q$select public.rate_hit('x.test', 'bbbbbbbbbbbbbbbb', 3, 60) ->> 'allowed'$q$), 'value:true', 'another key has its own counter') \g /dev/null
select t.is(t.as('service', $q$select public.rate_hit('x.test', '203.0.113.7', 3, 60) is not null$q$), 'error:23514', 'a raw address is refused as a key: only hashes are stored') \g /dev/null
update app.rate_limits set window_start = window_start - interval '2 minutes' where bucket = 'x.test';
select t.is(t.as('service', $q$select public.rate_hit('x.test', 'aaaaaaaaaaaaaaaa', 3, 60) ->> 'allowed'$q$), 'value:true', 'a new window starts from zero') \g /dev/null

-- lock with backoff: 3 failures lock for 60 s, the next lock is 120 s, then 240 s, capped at 300 s
select t.is(t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) ->> 'locked'$q$), 'value:false', 'failure 1: not locked') \g /dev/null
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) ->> 'locked'$q$) \g /dev/null
select t.is(t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) ->> 'retry_after'$q$), 'value:60', 'failure 3: locked for the base time') \g /dev/null
select t.is(t.as('service', $q$select public.rate_lock_state('x.lock', 'cccccccccccccccc') ->> 'locked'$q$), 'value:true', 'the lock is in force') \g /dev/null
update app.rate_locks set locked_until = now() - interval '1 second' where bucket = 'x.lock';
select t.is(t.as('service', $q$select public.rate_lock_state('x.lock', 'cccccccccccccccc') ->> 'locked'$q$), 'value:false', 'the lock ends by itself') \g /dev/null
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) is null$q$) \g /dev/null
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) is null$q$) \g /dev/null
select t.is(t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) ->> 'retry_after'$q$), 'value:120', 'the second lock is twice as long') \g /dev/null
update app.rate_locks set locked_until = now() - interval '1 second' where bucket = 'x.lock';
select t.as('service', $q$select public.rate_lock_clear('x.lock', 'cccccccccccccccc') is not null$q$) \g /dev/null
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) is null$q$) \g /dev/null
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) is null$q$) \g /dev/null
select t.is(t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) ->> 'retry_after'$q$), 'value:240', 'a success in between does not reset the backoff') \g /dev/null
update app.rate_locks set locked_until = now() - interval '1 second' where bucket = 'x.lock';
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) is null$q$) \g /dev/null
select t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) is null$q$) \g /dev/null
select t.is(t.as('service', $q$select public.rate_lock_fail('x.lock', 'cccccccccccccccc', 3, 900, 60, 300) ->> 'retry_after'$q$), 'value:300', 'the lock never exceeds the maximum') \g /dev/null

-- sign-in: 5 failures from one address lock that address for that account; the account stays usable from elsewhere
do $$
declare addr1 constant text := repeat('1', 64); addr2 constant text := repeat('2', 64); acct constant text := repeat('a', 64); r jsonb; i int;
begin
  perform t.login('service');
  for i in 1 .. 4 loop
    r := public.signin_result(addr1, acct, false, 'a_owner@example.com');
    if (r ->> 'locked')::boolean then raise exception 'FAILED: locked after % failures', i; end if;
  end loop;
  r := public.signin_result(addr1, acct, false, 'a_owner@example.com');
  perform t.logout();
  perform t.ok((r ->> 'locked')::boolean and (r ->> 'retry_after')::int = 60, 'the fifth failure locks the account for that address, for one minute');
  perform t.login('service'); r := public.signin_gate(addr1, acct); perform t.logout();
  perform t.ok(not (r ->> 'allowed')::boolean, 'the gate refuses that address for that account');
  perform t.login('service'); r := public.signin_gate(addr2, acct); perform t.logout();
  perform t.ok((r ->> 'allowed')::boolean, 'the same account from another address is not locked: one address cannot lock a person out');
  perform t.login('service'); r := public.signin_gate(addr1, repeat('b', 64)); perform t.logout();
  perform t.ok((r ->> 'allowed')::boolean, 'another account from the first address is not locked');
end $$;
select t.ok(exists (select 1 from app.security_events where kind = 'signin.failed' and user_id = t.id('a_owner') and tenant_id = t.id('a'))
  and exists (select 1 from app.security_events where kind = 'signin.locked' and outcome = 'locked' and tenant_id = t.id('a')),
  'failed sign-ins and the lockout are security events of the person''s company') \g /dev/null
select t.ok(exists (select 1 from public.audit_log where tenant_id = t.id('a') and action = 'signin.locked' and table_name = 'security' and actor = t.id('a_owner')),
  'and are copied into the audit log') \g /dev/null
select t.as('service', format($q$select public.signin_result(%L, %L, false, 'ghost@example.com') is null$q$, repeat('3', 64), repeat('c', 64))) \g /dev/null
select t.ok(exists (select 1 from app.security_events where kind = 'signin.failed' and user_id is null and tenant_id is null and subject_hash = repeat('c', 64)),
  'a failed sign-in for an address nobody has is recorded without a person or a company') \g /dev/null
select t.ok(not exists (select 1 from app.security_events where meta::text like '%ghost@example.com%' or meta::text like '%a_owner@example.com%'), 'no email address is stored with these events') \g /dev/null

-- =====================================================================================================================
select t.section('5. idempotency keys and the job queue') \g /dev/null
-- =====================================================================================================================
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000001', %L, %L) ->> 'state'$q$, t.sha('req'), t.id('a'))), 'value:new', 'a first request is new') \g /dev/null
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000001', %L, %L) ->> 'state'$q$, t.sha('req'), t.id('a'))), 'value:in_progress', 'a repeat while the first is running is told to wait') \g /dev/null
select t.as('service', $q$select public.idem_finish('x.op', 'key-0000001', '{"ok": true, "id": "r1"}') is not null$q$) \g /dev/null
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000001', %L, %L) -> 'response' ->> 'id'$q$, t.sha('req'), t.id('a'))), 'value:r1', 'a repeat after it finished gets the stored answer') \g /dev/null
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000001', %L, %L) ->> 'state'$q$, t.sha('other'), t.id('a'))), 'value:mismatch', 'the same key with a different request is refused') \g /dev/null
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000001', %L, %L) ->> 'state'$q$, t.sha('req'), t.id('b'))), 'value:mismatch', 'the same key for another company is refused') \g /dev/null
select t.as('service', format($q$select public.idem_begin('x.op', 'key-0000002', %L, %L) is null$q$, t.sha('req'), t.id('a'))) \g /dev/null
select t.as('service', $q$select public.idem_abort('x.op', 'key-0000002') is not null$q$) \g /dev/null
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000002', %L, %L) ->> 'state'$q$, t.sha('req'), t.id('a'))), 'value:new', 'an aborted key is free again') \g /dev/null
update app.idempotency_keys set created_at = now() - interval '3 minutes' where key = 'key-0000002';
select t.is(t.as('service', format($q$select public.idem_begin('x.op', 'key-0000002', %L, %L) ->> 'state'$q$, t.sha('req'), t.id('a'))), 'value:new', 'a request that died is taken over after two minutes') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.idem_begin('x.op', 'key-0000003', %L, %L) ->> 'state'$q$, t.sha('req'), t.id('a'))), 'error:42501', 'a signed-in person cannot use the server''s keys') \g /dev/null

-- jobs
delete from app.jobs;
select t.as('service', format($q$select public.job_enqueue('x.work', '{"n": 1}', null, %L, 'same-key', 3) is not null$q$, t.id('a'))) \g /dev/null
select t.as('service', format($q$select public.job_enqueue('x.work', '{"n": 2}', null, %L, 'same-key', 3) is not null$q$, t.id('a'))) \g /dev/null
select t.is((select count(*)::text from app.jobs where kind = 'x.work'), '1', 'the same kind and idempotency key is queued once') \g /dev/null
select t.is(t.as('a_owner', $q$select public.job_claim('w1') is not null$q$), 'error:42501', 'a signed-in person cannot claim jobs') \g /dev/null
select t.is(t.as('service', $q$select jsonb_array_length(public.job_claim('w1', 5, 60))$q$), 'value:1', 'a runner claims the due job') \g /dev/null
select t.ok((select status = 'running' and attempts = 1 and locked_by = 'w1' and locked_until > now() from app.jobs where kind = 'x.work'), 'the job is locked for that runner') \g /dev/null
select t.is(t.as('service', $q$select jsonb_array_length(public.job_claim('w2', 5, 60))$q$), 'value:0', 'a second runner gets nothing while the lock holds') \g /dev/null
select t.is(t.as('service', format($q$select public.job_finish(%L, 'w2')$q$, (select id from app.jobs where kind = 'x.work'))), 'value:false', 'a runner that does not hold the lock cannot finish the job') \g /dev/null
select t.is(t.as('service', format($q$select public.job_fail(%L, 'w1', 'provider_down', 30) ->> 'status'$q$, (select id from app.jobs where kind = 'x.work'))), 'value:queued', 'a failure sends it back to the queue') \g /dev/null
select t.ok((select status = 'queued' and last_error = 'provider_down' and run_at between now() + interval '25 seconds' and now() + interval '35 seconds' from app.jobs where kind = 'x.work'),
  'with a wait of 30 seconds after the first attempt') \g /dev/null
select t.is(t.as('service', $q$select jsonb_array_length(public.job_claim('w1', 5, 60))$q$), 'value:0', 'it is not claimable before its time') \g /dev/null
update app.jobs set run_at = now() - interval '1 second' where kind = 'x.work';
select t.is(t.as('service', $q$select jsonb_array_length(public.job_claim('w1', 5, 60))$q$), 'value:1', 'it is claimed again when due (attempt 2)') \g /dev/null
select t.as('service', format($q$select public.job_fail(%L, 'w1', 'provider_down', 30) is null$q$, (select id from app.jobs where kind = 'x.work'))) \g /dev/null
select t.ok((select run_at between now() + interval '55 seconds' and now() + interval '65 seconds' from app.jobs where kind = 'x.work'), 'the wait doubles: 60 seconds after the second attempt') \g /dev/null
-- lock expiry: the runner dies while holding the job
update app.jobs set run_at = now() - interval '1 second' where kind = 'x.work';
select t.as('service', $q$select public.job_claim('w-dead', 5, 60) is null$q$) \g /dev/null
select t.is(t.as('service', $q$select jsonb_array_length(public.job_claim('w3', 5, 60))$q$), 'value:0', 'a held job is not handed to another runner') \g /dev/null
update app.jobs set locked_until = now() - interval '1 second' where kind = 'x.work';
select t.ok((select attempts = 3 and max_attempts = 3 from app.jobs where kind = 'x.work'), '(the job has used its three attempts)') \g /dev/null
select t.is(t.as('service', $q$select jsonb_array_length(public.job_claim('w3', 5, 60))$q$), 'value:0', 'once the lock expired with no attempt left the job is not run again') \g /dev/null
select t.ok((select status = 'dead' and last_error = 'lock_expired' and locked_by is null from app.jobs where kind = 'x.work'), 'it is moved to the dead letter state') \g /dev/null
select t.is(t.as('service', format($q$select public.job_requeue(%L)$q$, (select id from app.jobs where kind = 'x.work'))), 'value:true', 'a dead job can be put back by hand') \g /dev/null
-- lock expiry with attempts left: the job is claimed again
select t.as('service', $q$select public.job_claim('w-dead', 5, 60) is null$q$) \g /dev/null
update app.jobs set locked_until = now() - interval '1 second' where kind = 'x.work';
select t.is(t.as('service', $q$select (public.job_claim('w4', 5, 60) -> 0 ->> 'attempts')$q$), 'value:2', 'a job whose runner died is claimed by another runner once the lock time passed') \g /dev/null
select t.is(t.as('service', format($q$select public.job_finish(%L, 'w-dead')$q$, (select id from app.jobs where kind = 'x.work'))), 'value:false', 'the dead runner can no longer finish it') \g /dev/null
select t.is(t.as('service', format($q$select public.job_finish(%L, 'w4')$q$, (select id from app.jobs where kind = 'x.work'))), 'value:true', 'the new runner finishes it') \g /dev/null
-- a permanent failure goes straight to the dead letter state
select t.as('service', $q$select public.job_enqueue('x.bad', '{}', null, null, null, 5) is not null$q$) \g /dev/null
select t.as('service', $q$select public.job_claim('w5', 5, 60) is null$q$) \g /dev/null
select t.is(t.as('service', format($q$select public.job_fail(%L, 'w5', 'unknown_kind', -1) ->> 'status'$q$, (select id from app.jobs where kind = 'x.bad'))), 'value:dead', 'a failure marked permanent is not retried') \g /dev/null
-- the company's own job log
select t.as('service', format($q$select public.job_enqueue('integration.sync', '{"provider": "mock"}', null, %L, 'b-only', 3) is not null$q$, t.id('b'))) \g /dev/null
select t.ok(t.as('a_owner', format('select public.jobs_log(%L)::text', t.id('a'))) not like '%integration.sync%', 'company A does not see a job of company B in its log') \g /dev/null
select t.is(t.as('a_owner', format('select jsonb_array_length(public.jobs_log(%L))', t.id('b'))), 'error:42501', 'and cannot ask for company B''s log') \g /dev/null
select t.is(t.as('b_owner', format('select jsonb_array_length(public.jobs_log(%L))', t.id('b'))), 'value:1', 'company B sees its own job') \g /dev/null
select t.is(t.as('a_staff', format('select jsonb_array_length(public.jobs_log(%L))', t.id('a'))), 'error:42501', 'staff cannot read the job log') \g /dev/null

-- =====================================================================================================================
select t.section('6. connections, OAuth state, sync cursors') \g /dev/null
-- =====================================================================================================================
select t.is(t.try(format($q$insert into app.integration_connections (tenant_id, provider, state) values (%L, 'mock', 'connected')$q$, t.id('a'))), 'error:23514',
  'a row cannot say "connected" without the proof of a verified call') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.conn_put(%L, 'mock', '{"state": "connected"}') is not null$q$, t.id('a'))), 'error:42501', 'a signed-in person cannot write a connection') \g /dev/null
select t.is(t.as('service', format($q$select public.conn_put(%L, 'mock', '{"state": "connected"}') is not null$q$, t.id('a'))), 'error:23514', 'even the server cannot store "connected" without the proof') \g /dev/null
select t.is(t.as('service', format($q$select public.conn_put(%L, 'mock', %L) ->> 'state'$q$, t.id('a'),
  jsonb_build_object('state', 'connected', 'reason', 'verified', 'health', 'ok', 'connected_at', now(), 'connected_by', t.id('a_owner.member'),
    'account_label', 'owner@example.com', 'account_ref', 'acct_a', 'token_enc', 'v1.sealed.a.b.c', 'scopes', jsonb_build_array('profile'))::text)), 'value:connected',
  'the server stores a verified connection') \g /dev/null
select t.as('service', format($q$select public.conn_put(%L, 'mock', %L) is not null$q$, t.id('b'),
  jsonb_build_object('state', 'connected', 'reason', 'verified', 'health', 'ok', 'connected_at', now(), 'account_label', 'b@example.com', 'account_ref', 'acct_b', 'token_enc', 'v1.sealed.b.b.c')::text)) \g /dev/null
select t.is(t.as('service', format($q$select public.conn_put(%L, 'mock', %L) is not null$q$, t.id('a'), jsonb_build_object('connected_by', t.id('b_owner.member'))::text)), 'error:23503',
  'a connection cannot name a member of another company') \g /dev/null
select t.ok(t.as('a_owner', format('select public.connections_list(%L)::text', t.id('a'))) like '%owner@example.com%', 'a member reads the connections of their company') \g /dev/null
select t.ok(t.as('a_owner', format('select public.connections_list(%L)::text', t.id('a'))) !~ 'sealed|token', 'the list never contains a token, sealed or not') \g /dev/null
select t.ok(t.as('a_owner', format('select public.connections_list(%L)::text', t.id('a'))) not like '%b@example.com%', 'and nothing of company B') \g /dev/null
select t.is(t.as('a_owner', format('select public.connections_list(%L) is not null', t.id('b'))), 'error:42501', 'company B''s connections cannot be listed from company A') \g /dev/null
select t.is(t.as('nobody', format('select public.connections_list(%L) is not null', t.id('a'))), 'error:42501', 'nor by a person with no company') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.conn_get(%L, 'mock') is not null$q$, t.id('a'))), 'error:42501', 'the row with the sealed token is for the server only') \g /dev/null
select t.is(t.as('service', $q$select public.conn_by_account('mock', 'acct_b') ->> 'tenant_id'$q$), 'value:' || t.id('b'), 'a webhook account id leads to the right company') \g /dev/null
select t.is(t.try(format($q$update app.integration_connections set tenant_id = %L where tenant_id = %L$q$, t.id('b'), t.id('a'))), 'error:42501', 'a connection can never move to another company') \g /dev/null

select t.is(t.as('a_staff', format($q$select public.integration_authorize(%L, 'sync') is not null$q$, t.id('a'))), 'error:42501', 'a member without the "integrations" capability cannot change connections') \g /dev/null
select t.is(t.as('a_manager', format($q$select public.integration_authorize(%L, 'connect') is not null$q$, t.id('a'))), 'error:42501', 'nor can a manager (edition default)') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.integration_authorize(%L, 'sync') is not null$q$, t.id('b'))), 'error:42501', 'nor an owner in another company') \g /dev/null
update app.session_stamps set stepup_at = now() - interval '10 minutes' where session_id = t.id('a_owner.session');
select t.is(t.as('a_owner', format($q$select public.integration_authorize(%L, 'sync') is not null$q$, t.id('a'))), 'value:true', 'the owner may sync without a fresh check') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.integration_authorize(%L, 'connect') is not null$q$, t.id('a'))), 'error:VX403', 'connecting needs a fresh identity check') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.integration_authorize(%L, 'disconnect') is not null$q$, t.id('a'))), 'error:VX403', 'so does disconnecting') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.oauth_state_put(%L, 'mock', %L, 'v1.x.y.z.w') is not null$q$, t.id('a'), t.sha('state-0'))), 'error:VX403', 'and starting an OAuth connection') \g /dev/null
select t.stepup('a_owner') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.oauth_state_put(%L, 'mock', %L, 'v1.x.y.z.w', '/server-test-a/integrations') is not null$q$, t.id('a'), t.sha('state-1'))), 'value:true', 'the owner starts a connection') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.oauth_state_put(%L, 'mock', %L, 'v1.x.y.z.w') is not null$q$, t.id('b'), t.sha('state-2'))), 'error:42501', 'not for another company') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.oauth_state_put(%L, 'mock', %L, 'v1.x.y.z.w', 'https://evil.example.com') is not null$q$, t.id('a'), t.sha('state-3'))), 'error:23514', 'the return address must be a path on this site') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.oauth_state_take(%L, 'mock') is not null$q$, t.sha('state-1'))), 'error:42501', 'a signed-in person cannot take a state') \g /dev/null
select t.is(t.as('service', format($q$select public.oauth_state_take(%L, 'other') is null$q$, t.sha('state-1'))), 'value:true', 'a state made for one provider does not work for another') \g /dev/null
select t.is(t.as('service', format($q$select public.oauth_state_take(%L, 'mock') ->> 'user_id'$q$, t.sha('state-1'))), 'value:' || t.id('a_owner'), 'the state is taken and names the person who started') \g /dev/null
select t.is(t.as('service', format($q$select public.oauth_state_take(%L, 'mock') is null$q$, t.sha('state-1'))), 'value:true', 'a state works once') \g /dev/null
select t.as('a_owner', format($q$select public.oauth_state_put(%L, 'mock', %L, 'v1.x.y.z.w') is not null$q$, t.id('a'), t.sha('state-old'))) \g /dev/null
update app.oauth_states set created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' where state_hash = t.sha('state-old');
select t.is(t.as('service', format($q$select public.oauth_state_take(%L, 'mock') is null$q$, t.sha('state-old'))), 'value:true', 'a state older than ten minutes does not work') \g /dev/null
select t.ok((select expires_at - created_at <= interval '10 minutes' from app.oauth_states where state_hash = t.sha('state-1')), 'a state lives ten minutes at most') \g /dev/null

select t.as('service', format($q$select public.cursor_set(%L, 'mock', 'items', 'page-7') is not null$q$, t.id('a'))) \g /dev/null
select t.is(t.as('service', format($q$select public.cursor_get(%L, 'mock', 'items')$q$, t.id('a'))), 'value:page-7', 'a sync cursor is kept per company, provider and resource') \g /dev/null
select t.is(t.as('service', format($q$select public.cursor_get(%L, 'mock', 'items')$q$, t.id('b'))), 'value:NULL', 'another company has its own') \g /dev/null
select t.is(t.as('a_owner', format($q$select public.cursor_get(%L, 'mock', 'items')$q$, t.id('a'))), 'error:42501', 'cursors are for the server only') \g /dev/null

-- =====================================================================================================================
select t.section('7. webhook events') \g /dev/null
-- =====================================================================================================================
select t.is(t.as('a_owner', format($q$select public.webhook_receive('mock', 'evt_1', %L, %L, '{}') is not null$q$, t.id('a'), t.sha('body'))), 'error:42501', 'a signed-in person cannot record a webhook event') \g /dev/null
select t.is(t.as('service', format($q$select public.webhook_receive('mock', 'evt_1', %L, %L, '{"type": "item.created"}') ->> 'fresh'$q$, t.id('a'), t.sha('body'))), 'value:true', 'a new event id is fresh') \g /dev/null
select t.is(t.as('service', format($q$select public.webhook_receive('mock', 'evt_1', %L, %L, '{"type": "item.created"}') ->> 'fresh'$q$, t.id('a'), t.sha('body'))), 'value:false', 'the same event id again is a repeat') \g /dev/null
select t.is((select count(*)::text from app.webhook_events where provider = 'mock' and event_id = 'evt_1'), '1', 'and is stored once') \g /dev/null
select t.is(t.as('service', format($q$select public.webhook_receive('other', 'evt_1', %L, %L, '{}') ->> 'fresh'$q$, t.id('a'), t.sha('body'))), 'value:true', 'the same id from another provider is a different event') \g /dev/null
select t.as('service', format($q$select public.webhook_reject('mock', %L, 'bad_signature') is not null$q$, t.sha('junk'))) \g /dev/null
select t.ok((select not signature_ok and status = 'rejected' and redacted is null and tenant_id is null and event_id is null from app.webhook_events where payload_hash = t.sha('junk')),
  'a call that failed the signature check is logged with a hash only: no body, no company') \g /dev/null
select t.is(t.try(format($q$insert into app.webhook_events (provider, event_id, signature_ok, status, payload_hash, redacted) values ('mock', 'forged', false, 'received', %L, '{"a": 1}')$q$, t.sha('f'))),
  'error:23514', 'an unverified body can never be stored or queued') \g /dev/null
select t.ok(exists (select 1 from app.security_events where kind = 'webhook.rejected' and outcome = 'denied'), 'the rejection is a security event') \g /dev/null
select t.as('service', format($q$select public.webhook_receive('mock', 'evt_b', %L, %L, '{"type": "b.only"}') is not null$q$, t.id('b'), t.sha('b-body'))) \g /dev/null
select t.ok(t.as('a_owner', format('select public.webhook_log(%L)::text', t.id('a'))) like '%evt_1%', 'the owner sees the events of their company') \g /dev/null
select t.ok(t.as('a_owner', format('select public.webhook_log(%L)::text', t.id('a'))) not like '%evt_b%', 'and not those of company B') \g /dev/null
select t.is(t.as('a_owner', format('select public.webhook_log(%L) is not null', t.id('b'))), 'error:42501', 'company B''s log cannot be read from company A') \g /dev/null
select t.is(t.as('a_staff', format('select public.webhook_log(%L) is not null', t.id('a'))), 'error:42501', 'staff cannot read the webhook log') \g /dev/null
select t.as('service', format($q$select public.webhook_mark(%L, 'failed', 'processing_failed') is not null$q$, (select id from app.webhook_events where event_id = 'evt_1' and provider = 'mock'))) \g /dev/null
select t.as('service', format($q$select public.webhook_mark(%L, 'processed') is not null$q$, (select id from app.webhook_events where event_id = 'evt_1' and provider = 'mock'))) \g /dev/null
select t.ok((select status = 'processed' and attempts = 2 and processed_at is not null and error is null from app.webhook_events where event_id = 'evt_1' and provider = 'mock'),
  'attempts and the outcome are written back on the event') \g /dev/null

-- =====================================================================================================================
select t.section('8. security events and the audit log') \g /dev/null
-- =====================================================================================================================
select t.is(t.as('a_owner', format($q$select public.security_event(%L, null, 'forged.event', 'ok') is not null$q$, t.id('a'))), 'error:42501', 'a signed-in person cannot write a security event') \g /dev/null
select t.as('service', format($q$select public.security_event(%L, %L, 'export.requested', 'ok', %L,
  '{"rows": 12, "password": "hunter2hunter2", "access_token": "abc", "note": "fine", "apiKey": "k", "tax_id": "123456789", "code": "123456"}') is null$q$, t.id('a'), t.id('a_owner'), repeat('e', 64))) \g /dev/null
select t.ok((select meta = '{"rows": 12, "note": "fine"}'::jsonb and severity = 'warning' and ip_hash = repeat('e', 64) from app.security_events where kind = 'export.requested'),
  'fields that look like secrets or identity numbers are dropped before an event is stored') \g /dev/null
select t.ok((select new_data = '{"rows": 12, "note": "fine", "outcome": "ok"}'::jsonb and actor = t.id('a_owner') and actor_role = 'owner' and table_name = 'security'
             from public.audit_log where action = 'export.requested' and tenant_id = t.id('a')), 'the event is copied into the audit log with the person and their role') \g /dev/null
select t.ok(not exists (select 1 from public.audit_log where coalesce(new_data::text, '') ~ 'hunter2|123456789'), 'the audit log holds no secret from it') \g /dev/null
select t.is(t.try($q$update app.security_events set kind = 'x.changed'$q$), 'error:42501', 'security events cannot be edited, even by the database superuser') \g /dev/null
select t.is(t.try($q$delete from app.security_events$q$), 'error:42501', 'nor deleted') \g /dev/null
select t.is(t.try($q$truncate app.security_events$q$), 'error:42501', 'nor emptied') \g /dev/null
select t.is(t.try($q$update public.audit_log set action = 'x'$q$), 'error:42501', 'the audit log of 0004 is still append only (update)') \g /dev/null
select t.is(t.try($q$delete from public.audit_log$q$), 'error:42501', 'the audit log of 0004 is still append only (delete)') \g /dev/null
select t.is(t.as('service', $q$delete from public.audit_log$q$), 'error:42501', 'also for the server key') \g /dev/null

-- membership changes
select t.as('a_owner', format($q$update public.tenant_members set role = 'manager' where id = %L$q$, t.id('a_staff.member'))) \g /dev/null
select t.ok(exists (select 1 from app.security_events where tenant_id = t.id('a') and kind = 'member.role_changed' and user_id = t.id('a_owner') and meta ->> 'from' = 'staff' and meta ->> 'to' = 'manager'),
  'a role change is a security event with who did it') \g /dev/null
select t.as('a_owner', format($q$update public.tenant_members set role = 'staff' where id = %L$q$, t.id('a_staff.member'))) \g /dev/null
select t.as('a_owner', format($q$update public.tenant_members set status = 'disabled' where id = %L$q$, t.id('a_manager.member'))) \g /dev/null
select t.ok(exists (select 1 from app.security_events where tenant_id = t.id('a') and kind = 'member.disabled'), 'disabling a member is a security event') \g /dev/null
select t.is(t.as('a_manager', format('select app.require_mfa(%L) is not null', t.id('a'))), 'error:42501', 'a disabled member is refused by the guard at once') \g /dev/null
select t.as('a_owner', format($q$update public.tenant_members set status = 'active' where id = %L$q$, t.id('a_manager.member'))) \g /dev/null

-- reading the trail stays inside the company and with the owner
select t.ok(t.as('a_owner', format('select jsonb_array_length(public.security_events_list(%L)) > 3', t.id('a'))) = 'value:true', 'the owner reads the security events of their company') \g /dev/null
select t.is(t.as('a_owner', format('select public.security_events_list(%L) is not null', t.id('b'))), 'error:42501', 'not those of company B') \g /dev/null
select t.is(t.as('a_manager', format('select public.security_events_list(%L) is not null', t.id('a'))), 'error:42501', 'a manager cannot read them') \g /dev/null
select t.is(t.as('a_owner', format('select public.security_summary(%L) is not null', t.id('b'))), 'error:42501', 'the summary is closed to another company as well') \g /dev/null
select t.ok(t.as('b_owner', format('select public.security_events_list(%L)::text', t.id('b'))) !~ 'export.requested|member.role_changed', 'company B sees nothing of company A''s events') \g /dev/null
select t.ok(t.as('a_owner', format('select public.security_summary(%L)::text', t.id('a'))) like '%signin.failed%', 'the summary counts events by day and kind') \g /dev/null
select t.ok(t.as('service', 'select public.security_alerts_due(60)::text') like '%signin.locked%', 'the alert query finds the lockout') \g /dev/null

-- one member ends the sessions of another
select t.is(t.as('a_manager', format('select public.session_revoke_member(%L, %L) is not null', t.id('a'), t.id('a_staff.member'))), 'error:42501', 'a member without "users" cannot end someone''s sessions') \g /dev/null
select t.stepup('a_owner') \g /dev/null
select t.is(t.as('a_owner', format('select public.session_revoke_member(%L, %L) is not null', t.id('a'), t.id('b_staff.member'))), 'error:42501', 'the owner of A cannot end the sessions of a member of B') \g /dev/null
select t.is(t.as('a_owner', format('select public.session_revoke_member(%L, %L) is not null', t.id('a'), t.id('a_staff.member'))), 'value:true', 'the owner ends the sessions of a member') \g /dev/null
select t.is(t.as('a_staff', format('select app.require_mfa(%L) is not null', t.id('a')), jsonb_build_object('iat', extract(epoch from now() - interval '5 seconds')::bigint)), 'error:VX401', 'that member''s tokens are refused from then on') \g /dev/null
delete from app.session_revocations;

-- =====================================================================================================================
select t.section('9. file storage and housekeeping') \g /dev/null
-- =====================================================================================================================
select t.is(t.as('a_owner', format($q$insert into storage.objects (bucket_id, name) values ('workspace-files', %L)$q$, t.id('a') || '/documents/aaaaaaaa.pdf')), 'rows:1', 'a member adds a file under their company folder') \g /dev/null
select t.is(t.as('a_owner', format($q$insert into storage.objects (bucket_id, name) values ('workspace-files', %L)$q$, t.id('b') || '/documents/planted.pdf')), 'error:42501', 'not under another company''s folder') \g /dev/null
select t.is(t.as('a_owner', format($q$insert into storage.objects (bucket_id, name) values ('workspace-files', %L)$q$, t.id('a') || '/documents/sub/deeper.pdf')), 'error:42501', 'not in a deeper folder') \g /dev/null
select t.is(t.as('a_owner', format($q$insert into storage.objects (bucket_id, name) values ('workspace-files', %L)$q$, 'loose.pdf')), 'error:42501', 'not outside a company folder') \g /dev/null
select t.is(t.as('b_owner', format($q$select (select count(*) from storage.objects where bucket_id = 'workspace-files' and name like %L)$q$, t.id('a') || '/%')), 'value:0', 'company B does not see the file') \g /dev/null
select t.is(t.as('a_staff', format($q$select (select count(*) from storage.objects where bucket_id = 'workspace-files' and name like %L)$q$, t.id('a') || '/%')), 'value:1', 'a colleague with "documents" does') \g /dev/null
select t.is(t.as('nobody', format($q$select (select count(*) from storage.objects where bucket_id = 'workspace-files')$q$)), 'value:0', 'a person with no company sees no file') \g /dev/null
select t.is(t.as('a_staff', format($q$delete from storage.objects where bucket_id = 'workspace-files' and name like %L$q$, t.id('a') || '/%')), 'rows:0', 'staff cannot remove it (no "delete" capability)') \g /dev/null
select t.is(t.as('a_owner', format($q$update storage.objects set name = %L where bucket_id = 'workspace-files' and name like %L$q$, t.id('a') || '/documents/renamed.pdf', t.id('a') || '/%')), 'rows:0', 'nobody replaces or renames a stored file') \g /dev/null
update public.tenants set config = jsonb_build_object('security', jsonb_build_object('mfaRoles', jsonb_build_array('owner'))) where id = t.id('a');
select t.is(t.as('a_owner', format($q$select (select count(*) from storage.objects where bucket_id = 'workspace-files' and name like %L)$q$, t.id('a') || '/%')), 'value:0', 'a session that owes the second step reads no file') \g /dev/null
select t.is(t.as('a_owner', format($q$select (select count(*) from storage.objects where bucket_id = 'workspace-files' and name like %L)$q$, t.id('a') || '/%'), '{"aal":"aal2"}'), 'value:1', 'at aal2 it does') \g /dev/null
update public.tenants set config = '{}'::jsonb where id = t.id('a');
select t.ok((select not public and file_size_limit = 10485760 from storage.buckets where id = 'workspace-files'), 'the bucket is private and has a size limit') \g /dev/null

select t.is(t.as('a_owner', 'select public.server_sweep() is not null'), 'error:42501', 'housekeeping is for the server only') \g /dev/null
update app.oauth_states set expires_at = now() - interval '2 hours', created_at = now() - interval '3 hours';
update app.idempotency_keys set expires_at = now() - interval '1 minute';
select t.ok(t.as('service', 'select (public.server_sweep() ->> ''oauth_states'')::int >= 1 and (public.server_sweep() ->> ''idempotency_keys'')::int >= 0') = 'value:true', 'housekeeping removes expired states and keys') \g /dev/null
select t.ok((select count(*) from app.oauth_states) = 0 and (select count(*) from app.idempotency_keys) = 0, 'and nothing expired is left') \g /dev/null
select t.ok((select count(*) from app.security_events) > 10 and exists (select 1 from app.jobs where status = 'dead'), 'security events and dead jobs are kept') \g /dev/null

-- =====================================================================================================================
-- Summary
-- =====================================================================================================================
\pset tuples_only off
\pset format aligned
select section, count(*) as checks from t.results group by section order by section;
select 'SERVER CORE CHECKS PASSED: ' || count(*) as result from t.results;
