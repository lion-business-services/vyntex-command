#!/usr/bin/env bash
# Lead rotation under concurrency. Run by run_local.sh after gateway.sql, against the same database.
# Proves that public.lead_assign_next never hands the same turn to two leads that arrive at the same moment:
#
#   1. scripted interleaving  Session one takes a turn inside a transaction and keeps it open. Session two asks for
#                             the next turn and must WAIT (it is seen waiting for a lock). Session one commits;
#                             session two then gets the NEXT person, not the same one. Without the row lock in
#                             app.lead_next_turn session two would read the old turn and hand out the same person.
#   2. many at once           Eight sessions ask for 30 turns each, all at the same time, with a pool of three people.
#                             240 turns must have been counted, and each person must have exactly 80 of them. Had two
#                             sessions ever read the same turn, one person would have more and the count would be short.
#
# Connection: the usual PG* environment variables; PSQL is the path of the psql program. Uses the test schema and the
# sample company G created by rls_isolation.sql and gateway.sql. Every check goes through test.ok / test.is.
set -euo pipefail

PSQL="${PSQL:-psql}"
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

tenant="$(q -c "select test.id('g')")"
staff_uid="$(q -c "select test.id('g_staff')")"
manager_uid="$(q -c "select test.id('g_manager')")"
login_staff="select set_config('request.jwt.claims', '{\"sub\":\"$staff_uid\",\"role\":\"authenticated\"}', false); set role authenticated;"
login_manager="select set_config('request.jwt.claims', '{\"sub\":\"$manager_uid\",\"role\":\"authenticated\"}', false); set role authenticated;"

q <<SQL >/dev/null
set client_min_messages = warning;
select test.begin_section('20. rotation under concurrency');
update public.tenant_members set in_lead_pool = null, away_from = null, away_to = null, away_note = null where tenant_id = '$tenant';
update public.lead_routing
   set mode = 'round_robin', pool = array[test.id('g.m_staff'), test.id('g.m_manager'), test.id('g.m_owner')], exclude = '{}',
       cursor = 0, turns = 0, skip_away = true, fallback_id = test.id('g.m_owner')
 where tenant_id = '$tenant';
drop table if exists test.turns;
create table test.turns (session integer not null, member uuid, at timestamptz not null default clock_timestamp());
grant insert on test.turns to authenticated;
SQL

# ---- 1. scripted interleaving
# No fixed pauses decide the order: the script watches pg_stat_activity and only moves on when each session is where
# it has to be, so a slow machine cannot change the outcome.
wait_until() { # wait_until "<query that returns 1 when ready>"  (up to 15 seconds)
  for _ in $(seq 1 150); do
    if [ "$(q -c "$1")" = "1" ]; then return 0; fi
    sleep 0.1
  done
  return 1
}
PGAPPNAME=vx-rotation-one q > "$work/one.out" <<SQL &
$login_staff
begin;
select public.lead_assign_next('$tenant');
select pg_sleep(3);
commit;
SQL
one=$!
# session one has taken its turn and is now sleeping inside its open transaction
wait_until "select count(*) from pg_stat_activity where application_name = 'vx-rotation-one' and state = 'active' and query like '%pg_sleep%'" \
  || { echo "session one never reached its pause" >&2; exit 1; }
PGAPPNAME=vx-rotation-two q > "$work/two.out" <<SQL &
$login_manager
select public.lead_assign_next('$tenant');
SQL
two=$!
# session two must now be waiting for the row lock that session one holds
if wait_until "select count(*) from pg_stat_activity where application_name = 'vx-rotation-two' and state = 'active' and wait_event_type = 'Lock'"; then waiting=1; else waiting=0; fi
still_open="$(q -c "select count(*) from pg_stat_activity where application_name = 'vx-rotation-one' and state = 'active' and query like '%pg_sleep%'")"
wait "$one"
wait "$two"
first="$(grep -E '^[0-9a-f-]{36}$' "$work/one.out" | head -n 1)"
second="$(grep -E '^[0-9a-f-]{36}$' "$work/two.out" | head -n 1)"
q <<SQL >/dev/null
select test.is('$waiting/$still_open', '1/1', 'while one session holds a turn in an open transaction, a second session asking for the next turn waits for the row lock');
select test.is('$first', test.id('g.m_staff')::text, 'the first session got the first person in the pool');
select test.is('$second', test.id('g.m_manager')::text, 'the second session, once the first committed, got the next person and not the same one');
select test.is((select turns || '/' || cursor from public.lead_routing where tenant_id = '$tenant'), '2/2', 'two turns were counted and the cursor moved twice');
SQL

# ---- 2. many at once
q -c "update public.lead_routing set cursor = 0, turns = 0 where tenant_id = '$tenant'" >/dev/null
pids=()
for s in 1 2 3 4 5 6 7 8; do
  {
    echo "$login_staff"
    for _ in $(seq 1 30); do echo "insert into test.turns (session, member) select $s, public.lead_assign_next('$tenant');"; done
  } > "$work/session-$s.sql"
  q -f "$work/session-$s.sql" > /dev/null &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
q <<SQL >/dev/null
select test.is((select count(*)::text from test.turns), '240', 'eight sessions each took 30 turns at the same time');
select test.is((select turns::text from public.lead_routing where tenant_id = '$tenant'), '240', 'exactly 240 turns were counted: none was lost');
select test.is((select string_agg(n::text, ',' order by n) from (select count(*) as n from test.turns group by member) c), '80,80,80',
  'each of the three people got exactly 80 leads: no turn was handed out twice');
select test.is((select count(distinct session)::text from test.turns), '8', 'all eight sessions took part');
select test.ok((select count(*) > 0 from (select session, lag(session) over (order by at) as before from test.turns) x where session <> before),
  'the sessions really ran interleaved, not one after another');
select test.is((select cursor::text from public.lead_routing where tenant_id = '$tenant'), '0', 'after 240 turns in a pool of three the rotation is back at the first person');
SQL
echo "   rotation under concurrency: $(q -c "select count(*) from test.results where section = '20. rotation under concurrency'") checks passed (one scripted interleaving, 240 turns from 8 sessions at once)"
