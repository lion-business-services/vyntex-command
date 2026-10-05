-- 0017 Lead rotation, duplicate search, and a person's own profile
-- Three small protected functions the gateway cannot express as a row change:
--   lead_assign_next          whose turn is it (the brief, section 8). Locks the routing row, so two leads arriving at
--                             the same moment are given to two different people.
--   client_find_duplicate     "is this person already a client?" (section 90). Reports matches; the person decides.
--   member_update_profile     a person edits their own profile; someone who manages people edits anyone's.

-- ---------------------------------------------------------------------------------------------------------------------
-- The rotation
-- ---------------------------------------------------------------------------------------------------------------------

-- May this member be given a lead today? Active, an office role that can work leads, not excluded, not opted out
-- of the pool, and (when the company skips people who are away) not away on that day.
create or replace function app.lead_pool_eligible(p_tenant uuid, p_member uuid, p_exclude uuid[], p_skip_away boolean, p_today date) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant and m.id = p_member and m.status = 'active'
      and array['leads', 'write']::text[] <@ app.permissions_for(t.industry_id, t.config, m.role)
      and m.id <> all (p_exclude)
      and coalesce(m.in_lead_pool, true)
      and not (p_skip_away and m.away_from is not null and p_today between m.away_from and m.away_to))
$$;

-- Takes the next turn. Returns the member and how they were chosen: 'round_robin', 'fallback', or NULL when nobody
-- can take the lead (manual assignment, an empty pool, everyone away and no fallback).
-- The SELECT ... FOR UPDATE on the company's routing row is the lock: a second call waits until the first one has
-- committed and then reads the cursor the first one left.
create or replace function app.lead_next_turn(p_tenant uuid, out member_id uuid, out how text)
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.lead_routing;
  v_today date;
  n integer;
  idx integer;
  v_candidate uuid;
begin
  select lr.* into r from public.lead_routing lr where lr.tenant_id = p_tenant for update;
  if not found then return; end if;
  -- "today" in the company's own time zone, so someone away until Friday is skipped until Friday ends there
  select (pg_catalog.now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today from public.tenants t where t.id = p_tenant;

  n := pg_catalog.cardinality(r.pool);
  if r.mode = 'round_robin' and n > 0 then
    for i in 0 .. n - 1 loop
      idx := (r.cursor + i) % n;
      v_candidate := r.pool[idx + 1];
      if app.lead_pool_eligible(p_tenant, v_candidate, r.exclude, r.skip_away, v_today) then
        update public.lead_routing lr
           set cursor = (idx + 1) % n, turns = lr.turns + 1, last_member_id = v_candidate
         where lr.id = r.id;
        member_id := v_candidate;
        how := 'round_robin';
        return;
      end if;
    end loop;
  end if;

  -- nobody in the rotation can take it: the fallback owner, when there is one who is still active
  if r.fallback_id is not null and app.lead_pool_eligible(p_tenant, r.fallback_id, array[]::uuid[], false, v_today) then
    update public.lead_routing lr set turns = lr.turns + 1, last_member_id = r.fallback_id where lr.id = r.id;
    member_id := r.fallback_id;
    how := 'fallback';
  end if;
end
$$;

-- Who gets the next lead. For a signed-in person with "leads" and "write", or the server (a lead from the web form;
-- the server key and a direct database session are not a person and are let through, as in the server core range).
create or replace function app.lead_assign_next(p_tenant uuid) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  if app.jwt_role() not in ('service_role', '') and not (app.can(p_tenant, 'leads') and app.can(p_tenant, 'write')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select t.member_id into v_member from app.lead_next_turn(p_tenant) t;
  return v_member;
end
$$;

-- The same, for one lead: takes a turn, makes that person the owner and records the handoff, all in one step.
-- A lead that already has an owner keeps them and no turn is used, so calling this twice for the same lead (a double
-- click, a retried request) never skips anyone.
create or replace function app.lead_assign_next(p_tenant uuid, p_lead uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_member uuid;
  v_how text;
begin
  if app.jwt_role() not in ('service_role', '') and not (app.can(p_tenant, 'leads') and app.can(p_tenant, 'write')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- This function reads the lead with the owner's rights, so the office rule of 0013 is applied here by hand:
  -- a person can only have a lead assigned that they could open themselves.
  select l.owner_id into v_owner from public.leads l
  where l.tenant_id = p_tenant and l.id = p_lead
    and (app.jwt_role() in ('service_role', '')
      or l.office_id is null
      or l.office_id = any (app.my_office_ids())
      or l.owner_id = any (app.my_member_ids())
      or app.can(p_tenant, 'allClients'))
  for update;
  if not found then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_owner is not null then
    return pg_catalog.jsonb_build_object('lead', p_lead, 'assigned', v_owner, 'how', 'kept');
  end if;
  select t.member_id, t.how into v_member, v_how from app.lead_next_turn(p_tenant) t;
  if v_member is null then
    return pg_catalog.jsonb_build_object('lead', p_lead, 'assigned', null, 'how', null);
  end if;
  update public.leads l
     set owner_id = v_member, original_owner_id = coalesce(l.original_owner_id, v_member)
   where l.tenant_id = p_tenant and l.id = p_lead;
  insert into public.lead_handoffs (tenant_id, lead_id, from_member_id, to_member_id, by_kind, how, reason)
  values (p_tenant, p_lead, null, v_member, 'automation', case when v_how = 'fallback' then 'rule' else 'round_robin' end,
          case when v_how = 'fallback' then 'fallback owner' end);
  return pg_catalog.jsonb_build_object('lead', p_lead, 'assigned', v_member, 'how', v_how);
end
$$;

create or replace function public.lead_assign_next(p_tenant uuid) returns uuid
language sql
set search_path = ''
as $$ select app.lead_assign_next(p_tenant) $$;

create or replace function public.lead_assign_next(p_tenant uuid, p_lead uuid) returns jsonb
language sql
set search_path = ''
as $$ select app.lead_assign_next(p_tenant, p_lead) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Duplicate search
-- Email and phone are compared in their normalised forms (0012) with indexes, the name the same way; an address only
-- adds weight to a client already found by one of those (two different people at one address are two clients).
-- SECURITY DEFINER: a duplicate in another office must still be found, or the same person would be entered twice.
-- For such a client only the name is returned, which is what the office rule lets everyone see anyway.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.client_find_duplicate(p_tenant uuid, p_email text, p_phone text, p_name text, p_address text)
returns table (client_id uuid, name text, company text, matched text[], score integer, restricted boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_email constant text := app.norm_email(p_email);
  v_phone constant text := app.norm_phone(p_phone);
  v_name constant text := app.norm_name(p_name);
  v_address constant text := app.norm_name(p_address);
  v_hidden uuid[];
begin
  if app.jwt_role() not in ('service_role', '') and not app.can(p_tenant, 'clients') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_hidden := app.hidden_client_ids();
  return query
    with hits as (
      select c.id, 'email'::text as what, 40 as points from public.clients c
        where v_email is not null and c.tenant_id = p_tenant and app.norm_email(c.email) = v_email
      union all
      select p.client_id, 'contact_email', 30 from public.client_people p
        where v_email is not null and p.tenant_id = p_tenant and app.norm_email(p.email) = v_email
      union all
      select c.id, 'phone', 30 from public.clients c
        where v_phone is not null and pg_catalog.length(v_phone) >= 7 and c.tenant_id = p_tenant and app.norm_phone(c.phone) = v_phone
      union all
      select c.id, 'name', 20 from public.clients c
        where v_name is not null and c.tenant_id = p_tenant and app.norm_name(c.name) = v_name
    ),
    found as (
      select h.id, pg_catalog.array_agg(distinct h.what) as what, pg_catalog.sum(h.points)::integer as points
      from (select distinct x.id, x.what, x.points from hits x) h
      group by h.id
    )
    select c.id, c.name,
           case when c.id = any (v_hidden) then null else c.company end,
           f.what || case when a.same then array['address'] else array[]::text[] end,
           f.points + case when a.same then 10 else 0 end,
           c.id = any (v_hidden)
    from found f
    join public.clients c on c.tenant_id = p_tenant and c.id = f.id
    cross join lateral (
      select v_address is not null and exists (select 1 from pg_catalog.unnest(c.addresses) ad where app.norm_name(ad) = v_address) as same
    ) a
    order by 5 desc, c.name, c.id
    limit 20;
end
$$;

-- The same question for leads: has this person already written to us? Open and closed leads both count.
create or replace function app.lead_find_duplicate(p_tenant uuid, p_email text, p_phone text)
returns table (lead_id uuid, ticket text, name text, status text, matched text[])
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_email constant text := app.norm_email(p_email);
  v_phone constant text := app.norm_phone(p_phone);
begin
  if app.jwt_role() not in ('service_role', '') and not app.can(p_tenant, 'leads') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select l.id, l.ticket, l.name, l.status,
           pg_catalog.array_remove(array[
             case when v_email is not null and app.norm_email(l.email) = v_email then 'email' end,
             case when v_phone is not null and app.norm_phone(l.phone) = v_phone then 'phone' end], null)
    from public.leads l
    where l.tenant_id = p_tenant
      and ((v_email is not null and app.norm_email(l.email) = v_email)
        or (v_phone is not null and pg_catalog.length(v_phone) >= 7 and app.norm_phone(l.phone) = v_phone))
    order by l.created desc, l.id
    limit 20;
end
$$;

create or replace function public.client_find_duplicate(p_tenant uuid, p_email text default null, p_phone text default null, p_name text default null, p_address text default null)
returns table (client_id uuid, name text, company text, matched text[], score integer, restricted boolean)
language sql stable
set search_path = ''
as $$ select * from app.client_find_duplicate(p_tenant, p_email, p_phone, p_name, p_address) $$;

create or replace function public.lead_find_duplicate(p_tenant uuid, p_email text default null, p_phone text default null)
returns table (lead_id uuid, ticket text, name text, status text, matched text[])
language sql stable
set search_path = ''
as $$ select * from app.lead_find_duplicate(p_tenant, p_email, p_phone) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- A person's profile (TeamUser in src/domain/types.ts). The team list is read-only through ws_apply: roles, invitations
-- and switching a person off belong to the member functions of the module range. What is left is the part a person
-- edits about themselves, which needs neither "users" nor "write":
--   anyone, their own row      name, phone, title, bio, photo, languages, away
--   with "users" and "write"   the same for anyone, plus inLeadPool and officeIds
-- SECURITY DEFINER because nobody may update tenant_members directly without "users".
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.member_update_profile(p_tenant uuid, p_member uuid, p_patch jsonb) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.current_member(p_tenant);
  v_admin constant boolean := app.can(p_tenant, 'users') and app.can(p_tenant, 'write');
  v_bad text;
  n bigint;
begin
  if v_me is null or app.member_role(p_tenant) = 'worker' or (p_member is distinct from v_me and not v_admin) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'The changes must be an object' using errcode = '22023';
  end if;
  select k into v_bad from pg_catalog.jsonb_object_keys(p_patch) k
  where k not in ('name', 'phone', 'title', 'bio', 'photo', 'languages', 'away')
    and not (v_admin and k in ('inLeadPool', 'officeIds'))
  limit 1;
  if v_bad is not null then
    raise exception 'The field "%" cannot be changed here', v_bad using errcode = '42501';
  end if;
  update public.tenant_members m
     set name = case when p_patch ? 'name' then coalesce(nullif(pg_catalog.btrim(p_patch ->> 'name'), ''), m.name) else m.name end,
         phone = case when p_patch ? 'phone' then nullif(p_patch ->> 'phone', '') else m.phone end,
         title = case when p_patch ? 'title' then nullif(p_patch ->> 'title', '') else m.title end,
         bio = case when p_patch ? 'bio' then nullif(p_patch ->> 'bio', '') else m.bio end,
         photo = case when p_patch ? 'photo' then nullif(p_patch ->> 'photo', '') else m.photo end,
         languages = case when p_patch ? 'languages' then
             case when pg_catalog.jsonb_typeof(p_patch -> 'languages') = 'array' then array(select pg_catalog.jsonb_array_elements_text(p_patch -> 'languages')) end
           else m.languages end,
         away_from = case when p_patch ? 'away' then (p_patch #>> '{away,from}')::date else m.away_from end,
         away_to = case when p_patch ? 'away' then (p_patch #>> '{away,to}')::date else m.away_to end,
         away_note = case when p_patch ? 'away' then p_patch #>> '{away,note}' else m.away_note end,
         in_lead_pool = case when p_patch ? 'inLeadPool' then (p_patch ->> 'inLeadPool')::boolean else m.in_lead_pool end,
         office_ids = case when p_patch ? 'officeIds' then
             case when pg_catalog.jsonb_typeof(p_patch -> 'officeIds') = 'array' then array(select pg_catalog.jsonb_array_elements_text(p_patch -> 'officeIds'))::uuid[] else '{}'::uuid[] end
           else m.office_ids end
   where m.tenant_id = p_tenant and m.id = p_member and m.role <> 'worker';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end
$$;

create or replace function public.member_update_profile(p_tenant uuid, p_member uuid, p_patch jsonb) returns void
language sql
set search_path = ''
as $$ select app.member_update_profile(p_tenant, p_member, p_patch) $$;

revoke all on function app.lead_pool_eligible(uuid, uuid, uuid[], boolean, date), app.lead_next_turn(uuid),
  app.lead_assign_next(uuid), app.lead_assign_next(uuid, uuid), public.lead_assign_next(uuid), public.lead_assign_next(uuid, uuid),
  app.client_find_duplicate(uuid, text, text, text, text), app.lead_find_duplicate(uuid, text, text),
  public.client_find_duplicate(uuid, text, text, text, text), public.lead_find_duplicate(uuid, text, text),
  app.member_update_profile(uuid, uuid, jsonb), public.member_update_profile(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function app.lead_assign_next(uuid), app.lead_assign_next(uuid, uuid), public.lead_assign_next(uuid), public.lead_assign_next(uuid, uuid),
  app.client_find_duplicate(uuid, text, text, text, text), app.lead_find_duplicate(uuid, text, text),
  public.client_find_duplicate(uuid, text, text, text, text), public.lead_find_duplicate(uuid, text, text)
  to authenticated, service_role;
grant execute on function app.member_update_profile(uuid, uuid, jsonb), public.member_update_profile(uuid, uuid, jsonb) to authenticated;
