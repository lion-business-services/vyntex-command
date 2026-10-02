-- Read-only check of a real Supabase project after the migrations and seed.sql have been run.
-- IN: Supabase SQL Editor. Paste the whole file and press Run. It changes nothing: every statement is a SELECT.
-- Every row of the result should say "ok". A row that says "PROBLEM" names what to look at.
-- This is a structure check. It does not replace the full isolation test in rls_isolation.sql, which needs test users.

with checks (item, ok, detail) as (
  select 'migrations were run by a role that may bypass row level security',
         (select bool_or(r.rolsuper or r.rolbypassrls) from pg_roles r join pg_class c on c.relowner = r.oid where c.oid = 'public.tenants'::regclass),
         (select 'tables are owned by ' || r.rolname from pg_roles r join pg_class c on c.relowner = r.oid where c.oid = 'public.tenants'::regclass)
  union all
  select 'public has the 22 expected tables',
         (select count(*) = 22 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')),
         (select count(*)::text || ' found' from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p'))
  union all
  select 'row level security is enabled and forced on every table in public',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
         coalesce((select 'missing on: ' || string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)), 'all tables')
  union all
  select 'the anonymous role holds no privilege on any table or view in public',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, p)),
         coalesce((select 'anon can touch: ' || string_agg(distinct c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, p)), 'none')
  union all
  select 'the anonymous role cannot run any function in public or app',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE')),
         coalesce((select 'anon can run: ' || string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE')), 'none')
  union all
  select 'signed-in people cannot read the encrypted tax ID column',
         not has_column_privilege('authenticated', 'public.workers', 'tax_id_enc', 'SELECT'), 'workers.tax_id_enc'
  union all
  select 'signed-in people and the server role cannot call the key or decrypt functions',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'app' and p.proname in ('secret', 'pii_key', 'encrypt_pii', 'decrypt_pii')
                       and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
         'app.secret, app.pii_key, app.encrypt_pii, app.decrypt_pii'
  union all
  select 'every privileged function has a fixed search path',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosecdef
                     and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')),
         'functions in public and app'
  union all
  select 'the 70 access policies exist in public',
         (select count(*) = 70 from pg_policies where schemaname = 'public'),
         (select count(*)::text || ' found' from pg_policies where schemaname = 'public')
  union all
  select 'the 6 worker document policies exist on storage.objects',
         (select count(*) = 6 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'worker_documents_%'),
         (select count(*)::text || ' found' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'worker_documents_%')
  union all
  select 'the worker documents bucket exists and is private',
         coalesce((select not public from storage.buckets where id = 'worker-documents'), false),
         coalesce((select 'public = ' || public::text from storage.buckets where id = 'worker-documents'), 'bucket not found')
  union all
  select 'the 5 role views exist and are security-barrier views',
         (select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
            and coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_barrier'), false)),
         (select count(*)::text || ' found' from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v')
  union all
  select 'the 8 industries are loaded (seed.sql)',
         (select count(*) = 8 from public.industries),
         (select count(*)::text || ' found' from public.industries)
  union all
  select 'the audit log and consent records are protected against changes',
         (select count(*) = 5 from pg_trigger where not tgisinternal and tgname in ('audit_log_append_only', 'audit_log_no_truncate', 'consent_records_freeze', 'consent_records_no_truncate', 'activity_append_only')),
         'append-only triggers'
  union all
  select 'no customer company exists yet (expected right after setup)',
         (select count(*) = 0 from public.tenants),
         (select count(*)::text || ' companies' from public.tenants)
)
select item as "check", case when ok then 'ok' else 'PROBLEM' end as result, detail from checks;
