-- Stand-in for the gateway range (0010 to 0019), used ONLY by the server tests (tests/server/pg_local.sh copies it into
-- a temporary migrations folder as 0019_stub_gateway.sql). It is not a migration and never runs on a real project.
-- It gives the server tests the few things they need from that range, in the simplest form:
--   * the capabilities "users", "integrations", "audit", "export", "secureReveal", "write" in the role matrix
--   * the read-only role, and the company configuration column
--   * ws_load / ws_apply with the agreed signatures, storing rows in one small table
--   * three protected functions with the agreed names, to exercise the allow-list and the fresh identity check

alter table public.tenants add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.tenant_members drop constraint if exists tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check check (role in ('owner', 'manager', 'staff', 'readonly', 'worker'));

create or replace function app.role_permissions(p_role text) returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select case p_role
    when 'owner' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'settings', 'compliance', 'profit', 'delete',
                            'users', 'integrations', 'audit', 'export', 'secureReveal', 'write']
    when 'manager' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'compliance', 'delete', 'write']
    when 'staff' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'assistant', 'write']
    when 'readonly' then array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents']
    else array[]::text[]
  end
$$;

create table app.stub_rows (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  c          text not null,
  id         text not null,
  "row"      jsonb not null,
  primary key (tenant_id, c, id)
);
alter table app.stub_rows enable row level security;
alter table app.stub_rows force row level security;
revoke all on app.stub_rows from public, anon, authenticated, service_role;
create table app.stub_idem (
  tenant_id uuid not null, idem text not null, result jsonb not null, primary key (tenant_id, idem)
);
alter table app.stub_idem enable row level security;
alter table app.stub_idem force row level security;
revoke all on app.stub_idem from public, anon, authenticated, service_role;

create or replace function public.ws_load(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not coalesce(app.is_member(p_tenant), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'company', (select pg_catalog.jsonb_build_object('name', t.name) from public.tenants t where t.id = p_tenant),
    'rows', coalesce((select pg_catalog.jsonb_agg(r."row" order by r.c, r.id) from app.stub_rows r where r.tenant_id = p_tenant), '[]'::jsonb));
end
$$;

create or replace function public.ws_apply(p_tenant uuid, p_ops jsonb, p_idem text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  op jsonb;
  v_applied integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_prev jsonb;
  v_out jsonb;
begin
  if not coalesce(app.is_member(p_tenant), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select i.result into v_prev from app.stub_idem i where i.tenant_id = p_tenant and i.idem = p_idem;
  if v_prev is not null then return v_prev || '{"replayed": true}'::jsonb; end if;
  for op in select * from pg_catalog.jsonb_array_elements(p_ops) loop
    if not coalesce(app.can(p_tenant, 'write'), false) then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object('id', op ->> 'id', 'c', op ->> 'c', 'reason', 'forbidden');
    elsif op ->> 'op' = 'delete' then
      delete from app.stub_rows r where r.tenant_id = p_tenant and r.c = op ->> 'c' and r.id = op ->> 'id';
      v_applied := v_applied + 1;
    else
      insert into app.stub_rows (tenant_id, c, id, "row") values (p_tenant, op ->> 'c', op ->> 'id', op -> 'row')
      on conflict (tenant_id, c, id) do update set "row" = excluded."row";
      v_applied := v_applied + 1;
    end if;
  end loop;
  v_out := pg_catalog.jsonb_build_object('ok', true, 'applied', v_applied, 'rejected', v_rejected, 'server', '{}'::jsonb);
  insert into app.stub_idem (tenant_id, idem, result) values (p_tenant, p_idem, v_out);
  return v_out;
end
$$;

-- Protected functions with the names from the build specification. The real ones arrive with the module range.
create or replace function public.vault_reveal(p_tenant uuid, p_client uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'secureReveal'), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform app.require_stepup();
  return pg_catalog.jsonb_build_object('value', 'stub-value-not-a-tax-id', 'client', p_client);
end
$$;

create or replace function public.member_set_role(p_tenant uuid, p_member uuid, p_role text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'users'), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform app.require_stepup();
  update public.tenant_members m set role = p_role where m.tenant_id = p_tenant and m.id = p_member;
end
$$;

create or replace function public.lead_assign_next(p_tenant uuid, p_lead uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'leads'), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object('lead', p_lead, 'assigned', app.current_member(p_tenant));
end
$$;

-- A function that fails with a long internal message, to prove the server never passes such text to the browser.
create or replace function public.grant_decide(p_tenant uuid, p_request uuid, p_approve boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  raise exception 'internal detail: relation "app.secret_table" row 42 token=sk_live_do_not_leak' using errcode = 'P0001';
end
$$;

revoke all on function public.ws_load(uuid), public.ws_apply(uuid, jsonb, text), public.vault_reveal(uuid, uuid),
  public.member_set_role(uuid, uuid, text), public.lead_assign_next(uuid, uuid), public.grant_decide(uuid, uuid, boolean) from public, anon, service_role;
grant execute on function public.ws_load(uuid), public.ws_apply(uuid, jsonb, text), public.vault_reveal(uuid, uuid),
  public.member_set_role(uuid, uuid, text), public.lead_assign_next(uuid, uuid), public.grant_decide(uuid, uuid, boolean) to authenticated;
