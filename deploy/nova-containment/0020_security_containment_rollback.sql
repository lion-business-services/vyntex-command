-- Undo of 0020_security_containment.sql. Restores the state of 2026-10-03 before the change.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function %s to public, anon, authenticated, service_role', r.sig);
  end loop;
end $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare user_count int; assigned_role public.user_role;
begin
  select count(*) into user_count from public.profiles;
  if user_count = 0 then assigned_role := 'owner'; else assigned_role := 'associate'; end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''), assigned_role);
  return new;
end; $$;
create or replace function public.inaccessible_clients_for_me()
returns table (id uuid, display_name text, office_id uuid, office_name text, office_code text)
language sql stable security definer set search_path = public as $$
  select c.id, coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.business_name, 'Unnamed client') as display_name,
         c.office_id, o.name as office_name, o.code as office_code
  from public.clients c left join public.offices o on o.id = c.office_id
  where not public.can_view_client(c.id) order by display_name;
$$;
drop policy if exists service_variations_insert on public.service_variations;
drop policy if exists service_variations_update on public.service_variations;
drop policy if exists service_variations_delete on public.service_variations;
create policy service_variations_write on public.service_variations for all using (auth.role() = 'authenticated');
