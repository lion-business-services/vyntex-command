-- 0009 Lockdown check
-- Runs last. Closes anything a later edit may have left open and refuses to finish if a rule of the house is broken:
--   * every table in public has row level security enabled AND forced
--   * every tenant table has tenant_id NOT NULL and an index that starts with tenant_id
--   * the anonymous role holds no privilege on any table, view or function of this project
--   * every SECURITY DEFINER function in public and app has a fixed search_path
-- If you add a table in a later migration, copy this file as the new last migration (or run it again): it is safe to repeat.

do $lockdown$
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
    execute format('revoke all on public.%I from public, anon', r.relname);
  end loop;
  for r in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
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
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef
      and not exists (select 1 from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')
  loop
    raise exception 'SECURITY DEFINER function % has no fixed search_path', r.sig;
  end loop;
end
$lockdown$;
