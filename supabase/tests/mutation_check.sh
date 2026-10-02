#!/usr/bin/env bash
# A test of the tests. Breaks one database rule at a time and confirms that rls_isolation.sql notices.
# Every line must say "caught". A line that says "MISSED" means the suite has a blind spot to close.
#
#   bash supabase/tests/mutation_check.sh
#
# It starts the same throwaway local PostgreSQL as run_local.sh (settings: PGBIN, PGTEST_DIR, PGTEST_USER),
# rebuilds the database for every breakage, and stops the server at the end. Nothing here touches Supabase.
# Takes a few minutes.
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

q() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" "$@"; }
caught=0; missed=0
run() { # run "<what is broken>" "<SQL that breaks it>"
  q -U "$admin" -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1
  q -U "$admin" -d "$db" -f "$here/setup_local.sql" >/dev/null 2>&1
  for f in "$root"/supabase/migrations/*.sql "$root/supabase/seed.sql"; do q -U postgres -d "$db" -f "$f" >/dev/null 2>&1; done
  if ! q -U postgres -d "$db" -c "$2" >/dev/null 2>"$dir/mutation.err"; then
    echo "COULD NOT APPLY | $1 | $(head -n 1 "$dir/mutation.err")"; missed=$((missed + 1)); return
  fi
  out="$(q -U "$admin" -d "$db" -f "$here/rls_isolation.sql" 2>&1)"
  if echo "$out" | grep -q "FAILED:"; then
    caught=$((caught + 1)); echo "caught | $1 | $(echo "$out" | grep -m1 -o 'FAILED: .*' | cut -c1-140)"
  else
    missed=$((missed + 1)); echo "MISSED | $1"
  fi
}

run "force RLS removed on client_payments" "alter table public.client_payments no force row level security"
run "payments readable by any member" "drop policy client_payments_select on public.client_payments; create policy client_payments_select on public.client_payments for select to authenticated using (tenant_id = any ((select app.tenants_with_role('owner','manager','staff','worker'))::uuid[]))"
run "tenants_can ignores who is asking" "create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(t.id), '{}'::uuid[]) from public.tenants t \$\$"
run "office_tenants ignores who is asking" "create or replace function app.office_tenants() returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(t.id), '{}'::uuid[]) from public.tenants t \$\$"
run "my_worker_ids returns every worker" "create or replace function app.my_worker_ids() returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(w.id), '{}'::uuid[]) from public.workers w \$\$"
run "disabled members still count" "create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[] language sql stable security definer set search_path = '' as \$\$ select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[]) from public.tenant_members m where m.user_id = (select auth.uid()) and p_permissions <@ app.role_permissions(m.role) \$\$"
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

echo
echo "$caught caught, $missed missed"
[ "$missed" -eq 0 ]
