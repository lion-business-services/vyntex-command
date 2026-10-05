-- NOVA CRM: security containment. Run once on the live NOVA database (Supabase project "Nova-crm").
-- It changes permissions and three definitions only. No client data is read or changed.
-- Undo with 0020_security_containment_rollback.sql in this folder.
--
-- IN: Supabase Dashboard, project Nova-crm, SQL Editor, New query, paste this whole file, Run.
-- Then: Authentication, Sign In / Providers, Email: turn "Allow new users to sign up" OFF.

-- 1. Database functions: remove execution by callers with no login. Signed-in staff keep access exactly as before.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- The public review page is the only screen that works without a login. It needs these two.
grant execute on function public.get_review_request_by_token(text) to anon;
grant execute on function public.submit_review(text, integer, text) to anon;

-- 2. New accounts start as read only. The owner promotes real staff on the Team page.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_count int;
  assigned_role public.user_role;
begin
  select count(*) into user_count from public.profiles;
  if user_count = 0 then assigned_role := 'owner'; else assigned_role := 'read_only'; end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''), assigned_role);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon;

-- 3. The list of clients a person cannot see is for working staff only (associate and above).
create or replace function public.inaccessible_clients_for_me()
returns table (id uuid, display_name text, office_id uuid, office_name text, office_code text)
language sql stable security definer
set search_path = public
as $$
  select c.id,
         coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.business_name, 'Unnamed client') as display_name,
         c.office_id, o.name as office_name, o.code as office_code
  from public.clients c
  left join public.offices o on o.id = c.office_id
  where public.has_edit_role() and not public.can_view_client(c.id)
  order by display_name;
$$;
revoke all on function public.inaccessible_clients_for_me() from public, anon;
grant execute on function public.inaccessible_clients_for_me() to authenticated, service_role;

-- 4. Price tiers: everyone signed in can read them; only senior staff and the owner can change them.
drop policy if exists service_variations_write on public.service_variations;
create policy service_variations_insert on public.service_variations for insert to authenticated with check (public.has_senior_role());
create policy service_variations_update on public.service_variations for update to authenticated using (public.has_senior_role()) with check (public.has_senior_role());
create policy service_variations_delete on public.service_variations for delete to authenticated using (public.has_owner_role());

-- Check: the first column must be false, the second true.
select has_function_privilege('anon', 'public.inaccessible_clients_for_me()', 'execute') as open_without_login,
       has_function_privilege('authenticated', 'public.inaccessible_clients_for_me()', 'execute') as staff_can_use;
