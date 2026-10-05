-- Module tests, part 9: the rules that must hold when two sessions act at the same moment (0032, 0033, 0036).
-- Real second, third ... database sessions are opened with dblink (part of PostgreSQL's contrib package, like
-- pgcrypto), each signed in as a person. Two kinds of proof for each rule:
--   scripted  session 1 does the thing and does NOT commit; session 2 tries the same and is seen waiting on the
--             lock; session 1 commits; session 2 is refused. This is the exact interleaving a race needs.
--   at once   six sessions send the same request together; exactly one wins.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = error;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
create extension if not exists dblink with schema test;
select test.begin_section('38. concurrency') \g /dev/null

-- Opens a session and signs it in as a person (the same claims test.login_session sets).
create or replace function test.remote(conn text, who text) returns void language plpgsql as $$
begin
  perform test.dblink_connect(conn, format('dbname=%s user=%s host=%s port=%s', current_database(), current_user,
    split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port')));
  perform * from test.dblink(conn, format($q$select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false),
      set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false),
      set_config('request.jwt.claims', %L, false), set_config('role', 'authenticated', false)$q$,
    json_build_object('sub', test.id(who), 'role', 'authenticated', 'aal', 'aal2', 'session_id', test.session_of(who))::text)) as t(a text, b text, c text, d text);
end $$;
-- The outcome of what a session was sent: 'ok', or the message of the refusal.
create or replace function test.collect(conn text) returns text language plpgsql as $$
declare r text; msg text;
begin
  select t.r into r from test.dblink_get_result(conn, false) as t(r text);
  msg := test.dblink_error_message(conn);
  perform * from test.dblink_get_result(conn, false) as t(r text);
  -- the first line of the remote error, without its 'ERROR:' prefix
  return case when msg in ('OK', '') then 'ok' else regexp_replace(split_part(msg, E'\n', 1), '^ERROR:\s*', '') end;
end $$;
-- Waits (up to ten seconds) until a session whose statement matches is seen waiting for a lock.
create or replace function test.seen_waiting(pattern text) returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and state = 'active' and query like pattern and pid <> pg_backend_pid()) then return true; end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end $$;

insert into public.clients (id, tenant_id, name) values (test.u(779001), test.id('m'), 'Concurrency Client');
insert into public.offices (id, tenant_id, name, address) values (test.u(779002), test.id('m'), 'Concurrency office', '9 Sample Street');
insert into public.appointments (id, tenant_id, type_id, client_id, staff_id, date, start_time, minutes, mode, status, fee, pay_by)
  select test.u(779010 + i), test.id('m'), test.id('m.at2'), test.u(779001), test.id('m.m_owner'), current_date + 500 + i, '09:00', 45, 'video', 'awaiting_payment', 75, now() + interval '2 days'
  from generate_series(1, 8) i;
insert into public.credits (id, tenant_id, client_id, amount, reason, by_member_id) values
  (test.u(779003), test.id('m'), test.u(779001), 80, 'goodwill', test.id('m.m_owner')),
  (test.u(779004), test.id('m'), test.u(779001), 75, 'goodwill', test.id('m.m_owner'));

-- ---------------------------------------------------------------------------------------------------------------------
-- A credit is spent once
-- ---------------------------------------------------------------------------------------------------------------------
select test.remote('s1', 'm_staff') \g /dev/null
select test.remote('s2', 'm_manager') \g /dev/null
select test.dblink_exec('s1', 'begin') \g /dev/null
select r::jsonb -> 'appointment' ->> 'status' as first_status from test.dblink('s1', format('select public.credit_apply(%L, %L, %L)', test.id('m'), test.u(779003), test.u(779011))) as t(r text) \gset
select test.is(:'first_status', 'confirmed', 'session 1 pays an appointment with the credit, and has not committed yet') \g /dev/null
select test.dblink_send_query('s2', format('select public.credit_apply(%L, %L, %L)', test.id('m'), test.u(779003), test.u(779012))) \g /dev/null
select test.ok(test.seen_waiting('%credit_apply%') and test.dblink_is_busy('s2') = 1, 'session 2 wants the same credit for another appointment: it is seen waiting on the lock of the credit row, not reading it as unused') \g /dev/null
select test.dblink_exec('s1', 'commit') \g /dev/null
select test.is(test.collect('s2'), 'conflict', 'once session 1 commits, session 2 is refused: "conflict"') \g /dev/null
select test.ok((select used_appt_id = test.u(779011) from public.credits where id = test.u(779003)) and (select paid_at is null and status = 'awaiting_payment' from public.appointments where id = test.u(779012))
           and (select count(*) = 1 and sum(amount) = 5.00 from public.credits where from_appt_id in (test.u(779011), test.u(779012))),
  'the credit paid the first appointment only; the second is unpaid; the 5.00 left over exists once') \g /dev/null
select test.dblink_disconnect('s1') \g /dev/null
select test.dblink_disconnect('s2') \g /dev/null
-- six sessions, six appointments, one credit, all at once
do $$
declare i integer; res text; ok integer := 0; refused integer := 0;
begin
  for i in 1..6 loop perform test.remote('c' || i, case when i % 2 = 0 then 'm_staff' else 'm_manager' end); end loop;
  for i in 1..6 loop perform test.dblink_send_query('c' || i, format('select public.credit_apply(%L, %L, %L)', test.id('m'), test.u(779004), test.u(779012 + i))); end loop;
  for i in 1..6 loop
    res := test.collect('c' || i);
    if res = 'ok' then ok := ok + 1; elsif res = 'conflict' then refused := refused + 1; end if;
    perform test.dblink_disconnect('c' || i);
  end loop;
  perform test.is(ok || ' paid, ' || refused || ' refused', '1 paid, 5 refused', 'six sessions spend the same credit on six appointments at once: one is paid, five are refused as "conflict"');
  perform test.ok((select count(*) = 1 from public.appointments where credit_id = test.u(779004)) and (select used_at is not null from public.credits where id = test.u(779004))
              and (select count(*) = 1 from public.audit_log where action = 'credit.apply' and new_data ->> 'credit' = test.u(779004)::text),
    'the ledger agrees: the credit is used on exactly one appointment, with one line in the audit log');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- A team member is never booked twice
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function test.slot_sql(n integer, at time) returns text language sql as $$
  select format($q$insert into public.appointments (id, tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status) values (%L, %L, %L, %L, %L, %L, %L, 30, 'scheduled')$q$,
    test.u(n), test.id('m'), test.id('m.at1'), test.u(779001), test.id('m.m_manager'), current_date + 600, at)
$$;
select test.remote('s1', 'm_staff') \g /dev/null
select test.remote('s2', 'm_owner') \g /dev/null
select test.dblink_exec('s1', 'begin') \g /dev/null
select test.dblink_exec('s1', test.slot_sql(779031, '10:00')) \g /dev/null
select test.dblink_send_query('s2', test.slot_sql(779032, '10:15')) \g /dev/null
select test.ok(test.seen_waiting('%00000000-0000-4000-9000-000000779032%') and test.dblink_is_busy('s2') = 1, 'session 1 books 10:00 and has not committed; session 2 books 10:15 for the same person and is seen waiting, not slipping past a row it cannot see yet') \g /dev/null
select test.dblink_exec('s1', 'commit') \g /dev/null
select test.is(test.collect('s2'), 'This team member already has an appointment at that time', 'once session 1 commits, session 2 is refused') \g /dev/null
select test.ok((select count(*) = 1 from public.appointments where id in (test.u(779031), test.u(779032))), 'one of the two appointments exists') \g /dev/null
select test.dblink_disconnect('s1') \g /dev/null
select test.dblink_disconnect('s2') \g /dev/null
do $$
declare i integer; res text; ok integer := 0; refused integer := 0;
begin
  for i in 1..6 loop perform test.remote('c' || i, 'm_staff'); end loop;
  for i in 1..6 loop perform test.dblink_send_query('c' || i, test.slot_sql(779040 + i, '14:00')); end loop;
  for i in 1..6 loop
    res := test.collect('c' || i);
    if res = 'ok' then ok := ok + 1; elsif res like 'This team member already has%' then refused := refused + 1; end if;
    perform test.dblink_disconnect('c' || i);
  end loop;
  perform test.is(ok || ' booked, ' || refused || ' refused', '1 booked, 5 refused', 'six sessions book the same person at 14:00 at once: one appointment, five refusals');
  perform test.ok((select count(*) = 1 from public.appointments where staff_id = test.id('m.m_manager') and date = current_date + 600 and start_time = '14:00'), 'and one row');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- A closed day stays closed
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.cash_entries (id, tenant_id, date, office_id, dir, amount, category, by_member_id) values (test.u(779050), test.id('m'), current_date - 2, test.u(779002), 'in', 40, 'other', test.id('m.m_owner'));
select test.remote('s1', 'm_owner') \g /dev/null
select test.remote('s2', 'm_staff') \g /dev/null
select test.dblink_exec('s1', 'begin') \g /dev/null
select (r::jsonb ->> 'expected')::numeric as counted_expected from test.dblink('s1', format('select public.cash_close(%L, %L, %L, 40)', test.id('m'), current_date - 2, test.u(779002))) as t(r text) \gset
select test.dblink_send_query('s2', format($q$insert into public.cash_entries (id, tenant_id, date, office_id, dir, amount, category) values (%L, %L, %L, %L, 'in', 7, 'other')$q$, test.u(779051), test.id('m'), current_date - 2, test.u(779002))) \g /dev/null
select test.ok(:counted_expected = 40 and test.seen_waiting('%00000000-0000-4000-9000-000000779051%') and test.dblink_is_busy('s2') = 1,
  'session 1 counts the drawer (40.00 expected) and has not committed; an entry for that day from session 2 is seen waiting on the drawer''s lock') \g /dev/null
select test.dblink_exec('s1', 'commit') \g /dev/null
select test.is(test.collect('s2'), 'That day was already counted and closed', 'once the close commits, the late entry is refused: it cannot land in a day whose count is already written') \g /dev/null
select test.ok(not exists (select 1 from public.cash_entries where id = test.u(779051)) and (select expected = 40.00 and diff = 0 from public.cash_closes where office_id = test.u(779002)), 'the close stands at 40.00 and the day holds one entry') \g /dev/null
select test.dblink_disconnect('s1') \g /dev/null
select test.dblink_disconnect('s2') \g /dev/null
-- (the entry is written in its own statement: inside the block below it would hold the drawer's lock itself)
insert into public.cash_entries (tenant_id, date, office_id, dir, amount, category, by_member_id) values (test.id('m'), current_date - 1, test.u(779002), 'in', 10.10, 'other', test.id('m.m_owner'));
do $$
declare i integer; res text; ok integer := 0; refused integer := 0;
begin
  for i in 1..4 loop perform test.remote('c' || i, case when i % 2 = 0 then 'm_owner' else 'm_manager' end); end loop;
  for i in 1..4 loop perform test.dblink_send_query('c' || i, format('select public.cash_close(%L, %L, %L, 50.10)', test.id('m'), current_date - 1, test.u(779002))); end loop;
  for i in 1..4 loop
    res := test.collect('c' || i);
    if res = 'ok' then ok := ok + 1; elsif res = 'locked' then refused := refused + 1; end if;
    perform test.dblink_disconnect('c' || i);
  end loop;
  perform test.is(ok || ' closed, ' || refused || ' refused', '1 closed, 3 refused', 'four sessions close the same day at once: one close, three refused as "locked"');
  perform test.ok((select count(*) = 1 and min(expected) = 50.10 from public.cash_closes where office_id = test.u(779002) and date = current_date - 1), 'one close for that day: 40.00 counted the day before plus 10.10 is 50.10');
end $$;

drop extension dblink;
\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '38. concurrency' group by section;
