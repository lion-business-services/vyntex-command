-- Module tests, part 6: the cash drawer, the daily close and the lock of a closed day (0036).
-- Company N. A new office gives a drawer nothing else has touched; its amounts are chosen so that binary
-- floating point would get them wrong (100.10 - 0.35, 99.75 + 20.25).
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('37. cash and the daily close') \g /dev/null

create or replace function test.close_day(who text, on_date date, office uuid, counted text, note text default null) returns jsonb language sql as $$
  select test.f(who, format('public.cash_close(%L, %L, %L, %s, %L)', test.id('n'), on_date, office, counted, note))
$$;
create or replace function test.cash_row(who text, n integer, on_date date, office uuid, dir text, amount numeric) returns text language sql as $$
  select test.as(who, format($q$insert into public.cash_entries (id, tenant_id, date, office_id, dir, amount, category, by_member_id) values (%L, %L, %L, %L, %L, %s, 'other', %L)$q$,
    test.u(n), test.id('n'), on_date, office, dir, amount, test.id('n.m_owner')))
$$;
insert into public.offices (id, tenant_id, name, address, timezone) values (test.u(6001), test.id('n'), 'Cash test office', '3 Sample Street', 'America/New_York');
select test.is(test.cash_row('n_owner', 6010, current_date - 2, test.u(6001), 'in', 100.10), 'rows:1', 'an entry of 100.10 in') \g /dev/null
select test.is(test.cash_row('n_manager', 6011, current_date - 2, test.u(6001), 'out', 0.35), 'rows:1', 'an entry of 0.35 out') \g /dev/null
select test.is(test.cash_row('n_owner', 6012, current_date - 1, test.u(6001), 'in', 20.25), 'rows:1', 'and 20.25 in the next day') \g /dev/null
select test.ok((select by_member_id = test.id('n.m_manager') from public.cash_entries where id = test.u(6011)), 'an entry is in the name of the person who recorded it, whatever the row said') \g /dev/null
select test.is(test.cash_row('n_staff', 6013, current_date - 1, test.u(6001), 'in', 5), 'error:42501', 'office staff of a field edition do not hold "cash": they record nothing') \g /dev/null

-- who may close
select test.is(test.close_day('n_staff', current_date - 2, test.u(6001), '99.75') ->> 'error', '42501', 'cash_close: not for staff without "cash"') \g /dev/null
select test.is(test.close_day('n_readonly', current_date - 2, test.u(6001), '99.75') ->> 'error', '42501', 'nor the read-only role') \g /dev/null
select test.is(test.close_day('b_owner', current_date - 2, test.u(6001), '99.75') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.close_day('anon', current_date - 2, test.u(6001), '99.75') ->> 'error', '42501', 'nor the anonymous visitor') \g /dev/null
select test.is(test.close_day('service', current_date - 2, test.u(6001), '99.75') ->> 'error', '42501', 'nor the server key: a drawer is counted by a person') \g /dev/null
-- what cannot be a count
select test.is(test.close_day('n_manager', current_date - 2, test.u(6001), '-1') ->> 'word', 'invalid', 'a negative count: invalid') \g /dev/null
select test.is(test.close_day('n_manager', current_date - 2, test.u(6001), '99.755') ->> 'word', 'invalid', 'a fraction of a cent: invalid') \g /dev/null
select test.is(test.close_day('n_manager', current_date + 2, test.u(6001), '99.75') ->> 'word', 'invalid', 'a day that has not come: invalid') \g /dev/null
select test.is(test.close_day('n_manager', current_date - 2, test.u(6999), '99.75') ->> 'word', 'invalid', 'an office that does not exist: invalid') \g /dev/null
select test.is(test.close_day('n_manager', current_date - 2, test.id('m.o1'), '99.75') ->> 'word', 'invalid', 'an office of another company does not exist here') \g /dev/null
select test.is(test.close_day('n_manager', current_date - 2, test.u(6001), '99.00') ->> 'word', 'invalid', 'a count that differs from what the entries say needs a note first') \g /dev/null
select test.ok(not exists (select 1 from public.cash_closes where office_id = test.u(6001)), 'none of those closed the day') \g /dev/null

-- the count, to the cent
select test.close_day('n_manager', current_date - 2, test.u(6001), '99.75') as k1 \gset
select test.ok((:'k1'::jsonb ->> 'expected')::numeric = 99.75 and (:'k1'::jsonb ->> 'counted')::numeric = 99.75 and (:'k1'::jsonb ->> 'diff')::numeric = 0 and :'k1'::jsonb ->> 'by' = test.id('n.m_manager')::text
           and :'k1'::jsonb ->> 'officeId' = test.u(6001)::text and :'k1'::jsonb ->> 'date' = (current_date - 2)::text and not :'k1'::jsonb ? 'note',
  'cash_close: 100.10 in and 0.35 out is 99.75 expected, exactly; a count of 99.75 is no difference and needs no note') \g /dev/null
select test.ok((select bool_and(close_id = (:'k1'::jsonb ->> 'id')::uuid) from public.cash_entries where id in (test.u(6010), test.u(6011))) and (select close_id is null from public.cash_entries where id = test.u(6012)),
  'the entries of that day carry the close; the next day''s entry is still open') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('n') and action = 'cash.close' and table_name = 'cash' and row_id = (:'k1'::jsonb ->> 'id')::uuid and actor = test.id('n_manager')), 'the close is in the audit log') \g /dev/null
select test.is(test.close_day('n_manager', current_date - 2, test.u(6001), '99.75') ->> 'word', 'locked', 'a day is counted once: closing it again is refused as "locked"') \g /dev/null
select test.is(test.close_day('n_owner', current_date - 3, test.u(6001), '0') ->> 'word', 'locked', 'and so is a day before a closed one') \g /dev/null
select test.close_day('n_owner', current_date - 1, test.u(6001), '119.50', '  Fifty cents short after the bank run  ') as k2 \gset
select test.ok((:'k2'::jsonb ->> 'expected')::numeric = 120.00 and (:'k2'::jsonb ->> 'counted')::numeric = 119.50 and (:'k2'::jsonb ->> 'diff')::numeric = -0.50 and :'k2'::jsonb ->> 'note' = 'Fifty cents short after the bank run',
  'the next day starts from what was counted: 99.75 + 20.25 = 120.00 expected, 119.50 counted, 0.50 short, with its note') \g /dev/null

-- the lock of a closed day, for every caller
select test.is(test.cash_row('n_owner', 6020, current_date - 2, test.u(6001), 'in', 10), 'error:23514', 'a new entry on a closed day is refused, for the owner') \g /dev/null
select test.is(test.cash_row('service', 6020, current_date - 1, test.u(6001), 'in', 10), 'error:23514', 'and for the server key') \g /dev/null
select test.is(test.as('n_owner', format('update public.cash_entries set amount = 1 where id = %L', test.u(6010))), 'error:23514', 'an entry that was counted cannot be changed') \g /dev/null
select test.is(test.as('n_owner', format($q$update public.cash_entries set memo = 'Touched up' where id = %L$q$, test.u(6010))), 'error:23514', 'not even its memo') \g /dev/null
select test.is(test.as('n_owner', format('delete from public.cash_entries where id = %L', test.u(6010))), 'error:23514', 'or removed') \g /dev/null
select test.is(test.as('service', format('update public.cash_entries set close_id = null where id = %L', test.u(6010))), 'error:23514', 'or taken out of its close, by anyone') \g /dev/null
select test.is(test.cash_row('n_owner', 6021, current_date, test.u(6001), 'in', 10), 'rows:1', 'control: an entry for today, after the last close, is accepted') \g /dev/null
select test.is(test.as('n_owner', format('update public.cash_entries set date = %L where id = %L', current_date - 2, test.u(6021))), 'error:23514', 'an open entry cannot be moved back into a closed day') \g /dev/null
select test.is(test.as('n_owner', format('update public.cash_entries set close_id = %L where id = %L', (:'k1'::jsonb ->> 'id')::uuid, test.u(6021))), 'error:42501', 'a person cannot mark an entry as counted') \g /dev/null
select test.is(test.as('n_owner', format('update public.cash_entries set amount = 12.50 where id = %L', test.u(6021))), 'rows:1', 'control: an open entry can be corrected') \g /dev/null
select test.is(test.cash_row('n_owner', 6022, current_date - 2, null, 'in', 10), 'rows:1', 'control: the lock is per drawer; the drawer that belongs to no office was never closed') \g /dev/null
select test.apply('n_owner', 'n', jsonb_build_array(test.op('cash', test.u(6023), jsonb_build_object('date', (current_date - 2)::text, 'officeId', test.u(6001), 'dir', 'in', 'amount', 10, 'category', 'other', 'memo', '', 'by', 'x')))) as lk \gset
select test.is(test.reason(:'lk'::jsonb, test.u(6023)::text) || ':' || test.detail(:'lk'::jsonb, test.u(6023)::text), 'invalid:cash_day_closed', 'through ws_apply an entry on a closed day is refused as "invalid", with the name of the rule') \g /dev/null
select test.ok((select count(*) = 2 and sum(case when dir = 'in' then amount else -amount end) = 99.75 from public.cash_entries where close_id = (:'k1'::jsonb ->> 'id')::uuid), 'after all of that the closed day still adds up to 99.75') \g /dev/null
-- the close itself
select test.is(test.as('n_owner', format('update public.cash_closes set counted = 500 where id = %L', (:'k2'::jsonb ->> 'id')::uuid)), 'error:42501', 'a count cannot be changed afterwards, even by the owner') \g /dev/null
select test.is(test.as('n_owner', format('delete from public.cash_closes where id = %L', (:'k2'::jsonb ->> 'id')::uuid)), 'error:42501', 'or removed') \g /dev/null
select test.is(test.as('service', format($q$update public.cash_closes set note = 'Rewritten afterwards' where id = %L$q$, (:'k2'::jsonb ->> 'id')::uuid)), 'error:42501', 'and its note is not rewritten by the server key either') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '37. cash and the daily close' group by section;
