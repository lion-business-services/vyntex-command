-- 0003 Access rules
-- Row level security, enabled and forced, on every table. The rules mirror src/domain/permissions.ts:
--   owner    everything
--   manager  everything except Settings (company settings and membership) and profit
--   staff    leads, clients, jobs, tasks, calendar, documents, assistant. No money, team, reports, automations, compliance. No deleting.
--   worker   the worker portal only: own assignments, own tasks, own payments, own safe profile, work logs for assigned jobs.
-- Role-specific column limits (job price for staff, safe columns for workers) are handled by the views in 0007.

-- ---------------------------------------------------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER with an empty search_path: every name inside is schema qualified.
-- They read tenant_members as the owner role (BYPASSRLS), so policies that call them cannot recurse.
-- ---------------------------------------------------------------------------------------------------------------------

-- Role of the signed-in person in a company, or NULL when they do not belong to it (or are disabled, or the company is closed).
create or replace function app.member_role(p_tenant uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select m.role
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.status <> 'closed'
$$;

create or replace function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.member_role(p_tenant) is not null $$;

create or replace function app.has_role(p_tenant uuid, p_roles text[]) returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(app.member_role(p_tenant) = any (p_roles), false) $$;

-- tenant_members.id of the signed-in person in that company.
create or replace function app.current_member(p_tenant uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and t.status <> 'closed'
$$;

-- workers.id of the signed-in person when their role in that company is "worker", otherwise NULL.
create or replace function app.current_worker(p_tenant uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.worker_id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'worker'
    and t.status <> 'closed'
$$;

-- The role matrix, as data. Must stay identical to MATRIX in src/domain/permissions.ts (supabase/tests/parity.mjs compares them).
create or replace function app.role_permissions(p_role text) returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select case p_role
    when 'owner' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'settings', 'compliance', 'profit', 'delete']
    when 'manager' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'compliance', 'delete']
    when 'staff' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'assistant']
    else array[]::text[]
  end
$$;

-- Does the signed-in person hold this permission in this company? Workers hold none: they use the portal views and functions.
create or replace function app.can(p_tenant uuid, p_permission text) returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(p_permission = any (app.role_permissions(app.member_role(p_tenant))), false) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Set-based helpers, used by the policies and views.
-- A policy written as  app.can(tenant_id, 'clients')  would run the function once for every row it looks at.
-- Written as  tenant_id = any ((select app.tenants_can('clients'))::uuid[])  the function runs ONCE per statement and
-- the result is compared with an index. On 100,000 rows that is the difference between a minute and milliseconds.
-- ---------------------------------------------------------------------------------------------------------------------

-- Companies in which the signed-in person holds ALL of the listed permissions.
create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.status <> 'closed'
    and p_permissions <@ app.role_permissions(m.role)
$$;

-- Companies in which the signed-in person has one of the listed roles.
create or replace function app.tenants_with_role(variadic p_roles text[]) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.status <> 'closed'
    and m.role = any (p_roles)
$$;

-- Companies in which the signed-in person is office (owner, manager or staff).
create or replace function app.office_tenants() returns uuid[]
language sql stable security definer
set search_path = ''
as $$ select app.tenants_with_role('owner', 'manager', 'staff') $$;

-- tenant_members.id values of the signed-in person (one per company they belong to).
create or replace function app.my_member_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and t.status <> 'closed'
$$;

-- workers.id values of the signed-in person, in the companies where their role is "worker".
create or replace function app.my_worker_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.worker_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'worker' and t.status <> 'closed'
$$;

-- True for owner, manager and staff.
create or replace function app.is_office(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.has_role(p_tenant, array['owner', 'manager', 'staff']) $$;

-- Is this worker assigned to this job?
create or replace function app.worker_assigned(p_tenant uuid, p_job uuid, p_worker uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.job_assignments a
    where a.tenant_id = p_tenant and a.job_id = p_job and a.worker_id = p_worker
  )
$$;

-- "authenticated", "service_role", "anon", or '' for a direct database session (SQL Editor, migrations).
create or replace function app.jwt_role() returns text
language sql stable
set search_path = ''
as $$ select coalesce((select auth.jwt()) ->> 'role', '') $$;

revoke all on function app.member_role(uuid), app.is_member(uuid), app.has_role(uuid, text[]), app.current_member(uuid),
  app.current_worker(uuid), app.role_permissions(text), app.can(uuid, text), app.is_office(uuid),
  app.tenants_can(text[]), app.tenants_with_role(text[]), app.office_tenants(), app.my_member_ids(), app.my_worker_ids(),
  app.worker_assigned(uuid, uuid, uuid), app.jwt_role(), app.reserved_slugs(), app.is_valid_slug(text),
  app.touch_updated_at() from public, anon;
grant execute on function app.member_role(uuid), app.is_member(uuid), app.has_role(uuid, text[]), app.current_member(uuid),
  app.current_worker(uuid), app.role_permissions(text), app.can(uuid, text), app.is_office(uuid),
  app.tenants_can(text[]), app.tenants_with_role(text[]), app.office_tenants(), app.my_member_ids(), app.my_worker_ids(),
  app.worker_assigned(uuid, uuid, uuid), app.jwt_role(), app.reserved_slugs(), app.is_valid_slug(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Guards that apply to every caller, including the service role
-- ---------------------------------------------------------------------------------------------------------------------

-- A record never moves from one company to another.
-- (The trigger name contains "_00_" so it fires before the other triggers of the table: triggers fire in name order.)
create or replace function app.tenant_id_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed (table %)', tg_table_name using errcode = '42501';
  end if;
  return new;
end
$$;

-- Append-only tables: no UPDATE, no DELETE, no TRUNCATE, for anyone.
create or replace function app.block_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append only: % is not allowed', tg_table_name, tg_op using errcode = '42501';
end
$$;
revoke all on function app.tenant_id_immutable(), app.block_change() from public, anon;

do $immutable$
declare r record;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function app.tenant_id_immutable()', r.relname || '_00_tenant_fixed', r.relname);
  end loop;
end
$immutable$;

-- Activity: the author is stamped from the session, money entries are flagged, and history cannot be rewritten.
create or replace function app.activity_stamp() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() = 'authenticated' then
    if new.by_kind = 'member' then
      new.by_id := app.current_member(new.tenant_id);
    elsif new.by_kind = 'worker' then
      new.by_id := app.current_worker(new.tenant_id);
    end if;
    new.at := pg_catalog.now();
  end if;
  new.money := new.money or new.kind ~ '^(payment|expense)\.' or new.kind = 'worker.paid';
  return new;
end
$$;
revoke all on function app.activity_stamp() from public, anon;
create trigger activity_stamp before insert on public.activity for each row execute function app.activity_stamp();
create trigger activity_append_only before update or delete on public.activity for each row execute function app.block_change();
create trigger activity_no_truncate before truncate on public.activity for each statement execute function app.block_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- Turn row level security on, forced, for every table in public, and start from zero privileges.
-- ---------------------------------------------------------------------------------------------------------------------
do $rls$
declare r record;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('alter table public.%I force row level security', r.relname);
    execute format('revoke all on public.%I from public, anon, authenticated', r.relname);
    execute format('grant select, insert, update, delete on public.%I to service_role', r.relname);
  end loop;
end
$rls$;

-- The service role (server functions only) writes history but cannot rewrite it either.
revoke update, delete on public.activity from service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Policies
-- Reading guide:
--   tenant_id = any ((select app.tenants_can('clients'))::uuid[])        "a company where I hold the clients permission"
--   tenant_id = any ((select app.tenants_can('money', 'delete'))::uuid[]) "a company where I hold BOTH permissions"
--   tenant_id = any ((select app.office_tenants())::uuid[])              "a company where I am owner, manager or staff"
--   worker_id = any ((select app.my_worker_ids())::uuid[])               "a row that belongs to me as a field worker"
-- Every UPDATE policy has the same rule in USING (which rows) and WITH CHECK (what they may become).
-- ---------------------------------------------------------------------------------------------------------------------

-- ---- Platform tables ----

-- industries: reference data, readable by signed-in people. Changed only by migrations and the seed file.
grant select on public.industries to authenticated;
create policy industries_select on public.industries for select to authenticated using (true);

-- tenants: office roles read their company. Only the owner changes it, and only the name, branding and settings.
-- The address (slug), plan, industry and status are changed by VYNTEX through the service role.
-- Workers get the company name and branding from public.my_workspaces() (0007), never this table.
grant select on public.tenants to authenticated;
grant update (name, branding, settings) on public.tenants to authenticated;
create policy tenants_select on public.tenants for select to authenticated
  using (id = any ((select app.office_tenants())::uuid[]));
create policy tenants_update on public.tenants for update to authenticated
  using (id = any ((select app.tenants_can('settings'))::uuid[]))
  with check (id = any ((select app.tenants_can('settings'))::uuid[]));

-- tenant_members: office roles see the team list, everyone sees their own row. Only the owner changes membership.
grant select, insert, update, delete on public.tenant_members to authenticated;
create policy tenant_members_select on public.tenant_members for select to authenticated
  using (user_id = (select auth.uid()) or tenant_id = any ((select app.office_tenants())::uuid[]));
create policy tenant_members_insert on public.tenant_members for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('settings'))::uuid[]));
create policy tenant_members_update on public.tenant_members for update to authenticated
  using (tenant_id = any ((select app.tenants_can('settings'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('settings'))::uuid[]));
create policy tenant_members_delete on public.tenant_members for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('settings'))::uuid[]));

-- demo_requests: no policy at all. Only the service role (which bypasses row level security) can insert or read.

-- ---- Office records: clients, leads, notes, tasks, documents, messages ----

grant select, insert, update, delete on public.clients to authenticated;
create policy clients_select on public.clients for select to authenticated
  using (tenant_id = any ((select app.tenants_can('clients'))::uuid[]));
create policy clients_insert on public.clients for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('clients'))::uuid[]));
create policy clients_update on public.clients for update to authenticated
  using (tenant_id = any ((select app.tenants_can('clients'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('clients'))::uuid[]));
create policy clients_delete on public.clients for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('clients', 'delete'))::uuid[]));

grant select, insert, update, delete on public.leads to authenticated;
create policy leads_select on public.leads for select to authenticated
  using (tenant_id = any ((select app.tenants_can('leads'))::uuid[]));
create policy leads_insert on public.leads for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('leads'))::uuid[]));
create policy leads_update on public.leads for update to authenticated
  using (tenant_id = any ((select app.tenants_can('leads'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('leads'))::uuid[]));
create policy leads_delete on public.leads for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('leads', 'delete'))::uuid[]));

-- notes: office roles read and write, always in their own name. A note is removed by its author, or by a role that may delete.
grant select, insert, update, delete on public.notes to authenticated;
create policy notes_select on public.notes for select to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[]));
create policy notes_insert on public.notes for insert to authenticated
  with check (tenant_id = any ((select app.office_tenants())::uuid[]) and by_member_id is not distinct from app.current_member(tenant_id));
create policy notes_update on public.notes for update to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[]))
  with check (tenant_id = any ((select app.office_tenants())::uuid[]));
create policy notes_delete on public.notes for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('delete'))::uuid[])
    or (tenant_id = any ((select app.office_tenants())::uuid[]) and by_member_id = any ((select app.my_member_ids())::uuid[])));

-- tasks: office roles manage all tasks. A worker reads only tasks assigned to them and marks them done through
-- public.worker_set_task_done (0007), never by updating the table.
grant select, insert, update, delete on public.tasks to authenticated;
create policy tasks_select on public.tasks for select to authenticated
  using (tenant_id = any ((select app.tenants_can('tasks'))::uuid[])
    or assignee_worker_id = any ((select app.my_worker_ids())::uuid[]));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('tasks'))::uuid[]));
create policy tasks_update on public.tasks for update to authenticated
  using (tenant_id = any ((select app.tenants_can('tasks'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('tasks'))::uuid[]));
create policy tasks_delete on public.tasks for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('tasks', 'delete'))::uuid[]));

-- documents: office roles work on the document itself. The e-signature evidence (esign_* columns) is written only by
-- the server, so nobody in the office can record a signature that did not happen.
grant select, delete on public.documents to authenticated;
grant insert (id, tenant_id, kind, number, title, job_id, client_id, status, created, updated, edits) on public.documents to authenticated;
grant update (kind, number, title, client_id, status, updated, edits) on public.documents to authenticated;
create policy documents_select on public.documents for select to authenticated
  using (tenant_id = any ((select app.tenants_can('documents'))::uuid[]));
create policy documents_insert on public.documents for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('documents'))::uuid[]));
create policy documents_update on public.documents for update to authenticated
  using (tenant_id = any ((select app.tenants_can('documents'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('documents'))::uuid[]));
create policy documents_delete on public.documents for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('documents', 'delete'))::uuid[]));

-- messages: office roles prepare and queue messages. Only the server marks one as sent or failed.
grant select, insert, update, delete on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[]));
create policy messages_insert on public.messages for insert to authenticated
  with check (tenant_id = any ((select app.office_tenants())::uuid[]) and status in ('draft', 'queued'));
create policy messages_update on public.messages for update to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[]) and status in ('draft', 'queued'))
  with check (tenant_id = any ((select app.office_tenants())::uuid[]) and status in ('draft', 'queued'));
create policy messages_delete on public.messages for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('delete'))::uuid[]));

-- ---- Jobs ----
-- The base table carries the price, so only roles with "money" touch it (owner and manager; both also hold "jobs").
-- Staff use public.jobs_basic and workers use public.my_jobs (0007), neither of which has the price.

grant select, insert, update, delete on public.jobs to authenticated;
create policy jobs_select on public.jobs for select to authenticated
  using (tenant_id = any ((select app.tenants_can('jobs', 'money'))::uuid[]));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('jobs', 'money'))::uuid[]));
create policy jobs_update on public.jobs for update to authenticated
  using (tenant_id = any ((select app.tenants_can('jobs', 'money'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('jobs', 'money'))::uuid[]));
create policy jobs_delete on public.jobs for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('jobs', 'money', 'delete'))::uuid[]));

-- job_assignments: owner and manager manage them. A worker reads only their own (including their own agreed amount).
grant select, insert, update, delete on public.job_assignments to authenticated;
create policy job_assignments_select on public.job_assignments for select to authenticated
  using (tenant_id = any ((select app.tenants_can('team', 'money'))::uuid[])
    or worker_id = any ((select app.my_worker_ids())::uuid[]));
create policy job_assignments_insert on public.job_assignments for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('team', 'money'))::uuid[]));
create policy job_assignments_update on public.job_assignments for update to authenticated
  using (tenant_id = any ((select app.tenants_can('team', 'money'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('team', 'money'))::uuid[]));
create policy job_assignments_delete on public.job_assignments for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('team', 'money', 'delete'))::uuid[]));

-- work_logs: office roles read and write. A worker reads their own entries and adds entries, as themselves,
-- only for jobs they are assigned to.
grant select, insert, update, delete on public.work_logs to authenticated;
create policy work_logs_select on public.work_logs for select to authenticated
  using (tenant_id = any ((select app.tenants_can('jobs'))::uuid[])
    or worker_id = any ((select app.my_worker_ids())::uuid[]));
create policy work_logs_insert on public.work_logs for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('jobs'))::uuid[])
    or (worker_id = any ((select app.my_worker_ids())::uuid[]) and app.worker_assigned(tenant_id, job_id, worker_id)));
create policy work_logs_update on public.work_logs for update to authenticated
  using (tenant_id = any ((select app.tenants_can('jobs'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('jobs'))::uuid[]));
create policy work_logs_delete on public.work_logs for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('jobs', 'delete'))::uuid[]));

-- ---- Money tables: owner and manager only. Staff get nothing. A worker reads only payments made to them. ----

grant select, insert, update, delete on public.job_expenses to authenticated;
create policy job_expenses_select on public.job_expenses for select to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy job_expenses_insert on public.job_expenses for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy job_expenses_update on public.job_expenses for update to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy job_expenses_delete on public.job_expenses for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('money', 'delete'))::uuid[]));

grant select, insert, update, delete on public.client_payments to authenticated;
create policy client_payments_select on public.client_payments for select to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy client_payments_insert on public.client_payments for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy client_payments_update on public.client_payments for update to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy client_payments_delete on public.client_payments for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('money', 'delete'))::uuid[]));

grant select, insert, update, delete on public.worker_payments to authenticated;
create policy worker_payments_select on public.worker_payments for select to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[])
    or worker_id = any ((select app.my_worker_ids())::uuid[]));
create policy worker_payments_insert on public.worker_payments for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy worker_payments_update on public.worker_payments for update to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('money'))::uuid[]));
create policy worker_payments_delete on public.worker_payments for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('money', 'delete'))::uuid[]));

-- ---- workers ----
-- The base table has pay rates and compliance data, so only roles with "team" touch it (owner, manager).
-- Staff use public.worker_directory and a worker uses public.my_worker_profile (0007).
-- Column privileges are narrowed in 0005 when the encrypted tax ID column is added.

grant select, insert, update, delete on public.workers to authenticated;
create policy workers_select on public.workers for select to authenticated
  using (tenant_id = any ((select app.tenants_can('team'))::uuid[]));
create policy workers_insert on public.workers for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('team'))::uuid[]));
create policy workers_update on public.workers for update to authenticated
  using (tenant_id = any ((select app.tenants_can('team'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('team'))::uuid[]));
create policy workers_delete on public.workers for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('team', 'delete'))::uuid[]));

-- ---- activity: append only. Office roles read it, except entries with amounts, which need "money". ----

grant select, insert on public.activity to authenticated;
create policy activity_select on public.activity for select to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[])
    and (not money or tenant_id = any ((select app.tenants_can('money'))::uuid[])));
create policy activity_insert on public.activity for insert to authenticated
  with check (tenant_id = any ((select app.office_tenants())::uuid[]) and by_kind in ('member', 'automation'));

-- ---- Automations: owner and manager. Office staff can record that a rule ran while they worked, but cannot read the log. ----

grant select, insert, update, delete on public.automation_settings to authenticated;
create policy automation_settings_select on public.automation_settings for select to authenticated
  using (tenant_id = any ((select app.tenants_can('automations'))::uuid[]));
create policy automation_settings_insert on public.automation_settings for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('automations'))::uuid[]));
create policy automation_settings_update on public.automation_settings for update to authenticated
  using (tenant_id = any ((select app.tenants_can('automations'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('automations'))::uuid[]));
create policy automation_settings_delete on public.automation_settings for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('automations'))::uuid[]));

grant select, insert on public.automation_runs to authenticated;
create policy automation_runs_select on public.automation_runs for select to authenticated
  using (tenant_id = any ((select app.tenants_can('automations'))::uuid[]));
create policy automation_runs_insert on public.automation_runs for insert to authenticated
  with check (tenant_id = any ((select app.office_tenants())::uuid[]));

-- ---- consent_records ----
-- Owner and manager read them. Consent to share 1099 data can only be recorded by the owner, in person.
-- Other kinds can be recorded by office roles. Nothing is updated or deleted here; revoking goes through 0006.

grant select, insert on public.consent_records to authenticated;
create policy consent_records_select on public.consent_records for select to authenticated
  using (tenant_id = any ((select app.tenants_can('compliance'))::uuid[]));
create policy consent_records_insert on public.consent_records for insert to authenticated
  with check (
    case when kind = 'share_1099_data'
      then tenant_id = any ((select app.tenants_with_role('owner'))::uuid[])
      else tenant_id = any ((select app.office_tenants())::uuid[])
    end
  );
