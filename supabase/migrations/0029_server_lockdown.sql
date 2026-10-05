-- 0029 Server range: guarded gateway entry points, housekeeping, and the lockdown check for schema app
-- Safe to run again at any time (everything here is "create or replace" or a check).

-- ---------------------------------------------------------------------------------------------------------------------
-- Guarded entry points for the workspace gateway.
-- api/ws.js calls these two, never ws_load / ws_apply directly, so the sign-in rules (member, live session, second
-- step where required) hold in SQL for every load and every change, whatever the gateway functions check themselves.
-- They run as the caller: every row rule and capability check of ws_load / ws_apply still applies.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vx_ws_load(p_tenant uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  return public.ws_load(p_tenant);
end
$$;

create or replace function public.vx_ws_apply(p_tenant uuid, p_ops jsonb, p_idem text) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  return public.ws_apply(p_tenant, p_ops, p_idem);
end
$$;

-- Asked by the server before it runs a protected function for a person: is the session good for this company?
-- p_stepup = true also demands a fresh identity check. Returns the role, so the server can log what it did.
create or replace function public.vx_guard(p_tenant uuid, p_stepup boolean default false) returns text
language plpgsql stable
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if p_stepup then
    perform app.require_stepup();
  end if;
  return app.member_role(p_tenant);
end
$$;

revoke all on function public.vx_ws_load(uuid), public.vx_ws_apply(uuid, jsonb, text), public.vx_guard(uuid, boolean) from public, anon, service_role;
grant execute on function public.vx_ws_load(uuid), public.vx_ws_apply(uuid, jsonb, text), public.vx_guard(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Housekeeping, run by the scheduled job "maintenance.sweep". Removes only what has no further use:
-- counters of past windows, used or expired OAuth states, expired idempotency keys, old fresh-check stamps,
-- finished jobs after 30 days, webhook rows after 90 days. Dead jobs and security events are kept.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.server_sweep() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  n_rate integer; n_locks integer; n_states integer; n_idem integer; n_stamps integer; n_jobs integer; n_hooks integer; n_inv integer;
begin
  delete from app.rate_limits r where r.window_start < pg_catalog.now() - interval '2 days';
  get diagnostics n_rate = row_count;
  delete from app.rate_locks l where l.last_fail < pg_catalog.now() - interval '2 days' and (l.locked_until is null or l.locked_until < pg_catalog.now());
  get diagnostics n_locks = row_count;
  delete from app.oauth_states s where s.expires_at < pg_catalog.now() - interval '1 hour';
  get diagnostics n_states = row_count;
  delete from app.idempotency_keys k where k.expires_at < pg_catalog.now();
  get diagnostics n_idem = row_count;
  delete from app.session_stamps s where s.stepup_at < pg_catalog.now() - interval '1 day';
  get diagnostics n_stamps = row_count;
  delete from app.jobs j where j.status = 'done' and j.finished_at < pg_catalog.now() - interval '30 days';
  get diagnostics n_jobs = row_count;
  delete from app.webhook_events e where e.received_at < pg_catalog.now() - interval '90 days';
  get diagnostics n_hooks = row_count;
  -- Invitations that were never used keep their row (who invited whom is history); only the claim mark is cleared.
  update app.invitations i set claimed_at = null where i.claimed_at < pg_catalog.now() - interval '1 hour' and i.used_at is null;
  get diagnostics n_inv = row_count;
  return pg_catalog.jsonb_build_object('rate_limits', n_rate, 'rate_locks', n_locks, 'oauth_states', n_states, 'idempotency_keys', n_idem,
    'session_stamps', n_stamps, 'jobs', n_jobs, 'webhook_events', n_hooks, 'invitation_claims', n_inv);
end
$$;
revoke all on function public.server_sweep() from public, anon, authenticated;
grant execute on function public.server_sweep() to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Lockdown check for the server range. Refuses to finish if a rule of the house is broken:
--   * every server table in schema app has row level security enabled AND forced, and no policy (deny everything)
--   * no application role (anon, authenticated, service_role) holds any privilege on a server table
--   * the anonymous role cannot execute any function of this range
--   * the functions meant for the server alone cannot be executed by a signed-in person
--   * every SECURITY DEFINER function in public and app has a fixed search_path
-- It only touches what this range owns. The general rules for public (and the list of functions the anonymous role
-- may run, app.anon_functions) belong to app.lockdown_check() of the gateway range, which is called at the end when
-- it is installed.
-- ---------------------------------------------------------------------------------------------------------------------
do $lockdown$
declare
  r record;
  server_tables constant text[] := array[
    'server_settings', 'security_events', 'session_revocations', 'session_stamps', 'mfa_recovery_codes', 'invitations',
    'rate_limits', 'rate_locks', 'idempotency_keys', 'jobs', 'integration_connections', 'oauth_states', 'sync_cursors', 'webhook_events'];
  server_only constant text[] := array[
    'security_event', 'security_alerts_due', 'session_stepup_mark', 'session_revoke_user', 'mfa_recovery_use', 'mfa_recovery_clear',
    'invite_claim', 'invite_peek', 'invite_release', 'invite_complete', 'invite_bootstrap',
    'rate_hit', 'rate_lock_state', 'rate_lock_fail', 'rate_lock_clear', 'signin_gate', 'signin_result',
    'idem_begin', 'idem_finish', 'idem_abort',
    'job_enqueue', 'job_claim', 'job_finish', 'job_fail', 'job_requeue', 'job_stats',
    'conn_put', 'conn_get', 'conn_delete', 'conn_by_account', 'conn_due_refresh', 'conn_connected', 'oauth_state_take',
    'cursor_get', 'cursor_set', 'webhook_receive', 'webhook_reject', 'webhook_mark', 'webhook_get', 'server_sweep'];
  for_people constant text[] := array[
    'security_events_list', 'security_summary', 'session_revoke_member', 'mfa_recovery_set', 'auth_context',
    'invite_create', 'invite_list', 'invite_revoke', 'jobs_log', 'connections_list', 'integration_authorize', 'oauth_state_put',
    'webhook_log', 'vx_ws_load', 'vx_ws_apply', 'vx_guard'];
  app_functions constant text[] := array[
    'server_setting', 'tenant_security', 'mfa_roles', 'idle_minutes', 'safe_meta', 'security_severity', 'security_event',
    'member_security_event', 'can_read_security', 'session_aal', 'session_id', 'session_issued_at', 'session_live',
    'has_verified_factor', 'mfa_needed', 'require_mfa', 'require_stepup', 'capabilities_of', 'rate_hit', 'lock_state',
    'lock_fail', 'lock_clear', 'idem_begin', 'idem_finish', 'idem_abort', 'job_enqueue', 'job_claim', 'job_finish',
    'job_fail', 'job_requeue', 'connection_json', 'session_tenants'];
begin
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.oid
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relname = any (server_tables)
  loop
    execute format('revoke all on app.%I from public, anon, authenticated, service_role', r.relname);
    if not (r.relrowsecurity and r.relforcerowsecurity) then
      raise exception 'Table app.% does not have row level security enabled and forced', r.relname;
    end if;
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = r.oid) then
      raise exception 'Table app.% has a policy. Server tables are reached through functions only.', r.relname;
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r' and c.relname = any (server_tables)) <> pg_catalog.cardinality(server_tables) then
    raise exception 'A server table is missing from schema app';
  end if;

  for r in
    select p.oid::regprocedure as sig, p.proname, n.nspname, p.oid
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and ((n.nspname = 'public' and (p.proname = any (server_only) or p.proname = any (for_people)))
        or (n.nspname = 'app' and p.proname = any (app_functions)))
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if r.nspname = 'public' and r.proname = any (server_only) and pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'Function % is for the server only and must not be executable by signed-in people', r.sig;
    end if;
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef
      and not exists (select 1 from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')
  loop
    raise exception 'SECURITY DEFINER function % has no fixed search_path', r.sig;
  end loop;

  -- The general check of the gateway range, when that range is installed.
  if pg_catalog.to_regprocedure('app.lockdown_check()') is not null then
    execute 'select app.lockdown_check()';
  end if;
end
$lockdown$;
