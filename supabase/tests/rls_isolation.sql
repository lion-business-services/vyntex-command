-- Database rule tests. Run by run_local.sh as the cluster superuser, after setup_local.sql, the migrations and seed.sql.
-- Every check goes through test.ok(), which RAISES on failure, so the run stops at the first broken rule.
--
-- How a "signed-in person" is imitated: the same two things the Supabase Data API does for each request,
--   set request.jwt.claims = '{"sub": "<user id>", "role": "authenticated"}'   and   set role authenticated
-- (see test.login). Statements are then executed as that role, with row level security in force.

\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

-- The encryption key for this run, supplied through a database setting (the documented local option).
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null

-- =====================================================================================================================
-- Test harness
-- =====================================================================================================================
drop schema if exists test cascade;
create schema test;
grant usage on schema test to public;

create table test.results (n bigserial primary key, section text, label text not null);
create table test.ids (key text primary key, id uuid not null);
create table test.section (name text);
insert into test.section values ('setup');

create function test.id(k text) returns uuid language sql stable security definer set search_path = '' as
$$ select i.id from test.ids i where i.key = k $$;

create function test.remember(k text, v uuid) returns uuid language plpgsql as $$
begin
  insert into test.ids (key, id) values (k, v);
  return v;
end $$;

create function test.begin_section(s text) returns void language sql as $$ update test.section set name = s $$;

-- Passes or raises.
create function test.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAILED: %', label;
  end if;
  insert into test.results (section, label) select name, label from test.section;
end $$;

create function test.is(got text, want text, label text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAILED: % (got %, expected %)', label, coalesce(got, 'NULL'), coalesce(want, 'NULL');
  end if;
  insert into test.results (section, label) select name, label from test.section;
end $$;

-- Become a signed-in person (who = key in test.ids), the anonymous visitor ('anon') or the server ('service').
create function test.login(who text) returns void language plpgsql as $$
begin
  if who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', false);
    perform set_config('role', 'anon', false);
  elsif who = 'service' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
    perform set_config('role', 'service_role', false);
  else
    if test.id(who) is null then raise exception 'unknown test user %', who; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', test.id(who), 'role', 'authenticated')::text, false);
    perform set_config('role', 'authenticated', false);
  end if;
end $$;

create function test.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
end $$;

-- Runs one statement as whoever is current. Returns 'rows:<n>' (rows returned or changed) or 'error:<sqlstate>'.
create function test.try(q text) returns text language plpgsql as $$
declare
  n bigint := 0;
  rec record;
begin
  if q ~* '^\s*(select|with|table)\M' then
    -- fetch every row for real (a count(*) wrapper would let the planner skip the expressions under test)
    for rec in execute q loop n := n + 1; end loop;
  else
    execute q;
    get diagnostics n = row_count;
  end if;
  return 'rows:' || n;
exception when others then
  return 'error:' || sqlstate;
end $$;

-- Runs one statement as a given person and comes back to the test runner.
create function test.as(who text, q text) returns text language plpgsql as $$
declare r text;
begin
  perform test.login(who);
  r := test.try(q);
  perform test.logout();
  return r;
exception when others then
  perform test.logout();
  raise;
end $$;

-- Runs a query that returns one text value as a given person. NULL on error is NOT swallowed: errors propagate.
create function test.value(who text, q text) returns text language plpgsql as $$
declare r text;
begin
  perform test.login(who);
  execute q into r;
  perform test.logout();
  return r;
exception when others then
  perform test.logout();
  raise;
end $$;

-- "Blocked" means: silently filtered to nothing by row level security, or refused as not permitted (SQLSTATE 42501).
-- Any other error (a typo in a test statement, for example) does NOT count as blocked.
create function test.blocked(result text) returns boolean language sql immutable as
$$ select result in ('rows:0', 'error:42501') $$;

-- =====================================================================================================================
-- Sample data: two companies (A and B) with the same shape, written as the test runner (row level security bypassed).
-- =====================================================================================================================
create function test.new_user(k text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email) values (k || '@example.com') returning id into v;
  return test.remember(k, v);
end $$;

create function test.seed_company(p text, p_slug text, p_industry text, p_plan text) returns void language plpgsql as $$
declare
  t uuid; w1 uuid; w2 uuid; c1 uuid; l1 uuid; j1 uuid; j2 uuid; d1 uuid; x uuid;
  m_owner uuid; m_manager uuid; m_staff uuid;
  this_year date := date_trunc('year', current_date)::date;
begin
  insert into public.tenants (slug, name, industry_id, plan_id, status, branding)
    values (p_slug, 'Sample Company ' || upper(p), p_industry, p_plan, 'active', jsonb_build_object('initials', upper(p)))
    returning id into t;
  perform test.remember(p, t);

  insert into public.workers (tenant_id, name, trade, phone, email, pay_type, rate, w9)
    values (t, 'Worker One ' || p, 'Framing', '555-0101', p || '-w1@example.com', 'daily', 250, true) returning id into w1;
  insert into public.workers (tenant_id, name, trade, phone, email, pay_type, rate)
    values (t, 'Worker Two ' || p, 'Painting', '555-0102', p || '-w2@example.com', 'hourly', 35) returning id into w2;
  perform test.remember(p || '.w1', w1);
  perform test.remember(p || '.w2', w2);

  insert into public.tenant_members (tenant_id, user_id, role, name, email) values (t, test.new_user(p || '_owner'), 'owner', 'Owner ' || p, p || '_owner@example.com') returning id into m_owner;
  insert into public.tenant_members (tenant_id, user_id, role, name, email) values (t, test.new_user(p || '_manager'), 'manager', 'Manager ' || p, p || '_manager@example.com') returning id into m_manager;
  insert into public.tenant_members (tenant_id, user_id, role, name, email) values (t, test.new_user(p || '_staff'), 'staff', 'Staff ' || p, p || '_staff@example.com') returning id into m_staff;
  insert into public.tenant_members (tenant_id, user_id, role, worker_id, name) values (t, test.new_user(p || '_w1'), 'worker', w1, 'Worker One ' || p);
  insert into public.tenant_members (tenant_id, user_id, role, worker_id, name) values (t, test.new_user(p || '_w2'), 'worker', w2, 'Worker Two ' || p);
  insert into public.tenant_members (tenant_id, user_id, role, status, name) values (t, test.new_user(p || '_disabled'), 'manager', 'disabled', 'Disabled ' || p);
  perform test.remember(p || '.m_owner', m_owner);
  perform test.remember(p || '.m_manager', m_manager);
  perform test.remember(p || '.m_staff', m_staff);

  insert into public.clients (tenant_id, name, phone, email, addresses)
    values (t, 'Client ' || p, '555-0111', p || '-client@example.com', array['1 Sample Street']) returning id into c1;
  perform test.remember(p || '.c1', c1);

  insert into public.leads (tenant_id, ticket, name, type, source, status, owner_id, value, client_id)
    values (t, upper(p) || '-1001', 'Lead ' || p, 'service', 'website', 'won', m_staff, 12000, c1) returning id into l1;
  perform test.remember(p || '.l1', l1);

  insert into public.jobs (tenant_id, number, name, client_id, type, status, price, manager_id, lead_id, pay_terms)
    values (t, upper(p) || '-J-1001', 'Job One ' || p, c1, 'service', 'progress', 10000, m_manager, l1, 'Half on start, half on completion') returning id into j1;
  insert into public.jobs (tenant_id, number, name, client_id, type, status, price)
    values (t, upper(p) || '-J-1002', 'Job Two ' || p, c1, 'service', 'contract', 4000) returning id into j2;
  perform test.remember(p || '.j1', j1);
  perform test.remember(p || '.j2', j2);
  update public.leads set job_id = j1 where id = l1;

  insert into public.notes (tenant_id, parent_type, lead_id, text, by_member_id) values (t, 'lead', l1, 'Called back', m_staff);
  insert into public.notes (tenant_id, parent_type, client_id, text) values (t, 'client', c1, 'Prefers mornings');
  insert into public.notes (tenant_id, parent_type, job_id, text) values (t, 'job', j1, 'Gate code on file');

  -- Worker one is on job one, worker two is on job two.
  insert into public.job_assignments (tenant_id, job_id, worker_id, scope, price, pay_type, rate, qty, status)
    values (t, j1, w1, 'Framing', 3000, 'daily', 250, 12, 'progress') returning id into x;
  perform test.remember(p || '.as1', x);
  insert into public.job_assignments (tenant_id, job_id, worker_id, scope, price)
    values (t, j2, w2, 'Painting', 1500) returning id into x;
  perform test.remember(p || '.as2', x);

  insert into public.job_expenses (tenant_id, job_id, vendor, description, amount) values (t, j1, 'Sample Supply', 'Lumber', 820.50);
  insert into public.client_payments (tenant_id, job_id, method, ref, amount) values (t, j1, 'check', '1042', 5000) returning id into x;
  perform test.remember(p || '.cp1', x);
  insert into public.work_logs (tenant_id, job_id, worker_id, text) values (t, j1, w1, 'Framed the north wall');

  insert into public.tasks (tenant_id, title, job_id, lead_id, client_id, assignee_member_id, due)
    values (t, 'Send the agreement', j1, l1, c1, m_staff, current_date) returning id into x;
  perform test.remember(p || '.t_office', x);
  insert into public.tasks (tenant_id, title, job_id, assignee_worker_id) values (t, 'Bring the ladder', j1, w1) returning id into x;
  perform test.remember(p || '.t_w1', x);
  insert into public.tasks (tenant_id, title, job_id, assignee_worker_id) values (t, 'Mask the windows', j2, w2) returning id into x;
  perform test.remember(p || '.t_w2', x);

  -- Worker one: 2,500 by check and 400 by card this year, 900 last year. Worker two: 600 this year.
  insert into public.worker_payments (tenant_id, worker_id, job_id, date, method, ref, amount) values (t, w1, j1, this_year + 20, 'check', '2001', 2500) returning id into x;
  perform test.remember(p || '.wp_w1', x);
  insert into public.worker_payments (tenant_id, worker_id, job_id, date, method, amount) values (t, w1, j1, this_year + 40, 'card', 400);
  insert into public.worker_payments (tenant_id, worker_id, date, method, amount) values (t, w1, this_year - 30, 'cash', 900);
  insert into public.worker_payments (tenant_id, worker_id, job_id, date, method, amount) values (t, w2, j2, this_year + 25, 'zelle', 600) returning id into x;
  perform test.remember(p || '.wp_w2', x);

  insert into public.documents (tenant_id, kind, number, title, job_id, client_id)
    values (t, 'contract', upper(p) || '-C-1001', 'Job One', j1, c1) returning id into d1;
  perform test.remember(p || '.d1', d1);

  insert into public.messages (tenant_id, channel, recipient, subject, body, ref_type, ref_id)
    values (t, 'email', p || '-client@example.com', 'Welcome', 'Thank you', 'job', j1);
  insert into public.activity (tenant_id, kind, ref_type, ref_id, by_kind, by_id) values (t, 'job.created', 'job', j1, 'member', m_owner);
  insert into public.activity (tenant_id, kind, params, ref_type, ref_id, by_kind, by_id)
    values (t, 'payment.received', '{"amount":"$5,000.00"}', 'job', j1, 'member', m_owner);
  insert into public.automation_settings (tenant_id, rule_id, enabled) values (t, 'lead-intake', true);
  insert into public.automation_runs (tenant_id, rule_id, steps, ref_type, ref_id) values (t, 'lead-intake', '[{"key":"auto.step.task"}]', 'lead', l1);

  -- Consent records of the other kinds (the 1099 consent is recorded during the tests, by the owner).
  insert into public.consent_records (tenant_id, kind, subject_kind, subject_client_id, subject_name, subject_email, consent_text, method, document_id)
    values (t, 'electronic_signature', 'client', c1, 'Client ' || p, p || '-client@example.com', 'I agree to sign this document electronically.', 'typed_name', d1) returning id into x;
  perform test.remember(p || '.consent_esign', x);
  insert into public.consent_records (tenant_id, kind, subject_kind, subject_worker_id, subject_name, consent_text)
    values (t, 'text_messages', 'worker', w1, 'Worker One ' || p, 'I agree to receive work text messages.');
  insert into public.consent_records (tenant_id, kind, subject_kind, subject_member_id, subject_name, consent_text)
    values (t, 'terms_of_service', 'member', m_owner, 'Owner ' || p, 'I accept the terms of service of this workspace.');
end $$;

select test.seed_company('a', 'acme-builders', 'build', 'builder') \g /dev/null
select test.seed_company('b', 'bright-clean', 'clean', 'pro') \g /dev/null

-- A person with an account but no company, and a person who is office staff in A and owner of a third company C.
select test.new_user('nobody') \g /dev/null
select test.seed_company('c', 'third-company', 'haul', 'essential') \g /dev/null
insert into public.tenant_members (tenant_id, user_id, role, name) values (test.id('a'), test.id('c_owner'), 'staff', 'Dual role');

-- A file per worker in the stand-in storage.
insert into storage.objects (bucket_id, name) values
  ('worker-documents', test.id('a') || '/' || test.id('a.w1') || '/w9.pdf'),
  ('worker-documents', test.id('a') || '/' || test.id('a.w2') || '/w9.pdf'),
  ('worker-documents', test.id('b') || '/' || test.id('b.w1') || '/w9.pdf');

-- =====================================================================================================================
-- 1. Catalog checks: nothing was forgotten
-- =====================================================================================================================
select test.begin_section('1. catalog') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
  'every table in public has row level security enabled and forced') \g /dev/null

select test.is((select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')),
  '22', 'public has exactly the 22 expected tables') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not in ('industries', 'tenants', 'demo_requests')
      and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.atttypid = 'uuid'::regtype
                      and (a.attnotnull or c.relname = 'audit_log'))),
  'every tenant table has tenant_id uuid NOT NULL') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)),
  'every tenant table has an index that starts with tenant_id') \g /dev/null

-- Every link between tenant tables carries tenant_id on both sides.
select test.ok(
  not exists (
    select 1
    from pg_constraint k
    join pg_class src on src.oid = k.conrelid join pg_namespace n on n.oid = src.relnamespace
    join pg_class dst on dst.oid = k.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
    where k.contype = 'f' and n.nspname = 'public' and dn.nspname = 'public'
      and dst.relname not in ('tenants', 'industries')
      and not (
        (select a.attnum from pg_attribute a where a.attrelid = src.oid and a.attname = 'tenant_id') = any (k.conkey)
        and (select a.attnum from pg_attribute a where a.attrelid = dst.oid and a.attname = 'tenant_id') = any (k.confkey))),
  'every foreign key between tenant tables includes tenant_id') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')),
  'every SECURITY DEFINER function has a fixed search_path') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) priv
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, priv)),
  'anon holds no privilege on any table or view in public') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped, unnest(array['SELECT', 'INSERT', 'UPDATE']) priv
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_column_privilege('anon', c.oid, a.attnum, priv)),
  'anon holds no column privilege in public either') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'anon cannot execute any function in public or app') \g /dev/null

select test.ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'anon cannot use schema app') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('secret', 'pii_key', 'encrypt_pii', 'decrypt_pii', 'audit_write', 'request_ip_hash')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  'key, encryption and audit internals cannot be called by any application role') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_barrier'), false)),
  'every view in public is a security-barrier view') \g /dev/null

select test.ok(
  not exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('jobs_basic', 'my_jobs', 'job_assignments_basic', 'worker_directory', 'my_worker_profile')
      and a.attname in ('price', 'pay_terms', 'rate', 'qty', 'tax_id_enc') and not a.attisdropped),
  'the staff and worker views have no price, rate or tax ID columns') \g /dev/null

-- Speed guard: a policy or view that calls a per-row helper such as app.can(tenant_id, ...) in its row filter is
-- correct but slow (the function runs for every row). The filters must use the once-per-statement helpers instead.
select test.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and qual ~ 'app\.(can|is_member|has_role|is_office|member_role|current_worker|current_member|worker_assigned)\('),
  'no policy filter in public calls a per-row helper function') \g /dev/null
select test.ok(
  not exists (
    select 1 from pg_views
    where schemaname = 'public' and definition ~ 'app\.(can|is_member|has_role|is_office|member_role|current_worker|current_member|worker_assigned)\('),
  'no view in public calls a per-row helper function') \g /dev/null

-- The sample data covers every tenant table for both companies, so no later check passes on an empty table.
do $$
declare r record; na bigint; nb bigint;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
    where n.nspname = 'public' and c.relkind = 'r' order by 1
  loop
    execute format('select count(*) filter (where tenant_id = $1), count(*) filter (where tenant_id = $2) from public.%I', r.relname)
      into na, nb using test.id('a'), test.id('b');
    perform test.ok(na > 0 and nb > 0, format('sample data exists in %s for both companies', r.relname));
  end loop;
end $$;

-- =====================================================================================================================
-- 2. The anonymous visitor reads and writes nothing
-- =====================================================================================================================
select test.begin_section('2. anonymous') \g /dev/null

do $$
declare r record; res text;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') order by 1
  loop
    res := test.as('anon', format('select 1 from public.%I', r.relname));
    perform test.is(res, 'error:42501', format('anon cannot read %s', r.relname));
    res := test.as('anon', format('delete from public.%I', r.relname));
    perform test.is(res, 'error:42501', format('anon cannot delete from %s', r.relname));
  end loop;
end $$;

select test.is(test.as('anon', $q$insert into public.demo_requests (name, email) values ('X', 'x@example.com')$q$), 'error:42501',
  'anon cannot insert a demo request directly') \g /dev/null
select test.is(test.as('anon', 'select * from public.my_workspaces()'), 'error:42501', 'anon cannot call my_workspaces') \g /dev/null
select test.is(test.as('anon', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), 'error:42501', 'anon cannot call get_worker_tax_id') \g /dev/null
select test.is(test.as('anon', format('select * from public.export_1099_data(%L, 2026)', test.id('a'))), 'error:42501', 'anon cannot call export_1099_data') \g /dev/null
select test.is(test.as('anon', 'select app.is_member(gen_random_uuid())'), 'error:42501', 'anon cannot call the app helpers') \g /dev/null
select test.is(test.as('anon', $q$select 1 from storage.objects where bucket_id = 'worker-documents'$q$), 'rows:0', 'anon sees no worker document') \g /dev/null

-- demo_requests: only the server (service role) writes and reads.
select test.is(test.as('service', $q$insert into public.demo_requests (name, business, industry, phone, email, language, contact_method, team_size, message, consent, consent_text, consent_at, source_ip_hash, user_agent)
  values ('Sample Person', 'Sample Co', 'build', '555-0100', 'person@example.com', 'es', 'phone', '2-5', 'Hola', true, 'Acepto que VYNTEX me contacte sobre mi solicitud.', now(), 'abc123', 'test')$q$),
  'rows:1', 'the service role can insert a demo request') \g /dev/null
select test.is(test.as('service', 'select 1 from public.demo_requests'), 'rows:1', 'the service role can read demo requests') \g /dev/null
select test.is(test.as('a_owner', 'select 1 from public.demo_requests'), 'error:42501', 'a signed-in owner cannot read demo requests') \g /dev/null
select test.is(test.as('a_owner', $q$insert into public.demo_requests (name, email) values ('X', 'x@example.com')$q$), 'error:42501', 'a signed-in owner cannot insert demo requests') \g /dev/null
select test.is(test.as('service', $q$insert into public.demo_requests (name, email, consent) values ('X', 'x@example.com', true)$q$), 'error:23514',
  'a demo request that claims consent must carry the consent text and time') \g /dev/null
select test.is(test.as('service', $q$insert into public.demo_requests (name) values ('X')$q$), 'error:23514', 'a demo request needs a phone or an email') \g /dev/null

-- =====================================================================================================================
-- 3. Company A can never read or write company B: every table and view, taken from the catalog
-- =====================================================================================================================
select test.begin_section('3. tenant isolation') \g /dev/null

create table test.snapshot as
  select c.relname, 0::bigint as total, 0::bigint as b_rows, ''::text as b_sum
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
  where n.nspname = 'public' and c.relkind = 'r';

create function test.take_snapshot() returns void language plpgsql as $$
declare r record;
begin
  for r in select relname from test.snapshot loop
    execute format(
      'update test.snapshot s set (total, b_rows, b_sum) = (select count(*), count(*) filter (where tenant_id = $1), coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text)) filter (where tenant_id = $1)), '''') from public.%I t) where s.relname = %L',
      r.relname, r.relname) using test.id('b');
  end loop;
end $$;
select test.take_snapshot() \g /dev/null
create table test.snapshot_before as table test.snapshot;

do $$
declare
  actors constant text[] := array['a_owner', 'a_manager', 'a_staff', 'a_w1', 'a_disabled', 'c_owner', 'nobody'];
  who text;
  r record;
  res text;
  cols text;
  upd text;
  base text;
  sample jsonb;
  a_id uuid := test.id('a');
  b_id uuid := test.id('b');
  checks int := 0;
begin
  foreach who in array actors loop
    for r in
      select c.oid, c.relname, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'v')
      order by c.relname
    loop
      -- read: no row of B, and no row of any company other than A
      res := test.as(who, format('select 1 from public.%I where tenant_id = %L', r.relname, b_id));
      perform test.ok(test.blocked(res), format('%s cannot read company B rows in %s (%s)', who, r.relname, res));
      res := test.as(who, format('select 1 from public.%I where tenant_id is distinct from %L and tenant_id is distinct from %L', r.relname, a_id, test.id('c')));
      perform test.ok(test.blocked(res), format('%s sees no rows outside their own companies in %s (%s)', who, r.relname, res));

      -- update and delete B rows (the update uses a column signed-in people may write, so the row rule itself is what answers)
      select quote_ident(a.attname) into upd from pg_attribute a
      where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname not in ('id', 'tenant_id')
        and has_column_privilege('authenticated', r.oid, a.attnum, 'UPDATE')
      order by a.attnum limit 1;
      if upd is null then
        perform test.ok(not has_any_column_privilege('authenticated', r.oid, 'UPDATE'), format('%s: signed-in people have no update privilege on %s at all', who, r.relname));
      else
        res := test.as(who, format('update public.%I set %s = %s where tenant_id = %L', r.relname, upd, upd, b_id));
        perform test.ok(test.blocked(res), format('%s cannot update company B rows in %s (%s)', who, r.relname, res));
      end if;
      res := test.as(who, format('delete from public.%I where tenant_id = %L', r.relname, b_id));
      perform test.ok(test.blocked(res), format('%s cannot delete company B rows in %s (%s)', who, r.relname, res));

      -- move one of their own rows into B
      res := test.as(who, format('update public.%I set tenant_id = %L where tenant_id = %L', r.relname, b_id, a_id));
      perform test.ok(test.blocked(res), format('%s cannot move company A rows into B in %s (%s)', who, r.relname, res));

      -- insert a new row into B: a copy of a real B row with a new id, using every column the role may write
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
      where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = ''
        and has_column_privilege('authenticated', r.oid, a.attnum, 'INSERT');
      if cols is null then
        perform test.ok(not has_table_privilege('authenticated', r.oid, 'INSERT'), format('%s: signed-in people have no insert privilege on %s at all', who, r.relname));
      else
        -- (a view shows the test runner nothing, so for views the copy is taken from the table underneath)
        select coalesce(
          (select distinct d.refobjid::regclass::text
           from pg_rewrite w join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = w.oid and d.refclassid = 'pg_class'::regclass
           where r.relkind = 'v' and w.ev_class = r.oid and d.refobjid <> r.oid),
          format('public.%I', r.relname)) into base;
        execute format('select to_jsonb(t) from %s t where tenant_id = $1 limit 1', base) into sample using b_id;
        sample := jsonb_set(sample, '{id}', to_jsonb(gen_random_uuid()));
        -- a view checks its rule after the row passes the table constraints, so give the copy its own job number
        if r.relkind = 'v' and sample ? 'number' then sample := jsonb_set(sample, '{number}', to_jsonb('COPY-' || left(gen_random_uuid()::text, 8))); end if;
        res := test.as(who, format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, %L::jsonb)', r.relname, cols, cols, r.relname, sample));
        -- 42501 = refused by row level security; 44000 = refused by a view's own rule (WITH CHECK OPTION)
        perform test.is(res, case when r.relkind = 'v' then 'error:44000' else 'error:42501' end, format('%s cannot insert into company B in %s', who, r.relname));
      end if;
      checks := checks + 1;
    end loop;

    -- platform tables and functions
    res := test.as(who, format('select 1 from public.tenants where id = %L', b_id));
    perform test.ok(test.blocked(res), format('%s cannot read the company B record (%s)', who, res));
    res := test.as(who, format($q$update public.tenants set name = 'Taken over' where id = %L$q$, b_id));
    perform test.ok(test.blocked(res), format('%s cannot update the company B record (%s)', who, res));
    res := test.as(who, format('select 1 from public.my_workspaces() where tenant_id = %L', b_id));
    perform test.is(res, 'rows:0', format('%s does not get company B from my_workspaces', who));
    res := test.as(who, format('select public.get_worker_tax_id(%L)', test.id('b.w1')));
    perform test.is(res, 'error:42501', format('%s cannot read a company B tax ID', who));
    res := test.as(who, format('select public.set_worker_tax_id(%L, %L)', test.id('b.w1'), '111-22-3333'));
    perform test.is(res, 'error:42501', format('%s cannot set a company B tax ID', who));
    res := test.as(who, format('select * from public.export_1099_data(%L, 2026)', b_id));
    perform test.is(res, 'error:42501', format('%s cannot run the company B 1099 export', who));
    res := test.as(who, format('select public.worker_set_task_done(%L, true)', test.id('b.t_w1')));
    perform test.is(res, 'error:42501', format('%s cannot complete a company B task', who));
    res := test.as(who, format('select public.revoke_consent(%L, %L)', test.id('b.consent_esign'), 'no reason'));
    perform test.is(res, 'error:42501', format('%s cannot revoke a company B consent', who));
    res := test.as(who, format($q$select 1 from storage.objects where bucket_id = 'worker-documents' and name like %L$q$, b_id || '/%'));
    perform test.is(res, 'rows:0', format('%s sees no company B worker document', who));
    res := test.as(who, format($q$insert into storage.objects (bucket_id, name) values ('worker-documents', %L)$q$, b_id || '/' || test.id('b.w1') || '/planted.pdf'));
    perform test.is(res, 'error:42501', format('%s cannot upload into the company B folder', who));
  end loop;
  perform test.ok(checks = 7 * 24, format('isolation loop covered 19 tables and 5 views for 7 people (%s passes)', checks));
end $$;

-- Controls: the very same statements DO return rows for the people who are entitled to them, so the zeros above
-- are the rules at work and not empty tables or broken statements.
do $$
declare r record; res text;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname not like 'my\_%' order by 1
  loop
    res := test.as('b_owner', format('select 1 from public.%I where tenant_id = %L', r.relname, test.id('b')));
    perform test.ok(res like 'rows:%' and res <> 'rows:0', format('control: the owner of B does read company B rows in %s (%s)', r.relname, res));
    res := test.as('a_owner', format('select 1 from public.%I where tenant_id = %L', r.relname, test.id('a')));
    perform test.ok(res like 'rows:%' and res <> 'rows:0', format('control: the owner of A does read company A rows in %s (%s)', r.relname, res));
  end loop;
  res := test.as('b_w1', format('select 1 from public.my_jobs where tenant_id = %L', test.id('b')));
  perform test.is(res, 'rows:1', 'control: a worker of B does read their job in my_jobs');
  res := test.as('b_w1', format('select 1 from public.my_worker_profile where tenant_id = %L', test.id('b')));
  perform test.is(res, 'rows:1', 'control: a worker of B does read their profile in my_worker_profile');
end $$;

-- Control: the harness does notice a leak. Inside a transaction that is rolled back, one table gets a careless
-- "everyone can read" policy, and the same read that returned nothing above now returns company B rows.
begin;
create policy zz_leak on public.clients for select to authenticated using (true);
select test.as('a_staff', format('select 1 from public.clients where tenant_id = %L', test.id('b'))) as leak_result \gset
rollback;
select test.is(:'leak_result', 'rows:1', 'control: with a deliberately careless policy the same read leaks, and the test sees it') \g /dev/null
select test.is(test.as('a_staff', format('select 1 from public.clients where tenant_id = %L', test.id('b'))), 'rows:0', 'control: after the rollback the leak is gone') \g /dev/null

-- Nothing in B changed, and no table gained or lost a row, after all of the above.
select test.take_snapshot() \g /dev/null
select test.ok(
  not exists (select 1 from test.snapshot s join test.snapshot_before b using (relname)
              where (s.total, s.b_rows, s.b_sum) is distinct from (b.total, b.b_rows, b.b_sum)),
  'company B data is byte for byte unchanged after every cross-company attempt') \g /dev/null
select test.ok(
  (select name from public.tenants where id = test.id('b')) = 'Sample Company B',
  'the company B record is unchanged') \g /dev/null

-- Even a caller that bypasses row level security cannot move a row to another company.
select test.is(test.as('service', format('update public.clients set tenant_id = %L where id = %L', test.id('b'), test.id('a.c1'))), 'error:42501',
  'tenant_id is immutable, even for the service role') \g /dev/null

-- =====================================================================================================================
-- 4. Cross-company links are rejected by the database itself (foreign keys), even with row level security bypassed
-- =====================================================================================================================
select test.begin_section('4. cross-tenant foreign keys') \g /dev/null

do $$
declare
  k record;
  target uuid;
  row_id uuid;
  res text;
  sample jsonb;
  cols text;
  n int := 0;
begin
  for k in
    select c.conname, src.relname as src, dst.relname as dst,
           (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname <> 'tenant_id') as col
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid join pg_namespace n on n.oid = src.relnamespace
    join pg_class dst on dst.oid = c.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and dn.nspname = 'public' and dst.relname not in ('tenants', 'industries')
    order by src.relname, c.conname
  loop
    execute format('select id from public.%I where tenant_id = $1 limit 1', k.dst) into target using test.id('b');
    execute format('select id from public.%I where tenant_id = $1 and %I is not null limit 1', k.src, k.col) into row_id using test.id('a');
    perform test.ok(target is not null and row_id is not null, format('sample rows exist to test %s.%s -> %s', k.src, k.col, k.dst));
    if k.src = 'consent_records' then
      -- consent records cannot be updated at all, so the attempt is a new record that points at company B
      execute format('select to_jsonb(t) from public.consent_records t where id = $1') into sample using row_id;
      sample := jsonb_set(jsonb_set(sample, '{id}', to_jsonb(gen_random_uuid())), array[k.col], to_jsonb(target));
      select string_agg(quote_ident(a.attname), ', ') into cols from pg_attribute a
        where a.attrelid = 'public.consent_records'::regclass and a.attnum > 0 and not a.attisdropped;
      res := test.as('service', format('insert into public.consent_records (%s) select %s from jsonb_populate_record(null::public.consent_records, %L::jsonb)', cols, cols, sample));
    else
      res := test.as('service', format('update public.%I set %I = %L where id = %L', k.src, k.col, target, row_id));
    end if;
    perform test.is(res, 'error:23503', format('%s.%s cannot point at a company B %s row', k.src, k.col, k.dst));
    n := n + 1;
  end loop;
  perform test.ok(n >= 30, format('%s foreign keys between tenant tables were attacked', n));
end $$;

-- =====================================================================================================================
-- 5. The role matrix (src/domain/permissions.ts) inside company A
-- =====================================================================================================================
select test.begin_section('5. role matrix') \g /dev/null

-- ---- owner: everything
select test.is(test.as('a_owner', 'select 1 from public.client_payments'), 'rows:1', 'owner reads client payments') \g /dev/null
select test.is(test.as('a_owner', 'select 1 from public.jobs where price > 0'), 'rows:2', 'owner reads jobs with prices') \g /dev/null
select test.is(test.as('a_owner', $q$update public.tenants set settings = '{"x":1}' where id = '$q$ || test.id('a') || $q$'$q$), 'rows:1', 'owner changes company settings') \g /dev/null
select test.is(test.as('a_owner', $q$update public.tenants set plan_id = 'elite' where id = '$q$ || test.id('a') || $q$'$q$), 'error:42501', 'owner cannot change the plan (VYNTEX does, through the server)') \g /dev/null
select test.is(test.as('a_owner', $q$update public.tenants set slug = 'other-name' where id = '$q$ || test.id('a') || $q$'$q$), 'error:42501', 'owner cannot change the company address') \g /dev/null
select test.is(test.as('a_owner', $q$update public.tenants set status = 'active' where id = '$q$ || test.id('a') || $q$'$q$), 'error:42501', 'owner cannot change the company status') \g /dev/null
select test.is(test.as('a_owner', format($q$insert into public.tenants (slug, name, industry_id, plan_id) values ('self-made', 'Self made', 'build', 'builder')$q$)), 'error:42501', 'nobody creates a company from the browser') \g /dev/null
select test.is(test.as('a_owner', format($q$update public.tenant_members set role = 'manager' where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_staff'))), 'rows:1', 'owner changes a member role') \g /dev/null
select test.is(test.as('a_owner', format($q$update public.tenant_members set role = 'staff' where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_staff'))), 'rows:1', 'owner changes it back') \g /dev/null
select test.is(test.as('a_owner', 'select 1 from public.audit_log'), 'rows:' || (select count(*) from public.audit_log where tenant_id = test.id('a')), 'owner reads the whole audit log of the company') \g /dev/null
select test.is(test.as('a_owner', format($q$update public.tenant_members set role = 'manager' where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_owner'))), 'error:23514', 'the last owner cannot demote themselves') \g /dev/null
select test.is(test.as('a_owner', format($q$delete from public.tenant_members where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_owner'))), 'error:23514', 'the last owner cannot remove themselves') \g /dev/null

-- ---- manager: everything except settings and membership
select test.is(test.as('a_manager', 'select 1 from public.client_payments'), 'rows:1', 'manager reads client payments') \g /dev/null
select test.is(test.as('a_manager', 'select 1 from public.job_expenses'), 'rows:1', 'manager reads expenses') \g /dev/null
select test.is(test.as('a_manager', 'select 1 from public.worker_payments'), 'rows:4', 'manager reads worker payments') \g /dev/null
select test.is(test.as('a_manager', 'select id, name, rate from public.workers'), 'rows:2', 'manager reads workers with pay rates') \g /dev/null
select test.is(test.as('a_manager', format($q$insert into public.client_payments (tenant_id, job_id, method, amount) values (%L, %L, 'cash', 100)$q$, test.id('a'), test.id('a.j1'))), 'rows:1', 'manager records a client payment') \g /dev/null
select test.is(test.as('a_manager', format($q$update public.jobs set price = 10500 where id = %L$q$, test.id('a.j1'))), 'rows:1', 'manager changes a job price') \g /dev/null
select test.is(test.as('a_manager', $q$update public.tenants set name = 'Renamed' where id = '$q$ || test.id('a') || $q$'$q$), 'rows:0', 'manager cannot change company settings') \g /dev/null
select test.is(test.as('a_manager', format($q$update public.tenant_members set role = 'owner' where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_manager'))), 'rows:0', 'manager cannot promote themselves') \g /dev/null
select test.is(test.as('a_manager', format($q$update public.tenant_members set status = 'disabled' where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_staff'))), 'rows:0', 'manager cannot disable a member') \g /dev/null
select test.is(test.as('a_manager', format($q$insert into public.tenant_members (tenant_id, user_id, role, name) values (%L, %L, 'owner', 'Planted')$q$, test.id('a'), test.id('nobody'))), 'error:42501', 'manager cannot add a member') \g /dev/null
select test.is(test.as('a_manager', format($q$delete from public.tenant_members where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_staff'))), 'rows:0', 'manager cannot remove a member') \g /dev/null
select test.is(test.as('a_manager', 'select 1 from public.audit_log'), 'rows:0', 'manager cannot read the audit log') \g /dev/null
select test.is(test.as('a_manager', 'select 1 from public.automation_settings'), 'rows:1', 'manager reads automation settings') \g /dev/null
select test.is((select role || '/' || status from public.tenant_members where tenant_id = test.id('a') and user_id = test.id('a_manager')), 'manager/active', 'the manager is still a manager') \g /dev/null

-- ---- staff: no money, no team, no reports data, no automations, no compliance, no deleting
select test.is(test.as('a_staff', 'select 1 from public.client_payments'), 'rows:0', 'staff cannot read client payments') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.job_expenses'), 'rows:0', 'staff cannot read expenses') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.worker_payments'), 'rows:0', 'staff cannot read worker payments') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.jobs'), 'rows:0', 'staff cannot read the jobs table (it has the price)') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.job_assignments'), 'rows:0', 'staff cannot read assignment amounts') \g /dev/null
select test.is(test.as('a_staff', 'select id, name, rate from public.workers'), 'rows:0', 'staff cannot read workers with pay rates') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.automation_settings'), 'rows:0', 'staff cannot read automation settings') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.automation_runs'), 'rows:0', 'staff cannot read the automation log') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.consent_records'), 'rows:0', 'staff cannot read consent records') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.audit_log'), 'rows:0', 'staff cannot read the audit log') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.activity where money'), 'rows:0', 'staff cannot read history entries that carry amounts') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.activity'), 'rows:1', 'staff reads the other history entries') \g /dev/null
select test.is(test.as('a_owner', 'select 1 from public.activity where money'), 'rows:1', 'owner reads history entries that carry amounts') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.client_payments (tenant_id, job_id, method, amount) values (%L, %L, 'cash', 1)$q$, test.id('a'), test.id('a.j1'))), 'error:42501', 'staff cannot record a client payment') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.worker_payments (tenant_id, worker_id, method, amount) values (%L, %L, 'cash', 1)$q$, test.id('a'), test.id('a.w1'))), 'error:42501', 'staff cannot record a worker payment') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.job_expenses (tenant_id, job_id, amount) values (%L, %L, 1)$q$, test.id('a'), test.id('a.j1'))), 'error:42501', 'staff cannot record an expense') \g /dev/null
select test.is(test.as('a_staff', format($q$select * from public.export_1099_data(%L, 2026)$q$, test.id('a'))), 'error:42501', 'staff cannot run the 1099 export') \g /dev/null
select test.is(test.as('a_staff', $q$update public.tenants set name = 'Renamed' where id = '$q$ || test.id('a') || $q$'$q$), 'rows:0', 'staff cannot change company settings') \g /dev/null
select test.is(test.as('a_staff', format($q$update public.tenant_members set role = 'owner' where tenant_id = %L and user_id = %L$q$, test.id('a'), test.id('a_staff'))), 'rows:0', 'staff cannot promote themselves') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.tenant_members (tenant_id, user_id, role, name) values (%L, %L, 'owner', 'Planted')$q$, test.id('a'), test.id('nobody'))), 'error:42501', 'staff cannot add a member') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.clients'), 'rows:1', 'staff reads clients') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.leads'), 'rows:1', 'staff reads leads') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.tasks'), 'rows:3', 'staff reads tasks') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.documents'), 'rows:1', 'staff reads documents') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.jobs_basic'), 'rows:2', 'staff reads jobs through the view without prices') \g /dev/null
select test.is(test.as('a_staff', 'select price from public.jobs_basic'), 'error:42703', 'the staff view of jobs has no price column') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.job_assignments_basic'), 'rows:2', 'staff sees who is assigned, without amounts') \g /dev/null
select test.is(test.as('a_staff', 'select 1 from public.worker_directory'), 'rows:2', 'staff reads the worker directory') \g /dev/null
select test.is(test.as('a_staff', format($q$update public.jobs_basic set status = 'hold' where id = %L$q$, test.id('a.j2'))), 'rows:1', 'staff changes a job status through the view') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.jobs_basic (tenant_id, number, name, client_id, type) values (%L, 'A-J-2000', 'Staff made', %L, 'service')$q$, test.id('a'), test.id('a.c1'))), 'rows:1', 'staff creates a job through the view') \g /dev/null
select test.is((select price::text from public.jobs where number = 'A-J-2000'), '0.00', 'a job created by staff starts with price 0') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.jobs_basic (tenant_id, number, name, client_id, type) values (%L, 'B-J-2000', 'Planted', %L, 'service')$q$, test.id('b'), test.id('b.c1'))), 'error:44000', 'staff cannot create a job in company B through the view') \g /dev/null
select test.is(test.as('a_staff', format($q$delete from public.jobs_basic where id = %L$q$, test.id('a.j2'))), 'error:42501', 'staff cannot delete a job') \g /dev/null
select test.is(test.as('a_staff', format($q$delete from public.clients where id = %L$q$, test.id('a.c1'))), 'rows:0', 'staff cannot delete a client') \g /dev/null
select test.is(test.as('a_staff', format($q$delete from public.leads where id = %L$q$, test.id('a.l1'))), 'rows:0', 'staff cannot delete a lead') \g /dev/null
select test.is(test.as('a_staff', format($q$delete from public.tasks where id = %L$q$, test.id('a.t_office'))), 'rows:0', 'staff cannot delete a task') \g /dev/null
select test.is(test.as('a_staff', format($q$update public.clients set phone = '555-0199' where id = %L$q$, test.id('a.c1'))), 'rows:1', 'staff edits a client') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.notes (tenant_id, parent_type, client_id, text, by_member_id) values (%L, 'client', %L, 'Staff note', %L)$q$, test.id('a'), test.id('a.c1'), test.id('a.m_staff'))), 'rows:1', 'staff adds a note as themselves') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.notes (tenant_id, parent_type, client_id, text, by_member_id) values (%L, 'client', %L, 'Forged note', %L)$q$, test.id('a'), test.id('a.c1'), test.id('a.m_owner'))), 'error:42501', 'staff cannot add a note in the owner''s name') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.activity (tenant_id, kind, ref_type, ref_id, by_kind, by_id) values (%L, 'client.updated', 'client', %L, 'member', %L)$q$, test.id('a'), test.id('a.c1'), test.id('a.m_owner'))), 'rows:1', 'staff writes a history entry') \g /dev/null
select test.is((select by_id::text from public.activity where kind = 'client.updated' and tenant_id = test.id('a')), test.id('a.m_staff')::text, 'the history entry is stamped with the real author, not the name that was sent') \g /dev/null
select test.is(test.as('a_staff', format($q$update public.documents set status = 'sent', edits = '{"s1":"Edited"}' where id = %L$q$, test.id('a.d1'))), 'rows:1', 'staff edits a document') \g /dev/null
select test.is(test.as('a_owner', format($q$update public.documents set esign_status = 'signed', esign_signer_name = 'C', esign_signer_email = 'c@example.com', esign_sent_at = now(), esign_signed_at = now(), esign_consent = true, esign_consent_text = 'I agree', esign_typed_name = 'C' where id = %L$q$, test.id('a.d1'))), 'error:42501', 'nobody in the office, not even the owner, can write signature evidence') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.messages (tenant_id, channel, recipient, subject, status) values (%L, 'email', 'c@example.com', 'Hello', 'draft')$q$, test.id('a'))), 'rows:1', 'staff prepares a message') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.messages (tenant_id, channel, recipient, subject, status) values (%L, 'email', 'c@example.com', 'Hello', 'sent')$q$, test.id('a'))), 'error:42501', 'staff cannot record a message as sent') \g /dev/null
select test.is(test.as('a_owner', format($q$update public.messages set status = 'sent' where tenant_id = %L$q$, test.id('a'))), 'error:42501', 'the owner cannot mark messages as sent either: only the server does') \g /dev/null
select test.is(test.as('a_staff', $q$update public.activity set kind = 'rewritten'$q$), 'error:42501', 'history cannot be edited') \g /dev/null
select test.is(test.as('service', $q$delete from public.activity$q$), 'error:42501', 'history cannot be deleted, even by the service role') \g /dev/null

-- ---- a person who is staff in A and owner of C gets only staff rights in A
select test.is(test.as('c_owner', format('select 1 from public.client_payments where tenant_id = %L', test.id('a'))), 'rows:0', 'owner of another company, staff here: no client payments of A') \g /dev/null
select test.is(test.as('c_owner', format('select 1 from public.client_payments where tenant_id = %L', test.id('c'))), 'rows:1', 'the same person reads payments of the company they own') \g /dev/null
select test.is(test.as('c_owner', 'select 1 from public.my_workspaces()'), 'rows:2', 'the same person lists both of their companies') \g /dev/null

-- ---- disabled member and a person with no company: nothing
select test.is(test.as('a_disabled', 'select 1 from public.clients'), 'rows:0', 'a disabled member reads nothing') \g /dev/null
select test.is(test.as('a_disabled', 'select 1 from public.my_workspaces()'), 'rows:0', 'a disabled member has no workspace') \g /dev/null
select test.is(test.as('nobody', 'select 1 from public.clients'), 'rows:0', 'a signed-in person without a company reads nothing') \g /dev/null
select test.is(test.as('nobody', 'select 1 from public.industries'), 'rows:8', 'reference data (the eight industries) is readable when signed in') \g /dev/null
select test.is(test.as('a_owner', $q$update public.industries set product_name = 'X'$q$), 'error:42501', 'reference data cannot be changed from the app') \g /dev/null

-- ---- a closed company locks everyone out
update public.tenants set status = 'closed' where id = test.id('c');
select test.is(test.as('c_owner', format('select 1 from public.clients where tenant_id = %L', test.id('c'))), 'rows:0', 'a closed company is locked for its own owner') \g /dev/null
update public.tenants set status = 'active' where id = test.id('c');

-- ---- worker: only their own rows, no prices
select test.is(test.as('a_w1', 'select 1 from public.job_assignments'), 'rows:1', 'worker sees only their own assignment') \g /dev/null
select test.is(test.value('a_w1', 'select worker_id::text from public.job_assignments'), test.id('a.w1')::text, 'and it is theirs') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.tasks'), 'rows:1', 'worker sees only their own task') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.worker_payments'), 'rows:3', 'worker sees only payments made to them') \g /dev/null
select test.is(test.as('a_w1', format('select 1 from public.worker_payments where worker_id <> %L', test.id('a.w1'))), 'rows:0', 'worker sees no payment made to another worker') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.my_worker_profile'), 'rows:1', 'worker sees their own profile') \g /dev/null
select test.is(test.value('a_w1', 'select id::text from public.my_worker_profile'), test.id('a.w1')::text, 'and only their own') \g /dev/null
select test.is(test.as('a_w1', 'select rate from public.my_worker_profile'), 'error:42703', 'the worker profile has no pay rate column') \g /dev/null
select test.is(test.as('a_w1', 'select id, name from public.workers'), 'rows:0', 'worker cannot read the workers table') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.worker_directory'), 'rows:0', 'worker cannot read the worker directory') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.my_jobs'), 'rows:1', 'worker sees the one job they are assigned to') \g /dev/null
select test.is(test.value('a_w1', 'select id::text from public.my_jobs'), test.id('a.j1')::text, 'and it is the right job') \g /dev/null
select test.is(test.as('a_w1', 'select price from public.my_jobs'), 'error:42703', 'the worker view of jobs has no price column') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.jobs'), 'rows:0', 'worker cannot read the jobs table (job price)') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.jobs_basic'), 'rows:0', 'worker cannot read the office view of jobs') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.client_payments'), 'rows:0', 'worker cannot read client payments') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.job_expenses'), 'rows:0', 'worker cannot read expenses') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.clients'), 'rows:0', 'worker cannot read clients') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.leads'), 'rows:0', 'worker cannot read leads') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.documents'), 'rows:0', 'worker cannot read documents') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.notes'), 'rows:0', 'worker cannot read notes') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.messages'), 'rows:0', 'worker cannot read messages') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.activity'), 'rows:0', 'worker cannot read history') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.tenants'), 'rows:0', 'worker cannot read the company record (settings, plan)') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.tenant_members'), 'rows:1', 'worker sees only their own membership') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.my_workspaces()'), 'rows:1', 'worker gets their company from my_workspaces') \g /dev/null
select test.is(test.value('a_w1', 'select role from public.my_workspaces()'), 'worker', 'with the worker role') \g /dev/null
select test.is(test.as('a_w1', format($q$insert into public.work_logs (tenant_id, job_id, worker_id, text) values (%L, %L, %L, 'Finished framing')$q$, test.id('a'), test.id('a.j1'), test.id('a.w1'))), 'rows:1', 'worker adds a work log for a job they are assigned to') \g /dev/null
select test.is(test.as('a_w1', format($q$insert into public.work_logs (tenant_id, job_id, worker_id, text) values (%L, %L, %L, 'Not my job')$q$, test.id('a'), test.id('a.j2'), test.id('a.w1'))), 'error:42501', 'worker cannot add a work log for a job they are not assigned to') \g /dev/null
select test.is(test.as('a_w1', format($q$insert into public.work_logs (tenant_id, job_id, worker_id, text) values (%L, %L, %L, 'As someone else')$q$, test.id('a'), test.id('a.j2'), test.id('a.w2'))), 'error:42501', 'worker cannot add a work log in another worker''s name') \g /dev/null
select test.is(test.as('a_w1', 'select 1 from public.work_logs'), 'rows:2', 'worker reads their own work logs') \g /dev/null
select test.is(test.as('a_w1', $q$update public.work_logs set text = 'edited'$q$), 'rows:0', 'worker cannot edit work logs') \g /dev/null
select test.is(test.as('a_w1', format($q$update public.tasks set title = 'Renamed' where id = %L$q$, test.id('a.t_w1'))), 'rows:0', 'worker cannot edit their task directly') \g /dev/null
select test.is(test.as('a_w1', format('select public.worker_set_task_done(%L, true)', test.id('a.t_w1'))), 'rows:1', 'worker marks their own task done') \g /dev/null
select test.is((select status || '/' || (done_at = current_date)::text from public.tasks where id = test.id('a.t_w1')), 'done/true', 'the task is done, dated today') \g /dev/null
select test.is((select title from public.tasks where id = test.id('a.t_w1')), 'Bring the ladder', 'and nothing else about it changed') \g /dev/null
select test.is(test.as('a_w1', format('select public.worker_set_task_done(%L, true)', test.id('a.t_w2'))), 'error:42501', 'worker cannot complete another worker''s task') \g /dev/null
select test.is(test.as('a_w1', format('select public.worker_set_task_done(%L, true)', test.id('a.t_office'))), 'error:42501', 'worker cannot complete an office task') \g /dev/null
select test.is(test.as('a_w1', format($q$update public.job_assignments set price = 99999 where id = %L$q$, test.id('a.as1'))), 'rows:0', 'worker cannot change their agreed amount') \g /dev/null
select test.is(test.as('a_w1', format($q$insert into public.worker_payments (tenant_id, worker_id, method, amount) values (%L, %L, 'cash', 500)$q$, test.id('a'), test.id('a.w1'))), 'error:42501', 'worker cannot record a payment to themselves') \g /dev/null
select test.is(test.as('a_w1', format($q$update public.tenant_members set role = 'owner', worker_id = null where user_id = %L$q$, test.id('a_w1'))), 'rows:0', 'worker cannot promote themselves') \g /dev/null

-- ---- worker documents in storage (stand-in tables, real policies)
select test.is(test.as('a_w1', $q$select 1 from storage.objects where bucket_id = 'worker-documents'$q$), 'rows:1', 'worker sees only the files in their own folder') \g /dev/null
select test.is(test.as('a_w1', format($q$insert into storage.objects (bucket_id, name) values ('worker-documents', %L)$q$, test.id('a') || '/' || test.id('a.w1') || '/coi.pdf')), 'rows:1', 'worker uploads into their own folder') \g /dev/null
select test.is(test.as('a_w1', format($q$insert into storage.objects (bucket_id, name) values ('worker-documents', %L)$q$, test.id('a') || '/' || test.id('a.w2') || '/coi.pdf')), 'error:42501', 'worker cannot upload into another worker''s folder') \g /dev/null
select test.is(test.as('a_w1', $q$delete from storage.objects where bucket_id = 'worker-documents'$q$), 'rows:0', 'worker cannot delete files') \g /dev/null
select test.is(test.as('a_manager', $q$select 1 from storage.objects where bucket_id = 'worker-documents'$q$), 'rows:3', 'manager sees all worker files of the company') \g /dev/null
select test.is(test.as('a_staff', $q$select 1 from storage.objects where bucket_id = 'worker-documents'$q$), 'rows:0', 'staff sees no worker files') \g /dev/null
select test.is(test.as('a_owner', format($q$insert into storage.objects (bucket_id, name) values ('worker-documents', %L)$q$, 'not-a-company/file.pdf')), 'error:42501', 'a path that does not start with a company id is refused') \g /dev/null
select test.is((select public::text from storage.buckets where id = 'worker-documents'), 'false', 'the worker documents bucket is private') \g /dev/null

-- =====================================================================================================================
-- 6. Audit log: it records, with the actor, and it cannot be altered
-- =====================================================================================================================
select test.begin_section('6. audit log') \g /dev/null

select test.ok(exists (
    select 1 from public.audit_log
    where tenant_id = test.id('a') and table_name = 'client_payments' and action = 'insert'
      and actor = test.id('a_manager') and actor_role = 'manager' and (new_data ->> 'amount')::numeric = 100),
  'the manager''s payment was recorded with who, what and their role') \g /dev/null
select test.ok(exists (
    select 1 from public.audit_log
    where tenant_id = test.id('a') and table_name = 'jobs' and action = 'update' and actor = test.id('a_manager')
      and old_data = '{"price": 10000.00}' and new_data = '{"price": 10500.00}'),
  'the price change was recorded with the old and new value only') \g /dev/null
select test.ok(exists (
    select 1 from public.audit_log
    where tenant_id = test.id('a') and table_name = 'tenant_members' and action = 'update' and actor = test.id('a_owner')
      and old_data ->> 'role' = 'staff' and new_data ->> 'role' = 'manager'),
  'the membership change was recorded') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('a') and table_name = 'tenants' and action = 'update' and actor = test.id('a_owner')),
  'the settings change was recorded') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'documents' and action = 'insert')
  and exists (select 1 from public.audit_log where table_name = 'consent_records' and action = 'insert')
  and exists (select 1 from public.audit_log where table_name = 'workers' and action = 'insert')
  and exists (select 1 from public.audit_log where table_name = 'worker_payments' and action = 'insert')
  and exists (select 1 from public.audit_log where table_name = 'job_expenses' and action = 'insert')
  and exists (select 1 from public.audit_log where table_name = 'job_assignments' and action = 'insert'),
  'documents, consent, workers, worker payments, expenses and assignments are all audited') \g /dev/null
select test.ok(not exists (
    select 1 from public.audit_log
    where (table_name in ('workers', 'tenant_members') and (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ~ '555-01|@example\.com')
       or (table_name in ('client_payments', 'worker_payments') and coalesce(new_data ->> 'ref', '[redacted]') not in ('[redacted]', ''))
       or (table_name = 'consent_records' and new_data ->> 'subject_email' <> '[redacted]')),
  'contact details and payment references are redacted in the audit log') \g /dev/null

-- an update that changes nothing writes nothing
select count(*) as audit_before from public.audit_log \gset
select test.is(test.as('a_manager', format($q$update public.jobs set price = price where id = %L$q$, test.id('a.j1'))), 'rows:1', 'a no-op update runs') \g /dev/null
select test.is((select count(*)::text from public.audit_log), :'audit_before', 'and writes no audit entry') \g /dev/null

-- the request address is stored only as a keyed hash
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', false) \g /dev/null
select test.is(test.as('a_manager', format($q$insert into public.job_expenses (tenant_id, job_id, vendor, amount) values (%L, %L, 'Hash test', 5)$q$, test.id('a'), test.id('a.j1'))), 'rows:1', 'an expense is recorded from a request with an address') \g /dev/null
select set_config('request.headers', '', false) \g /dev/null
select test.ok((select ip_hash ~ '^[0-9a-f]{64}$' and ip_hash not like '%203.0.113.7%' from public.audit_log where new_data ->> 'vendor' = 'Hash test'),
  'the audit entry carries a 64 character keyed hash, not the address') \g /dev/null

-- nobody can alter it
select test.is(test.as('a_owner', $q$update public.audit_log set action = 'x'$q$), 'error:42501', 'owner cannot edit the audit log') \g /dev/null
select test.is(test.as('a_owner', $q$delete from public.audit_log$q$), 'error:42501', 'owner cannot delete from the audit log') \g /dev/null
select test.is(test.as('a_owner', format($q$insert into public.audit_log (tenant_id, actor_role, action, table_name) values (%L, 'owner', 'forged', 'x')$q$, test.id('a'))), 'error:42501', 'owner cannot write a forged audit entry') \g /dev/null
select test.is(test.as('service', $q$update public.audit_log set action = 'x'$q$), 'error:42501', 'the service role cannot edit the audit log') \g /dev/null
select test.is(test.as('service', $q$delete from public.audit_log$q$), 'error:42501', 'the service role cannot delete from the audit log') \g /dev/null
select test.is(test.as('service', $q$truncate public.audit_log$q$), 'error:42501', 'the service role cannot empty the audit log') \g /dev/null
select test.is(test.try($q$update public.audit_log set action = 'x'$q$), 'error:42501', 'even the database superuser is stopped by the append-only trigger (update)') \g /dev/null
select test.is(test.try($q$delete from public.audit_log$q$), 'error:42501', 'even the database superuser is stopped by the append-only trigger (delete)') \g /dev/null
select test.is(test.try($q$truncate public.audit_log$q$), 'error:42501', 'even the database superuser is stopped by the append-only trigger (truncate)') \g /dev/null
select test.is((select count(*)::text from public.audit_log), (:audit_before + 1)::text, 'the audit log holds exactly what it held, plus the one new entry') \g /dev/null

-- =====================================================================================================================
-- 7. Sensitive personal data: stored encrypted, readable only by owner and manager, every read audited
-- =====================================================================================================================
select test.begin_section('7. PII encryption') \g /dev/null

select test.is(test.as('a_owner', format('select public.set_worker_tax_id(%L, %L)', test.id('a.w1'), '123-45-6789')), 'rows:1', 'owner stores a worker tax ID') \g /dev/null
select test.ok((select tax_id_enc is not null and octet_length(tax_id_enc) > 40 from public.workers where id = test.id('a.w1')), 'the column holds an encrypted value') \g /dev/null
select test.ok((select position('123456789'::bytea in tax_id_enc) = 0 and position('123-45-6789'::bytea in tax_id_enc) = 0
                   and encode(tax_id_enc, 'escape') not like '%123456789%' from public.workers where id = test.id('a.w1')),
  'the stored bytes do not contain the tax ID') \g /dev/null
select test.ok(not exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not a.attisdropped and a.attnum > 0
      and a.attname ~ '(tax_id|ssn|ein|itin)' and a.attname not in ('tax_id_enc', 'has_tax_id')),
  'there is no plaintext tax ID column anywhere') \g /dev/null
select test.ok(not exists (select 1 from public.audit_log where (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ~ '123456789|123-45-6789|\\\\x'),
  'the audit log holds neither the tax ID nor its ciphertext') \g /dev/null
select test.is(test.value('a_owner', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), '123456789', 'owner reads it back: the value round-trips') \g /dev/null
select test.is(test.value('a_manager', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), '123456789', 'manager reads it back') \g /dev/null
select test.is(test.as('a_staff', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), 'error:42501', 'staff cannot read a tax ID') \g /dev/null
select test.is(test.as('a_w1', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), 'error:42501', 'a worker cannot read a tax ID, not even their own') \g /dev/null
select test.is(test.as('a_w2', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), 'error:42501', 'a worker cannot read another worker''s tax ID') \g /dev/null
select test.is(test.as('a_staff', format('select public.set_worker_tax_id(%L, %L)', test.id('a.w1'), '999-99-9999')), 'error:42501', 'staff cannot overwrite a tax ID') \g /dev/null
select test.is(test.as('a_w1', format('select public.set_worker_tax_id(%L, %L)', test.id('a.w1'), '999-99-9999')), 'error:42501', 'a worker cannot overwrite a tax ID') \g /dev/null
select test.is(test.as('a_owner', 'select tax_id_enc from public.workers'), 'error:42501', 'owner cannot read the encrypted column directly') \g /dev/null
select test.is(test.as('a_owner', 'select * from public.workers'), 'error:42501', 'select * on workers is refused because it would include the encrypted column') \g /dev/null
select test.is(test.as('a_owner', format($q$update public.workers set tax_id_enc = '\x00' where id = %L$q$, test.id('a.w1'))), 'error:42501', 'owner cannot write the encrypted column directly') \g /dev/null
select test.is(test.as('a_owner', $q$select app.decrypt_pii('\x00')$q$), 'error:42501', 'the decrypt function cannot be called from the app') \g /dev/null
select test.is(test.as('a_owner', $q$select app.pii_key()$q$), 'error:42501', 'the key function cannot be called from the app') \g /dev/null
select test.is(test.as('service', $q$select app.secret('pii_encryption_key')$q$), 'error:42501', 'not even the service role can ask for the key') \g /dev/null
select test.is(test.value('a_owner', 'select has_tax_id::text from public.workers where has_tax_id'), 'true', 'the app can still see that a tax ID is on file') \g /dev/null
select test.is(test.value('a_w1', 'select has_tax_id::text from public.my_worker_profile'), 'true', 'and so can the worker, for their own record') \g /dev/null
select test.is(test.as('a_owner', format('select public.set_worker_tax_id(%L, %L)', test.id('a.w2'), '12345')), 'error:22023', 'a tax ID must have 9 digits') \g /dev/null
select test.is((select count(*)::text from public.audit_log where tenant_id = test.id('a') and action = 'pii_read' and row_id = test.id('a.w1')), '2', 'each of the two reads was written to the audit log') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('a') and action = 'pii_write' and row_id = test.id('a.w1') and actor = test.id('a_owner')), 'the write was audited too, without the value') \g /dev/null
select test.ok((select count(*) = 0 from public.audit_log where action in ('pii_read', 'pii_write') and (new_data::text ~ '[0-9]{9}')), 'no audit entry about a tax ID contains digits of it') \g /dev/null

-- two encryptions of the same value differ (random session key), and a wrong key cannot decrypt
select test.is(test.as('a_owner', format('select public.set_worker_tax_id(%L, %L)', test.id('a.w2'), '123456789')), 'rows:1', 'the same tax ID is stored for a second worker') \g /dev/null
select test.ok((select count(distinct tax_id_enc) = 2 from public.workers where tenant_id = test.id('a') and tax_id_enc is not null), 'equal values do not produce equal ciphertexts') \g /dev/null
select set_config('app.settings.pii_encryption_key', 'another-key-another-key-another-key-0000', false) \g /dev/null
select test.ok(test.as('a_owner', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))) like 'error:%', 'with a different key the value cannot be decrypted') \g /dev/null
select set_config('app.settings.pii_encryption_key', '', false) \g /dev/null
select test.is(test.as('a_owner', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), 'error:P0001', 'with no key configured the function refuses instead of failing open') \g /dev/null
select test.is(test.as('a_owner', format('select public.set_worker_tax_id(%L, %L)', test.id('a.w2'), '987654321')), 'error:P0001', 'and nothing can be stored without a key') \g /dev/null

-- The Vault code path, against a stand-in for vault.decrypted_secrets (the setting is empty at this point).
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop');
grant usage on schema vault to postgres;
grant select on vault.decrypted_secrets to postgres;
select test.is(test.value('a_owner', format('select public.get_worker_tax_id(%L)', test.id('a.w1'))), '123456789', 'the key is found in the Vault stand-in when no setting is present') \g /dev/null
select test.is(test.as('a_owner', 'select 1 from vault.decrypted_secrets'), 'error:42501', 'a signed-in person cannot read the Vault stand-in') \g /dev/null
drop schema vault cascade;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null

-- =====================================================================================================================
-- 8. Consent capture and the 1099 export
-- =====================================================================================================================
select test.begin_section('8. consent and 1099') \g /dev/null
select extract(year from current_date)::int as yr \gset

select test.is(test.as('a_owner', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:P0403', 'the 1099 export refuses to run without consent (owner)') \g /dev/null
select test.is(test.as('a_manager', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:P0403', 'the 1099 export refuses to run without consent (manager)') \g /dev/null
select test.is(test.as('service', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:P0403', 'the 1099 export refuses to run without consent (server)') \g /dev/null
select test.ok(not exists (select 1 from public.audit_log where action = 'export_1099'), 'a refused export leaves no export entry') \g /dev/null

-- only the owner can give this consent
select test.is(test.as('a_manager', format($q$insert into public.consent_records (tenant_id, kind, subject_kind, subject_member_id, subject_name, consent_text)
  values (%L, 'share_1099_data', 'member', %L, 'Manager a', 'I authorize sharing subcontractor payment data with Lion Business Services for 1099 preparation.')$q$, test.id('a'), test.id('a.m_manager'))),
  'error:42501', 'a manager cannot give the 1099 consent') \g /dev/null
select test.is(test.as('a_staff', format($q$insert into public.consent_records (tenant_id, kind, subject_kind, subject_member_id, subject_name, consent_text)
  values (%L, 'share_1099_data', 'member', %L, 'Owner a', 'I authorize sharing subcontractor payment data with Lion Business Services for 1099 preparation.')$q$, test.id('a'), test.id('a.m_owner'))),
  'error:42501', 'staff cannot give the 1099 consent in the owner''s name') \g /dev/null
select test.is(test.as('a_owner', format($q$insert into public.consent_records (tenant_id, kind, subject_kind, subject_name, consent_text)
  values (%L, 'share_1099_data', 'external', 'Owner a', 'Too short')$q$, test.id('a'))),
  'error:23514', 'a consent needs the real text that was agreed to') \g /dev/null

-- the owner gives it; the session, not the browser, decides who and when
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.20"}', false) \g /dev/null
select test.is(test.as('a_owner', format($q$insert into public.consent_records (tenant_id, kind, subject_kind, subject_name, consent_text, method, language, granted_at, granted_by, revoked_at, revoke_reason, user_agent)
  values (%L, 'share_1099_data', 'external', 'Owner a', 'I authorize VYNTEX to share my subcontractor payment data with Lion Business Services so they can prepare my 1099 forms.', 'typed_name', 'en',
          '2001-01-01', %L, '2001-01-02', 'pre-revoked', 'test browser')$q$, test.id('a'), test.id('a_staff'))),
  'rows:1', 'the owner records the 1099 consent') \g /dev/null
select set_config('request.headers', '', false) \g /dev/null
select id as consent_id from public.consent_records where tenant_id = test.id('a') and kind = 'share_1099_data' \gset
select test.ok((select granted_by = test.id('a_owner') and granted_at > now() - interval '1 minute' and revoked_at is null
                   and subject_kind = 'member' and subject_member_id = test.id('a.m_owner')
                   and consent_text like 'I authorize VYNTEX%' and source_ip_hash ~ '^[0-9a-f]{64}$' and user_agent = 'test browser'
                from public.consent_records where id = :'consent_id'),
  'it holds who (the signed-in owner), the exact text, when (now, not the date sent) and where from (hashed)') \g /dev/null

-- now the export runs, and the numbers are right
select test.is(test.as('a_owner', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'rows:2', 'with consent the export runs and lists the two paid workers') \g /dev/null
select test.is(test.value('a_manager', format($q$select paid_total || '/' || paid_by_card || '/' || paid_other_methods || '/' || payment_count from public.export_1099_data(%L, %s) where worker_id = %L$q$, test.id('a'), :yr, test.id('a.w1'))),
  '2900.00/400.00/2500.00/2', 'totals for the year: card payments apart, last year left out') \g /dev/null
select test.is(test.value('a_owner', format($q$select coalesce(tax_id, 'NULL') from public.export_1099_data(%L, %s) where worker_id = %L$q$, test.id('a'), :yr, test.id('a.w1'))),
  'NULL', 'tax IDs are left out unless asked for') \g /dev/null
select test.is(test.value('a_owner', format($q$select tax_id from public.export_1099_data(%L, %s, true) where worker_id = %L$q$, test.id('a'), :yr, test.id('a.w1'))),
  '123456789', 'tax IDs are included when asked for') \g /dev/null
select test.is(test.as('service', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'rows:2', 'the server can run the export for the preparer once consent exists') \g /dev/null
select test.is(test.as('a_staff', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:42501', 'staff still cannot run it') \g /dev/null
select test.is(test.as('a_w1', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:42501', 'a worker still cannot run it') \g /dev/null
select test.is(test.as('b_owner', format('select * from public.export_1099_data(%L, %s)', test.id('b'), :yr)), 'error:P0403', 'company A''s consent does nothing for company B') \g /dev/null
select test.is((select count(*)::text from public.audit_log where tenant_id = test.id('a') and action = 'export_1099'), '5', 'every export that ran was written to the audit log') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where action = 'export_1099' and new_data @> '{"include_tax_id": true}' and actor = test.id('a_owner')), 'including the one that returned tax IDs') \g /dev/null

-- consent records are evidence: no edits, no deletes, only a one-time revocation by the owner
select test.is(test.as('a_owner', format($q$update public.consent_records set consent_text = 'Something else entirely, long enough to pass' where id = %L$q$, :'consent_id')), 'error:42501', 'owner cannot edit a consent record') \g /dev/null
select test.is(test.as('a_owner', format($q$delete from public.consent_records where id = %L$q$, :'consent_id')), 'error:42501', 'owner cannot delete a consent record') \g /dev/null
select test.is(test.as('service', format($q$update public.consent_records set consent_text = 'Something else entirely, long enough to pass' where id = %L$q$, :'consent_id')), 'error:42501', 'the server cannot edit a consent record') \g /dev/null
select test.is(test.as('service', format($q$delete from public.consent_records where id = %L$q$, :'consent_id')), 'error:42501', 'the server cannot delete a consent record') \g /dev/null
select test.is(test.as('a_manager', format('select public.revoke_consent(%L, %L)', :'consent_id', 'manager tries')), 'error:42501', 'a manager cannot revoke the 1099 consent') \g /dev/null
select test.is(test.as('a_owner', format('select public.revoke_consent(%L, %L)', :'consent_id', '')), 'error:22023', 'a revocation needs a reason') \g /dev/null
select test.is(test.as('a_owner', format('select public.revoke_consent(%L, %L)', :'consent_id', 'Changed preparer')), 'rows:1', 'the owner revokes the consent') \g /dev/null
select test.ok((select revoked_at is not null and revoked_by = test.id('a_owner') and revoke_reason = 'Changed preparer' from public.consent_records where id = :'consent_id'), 'the revocation is recorded with who, when and why') \g /dev/null
select test.is(test.as('a_owner', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:P0403', 'after revocation the export refuses again') \g /dev/null
select test.is(test.as('a_owner', format('select public.revoke_consent(%L, %L)', :'consent_id', 'again')), 'error:42501', 'a revoked consent cannot be changed again') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'consent_records' and action = 'update' and row_id = :'consent_id' and new_data ? 'revoked_at'), 'the revocation is in the audit log') \g /dev/null

-- a consent limited to one tax year only opens that year
select test.is(test.as('a_owner', format($q$insert into public.consent_records (tenant_id, kind, subject_kind, subject_name, consent_text, tax_year)
  values (%L, 'share_1099_data', 'external', 'Owner a', 'I authorize VYNTEX to share my subcontractor payment data with Lion Business Services for this tax year.', %s)$q$, test.id('a'), :yr - 1)),
  'rows:1', 'the owner records a consent for last year only') \g /dev/null
select test.is(test.as('a_owner', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr - 1)), 'rows:1', 'last year can be exported') \g /dev/null
select test.is(test.as('a_owner', format('select * from public.export_1099_data(%L, %s)', test.id('a'), :yr)), 'error:P0403', 'this year still cannot') \g /dev/null

-- =====================================================================================================================
-- 9. Other guards
-- =====================================================================================================================
select test.begin_section('9. other guards') \g /dev/null

select test.is(test.as('service', $q$insert into public.tenants (slug, name, industry_id, plan_id) values ('demo', 'X', 'build', 'builder')$q$), 'error:23514', 'a reserved word cannot be a company address') \g /dev/null
select test.is(test.as('service', $q$insert into public.tenants (slug, name, industry_id, plan_id) values ('Acme', 'X', 'build', 'builder')$q$), 'error:23514', 'capital letters cannot be in a company address') \g /dev/null
select test.is(test.as('service', $q$insert into public.tenants (slug, name, industry_id, plan_id) values ('a--b', 'X', 'build', 'builder')$q$), 'error:23514', 'double hyphens cannot be in a company address') \g /dev/null
select test.is(test.as('service', $q$insert into public.tenants (slug, name, industry_id, plan_id) values ('acme-builders', 'X', 'build', 'builder')$q$), 'error:23505', 'a company address is unique') \g /dev/null
select test.is(test.as('service', $q$insert into public.tenants (slug, name, industry_id, plan_id) values ('new-company', 'X', 'plumbing', 'builder')$q$), 'error:23503', 'the industry must be one of the reference rows') \g /dev/null
select test.is(test.as('service', format($q$insert into public.client_payments (tenant_id, job_id, method, amount) values (%L, %L, 'cash', -1)$q$, test.id('a'), test.id('a.j1'))), 'error:23514', 'a negative amount is refused') \g /dev/null
select test.is(test.as('service', format($q$insert into public.client_payments (tenant_id, job_id, method, amount) values (%L, %L, 'bitcoin', 1)$q$, test.id('a'), test.id('a.j1'))), 'error:23514', 'an unknown payment method is refused') \g /dev/null
select test.is(test.as('service', format($q$update public.jobs set status = 'archived' where id = %L$q$, test.id('a.j1'))), 'error:23514', 'an unknown job status is refused') \g /dev/null
select test.is(test.as('service', format($q$insert into public.tenant_members (tenant_id, user_id, role, name) values (%L, %L, 'worker', 'No worker row')$q$, test.id('a'), test.id('nobody'))), 'error:23514', 'a worker login must point at a worker record') \g /dev/null
select test.is(test.as('service', format($q$insert into public.documents (tenant_id, kind, number, job_id, client_id, esign_demo) values (%L, 'contract', 'X-1', %L, %L, true)$q$, test.id('a'), test.id('a.j1'), test.id('a.c1'))), 'error:23514', 'a demo signature can never be stored in the production database') \g /dev/null
select test.is(test.as('service', format($q$update public.documents set esign_status = 'signed', esign_signer_name = 'C', esign_signer_email = 'c@example.com', esign_sent_at = now() where id = %L$q$, test.id('a.d1'))), 'error:23514', 'a document cannot be marked signed without the signature evidence') \g /dev/null

select updated_at as before_touch from public.clients where id = test.id('a.c1') \gset
select pg_sleep(0.02) \g /dev/null
select test.is(test.as('a_staff', format($q$update public.clients set company = 'Touched' where id = %L$q$, test.id('a.c1'))), 'rows:1', 'a client is edited') \g /dev/null
select test.ok((select updated_at > :'before_touch'::timestamptz from public.clients where id = test.id('a.c1')), 'updated_at moves forward on its own') \g /dev/null

-- deleting a job keeps the worker payments (they feed the 1099 totals) and records the deletion
select test.is(test.as('a_owner', format('delete from public.jobs where id = %L', test.id('a.j2'))), 'rows:1', 'owner deletes a job') \g /dev/null
select test.ok((select job_id is null and amount = 600 from public.worker_payments where id = test.id('a.wp_w2')), 'the worker payment survives, without the job link') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where table_name = 'jobs' and action = 'delete' and row_id = test.id('a.j2') and actor = test.id('a_owner')), 'the deletion is in the audit log') \g /dev/null

-- =====================================================================================================================
-- Summary
-- =====================================================================================================================
\pset tuples_only off
\pset format aligned
\echo
select section, count(*) as checks_passed from test.results group by section order by section;
select count(*) as total_checks_passed,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r') as tables_in_public,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v') as views_in_public,
       (select count(*) from pg_policies where schemaname = 'public') as policies_in_public
from test.results;
