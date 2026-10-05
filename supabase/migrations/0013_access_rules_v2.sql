-- 0013 Access rules, second pass
-- What changes on top of 0003:
--   * every write rule now also asks for the "write" capability, so the read-only role can look and change nothing
--   * the capabilities introduced in 0010 take over where a role name or a neighbouring capability stood in:
--       membership -> users        messages -> comms        audit log -> audit        company configuration -> config
--   * office scope (ported from the earlier internal system): a client with an office is seen by the people of that
--     office, by anyone holding "allClients", and by a person granted access to that one client. The same scope
--     follows the client into its people, notes, jobs, tasks, documents and messages. Leads follow the same rule;
--     the person who owns a lead always sees it.
--   * rules for the tables created in 0012
--   * guards that hold for a signed-in person whatever a policy says: delivery states of messages, who may change
--     an owner, who may change which part of the company record
--   * audit triggers for clients, leads and the other records the brief (section 60) asks to be tracked
--
-- Policies are changed with ALTER POLICY: same names as in 0003, new rule. Reading guide as in 0003:
--   tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[])   "a company where I hold BOTH capabilities"

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers for office scope. Once per statement, like the helpers of 0003.
-- ---------------------------------------------------------------------------------------------------------------------

-- Offices the signed-in person works from, across their companies (office ids are unique on their own).
create or replace function app.my_office_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct o.office_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  cross join lateral pg_catalog.unnest(m.office_ids) as o(office_id)
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker' and t.status <> 'closed'
$$;

-- Clients the signed-in person was granted access to, one by one (AccessGrant in src/domain/types.ts).
-- The grants table belongs to the module migrations. Until it exists this returns nothing; the migration that
-- creates it redefines this function (same name, SECURITY DEFINER, fixed search_path) to return the client ids of the
-- caller's grants that have not expired. Every scope rule below already calls it.
create or replace function app.granted_client_ids() returns uuid[]
language sql stable
set search_path = ''
as $$ select '{}'::uuid[] $$;

-- Clients the signed-in person may NOT open: the client has an office, the person does not hold "allClients" in that
-- company, does not work from that office, and holds no grant for that client. Usually empty.
-- SECURITY DEFINER: it has to look at the very rows it hides.
-- The policies use it as   client_id not in (select app.hidden_clients())   : the function runs once per statement
-- and the database turns the result into a hash table, so the test costs the same whether nothing is hidden or
-- half the clients of a large company are.
create or replace function app.hidden_clients() returns setof uuid
language sql stable security definer rows 100
set search_path = ''
as $$
  select c.id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  join public.clients c on c.tenant_id = m.tenant_id and c.office_id is not null
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker' and t.status <> 'closed'
    and not ('allClients' = any (app.permissions_for(t.industry_id, t.config, m.role)))
    and not (c.office_id = any (m.office_ids))
    and not (c.id = any (app.granted_client_ids()))
$$;

-- The same, as one array (for the functions that list or mark hidden clients).
create or replace function app.hidden_client_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$ select coalesce(pg_catalog.array_agg(h.id), '{}'::uuid[]) from app.hidden_clients() as h(id) $$;

revoke all on function app.my_office_ids(), app.granted_client_ids(), app.hidden_clients(), app.hidden_client_ids() from public, anon;
grant execute on function app.my_office_ids(), app.granted_client_ids(), app.hidden_clients(), app.hidden_client_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------------------------------------------------

-- tenants: "settings" changes the name, branding and settings; "config" changes the configuration. Which columns a
-- person may change with which capability is decided by app.tenants_guard below; the policy only opens the row.
grant update (legal_name, address, website, timezone, config, extra) on public.tenants to authenticated;
alter policy tenants_update on public.tenants
  using (id = any ((select app.tenants_can('settings', 'write'))::uuid[]) or id = any ((select app.tenants_can('config', 'write'))::uuid[]))
  with check (id = any ((select app.tenants_can('settings', 'write'))::uuid[]) or id = any ((select app.tenants_can('config', 'write'))::uuid[]));

create or replace function app.tenants_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() <> 'authenticated' then return new; end if;
  if (new.name, new.branding, new.settings, new.legal_name, new.address, new.website, new.timezone, new.extra)
     is distinct from (old.name, old.branding, old.settings, old.legal_name, old.address, old.website, old.timezone, old.extra)
     and not app.can(old.id, 'settings') then
    raise exception 'Changing the company record needs the settings capability' using errcode = '42501';
  end if;
  if new.config is distinct from old.config then
    if not app.can(old.id, 'config') then
      raise exception 'Changing the company configuration needs the config capability' using errcode = '42501';
    end if;
    -- What each role may do, and the sign-in rules, are the owner's alone: otherwise a person trusted with the
    -- configuration could hand themselves every capability.
    if (new.config -> 'roles' is distinct from old.config -> 'roles' or new.config -> 'security' is distinct from old.config -> 'security')
       and app.member_role(old.id) is distinct from 'owner' then
      raise exception 'Only an owner changes what roles may do or the sign-in rules' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.tenants_guard() from public, anon, authenticated, service_role;
create trigger tenants_guard before update on public.tenants for each row execute function app.tenants_guard();

-- tenant_members: managing people is the "users" capability. An owner row is only ever touched by an owner.
alter policy tenant_members_insert on public.tenant_members
  with check (tenant_id = any ((select app.tenants_can('users', 'write'))::uuid[]));
alter policy tenant_members_update on public.tenant_members
  using (tenant_id = any ((select app.tenants_can('users', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('users', 'write'))::uuid[]));
alter policy tenant_members_delete on public.tenant_members
  using (tenant_id = any ((select app.tenants_can('users', 'write'))::uuid[]));

create or replace function app.members_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if app.jwt_role() = 'authenticated'
     and ((tg_op <> 'DELETE' and new.role = 'owner') or (tg_op <> 'INSERT' and old.role = 'owner'))
     and app.member_role(v_tenant) is distinct from 'owner' then
    raise exception 'Only an owner adds, changes or removes an owner' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function app.members_guard() from public, anon, authenticated, service_role;
create trigger tenant_members_guard before insert or update or delete on public.tenant_members
  for each row execute function app.members_guard();

-- audit log: readable with the "audit" capability (the owner by default).
alter policy audit_log_select on public.audit_log
  using (tenant_id = any ((select app.tenants_can('audit'))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------
-- Office records
-- ---------------------------------------------------------------------------------------------------------------------

-- clients
alter policy clients_select on public.clients
  using (tenant_id = any ((select app.tenants_can('clients'))::uuid[])
    and (office_id is null
      or office_id = any ((select app.my_office_ids())::uuid[])
      or tenant_id = any ((select app.tenants_can('allClients'))::uuid[])
      or id = any ((select app.granted_client_ids())::uuid[])));
alter policy clients_insert on public.clients
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]));
alter policy clients_update on public.clients
  using (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and id not in (select app.hidden_clients()))
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]));
alter policy clients_delete on public.clients
  using (tenant_id = any ((select app.tenants_can('clients', 'write', 'delete'))::uuid[]) and id not in (select app.hidden_clients()));

-- leads
alter policy leads_select on public.leads
  using (tenant_id = any ((select app.tenants_can('leads'))::uuid[])
    and (office_id is null
      or office_id = any ((select app.my_office_ids())::uuid[])
      or owner_id = any ((select app.my_member_ids())::uuid[])
      or tenant_id = any ((select app.tenants_can('allClients'))::uuid[])));
alter policy leads_insert on public.leads
  with check (tenant_id = any ((select app.tenants_can('leads', 'write'))::uuid[]));
alter policy leads_update on public.leads
  using (tenant_id = any ((select app.tenants_can('leads', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('leads', 'write'))::uuid[]));
alter policy leads_delete on public.leads
  using (tenant_id = any ((select app.tenants_can('leads', 'write', 'delete'))::uuid[]));

-- notes
alter policy notes_select on public.notes
  using (tenant_id = any ((select app.office_tenants())::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
alter policy notes_insert on public.notes
  with check (tenant_id = any ((select app.tenants_can('write'))::uuid[]) and by_member_id is not distinct from app.current_member(tenant_id));
alter policy notes_update on public.notes
  using (tenant_id = any ((select app.tenants_can('write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('write'))::uuid[]));
alter policy notes_delete on public.notes
  using (tenant_id = any ((select app.tenants_can('write', 'delete'))::uuid[])
    or (tenant_id = any ((select app.tenants_can('write'))::uuid[]) and by_member_id = any ((select app.my_member_ids())::uuid[])));

-- tasks
alter policy tasks_select on public.tasks
  using ((tenant_id = any ((select app.tenants_can('tasks'))::uuid[])
      and (client_id is null or client_id not in (select app.hidden_clients())))
    or assignee_worker_id = any ((select app.my_worker_ids())::uuid[]));
alter policy tasks_insert on public.tasks
  with check (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]));
alter policy tasks_update on public.tasks
  using (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]));
alter policy tasks_delete on public.tasks
  using (tenant_id = any ((select app.tenants_can('tasks', 'write', 'delete'))::uuid[]));

-- documents (the e-signature evidence columns stay closed to every signed-in person, as in 0003)
grant insert (template_id, envelope_id, file, versions, folder, lead_id, extra) on public.documents to authenticated;
grant update (job_id, created, template_id, envelope_id, file, versions, folder, lead_id, extra) on public.documents to authenticated;
alter policy documents_select on public.documents
  using (tenant_id = any ((select app.tenants_can('documents'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
alter policy documents_insert on public.documents
  with check (tenant_id = any ((select app.tenants_can('documents', 'write'))::uuid[]));
alter policy documents_update on public.documents
  using (tenant_id = any ((select app.tenants_can('documents', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('documents', 'write'))::uuid[]));
alter policy documents_delete on public.documents
  using (tenant_id = any ((select app.tenants_can('documents', 'write', 'delete'))::uuid[]));

-- messages: read and written with "comms". A signed-in person only ever writes a draft (or "demo", the state a
-- sample workspace uses); every delivery state is written by the server. See app.messages_guard below.
alter policy messages_select on public.messages
  using (tenant_id = any ((select app.tenants_can('comms'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
alter policy messages_insert on public.messages
  with check (tenant_id = any ((select app.tenants_can('comms', 'write'))::uuid[]) and status in ('draft', 'demo'));
alter policy messages_update on public.messages
  using (tenant_id = any ((select app.tenants_can('comms', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('comms', 'write'))::uuid[]));
alter policy messages_delete on public.messages
  using (tenant_id = any ((select app.tenants_can('comms', 'write', 'delete'))::uuid[]));

create or replace function app.messages_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'demo') or new.dir = 'in' or new.provider is not null or new.external_id is not null or new.error is not null then
      raise exception 'Only the server records a message as queued, sent, delivered, failed or received' using errcode = '42501';
    end if;
    -- the author is the person signed in, whoever the row names
    if new.by_member_id is not null then new.by_member_id := app.current_member(new.tenant_id); end if;
    return new;
  end if;
  if old.status in ('draft', 'demo') then
    if new.status not in ('draft', 'demo')
       or (new.dir, new.provider, new.external_id, new.error, new.by_member_id) is distinct from (old.dir, old.provider, old.external_id, old.error, old.by_member_id) then
      raise exception 'Only the server records a message as queued, sent, delivered, failed or received' using errcode = '42501';
    end if;
  elsif (pg_catalog.to_jsonb(new) - array['read', 'updated_at']) is distinct from (pg_catalog.to_jsonb(old) - array['read', 'updated_at']) then
    -- once a message left (or arrived) it is a record of what happened: a person can mark it read, nothing else
    raise exception 'A message that was queued, sent or received can only be marked as read' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.messages_guard() from public, anon, authenticated, service_role;
create trigger messages_guard before insert or update on public.messages for each row execute function app.messages_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- Jobs and their parts
-- ---------------------------------------------------------------------------------------------------------------------
alter policy jobs_select on public.jobs
  using (tenant_id = any ((select app.tenants_can('jobs', 'money'))::uuid[]) and client_id not in (select app.hidden_clients()));
alter policy jobs_insert on public.jobs
  with check (tenant_id = any ((select app.tenants_can('jobs', 'money', 'write'))::uuid[]));
alter policy jobs_update on public.jobs
  using (tenant_id = any ((select app.tenants_can('jobs', 'money', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('jobs', 'money', 'write'))::uuid[]));
alter policy jobs_delete on public.jobs
  using (tenant_id = any ((select app.tenants_can('jobs', 'money', 'write', 'delete'))::uuid[]));

-- The staff view of jobs (0007) lets office roles write through it, and a view has one rule for reading and writing.
-- So the "write" capability is checked on the table itself, for every office member, whichever door they used.
-- (Someone who is not an office member of that company is not this guard's business: the policy or the view's own
-- rule refuses them a moment later, with the same answer as before.)
create or replace function app.jobs_write_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() = 'authenticated' and app.is_office(new.tenant_id) and not app.can(new.tenant_id, 'write') then
    raise exception 'Changing a job needs the write capability' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.jobs_write_guard() from public, anon, authenticated, service_role;
create trigger jobs_write_guard before insert or update on public.jobs for each row execute function app.jobs_write_guard();

-- The staff view again, now with office scope (same columns as in 0012).
create or replace view public.jobs_basic with (security_barrier = true) as
  select j.id, j.tenant_id, j.number, j.name, j.client_id, j.address, j.type, j.status, j.start_date, j.end_date,
         j.repeat, j.scope, j.manager_id, j.created, j.lead_id, j.created_at, j.updated_at,
         j.service_id, j.tier_id, j.period, j.parent_id, j.office_id, j.extra
  from public.jobs j
  where j.tenant_id = any ((select app.tenants_can('jobs'))::uuid[])
    and j.client_id not in (select app.hidden_clients())
  with cascaded check option;

alter policy job_assignments_insert on public.job_assignments
  with check (tenant_id = any ((select app.tenants_can('team', 'money', 'write'))::uuid[]));
alter policy job_assignments_update on public.job_assignments
  using (tenant_id = any ((select app.tenants_can('team', 'money', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('team', 'money', 'write'))::uuid[]));
alter policy job_assignments_delete on public.job_assignments
  using (tenant_id = any ((select app.tenants_can('team', 'money', 'write', 'delete'))::uuid[]));

alter policy work_logs_insert on public.work_logs
  with check (tenant_id = any ((select app.tenants_can('jobs', 'write'))::uuid[])
    or (worker_id = any ((select app.my_worker_ids())::uuid[]) and app.worker_assigned(tenant_id, job_id, worker_id)));
alter policy work_logs_update on public.work_logs
  using (tenant_id = any ((select app.tenants_can('jobs', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('jobs', 'write'))::uuid[]));
alter policy work_logs_delete on public.work_logs
  using (tenant_id = any ((select app.tenants_can('jobs', 'write', 'delete'))::uuid[]));

-- Money tables
alter policy job_expenses_insert on public.job_expenses
  with check (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]));
alter policy job_expenses_update on public.job_expenses
  using (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]));
alter policy job_expenses_delete on public.job_expenses
  using (tenant_id = any ((select app.tenants_can('money', 'write', 'delete'))::uuid[]));

alter policy client_payments_insert on public.client_payments
  with check (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]));
alter policy client_payments_update on public.client_payments
  using (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]));
alter policy client_payments_delete on public.client_payments
  using (tenant_id = any ((select app.tenants_can('money', 'write', 'delete'))::uuid[]));

alter policy worker_payments_insert on public.worker_payments
  with check (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]));
alter policy worker_payments_update on public.worker_payments
  using (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('money', 'write'))::uuid[]));
alter policy worker_payments_delete on public.worker_payments
  using (tenant_id = any ((select app.tenants_can('money', 'write', 'delete'))::uuid[]));

-- workers (the column list of 0005 gains "extra"; the encrypted column stays closed)
grant select (extra), insert (extra), update (extra) on public.workers to authenticated;
alter policy workers_insert on public.workers
  with check (tenant_id = any ((select app.tenants_can('team', 'write'))::uuid[]));
alter policy workers_update on public.workers
  using (tenant_id = any ((select app.tenants_can('team', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('team', 'write'))::uuid[]));
alter policy workers_delete on public.workers
  using (tenant_id = any ((select app.tenants_can('team', 'write', 'delete'))::uuid[]));

-- activity, automations, consent
alter policy activity_insert on public.activity
  with check (tenant_id = any ((select app.tenants_can('write'))::uuid[]) and by_kind in ('member', 'automation'));

alter policy automation_settings_insert on public.automation_settings
  with check (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]));
alter policy automation_settings_update on public.automation_settings
  using (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]));
alter policy automation_settings_delete on public.automation_settings
  using (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]));
alter policy automation_runs_insert on public.automation_runs
  with check (tenant_id = any ((select app.tenants_can('write'))::uuid[]));

alter policy consent_records_insert on public.consent_records
  with check (
    case when kind = 'share_1099_data'
      then tenant_id = any ((select app.tenants_with_role('owner'))::uuid[])
      else tenant_id = any ((select app.tenants_can('write'))::uuid[])
    end
  );

-- Worker documents in storage (0008): uploading, replacing and deleting are writes.
alter policy worker_documents_office_insert on storage.objects
  with check (
    bucket_id = 'worker-documents'
    and app.path_uuid(name, 1) = any ((select app.tenants_can('team', 'write'))::uuid[])
    and app.path_uuid(name, 2) is not null
  );
alter policy worker_documents_office_update on storage.objects
  using (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team', 'write'))::uuid[]))
  with check (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team', 'write'))::uuid[]) and app.path_uuid(name, 2) is not null);
alter policy worker_documents_office_delete on storage.objects
  using (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team', 'write', 'delete'))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------
-- The tables created in 0012: row level security on, forced, and zero privileges to start from
-- ---------------------------------------------------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['client_people', 'client_secrets', 'lead_handoffs', 'lead_routing', 'task_comments', 'member_state', 'ws_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    if t <> 'client_secrets' then
      execute format('grant select, insert, update, delete on public.%I to service_role', t);
    end if;
  end loop;
end
$rls$;

-- client_secrets: no grant and no policy, for anyone. See 0012.

-- client_people: follows the client. Removing a person from the list is an edit of the client, not a deletion.
grant select, insert, update, delete on public.client_people to authenticated;
create policy client_people_select on public.client_people for select to authenticated
  using (tenant_id = any ((select app.tenants_can('clients'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy client_people_insert on public.client_people for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy client_people_update on public.client_people for update to authenticated
  using (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()))
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy client_people_delete on public.client_people for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));

-- Stamps the author column named in the trigger argument with the signed-in member, on the way in.
-- What the browser sent in that column is ignored: nobody writes in someone else's name.
create or replace function app.stamp_member() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() = 'authenticated' then
    new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object(tg_argv[0], app.current_member(new.tenant_id)));
  end if;
  return new;
end
$$;
revoke all on function app.stamp_member() from public, anon, authenticated, service_role;

-- lead_handoffs: append only. A person records a handoff in their own name; the rotation records one as 'automation'.
grant select, insert on public.lead_handoffs to authenticated;
revoke update, delete on public.lead_handoffs from service_role;
create policy lead_handoffs_select on public.lead_handoffs for select to authenticated
  using (tenant_id = any ((select app.tenants_can('leads'))::uuid[]));
create policy lead_handoffs_insert on public.lead_handoffs for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('leads', 'write'))::uuid[]) and by_kind in ('member', 'automation'));

create or replace function app.lead_handoffs_stamp() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() = 'authenticated' then
    new.by_member_id := case when new.by_kind = 'member' then app.current_member(new.tenant_id) end;
  end if;
  return new;
end
$$;
revoke all on function app.lead_handoffs_stamp() from public, anon, authenticated, service_role;
create trigger lead_handoffs_stamp before insert on public.lead_handoffs for each row execute function app.lead_handoffs_stamp();
-- (no DELETE trigger: the rows go when their lead is deleted, through the foreign key, and no role may delete them otherwise)
create trigger lead_handoffs_append_only before update on public.lead_handoffs for each row execute function app.block_change();
create trigger lead_handoffs_no_truncate before truncate on public.lead_handoffs for each statement execute function app.block_change();

-- lead_routing: read by everyone who works leads, changed with "assignLeads". The turn (cursor, turns,
-- last_member_id) is written only by public.lead_assign_next, so an old copy of the settings can never rewind it.
grant select on public.lead_routing to authenticated;
grant insert (id, tenant_id, mode, pool, exclude, skip_away, fallback_id, extra) on public.lead_routing to authenticated;
grant update (mode, pool, exclude, skip_away, fallback_id, extra) on public.lead_routing to authenticated;
create policy lead_routing_select on public.lead_routing for select to authenticated
  using (tenant_id = any ((select app.tenants_can('leads'))::uuid[]));
create policy lead_routing_insert on public.lead_routing for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('assignLeads', 'write'))::uuid[]));
create policy lead_routing_update on public.lead_routing for update to authenticated
  using (tenant_id = any ((select app.tenants_can('assignLeads', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('assignLeads', 'write'))::uuid[]));

-- task_comments: written in one's own name; edited by the author; removed by the author or a role that may delete.
grant select, insert, update, delete on public.task_comments to authenticated;
create policy task_comments_select on public.task_comments for select to authenticated
  using (tenant_id = any ((select app.tenants_can('tasks'))::uuid[]));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]));
create policy task_comments_update on public.task_comments for update to authenticated
  using (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]) and by_member_id = any ((select app.my_member_ids())::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]));
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('tasks', 'write', 'delete'))::uuid[])
    or (tenant_id = any ((select app.tenants_can('tasks', 'write'))::uuid[]) and by_member_id = any ((select app.my_member_ids())::uuid[])));
create trigger task_comments_stamp before insert on public.task_comments for each row execute function app.stamp_member('by_member_id');

-- member_state: a person's own row, in a company they belong to. No capability is asked: dismissing a notification is
-- not a change to the company's records, so the read-only role can do it too.
grant select, insert, update on public.member_state to authenticated;
create policy member_state_select on public.member_state for select to authenticated
  using (member_id = any ((select app.my_member_ids())::uuid[]));
create policy member_state_insert on public.member_state for insert to authenticated
  with check (member_id = any ((select app.my_member_ids())::uuid[]));
create policy member_state_update on public.member_state for update to authenticated
  using (member_id = any ((select app.my_member_ids())::uuid[]))
  with check (member_id = any ((select app.my_member_ids())::uuid[]));

-- ws_requests: a person sees and writes only their own idempotency keys, in a company where they are office.
grant select, insert on public.ws_requests to authenticated;
grant update (result) on public.ws_requests to authenticated;
create policy ws_requests_select on public.ws_requests for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id = any ((select app.office_tenants())::uuid[]));
create policy ws_requests_insert on public.ws_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id = any ((select app.office_tenants())::uuid[]));
create policy ws_requests_update on public.ws_requests for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id = any ((select app.office_tenants())::uuid[]))
  with check (user_id = (select auth.uid()) and tenant_id = any ((select app.office_tenants())::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------
-- Audit (the brief, section 60): client and lead changes, people of a client, the tax ID record (never its value),
-- handoffs, routing, removed tasks, notes and comments, messages, automation switches.
-- Contact details, wording and the last four digits are replaced with "[redacted]" as in 0004.
-- ---------------------------------------------------------------------------------------------------------------------
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function app.audit_row('phone', 'email', 'addresses', 'whatsapp', 'birthday', 'social', 'tax_id_last4');
create trigger leads_audit after insert or update or delete on public.leads
  for each row execute function app.audit_row('phone', 'email', 'address');
create trigger client_people_audit after insert or update or delete on public.client_people
  for each row execute function app.audit_row('phone', 'email');
create trigger client_secrets_audit after insert or update or delete on public.client_secrets
  for each row execute function app.audit_row('tax_id_enc', 'last4');
create trigger lead_handoffs_audit after insert on public.lead_handoffs
  for each row execute function app.audit_row();
create trigger lead_routing_audit after insert or update of mode, pool, exclude, skip_away, fallback_id on public.lead_routing
  for each row execute function app.audit_row();
create trigger tasks_audit_delete after delete on public.tasks
  for each row execute function app.audit_row('description');
create trigger notes_audit_delete after delete on public.notes
  for each row execute function app.audit_row('text');
create trigger task_comments_audit_delete after delete on public.task_comments
  for each row execute function app.audit_row('text');
create trigger messages_audit after insert or update or delete on public.messages
  for each row execute function app.audit_row('recipient', 'sender', 'subject', 'body', 'attachments');
create trigger automation_settings_audit after insert or update or delete on public.automation_settings
  for each row execute function app.audit_row();
