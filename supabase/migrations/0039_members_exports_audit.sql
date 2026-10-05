-- 0039 People, exports, and the last two collections (the brief, sections 39, 51 and 60)
--   member_set_role, member_disable, member_enable   the protected changes to a membership
--   export_request                                    a file of records to download, written to the trail
--   audit                                             the audit log of 0004, now with a short "summary" per line
--   connections                                       stays a placeholder; its loader is ready (see the end of this file)
-- Inviting a person is not here: the server owns invitations (public.invite_create, 0022).

-- ---------------------------------------------------------------------------------------------------------------------
-- Members. Needs "users" and "write", and a fresh identity check. Only an owner makes or unmakes an owner; a company
-- never ends up without an active owner. The change itself is audited by the triggers of 0004 and 0020 on
-- tenant_members (who, old role, new role), so nothing is written twice here.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.member_set_role(p_tenant uuid, p_member uuid, p_role text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'users', 'write');
  m public.tenant_members%rowtype;
begin
  perform app.require_stepup();
  select * into m from public.tenant_members x where x.tenant_id = p_tenant and x.id = p_member for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if m.role = 'worker' or p_role is null or p_role <> all (app.office_roles()) then perform app.module_refuse('invalid'); end if;
  if m.role <> p_role then
    if (m.role = 'owner' or p_role = 'owner') and app.member_role(p_tenant) is distinct from 'owner' then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    begin
      update public.tenant_members x set role = p_role where x.tenant_id = p_tenant and x.id = p_member;
    exception when check_violation then
      -- the last active owner stays one (app.guard_last_owner, 0001)
      perform app.module_refuse('locked');
    end;
  end if;
  return app.ws_read(p_tenant, 'users', app.my_permissions(p_tenant), p_member::text);
end
$$;

-- Switches a person off: they keep their history and cannot sign in. Nobody switches themselves off. Every session
-- of the person is ended at once (the "sign out everywhere" mark of 0021), and what they were waiting for is closed.
create or replace function public.member_disable(p_tenant uuid, p_member uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'users', 'write');
  m public.tenant_members%rowtype;
  r record;
begin
  perform app.require_stepup();
  select * into m from public.tenant_members x where x.tenant_id = p_tenant and x.id = p_member for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if m.id = v_me then perform app.module_refuse('locked'); end if;
  if m.role = 'owner' and app.member_role(p_tenant) is distinct from 'owner' then raise exception 'Not allowed' using errcode = '42501'; end if;
  if m.status <> 'disabled' then
    begin
      update public.tenant_members x set status = 'disabled', in_lead_pool = false where x.tenant_id = p_tenant and x.id = p_member;
    exception when check_violation then
      perform app.module_refuse('locked');
    end;
    for r in
      update public.reveal_requests q set status = 'expired'
       where q.tenant_id = p_tenant and q.requested_by = p_member and q.status in ('pending', 'approved')
      returning q.id, q.client_id
    loop
      perform app.secure_log(p_tenant, r.client_id, null, 'expire', null, r.id);
    end loop;
    -- a token that was already issued stops working now, not when it would have run out
    insert into app.session_revocations (user_id, revoked_before, reason, by_user, updated_at)
    values (m.user_id, pg_catalog.now(), 'by_admin', (select auth.uid()), pg_catalog.now())
    on conflict (user_id) do update set revoked_before = pg_catalog.now(), reason = 'by_admin', by_user = (select auth.uid()), updated_at = pg_catalog.now();
    delete from app.session_stamps s where s.user_id = m.user_id;
    perform app.security_event(p_tenant, (select auth.uid()), 'session.revoked_by_admin', 'ok', null, pg_catalog.jsonb_build_object('member', p_member));
  end if;
  return app.ws_read(p_tenant, 'users', app.my_permissions(p_tenant), p_member::text);
end
$$;

-- Lets a person who was switched off sign in again. Same rule as switching off.
create or replace function public.member_enable(p_tenant uuid, p_member uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'users', 'write');
  m public.tenant_members%rowtype;
begin
  perform app.require_stepup();
  select * into m from public.tenant_members x where x.tenant_id = p_tenant and x.id = p_member for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if m.role = 'owner' and app.member_role(p_tenant) is distinct from 'owner' then raise exception 'Not allowed' using errcode = '42501'; end if;
  if m.status <> 'disabled' then perform app.module_refuse('invalid'); end if;
  update public.tenant_members x set status = 'active' where x.tenant_id = p_tenant and x.id = p_member;
  return app.ws_read(p_tenant, 'users', app.my_permissions(p_tenant), p_member::text);
end
$$;

revoke all on function public.member_set_role(uuid, uuid, text), public.member_disable(uuid, uuid), public.member_enable(uuid, uuid) from public, anon, service_role;
grant execute on function public.member_set_role(uuid, uuid, text), public.member_disable(uuid, uuid), public.member_enable(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Exports. A copy of what the person may already see, as a CSV file. Needs "export" and the capability of that kind
-- of record, and a fresh identity check. SECURITY INVOKER on purpose: every row is read as the person, so row level
-- security and the office scope decide what is in the file. A tax ID is never part of an export, not even its type
-- or its last four digits. Every export is written to the trail, with the kind and the number of rows.
-- ---------------------------------------------------------------------------------------------------------------------

-- One cell. Text that a spreadsheet would run as a formula gets a leading apostrophe; a cell with a comma, a quote
-- or a line break is quoted.
create or replace function app.csv_cell(p text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case when x.s ~ '[",\r\n]' then '"' || pg_catalog.replace(x.s, '"', '""') || '"' else x.s end
  from (select case when p is null then '' when p ~ '^[=+@\t\r-]' then '''' || p else p end as s) x
$$;
-- One line from cells that are already text. A number is passed with app.csv_num so "-12.50" stays a number.
create or replace function app.csv_line(variadic p_cells text[]) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.array_to_string(p_cells, ',', '') $$;
create or replace function app.csv_num(p numeric) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select coalesce(p::text, '') $$;

-- Records the export. SECURITY DEFINER because the trail is not a person's to write; it only ever writes "this
-- person exported this kind", and only for someone who holds "export" in that company.
create or replace function app.export_log(p_tenant uuid, p_kind text, p_rows integer, p_file text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not coalesce(app.can(p_tenant, 'export'), false) or p_kind !~ '^[a-z]{3,20}$' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform app.module_event(p_tenant, 'export.' || p_kind, 'export', null, pg_catalog.jsonb_build_object('rows', p_rows, 'summary', p_file || ' · ' || p_rows));
end
$$;

create or replace function public.export_request(p_tenant uuid, p_kind text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_perms text[];
  v_need text;
  v_head text;
  v_body text;
  v_rows integer;
  v_file text;
begin
  perform app.require_mfa(p_tenant);
  v_perms := app.my_permissions(p_tenant);
  v_need := case p_kind when 'clients' then 'clients' when 'leads' then 'leads' when 'jobs' then 'jobs' when 'tasks' then 'tasks' when 'payments' then 'money'
                        when 'appointments' then 'appointments' when 'catalog' then 'catalog' when 'audit' then 'audit' end;
  if v_need is null then raise exception 'invalid' using errcode = '22023'; end if;
  if not (array['export', v_need] <@ v_perms) or not coalesce(app.is_office(p_tenant), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform app.require_stepup();

  if p_kind = 'clients' then
    v_head := 'name,company,phone,email,address,client since,type,office';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(c.name), app.csv_cell(c.company), app.csv_cell(c.phone), app.csv_cell(c.email),
             app.csv_cell(c.addresses[1]), app.csv_cell(c.since::text), app.csv_cell(c.client_type), app.csv_cell(o.name)), E'\r\n' order by c.name, c.id)
      into v_rows, v_body
    from public.clients c left join public.offices o on o.tenant_id = c.tenant_id and o.id = c.office_id
    where c.tenant_id = p_tenant;
  elsif p_kind = 'leads' then
    v_head := 'ticket,name,company,phone,email,stage,source,value,created,owner';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(l.ticket), app.csv_cell(l.name), app.csv_cell(l.company), app.csv_cell(l.phone), app.csv_cell(l.email),
             app.csv_cell(l.status), app.csv_cell(l.source), app.csv_num(l.value), app.csv_cell(l.created::text), app.csv_cell(m.name)), E'\r\n' order by l.created desc, l.ticket desc)
      into v_rows, v_body
    from public.leads l left join public.tenant_members m on m.tenant_id = l.tenant_id and m.id = l.owner_id
    where l.tenant_id = p_tenant;
  elsif p_kind = 'jobs' then
    if 'money' = any (v_perms) then
      v_head := 'number,name,client,status,price,start,end';
      select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(j.number), app.csv_cell(j.name), app.csv_cell(c.name), app.csv_cell(j.status), app.csv_num(j.price),
               app.csv_cell(j.start_date::text), app.csv_cell(j.end_date::text)), E'\r\n' order by j.created desc, j.number desc)
        into v_rows, v_body
      from public.jobs j left join public.clients c on c.tenant_id = j.tenant_id and c.id = j.client_id
      where j.tenant_id = p_tenant;
    else
      -- without "money" the person reads jobs through the staff view, which has no price
      v_head := 'number,name,client,status,start,end';
      select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(j.number), app.csv_cell(j.name), app.csv_cell(c.name), app.csv_cell(j.status),
               app.csv_cell(j.start_date::text), app.csv_cell(j.end_date::text)), E'\r\n' order by j.created desc, j.number desc)
        into v_rows, v_body
      from public.jobs_basic j left join public.clients c on c.tenant_id = j.tenant_id and c.id = j.client_id
      where j.tenant_id = p_tenant;
    end if;
  elsif p_kind = 'tasks' then
    v_head := 'title,status,priority,due,client';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(k.title), app.csv_cell(k.status), app.csv_cell(k.pri), app.csv_cell(k.due::text), app.csv_cell(c.name)),
             E'\r\n' order by k.created, k.created_at, k.id)
      into v_rows, v_body
    from public.tasks k left join public.clients c on c.tenant_id = k.tenant_id and c.id = k.client_id
    where k.tenant_id = p_tenant;
  elsif p_kind = 'payments' then
    v_head := 'date,client,job,method,reference,amount';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(p.date::text), app.csv_cell(c.name), app.csv_cell(j.name), app.csv_cell(p.method), app.csv_cell(p.ref),
             app.csv_num(p.amount)), E'\r\n' order by p.date, p.created_at, p.id)
      into v_rows, v_body
    from public.client_payments p
    join public.jobs j on j.tenant_id = p.tenant_id and j.id = p.job_id
    left join public.clients c on c.tenant_id = j.tenant_id and c.id = j.client_id
    where p.tenant_id = p_tenant;
  elsif p_kind = 'appointments' then
    v_head := 'date,time,client,with,status,fee';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(a.date::text), app.csv_cell(pg_catalog.to_char(a.start_time, 'HH24:MI')), app.csv_cell(c.name), app.csv_cell(m.name),
             app.csv_cell(a.status), app.csv_num(a.fee)), E'\r\n' order by a.date, a.start_time, a.id)
      into v_rows, v_body
    from public.appointments a
    left join public.clients c on c.tenant_id = a.tenant_id and c.id = a.client_id
    left join public.tenant_members m on m.tenant_id = a.tenant_id and m.id = a.staff_id
    where a.tenant_id = p_tenant;
  elsif p_kind = 'catalog' then
    v_head := 'service,category,tier,price,unit,active';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(s.name), app.csv_cell(s.category), app.csv_cell(t.name), app.csv_num(t.price), app.csv_cell(t.unit),
             app.csv_cell(s.active::text)), E'\r\n' order by s.name, s.id, t.position, t.id)
      into v_rows, v_body
    from public.catalog_services s left join public.catalog_tiers t on t.tenant_id = s.tenant_id and t.service_id = s.id
    where s.tenant_id = p_tenant;
  else
    v_head := 'when,who,action,record type,record,detail';
    select pg_catalog.count(*), pg_catalog.string_agg(app.csv_line(app.csv_cell(app.ws_iso(a.at)), app.csv_cell(coalesce(m.name, a.actor_role)), app.csv_cell(a.action), app.csv_cell(a.table_name),
             app.csv_cell(a.row_id::text), app.csv_cell(a.new_data ->> 'summary')), E'\r\n' order by a.at desc, a.id desc)
      into v_rows, v_body
    from public.audit_log a left join public.tenant_members m on m.tenant_id = a.tenant_id and m.user_id = a.actor
    where a.tenant_id = p_tenant;
  end if;

  v_file := p_kind || '-' || pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD') || '.csv';
  perform app.export_log(p_tenant, p_kind, v_rows, v_file);
  -- the first character tells a spreadsheet the file is UTF-8
  return pg_catalog.jsonb_build_object('fileName', v_file, 'mime', 'text/csv;charset=utf-8', 'rows', v_rows,
    'content', E'﻿' || v_head || case when v_rows > 0 then E'\r\n' || v_body else '' end);
end
$$;

revoke all on function app.csv_cell(text), app.csv_line(text[]), app.csv_num(numeric), app.export_log(uuid, text, integer, text) from public, anon;
grant execute on function app.csv_cell(text), app.csv_line(text[]), app.csv_num(numeric), app.export_log(uuid, text, integer, text) to authenticated;
revoke all on function public.export_request(uuid, text) from public, anon, service_role;
grant execute on function public.export_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- audit: the same collection as in 0018, plus "summary". The events of this range carry a short summary in their
-- facts (the name of an exported file, for example); a row change has none. Nothing here is writable.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "audit", "ord": 900, "relation": "audit_log", "read_caps": ["audit"], "order_by": "t.at desc, t.id desc", "row_limit": 500,
  "fields": {
    "id": { "kind": "expr", "sql": "pg_catalog.to_jsonb({a}.id::text)" },
    "at": "at",
    "by": { "kind": "expr", "sql": "coalesce((select pg_catalog.to_jsonb(m.id) from public.tenant_members m where m.tenant_id = {a}.tenant_id and m.user_id = {a}.actor), pg_catalog.to_jsonb({a}.actor_role))" },
    "action": "action", "entity": "table_name", "entityId": "row_id", "ipHash": "ip_hash",
    "summary": { "kind": "expr", "sql": "case when pg_catalog.jsonb_typeof({a}.new_data -> 'summary') = 'string' then {a}.new_data -> 'summary' end" }
  } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- connections: what the company connected to outside services. The rows live in app.integration_connections and
-- only the server writes them (0026). The collection stays the placeholder of 0018 on purpose: it loads as an empty
-- list and refuses writes, and the Integrations screen reads GET /api/integrations instead, which also says what is
-- configured on the server and why a connection is in the state it is in (docs/SERVER.md, section 14).
-- The loader below is ready for the day the list should travel with ws_load too: registering it is one statement,
--   select app.ws_register('{"name": "connections", "kind": "custom", "ord": 230, "load_fn": "ws_load_connections"}');
-- (supabase/tests/gateway.sql expects at least one placeholder to exist; that check has to accept "none" first.)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_load_connections(p_tenant uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if pg_catalog.to_regprocedure('public.connections_list(uuid)') is null then return '[]'::jsonb; end if;
  execute 'select public.connections_list($1)' into v using p_tenant;
  return coalesce(v, '[]'::jsonb);
end
$$;
revoke all on function app.ws_load_connections(uuid) from public, anon, service_role;
grant execute on function app.ws_load_connections(uuid) to authenticated;

select app.lockdown_check();
