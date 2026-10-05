-- 0030 Module range: offices, and access to a client of another office
-- First file of the module range (0030 to 0049). Every file follows the recipe in docs/DATABASE.md, section 8:
-- the table by the house rules, row level security enabled and forced, zero privileges to start from, policies
-- written with the once-per-statement helpers, the gateway registration that takes the place of the placeholder of
-- 0018, and app.lockdown_check() at the end.
--
-- How the types of src/domain/types.ts map here:
--   Office          -> offices
--   AccessGrant     -> access_grants      userId = member_id, grantedBy = granted_by     read only through the gateway
--   AccessRequest   -> access_requests    userId = member_id, decidedBy = decided_by     a person files one for themselves;
--                                         the decision is public.grant_decide() and nothing else
-- Office scope (docs/DATABASE.md, section 5) gets its last part here: app.granted_client_ids() now reads the grants.
--
-- Protected functions answer in the shapes of src/platform/gateway.ts. A refusal is raised, never returned:
--   42501  the caller may not do this (capability missing, another company, a client of another office)
--   22023  an argument is not usable; the message is the word "invalid"
--   P0001  the rule says no; the message is one word the screens know: not_found, expired, conflict, locked,
--          needs_other_person, too_small
-- The server passes the SQLSTATE and the word on (api/_lib/respond.js); the text of a message never holds a value.

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers shared by the module migrations. None of them is callable by an application role: they run inside the
-- migrations and inside the SECURITY DEFINER functions of this range.
-- ---------------------------------------------------------------------------------------------------------------------

-- The standard plumbing of a new tenant table (steps 2 of the recipe): updated_at, "a row never changes company",
-- row level security enabled and forced, zero privileges, then what the server and signed-in people get.
-- p_people is the privilege list for signed-in people, or '' when they reach the table through functions only.
create or replace function app.module_table(p_table text, p_people text default 'select, insert, update, delete') returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(p_table)) and a.attname = 'updated_at' and not a.attisdropped) then
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', p_table || '_touch', p_table);
  end if;
  execute pg_catalog.format('create trigger %I before update of tenant_id on public.%I for each row execute function app.tenant_id_immutable()', p_table || '_00_tenant_fixed', p_table);
  execute pg_catalog.format('alter table public.%I enable row level security', p_table);
  execute pg_catalog.format('alter table public.%I force row level security', p_table);
  execute pg_catalog.format('revoke all on public.%I from public, anon, authenticated, service_role', p_table);
  execute pg_catalog.format('grant select, insert, update, delete on public.%I to service_role', p_table);
  if coalesce(p_people, '') <> '' then
    execute pg_catalog.format('grant %s on public.%I to authenticated', p_people, p_table);
  end if;
end
$$;

-- The gate every protected function of this range passes first: a live session that passed the second sign-in step
-- where the company asks for one (0021), an office member of this company, holding every capability named.
-- Returns the caller's member id. The server key and a direct database session are not a person and are refused.
create or replace function app.module_gate(p_tenant uuid, variadic p_caps text[]) returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  perform app.require_mfa(p_tenant);
  v_member := app.current_member(p_tenant);
  if v_member is null or not coalesce(app.is_office(p_tenant), false) or not (p_caps <@ app.my_permissions(p_tenant)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return v_member;
end
$$;

-- A refusal the screens can word. P0001 for a rule ("expired", "locked"), 22023 for an argument that cannot be used.
create or replace function app.module_refuse(p_word text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_word = 'invalid' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  raise exception '%', p_word using errcode = 'P0001';
end
$$;

-- One entry in the security events (counted for trends and alerts, 0020) and one in the audit log, naming the
-- record it is about. app.security_event (0020) files everything under "security"; a screen that shows the trail of
-- one client needs the client. Meta goes through app.safe_meta: short facts, never a value that should stay secret.
create or replace function app.module_event(
  p_tenant uuid, p_kind text, p_entity text, p_row uuid, p_meta jsonb default '{}'::jsonb, p_outcome text default 'ok'
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_meta jsonb := app.safe_meta(p_meta);
begin
  insert into app.security_events (tenant_id, user_id, kind, outcome, severity, ip_hash, meta)
  values (p_tenant, (select auth.uid()), p_kind, p_outcome, app.security_severity(p_kind, p_outcome), app.request_ip_hash(), v_meta);
  perform app.audit_write(p_tenant, p_kind, p_entity, p_row, null, v_meta || pg_catalog.jsonb_build_object('outcome', p_outcome));
end
$$;

-- May the caller open this client? False for a client of another office and for a client that is not there.
create or replace function app.client_visible(p_tenant uuid, p_client uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.clients c where c.tenant_id = p_tenant and c.id = p_client)
     and not (p_client = any (app.hidden_client_ids()))
$$;

revoke all on function app.module_table(text, text), app.module_gate(uuid, text[]), app.module_refuse(text),
  app.module_event(uuid, text, text, uuid, jsonb, text), app.client_visible(uuid, uuid) from public, anon, authenticated, service_role;

-- Nested lists of one row are synced in registry order now ("ord"), then by name. Until here they went by name
-- alone, which no core list minded. A signature request (0036) needs its signers stored before the fields that
-- point at them. Lists that give no "ord" keep the default and their old order. Same signature and rights as in 0014.
create or replace function app.ws_children(p_name text) returns table (name text, parent_field text)
language sql stable security definer
set search_path = ''
as $$
  select w.name, w.parent_field
  from app.ws_collections w
  where w.parent = p_name
  group by w.name, w.parent_field
  order by pg_catalog.min(w.ord), w.name
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- offices
-- ---------------------------------------------------------------------------------------------------------------------
create table public.offices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 200),
  address     text not null default '' check (length(address) <= 400),
  phone       text check (length(phone) <= 40),
  -- IANA time zone, for example America/New_York. Appointment times of this office are read on this clock.
  timezone    text check (timezone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  -- The office shown first. The app keeps exactly one; the database does not insist, so two offices can swap the
  -- mark in one request without tripping over the order of the changes.
  main        boolean not null default false,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint offices_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536)
);
select app.module_table('offices');

-- Everyone in the office reads the offices (a client page names its office); changing them is company settings.
create policy offices_select on public.offices for select to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[]));
create policy offices_insert on public.offices for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('settings', 'write'))::uuid[]));
create policy offices_update on public.offices for update to authenticated
  using (tenant_id = any ((select app.tenants_can('settings', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('settings', 'write'))::uuid[]));
create policy offices_delete on public.offices for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('settings', 'write', 'delete'))::uuid[]));
create trigger offices_audit after insert or update or delete on public.offices
  for each row execute function app.audit_row('phone');

-- The links that 0012 left as plain ids. An office that still has clients cannot be removed (their visibility hangs
-- on it); a lead or a job simply loses the mark.
alter table public.clients add constraint clients_office_fk foreign key (tenant_id, office_id)
  references public.offices (tenant_id, id) on delete restrict;
alter table public.leads add constraint leads_office_fk foreign key (tenant_id, office_id)
  references public.offices (tenant_id, id) on delete set null (office_id);
alter table public.jobs add constraint jobs_office_fk foreign key (tenant_id, office_id)
  references public.offices (tenant_id, id) on delete set null (office_id);
-- (tenant_members.office_ids is an array and cannot carry a foreign key. It is not checked by a trigger either: an
-- id of an office that is gone matches no client, so it grants nothing.)

-- ---------------------------------------------------------------------------------------------------------------------
-- access_requests: "let me see this client of another office". A person asks for themselves; someone who sees every
-- client decides, through public.grant_decide below.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.access_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  member_id   uuid not null,
  client_id   uuid not null,
  reason      text not null default '' check (length(reason) <= 500),
  at          timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by  uuid,
  decided_at  timestamptz,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint access_requests_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint access_requests_decided check ((status = 'pending') = (decided_at is null)),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, decided_by) references public.tenant_members (tenant_id, id) on delete set null (decided_by)
);
create index access_requests_member_idx on public.access_requests (tenant_id, member_id);
create index access_requests_client_idx on public.access_requests (tenant_id, client_id);
create index access_requests_decided_by_idx on public.access_requests (tenant_id, decided_by);
-- One open request per person and client: a second one would only hide the first.
create unique index access_requests_open_uidx on public.access_requests (tenant_id, member_id, client_id) where status = 'pending';
select app.module_table('access_requests', 'select, delete');
-- A person writes the request, never the decision: status, decided_by and decided_at are not theirs to send.
grant insert (id, tenant_id, member_id, client_id, reason, at, extra) on public.access_requests to authenticated;

-- Not office scoped on purpose: the client of a request is by definition one the person cannot open.
create policy access_requests_select on public.access_requests for select to authenticated
  using (member_id = any ((select app.my_member_ids())::uuid[])
    or tenant_id = any ((select app.tenants_can('allClients'))::uuid[]));
create policy access_requests_insert on public.access_requests for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[])
    and member_id = any ((select app.my_member_ids())::uuid[]));
-- The person takes their own request back while nobody has answered it; someone who decides requests can clear them.
create policy access_requests_delete on public.access_requests for delete to authenticated
  using ((tenant_id = any ((select app.tenants_can('write'))::uuid[])
          and member_id = any ((select app.my_member_ids())::uuid[]) and status = 'pending')
      or tenant_id = any ((select app.tenants_can('allClients', 'write'))::uuid[]));
create trigger access_requests_audit after insert or update or delete on public.access_requests
  for each row execute function app.audit_row('reason');

-- ---------------------------------------------------------------------------------------------------------------------
-- access_grants: one person may open one client outside their office, until a date or until it is taken back.
-- Written only by public.grant_decide and public.grant_revoke.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.access_grants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  member_id   uuid not null,
  client_id   uuid not null,
  granted_by  uuid,
  at          timestamptz not null default now(),
  -- Last day the grant counts. NULL = until it is taken back.
  expires     date,
  reason      text check (length(reason) <= 500),
  request_id  uuid,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  -- one grant per person and client: a new approval replaces the old one, so its end date is the one that counts
  unique (tenant_id, member_id, client_id),
  constraint access_grants_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, granted_by) references public.tenant_members (tenant_id, id) on delete set null (granted_by),
  foreign key (tenant_id, request_id) references public.access_requests (tenant_id, id) on delete set null (request_id)
);
create index access_grants_client_idx on public.access_grants (tenant_id, client_id);
create index access_grants_granted_by_idx on public.access_grants (tenant_id, granted_by);
create index access_grants_request_idx on public.access_grants (tenant_id, request_id);
select app.module_table('access_grants', 'select');

create policy access_grants_select on public.access_grants for select to authenticated
  using (member_id = any ((select app.my_member_ids())::uuid[])
    or tenant_id = any ((select app.tenants_can('allClients'))::uuid[]));
create trigger access_grants_audit after insert or update or delete on public.access_grants
  for each row execute function app.audit_row('reason');

-- The hook of 0013: clients the signed-in person was granted, one by one, and whose grant has not run out.
-- SECURITY DEFINER because a policy calls it while deciding which rows the person may read; it answers only about
-- the caller's own grants. Every scope rule already calls it; nothing else changes.
create or replace function app.granted_client_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(g.client_id), '{}'::uuid[])
  from public.access_grants g
  join public.tenant_members m on m.tenant_id = g.tenant_id and m.id = g.member_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
    and (g.expires is null or g.expires >= current_date)
$$;
revoke all on function app.granted_client_ids() from public, anon;
grant execute on function app.granted_client_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- public.grant_decide: approves or denies a request. Approving creates the grant, which may end on a date.
-- Needs "allClients" and "write"; nobody decides their own request.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.grant_decide(p_tenant uuid, p_request uuid, p_approve boolean, p_expires date default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'allClients', 'write');
  r public.access_requests%rowtype;
begin
  select * into r from public.access_requests q where q.tenant_id = p_tenant and q.id = p_request for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if r.status <> 'pending' then perform app.module_refuse('expired'); end if;
  if r.member_id = v_me then perform app.module_refuse('needs_other_person'); end if;
  if p_approve is null or (p_expires is not null and p_expires < current_date) then perform app.module_refuse('invalid'); end if;

  update public.access_requests q
     set status = case when p_approve then 'approved' else 'denied' end, decided_by = v_me, decided_at = pg_catalog.now()
   where q.tenant_id = p_tenant and q.id = p_request;
  if p_approve then
    insert into public.access_grants (tenant_id, member_id, client_id, granted_by, at, expires, reason, request_id)
    values (p_tenant, r.member_id, r.client_id, v_me, pg_catalog.now(), p_expires, nullif(r.reason, ''), r.id)
    on conflict (tenant_id, member_id, client_id) do update
      set granted_by = excluded.granted_by, at = excluded.at, expires = excluded.expires, reason = excluded.reason, request_id = excluded.request_id;
  end if;
  perform app.module_event(p_tenant, case when p_approve then 'access.grant' else 'access.deny' end, 'client', r.client_id,
    pg_catalog.jsonb_build_object('member', r.member_id, 'request', r.id, 'expires', p_expires));
  return app.ws_read(p_tenant, 'accessRequests', app.my_permissions(p_tenant), p_request::text);
end
$$;

-- Takes back access that was granted. Needs "allClients" and "write".
create or replace function public.grant_revoke(p_tenant uuid, p_grant uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'allClients', 'write');
  g public.access_grants%rowtype;
begin
  delete from public.access_grants x where x.tenant_id = p_tenant and x.id = p_grant returning * into g;
  if not found then perform app.module_refuse('not_found'); end if;
  perform app.module_event(p_tenant, 'access.revoke', 'client', g.client_id, pg_catalog.jsonb_build_object('member', g.member_id, 'grant', g.id));
  return true;
end
$$;

revoke all on function public.grant_decide(uuid, uuid, boolean, date), public.grant_revoke(uuid, uuid) from public, anon, service_role;
grant execute on function public.grant_decide(uuid, uuid, boolean, date), public.grant_revoke(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway: offices before the clients that name them (ord 6), requests and grants after clients (20).
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "offices", "ord": 6, "relation": "offices",
  "write_caps": ["settings"], "delete_caps": ["delete"], "order_by": "t.created_at, t.name, t.id",
  "fields": { "id": "id", "name": "name", "address": { "col": "address", "empty": "" }, "phone": "phone", "timezone": "timezone",
              "main": { "col": "main", "omit": false } }
}$j$);

-- Read only: the rows a person gets are their own grants, or all of them for someone who sees every client.
select app.ws_register($j${
  "name": "grants", "ord": 22, "relation": "access_grants", "order_by": "t.at, t.id",
  "fields": { "id": "id", "userId": "member_id", "clientId": "client_id", "grantedBy": { "col": "granted_by", "empty": "" },
              "at": "at", "expires": "expires", "reason": "reason" }
}$j$);

-- The request is written by the person it is for (whatever name the row carries); the decision is read only here.
select app.ws_register($j${
  "name": "accessRequests", "ord": 23, "relation": "access_requests", "write_caps": ["clients"], "delete_caps": [], "order_by": "t.at, t.id",
  "fields": { "id": "id", "userId": { "col": "member_id", "stamp": "member" }, "clientId": "client_id",
              "reason": { "col": "reason", "empty": "" }, "at": "at", "status": { "col": "status", "ro": true },
              "decidedBy": { "col": "decided_by", "ro": true }, "decidedAt": { "col": "decided_at", "ro": true } }
}$j$);

select app.lockdown_check();
