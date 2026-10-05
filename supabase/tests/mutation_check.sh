#!/usr/bin/env bash
# A test of the tests. Breaks one database rule at a time and confirms that the suite notices.
# Every line must say "caught". A line that says "MISSED" means the suite has a blind spot to close.
#
#   bash supabase/tests/mutation_check.sh
#
# It starts the same throwaway local PostgreSQL as run_local.sh (settings: PGBIN, PGTEST_DIR, PGTEST_USER,
# MIGRATIONS_MAX), rebuilds the database for every breakage, and stops the server at the end. Nothing here touches
# Supabase. Takes about five minutes.
#   ONLY="rotation"   run only the breakages whose description contains this text
#
# Each breakage names the part of the suite that must notice it:
#   sql          rls_isolation.sql, then gateway.sql (the default)
#   concurrency  concurrency.sh (after the two SQL files, which it builds on)
#   parity       parity.mjs
#   roundtrip    tests/gateway_roundtrip.mjs
#   modules      modules/*.test.sql (after the two SQL files, which must still pass: the module tests alone notice)
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
if [ ! -x "$PGBIN/psql" ]; then PGBIN="$(dirname "$(command -v psql || true)")"; fi
dir="${PGTEST_DIR:-/tmp/vyntex-pgtest}"
sock="$dir/sock"
db="vyntex_mutation"
admin="supabase_admin"
os_user="${PGTEST_USER:-postgres}"

echo "== first, the unbroken suite must pass"
KEEP=1 bash "$here/run_local.sh" >/dev/null || { echo "run_local.sh does not pass: fix that first" >&2; exit 1; }
stop_server() { if [ "$(id -u)" -eq 0 ]; then runuser -u "$os_user" -- "$PGBIN/pg_ctl" -D "$dir/data" -m fast -w stop >/dev/null 2>&1; else "$PGBIN/pg_ctl" -D "$dir/data" -m fast -w stop >/dev/null 2>&1; fi; }
trap stop_server EXIT

q() { PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" "$@"; }
seeds="$dir/module_seeds.sql"
[ -f "$seeds" ] || : > "$seeds"
# The part of the suite that should notice. Prints what it printed; a non-zero exit means "noticed".
detect() {
  case "$1" in
    sql)
      q -U "$admin" -d "$db" -v module_seeds="$seeds" -f "$here/rls_isolation.sql" 2>&1 && q -U "$admin" -d "$db" -f "$here/gateway.sql" 2>&1 ;;
    concurrency)
      q -U "$admin" -d "$db" -v module_seeds="$seeds" -f "$here/rls_isolation.sql" >/dev/null 2>&1 && q -U "$admin" -d "$db" -f "$here/gateway.sql" >/dev/null 2>&1 \
        && PSQL="$PGBIN/psql" PGHOST="$sock" PGUSER="$admin" PGDATABASE="$db" bash "$here/concurrency.sh" 2>&1 ;;
    modules)
      q -U "$admin" -d "$db" -v module_seeds="$seeds" -f "$here/rls_isolation.sql" >/dev/null 2>&1 && q -U "$admin" -d "$db" -f "$here/gateway.sql" >/dev/null 2>&1 \
        || { echo "ERROR: rls_isolation.sql or gateway.sql noticed it before the module tests ran"; return 1; }
      for f in "$here"/modules/*.test.sql; do q -U "$admin" -d "$db" -f "$f" 2>&1 || return 1; done ;;
    parity)
      PSQL="$PGBIN/psql" PGHOST="$sock" PGUSER="$admin" PGDATABASE="$db" node "$here/parity.mjs" 2>&1 ;;
    roundtrip)
      PSQL="$PGBIN/psql" PGHOST="$sock" PGUSER="$admin" PGDATABASE="$db" node "$root/tests/gateway_roundtrip.mjs" build practice 2>&1 ;;
  esac
}
caught=0; missed=0
run() { # run "<what is broken>" "<SQL that breaks it>" [sql|concurrency|parity|roundtrip]
  local how="${3:-sql}"
  if [ -n "${ONLY:-}" ] && [[ "$1" != *"$ONLY"* ]]; then return; fi
  q -U "$admin" -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1
  q -U "$admin" -d "$db" -f "$here/setup_local.sql" >/dev/null 2>&1
  for f in "$root"/supabase/migrations/*.sql "$root/supabase/seed.sql"; do
    if [ -n "${MIGRATIONS_MAX:-}" ] && [ "$(basename "$f" | cut -c1-4)" \> "$MIGRATIONS_MAX" ] && [ "$(basename "$f")" != "seed.sql" ]; then continue; fi
    q -U postgres -d "$db" -f "$f" >/dev/null 2>&1
  done
  if ! q -U postgres -d "$db" -c "$2" >/dev/null 2>"$dir/mutation.err"; then
    echo "COULD NOT APPLY | $1 | $(head -n 1 "$dir/mutation.err")"; missed=$((missed + 1)); return
  fi
  if out="$(detect "$how")"; then
    missed=$((missed + 1)); echo "MISSED | $1 ($how)"
  else
    caught=$((caught + 1)); echo "caught | $1 | $(echo "$out" | grep -m1 -o 'FAILED: .*\|ERROR: .*' | cut -c1-150)"
    if ! echo "$out" | grep -q 'FAILED: '; then echo "         (noticed, but not by an assertion: $(echo "$out" | tail -n 2 | tr '\n' ' ' | cut -c1-200))"; fi
  fi
}

# ---- the rules of migrations 0001 to 0009
run "force RLS removed on client_payments" "alter table public.client_payments no force row level security"
run "payments readable by any member" "drop policy client_payments_select on public.client_payments; create policy client_payments_select on public.client_payments for select to authenticated using (tenant_id = any ((select app.tenants_with_role('owner','manager','staff','worker'))::uuid[]))"
run "tenants_can ignores who is asking" "create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(t.id), '{}'::uuid[]) from public.tenants t \$\$"
run "office_tenants ignores who is asking" "create or replace function app.office_tenants() returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(t.id), '{}'::uuid[]) from public.tenants t \$\$"
run "my_worker_ids returns every worker" "create or replace function app.my_worker_ids() returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(w.id), '{}'::uuid[]) from public.workers w \$\$"
run "disabled members still count" "create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[]) from public.tenant_members m join public.tenants t on t.id = m.tenant_id where m.user_id = (select auth.uid()) and p_permissions <@ app.permissions_for(t.industry_id, t.config, m.role) \$\$"
run "jobs.client FK without tenant_id" "alter table public.jobs drop constraint jobs_tenant_id_client_id_fkey; alter table public.jobs add constraint jobs_client_fk foreign key (client_id) references public.clients (id)"
run "anon can read demo_requests" "grant select on public.demo_requests to anon"
run "audit log append-only trigger dropped" "drop trigger audit_log_append_only on public.audit_log"
run "my_jobs exposes price" "create or replace view public.my_jobs with (security_barrier = true) as select j.id, j.tenant_id, j.number, j.name, j.address, j.type, j.status, j.start_date, j.end_date, j.repeat, j.price from public.jobs j where j.tenant_id = any ((select app.tenants_with_role('worker'))::uuid[])"
run "encrypted column readable" "grant select (tax_id_enc) on public.workers to authenticated"
run "tasks readable by any member" "drop policy tasks_select on public.tasks; create policy tasks_select on public.tasks for select to authenticated using (tenant_id = any ((select app.tenants_with_role('owner','manager','staff','worker'))::uuid[]))"
run "manager can edit membership" "drop policy tenant_members_update on public.tenant_members; create policy tenant_members_update on public.tenant_members for update to authenticated using (tenant_id = any ((select app.tenants_with_role('owner','manager'))::uuid[])) with check (tenant_id = any ((select app.tenants_with_role('owner','manager'))::uuid[]))"
run "storage read open to any signed-in person" "create policy leak on storage.objects for select to authenticated using (bucket_id = 'worker-documents')"
run "tenant_id immutability trigger dropped on clients" "drop trigger clients_00_tenant_fixed on public.clients"
run "work log insert open to any worker" "drop policy work_logs_insert on public.work_logs; create policy work_logs_insert on public.work_logs for insert to authenticated with check (tenant_id = any ((select app.tenants_with_role('owner','manager','staff','worker'))::uuid[]))"
run "new table without RLS" "create table public.zz_new (id uuid primary key, tenant_id uuid not null)"
run "decrypt callable by app" "grant execute on function app.decrypt_pii(bytea) to authenticated"
run "view without security barrier" "alter view public.worker_directory set (security_barrier = false)"
run "worker_payments readable by all workers" "drop policy worker_payments_select on public.worker_payments; create policy worker_payments_select on public.worker_payments for select to authenticated using (tenant_id = any ((select app.tenants_can('money'))::uuid[]) or tenant_id = any ((select app.tenants_with_role('worker'))::uuid[]))"
run "consent editable" "drop trigger consent_records_freeze on public.consent_records"
run "definer function without search_path" "alter function app.is_member(uuid) reset search_path"
run "per-row helper in a policy (slow)" "drop policy clients_select on public.clients; create policy clients_select on public.clients for select to authenticated using (app.can(tenant_id, 'clients'))"
run "worker view of jobs shows all jobs of the company" "create or replace view public.my_jobs with (security_barrier = true) as select j.id, j.tenant_id, j.number, j.name, j.address, j.type, j.status, j.start_date, j.end_date, j.repeat from public.jobs j where j.tenant_id = any ((select app.tenants_with_role('worker'))::uuid[])"
run "staff can write signature evidence" "grant update (esign_status, esign_signer_name, esign_signer_email, esign_sent_at, esign_signed_at, esign_consent, esign_consent_text, esign_typed_name) on public.documents to authenticated"
run "export without consent check" "create or replace function app.has_active_consent(p_tenant uuid, p_kind text, p_tax_year integer default null) returns boolean language sql stable security definer set search_path = '' as \$\$ select true \$\$"
run "audit trigger missing on client_payments" "drop trigger client_payments_audit on public.client_payments"
run "staff can read activity with amounts" "drop policy activity_select on public.activity; create policy activity_select on public.activity for select to authenticated using (tenant_id = any ((select app.office_tenants())::uuid[]))"

# ---- the rules of migrations 0010 to 0019
run "the write capability is not asked for" "create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[]) from public.tenant_members m join public.tenants t on t.id = m.tenant_id where m.user_id = (select auth.uid()) and m.status = 'active' and t.status <> 'closed' and pg_catalog.array_remove(p_permissions, 'write') <@ app.permissions_for(t.industry_id, t.config, m.role) \$\$"
run "one write policy forgets the write capability" "alter policy clients_insert on public.clients with check (tenant_id = any ((select app.tenants_can('clients'))::uuid[]))"
run "read only can write jobs through the staff view" "drop trigger jobs_write_guard on public.jobs"
run "a company's own role list is ignored" "create or replace function app.permissions_for(p_industry text, p_config jsonb, p_role text) returns text[] language sql immutable set search_path = '' as \$\$ select case when p_role = 'owner' then app.capabilities() else app.role_permissions(p_industry, p_role) end \$\$"
run "every edition gets the field matrix" "create or replace function app.edition_family(p_industry text) returns text language sql immutable set search_path = '' as \$\$ select 'field'::text \$\$"
run "client_secrets readable by office roles" "grant select on public.client_secrets to authenticated; create policy leak on public.client_secrets for select to authenticated using (tenant_id = any ((select app.office_tenants())::uuid[]))"
run "tax ID markers of a client writable" "drop trigger clients_tax_guard on public.clients"
run "known fields can be read from extra" "create or replace function app.ws_known(p_name text) returns text[] language sql stable security definer set search_path = '' as \$\$ select array[]::text[] \$\$"
run "configuration not validated" "drop trigger tenants_config_check on public.tenants"
run "lead stage not validated" "drop trigger leads_validate on public.leads"
run "a manager with config can change what roles may do" "drop trigger tenants_guard on public.tenants"
run "a manager with users can make an owner" "drop trigger tenant_members_guard on public.tenant_members"
run "a person can record a message as sent" "drop trigger messages_guard on public.messages"
run "handoff history editable" "drop trigger lead_handoffs_append_only on public.lead_handoffs"
run "office scope does not follow the client" "create or replace function app.hidden_clients() returns setof uuid language sql stable security definer set search_path = '' as \$\$ select null::uuid where false \$\$"
run "clients of every office visible" "alter policy clients_select on public.clients using (tenant_id = any ((select app.tenants_can('clients'))::uuid[]))"
run "audit trigger missing on clients" "drop trigger clients_audit on public.clients"
run "the gateway registry is writable by signed-in people" "grant select, update on app.ws_collections to authenticated; create policy open on app.ws_collections for all to authenticated using (true) with check (true)"
run "ws_apply runs with the owner's rights" "alter function app.ws_apply_ops(uuid, jsonb, boolean) security definer"
run "the staff variant of jobs reads the table" "update app.ws_collections set read_caps = '{jobs}' where name = 'jobs' and variant = 1"
run "users writable through the gateway" "update app.ws_collections set write_caps = '{}', insert_sql = 'select 1', update_sql = 'update public.tenant_members t set name = \$1 ->> ''name'' where t.id = \$2::uuid and t.tenant_id = \$3', changed_sql = 'select true, null::text from public.tenant_members t where t.id = \$2::uuid and t.tenant_id = \$3' where name = 'users'"
run "the stale check is skipped" "update app.ws_collections set has_updated = false where name = 'clients'"
run "anon can call ws_load" "grant execute on function public.ws_load(uuid), app.ws_load(uuid) to anon"
run "duplicate ids from a connected system allowed" "drop index public.clients_external_square_uidx"
run "the rotation does not lock its row" "do \$\$ declare src text; begin select pg_catalog.pg_get_functiondef('app.lead_next_turn(uuid)'::regprocedure) into src; execute pg_catalog.replace(src, 'where lr.tenant_id = p_tenant for update;', 'where lr.tenant_id = p_tenant;'); end \$\$" concurrency
run "a reserved address missing in the database" "create or replace function app.reserved_slugs() returns text[] language sql immutable set search_path = '' as \$\$ select array['demo', 'pricing', 'api']::text[] \$\$" parity
run "a stage of the practice edition renamed in the database" "create or replace function app.stages_of(p_industry text, p_config jsonb) returns jsonb language sql immutable set search_path = '' as \$\$ select '[{\"id\":\"new\",\"kind\":\"open\"},{\"id\":\"won\",\"kind\":\"won\"},{\"id\":\"lost\",\"kind\":\"lost\"}]'::jsonb \$\$" parity
run "a field mapped to the wrong name" "update app.ws_collections set read_sql = pg_catalog.replace(read_sql, '''scope''', '''scopeX''') where name = 'jobs'" roundtrip
run "a column that is not written" "update app.ws_collections set insert_sql = pg_catalog.replace(insert_sql, '(\$1 ->> ''pri'')::text', 'null::text') where name = 'leads'" roundtrip

# ---- the rules of migrations 0030 to 0049 (ONLY="module:" runs these alone)
# Replaces one piece of text in the body of a function, and fails when that text is not there (so a breakage that
# no longer applies is reported as COULD NOT APPLY instead of passing for the wrong reason).
swap() { printf 'do $do$ declare src text; begin select pg_catalog.pg_get_functiondef(%s::regprocedure) into src; if pg_catalog.strpos(src, $o$%s$o$) = 0 then raise exception $m$the text to replace was not found$m$; end if; execute pg_catalog.replace(src, $o$%s$o$, $o$%s$o$); end $do$' "'$1'" "$2" "$3" "$4"; }
run "module: vault, the person who asked can approve their own request" "$(swap 'public.vault_decide(uuid,uuid,boolean)' "perform app.module_refuse('needs_other_person');" "perform app.module_refuse('needs_other_person');" "null;")" modules
run "module: vault, a number is shown without a fresh identity check" "$(swap 'public.vault_reveal(uuid,uuid)' "perform app.require_stepup();" "perform app.require_stepup();" "null;")" modules
run "module: vault, a request can be viewed more than once" "$(swap 'public.vault_reveal(uuid,uuid)' "update public.reveal_requests x set status = 'used', used_at = pg_catalog.now() where x.tenant_id = p_tenant and x.id = q.id;" "update public.reveal_requests x set status = 'used', used_at = pg_catalog.now() where x.tenant_id = p_tenant and x.id = q.id;" "null;")" modules
run "module: vault, an approval that ran out still shows the number" "$(swap 'public.vault_reveal(uuid,uuid)' " or q.expires_at <= pg_catalog.now()" " or q.expires_at <= pg_catalog.now()" "")" modules
run "module: vault, someone other than the person who asked can view" "$(swap 'public.vault_reveal(uuid,uuid)' "if q.requested_by <> v_me then raise exception 'Not allowed' using errcode = '42501'; end if;" "if q.requested_by <> v_me then raise exception 'Not allowed' using errcode = '42501'; end if;" "")" modules
run "module: vault, the number is written to the access log in clear" "$(swap 'public.vault_set(uuid,uuid,text,text)' "perform app.secure_log(p_tenant, p_client, v_me, 'set');" "perform app.secure_log(p_tenant, p_client, v_me, 'set');" "perform app.secure_log(p_tenant, p_client, v_me, 'set', p_value);")" modules
run "module: vault, the number is written to the audit log in clear" "$(swap 'public.vault_set(uuid,uuid,text,text)' "pg_catalog.jsonb_build_object('kind', p_type));" "pg_catalog.jsonb_build_object('kind', p_type));" "pg_catalog.jsonb_build_object('kind', p_type, 'note', v_digits));")" modules
run "module: vault, the access log can be edited" "drop trigger secure_access_log_append_only on public.secure_access_log" modules
run "module: vault, a reveal request can be rewritten" "drop trigger reveal_requests_guard on public.reveal_requests" modules
run "module: credit, the row is not locked before it is spent" "$(swap 'public.credit_apply(uuid,uuid,uuid)' "where x.tenant_id = p_tenant and x.id = p_credit for update;" "where x.tenant_id = p_tenant and x.id = p_credit for update;" "where x.tenant_id = p_tenant and x.id = p_credit;")" modules
run "module: credit, a used credit is not refused" "$(swap 'public.credit_apply(uuid,uuid,uuid)' "if c.used_at is not null or c.void_at is not null then perform app.module_refuse('conflict'); end if;" "if c.used_at is not null or c.void_at is not null then perform app.module_refuse('conflict'); end if;" "")" modules
run "module: credit, the ledger can be edited" "drop trigger credits_ledger_guard on public.credits" modules
run "module: credit, an expired credit still pays" "$(swap 'public.credit_apply(uuid,uuid,uuid)' "if c.expires is not null and c.expires < current_date then perform app.module_refuse('expired'); end if;" "if c.expires is not null and c.expires < current_date then perform app.module_refuse('expired'); end if;" "")" modules
run "module: appointment, a payment can be recorded twice" "$(swap 'public.appt_mark_paid(uuid,uuid,text,text,numeric,text)' "if a.paid_at is not null or a.status in" "if a.paid_at is not null or a.status in" "if a.status in")" modules
run "module: appointment, a person can write a payment directly" "drop trigger appointments_person_guard on public.appointments; grant update (paid_at, paid_method, paid_amount, paid_ref) on public.appointments to authenticated" modules
run "module: cash, a closed day accepts changes" "drop trigger cash_entries_lock on public.cash_entries" modules
run "module: cash, a day can be closed twice" "$(swap 'public.cash_close(uuid,date,uuid,numeric,text)' "if v_through is not null and p_date <= v_through then perform app.module_refuse('locked'); end if;" "if v_through is not null and p_date <= v_through then perform app.module_refuse('locked'); end if;" "")" modules
run "module: cash, a count does not take the drawer's lock" "$(swap 'public.cash_close(uuid,date,uuid,numeric,text)' "perform app.cash_drawer_lock(p_tenant, p_office);" "perform app.cash_drawer_lock(p_tenant, p_office);" "null;")" modules
run "module: double booking allowed" "drop trigger appointments_double_booking on public.appointments" modules
run "module: double booking, the free minutes after an appointment are ignored" "$(swap 'app.appointments_double_booking()' "+ a.minutes + coalesce(y.buffer, 0)" "+ a.minutes + coalesce(y.buffer, 0)" "+ a.minutes")" modules
run "module: double booking, two bookings at once do not wait for each other" "$(swap 'app.appointments_double_booking()' "perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vx.appointments:' || new.tenant_id::text || ':' || new.staff_id::text, 0));" "perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vx.appointments:' || new.tenant_id::text || ':' || new.staff_id::text, 0));" "")" modules
run "module: office scope, appointments of every office visible" "alter policy appointments_select on public.appointments using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[]))" modules
run "module: office scope, an appointment can be booked for a hidden client" "alter policy appointments_insert on public.appointments with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]))" modules
run "module: office scope, signature requests of every office visible" "alter policy envelopes_select on public.envelopes using (tenant_id = any ((select app.tenants_can('esign'))::uuid[]))" modules
run "module: office scope, a signature request does not follow its document's client" "drop trigger envelopes_00_client on public.envelopes" modules
run "module: office scope, credits of every office visible" "alter policy credits_select on public.credits using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[]))" modules
run "module: access, a grant that ran out still opens the client" "$(swap 'app.granted_client_ids()' "and (g.expires is null or g.expires >= current_date)" "and (g.expires is null or g.expires >= current_date)" "")" modules
run "module: rules, the shape of a rule is not checked" "alter table public.rules drop constraint rules_shape" modules
run "module: credit, a person can write to the ledger directly" "grant update on public.credits to authenticated; create policy credits_update on public.credits for update to authenticated using (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[])) with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]))" modules
run "module: a rule event of the app is refused by the database" "alter table public.rules drop constraint rules_event_check; alter table public.rules add constraint rules_event_check check (event in ('lead.created', 'daily'))" parity

echo
echo "$caught caught, $missed missed"
[ "$missed" -eq 0 ]
