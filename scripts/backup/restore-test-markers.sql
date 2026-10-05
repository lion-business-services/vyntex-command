-- Marker rows for scripts/backup/restore-test.sh. Run as the cluster administrator on the freshly migrated test
-- database, before the backup. Every person and company here is invented for the test and says so.
--
-- Two kinds of rows:
--   * rows in the product's own tables, including one encrypted tax ID, so the test proves that real table shapes,
--     the audit trail written by triggers and an encrypted value all survive a backup and a restore
--   * a table of awkward values (accents, Chinese, emoji, quotes, binary bytes, exact money, time zones), so the test
--     proves the content comes back byte for byte whatever the product's tables look like on the day
\set ON_ERROR_STOP on
set client_min_messages = warning;
-- the local way to supply the encryption key (see supabase/migrations/0005_pii_encryption.sql); a stand-in value
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null

create schema restore_test;
create table restore_test.ids (key text primary key, id uuid not null);

do $markers$
declare
  u_a uuid; u_b uuid; t_a uuid; t_b uuid; w_a uuid; industry text; has_type boolean;
begin
  select id into industry from public.industries order by id limit 1;
  if industry is null then raise exception 'no industry rows: seed.sql was not applied'; end if;

  insert into auth.users (email) values ('restore-owner-a@example.com') returning id into u_a;
  insert into auth.users (email) values ('restore-owner-b@example.com') returning id into u_b;
  insert into public.tenants (slug, name, industry_id, plan_id, status)
    values ('restore-test-a', 'Restore test company A (sample)', industry, 'restore_test', 'active') returning id into t_a;
  insert into public.tenants (slug, name, industry_id, plan_id, status)
    values ('restore-test-b', 'Restore test company B (sample)', industry, 'restore_test', 'active') returning id into t_b;
  insert into public.tenant_members (tenant_id, user_id, role, status, name, email)
    values (t_a, u_a, 'owner', 'active', 'Sample Owner A', 'restore-owner-a@example.com'),
           (t_b, u_b, 'owner', 'active', 'Sample Owner B', 'restore-owner-b@example.com');
  -- The client type column arrived with a later migration and, as written today, refuses an empty value. The marker
  -- rows name a type when the column is there, so this file works before and after that migration.
  has_type := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'client_type');
  execute format($sql$
    insert into public.clients (tenant_id, name, phone, email, addresses%s)
    select $1, 'Sample client A' || g, '(609) 555-' || lpad((100 + g)::text, 4, '0'), 'client-a' || g || '@example.com', array[g || ' Sample Street']%s
    from generate_series(1, 40) g $sql$, case when has_type then ', client_type' else '' end, case when has_type then $$, 'individual'$$ else '' end) using t_a;
  execute format($sql$
    insert into public.clients (tenant_id, name, phone, email, addresses%s)
    select $1, 'Cliente de muestra B' || g || ' Ñandú', '(609) 555-' || lpad((200 + g)::text, 4, '0'), 'client-b' || g || '@example.com', array[g || ' Calle de Muestra']%s
    from generate_series(1, 25) g $sql$, case when has_type then ', client_type' else '' end, case when has_type then $$, 'individual'$$ else '' end) using t_b;
  insert into public.workers (tenant_id, name, trade) values (t_a, 'Sample worker A', 'sample trade') returning id into w_a;

  insert into restore_test.ids values ('user_a', u_a), ('tenant_a', t_a), ('tenant_b', t_b), ('worker_a', w_a);
end
$markers$;

-- Store a tax ID the way the product does: as the signed-in owner, through the audited function. The number is the
-- well-known stand-in, not a real one.
select id as user_a from restore_test.ids where key = 'user_a' \gset
select id as worker_a from restore_test.ids where key = 'worker_a' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'user_a', 'role', 'authenticated')::text, false) \g /dev/null
set role authenticated;
select public.set_worker_tax_id(:'worker_a'::uuid, '123-45-6789') \g /dev/null
reset role;
select set_config('request.jwt.claims', '', false) \g /dev/null

create table restore_test.awkward (
  n        integer primary key,
  label    text not null,
  amount   numeric(12,2) not null,
  payload  bytea not null,
  at       timestamptz not null,
  doc      jsonb not null,
  tags     text[] not null
);
insert into restore_test.awkward
select g,
       (array['plain', 'Ñandú café señor', '簿记客户链接', 'quote '' and "double"', E'tab\tand\nnew line', 'emoji 🦁', 'back\slash', '  spaces  '])[1 + g % 8] || ' ' || g,
       (g * 1234.56 - 100000)::numeric(12,2),
       decode(md5(g::text) || md5((g * 7)::text), 'hex') || E'\\x00ff00'::bytea,
       timestamptz '2026-01-01 00:00:00+00' + (g || ' minutes')::interval + (g % 13 || ' hours')::interval,
       jsonb_build_object('n', g, 'nested', jsonb_build_object('list', jsonb_build_array(g, g::text, null, true)), 'text', 'línea ' || g),
       array['a' || g, 'with,comma', 'with "quote"', '']
from generate_series(1, 2000) g;
