-- 0007 Role views and the worker portal
-- Row level security decides which ROWS a person sees. Where a role may see a row but not all of its COLUMNS, the app
-- reads a view instead of the base table. Every view here is a security-barrier view owned by the migration role:
-- its WHERE clause is the access rule, it is evaluated before anything the caller adds to the query, and the columns
-- it does not list simply do not exist for the caller.
--
--   who            reads                          instead of           because
--   office staff   public.jobs_basic              public.jobs          no price, no payment terms
--   office staff   public.job_assignments_basic   job_assignments      no agreed amounts
--   office staff   public.worker_directory        public.workers       no pay rate, no compliance data
--   worker         public.my_jobs                 public.jobs          only assigned jobs, no price
--   worker         public.my_worker_profile       public.workers       only their own row, safe columns
--   everyone       public.my_workspaces()         public.tenants       the companies they belong to
--
-- Supabase's database linter reports these as "security definer views". That is intended here; see docs/SECURITY.md.

-- Jobs without money columns. Office roles can read, create and edit through it (new jobs start with price 0;
-- the price is set on public.jobs by a role with "money"). No delete.
create view public.jobs_basic with (security_barrier = true) as
  select j.id, j.tenant_id, j.number, j.name, j.client_id, j.address, j.type, j.status, j.start_date, j.end_date,
         j.repeat, j.scope, j.manager_id, j.created, j.lead_id, j.created_at, j.updated_at
  from public.jobs j
  where j.tenant_id = any ((select app.tenants_can('jobs'))::uuid[])
  with cascaded check option;

-- Who is assigned to what, without amounts. Read only.
create view public.job_assignments_basic with (security_barrier = true) as
  select a.id, a.tenant_id, a.job_id, a.worker_id, a.scope, a.status, a.created_at, a.updated_at
  from public.job_assignments a
  where a.tenant_id = any ((select app.tenants_can('jobs'))::uuid[]);

-- Names and contact details of workers, for assigning tasks and calling the crew. Read only.
create view public.worker_directory with (security_barrier = true) as
  select w.id, w.tenant_id, w.name, w.trade, w.phone, w.email, w.active
  from public.workers w
  where w.tenant_id = any ((select app.office_tenants())::uuid[]);

-- Worker portal: the jobs the signed-in worker is assigned to. No price, no payment terms, no client record.
create view public.my_jobs with (security_barrier = true) as
  select j.id, j.tenant_id, j.number, j.name, j.address, j.type, j.status, j.start_date, j.end_date, j.repeat
  from public.jobs j
  where exists (
    select 1 from public.job_assignments a
    where a.tenant_id = j.tenant_id and a.job_id = j.id
      and a.worker_id = any ((select app.my_worker_ids())::uuid[])
  );

-- Worker portal: the signed-in worker's own record. No pay rate, no tax ID.
create view public.my_worker_profile with (security_barrier = true) as
  select w.id, w.tenant_id, w.name, w.trade, w.phone, w.email, w.w9, w.w9_date, w.coi_exp, w.insurer, w.active, w.has_tax_id
  from public.workers w
  where w.id = any ((select app.my_worker_ids())::uuid[]);

revoke all on public.jobs_basic, public.job_assignments_basic, public.worker_directory, public.my_jobs, public.my_worker_profile
  from public, anon, authenticated, service_role;
grant select, insert, update on public.jobs_basic to authenticated;
grant select on public.job_assignments_basic, public.worker_directory, public.my_jobs, public.my_worker_profile to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- public.my_workspaces(): the companies the signed-in person belongs to, with their role in each.
-- This is how the app turns the address /<company-slug> into a company after sign-in.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.my_workspaces()
returns table (
  tenant_id uuid,
  slug text,
  name text,
  industry_id text,
  plan_id text,
  status text,
  branding jsonb,
  role text,
  member_id uuid,
  worker_id uuid
)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.slug, t.name, t.industry_id, t.plan_id, t.status, t.branding, m.role, m.id, m.worker_id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and t.status <> 'closed'
  order by t.name
$$;
revoke all on function public.my_workspaces() from public, anon;
grant execute on function public.my_workspaces() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- public.worker_set_task_done(): a worker marks one of their own tasks done (or not done). Nothing else about the
-- task can be changed this way, and tasks assigned to anyone else are refused.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.worker_set_task_done(p_task uuid, p_done boolean default true) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_assignee uuid;
begin
  select t.tenant_id, t.assignee_worker_id into v_tenant, v_assignee from public.tasks t where t.id = p_task;
  if v_tenant is null or v_assignee is null or v_assignee is distinct from app.current_worker(v_tenant) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.tasks
     set status = case when coalesce(p_done, true) then 'done' else 'todo' end,
         done_at = case when coalesce(p_done, true) then current_date else null end
   where id = p_task and tenant_id = v_tenant;
end
$$;
revoke all on function public.worker_set_task_done(uuid, boolean) from public, anon;
grant execute on function public.worker_set_task_done(uuid, boolean) to authenticated;
