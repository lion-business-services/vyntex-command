-- 0034 The secure tax ID vault (the brief, sections 11, 55 and 60)
-- The number itself lives in client_secrets (0012), encrypted with app.encrypt_pii (0005). No application role holds
-- any privilege on that table. This file adds the only doors:
--   vault_set      stores or replaces a number (or removes it, with an empty value). Never returns it, never logs it.
--   vault_request  asks to see a number, with the business reason in writing
--   vault_decide   approves or denies. Two-person rule ("second_person", the default): the person who asked can never
--                  approve. Single-person rule ("step_up"): the person who asked approves their own request, and
--                  their own fresh identity check is the approval. An approval is good for 15 minutes.
--   vault_reveal   returns the number ONCE, to the person who asked, while the approval is good. The request is used
--                  up and the viewing is logged in the same transaction, before the value leaves the database.
--   vault_copied   the person says they copied the value out of the panel; logged
--   vault_clear    removes the number (the same as vault_set with an empty value)
--   vault_expire   closes requests that ran out (service role, for the scheduled job)
-- and two read-only collections:
--   RevealRequest    -> reveal_requests       requestedBy = requested_by, approverId = approver_id
--   SecureAccessLog  -> secure_access_log     userId = actor_kind + member_id ("system" for the sweep)
--
-- What never happens: the number is not written to the audit log, the security events, the access log, an error
-- message or any column other than client_secrets.tax_id_enc. The tests plant a number, run every operation, and
-- then search every text of every table for it.
-- For whoever runs the database: keep statement logging with parameters off (log_statement = none and
-- log_parameter_max_length_on_error = 0, the defaults on Supabase), because the number arrives as an argument.

-- ---------------------------------------------------------------------------------------------------------------------
-- reveal_requests
-- ---------------------------------------------------------------------------------------------------------------------
create table public.reveal_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  client_id     uuid not null,
  field         text not null default 'tax_id' check (field in ('tax_id')),
  requested_by  uuid not null,
  reason        text not null check (length(btrim(reason)) between 5 and 500),
  at            timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired', 'used')),
  approver_id   uuid,
  decided_at    timestamptz,
  -- An approval is good until this moment, for one viewing.
  expires_at    timestamptz,
  used_at       timestamptz,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint reveal_requests_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint reveal_requests_approval check (status not in ('approved', 'used') or (decided_at is not null and expires_at is not null)),
  constraint reveal_requests_denial check (status <> 'denied' or decided_at is not null),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, requested_by) references public.tenant_members (tenant_id, id) on delete restrict,
  foreign key (tenant_id, approver_id) references public.tenant_members (tenant_id, id) on delete restrict
);
create index reveal_requests_client_idx on public.reveal_requests (tenant_id, client_id, at desc);
create index reveal_requests_requester_idx on public.reveal_requests (tenant_id, requested_by);
create index reveal_requests_approver_idx on public.reveal_requests (tenant_id, approver_id);
-- one open request per person and client: a second one would only hide the first
create unique index reveal_requests_open_uidx on public.reveal_requests (tenant_id, client_id, requested_by) where status in ('pending', 'approved');
create index reveal_requests_due_idx on public.reveal_requests (status, expires_at) where status in ('pending', 'approved');
select app.module_table('reveal_requests', 'select');

-- The people who decide requests and the people who read the trail see every request; a person always sees their own.
create policy reveal_requests_select on public.reveal_requests for select to authenticated
  using ((tenant_id = any ((select app.tenants_can('secureApprove'))::uuid[])
       or tenant_id = any ((select app.tenants_can('audit'))::uuid[])
       or requested_by = any ((select app.my_member_ids())::uuid[]))
    and client_id not in (select app.hidden_clients()));

-- A request is evidence. For every caller: who asked, for which client, why and when never change; the status only
-- moves forward (pending to approved, denied or expired; approved to used or expired); nothing is removed.
create or replace function app.reveal_requests_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.client_id, new.field, new.requested_by, new.reason, new.at) is distinct from (old.client_id, old.field, old.requested_by, old.reason, old.at) then
    raise exception 'A reveal request is evidence: it is never edited' using errcode = '42501', constraint = 'reveal_requests_evidence';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'pending' and new.status in ('approved', 'denied', 'expired')) or (old.status = 'approved' and new.status in ('used', 'expired'))) then
    raise exception 'A reveal request cannot go from % to %', old.status, new.status using errcode = '42501', constraint = 'reveal_requests_forward_only';
  end if;
  return null;
end
$$;
revoke all on function app.reveal_requests_guard() from public, anon;
create trigger reveal_requests_guard after update on public.reveal_requests for each row execute function app.reveal_requests_guard();
create trigger reveal_requests_no_delete before delete on public.reveal_requests for each row execute function app.block_change();
create trigger reveal_requests_no_truncate before truncate on public.reveal_requests for each statement execute function app.block_change();
create trigger reveal_requests_audit after insert or update on public.reveal_requests
  for each row execute function app.audit_row('reason');

-- ---------------------------------------------------------------------------------------------------------------------
-- secure_access_log: who did what to a protected value, for which client, when and why. Append only.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.secure_access_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  at          timestamptz not null default now(),
  client_id   uuid not null,
  -- A person, or "system" for what the database did on its own (a request that ran out).
  actor_kind  text not null default 'member' check (actor_kind in ('member', 'system')),
  member_id   uuid,
  action      text not null check (action in ('set', 'clear', 'request', 'approve', 'deny', 'reveal', 'expire', 'export')),
  reason      text check (length(reason) <= 500),
  request_id  uuid,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint secure_access_log_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint secure_access_log_actor_pair check ((actor_kind = 'member') = (member_id is not null)),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete restrict,
  foreign key (tenant_id, request_id) references public.reveal_requests (tenant_id, id) on delete restrict
);
create index secure_access_log_client_idx on public.secure_access_log (tenant_id, client_id, at desc);
create index secure_access_log_member_idx on public.secure_access_log (tenant_id, member_id);
create index secure_access_log_request_idx on public.secure_access_log (tenant_id, request_id);
create index secure_access_log_at_idx on public.secure_access_log (tenant_id, at desc);
select app.module_table('secure_access_log', 'select');

create policy secure_access_log_select on public.secure_access_log for select to authenticated
  using ((tenant_id = any ((select app.tenants_can('secureApprove'))::uuid[])
       or tenant_id = any ((select app.tenants_can('audit'))::uuid[]))
    and client_id not in (select app.hidden_clients()));
-- (the update trigger is an AFTER trigger so a link to another company is still answered by the foreign key first)
create trigger secure_access_log_append_only after update on public.secure_access_log for each row execute function app.block_change();
create trigger secure_access_log_no_delete before delete on public.secure_access_log for each row execute function app.block_change();
create trigger secure_access_log_no_truncate before truncate on public.secure_access_log for each statement execute function app.block_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- Internals
-- ---------------------------------------------------------------------------------------------------------------------

-- Whether what was typed can be a number of that type: nine digits, and none of the ranges that are never issued.
-- It looks at the shape only; it cannot tell whether the number belongs to the person. Returns NULL when the shape
-- is right, otherwise "length" or "pattern". The same rules as taxIdProblem() in src/domain/actions/security.ts.
create or replace function app.tax_id_problem(p_type text, p_value text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  d text;
  v_area integer; v_group integer; v_serial integer; v_prefix integer;
begin
  -- anything other than digits, spaces and dashes is a typing mistake, not a separator
  if p_value is null or p_value ~ '[^0-9[:space:]-]' then return 'pattern'; end if;
  d := pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g');
  if pg_catalog.length(d) <> 9 then return 'length'; end if;
  v_area := pg_catalog.substr(d, 1, 3)::integer; v_group := pg_catalog.substr(d, 4, 2)::integer; v_serial := pg_catalog.substr(d, 6)::integer;
  v_prefix := pg_catalog.substr(d, 1, 2)::integer;
  if p_type = 'ein' then
    -- the two-digit prefixes that have been assigned to employer identification numbers
    return case when v_prefix in (1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23, 24, 25, 26, 27, 98, 99)
                  or v_prefix between 30 and 48 or v_prefix between 50 and 68 or v_prefix between 71 and 77
                  or v_prefix between 80 and 88 or v_prefix between 90 and 95 then null else 'pattern' end;
  elsif p_type = 'itin' then
    return case when v_area >= 900 and (v_group between 50 and 65 or v_group between 70 and 88 or v_group between 90 and 92 or v_group between 94 and 99)
                then null else 'pattern' end;
  elsif p_type = 'ssn' then
    -- these areas, group 00 and serial 0000 are never issued; 9xx belongs to the other type
    return case when v_area = 0 or v_area = 666 or v_area >= 900 or v_group = 0 or v_serial = 0 then 'pattern' end;
  end if;
  return 'pattern';
end
$$;

-- The company's vault rules, with the defaults of vaultRules() in src/domain/config.ts.
create or replace function app.vault_rules(p_tenant uuid, out approval text, out reveal_seconds integer)
language sql stable security definer
set search_path = ''
as $$
  select case when t.config -> 'vault' ->> 'approval' = 'step_up' then 'step_up' else 'second_person' end,
         coalesce(case when pg_catalog.jsonb_typeof(t.config -> 'vault' -> 'revealSeconds') = 'number' then pg_catalog.floor((t.config -> 'vault' ->> 'revealSeconds')::numeric)::integer end, 60)
  from public.tenants t where t.id = p_tenant
$$;

-- One line of the access log. p_member NULL writes it as "system".
create or replace function app.secure_log(p_tenant uuid, p_client uuid, p_member uuid, p_action text, p_reason text default null, p_request uuid default null) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.secure_access_log (tenant_id, client_id, actor_kind, member_id, action, reason, request_id)
  values (p_tenant, p_client, case when p_member is null then 'system' else 'member' end, p_member, p_action, p_reason, p_request)
$$;

-- Closes every request that ran out: an approval past its window, or a request nobody answered for 24 hours.
-- Each one is written to the access log as "expire", by the system. One company, or all of them with NULL.
create or replace function app.vault_expire_due(p_tenant uuid default null) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    update public.reveal_requests q set status = 'expired'
     where q.id in (
       select x.id from public.reveal_requests x
       where (p_tenant is null or x.tenant_id = p_tenant)
         and ((x.status = 'approved' and x.expires_at <= pg_catalog.now())
           or (x.status = 'pending' and x.at <= pg_catalog.now() - interval '24 hours'))
       for update skip locked)
    returning q.tenant_id, q.id, q.client_id
  loop
    perform app.secure_log(r.tenant_id, r.client_id, null, 'expire', null, r.id);
    perform app.module_event(r.tenant_id, 'vault.expire', 'client', r.client_id, pg_catalog.jsonb_build_object('request', r.id));
    n := n + 1;
  end loop;
  return n;
end
$$;

revoke all on function app.tax_id_problem(text, text), app.vault_rules(uuid), app.secure_log(uuid, uuid, uuid, text, text, uuid), app.vault_expire_due(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_set (and vault_clear)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vault_set(p_tenant uuid, p_client uuid, p_type text, p_value text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'clients', 'secureView', 'secureReveal', 'write');
  v_digits text;
  v_was text;
  r record;
begin
  -- a client of another office does not exist for this person
  if p_client is null or not app.client_visible(p_tenant, p_client) then perform app.module_refuse('not_found'); end if;
  if p_type is null or p_type not in ('ssn', 'ein', 'itin') then perform app.module_refuse('invalid'); end if;

  if coalesce(pg_catalog.btrim(p_value), '') = '' then
    -- removing a number cannot be undone: the person confirms who they are first
    perform app.require_stepup();
    delete from public.client_secrets s where s.tenant_id = p_tenant and s.client_id = p_client returning s.tax_id_type into v_was;
    if v_was is null then perform app.module_refuse('not_found'); end if;
    -- nothing is left to see: requests that were waiting or approved are closed
    for r in
      update public.reveal_requests q set status = 'expired'
       where q.tenant_id = p_tenant and q.client_id = p_client and q.status in ('pending', 'approved')
      returning q.id
    loop
      perform app.secure_log(p_tenant, p_client, null, 'expire', null, r.id);
    end loop;
    perform app.secure_log(p_tenant, p_client, v_me, 'clear');
    perform app.module_event(p_tenant, 'vault.clear', 'client', p_client, pg_catalog.jsonb_build_object('kind', v_was));
    return pg_catalog.jsonb_build_object('taxIdType', v_was, 'taxIdLast4', '');
  end if;

  -- the message of a refusal is one fixed word: what was typed is never repeated back
  if app.tax_id_problem(p_type, p_value) is not null then perform app.module_refuse('invalid'); end if;
  v_digits := pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g');
  insert into public.client_secrets (tenant_id, client_id, tax_id_enc, tax_id_type, last4, set_by, set_at)
  values (p_tenant, p_client, app.encrypt_pii(v_digits), p_type, pg_catalog.right(v_digits, 4), (select auth.uid()), pg_catalog.now())
  on conflict (tenant_id, client_id) do update
    set tax_id_enc = excluded.tax_id_enc, tax_id_type = excluded.tax_id_type, last4 = excluded.last4, set_by = excluded.set_by, set_at = excluded.set_at;
  perform app.secure_log(p_tenant, p_client, v_me, 'set');
  -- the trail says a number was stored and of which type, never a digit of it
  perform app.module_event(p_tenant, 'vault.set', 'client', p_client, pg_catalog.jsonb_build_object('kind', p_type));
  return pg_catalog.jsonb_build_object('taxIdType', p_type, 'taxIdLast4', pg_catalog.right(v_digits, 4));
end
$$;

create or replace function public.vault_clear(p_tenant uuid, p_client uuid) returns jsonb
language sql security definer
set search_path = ''
as $$ select public.vault_set(p_tenant, p_client, coalesce((select c.tax_id_type from public.clients c where c.tenant_id = p_tenant and c.id = p_client), 'ssn'), '') $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_request
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vault_request(p_tenant uuid, p_client uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'clients', 'secureView', 'secureReveal', 'write');
  v_text constant text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 300);
  v_id uuid;
begin
  perform app.vault_expire_due(p_tenant);
  if pg_catalog.length(v_text) < 5 then perform app.module_refuse('invalid'); end if;
  if p_client is null or not app.client_visible(p_tenant, p_client)
     or not exists (select 1 from public.client_secrets s where s.tenant_id = p_tenant and s.client_id = p_client) then
    perform app.module_refuse('not_found');
  end if;
  if exists (select 1 from public.reveal_requests q
             where q.tenant_id = p_tenant and q.client_id = p_client and q.requested_by = v_me and q.status in ('pending', 'approved')) then
    perform app.module_refuse('conflict');
  end if;
  insert into public.reveal_requests (tenant_id, client_id, requested_by, reason) values (p_tenant, p_client, v_me, v_text) returning id into v_id;
  perform app.secure_log(p_tenant, p_client, v_me, 'request', v_text, v_id);
  perform app.module_event(p_tenant, 'vault.request', 'client', p_client, pg_catalog.jsonb_build_object('request', v_id));
  return app.ws_read(p_tenant, 'reveals', app.my_permissions(p_tenant), v_id::text);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_decide
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vault_decide(p_tenant uuid, p_request uuid, p_approve boolean) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'write');
  v_perms constant text[] := app.my_permissions(p_tenant);
  q public.reveal_requests%rowtype;
  v_own boolean;
begin
  if p_approve is null then perform app.module_refuse('invalid'); end if;
  perform app.vault_expire_due(p_tenant);
  select * into q from public.reveal_requests x where x.tenant_id = p_tenant and x.id = p_request for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if q.status <> 'pending' then perform app.module_refuse('expired'); end if;
  v_own := q.requested_by = v_me;
  if v_own and p_approve then
    -- the person who asked can never approve under the two-person rule
    if (select r.approval from app.vault_rules(p_tenant) r) <> 'step_up' then perform app.module_refuse('needs_other_person'); end if;
    if not (array['secureView', 'secureReveal'] <@ v_perms) then raise exception 'Not allowed' using errcode = '42501'; end if;
  elsif not v_own then
    if not ('secureApprove' = any (v_perms)) then raise exception 'Not allowed' using errcode = '42501'; end if;
    if not app.client_visible(p_tenant, q.client_id) then perform app.module_refuse('not_found'); end if;
  end if;
  -- (the person who asked may always take their own request back: a denial by themselves)
  -- an approval is given by someone who has just confirmed who they are: under the single-person rule that check IS the approval
  if p_approve then perform app.require_stepup(); end if;

  update public.reveal_requests x
     set status = case when p_approve then 'approved' else 'denied' end, approver_id = v_me, decided_at = pg_catalog.now(),
         expires_at = case when p_approve then pg_catalog.now() + interval '15 minutes' end
   where x.tenant_id = p_tenant and x.id = q.id;
  perform app.secure_log(p_tenant, q.client_id, v_me, case when p_approve then 'approve' else 'deny' end, null, q.id);
  perform app.module_event(p_tenant, case when p_approve then 'vault.approve' else 'vault.deny' end, 'client', q.client_id,
    pg_catalog.jsonb_build_object('request', q.id, 'own', v_own));
  return app.ws_read(p_tenant, 'reveals', v_perms, q.id::text);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_reveal: the one function that decrypts a client's tax ID.
-- Answer: { value, hideAt, last4 }. "value" is the nine digits; the screen formats and hides them.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.vault_reveal(p_tenant uuid, p_request uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'clients', 'secureView', 'secureReveal', 'write');
  q public.reveal_requests%rowtype;
  v_cipher bytea;
  v_last4 text;
begin
  perform app.require_stepup();
  -- the row lock makes "once" hold when the same request is opened from two windows at the same moment
  select * into q from public.reveal_requests x where x.tenant_id = p_tenant and x.id = p_request for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if q.requested_by <> v_me then raise exception 'Not allowed' using errcode = '42501'; end if;
  if q.status <> 'approved' or q.expires_at is null or q.expires_at <= pg_catalog.now() then perform app.module_refuse('expired'); end if;
  if not app.client_visible(p_tenant, q.client_id) then perform app.module_refuse('not_found'); end if;
  select s.tax_id_enc, s.last4 into v_cipher, v_last4 from public.client_secrets s where s.tenant_id = p_tenant and s.client_id = q.client_id;
  if v_cipher is null then perform app.module_refuse('not_found'); end if;

  -- used up and logged before anything is shown
  update public.reveal_requests x set status = 'used', used_at = pg_catalog.now() where x.tenant_id = p_tenant and x.id = q.id;
  perform app.secure_log(p_tenant, q.client_id, v_me, 'reveal', q.reason, q.id);
  perform app.module_event(p_tenant, 'vault.reveal', 'client', q.client_id, pg_catalog.jsonb_build_object('request', q.id));
  return pg_catalog.jsonb_build_object(
    'value', app.decrypt_pii(v_cipher),
    'hideAt', app.ws_iso(pg_catalog.now() + pg_catalog.make_interval(secs => (select r.reveal_seconds from app.vault_rules(p_tenant) r))),
    'last4', v_last4);
end
$$;

-- The value was copied out of the panel. Only the person who just opened the request can say so, and it is logged.
create or replace function public.vault_copied(p_tenant uuid, p_request uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'clients', 'secureView', 'secureReveal', 'write');
  q public.reveal_requests%rowtype;
begin
  select * into q from public.reveal_requests x where x.tenant_id = p_tenant and x.id = p_request;
  if not found then perform app.module_refuse('not_found'); end if;
  if q.requested_by <> v_me or q.status <> 'used' then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform app.secure_log(p_tenant, q.client_id, v_me, 'export', q.reason, q.id);
  perform app.module_event(p_tenant, 'vault.copy', 'client', q.client_id, pg_catalog.jsonb_build_object('request', q.id));
  return true;
end
$$;

revoke all on function public.vault_set(uuid, uuid, text, text), public.vault_clear(uuid, uuid), public.vault_request(uuid, uuid, text),
  public.vault_decide(uuid, uuid, boolean), public.vault_reveal(uuid, uuid), public.vault_copied(uuid, uuid) from public, anon, service_role;
grant execute on function public.vault_set(uuid, uuid, text, text), public.vault_clear(uuid, uuid), public.vault_request(uuid, uuid, text),
  public.vault_decide(uuid, uuid, boolean), public.vault_reveal(uuid, uuid), public.vault_copied(uuid, uuid) to authenticated;

-- The scheduled job: closes what ran out, in every company. Service role only.
create or replace function public.vault_expire() returns integer
language sql security definer
set search_path = ''
as $$ select app.vault_expire_due(null) $$;
revoke all on function public.vault_expire() from public, anon, authenticated;
grant execute on function public.vault_expire() to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway: both collections are read only. The rows a person gets are decided by the policies above.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "reveals", "ord": 220, "relation": "reveal_requests", "order_by": "t.at desc, t.id",
  "fields": { "id": "id", "clientId": "client_id", "field": "field", "requestedBy": "requested_by", "reason": "reason", "at": "at", "status": "status",
              "approverId": "approver_id", "decidedAt": "decided_at", "expiresAt": "expires_at" }
}$j$);

do $log$
declare
  v_fields constant jsonb := $j${
    "id": "id", "at": "at", "clientId": "client_id", "userId": { "kind": "actor", "kind_col": "actor_kind", "id_col": "member_id" },
    "action": "action", "reason": "reason", "requestId": "request_id" }$j$;
begin
  perform app.ws_register(jsonb_build_object('name', 'secureLog', 'variant', 1, 'ord', 221, 'relation', 'secure_access_log',
    'read_caps', array['secureApprove'], 'order_by', 't.at desc, t.id', 'row_limit', 500, 'fields', v_fields));
  perform app.ws_register(jsonb_build_object('name', 'secureLog', 'variant', 2, 'ord', 221, 'relation', 'secure_access_log',
    'read_caps', array['audit'], 'order_by', 't.at desc, t.id', 'row_limit', 500, 'fields', v_fields));
  -- anyone else gets an empty list, not a refusal
  perform app.ws_register(jsonb_build_object('name', 'secureLog', 'variant', 3, 'ord', 221, 'relation', 'secure_access_log',
    'read_filter', 'false', 'fields', v_fields));
end
$log$;

select app.lockdown_check();
