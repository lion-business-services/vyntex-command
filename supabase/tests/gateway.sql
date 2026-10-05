-- Tests of what migrations 0010 to 0019 add. Run by run_local.sh right after rls_isolation.sql, in the same database:
-- the harness (schema "test": ok, is, login, as, try, id, seed_company) and the sample companies A, B and C are reused.
-- Two more companies are created here so nothing depends on what the earlier file left behind:
--   G  a field edition (landscape)      P  the professional-services edition (practice)
-- Every check goes through test.ok() or test.is(), which RAISE on failure.

\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null

-- =====================================================================================================================
-- Helpers
-- =====================================================================================================================

-- A fixed, readable id for rows created by these tests.
create or replace function test.u(n integer) returns uuid language sql immutable as
$$ select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid $$;

-- ws_apply as a given person. Errors propagate; use test.as(...) when the error itself is what is being checked.
create or replace function test.apply(who text, tenant text, ops jsonb, idem text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform test.login(who);
  r := public.ws_apply(test.id(tenant), ops, idem);
  perform test.logout();
  return r;
exception when others then
  perform test.logout();
  raise;
end $$;

create or replace function test.load(who text, tenant text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform test.login(who);
  r := public.ws_load(test.id(tenant));
  perform test.logout();
  return r;
exception when others then
  perform test.logout();
  raise;
end $$;

-- One operation, as the app sends it.
create or replace function test.op(c text, id uuid, r jsonb) returns jsonb language sql immutable as
$$ select jsonb_build_object('c', c, 'op', 'upsert', 'id', id, 'row', jsonb_build_object('id', id) || r) $$;
create or replace function test.del(c text, id uuid) returns jsonb language sql immutable as
$$ select jsonb_build_object('c', c, 'op', 'delete', 'id', id) $$;

-- What happened to the operation with this id: 'applied', or the reason it was refused.
create or replace function test.reason(result jsonb, id text) returns text language sql immutable as $$
  select coalesce((select e ->> 'reason' from jsonb_array_elements(result -> 'rejected') e where e ->> 'id' = id limit 1), 'applied')
$$;
create or replace function test.detail(result jsonb, id text) returns text language sql immutable as $$
  select (select e ->> 'detail' from jsonb_array_elements(result -> 'rejected') e where e ->> 'id' = id limit 1)
$$;
-- The row with this id in a list of a loaded workspace (or of the "server" part of an answer).
create or replace function test.row_of(doc jsonb, c text, id uuid) returns jsonb language sql immutable as
$$ select e from jsonb_array_elements(coalesce(doc -> c, '[]'::jsonb)) e where e ->> 'id' = id::text limit 1 $$;

-- A fingerprint of every row of one company, in every tenant table. Equal before and after means nothing changed.
create or replace function test.fingerprint(tenant uuid) returns text language plpgsql as $$
declare r record; part text; acc text := '';
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('audit_log', 'ws_requests', 'member_state') order by 1
  loop
    execute format('select coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), '''') from public.%I t where tenant_id = $1', r.relname)
      into part using tenant;
    acc := acc || r.relname || ':' || part || ';';
  end loop;
  return md5(acc);
end $$;

select test.seed_company('g', 'green-field', 'landscape', 'pro') \g /dev/null
select test.seed_company('p', 'harbor-practice', 'practice', 'quoted') \g /dev/null

-- =====================================================================================================================
-- 10. Capabilities: the matrix per edition, the read-only role, a company's own lists
-- =====================================================================================================================
select test.begin_section('10. capabilities') \g /dev/null

select test.is((select count(*) || '/' || count(distinct c) from unnest(app.capabilities()) c), '40/40', 'there are 40 capabilities, each named once') \g /dev/null
select test.ok(app.role_permissions('build', 'owner') = app.capabilities() and app.role_permissions('practice', 'owner') = app.capabilities(),
  'the owner holds every capability in every edition') \g /dev/null
select test.ok((select bool_and(app.role_permissions(i.id, 'staff') @> app.role_permissions(i.id, 'readonly')
                            and not 'write' = any (app.role_permissions(i.id, 'readonly'))
                            and not 'delete' = any (app.role_permissions(i.id, 'readonly'))
                            and 'write' = any (app.role_permissions(i.id, 'staff'))
                            and cardinality(app.role_permissions(i.id, 'readonly')) > 0) from public.industries i),
  'in every edition read only is a part of what staff may do, without write and without delete') \g /dev/null
select test.ok(app.role_permissions('build', 'worker') = '{}' and app.permissions_for('build', '{}', 'worker') = '{}' and app.permissions_for('build', '{}', 'stranger') = '{}'
               and app.permissions_for('build', '{}', null) = '{}',
  'a worker, an unknown role and no role hold nothing') \g /dev/null
select test.ok(app.role_permissions('staff') = app.role_permissions('build', 'staff') and app.role_permissions('owner') = app.capabilities(),
  'the one-argument form of 0003 answers from the same source') \g /dev/null
select test.ok('money' = any (app.role_permissions('practice', 'staff')) and not 'money' = any (app.role_permissions('build', 'staff')),
  'the matrix differs by edition: an associate of a practice sees money, office staff of a field edition do not') \g /dev/null

-- the read-only role: looks at what staff look at
do $$
declare r text; a text; b text;
begin
  foreach r in array array['clients', 'leads', 'tasks', 'documents', 'notes', 'messages', 'jobs_basic', 'job_assignments_basic', 'worker_directory',
                           'client_people', 'lead_handoffs', 'task_comments', 'lead_routing', 'tenants', 'tenant_members', 'activity'] loop
    a := test.as('g_staff', format('select 1 from public.%I', r));
    b := test.as('g_readonly', format('select 1 from public.%I', r));
    perform test.ok(a = b and a like 'rows:%' and a <> 'rows:0', format('read only reads the same rows as staff in %s (%s, %s)', r, a, b));
  end loop;
  foreach r in array array['client_payments', 'job_expenses', 'worker_payments', 'jobs', 'job_assignments', 'audit_log', 'automation_settings', 'consent_records'] loop
    b := test.as('g_readonly', format('select 1 from public.%I', r));
    perform test.is(b, 'rows:0', format('read only reads nothing in %s, like staff', r));
  end loop;
end $$;
select test.ok(test.value('g_readonly', format('select app.can(%L, %L)::text', test.id('g'), 'leads')) = 'true'
           and test.value('g_readonly', format('select app.can(%L, %L)::text', test.id('g'), 'write')) = 'false',
  'app.can: read only holds "leads" and does not hold "write"') \g /dev/null

-- the read-only role: changes nothing, in any table or view, by any statement
select test.fingerprint(test.id('g')) as g_before \gset
do $$
declare
  r record; res text; cols text; upd text; base text; sample jsonb; n int := 0;
  g uuid := test.id('g');
begin
  for r in
    select c.oid, c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'v')
      -- the two things a person keeps for themselves need no capability: checked on their own below
      and c.relname not in ('member_state', 'ws_requests')
    order by c.relname
  loop
    select quote_ident(a.attname) into upd from pg_attribute a
    where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname not in ('id', 'tenant_id')
      and has_column_privilege('authenticated', r.oid, a.attnum, 'UPDATE')
    order by a.attnum limit 1;
    if upd is not null then
      res := test.as('g_readonly', format('update public.%I set %s = %s where tenant_id = %L', r.relname, upd, upd, g));
      perform test.ok(test.blocked(res), format('read only cannot update %s (%s)', r.relname, res));
    end if;
    res := test.as('g_readonly', format('delete from public.%I where tenant_id = %L', r.relname, g));
    perform test.ok(test.blocked(res), format('read only cannot delete from %s (%s)', r.relname, res));
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = ''
      and has_column_privilege('authenticated', r.oid, a.attnum, 'INSERT');
    if cols is not null then
      select coalesce(
        (select distinct d.refobjid::regclass::text
         from pg_rewrite w join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = w.oid and d.refclassid = 'pg_class'::regclass
         where r.relkind = 'v' and w.ev_class = r.oid and d.refobjid <> r.oid),
        format('public.%I', r.relname)) into base;
      execute format('select to_jsonb(t) from %s t where tenant_id = $1 limit 1', base) into sample using g;
      sample := jsonb_set(sample, '{id}', to_jsonb(gen_random_uuid()));
      if sample ? 'number' then sample := jsonb_set(sample, '{number}', to_jsonb('COPY-' || left(gen_random_uuid()::text, 8))); end if;
      if sample ? 'ticket' then sample := jsonb_set(sample, '{ticket}', to_jsonb('COPY-' || left(gen_random_uuid()::text, 8))); end if;
      res := test.as('g_readonly', format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, %L::jsonb)', r.relname, cols, cols, r.relname, sample));
      perform test.is(res, 'error:42501', format('read only cannot insert into %s', r.relname));
    end if;
    n := n + 1;
  end loop;
  perform test.ok(n >= 29, format('the read-only loop covered %s tables and views', n));
end $$;
select test.is(test.fingerprint(test.id('g')), :'g_before', 'after every attempt by the read-only person the company data is byte for byte unchanged') \g /dev/null
-- control: the same statements do work for staff, so the refusals above are the rule and not a broken statement
select test.is(test.as('g_staff', format($q$update public.clients set company = company where tenant_id = %L$q$, test.id('g'))), 'rows:1', 'control: staff does update a client') \g /dev/null
select test.is(test.as('g_staff', format($q$update public.jobs_basic set scope = scope where tenant_id = %L$q$, test.id('g'))), 'rows:2', 'control: staff does update jobs through the view') \g /dev/null
select test.is(test.as('g_readonly', format($q$update public.jobs_basic set scope = 'changed' where tenant_id = %L$q$, test.id('g'))), 'error:42501', 'read only is refused by the guard on jobs when it writes through the staff view') \g /dev/null
select test.is(test.as('g_readonly', format($q$insert into storage.objects (bucket_id, name) values ('worker-documents', %L)$q$, test.id('g') || '/' || test.id('g.w1') || '/x.pdf')), 'error:42501', 'read only cannot upload a worker document') \g /dev/null
-- what a person keeps for themselves is theirs even when read only
select test.is(test.as('g_readonly', format($q$insert into public.member_state (tenant_id, member_id, read_notifications) values (%L, %L, array['n9'])$q$, test.id('g'), test.id('g.m_readonly'))), 'rows:1', 'read only can still dismiss their own notifications') \g /dev/null
select test.is(test.as('g_readonly', format($q$insert into public.member_state (tenant_id, member_id) values (%L, %L)$q$, test.id('g'), test.id('g.m_staff'))), 'error:42501', 'but not write the state of another person') \g /dev/null
select test.is(test.as('g_staff', 'select 1 from public.member_state'), 'rows:0', 'a person does not read the state of others') \g /dev/null
select test.is(test.as('g_staff', 'select 1 from public.ws_requests'), 'rows:0', 'a person does not read the idempotency keys of others') \g /dev/null

-- a company's own list for a role: tenants.config -> roles
select test.is(test.as('g_staff', 'select 1 from public.client_payments'), 'rows:0', 'before the override staff reads no payments') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = %L where id = %L$q$,
  jsonb_build_object('roles', jsonb_build_object('staff', to_jsonb(app.role_permissions('landscape', 'staff') || array['money']),
                                                 'manager', to_jsonb(array_remove(app.role_permissions('landscape', 'manager'), 'leads')))), test.id('g'))),
  'rows:1', 'the owner gives staff "money" and takes "leads" from the manager') \g /dev/null
select test.is(test.as('g_staff', 'select 1 from public.client_payments'), 'rows:1', 'with the override staff reads payments') \g /dev/null
select test.is(test.as('g_staff', 'select 1 from public.jobs where price > 0'), 'rows:2', 'and the jobs table with prices') \g /dev/null
select test.is(test.as('g_manager', 'select 1 from public.leads'), 'rows:0', 'and the manager no longer reads leads') \g /dev/null
select test.is(test.as('g_manager', format($q$insert into public.leads (tenant_id, ticket, name, type) values (%L, 'G-9001', 'Planted', 'service')$q$, test.id('g'))), 'error:42501', 'nor writes them') \g /dev/null
select test.is(test.as('b_staff', 'select 1 from public.client_payments'), 'rows:0', 'the override of one company changes nothing in another') \g /dev/null
select test.is(test.as('g_owner', 'select 1 from public.leads'), 'rows:1', 'the owner is untouched') \g /dev/null
select test.is(test.value('g_staff', format('select public.ws_session(%L) -> %L ? %L', test.id('g'), 'permissions', 'money')), 'true', 'ws_session reports the resolved capabilities') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = '{"roles":{"owner":["leads"]}}' where id = %L$q$, test.id('g'))), 'error:23514', 'the owner role cannot be reduced: the configuration is refused') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = '{"roles":{"staff":["leads","fly"]}}' where id = %L$q$, test.id('g'))), 'error:23514', 'a capability that does not exist is refused') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = '{"roles":{"readonly":["leads","write"]}}' where id = %L$q$, test.id('g'))), 'error:23514', 'read only can never be given "write"') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = '{"roles":{"boss":["leads"]}}' where id = %L$q$, test.id('g'))), 'error:23514', 'a role that does not exist is refused') \g /dev/null
-- a manager trusted with the configuration still cannot change what roles may do
select test.is(test.as('g_owner', format($q$update public.tenants set config = %L where id = %L$q$,
  jsonb_build_object('roles', jsonb_build_object('manager', to_jsonb(app.role_permissions('landscape', 'manager') || array['config']))), test.id('g'))),
  'rows:1', 'the owner gives the manager "config"') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenants set config = config || '{"leadSources":[{"id":"fair","label":{"en":"Trade fair","es":"Feria"}},{"id":"website","label":{"en":"Website","es":"Sitio web"}}]}' where id = %L$q$, test.id('g'))),
  'rows:1', 'the manager now changes the lead sources') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenants set config = jsonb_set(config, '{roles,manager}', %L) where id = %L$q$, to_jsonb(app.capabilities()), test.id('g'))),
  'error:42501', 'but cannot hand themselves every capability: only an owner changes what roles may do') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenants set config = config || '{"security":{"idleMinutes":600,"mfaRoles":[]}}' where id = %L$q$, test.id('g'))),
  'error:42501', 'nor loosen the sign-in rules') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenants set name = 'Renamed by manager' where id = %L$q$, test.id('g'))),
  'error:42501', 'nor rename the company: that is "settings", which they do not hold') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenant_members set role = 'owner' where tenant_id = %L and user_id = %L$q$, test.id('g'), test.id('g_manager'))), 'rows:0', 'nor touch membership: that is "users"') \g /dev/null
-- "users" given to a manager lets them manage people, but never an owner
select test.is(test.as('g_owner', format($q$update public.tenants set config = %L where id = %L$q$,
  jsonb_build_object('roles', jsonb_build_object('manager', to_jsonb(app.role_permissions('landscape', 'manager') || array['users']))), test.id('g'))),
  'rows:1', 'the owner gives the manager "users"') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenant_members set status = 'disabled' where tenant_id = %L and user_id = %L$q$, test.id('g'), test.id('g_disabled'))), 'rows:1', 'the manager now manages a member') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenant_members set role = 'owner' where tenant_id = %L and user_id = %L$q$, test.id('g'), test.id('g_manager'))), 'error:42501', 'but cannot make themselves an owner') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenant_members set status = 'disabled' where tenant_id = %L and user_id = %L$q$, test.id('g'), test.id('g_owner'))), 'error:42501', 'nor switch an owner off') \g /dev/null
select test.is(test.as('g_manager', format($q$insert into public.tenant_members (tenant_id, user_id, role, name) values (%L, %L, 'owner', 'Planted')$q$, test.id('g'), test.id('nobody'))), 'error:42501', 'nor add an owner') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = '{}' where id = %L$q$, test.id('g'))), 'rows:1', 'the owner puts the configuration back') \g /dev/null
select test.is(test.as('g_staff', 'select 1 from public.client_payments'), 'rows:0', 'and staff is back to the edition matrix') \g /dev/null

-- the edition decides too: the same role name, two matrices
select test.is(test.as('p_staff', 'select 1 from public.client_payments'), 'rows:1', 'an associate of the practice reads payments (the practice matrix gives "money")') \g /dev/null
select test.is(test.as('p_readonly', 'select 1 from public.client_payments'), 'rows:1', 'read only of the practice reads them too') \g /dev/null
select test.is(test.as('p_readonly', format($q$insert into public.client_payments (tenant_id, job_id, method, amount) values (%L, %L, 'cash', 1)$q$, test.id('p'), test.id('p.j1'))), 'error:42501', 'and cannot record one') \g /dev/null
select test.is(test.as('p_manager', 'select 1 from public.consent_records'), 'rows:0', 'a senior associate of the practice does not hold "compliance"; a manager of a field edition does') \g /dev/null
select test.ok(test.as('g_manager', 'select 1 from public.consent_records') <> 'rows:0', 'control: the manager of the field company reads consent records') \g /dev/null

-- every rule that lets a signed-in person change a row asks for "write" (the two things a person keeps for themselves aside)
select test.is((select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), 'none') from pg_policies
                where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and coalesce(qual, '') || coalesce(with_check, '') !~ '''write'''
                  and tablename not in ('member_state', 'ws_requests')),
  'none', 'every insert, update and delete policy in public requires the "write" capability') \g /dev/null
select test.is((select coalesce(string_agg(c.conrelid::regclass || '.' || c.conname, ', '), 'none') from pg_constraint c
                where c.contype = 'f' and c.connamespace = 'public'::regnamespace
                  and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                                    and (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] @> c.conkey::smallint[]
                                    and (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey::smallint[])),
  'none', 'every foreign key in public has an index on its columns') \g /dev/null

-- the functions of this range: who may run them
select test.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and p.proname like 'ws\_%' and p.prosecdef
      -- the four readers of the registry (configuration, never a company's rows) and the list of hidden client names
      and p.proname not in ('ws_variant', 'ws_known', 'ws_children', 'ws_names', 'ws_hidden_clients'))
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and not p.prosecdef
         and p.proname in ('ws_load', 'ws_apply', 'ws_apply_ops', 'ws_upsert', 'ws_delete', 'ws_sync_children', 'ws_read', 'ws_row_sql', 'ws_load_worker')) = 9,
  'the gateway functions that touch a company''s rows run as the caller (SECURITY INVOKER): row level security stays the judge') \g /dev/null
select test.ok(has_function_privilege('authenticated', 'public.ws_load(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.ws_apply(uuid, jsonb, text)', 'EXECUTE')
           and not has_function_privilege('service_role', 'public.ws_load(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'public.ws_apply(uuid, jsonb, text)', 'EXECUTE')
           and not has_function_privilege('anon', 'public.ws_load(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.ws_apply(uuid, jsonb, text)', 'EXECUTE'),
  'ws_load and ws_apply can be run by signed-in people only: not by the anonymous role, not by the server key') \g /dev/null
select test.ok(not has_function_privilege('authenticated', 'app.ws_register(jsonb)', 'EXECUTE') and not has_function_privilege('service_role', 'app.ws_register(jsonb)', 'EXECUTE')
           and not has_any_column_privilege('authenticated', 'app.ws_collections', 'SELECT, INSERT, UPDATE, REFERENCES') and not has_table_privilege('authenticated', 'app.ws_collections', 'DELETE')
           and not has_any_column_privilege('service_role', 'app.ws_collections', 'SELECT, INSERT, UPDATE, REFERENCES')
           and not exists (select 1 from pg_policy where polrelid = 'app.ws_collections'::regclass),
  'nobody but a migration can change the collection registry, and no application role can touch the table at all') \g /dev/null
select test.is(test.as('g_owner', 'select 1 from app.ws_collections'), 'error:42501', 'a signed-in person cannot read the registry table directly') \g /dev/null
select test.is(test.as('anon', format('select public.ws_load(%L)', test.id('g'))), 'error:42501', 'anon cannot call ws_load') \g /dev/null
select test.is(test.as('anon', format($q$select public.ws_apply(%L, '[]', null)$q$, test.id('g'))), 'error:42501', 'anon cannot call ws_apply') \g /dev/null
select test.is(test.as('anon', format('select public.lead_assign_next(%L)', test.id('g'))), 'error:42501', 'anon cannot call lead_assign_next') \g /dev/null
select test.is(test.as('anon', format($q$select * from public.client_find_duplicate(%L, 'x@example.com')$q$, test.id('g'))), 'error:42501', 'anon cannot call client_find_duplicate') \g /dev/null

-- =====================================================================================================================
-- 11. Company configuration: its structure is checked for every caller
-- =====================================================================================================================
select test.begin_section('11. configuration') \g /dev/null

select test.ok(app.config_problem('{}') is null, 'an empty configuration is valid: the company runs as its edition ships') \g /dev/null
do $$
declare
  bad jsonb := $j$[
    ["two stages with the same id",        {"leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"open"},{"id":"new","label":{"en":"New 2","es":"Nuevo 2"},"kind":"open"},{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["no won stage",                       {"leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"open"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["no lost stage",                      {"leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"open"},{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"}]}],
    ["no open stage",                      {"leadStages":[{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["a stage kind that does not exist",   {"leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"maybe"},{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["a stage without a Spanish label",    {"leadStages":[{"id":"new","label":{"en":"New"},"kind":"open"},{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["a stage id with spaces",             {"leadStages":[{"id":"Brand New","label":{"en":"New","es":"Nuevo"},"kind":"open"},{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["a stage role that does not exist",   {"leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"open","role":"dancing"},{"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}],
    ["stages that are not a list",         {"leadStages":{"new":true}}],
    ["two sources with the same id",       {"leadSources":[{"id":"web","label":{"en":"Web","es":"Web"}},{"id":"web","label":{"en":"Web 2","es":"Web 2"}}]}],
    ["task types without the plain one",   {"taskTypes":[{"id":"call","label":{"en":"Call","es":"Llamada"}}]}],
    ["a label for a role that does not exist", {"roleLabels":{"boss":{"en":"Boss","es":"Jefe"}}}],
    ["capabilities for a role that does not exist", {"roles":{"boss":["leads"]}}],
    ["capabilities for the owner",         {"roles":{"owner":["leads"]}}],
    ["a capability that does not exist",   {"roles":{"staff":["leads","everything"]}}],
    ["write for the read-only role",       {"roles":{"readonly":["leads","write"]}}],
    ["delete for the read-only role",      {"roles":{"readonly":["leads","delete"]}}],
    ["a module switch that is not true or false", {"modules":{"leads":"yes"}}],
    ["wording for a language that does not exist", {"terms":{"fr":{"job":"projet"}}}],
    ["routing inside the configuration",   {"routing":{"mode":"manual","pool":[],"cursor":0,"exclude":[],"skipAway":true}}],
    ["a quick link that would run script", {"quickLinks":[{"id":"x","label":{"en":"Portal","es":"Portal"},"url":"javascript:alert(1)"}]}],
    ["a role that does not exist in the sign-in rules", {"security":{"idleMinutes":30,"mfaRoles":["boss"]}}],
    ["an idle time of zero",               {"security":{"idleMinutes":0,"mfaRoles":[]}}],
    ["opening hours that are not times",   {"hours":{"days":[1,2,3],"open":"nine","close":"17:00"}}],
    ["a week day that does not exist",     {"hours":{"days":[1,9],"open":"09:00","close":"17:00"}}],
    ["a vault rule that does not exist",   {"vault":{"approval":"nobody","revealSeconds":60}}],
    ["a negative prepay window",           {"appointments":{"noDoubleBooking":true,"prepayHours":-1,"creditDays":0}}]
  ]$j$;
  e jsonb; res text;
begin
  for e in select value from jsonb_array_elements(bad) loop
    perform test.ok(app.config_problem(e -> 1) is not null, format('config_problem names what is wrong with: %s', e ->> 0));
    res := test.as('service', format('update public.tenants set config = %L where id = %L', e -> 1, test.id('g')));
    perform test.is(res, 'error:23514', format('refused for every caller, the server key included: %s', e ->> 0));
  end loop;
  perform test.ok(jsonb_array_length(bad) = 27, 'all 27 kinds of broken configuration were tried');
end $$;
select test.is((select config::text from public.tenants where id = test.id('g')), '{}', 'none of them was stored') \g /dev/null

-- a complete, valid configuration is accepted
select test.is(test.as('g_owner', format('update public.tenants set config = %L where id = %L', $j${
  "leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"open","role":"new"},{"id":"quoted","label":{"en":"Quoted","es":"Cotizado","zh":"已报价"},"kind":"open","role":"proposal","hot":true},
                {"id":"won","label":{"en":"Won","es":"Ganado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"},{"id":"spam","label":{"en":"Spam","es":"Spam"},"kind":"lost"}],
  "leadSources":[{"id":"website","label":{"en":"Website","es":"Sitio web"}},{"id":"fair","label":{"en":"Trade fair","es":"Feria"}}],
  "lostReasons":[{"id":"price","label":{"en":"Price","es":"Precio"}}],
  "taskTypes":[{"id":"todo","label":{"en":"To do","es":"Por hacer"}},{"id":"call","label":{"en":"Call","es":"Llamada"}}],
  "clientTypes":[{"id":"llc","label":{"en":"LLC","es":"LLC"}}],
  "roleLabels":{"manager":{"en":"Crew lead","es":"Jefe de cuadrilla"}},
  "roles":{"staff":["leads","clients","tasks","write"]},
  "modules":{"reviews":false,"deadlines":true},
  "terms":{"en":{"job":"visit"},"es":{"job":"visita"}},
  "appointments":{"noDoubleBooking":true,"prepayHours":24,"creditDays":90},
  "vault":{"approval":"second_person","revealSeconds":45},
  "security":{"idleMinutes":20,"mfaRoles":["owner","manager"]},
  "hours":{"days":[1,2,3,4,5],"open":"08:30","close":"17:00"},
  "quickLinks":[{"id":"books","label":{"en":"Bookkeeping portal","es":"Portal de contabilidad"},"url":"https://books.example.com/login"}],
  "somethingNew":{"kept":true}
}$j$, test.id('g'))), 'rows:1', 'a complete valid configuration is accepted (and a part the database does not know yet is kept)') \g /dev/null
select test.is(test.value('g_staff', format('select app.can(%L, %L)::text || app.can(%L, %L)::text', test.id('g'), 'tasks', test.id('g'), 'documents')), 'truefalse', 'and its role list is in force at once') \g /dev/null
select test.is(test.as('g_staff', format($q$update public.tenants set config = '{}' where id = %L$q$, test.id('g'))), 'rows:0', 'staff cannot change the configuration') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.tenants set config = '{}' where id = %L$q$, test.id('g'))), 'rows:0', 'a manager cannot either, by default') \g /dev/null
select test.is(test.as('g_readonly', format($q$update public.tenants set config = '{}' where id = %L$q$, test.id('g'))), 'rows:0', 'nor the read-only person') \g /dev/null
select test.is(test.as('b_owner', format($q$update public.tenants set config = '{}' where id = %L$q$, test.id('g'))), 'rows:0', 'nor the owner of another company') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('g') and table_name = 'tenants' and action = 'update' and actor = test.id('g_owner') and new_data ? 'config'),
  'the change of configuration is in the audit log, with who made it') \g /dev/null

-- =====================================================================================================================
-- 12. Stages and sources are configuration: a lead is checked against its own company's lists
-- =====================================================================================================================
select test.begin_section('12. configurable stages') \g /dev/null

-- G has its own stages now: new, quoted, won, lost, spam. Sources: website, fair.
select test.is(test.as('g_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2001', 'Lead quoted', 'service', 'fair', 'quoted')$q$, test.id('g'))), 'rows:1', 'a company with its own stages accepts its own stage and its own source') \g /dev/null
select test.is(test.as('g_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2002', 'Lead scheduled', 'service', 'website', 'scheduled')$q$, test.id('g'))), 'error:23514', 'and refuses a stage of the edition it replaced') \g /dev/null
select test.is(test.as('g_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2003', 'Lead phone', 'service', 'phone', 'new')$q$, test.id('g'))), 'error:23514', 'and a source it removed') \g /dev/null
select test.is(test.as('service', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2004', 'Lead by server', 'service', 'website', 'scheduled')$q$, test.id('g'))), 'error:23514', 'the server key is held to the same lists') \g /dev/null
select test.ok(app.stage_kind(test.id('g'), 'quoted') = 'open' and app.stage_kind(test.id('g'), 'spam') = 'lost' and app.stage_kind(test.id('g'), 'won') = 'won'
           and app.stage_kind(test.id('g'), 'scheduled') is null, 'stage_kind answers open, won or lost for the company''s own stages, and nothing for a stage it does not have') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = config - 'leadStages' || '{"leadStages":[{"id":"new","label":{"en":"New","es":"Nuevo"},"kind":"open"},{"id":"closed","label":{"en":"Closed","es":"Cerrado"},"kind":"won"},{"id":"lost","label":{"en":"Lost","es":"Perdido"},"kind":"lost"}]}' where id = %L$q$, test.id('g'))),
  'error:23514', 'a stage that still has leads in it cannot be removed') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.tenants set config = jsonb_set(config, '{leadSources}', '[{"id":"fair","label":{"en":"Trade fair","es":"Feria"}}]') where id = %L$q$, test.id('g'))),
  'error:23514', 'nor a source that leads still use') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.leads set status = 'spam' where tenant_id = %L and ticket = 'G-2001'$q$, test.id('g'))), 'rows:1', 'a lead moves to another of the company''s stages') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.leads set status = 'contacted' where tenant_id = %L and ticket = 'G-2001'$q$, test.id('g'))), 'error:23514', 'and not to a stage the company does not have') \g /dev/null
delete from public.leads where tenant_id = test.id('g') and ticket = 'G-2001';
select test.is(test.as('g_owner', format($q$update public.tenants set config = '{}' where id = %L$q$, test.id('g'))), 'rows:1', 'G goes back to the edition''s stages') \g /dev/null

-- the edition decides when the company has no list of its own
select test.is(test.as('p_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'P-2001', 'Lead negotiating', 'tax', 'walk_in', 'negotiating')$q$, test.id('p'))), 'rows:1', 'a practice company accepts "negotiating" and the source "walk_in"') \g /dev/null
select test.is(test.as('p_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'P-2002', 'Lead appointment', 'tax', 'existing_client', 'appointment')$q$, test.id('p'))), 'rows:1', 'and "appointment"') \g /dev/null
select test.is(test.as('p_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'P-2003', 'Lead scheduled', 'tax', 'website', 'scheduled')$q$, test.id('p'))), 'error:23514', 'and refuses "scheduled", a stage of the field editions') \g /dev/null
select test.is(test.as('g_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2005', 'Lead negotiating', 'service', 'website', 'negotiating')$q$, test.id('g'))), 'error:23514', 'a field company refuses "negotiating"') \g /dev/null
select test.is(test.as('g_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2006', 'Lead walk in', 'service', 'walk_in', 'new')$q$, test.id('g'))), 'error:23514', 'and the source "walk_in"') \g /dev/null
select test.is(test.as('g_owner', format($q$insert into public.leads (tenant_id, ticket, name, type, source, status) values (%L, 'G-2007', 'Lead scheduled', 'service', 'website', 'scheduled')$q$, test.id('g'))), 'rows:1', 'and accepts "scheduled"') \g /dev/null
select test.ok(app.stage_kind(test.id('p'), 'negotiating') = 'open' and app.stage_kind(test.id('g'), 'negotiating') is null and app.stage_kind(test.id('p'), 'lost') = 'lost',
  'stage_kind follows the edition') \g /dev/null
select test.ok((select array_agg(s ->> 'id' order by n) from jsonb_array_elements(app.edition_defaults('build') -> 'leadStages') with ordinality as x(s, n)) = array['new', 'contacted', 'scheduled', 'sent', 'won', 'lost']
           and (select array_agg(s ->> 'id' order by n) from jsonb_array_elements(app.edition_defaults('practice') -> 'leadStages') with ordinality as x(s, n)) = array['new', 'contacted', 'appointment', 'proposal', 'negotiating', 'won', 'lost'],
  'the edition defaults are the six field stages and the seven practice stages') \g /dev/null
select test.ok(not exists (select 1 from pg_constraint where conrelid = 'public.leads'::regclass and conname in ('leads_status_check', 'leads_source_check')),
  'the fixed lists on leads.status and leads.source are gone') \g /dev/null

-- =====================================================================================================================
-- 13. The tax ID of a client: nobody reads it, through any table, view or the gateway
-- =====================================================================================================================
select test.begin_section('13. tax ID secret') \g /dev/null
-- (the sample data stored a fictional number for the first client of every company: 900700001, type ssn, last four 0001)

do $$
declare who text; res text; r record;
begin
  foreach who in array array['g_owner', 'g_manager', 'g_staff', 'g_readonly', 'g_w1', 'b_owner', 'nobody', 'service', 'anon'] loop
    res := test.as(who, 'select 1 from public.client_secrets');
    perform test.is(res, 'error:42501', format('%s cannot read client_secrets', who));
    res := test.as(who, format($q$update public.client_secrets set last4 = '9999' where tenant_id = %L$q$, test.id('g')));
    perform test.is(res, 'error:42501', format('%s cannot change client_secrets', who));
    res := test.as(who, 'delete from public.client_secrets');
    perform test.is(res, 'error:42501', format('%s cannot delete from client_secrets', who));
  end loop;
  for r in select a.attname from pg_attribute a where a.attrelid = 'public.client_secrets'::regclass and a.attnum > 0 and not a.attisdropped loop
    perform test.ok(not has_column_privilege('authenticated', 'public.client_secrets', r.attname, 'SELECT')
                and not has_column_privilege('service_role', 'public.client_secrets', r.attname, 'SELECT')
                and not has_column_privilege('anon', 'public.client_secrets', r.attname, 'SELECT'),
      format('no application role holds a privilege on client_secrets.%s', r.attname));
  end loop;
end $$;
select test.ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_secrets'), 'client_secrets has no policy at all') \g /dev/null
select test.ok(not exists (
    select 1 from pg_rewrite w join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = w.oid and d.refclassid = 'pg_class'::regclass
    join pg_class v on v.oid = w.ev_class
    where d.refobjid = 'public.client_secrets'::regclass and v.oid <> 'public.client_secrets'::regclass),
  'no view reads client_secrets') \g /dev/null
select test.ok((select position('900700001'::bytea in tax_id_enc) = 0 and octet_length(tax_id_enc) > 40 from public.client_secrets where tenant_id = test.id('g')),
  'the stored value is encrypted') \g /dev/null

-- every other table and view, read as the owner: the number is nowhere
do $$
declare r record; cols text; hit bigint; n int := 0;
begin
  for r in
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and has_any_column_privilege('authenticated', c.oid, 'SELECT') order by 1
  loop
    select string_agg(format('coalesce(%I::text, '''')', a.attname), ' || ''|'' || ') into cols from pg_attribute a
    where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', r.oid, a.attnum, 'SELECT');
    perform test.login('g_owner');
    execute format('select count(*) from public.%I where (%s) ~ ''900700001|9007-00001|900-70-0001''', r.relname, cols) into hit;
    perform test.logout();
    perform test.ok(hit = 0, format('the tax ID is not readable in %s', r.relname));
    n := n + 1;
  end loop;
  perform test.ok(n >= 30, format('%s tables and views were searched as the owner', n));
end $$;
select test.ok(not exists (select 1 from public.audit_log where (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ~ '900700001'),
  'the audit log does not hold it either') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'client_secrets' and action = 'insert' and new_data ->> 'tax_id_enc' = '[redacted]' and new_data ->> 'last4' = '[redacted]'),
  'the audit log does record that a tax ID was stored, with the value and the last four digits redacted') \g /dev/null

-- the gateway: type and last four digits only, and only for people who hold "secureView"
select test.load('g_owner', 'g')::text as g_owner_load \gset
select test.ok(:'g_owner_load' !~ '900700001' and :'g_owner_load' !~ 'tax_id_enc' and :'g_owner_load' !~ '\\\\x[0-9a-f]{20}',
  'ws_load for the owner holds neither the tax ID nor its encrypted form') \g /dev/null
select test.is(test.row_of(test.load('g_owner', 'g'), 'clients', test.id('g.c1')) ->> 'taxIdType' || '/' || (test.row_of(test.load('g_owner', 'g'), 'clients', test.id('g.c1')) ->> 'taxIdLast4'),
  'ssn/0001', 'it holds the type and the last four digits') \g /dev/null
select test.is(test.row_of(test.load('g_staff', 'g'), 'clients', test.id('g.c1')) ->> 'taxIdLast4', '0001', 'staff hold "secureView" and see the last four digits too') \g /dev/null
update public.tenants set config = jsonb_build_object('roles', jsonb_build_object('staff', to_jsonb(array_remove(app.role_permissions('landscape', 'staff'), 'secureView')))) where id = test.id('g');
select test.ok(not (test.row_of(test.load('g_staff', 'g'), 'clients', test.id('g.c1')) ?| array['taxIdLast4', 'taxIdType']) and test.row_of(test.load('g_staff', 'g'), 'clients', test.id('g.c1')) ->> 'name' = 'Client g',
  'without "secureView" the client comes without them') \g /dev/null
update public.tenants set config = '{}' where id = test.id('g');

-- the two display columns cannot be written by anyone: not directly, not through the gateway, not by hiding them in "extra"
select test.is(test.as('g_owner', format($q$update public.clients set tax_id_last4 = '9999' where id = %L$q$, test.id('g.c1'))), 'error:42501', 'the owner cannot change the last four digits') \g /dev/null
select test.is(test.as('g_owner', format($q$update public.clients set tax_id_type = null, tax_id_last4 = null where id = %L$q$, test.id('g.c1'))), 'error:42501', 'nor clear them') \g /dev/null
select test.is(test.as('g_owner', format($q$insert into public.clients (tenant_id, name, tax_id_type, tax_id_last4) values (%L, 'Planted', 'ein', '4321')$q$, test.id('g'))), 'error:42501', 'nor create a client that looks as if a tax ID were on file') \g /dev/null
select test.is(test.as('service', format($q$update public.clients set tax_id_last4 = '9999' where id = %L$q$, test.id('g.c1'))), 'error:42501', 'the server key cannot either: only the secret itself sets them') \g /dev/null
select test.apply('g_owner', 'g', jsonb_build_array(test.op('clients', test.id('g.c1'),
  test.row_of(test.load('g_owner', 'g'), 'clients', test.id('g.c1')) - 'updatedAt' || '{"taxIdType":"ein","taxIdLast4":"9999"}'))) as tax_apply \gset
select test.is((select tax_id_type || '/' || tax_id_last4 from public.clients where id = test.id('g.c1')), 'ssn/0001', 'through the gateway the two fields are ignored: the client still shows what the secret says') \g /dev/null
select test.is(test.row_of(:'tax_apply'::jsonb -> 'server', 'clients', test.id('g.c1')) ->> 'taxIdLast4', '0001', 'and the answer hands the app the stored row back') \g /dev/null
select test.ok((select not (extra ?| array['taxIdType', 'taxIdLast4']) from public.clients where id = test.id('g.c1')), 'they did not slip into "extra"') \g /dev/null
select test.is(test.as('g_staff', format($q$update public.clients set extra = '{"taxIdType":"ein","taxIdLast4":"9999","nickname":"Gigi"}' where id = %L$q$, test.id('g.c1'))), 'rows:1', 'someone writes look-alike fields straight into "extra"') \g /dev/null
select test.is(test.row_of(test.load('g_owner', 'g'), 'clients', test.id('g.c1')) ->> 'taxIdLast4' || '/' || (test.row_of(test.load('g_owner', 'g'), 'clients', test.id('g.c1')) ->> 'nickname'),
  '0001/Gigi', 'the gateway still returns the real digits: a known field is never read from "extra" (the unknown one is)') \g /dev/null
select test.is(test.as('g_staff', format($q$insert into public.clients (id, tenant_id, name, extra) values (%L, %L, 'No tax id', '{"taxIdType":"ssn","taxIdLast4":"1234"}')$q$, test.u(1301), test.id('g'))), 'rows:1', 'the same trick on a client with no tax ID on file') \g /dev/null
select test.ok(not (test.row_of(test.load('g_owner', 'g'), 'clients', test.u(1301)) ?| array['taxIdType', 'taxIdLast4']), 'does not make one appear') \g /dev/null
-- the secret is the only source: change it, and the client row follows; remove it, and the fields are cleared
update public.client_secrets set tax_id_type = 'ein', last4 = '4321', tax_id_enc = app.encrypt_pii('900704321') where tenant_id = test.id('g');
select test.is((select tax_id_type || '/' || tax_id_last4 from public.clients where id = test.id('g.c1')), 'ein/4321', 'when the secret changes, the client row follows') \g /dev/null
delete from public.client_secrets where tenant_id = test.id('g');
select test.ok((select tax_id_type is null and tax_id_last4 is null from public.clients where id = test.id('g.c1')), 'when the secret is removed, the fields are cleared') \g /dev/null
select test.ok(not test.row_of(test.load('g_owner', 'g'), 'clients', test.id('g.c1')) ? 'taxIdLast4', 'and the gateway no longer shows them') \g /dev/null
delete from public.clients where id = test.u(1301);

-- =====================================================================================================================
-- 14. ws_load: the whole workspace, as each role may see it
-- =====================================================================================================================
select test.begin_section('14. ws_load') \g /dev/null

select test.load('g_owner', 'g') as lo \gset
select test.load('g_manager', 'g') as lm \gset
select test.load('g_staff', 'g') as ls \gset
select test.load('g_readonly', 'g') as lr \gset
select test.load('g_w1', 'g') as lw \gset

select test.ok(:'lo'::jsonb ->> 'pack' = 'landscape' and :'lo'::jsonb -> 'company' ->> 'name' = 'Sample Company G' and :'lo'::jsonb -> 'company' ->> 'initials' = 'G',
  'the owner gets the edition and the company') \g /dev/null
select test.is((select count(*)::text from jsonb_object_keys(:'lo'::jsonb)), (select count(distinct name)::text from app.ws_collections where top_level and parent is null),
  'ws_load has one key per registered top-level collection') \g /dev/null
-- (true as well when no collection is a placeholder any more, which is the case once every module is installed)
select test.ok(coalesce((select bool_and(jsonb_typeof(:'lo'::jsonb -> k) = 'array' and jsonb_array_length(:'lo'::jsonb -> k) = 0)
                from unnest(array['offices', 'grants', 'accessRequests', 'catalog', 'playbooks', 'apptTypes', 'appointments', 'credits', 'crossSell', 'opportunities',
                                  'reviews', 'templates', 'envelopes', 'connections', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'reveals', 'secureLog']) k
                where exists (select 1 from app.ws_collections w where w.name = k and w.kind = 'pending')), true),
  'collections whose tables are not built yet come back as empty lists') \g /dev/null
select test.is((select count(*)::text from jsonb_array_elements(:'lo'::jsonb -> 'users')), '5', 'users lists the office members (owner, manager, staff, read only, and the disabled one), not the field workers') \g /dev/null
select test.ok((select bool_or(u ->> 'role' = 'readonly') and bool_or((u -> 'active')::text = 'false') and not bool_or(u ->> 'role' = 'worker') from jsonb_array_elements(:'lo'::jsonb -> 'users') u),
  'with their role, and "active": false for the person who was switched off') \g /dev/null
select test.ok((select bool_and((j ->> 'price')::numeric > 0 and j ? 'payTerms') from jsonb_array_elements(:'lo'::jsonb -> 'jobs') j)
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'jobs', test.id('g.j1')) -> 'received') = 1
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'jobs', test.id('g.j1')) -> 'expenses') = 1
           and (test.row_of(:'lo'::jsonb, 'jobs', test.id('g.j1')) -> 'assign' -> 0 ->> 'price')::numeric = 3000
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'jobs', test.id('g.j1')) -> 'log') = 1
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'jobs', test.id('g.j1')) -> 'notes') = 1,
  'the owner gets jobs with prices, payments, expenses, assignments with amounts, work logs and notes nested in the job') \g /dev/null
select test.ok(jsonb_array_length(:'lo'::jsonb -> 'workerPays') = 4 and jsonb_array_length(:'lo'::jsonb -> 'workers') = 2 and (:'lo'::jsonb -> 'workers' -> 0) ? 'rate'
           and jsonb_array_length(:'lo'::jsonb -> 'audit') > 0 and jsonb_array_length(:'lo'::jsonb -> 'activity') = 2
           and :'lo'::jsonb -> 'automation' -> 'enabled' = '{"lead-intake": true}' and jsonb_array_length(:'lo'::jsonb -> 'automation' -> 'runs') = 1
           and :'lo'::jsonb -> 'readNotifications' = '["n1"]',
  'and worker payments, workers with pay rates, the audit log, the history, the automation switches and log, and their own dismissed notifications') \g /dev/null
select test.ok(test.row_of(:'lo'::jsonb, 'leads', test.id('g.l1')) ->> 'clientId' = test.id('g.c1')::text
           and test.row_of(:'lo'::jsonb, 'leads', test.id('g.l1')) ->> 'jobId' = test.id('g.j1')::text
           and test.row_of(:'lo'::jsonb, 'leads', test.id('g.l1')) ->> 'ownerId' = test.id('g.m_staff')::text
           and (test.row_of(:'lo'::jsonb, 'leads', test.id('g.l1')) ->> 'value')::numeric = 12000
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'leads', test.id('g.l1')) -> 'handoffs') = 1
           and test.row_of(:'lo'::jsonb, 'leads', test.id('g.l1')) -> 'handoffs' -> 0 ->> 'to' = test.id('g.m_staff')::text
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'clients', test.id('g.c1')) -> 'owners') = 1
           and jsonb_array_length(test.row_of(:'lo'::jsonb, 'clients', test.id('g.c1')) -> 'contacts') = 1
           and test.row_of(:'lo'::jsonb, 'clients', test.id('g.c1')) -> 'owners' -> 0 ->> 'primary' = 'true'
           and (select bool_or(k ->> 'assignee' = 'u:' || test.id('g.m_staff')) and bool_or(k ->> 'assignee' = 'w:' || test.id('g.w1')) from jsonb_array_elements(:'lo'::jsonb -> 'tasks') k)
           and (select bool_or(jsonb_array_length(k -> 'comments') = 1) from jsonb_array_elements(:'lo'::jsonb -> 'tasks') k)
           and :'lo'::jsonb -> 'config' -> 'routing' ->> 'mode' = 'round_robin' and jsonb_array_length(:'lo'::jsonb -> 'config' -> 'routing' -> 'pool') = 2,
  'the shapes are the app''s: camelCase links, handoffs on the lead, owners and contacts on the client, "u:" and "w:" assignees, comments on the task, routing in the configuration') \g /dev/null

-- office staff and the read-only role: the same rows without money
select test.ok((select count(*) = 2 and bool_and((j ->> 'price')::numeric = 0 and j ->> 'payTerms' = '' and j -> 'received' = '[]' and j -> 'expenses' = '[]') from jsonb_array_elements(:'ls'::jsonb -> 'jobs') j)
           -- ids and timestamps are random digits and can contain any short number by chance: they are taken out before looking for the amounts
           and regexp_replace(regexp_replace(:'ls'::jsonb::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g'), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+Z-]+', '', 'g') !~ '10000|Half on start|1042|820\.5',
  'staff get both jobs with price 0, no payment terms, no payments and no expenses: the amounts are nowhere in what they load') \g /dev/null
select test.ok((select bool_and((a ->> 'price')::numeric = 0 and not a ? 'rate') from jsonb_array_elements(test.row_of(:'ls'::jsonb, 'jobs', test.id('g.j1')) -> 'assign') a)
           and jsonb_array_length(test.row_of(:'ls'::jsonb, 'jobs', test.id('g.j1')) -> 'assign') = 1
           and jsonb_array_length(:'ls'::jsonb -> 'workerPays') = 0
           and jsonb_array_length(:'ls'::jsonb -> 'workers') = 2 and not (:'ls'::jsonb -> 'workers' -> 0) ?| array['rate', 'payType', 'w9Date', 'hasTaxId']
           and jsonb_array_length(:'ls'::jsonb -> 'audit') = 0 and jsonb_array_length(:'ls'::jsonb -> 'activity') = 1
           and jsonb_array_length(:'ls'::jsonb -> 'automation' -> 'runs') = 0,
  'they see who is assigned without amounts, the worker directory without pay rates, no worker payments, no audit log, and history without the entries that carry amounts') \g /dev/null
select test.ok(app.ws_norm(:'lr'::jsonb - 'readNotifications' - 'users') = app.ws_norm(:'ls'::jsonb - 'readNotifications' - 'users'), 'the read-only person loads exactly what staff load') \g /dev/null
select test.ok(jsonb_array_length(:'lm'::jsonb -> 'audit') = 0 and jsonb_array_length(:'lm'::jsonb -> 'workerPays') = 4, 'a manager gets the money and not the audit log') \g /dev/null

-- a field worker: the portal, nothing else
select test.ok(jsonb_array_length(:'lw'::jsonb -> 'jobs') = 1 and :'lw'::jsonb -> 'jobs' -> 0 ->> 'id' = test.id('g.j1')::text and (:'lw'::jsonb -> 'jobs' -> 0 ->> 'price')::numeric = 0
           and jsonb_array_length(:'lw'::jsonb -> 'jobs' -> 0 -> 'assign') = 1 and :'lw'::jsonb -> 'jobs' -> 0 -> 'assign' -> 0 ->> 'workerId' = test.id('g.w1')::text
           and jsonb_array_length(:'lw'::jsonb -> 'tasks') = 1 and jsonb_array_length(:'lw'::jsonb -> 'workerPays') = 3
           and jsonb_array_length(:'lw'::jsonb -> 'workers') = 1 and :'lw'::jsonb -> 'workers' -> 0 ->> 'id' = test.id('g.w1')::text and not (:'lw'::jsonb -> 'workers' -> 0) ? 'rate',
  'a worker gets their one job without the price, their own assignment, task, payments and profile') \g /dev/null
select test.ok((select bool_and(jsonb_array_length(:'lw'::jsonb -> k) = 0) from unnest(array['users', 'leads', 'clients', 'docs', 'activity', 'messages', 'audit']) k)
           and :'lw'::jsonb -> 'config' = '{}' and :'lw'::jsonb -> 'settings' = '{}' and :'lw'::jsonb -> 'company' ->> 'name' = 'Sample Company G'
           and regexp_replace(regexp_replace(:'lw'::jsonb::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g'), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+Z-]+', '', 'g') !~ 'Client g|g-client@example|Worker Two|10000|Half on start'
           and (select count(*) from jsonb_object_keys(:'lw'::jsonb)) = (select count(*) from jsonb_object_keys(:'lo'::jsonb)),
  'and nothing of the office: no clients, leads, documents, team, history, configuration; the other worker and the job price are nowhere in it') \g /dev/null

-- nobody loads a company they do not belong to
do $$
declare who text;
begin
  foreach who in array array['b_owner', 'a_owner', 'nobody', 'g_disabled'] loop
    perform test.is(test.as(who, format('select public.ws_load(%L)', test.id('g'))), 'error:42501', format('%s cannot load company G', who));
    perform test.is(test.as(who, format('select public.ws_session(%L)', test.id('g'))), 'error:42501', format('%s gets no session for company G', who));
    perform test.is(test.as(who, format('select public.ws_hidden_clients(%L)', test.id('g'))), 'error:42501', format('%s cannot list hidden clients of company G', who));
  end loop;
end $$;
select test.is(test.as('service', format('select public.ws_load(%L)', test.id('g'))), 'error:42501', 'the server key cannot call ws_load: it is always called with a person''s own token') \g /dev/null
select test.ok(:'lo'::jsonb::text !~ 'Sample Company B|Client b|b-client@example|B-J-1001|B-1001' and :'lo'::jsonb::text !~ replace(test.id('b')::text, '-', '.'),
  'what the owner of G loads holds nothing of company B') \g /dev/null
update public.tenants set status = 'closed' where id = test.id('g');
select test.is(test.as('g_owner', format('select public.ws_load(%L)', test.id('g'))), 'error:42501', 'a closed company cannot be loaded, not even by its owner') \g /dev/null
update public.tenants set status = 'active' where id = test.id('g');

-- =====================================================================================================================
-- 15. ws_apply
-- =====================================================================================================================
select test.begin_section('15. ws_apply') \g /dev/null

-- ---- a new client with nested lists and a field the database has no column for
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), jsonb_build_object(
  'name', 'Nadia Sample', 'company', 'Sample Garden Rooms', 'phone', '609-555-0150', 'email', 'nadia@example.com', 'addresses', jsonb_build_array('5 Sample Way'),
  'since', '2026-01-15', 'kind', 'business', 'clientType', 'llc', 'lang', 'es', 'tags', jsonb_build_array('vip', 'spring'), 'smsOptIn', true,
  'externalIds', jsonb_build_object('square', 'sq_cust_1501'), 'assignedTo', test.id('g.m_manager'),
  'favoriteColor', 'teal',
  'notes', jsonb_build_array(
     jsonb_build_object('id', test.u(1502), 'at', '2026-01-15T14:00:00.000Z', 'kind', 'call', 'text', 'First call', 'pin', true, 'by', test.id('g.m_owner')),
     jsonb_build_object('id', test.u(1503), 'at', '2026-01-16T15:30:00.000Z', 'kind', 'note', 'text', 'Second note', 'by', test.id('g.m_staff'), 'mentions', jsonb_build_array(test.id('g.m_manager')))),
  'owners', jsonb_build_array(
     jsonb_build_object('id', test.u(1504), 'name', 'Zed Owner', 'pct', 60, 'primary', true),
     jsonb_build_object('id', test.u(1505), 'name', 'Amy Owner', 'pct', 40)),
  'contacts', jsonb_build_array(jsonb_build_object('id', test.u(1506), 'name', 'Front Desk', 'email', 'desk@example.com'))))), 'gw-key-1501') as r1 \gset
select test.ok((:'r1'::jsonb ->> 'ok')::boolean and :'r1'::jsonb ->> 'applied' = '1' and :'r1'::jsonb -> 'rejected' = '[]', 'staff creates a client through the gateway') \g /dev/null
select test.ok((select name = 'Nadia Sample' and kind = 'business' and client_type = 'llc' and lang = 'es' and tags = array['vip', 'spring'] and sms_opt_in
                   and external_ids = '{"square":"sq_cust_1501"}' and assigned_to = test.id('g.m_manager') and since = date '2026-01-15' and tenant_id = test.id('g')
                from public.clients where id = test.u(1501)),
  'every field landed in its own column, in the right company') \g /dev/null
select test.is((select extra::text from public.clients where id = test.u(1501)), '{"favoriteColor": "teal"}', 'the field without a column went to "extra", and nothing else did') \g /dev/null
select test.is((select string_agg(name, ',' order by position) from public.client_people where client_id = test.u(1501) and role = 'owner'), 'Zed Owner,Amy Owner', 'the owners kept the order they were sent in') \g /dev/null
select test.ok((select count(*) = 2 and bool_and(by_member_id = test.id('g.m_staff')) from public.notes where client_id = test.u(1501)),
  'both notes are stamped with the person who was signed in, whoever the row named') \g /dev/null
select test.ok(test.row_of(:'r1'::jsonb -> 'server', 'clients', test.u(1501)) -> 'notes' -> 1 ->> 'by' = test.id('g.m_staff')::text
           and test.row_of(:'r1'::jsonb -> 'server', 'clients', test.u(1501)) ->> 'favoriteColor' = 'teal',
  'the answer hands back the row as stored (the stamped author), with the unknown field merged in') \g /dev/null
select test.ok(:'r1'::jsonb -> 'versions' -> 'clients' ->> test.u(1501)::text = (select app.ws_token(updated_at) from public.clients where id = test.u(1501)),
  'and its new version') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('g') and table_name = 'clients' and action = 'insert' and row_id = test.u(1501)
                         and actor = test.id('g_staff') and actor_role = 'staff' and new_data ->> 'email' = '[redacted]' and new_data ->> 'name' = 'Nadia Sample'),
  'the audit log has the new client, with who created it and the contact details redacted') \g /dev/null
select test.ok(app.ws_norm(test.row_of(test.load('g_staff', 'g'), 'clients', test.u(1501))) = app.ws_norm(test.row_of(:'r1'::jsonb -> 'server', 'clients', test.u(1501))),
  'ws_load returns that same row') \g /dev/null

-- ---- the same idempotency key
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), jsonb_build_object(
  'name', 'Nadia Sample', 'company', 'Sample Garden Rooms', 'phone', '609-555-0150', 'email', 'nadia@example.com', 'addresses', jsonb_build_array('5 Sample Way'),
  'since', '2026-01-15', 'kind', 'business', 'clientType', 'llc', 'lang', 'es', 'tags', jsonb_build_array('vip', 'spring'), 'smsOptIn', true,
  'externalIds', jsonb_build_object('square', 'sq_cust_1501'), 'assignedTo', test.id('g.m_manager'),
  'favoriteColor', 'teal',
  'notes', jsonb_build_array(
     jsonb_build_object('id', test.u(1502), 'at', '2026-01-15T14:00:00.000Z', 'kind', 'call', 'text', 'First call', 'pin', true, 'by', test.id('g.m_owner')),
     jsonb_build_object('id', test.u(1503), 'at', '2026-01-16T15:30:00.000Z', 'kind', 'note', 'text', 'Second note', 'by', test.id('g.m_staff'), 'mentions', jsonb_build_array(test.id('g.m_manager')))),
  'owners', jsonb_build_array(
     jsonb_build_object('id', test.u(1504), 'name', 'Zed Owner', 'pct', 60, 'primary', true),
     jsonb_build_object('id', test.u(1505), 'name', 'Amy Owner', 'pct', 40)),
  'contacts', jsonb_build_array(jsonb_build_object('id', test.u(1506), 'name', 'Front Desk', 'email', 'desk@example.com'))))), 'gw-key-1501') as r1b \gset
select test.ok((:'r1b'::jsonb ->> 'replayed')::boolean and :'r1b'::jsonb - 'replayed' = :'r1'::jsonb, 'the same request with the same key returns the stored answer, marked as a replay') \g /dev/null
select count(*) as audit_1501 from public.audit_log where row_id = test.u(1501) \gset
select test.is(:'audit_1501'::text, '1', 'and nothing was applied a second time') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.ws_apply(%L, %L::jsonb, 'gw-key-1501')$q$, test.id('g'), jsonb_build_array(test.op('clients', test.u(1507), '{"name":"Someone else"}')))),
  'error:22023', 'the same key with a different request is refused, not answered with the wrong result') \g /dev/null
select test.ok(not exists (select 1 from public.clients where id = test.u(1507)), 'and that other request changed nothing') \g /dev/null
select test.apply('g_manager', 'g', jsonb_build_array(test.op('clients', test.u(1508), '{"name":"Keyed by another person"}')), 'gw-key-1501') as r1c \gset
select test.ok(not :'r1c'::jsonb ? 'replayed' and exists (select 1 from public.clients where id = test.u(1508)), 'a key belongs to the person who used it: the same text from someone else is a new request') \g /dev/null
-- a payment retried with the same key is recorded once (the brief, section 89)
select jsonb_build_array(test.op('jobs', test.id('g.j1'), test.row_of(test.load('g_manager', 'g'), 'jobs', test.id('g.j1')) - 'updatedAt'
  || jsonb_build_object('received', (test.row_of(test.load('g_manager', 'g'), 'jobs', test.id('g.j1')) -> 'received')
       || jsonb_build_array(jsonb_build_object('id', test.u(1509), 'date', '2026-03-01', 'method', 'zelle', 'ref', 'Second half', 'amount', 2500.129))))) as pay_ops \gset
select test.apply('g_manager', 'g', :'pay_ops'::jsonb, 'gw-pay-1') as rp \gset
select test.apply('g_manager', 'g', :'pay_ops'::jsonb, 'gw-pay-1') as rp2 \gset
select test.ok((:'rp2'::jsonb ->> 'replayed')::boolean and (select count(*) = 2 from public.client_payments where job_id = test.id('g.j1'))
           and (select amount = 2500.13 from public.client_payments where id = test.u(1509))
           and (select count(*) = 1 from public.audit_log where table_name = 'client_payments' and row_id = test.u(1509)),
  'a payment sent twice with one key (a double click, a retry) is recorded once') \g /dev/null
select test.ok((test.row_of(test.row_of(:'rp'::jsonb -> 'server', 'jobs', test.id('g.j1')), 'received', test.u(1509)) ->> 'amount')::numeric = 2500.13,
  'the amount was rounded to cents by the database, and the answer says so') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'client_payments' and action = 'insert' and row_id = test.u(1509) and actor = test.id('g_manager')), 'the payment is in the audit log') \g /dev/null

-- ---- another company's id inside a row, and another company's rows
select test.apply('g_owner', 'g', jsonb_build_array(
  test.op('clients', test.u(1510), jsonb_build_object('name', 'Wrong company', 'tenantId', test.id('b'))),
  test.op('clients', test.u(1511), jsonb_build_object('name', 'Wrong company too', 'tenant_id', test.id('b'))),
  test.op('clients', test.id('b.c1'), jsonb_build_object('name', 'Taken over')),
  test.op('tasks', test.u(1512), jsonb_build_object('title', 'Points at B', 'assignee', '', 'status', 'todo', 'pri', 'low', 'created', '2026-01-01', 'clientId', test.id('b.c1'))),
  test.del('clients', test.id('b.c1')))) as rt \gset
select test.is(test.reason(:'rt'::jsonb, test.u(1510)::text) || ',' || test.reason(:'rt'::jsonb, test.u(1511)::text), 'wrong_tenant,wrong_tenant', 'a row that names another company is refused') \g /dev/null
select test.ok(not exists (select 1 from public.clients where id in (test.u(1510), test.u(1511))), 'and nothing is created, in either company') \g /dev/null
select test.is((select e ->> 'reason' from jsonb_array_elements(:'rt'::jsonb -> 'rejected') e where e ->> 'id' = test.id('b.c1')::text and e ->> 'c' = 'clients' limit 1), 'duplicate',
  'the id of another company''s client cannot be taken over: the write is refused') \g /dev/null
select test.is(test.reason(:'rt'::jsonb, test.u(1512)::text), 'missing_reference', 'a row cannot point at another company''s record') \g /dev/null
select test.ok((select name = 'Client b' and tenant_id = test.id('b') from public.clients where id = test.id('b.c1')) and :'rt'::jsonb ->> 'applied' = '1',
  'the other company''s client is untouched (the delete found nothing to delete in this company, which is not an error)') \g /dev/null
select test.is(test.as('g_owner', format($q$select public.ws_apply(%L, '[]'::jsonb, null)$q$, test.id('b'))), 'error:42501', 'ws_apply for a company one does not belong to is refused outright') \g /dev/null
select test.is(test.as('g_w1', format($q$select public.ws_apply(%L, '[]'::jsonb, null)$q$, test.id('g'))), 'error:42501', 'a field worker cannot use ws_apply at all') \g /dev/null
select test.is(test.as('service', format($q$select public.ws_apply(%L, '[]'::jsonb, null)$q$, test.id('g'))), 'error:42501', 'nor can the server key') \g /dev/null

-- ---- no "write"
select test.fingerprint(test.id('g')) as g_before \gset
select test.apply('g_readonly', 'g', jsonb_build_array(
  test.op('clients', test.u(1520), '{"name":"By read only"}'),
  test.op('clients', test.u(1501), '{"name":"Renamed by read only"}'),
  test.op('activity', test.u(1521), jsonb_build_object('at', '2026-01-01T00:00:00.000Z', 'kind', 'client.created', 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)), 'by', test.id('g.m_readonly'))),
  test.op('company', test.u(1522), '{"name":"Renamed"}'),
  test.del('clients', test.u(1501)),
  test.op('readNotifications', test.u(1523), '{"ids":["n-a","n-b"]}')), 'gw-key-ro') as ro \gset
select test.is((select string_agg(distinct e ->> 'reason' || '/' || (e ->> 'detail'), ',') from jsonb_array_elements(:'ro'::jsonb -> 'rejected') e), 'forbidden/write', 'every change by the read-only person is refused for lack of "write"') \g /dev/null
select test.ok(:'ro'::jsonb ->> 'applied' = '1' and jsonb_array_length(:'ro'::jsonb -> 'rejected') = 5 and not (:'ro'::jsonb ->> 'ok')::boolean, 'five refused, one applied') \g /dev/null
select test.is(test.fingerprint(test.id('g')), :'g_before', 'the company data is unchanged') \g /dev/null
select test.is((select read_notifications::text from public.member_state where member_id = test.id('g.m_readonly')), '{n-a,n-b}', 'the one thing applied is their own dismissed notifications') \g /dev/null

-- ---- a collection the role may not write
select test.apply('g_staff', 'g', jsonb_build_array(
  test.op('workerPays', test.u(1530), jsonb_build_object('date', '2026-02-01', 'method', 'cash', 'ref', '', 'amount', 100, 'workerId', test.id('g.w1'), 'jobId', '')),
  test.op('workers', test.u(1531), '{"name":"Planted worker","trade":"x","phone":"","email":"","w9":false}'),
  test.op('company', test.u(1532), '{"name":"Renamed by staff"}'),
  test.op('settings', test.u(1533), '{"x":2}'),
  test.op('config', test.u(1534), '{"leadSources":[{"id":"x","label":{"en":"X","es":"X"}}]}'),
  test.op('automation', test.u(1535), '{"enabled":false}'),
  test.del('clients', test.u(1508)),
  test.del('tasks', test.id('g.t_office')),
  test.op('jobs', test.u(1536), jsonb_build_object('number', 'G-J-1536', 'name', 'Staff job', 'clientId', test.u(1501), 'address', '', 'type', 'service', 'status', 'estimate',
     'price', 9999, 'start', '', 'end', '', 'repeat', 'quarterly', 'scope', 'Trim', 'payTerms', 'Net 30', 'managerId', test.id('g.m_staff'), 'created', '2026-02-01', 'period', 'Q1 2026',
     'assign', '[]'::jsonb, 'expenses', jsonb_build_array(jsonb_build_object('id', test.u(1537), 'date', '2026-02-01', 'vendor', 'V', 'desc', 'D', 'amount', 50)), 'received', '[]'::jsonb, 'log', '[]'::jsonb, 'notes', '[]'::jsonb)))) as rs \gset
select test.is(test.reason(:'rs'::jsonb, test.u(1530)::text) || ',' || test.reason(:'rs'::jsonb, test.u(1531)::text) || ',' || test.reason(:'rs'::jsonb, test.u(1532)::text) || ','
            || test.reason(:'rs'::jsonb, test.u(1533)::text) || ',' || test.reason(:'rs'::jsonb, test.u(1534)::text) || ',' || test.reason(:'rs'::jsonb, test.u(1535)::text),
  'forbidden,forbidden,forbidden,forbidden,forbidden,forbidden', 'staff are refused in the collections their role may not write: worker payments, workers, the company record, settings, configuration, automation switches') \g /dev/null
select test.is(test.reason(:'rs'::jsonb, test.u(1508)::text) || '/' || test.detail(:'rs'::jsonb, test.u(1508)::text) || ',' || test.reason(:'rs'::jsonb, test.id('g.t_office')::text),
  'forbidden/delete,forbidden', 'deleting needs the "delete" capability, which staff do not hold') \g /dev/null
select test.ok(exists (select 1 from public.clients where id = test.u(1508)) and exists (select 1 from public.tasks where id = test.id('g.t_office'))
           and not exists (select 1 from public.worker_payments where id = test.u(1530)) and not exists (select 1 from public.workers where id = test.u(1531))
           and (select name = 'Sample Company G' and settings = '{}' and config = '{}' from public.tenants where id = test.id('g')),
  'and none of it happened') \g /dev/null
select test.is(test.reason(:'rs'::jsonb, test.u(1536)::text), 'applied', 'staff do create a job') \g /dev/null
select test.ok((select price = 0 and pay_terms = '' and repeat = 'quarterly' and period = 'Q1 2026' and scope = 'Trim' from public.jobs where id = test.u(1536))
           and not exists (select 1 from public.job_expenses where id = test.u(1537)),
  'through the view of 0007: the price and payment terms they sent are not stored, and neither is the expense') \g /dev/null
select test.ok((test.row_of(:'rs'::jsonb -> 'server', 'jobs', test.u(1536)) ->> 'price')::numeric = 0, 'the answer shows the job as stored, with price 0') \g /dev/null
select test.apply('g_manager', 'g', jsonb_build_array(test.op('jobs', test.u(1536), test.row_of(test.load('g_manager', 'g'), 'jobs', test.u(1536)) || '{"price": 1800, "payTerms": "Net 15"}'))) as rj \gset
select test.apply('g_staff', 'g', jsonb_build_array(test.op('jobs', test.u(1536), test.row_of(test.load('g_staff', 'g'), 'jobs', test.u(1536)) || '{"status": "contract", "price": 1}'))) as rj2 \gset
select test.ok((:'rj2'::jsonb ->> 'ok')::boolean and (select status = 'contract' and price = 1800 and pay_terms = 'Net 15' from public.jobs where id = test.u(1536)),
  'when staff edit a job a manager priced, the price stays what the manager set') \g /dev/null
select test.apply('g_manager', 'g', jsonb_build_array(test.del('clients', test.u(1508)), test.del('clients', test.u(1508)))) as rd \gset
select test.ok((:'rd'::jsonb ->> 'ok')::boolean and :'rd'::jsonb ->> 'applied' = '2' and not exists (select 1 from public.clients where id = test.u(1508)),
  'a manager holds "delete": the client is gone (and deleting what is already gone is not an error)') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'clients' and action = 'delete' and row_id = test.u(1508) and actor = test.id('g_manager')), 'the deletion is in the audit log') \g /dev/null
select test.apply('g_manager', 'g', jsonb_build_array(test.del('clients', test.id('g.c1')))) as rd2 \gset
select test.is(test.reason(:'rd2'::jsonb, test.id('g.c1')::text), 'in_use', 'a client that still has jobs cannot be deleted: the answer says it is in use') \g /dev/null

-- ---- read-only collections
do $$
declare c text; r jsonb; n int := 0;
begin
  foreach c in array array['audit', 'secureLog', 'reveals', 'credits', 'connections', 'grants', 'users'] loop
    r := test.apply('g_owner', 'g', jsonb_build_array(test.op(c, test.u(1540), '{"name":"x","role":"owner","action":"forged"}'), test.del(c, test.id('g.m_staff'))));
    perform test.ok(jsonb_array_length(r -> 'rejected') = 2 and r ->> 'applied' = '0'
      and (select bool_and(e ->> 'reason' in ('read_only', 'not_ready')) from jsonb_array_elements(r -> 'rejected') e),
      format('%s cannot be written through ws_apply, even by the owner (%s)', c, (select string_agg(distinct e ->> 'reason', ',') from jsonb_array_elements(r -> 'rejected') e)));
    n := n + 1;
  end loop;
  perform test.ok(n = 7, 'all seven read-only collections were tried');
end $$;
select test.ok((select role = 'staff' and status = 'active' from public.tenant_members where id = test.id('g.m_staff')) and not exists (select 1 from public.audit_log where action = 'forged'),
  'the member is still there with the same role, and no audit entry was forged') \g /dev/null
select test.apply('g_owner', 'g', jsonb_build_array(
  test.op('unicorns', test.u(1541), '{}'), test.op('leads.notes', test.u(1542), '{"text":"direct"}'),
  jsonb_build_object('c', 'clients', 'op', 'explode', 'id', test.u(1543)), jsonb_build_object('c', 'clients', 'op', 'upsert'), '"not an operation"'::jsonb,
  test.op('clients', test.u(1544), '{"id":"00000000-0000-4000-9000-000000009999","name":"Id mismatch"}') || jsonb_build_object('id', test.u(1544)),
  jsonb_build_object('c', 'clients', 'op', 'upsert', 'id', 'not-a-uuid', 'row', '{"name":"Bad id"}'::jsonb),
  jsonb_build_object('c', 'clients', 'op', 'upsert', 'id', test.u(1545), 'row', '"a string"'::jsonb))) as ru \gset
select test.is((select string_agg(e ->> 'reason', ',' order by n) from jsonb_array_elements(:'ru'::jsonb -> 'rejected') with ordinality as x(e, n)),
  'unknown_collection,unknown_collection,invalid,invalid,invalid,invalid,invalid,invalid',
  'a collection that does not exist, a nested list addressed directly, and malformed operations are each refused with a reason') \g /dev/null
select test.is(test.as('g_owner', format($q$select public.ws_apply(%L, '{"not":"a list"}'::jsonb, null)$q$, test.id('g'))), 'error:22023', 'changes that are not a list are refused as a whole') \g /dev/null
select test.is(test.as('g_owner', format($q$select public.ws_apply(%L, (select jsonb_agg(jsonb_build_object('c', 'clients', 'op', 'delete', 'id', gen_random_uuid())) from generate_series(1, 1001)), null)$q$, test.id('g'))), 'error:22023', 'more than 1000 changes in one request are refused as a whole') \g /dev/null

-- ---- two people edit the same row
select test.row_of(test.load('g_owner', 'g'), 'clients', test.u(1501)) as c_owner_copy \gset
select test.row_of(test.load('g_staff', 'g'), 'clients', test.u(1501)) as c_staff_copy \gset
select pg_sleep(0.01) \g /dev/null
select test.apply('g_owner', 'g', jsonb_build_array(test.op('clients', test.u(1501), :'c_owner_copy'::jsonb || '{"phone":"609-555-0151"}'))) as s1 \gset
select test.ok((:'s1'::jsonb ->> 'ok')::boolean and :'s1'::jsonb -> 'versions' -> 'clients' ->> test.u(1501)::text <> :'c_owner_copy'::jsonb ->> 'updatedAt', 'the first edit is applied and the row gets a new version') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), :'c_staff_copy'::jsonb || '{"company":"Overwritten"}'))) as s2 \gset
select test.is(test.reason(:'s2'::jsonb, test.u(1501)::text), 'stale', 'the second person, still holding the old version, is refused as stale') \g /dev/null
select test.ok(test.row_of(:'s2'::jsonb -> 'server', 'clients', test.u(1501)) ->> 'phone' = '609-555-0151'
           and (select company = 'Sample Garden Rooms' and phone = '609-555-0151' from public.clients where id = test.u(1501)),
  'nothing was overwritten, and the answer carries the current row so the app can show it') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), test.row_of(:'s2'::jsonb -> 'server', 'clients', test.u(1501)) || '{"company":"Sample Garden Rooms LLC"}'))) as s3 \gset
select test.ok((:'s3'::jsonb ->> 'ok')::boolean and (select company = 'Sample Garden Rooms LLC' from public.clients where id = test.u(1501)), 'with the current version the edit goes through') \g /dev/null
-- a change to a nested list moves the version of the row that carries it
select test.row_of(test.load('g_owner', 'g'), 'clients', test.u(1501)) as c_before_note \gset
select pg_sleep(0.01) \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), :'c_before_note'::jsonb
  || jsonb_build_object('notes', (:'c_before_note'::jsonb -> 'notes') || jsonb_build_array(jsonb_build_object('id', test.u(1550), 'at', '2026-02-02T10:00:00.000Z', 'kind', 'note', 'text', 'Third note', 'by', test.id('g.m_staff'))))))) as s4 \gset
select test.apply('g_owner', 'g', jsonb_build_array(test.op('clients', test.u(1501), :'c_before_note'::jsonb || '{"referredBy":"A friend"}'))) as s5 \gset
select test.ok((:'s4'::jsonb ->> 'ok')::boolean and test.reason(:'s5'::jsonb, test.u(1501)::text) = 'stale' and (select count(*) = 3 from public.notes where client_id = test.u(1501)),
  'adding a note makes older copies of the client stale, so a list sent from an old copy cannot wipe the new note') \g /dev/null
-- a row sent without its version is "last write wins"; a list that is not sent is left alone
select test.apply('g_owner', 'g', jsonb_build_array(test.op('clients', test.u(1501), (:'c_before_note'::jsonb - 'updatedAt' - 'notes' - 'owners' - 'contacts') || '{"referredBy":"A friend"}'))) as s6 \gset
select test.ok((:'s6'::jsonb ->> 'ok')::boolean and (select referred_by = 'A friend' from public.clients where id = test.u(1501))
           and (select count(*) = 3 from public.notes where client_id = test.u(1501)) and (select count(*) = 3 from public.client_people where client_id = test.u(1501)),
  'a row without a version is applied as it is, and nested lists that were not sent are left as they are') \g /dev/null

-- ---- nested lists: removing
select test.row_of(test.load('g_staff', 'g'), 'clients', test.u(1501)) as c_now \gset
update public.notes set by_member_id = test.id('g.m_owner') where id = test.u(1502);
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), :'c_now'::jsonb
  || jsonb_build_object('notes', (select jsonb_agg(e) from jsonb_array_elements(:'c_now'::jsonb -> 'notes') e where e ->> 'id' <> test.u(1502)::text))))) as n1 \gset
select test.is(test.reason(:'n1'::jsonb, test.u(1501)::text) || '/' || test.detail(:'n1'::jsonb, test.u(1501)::text), 'forbidden/remove:notes', 'staff cannot remove a note someone else wrote') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1501), :'c_now'::jsonb
  || jsonb_build_object('notes', (select jsonb_agg(e) from jsonb_array_elements(:'c_now'::jsonb -> 'notes') e where e ->> 'id' <> test.u(1550)::text),
                        'owners', (select jsonb_agg(e) from jsonb_array_elements(:'c_now'::jsonb -> 'owners') e where e ->> 'id' <> test.u(1505)::text))))) as n2 \gset
select test.ok((:'n2'::jsonb ->> 'ok')::boolean and not exists (select 1 from public.notes where id = test.u(1550)) and exists (select 1 from public.notes where id = test.u(1502))
           and not exists (select 1 from public.client_people where id = test.u(1505)),
  'staff remove a note they wrote themselves, and a person from the client''s list of owners') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'notes' and action = 'delete' and row_id = test.u(1550) and old_data ->> 'text' = '[redacted]'), 'a removed note leaves an audit entry without its wording') \g /dev/null
select test.apply('g_manager', 'g', jsonb_build_array(test.op('clients', test.u(1501), test.row_of(test.load('g_manager', 'g'), 'clients', test.u(1501)) || '{"notes": []}'))) as n3 \gset
select test.ok((:'n3'::jsonb ->> 'ok')::boolean and not exists (select 1 from public.notes where client_id = test.u(1501)), 'a manager, who may delete, clears the notes') \g /dev/null

-- ---- a won lead, its client and its job in one request, sent in the "wrong" order
select test.apply('g_staff', 'g', jsonb_build_array(
  test.op('leads', test.u(1560), jsonb_build_object('ticket', 'G-1560', 'name', 'Omar Sample', 'phone', '609-555-0160', 'email', 'omar@example.com', 'address', '9 Sample Ct', 'type', 'service',
     'source', 'referral', 'status', 'won', 'pri', 'high', 'ownerId', test.id('g.m_staff'), 'value', null, 'created', '2026-02-10', 'clientId', test.u(1561), 'jobId', test.u(1562),
     'apptDate', '2026-02-12', 'apptTime', '09:30', 'nextAction', jsonb_build_object('text', 'Send welcome', 'due', '2026-02-13'), 'lastContact', '2026-02-11T16:20:00.000Z',
     'serviceIds', jsonb_build_array(test.u(1590), test.u(1591)), 'kind', 'individual', 'lang', 'en', 'notes', '[]'::jsonb,
     'handoffs', jsonb_build_array(jsonb_build_object('id', test.u(1563), 'at', '2026-02-10T12:00:00.000Z', 'from', '', 'to', test.id('g.m_staff'), 'by', 'automation', 'how', 'round_robin')))),
  test.op('jobs', test.u(1562), jsonb_build_object('number', 'G-J-1562', 'name', 'Spring cleanup', 'clientId', test.u(1561), 'address', '9 Sample Ct', 'type', 'service', 'status', 'contract',
     'price', 0, 'start', '2026-03-01', 'end', '', 'repeat', 'yearly', 'scope', '', 'payTerms', '', 'managerId', test.id('g.m_staff'), 'created', '2026-02-11', 'leadId', test.u(1560),
     'assign', '[]'::jsonb, 'expenses', '[]'::jsonb, 'received', '[]'::jsonb, 'log', '[]'::jsonb, 'notes', '[]'::jsonb)),
  test.op('clients', test.u(1561), jsonb_build_object('name', 'Omar Sample', 'phone', '609-555-0160', 'email', 'omar@example.com', 'addresses', jsonb_build_array('9 Sample Ct'), 'since', '2026-02-11', 'notes', '[]'::jsonb)),
  test.op('tasks', test.u(1564), jsonb_build_object('title', 'Welcome call', 'jobId', test.u(1562), 'leadId', test.u(1560), 'clientId', test.u(1561), 'assignee', 'u:' || test.id('g.m_staff'),
     'due', '2026-02-13', 'status', 'todo', 'pri', 'medium', 'created', '2026-02-11', 'type', 'call', 'requestedBy', 'Omar', 'channel', 'whatsapp',
     'comments', jsonb_build_array(jsonb_build_object('id', test.u(1565), 'at', '2026-02-11T17:00:00.000Z', 'by', test.id('g.m_owner'), 'text', 'Call after 5')))),
  test.op('docs', test.u(1566), jsonb_build_object('kind', 'engagement_letter', 'number', 'G-EL-1566', 'title', 'Engagement letter', 'jobId', '', 'clientId', '', 'leadId', test.u(1560),
     'status', 'draft', 'created', '2026-02-11', 'updated', '2026-02-11', 'folder', 'Onboarding', 'file', jsonb_build_object('name', 'letter.pdf', 'size', 1200, 'mime', 'application/pdf', 'path', 'docs/letter.pdf'),
     'esign', jsonb_build_object('demo', true, 'signerName', 'Omar Sample', 'signerEmail', 'omar@example.com', 'status', 'signed', 'sentAt', '2026-02-11T10:00:00.000Z', 'signedAt', '2026-02-11T11:00:00.000Z'))),
  test.op('messages', test.u(1567), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'channel', 'whatsapp', 'to', '609-555-0160', 'subject', '', 'body', 'Welcome', 'status', 'draft',
     'ref', jsonb_build_object('type', 'lead', 'id', test.u(1560)), 'clientId', test.u(1561), 'by', test.id('g.m_owner'), 'threadId', 'th-1'))),
  'gw-key-1560') as w1 \gset
select test.ok((:'w1'::jsonb ->> 'ok')::boolean and :'w1'::jsonb ->> 'applied' = '6', 'a lead, the job that points back at it, their client, a task, a document and a message are applied in one request, whatever the order') \g /dev/null
select test.ok((select client_id = test.u(1561) and job_id = test.u(1562) and value is null and appt_time = time '09:30' and next_action_text = 'Send welcome' and next_action_due = date '2026-02-13'
                   and last_contact = timestamptz '2026-02-11T16:20:00Z' and service_ids = array[test.u(1590), test.u(1591)] and kind = 'individual'
                from public.leads where id = test.u(1560))
           and (select lead_id = test.u(1560) and repeat = 'yearly' and end_date is null from public.jobs where id = test.u(1562)),
  'the lead points at its client and its job, the job points at the lead, and the new lead fields are in their columns') \g /dev/null
select test.ok((select by_kind = 'automation' and by_member_id is null and from_member_id is null and to_member_id = test.id('g.m_staff') and how = 'round_robin' from public.lead_handoffs where id = test.u(1563))
           and (select assignee_member_id = test.id('g.m_staff') and type = 'call' and channel = 'whatsapp' and requested_by = 'Omar' from public.tasks where id = test.u(1564))
           and (select by_member_id = test.id('g.m_staff') from public.task_comments where id = test.u(1565))
           and (select by_member_id = test.id('g.m_staff') and channel = 'whatsapp' and ref_type = 'lead' and ref_id = test.u(1560) and thread_id = 'th-1' from public.messages where id = test.u(1567)),
  'the handoff, the task and its comment, and the message are stored; comment and message carry the person signed in, not the name that was sent') \g /dev/null
select test.ok((select esign_status is null and esign_signed_at is null and not esign_demo and job_id is null and client_id is null and lead_id = test.u(1560) and file ->> 'path' = 'docs/letter.pdf'
                from public.documents where id = test.u(1566))
           and not test.row_of(:'w1'::jsonb -> 'server', 'docs', test.u(1566)) ? 'esign',
  'the signature a browser claimed for the document is not stored: signature evidence is written by the server only, and the answer shows the document without it') \g /dev/null
select test.ok(:'w1'::jsonb #> '{server,leads}' is null and :'w1'::jsonb #> '{server,jobs}' is null and :'w1'::jsonb #> '{server,clients}' is null
           and test.row_of(test.load('g_staff', 'g'), 'leads', test.u(1560)) -> 'nextAction' = '{"due": "2026-02-13", "text": "Send welcome"}'
           and test.row_of(test.load('g_staff', 'g'), 'leads', test.u(1560)) ->> 'lastContact' = '2026-02-11T16:20:00.000Z'
           and test.row_of(test.load('g_staff', 'g'), 'leads', test.u(1560)) ->> 'apptTime' = '09:30'
           and test.row_of(test.load('g_staff', 'g'), 'leads', test.u(1560)) -> 'value' = 'null'
           and test.row_of(test.load('g_staff', 'g'), 'leads', test.u(1560)) -> 'handoffs' -> 0 ->> 'by' = 'automation'
           and test.row_of(test.load('g_staff', 'g'), 'leads', test.u(1560)) -> 'handoffs' -> 0 ->> 'from' = '',
  'the lead, the job and the client were stored exactly as sent (the answer lists none of them under "server"), and ws_load returns the lead in the app''s own formats') \g /dev/null
-- a link to a row that does not exist
select test.apply('g_staff', 'g', jsonb_build_array(
  test.op('tasks', test.u(1570), jsonb_build_object('title', 'Orphan', 'jobId', test.u(1599), 'assignee', '', 'status', 'todo', 'pri', 'low', 'created', '2026-02-11')),
  test.op('leads', test.u(1571), jsonb_build_object('ticket', 'G-1571', 'name', 'Dangling', 'phone', '', 'email', '', 'address', '', 'type', 'service', 'source', 'website', 'status', 'new',
     'pri', 'low', 'ownerId', '', 'value', 100, 'created', '2026-02-11', 'jobId', test.u(1599), 'notes', '[]'::jsonb)),
  test.op('leads', test.u(1572), jsonb_build_object('ticket', 'G-1572', 'name', 'Bad stage', 'phone', '', 'email', '', 'address', '', 'type', 'service', 'source', 'website', 'status', 'negotiating',
     'pri', 'low', 'ownerId', '', 'value', 100, 'created', '2026-02-11', 'notes', '[]'::jsonb)),
  test.op('leads', test.u(1573), jsonb_build_object('ticket', 'G-1560', 'name', 'Same ticket', 'phone', '', 'email', '', 'address', '', 'type', 'service', 'source', 'website', 'status', 'new',
     'pri', 'low', 'ownerId', '', 'value', -5, 'created', '2026-02-11', 'notes', '[]'::jsonb)),
  test.op('leads', test.u(1574), jsonb_build_object('ticket', 'G-1574', 'phone', '', 'email', '', 'address', '', 'type', 'service', 'source', 'website', 'status', 'new', 'pri', 'low', 'ownerId', '', 'value', 1, 'created', 'yesterday')))) as w2 \gset
select test.is(test.reason(:'w2'::jsonb, test.u(1570)::text) || ',' || test.reason(:'w2'::jsonb, test.u(1571)::text) || ',' || test.reason(:'w2'::jsonb, test.u(1572)::text) || '/' || test.detail(:'w2'::jsonb, test.u(1572)::text)
            || ',' || test.reason(:'w2'::jsonb, test.u(1573)::text) || ',' || test.reason(:'w2'::jsonb, test.u(1574)::text),
  'missing_reference,missing_reference,invalid/leads_status_configured,invalid,invalid',
  'a link to nothing, a stage the company does not have, a negative amount and a date that is not a date are each refused with a reason') \g /dev/null
select test.ok((select job_id is null from public.leads where id = test.u(1571)) and test.row_of(:'w2'::jsonb -> 'server', 'leads', test.u(1571)) ->> 'name' = 'Dangling'
           and not exists (select 1 from public.leads where id in (test.u(1572), test.u(1573), test.u(1574))) and not exists (select 1 from public.tasks where id = test.u(1570)),
  'the lead whose job link pointed at nothing is stored without the link, and the answer returns it as stored; the others are not stored') \g /dev/null

-- ---- all or nothing
select test.apply('g_staff', 'g', jsonb_build_object('atomic', true, 'ops', jsonb_build_array(
  test.op('clients', test.u(1580), '{"name":"Atomic client"}'),
  test.op('tasks', test.u(1581), jsonb_build_object('title', 'Atomic task', 'clientId', test.u(1580), 'assignee', '', 'status', 'todo', 'pri', 'low', 'created', '2026-02-11')),
  test.op('leads', test.u(1582), jsonb_build_object('ticket', 'G-1582', 'name', 'Atomic lead', 'type', 'service', 'source', 'website', 'status', 'no-such-stage'))))) as at1 \gset
select test.is(:'at1'::jsonb ->> 'applied' || '/' || test.reason(:'at1'::jsonb, test.u(1580)::text) || '/' || test.reason(:'at1'::jsonb, test.u(1581)::text) || '/' || test.reason(:'at1'::jsonb, test.u(1582)::text),
  '0/rolled_back/rolled_back/invalid', 'an atomic batch with one refused change applies nothing and says which change was the cause') \g /dev/null
select test.ok(not exists (select 1 from public.clients where id = test.u(1580)) and not exists (select 1 from public.tasks where id = test.u(1581)), 'nothing of it is in the database') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_object('atomic', true, 'ops', jsonb_build_array(
  test.op('clients', test.u(1580), '{"name":"Atomic client"}'),
  test.op('tasks', test.u(1581), jsonb_build_object('title', 'Atomic task', 'clientId', test.u(1580), 'assignee', '', 'status', 'todo', 'pri', 'low', 'created', '2026-02-11'))))) as at2 \gset
select test.ok((:'at2'::jsonb ->> 'ok')::boolean and :'at2'::jsonb ->> 'applied' = '2' and exists (select 1 from public.tasks where id = test.u(1581) and client_id = test.u(1580)), 'the same batch without the bad change is applied whole') \g /dev/null

-- ---- history and messages: what only the database or the server may say
select test.apply('g_staff', 'g', jsonb_build_array(
  test.op('activity', test.u(1600), jsonb_build_object('at', '2020-01-01T00:00:00.000Z', 'kind', 'client.updated', 'params', jsonb_build_object('client', 'Nadia'), 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)),
     'also', jsonb_build_array(jsonb_build_object('type', 'job', 'id', test.u(1536))), 'by', test.id('g.m_owner'))),
  test.op('activity', test.u(1601), jsonb_build_object('at', '2026-02-01T00:00:00.000Z', 'kind', 'task.created', 'ref', jsonb_build_object('type', 'appointment', 'id', test.u(1599)), 'by', 'automation')),
  test.op('activity', test.u(1602), jsonb_build_object('at', '2026-02-01T00:00:00.000Z', 'kind', 'doc.signed', 'ref', jsonb_build_object('type', 'doc', 'id', test.u(1566)), 'by', 'system')))) as h1 \gset
select test.ok((:'h1'::jsonb ->> 'ok')::boolean
           and (select by_kind = 'member' and by_id = test.id('g.m_staff') and at > now() - interval '1 minute' and also = jsonb_build_array(jsonb_build_object('type', 'job', 'id', test.u(1536))) from public.activity where id = test.u(1600))
           and (select by_kind = 'automation' and by_id is null and ref_type = 'appointment' from public.activity where id = test.u(1601))
           and (select by_kind = 'member' and by_id = test.id('g.m_staff') from public.activity where id = test.u(1602)),
  'history is written in the name of the person signed in and at the current time, whatever was sent; an entry by "automation" stays one; nobody can sign as "system"') \g /dev/null
select test.ok(jsonb_array_length(:'h1'::jsonb -> 'server' -> 'activity') = 3 and test.row_of(:'h1'::jsonb -> 'server', 'activity', test.u(1600)) ->> 'by' = test.id('g.m_staff')::text, 'and the answer returns the entries as stamped') \g /dev/null
select test.apply('g_owner', 'g', jsonb_build_array(
  test.op('activity', test.u(1600), jsonb_build_object('at', '2020-01-01T00:00:00.000Z', 'kind', 'rewritten', 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)), 'by', test.id('g.m_owner'))),
  test.del('activity', test.u(1601)))) as h2 \gset
select test.is(test.reason(:'h2'::jsonb, test.u(1600)::text) || ',' || test.reason(:'h2'::jsonb, test.u(1601)::text), 'append_only,append_only', 'history cannot be rewritten or deleted through the gateway, not even by the owner') \g /dev/null
select test.apply('g_owner', 'g', jsonb_build_array(
  test.op('messages', test.u(1610), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'channel', 'email', 'to', 'c@example.com', 'subject', 'Hi', 'body', 'Body', 'status', 'sent', 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)))),
  test.op('messages', test.u(1611), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'channel', 'email', 'to', 'c@example.com', 'subject', 'Hi', 'body', 'Body', 'status', 'received', 'dir', 'in', 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)))),
  test.op('messages', test.u(1612), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'channel', 'text', 'to', '609-555-0150', 'subject', '', 'body', 'Sample text', 'status', 'demo', 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)),
     'provider', 'sms', 'externalId', 'SM-forged', 'error', 'none')),
  test.op('messages', test.u(1613), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'channel', 'email', 'to', 'c@example.com', 'subject', 'Hi', 'body', 'Body', 'status', 'draft', 'ref', jsonb_build_object('type', 'client', 'id', test.u(1501)))))) as m1 \gset
select test.is(test.reason(:'m1'::jsonb, test.u(1610)::text) || ',' || test.reason(:'m1'::jsonb, test.u(1611)::text) || ',' || test.reason(:'m1'::jsonb, test.u(1612)::text) || ',' || test.reason(:'m1'::jsonb, test.u(1613)::text),
  'forbidden,forbidden,applied,applied', 'a person, the owner included, cannot record a message as sent or received; a draft and a "demo" message are accepted') \g /dev/null
select test.ok((select provider is null and external_id is null and error is null and status = 'demo' from public.messages where id = test.u(1612)), 'the provider fields a browser sent are not stored') \g /dev/null
-- the server queues and sends it; afterwards a person can only mark it read
select test.is(test.as('service', format($q$update public.messages set status = 'delivered', provider = 'gmail', external_id = 'msg-1613' where id = %L$q$, test.u(1613))), 'rows:1', 'the server records the delivery') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(test.op('messages', test.u(1613), test.row_of(test.load('g_staff', 'g'), 'messages', test.u(1613)) || '{"body":"Changed after sending"}'))) as m2 \gset
select test.apply('g_staff', 'g', jsonb_build_array(test.op('messages', test.u(1613), test.row_of(test.load('g_staff', 'g'), 'messages', test.u(1613)) || '{"read":true}'))) as m3 \gset
select test.ok(test.reason(:'m2'::jsonb, test.u(1613)::text) = 'forbidden' and (:'m3'::jsonb ->> 'ok')::boolean
           and (select body = 'Body' and read and status = 'delivered' and external_id = 'msg-1613' from public.messages where id = test.u(1613))
           and test.row_of(test.load('g_staff', 'g'), 'messages', test.u(1613)) ->> 'provider' = 'gmail',
  'a delivered message cannot be reworded; it can be marked read; the provider fields the server set are returned') \g /dev/null

-- ---- the parts that are not lists
select test.apply('g_owner', 'g', jsonb_build_array(
  test.op('company', test.u(1620), '{"name":"Green Field Sample Co","initials":"GF","license":"Lic. 0000 (sample)","phone":"609-555-0100","email":"office@example.com","legalName":"Green Field Sample LLC","timezone":"America/New_York","accent":"#22aa66"}'),
  test.op('settings', test.u(1621), '{"calendar":{"weekStart":1},"consent1099":{"name":"Forged","at":"2020-01-01T00:00:00.000Z"}}'),
  test.op('config', test.u(1622), jsonb_build_object('lostReasons', '[{"id":"price","label":{"en":"Price","es":"Precio"}}]'::jsonb,
     'routing', jsonb_build_object('mode', 'round_robin', 'pool', jsonb_build_array(test.id('g.m_manager'), test.id('g.m_staff')), 'cursor', 7, 'exclude', '[]'::jsonb, 'skipAway', true, 'fallbackId', test.id('g.m_owner')))),
  jsonb_build_object('c', 'automation', 'op', 'upsert', 'id', 'job-completed', 'row', '{"enabled":false}'::jsonb),
  test.op('automationRuns', test.u(1623), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'ruleId', 'lead-intake', 'steps', '[{"key":"auto.step.task"}]'::jsonb, 'dedupe', 'lead-intake:1560', 'status', 'ok')))) as p1 \gset
select test.ok((:'p1'::jsonb ->> 'ok')::boolean and :'p1'::jsonb ->> 'applied' = '5', 'the owner saves the company record, the settings, the configuration, an automation switch and a run') \g /dev/null
select test.ok((select name = 'Green Field Sample Co' and legal_name = 'Green Field Sample LLC' and timezone = 'America/New_York' and branding ->> 'accent' = '#22aa66' and not branding ? 'name'
                   and settings = '{"calendar":{"weekStart":1}}' and config = '{"lostReasons":[{"id":"price","label":{"en":"Price","es":"Precio"}}]}'
                from public.tenants where id = test.id('g')),
  'name and legal name are columns, the rest of the company is branding; the forged 1099 consent is not stored; routing is not kept in the configuration') \g /dev/null
select test.ok((select mode = 'round_robin' and pool = array[test.id('g.m_manager'), test.id('g.m_staff')] and fallback_id = test.id('g.m_owner') and cursor = 0 from public.lead_routing where tenant_id = test.id('g'))
           and (select enabled = false from public.automation_settings where tenant_id = test.id('g') and rule_id = 'job-completed')
           and (select status = 'ok' and dedupe = 'lead-intake:1560' from public.automation_runs where id = test.u(1623)),
  'routing went to lead_routing (the turn sent by the browser was ignored), the switch and the run are stored') \g /dev/null
select test.ok(test.load('g_owner', 'g') -> 'company' ->> 'legalName' = 'Green Field Sample LLC' and test.load('g_owner', 'g') -> 'config' -> 'routing' ->> 'fallbackId' = test.id('g.m_owner')::text
           and test.load('g_owner', 'g') -> 'settings' = '{"calendar":{"weekStart":1}}' and test.load('g_owner', 'g') -> 'automation' -> 'enabled' ->> 'job-completed' = 'false',
  'and ws_load returns them in the app''s shape') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(
  test.op('automationRuns', test.u(1624), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'ruleId', 'lead-intake', 'steps', '[]'::jsonb, 'dedupe', 'lead-intake:1560')),
  test.op('automationRuns', test.u(1625), jsonb_build_object('at', '2026-02-11T18:00:00.000Z', 'ruleId', 'lead-intake', 'steps', '[]'::jsonb, 'dedupe', 'lead-intake:1571')))) as p2 \gset
select test.is(test.reason(:'p2'::jsonb, test.u(1624)::text) || ',' || test.reason(:'p2'::jsonb, test.u(1625)::text), 'duplicate,applied',
  'a rule never records the same occasion twice (the dedupe key); staff can record a run even though they cannot read the log') \g /dev/null
-- a manager may change the routing (assignLeads) and nothing else of the configuration
select test.apply('g_manager', 'g', jsonb_build_array(test.op('config', test.u(1626), (test.load('g_manager', 'g') -> 'config')
  || jsonb_build_object('routing', (test.load('g_manager', 'g') -> 'config' -> 'routing') || jsonb_build_object('exclude', jsonb_build_array(test.id('g.m_manager'))))))) as p3 \gset
select test.apply('g_manager', 'g', jsonb_build_array(test.op('config', test.u(1627), (test.load('g_manager', 'g') -> 'config') || '{"lostReasons":[]}'))) as p4 \gset
select test.ok((:'p3'::jsonb ->> 'ok')::boolean and (select exclude = array[test.id('g.m_manager')] from public.lead_routing where tenant_id = test.id('g'))
           and test.reason(:'p4'::jsonb, test.u(1627)::text) = 'forbidden' and (select config ? 'lostReasons' and jsonb_array_length(config -> 'lostReasons') = 1 from public.tenants where id = test.id('g')),
  'a manager changes who is in the rotation, and is refused when the same request would change another part of the configuration') \g /dev/null
select test.apply('g_owner', 'g', jsonb_build_array(test.op('config', test.u(1628), jsonb_build_object('routing', jsonb_build_object('mode', 'round_robin', 'pool', jsonb_build_array(test.id('b.m_staff')), 'exclude', '[]'::jsonb, 'skipAway', true))))) as p5 \gset
select test.is(test.reason(:'p5'::jsonb, test.u(1628)::text), 'missing_reference', 'a person of another company cannot be put in the rotation') \g /dev/null
update public.tenants set name = 'Sample Company G', config = '{}', settings = '{}' where id = test.id('g');

-- =====================================================================================================================
-- 16. Lead rotation
-- =====================================================================================================================
select test.begin_section('16. lead rotation') \g /dev/null
update public.lead_routing set mode = 'round_robin', pool = array[test.id('g.m_staff'), test.id('g.m_manager'), test.id('g.m_owner')], exclude = '{}', cursor = 0, turns = 0,
  fallback_id = test.id('g.m_owner'), skip_away = true where tenant_id = test.id('g');

select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_staff')::text, 'the first lead goes to the first person in the pool') \g /dev/null
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_manager')::text, 'the second to the second') \g /dev/null
select test.is(test.value('g_owner', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_owner')::text, 'the third to the third') \g /dev/null
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_staff')::text, 'and then the rotation starts over') \g /dev/null
select test.is((select turns || '/' || cursor || '/' || (last_member_id = test.id('g.m_staff'))::text from public.lead_routing where tenant_id = test.id('g')), '4/1/true', 'four turns were handed out and the next one is the second person''s') \g /dev/null
-- away, excluded, opted out, switched off
select test.is(test.as('g_manager', format($q$select public.member_update_profile(%L, %L, %L)$q$, test.id('g'), test.id('g.m_manager'),
  jsonb_build_object('away', jsonb_build_object('from', current_date - 1, 'to', current_date + 1, 'note', 'Out')))), 'rows:1', 'the manager marks themselves away') \g /dev/null
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_owner')::text, 'a person who is away is skipped') \g /dev/null
update public.lead_routing set skip_away = false where tenant_id = test.id('g');
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_staff')::text, 'the turn moved on normally') \g /dev/null
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_manager')::text, 'when the company does not skip people who are away, they get their turn') \g /dev/null
update public.lead_routing set skip_away = true, exclude = array[test.id('g.m_owner')] where tenant_id = test.id('g');
update public.tenant_members set in_lead_pool = false where id = test.id('g.m_staff');
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_owner')::text,
  'with one person away, one excluded and one opted out, nobody in the rotation can take the lead: it goes to the fallback owner') \g /dev/null
update public.lead_routing set fallback_id = null where tenant_id = test.id('g');
select test.is(test.value('g_staff', format($q$select coalesce(public.lead_assign_next(%L)::text, 'nobody')$q$, test.id('g'))), 'nobody', 'without a fallback owner the answer is nobody, and the lead stays unassigned') \g /dev/null
update public.tenant_members set in_lead_pool = null, away_from = null, away_to = null where tenant_id = test.id('g');
update public.lead_routing set exclude = '{}', cursor = 0,
  pool = array[test.id('g.m_readonly'), (select id from public.tenant_members where tenant_id = test.id('g') and status = 'disabled'), test.id('g.m_staff')]
  where tenant_id = test.id('g');
select test.is(test.value('g_staff', format('select public.lead_assign_next(%L)::text', test.id('g'))), test.id('g.m_staff')::text,
  'a read-only person and a person who was switched off are never given a lead') \g /dev/null
update public.lead_routing set mode = 'manual' where tenant_id = test.id('g');
select test.is(test.value('g_staff', format($q$select coalesce(public.lead_assign_next(%L)::text, 'nobody')$q$, test.id('g'))), 'nobody', 'when leads are assigned by hand the rotation hands out nothing') \g /dev/null
-- who may ask
select test.is(test.as('g_readonly', format('select public.lead_assign_next(%L)', test.id('g'))), 'error:42501', 'the read-only person cannot take a turn for a lead') \g /dev/null
select test.is(test.as('g_w1', format('select public.lead_assign_next(%L)', test.id('g'))), 'error:42501', 'nor a field worker') \g /dev/null
select test.is(test.as('b_owner', format('select public.lead_assign_next(%L)', test.id('g'))), 'error:42501', 'nor the owner of another company') \g /dev/null
select test.is(test.as('g_staff', format($q$update public.lead_routing set cursor = 0 where tenant_id = %L$q$, test.id('g'))), 'error:42501', 'nobody moves the turn by hand') \g /dev/null
select test.is(test.as('g_staff', format($q$update public.lead_routing set mode = 'round_robin' where tenant_id = %L$q$, test.id('g'))), 'rows:0', 'staff cannot change the routing: that is "assignLeads"') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.lead_routing set pool = pool || %L::uuid where tenant_id = %L$q$, test.id('b.m_staff'), test.id('g'))), 'error:23503', 'a person of another company cannot be added to the pool') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.lead_routing set pool = pool || null::uuid where tenant_id = %L$q$, test.id('g'))), 'error:23503', 'nor an empty entry') \g /dev/null
select test.is(test.as('g_manager', format($q$update public.lead_routing set exclude = array[%L]::uuid[] where tenant_id = %L$q$, test.id('g.w1'), test.id('g'))), 'error:23503', 'nor someone who is not an office member') \g /dev/null
-- one lead: the turn, the owner and the handoff in one step; asking twice does not use two turns
update public.lead_routing set mode = 'round_robin', pool = array[test.id('g.m_staff'), test.id('g.m_manager')], cursor = 0, turns = 0, fallback_id = test.id('g.m_owner') where tenant_id = test.id('g');
insert into public.leads (id, tenant_id, ticket, name, type, source, status) values (test.u(1650), test.id('g'), 'G-1650', 'Web form lead', 'service', 'website', 'new');
select test.is(test.value('service', format($q$select public.lead_assign_next(%L, %L) ->> 'assigned'$q$, test.id('g'), test.u(1650))), test.id('g.m_staff')::text, 'the server assigns a lead from the web form to the person whose turn it is') \g /dev/null
select test.is(test.value('g_staff', format($q$select public.lead_assign_next(%L, %L) ->> 'how'$q$, test.id('g'), test.u(1650))), 'kept', 'asking again for the same lead keeps its owner') \g /dev/null
select test.ok((select owner_id = test.id('g.m_staff') and original_owner_id = test.id('g.m_staff') from public.leads where id = test.u(1650))
           and (select count(*) = 1 and bool_and(by_kind = 'automation' and how = 'round_robin' and to_member_id = test.id('g.m_staff') and from_member_id is null) from public.lead_handoffs where lead_id = test.u(1650))
           and (select turns = 1 and cursor = 1 from public.lead_routing where tenant_id = test.id('g')),
  'the lead has its owner and first owner, one handoff was recorded as made by the rotation, and one turn was used, not two') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.lead_assign_next(%L, %L)$q$, test.id('g'), test.id('b.l1'))), 'error:42501', 'a lead of another company cannot be assigned') \g /dev/null
select test.is(test.as('service', format($q$update public.lead_handoffs set reason = 'rewritten' where lead_id = %L$q$, test.u(1650))), 'error:42501', 'a handoff cannot be rewritten, even by the server key') \g /dev/null
select test.is(test.try(format($q$update public.lead_handoffs set reason = 'rewritten' where lead_id = %L$q$, test.u(1650))), 'error:42501', 'nor by the database owner: the table is append only') \g /dev/null

-- =====================================================================================================================
-- 17. Duplicates
-- =====================================================================================================================
select test.begin_section('17. duplicates') \g /dev/null

select test.is(test.value('g_staff', format($q$select string_agg(client_id::text || ':' || array_to_string(matched, '+') || ':' || score, ',') from public.client_find_duplicate(%L, '  NADIA@Example.com ')$q$, test.id('g'))),
  test.u(1501)::text || ':email:40', 'an email is found whatever its capitals and spaces') \g /dev/null
select test.is(test.value('g_staff', format($q$select string_agg(client_id::text || ':' || array_to_string(matched, '+'), ',') from public.client_find_duplicate(%L, null, '+1 (609) 555.0151')$q$, test.id('g'))),
  test.u(1501)::text || ':phone', 'a phone number is found whatever its punctuation and country code') \g /dev/null
select test.is(test.value('g_staff', format($q$select string_agg(client_id::text || ':' || array_to_string(matched, '+') || ':' || score, ',') from public.client_find_duplicate(%L, null, null, 'nadia   SAMPLE.', '5 sample way')$q$, test.id('g'))),
  test.u(1501)::text || ':name+address:30', 'a name is found whatever its capitals and punctuation, and the same address adds weight') \g /dev/null
select test.is(test.value('g_staff', format($q$select string_agg(array_to_string(matched, '+'), ',') from public.client_find_duplicate(%L, 'desk@example.com')$q$, test.id('g'))),
  'contact_email', 'the email of a contact person at a client is found too') \g /dev/null
select test.is(test.as('g_staff', format($q$select * from public.client_find_duplicate(%L, 'nobody-here@example.com', '609-555-9999', 'No Such Person', '5 sample way')$q$, test.id('g'))), 'rows:0',
  'no match, no rows: an address alone is not a match (two people at one address are two clients)') \g /dev/null
select test.is(test.as('g_staff', format($q$select * from public.client_find_duplicate(%L, 'b-client@example.com', null, 'Client b')$q$, test.id('g'))), 'rows:0', 'a client of another company is never a match') \g /dev/null
select test.is(test.as('g_staff', format($q$select * from public.client_find_duplicate(%L, 'b-client@example.com')$q$, test.id('b'))), 'error:42501', 'and one cannot search in another company') \g /dev/null
select test.is(test.as('g_w1', format($q$select * from public.client_find_duplicate(%L, 'nadia@example.com')$q$, test.id('g'))), 'error:42501', 'a field worker cannot search clients') \g /dev/null
select test.is(test.value('g_staff', format($q$select string_agg(ticket || ':' || array_to_string(matched, '+'), ',') from public.lead_find_duplicate(%L, 'OMAR@example.com', '6095550160')$q$, test.id('g'))),
  'G-1560:email+phone', 'the same search finds a lead from the same person') \g /dev/null
-- email is NOT unique: a second client with the same address is allowed, and reported
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1701), '{"name":"Nadia Sample (household)","email":"nadia@example.com","phone":"609-555-0177"}'))) as d1 \gset
select test.ok((:'d1'::jsonb ->> 'ok')::boolean and (select count(*) = 2 from public.client_find_duplicate(test.id('g'), 'nadia@example.com')),
  'two clients may share an email (a household, a business): the second is stored, and the search now reports both') \g /dev/null
-- ids in connected systems ARE unique, per provider and per company
select test.apply('g_staff', 'g', jsonb_build_array(
  test.op('clients', test.u(1702), '{"name":"Same Square id","externalIds":{"square":"sq_cust_1501"}}'),
  test.op('clients', test.u(1703), '{"name":"Same id, other system","externalIds":{"quickbooks":"sq_cust_1501"}}'))) as d2 \gset
select test.is(test.reason(:'d2'::jsonb, test.u(1702)::text) || '/' || test.detail(:'d2'::jsonb, test.u(1702)::text) || ',' || test.reason(:'d2'::jsonb, test.u(1703)::text),
  'duplicate/clients_external_square_uidx,applied', 'the same Square customer cannot be linked to two clients; the same text as a QuickBooks id is a different thing') \g /dev/null
select test.is(test.as('service', format($q$insert into public.clients (tenant_id, name, external_ids) values (%L, 'Other company', '{"square":"sq_cust_1501"}')$q$, test.id('b'))), 'rows:1', 'and another company can hold the same id') \g /dev/null
select test.is(test.as('service', format($q$insert into public.messages (tenant_id, channel, recipient, status, dir, provider, external_id) values (%L, 'text', 'us', 'received', 'in', 'sms', 'SM-1')$q$, test.id('g'))), 'rows:1', 'the server stores an incoming message with the provider''s id') \g /dev/null
select test.is(test.as('service', format($q$insert into public.messages (tenant_id, channel, recipient, status, dir, provider, external_id) values (%L, 'text', 'us', 'received', 'in', 'sms', 'SM-1')$q$, test.id('g'))), 'error:23505', 'a retried webhook cannot store it twice') \g /dev/null
select test.is(test.as('g_staff', format($q$insert into public.leads (tenant_id, ticket, name, type) values (%L, 'G-1560', 'Same ticket', 'service')$q$, test.id('g'))), 'error:23505', 'a ticket number is unique in a company') \g /dev/null

-- =====================================================================================================================
-- 18. Office scope
-- =====================================================================================================================
select test.begin_section('18. office scope') \g /dev/null
-- two offices (plain ids until the module range builds the offices table): staff work from the first one
select test.is(test.as('g_owner', format($q$select public.member_update_profile(%L, %L, %L)$q$, test.id('g'), test.id('g.m_staff'), jsonb_build_object('officeIds', jsonb_build_array(test.u(9001)), 'title', 'Front office'))),
  'rows:1', 'the owner places staff in the first office') \g /dev/null
-- (once the module range has built the offices table and its foreign keys, the two offices must exist as rows)
do $$
begin
  if to_regclass('public.offices') is not null then
    execute format('insert into public.offices (id, tenant_id, name) values (%L, %L, %L), (%L, %L, %L)',
      test.u(9001), test.id('g'), 'First office', test.u(9002), test.id('g'), 'Second office');
  end if;
end $$;
insert into public.clients (id, tenant_id, name, phone, email, office_id) values
  (test.u(1801), test.id('g'), 'First Office Client', '609-555-0181', 'first-office@example.com', test.u(9001)),
  (test.u(1802), test.id('g'), 'Second Office Client', '609-555-0182', 'second-office@example.com', test.u(9002));
update public.clients set company = 'Second Office Company LLC' where id = test.u(1802);
insert into public.client_people (tenant_id, client_id, role, name) values (test.id('g'), test.u(1802), 'contact', 'Hidden Contact');
insert into public.notes (tenant_id, parent_type, client_id, text) values (test.id('g'), 'client', test.u(1802), 'Hidden note');
insert into public.jobs (id, tenant_id, number, name, client_id, type) values (test.u(1803), test.id('g'), 'G-J-1803', 'Hidden job', test.u(1802), 'service');
insert into public.tasks (tenant_id, title, client_id) values (test.id('g'), 'Hidden task', test.u(1802));
insert into public.documents (tenant_id, kind, number, title, client_id) values (test.id('g'), 'upload', 'G-U-1802', 'Hidden document', test.u(1802));
insert into public.messages (tenant_id, channel, recipient, subject, client_id) values (test.id('g'), 'email', 'second-office@example.com', 'Hidden message', test.u(1802));
insert into public.leads (id, tenant_id, ticket, name, type, office_id, owner_id) values
  (test.u(1804), test.id('g'), 'G-1804', 'Second office lead', 'service', test.u(9002), test.id('g.m_manager')),
  (test.u(1805), test.id('g'), 'G-1805', 'Second office lead of staff', 'service', test.u(9002), test.id('g.m_staff'));

select test.is(test.as('g_staff', format('select 1 from public.clients where id in (%L, %L)', test.u(1801), test.u(1802))), 'rows:1', 'staff of the first office see its client and not the client of the second office') \g /dev/null
select test.is(test.as('g_readonly', format('select 1 from public.clients where id in (%L, %L)', test.u(1801), test.u(1802))), 'rows:0', 'a person in no office sees neither') \g /dev/null
select test.is(test.as('g_readonly', format('select 1 from public.clients where id = %L', test.id('g.c1'))), 'rows:1', 'a client without an office is seen by everyone in the company') \g /dev/null
select test.is(test.as('g_manager', format('select 1 from public.clients where id in (%L, %L)', test.u(1801), test.u(1802))), 'rows:2', 'a manager holds "allClients" and sees both') \g /dev/null
do $$
declare r record; res text;
begin
  for r in select * from (values
      ('client_people', format('client_id = %L', test.u(1802))), ('notes', format('client_id = %L', test.u(1802))), ('jobs_basic', format('client_id = %L', test.u(1802))),
      ('tasks', format('client_id = %L', test.u(1802))), ('documents', format('client_id = %L', test.u(1802))), ('messages', format('client_id = %L', test.u(1802)))) as t(rel, cond)
  loop
    res := test.as('g_staff', format('select 1 from public.%I where %s', r.rel, r.cond));
    perform test.is(res, 'rows:0', format('what belongs to the hidden client is hidden too: %s', r.rel));
    res := test.as('g_manager', format('select 1 from public.%I where %s', r.rel, r.cond));
    perform test.is(res, 'rows:1', format('control: the manager does see it in %s', r.rel));
  end loop;
end $$;
select test.is(test.as('g_staff', format($q$update public.clients set name = 'Taken' where id = %L$q$, test.u(1802))), 'rows:0', 'a hidden client cannot be edited') \g /dev/null
select test.is(test.as('g_staff', format($q$insert into public.client_people (tenant_id, client_id, role, name) values (%L, %L, 'contact', 'Planted')$q$, test.id('g'), test.u(1802))), 'error:42501', 'nor given a contact person') \g /dev/null
select test.is(test.as('g_staff', format('select 1 from public.leads where id in (%L, %L)', test.u(1804), test.u(1805))), 'rows:1', 'leads follow the same rule, and the person who owns a lead always sees it') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.lead_assign_next(%L, %L)$q$, test.id('g'), test.u(1804))), 'error:42501', 'and a lead a person cannot open cannot be put through the rotation by them') \g /dev/null
select test.is(test.value('g_staff', format($q$select public.lead_assign_next(%L, %L) ->> 'how'$q$, test.id('g'), test.u(1805))), 'kept', 'while their own lead in that office can') \g /dev/null
select test.load('g_staff', 'g')::text as scoped \gset
select test.ok(:'scoped' ~ 'First Office Client' and :'scoped' !~ 'Second Office Client|second-office@example|Hidden (note|job|task|document|message|Contact)|Second office lead"',
  'ws_load for staff holds the first office''s client and nothing of the second office''s') \g /dev/null
select test.is(test.value('g_staff', format('select public.ws_hidden_clients(%L)::text', test.id('g'))),
  jsonb_build_array(jsonb_build_object('id', test.u(1802), 'name', 'Second Office Client', 'officeId', test.u(9002)))::text,
  'the name and office of a hidden client are all a person gets, so they can ask for access') \g /dev/null
select test.is(test.value('g_manager', format('select public.ws_hidden_clients(%L)::text', test.id('g'))), '[]', 'for a person who sees every client the list is empty') \g /dev/null
select test.apply('g_staff', 'g', jsonb_build_array(test.op('clients', test.u(1802), '{"name":"Overwritten through the gateway"}'))) as o1 \gset
select test.ok(test.reason(:'o1'::jsonb, test.u(1802)::text) <> 'applied' and (select name = 'Second Office Client' from public.clients where id = test.u(1802)), 'the gateway refuses a write to a hidden client') \g /dev/null
select test.is(test.value('g_staff', format($q$select name || '/' || coalesce(company, '-') || '/' || restricted::text from public.client_find_duplicate(%L, 'second-office@example.com')$q$, test.id('g'))),
  'Second Office Client/-/true', 'the duplicate search still finds a hidden client, so the same person is not entered twice, and returns the name only') \g /dev/null
-- the hook for access grants (the grants table belongs to the module range): the scope rules already call it
begin;
create or replace function app.granted_client_ids() returns uuid[] language sql stable set search_path = '' as $$ select array['00000000-0000-4000-9000-000000001802']::uuid[] $$;
select test.as('g_staff', format('select 1 from public.clients where id = %L', test.u(1802))) as granted_client \gset
select test.as('g_staff', format('select 1 from public.notes where client_id = %L', test.u(1802))) as granted_note \gset
rollback;
select test.is(:'granted_client' || ',' || :'granted_note', 'rows:1,rows:1', 'when app.granted_client_ids() returns a client, the person sees it and what belongs to it: the module range only has to redefine that function') \g /dev/null
select test.is(test.as('g_staff', format('select 1 from public.clients where id = %L', test.u(1802))), 'rows:0', 'control: after the rollback it is hidden again') \g /dev/null

-- =====================================================================================================================
-- 19. A person's own profile
-- =====================================================================================================================
select test.begin_section('19. profile') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.member_update_profile(%L, %L, '{"title":"Office lead","bio":"Sample bio","languages":["en","es"],"phone":"609-555-0190"}')$q$, test.id('g'), test.id('g.m_staff'))), 'rows:1', 'a person edits their own profile') \g /dev/null
select test.ok((select title = 'Office lead' and languages = array['en', 'es'] and phone = '609-555-0190' and office_ids = array[test.u(9001)] and role = 'staff' from public.tenant_members where id = test.id('g.m_staff')),
  'the changes are stored and nothing else moved') \g /dev/null
select test.is(test.as('g_readonly', format($q$select public.member_update_profile(%L, %L, '{"bio":"Looking only"}')$q$, test.id('g'), test.id('g.m_readonly'))), 'rows:1', 'so does the read-only person: their profile is their own') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.member_update_profile(%L, %L, '{"title":"Demoted"}')$q$, test.id('g'), test.id('g.m_owner'))), 'error:42501', 'a person cannot edit someone else''s profile') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.member_update_profile(%L, %L, '{"officeIds":[]}')$q$, test.id('g'), test.id('g.m_staff'))), 'error:42501', 'nor move themselves to another office') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.member_update_profile(%L, %L, '{"role":"owner"}')$q$, test.id('g'), test.id('g.m_staff'))), 'error:42501', 'nor change their own role this way') \g /dev/null
select test.is(test.as('g_staff', format($q$select public.member_update_profile(%L, %L, '{"photo":"data:image/png;base64,AAAA"}')$q$, test.id('g'), test.id('g.m_staff'))), 'error:23514', 'a photo is a path in storage, never the image itself') \g /dev/null
select test.is(test.as('b_owner', format($q$select public.member_update_profile(%L, %L, '{"title":"Planted"}')$q$, test.id('g'), test.id('g.m_staff'))), 'error:42501', 'the owner of another company cannot edit anyone here') \g /dev/null
select test.is(test.as('g_w1', format($q$select public.member_update_profile(%L, %L, '{"title":"Planted"}')$q$, test.id('g'), test.id('g.m_staff'))), 'error:42501', 'nor a field worker') \g /dev/null
select test.ok((test.row_of(test.load('g_owner', 'g'), 'users', test.id('g.m_staff')) ->> 'title') = 'Office lead'
           and test.row_of(test.load('g_owner', 'g'), 'users', test.id('g.m_staff')) -> 'officeIds' = jsonb_build_array(test.u(9001))
           and test.row_of(test.load('g_owner', 'g'), 'users', test.id('g.m_staff')) -> 'languages' = '["en","es"]',
  'ws_load returns the profile in the shape of TeamUser') \g /dev/null

-- =====================================================================================================================
-- Summary
-- =====================================================================================================================
\pset tuples_only off
\pset format aligned
\echo
select section, count(*) as checks_passed from test.results where section ~ '^1[0-9]\.' group by section order by section;
select count(*) as total_checks_passed,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r') as tables_in_public,
       (select count(*) from pg_policies where schemaname = 'public') as policies_in_public,
       (select count(distinct name) from app.ws_collections) as collections_registered
from test.results;
