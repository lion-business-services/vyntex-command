-- 0019 Lockdown check, as a function
-- 0009 closed anything left open and refused to finish when a house rule was broken, but it was a one-time block
-- and "copy this file as the new last migration" does not work when several ranges of migrations are written side by side.
-- The same check is now  app.lockdown_check() : any later migration ends with
--     select app.lockdown_check();
-- and supabase/tests/run_local.sh runs it once more after the last file. It is safe to repeat.
--
-- The rules:
--   * every table in public has row level security enabled AND forced
--   * every tenant table has tenant_id NOT NULL and an index that starts with tenant_id
--   * the anonymous role holds no privilege on any table or view in public, and can run no function in public or app
--     except the ones listed in app.anon_functions (public, token-addressed functions; none exist in this range)
--   * every SECURITY DEFINER function in public and app has a fixed search_path
--   * every view in public is a security-barrier view

-- Functions the anonymous role may run. A row here is a decision, with its reason: the function takes an unguessable
-- token, is rate limited, and returns nothing a stranger should not see. Signature as regprocedure prints it,
-- for example  public.sign_open(text) .
create table app.anon_functions (
  signature   text primary key,
  reason      text not null check (pg_catalog.length(pg_catalog.btrim(reason)) >= 10),
  created_at  timestamptz not null default now()
);
alter table app.anon_functions enable row level security;
alter table app.anon_functions force row level security;
revoke all on app.anon_functions from public, anon, authenticated, service_role;

create or replace function app.lockdown_check() returns void
language plpgsql
set search_path = ''
as $lockdown$
declare
  r record;
  platform_tables constant text[] := array['industries', 'tenants', 'demo_requests'];
begin
  -- The anonymous role gets nothing.
  for r in
    select c.relname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute pg_catalog.format('revoke all on public.%I from public, anon', r.relname);
  end loop;
  for r in
    select p.oid::pg_catalog.regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind = 'f'
      and not exists (select 1 from app.anon_functions a where a.signature = p.oid::pg_catalog.regprocedure::text)
  loop
    execute pg_catalog.format('revoke all on function %s from public, anon', r.sig);
  end loop;

  -- Row level security: enabled and forced, on every table.
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    if not (r.relrowsecurity and r.relforcerowsecurity) then
      raise exception 'Table public.% does not have row level security enabled and forced', r.relname;
    end if;
  end loop;

  -- Tenant tables: tenant_id present, NOT NULL, indexed first.
  for r in
    select c.oid, c.relname,
           (select a.attnum from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as attnum,
           (select a.attnotnull from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as notnull
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> all (platform_tables)
  loop
    if r.attnum is null then
      raise exception 'Table public.% has no tenant_id column', r.relname;
    end if;
    -- audit_log may hold platform events that belong to no company; every other table requires a company.
    if not r.notnull and r.relname <> 'audit_log' then
      raise exception 'Table public.%: tenant_id must be NOT NULL', r.relname;
    end if;
    if not exists (select 1 from pg_catalog.pg_index i where i.indrelid = r.oid and i.indkey[0] = r.attnum) then
      raise exception 'Table public.% has no index starting with tenant_id', r.relname;
    end if;
  end loop;

  -- SECURITY DEFINER functions must pin their search_path.
  for r in
    select p.oid::pg_catalog.regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef
      and not exists (select 1 from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')
  loop
    raise exception 'SECURITY DEFINER function % has no fixed search_path', r.sig;
  end loop;

  -- A view carries its own access rule (0007): without the security barrier a caller's own conditions could run first.
  for r in
    select c.relname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce((select o.option_value::boolean from pg_catalog.pg_options_to_table(c.reloptions) o where o.option_name = 'security_barrier'), false)
  loop
    raise exception 'View public.% is not a security-barrier view', r.relname;
  end loop;
end
$lockdown$;
revoke all on function app.lockdown_check() from public, anon, authenticated, service_role;

select app.lockdown_check();
