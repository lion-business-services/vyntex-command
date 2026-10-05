-- Module tests, part 0: helpers and two fresh companies. Run by run_local.sh after gateway.sql, in the same
-- database, before the other files of this folder (they are run in name order).
--   M  a practice edition company      N  a field edition company (build)
-- Both get the sample rows of every module table (the seed functions of the *.seed.sql files), so nothing here
-- depends on what the earlier test files left behind in A, B, C, G or P.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- A signed-in person with a session: the claims the Data API gets from a real token (session id, and "aal2" once the
-- second sign-in step was passed). The protected functions look at both.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function test.session_of(who text) returns uuid language sql immutable as
$$ select md5('session:' || who)::uuid $$;

create or replace function test.login_session(who text, aal text default 'aal2') returns void language plpgsql as $$
begin
  if who in ('anon', 'service') then perform test.login(who); return; end if;
  if test.id(who) is null then raise exception 'unknown test user %', who; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', test.id(who), 'role', 'authenticated', 'aal', aal, 'session_id', test.session_of(who))::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

-- The server confirmed who the person is, just now (what /api/auth/stepup does after checking a code or the password).
create or replace function test.stepup(who text) returns void language plpgsql as $$
begin
  perform public.session_stepup_mark(test.id(who), test.session_of(who), 'totp');
end $$;
-- ... and the check is no longer fresh.
create or replace function test.stepup_stale(who text) returns void language sql as
$$ update app.session_stamps set stepup_at = now() - interval '20 minutes' where session_id = test.session_of(who) $$;

-- Runs a query that returns one JSON value as a person. A refusal comes back as { error: <SQLSTATE>, word: <message> }
-- so a test can check both, and never stops the run.
create or replace function test.j(who text, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform test.login_session(who);
  begin
    execute q into r;
  exception when others then
    r := jsonb_build_object('error', sqlstate, 'word', sqlerrm);
  end;
  perform test.logout();
  return r;
end $$;
-- The same for a statement whose answer does not matter: 'ok', or '<SQLSTATE>:<message>'.
create or replace function test.w(who text, q text) returns text language plpgsql as $$
declare r text := 'ok';
begin
  perform test.login_session(who);
  begin
    execute q;
  exception when others then
    r := sqlstate || ':' || sqlerrm;
  end;
  perform test.logout();
  return r;
end $$;

-- One statement, run as several people: 'who=rows:2 who=blocked who=ok who=error:42501'.
--   blocked  filtered to nothing by row level security, or refused as not permitted
--   ok       ran and touched at least one row
create or replace function test.matrix(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare pair text; who text; want text; res text;
begin
  foreach pair in array regexp_split_to_array(btrim(p_expect), '\s+') loop
    who := split_part(pair, '=', 1); want := substr(pair, length(who) + 2);
    res := test.as(who, p_sql);
    if want = 'blocked' then
      perform test.ok(test.blocked(res), format('%s: %s is blocked (%s)', p_label, who, res));
    elsif want = 'ok' then
      perform test.ok(res like 'rows:%' and res <> 'rows:0', format('%s: %s may (%s)', p_label, who, res));
    else
      perform test.is(res, want, format('%s: %s', p_label, who));
    end if;
  end loop;
end $$;

-- The same as test.j with a session that has NOT passed the second sign-in step.
create or replace function test.j1(who text, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform test.login_session(who, 'aal1');
  begin
    execute q into r;
  exception when others then
    r := jsonb_build_object('error', sqlstate, 'word', sqlerrm);
  end;
  perform test.logout();
  return r;
end $$;
-- A protected function called by a person: the JSON it answers, or { error, word }.
create or replace function test.f(who text, expr text) returns jsonb language sql as $$ select test.j(who, 'select ' || expr) $$;

-- Looks for a pattern in every stored text of the database: every column that can hold text (text, names, JSON,
-- lists of text, bytes) of every table outside the system schemas and this test schema. Returns the columns where
-- it was found, or '' when it is nowhere. Used to prove that a secret value was not written anywhere in clear.
create or replace function test.find_text(p_regex text) returns text language plpgsql as $$
declare r record; n bigint; hits text := '';
begin
  for r in
    select n.nspname, c.relname, a.attname, t.typname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
    where c.relkind in ('r', 'p', 'm') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'test')
      and t.typname in ('text', 'varchar', 'bpchar', 'name', 'citext', 'json', 'jsonb', '_text', '_varchar', 'bytea')
    order by 1, 2, a.attnum
  loop
    execute format('select count(*) from %I.%I where %s ~ %L', r.nspname, r.relname,
      case when r.typname = 'bytea' then format('encode(%I, ''escape'')', r.attname) else format('%I::text', r.attname) end, p_regex) into n;
    if n > 0 then hits := hits || format('%s.%s.%s(%s) ', r.nspname, r.relname, r.attname, n); end if;
  end loop;
  return btrim(hits);
end $$;

-- What a person of a company holds, as the database resolves it. Empty for a worker and for an outsider.
create or replace function test.perms(who text, tenant text) returns text[] language sql as $$
  select coalesce((select app.permissions_for(t.industry_id, t.config, m.role)
                   from public.tenant_members m join public.tenants t on t.id = m.tenant_id
                   where m.tenant_id = test.id(tenant) and m.user_id = test.id(who) and m.status = 'active'), '{}'::text[])
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The two companies, with every module table filled
-- ---------------------------------------------------------------------------------------------------------------------
select test.seed_company('m', 'module-practice', 'practice', 'quoted') \g /dev/null
select test.seed_company('n', 'module-field', 'build', 'builder') \g /dev/null
do $$
declare p text;
begin
  foreach p in array array['m', 'n'] loop
    perform test.seed_access(p); perform test.seed_catalog(p); perform test.seed_appointments(p); perform test.seed_vault(p);
    perform test.seed_documents(p); perform test.seed_cash(p); perform test.seed_rules(p); perform test.seed_sales(p);
    perform test.seed_messaging(p);
  end loop;
end $$;

select test.begin_section('30. module harness') \g /dev/null
select test.ok((select count(*) = 26 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r' and c.relname not in (select relname from test.core_tables)),
  'the module range adds 26 tables to public (25 module tables and the consent switch of 0048)') \g /dev/null
select test.is((select coalesce(string_agg(name, ', ' order by name), '') from (select distinct name from app.ws_collections where kind = 'pending') w), '',
  'every collection is built: no placeholder is left ("connections" is a real, read-only collection since 0048b)') \g /dev/null
select test.ok(not exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app') and c.relkind = 'r' and not a.attisdropped and a.attnum > 0
      and a.attname ~ '(tax_id|ssn|ein|itin)' and a.attname not in ('tax_id_enc', 'has_tax_id', 'tax_id_type', 'tax_id_last4')),
  'no module table has a column that could hold a tax ID in clear') \g /dev/null
