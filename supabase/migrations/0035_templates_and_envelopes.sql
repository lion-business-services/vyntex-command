-- 0035 Document templates and signature requests (the brief, sections 17 and 18)
--   DocTemplate -> doc_templates          blocks[] -> doc_template_blocks (nested list, in order)
--   Envelope    -> envelopes              signers[] -> envelope_signers   (nested list; "order" = sign_order)
--                                         fields[]  -> envelope_fields    (nested list, in order)
--                                         events[]  -> envelopes.events   (a JSON list: an event has no id of its own
--                                                                          in types.ts, so it cannot be a nested list)
-- documents.template_id and documents.envelope_id (plain ids since 0012) become real links here.
--
-- Templates: everyone who works with documents reads them; the wording is company configuration ("config").
-- Approval is stamped by the database: whoever sets "approved" is recorded as the approver, at that moment.
--
-- Signature requests, and who writes what:
--   a person (through ws_apply)   prepares a request (status draft: signers, boxes), and voids one. Nothing else.
--   the server                    sends it, records a signer opening, signing or declining, completes it, expires it,
--                                 stores the signed copy. These are facts about people outside the company; a person
--                                 inside it cannot write them (the same rule as the delivery states of messages, 0013).
--   demo: true                    a sample request: nothing was sent and nothing is legally signed. A person may
--                                 write any state of such a row (that is how a sample workspace is stored), and the
--                                 flag can never be taken off afterwards, so a sample can never pass for the real thing.
-- The public signing page (token addressed) belongs to the next round; its tokens live in app.public_links (0040).

-- ---------------------------------------------------------------------------------------------------------------------
-- doc_templates and doc_template_blocks
-- ---------------------------------------------------------------------------------------------------------------------
create table public.doc_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  kind         text not null check (kind in ('contract', 'invoice', 'estimate', 'engagement_letter', 'service_order', 'service_agreement', 'consent_7216', 'poa_2848', 'upload', 'custom')),
  name         text not null check (length(btrim(name)) between 1 and 200),
  lang         text not null default 'en' check (lang in ('en', 'es', 'zh')),
  -- Where the wording came from. "starter" wording is a structure to edit, not legal text.
  source       text not null default 'company' check (source in ('supplied', 'company', 'starter')),
  -- False until the business has reviewed the wording.
  approved     boolean not null default false,
  approved_by  uuid,
  approved_at  timestamptz,
  active       boolean not null default true,
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint doc_templates_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint doc_templates_approval check (approved or (approved_by is null and approved_at is null)),
  foreign key (tenant_id, approved_by) references public.tenant_members (tenant_id, id) on delete set null (approved_by)
);
create index doc_templates_approved_by_idx on public.doc_templates (tenant_id, approved_by);
create index doc_templates_kind_idx on public.doc_templates (tenant_id, kind, lang);
select app.module_table('doc_templates', 'select, delete');
grant insert (id, tenant_id, kind, name, lang, source, approved, active, extra) on public.doc_templates to authenticated;
grant update (kind, name, lang, source, approved, active, extra) on public.doc_templates to authenticated;

create table public.doc_template_blocks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  template_id  uuid not null,
  -- heading, paragraph (with {{merge.fields}}), list, signature line
  type         text not null default 'p' check (type in ('h', 'p', 'list', 'sign')),
  text         text not null default '' check (length(text) <= 20000),
  position     integer not null default 0,
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint doc_template_blocks_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, template_id) references public.doc_templates (tenant_id, id) on delete cascade
);
create index doc_template_blocks_template_idx on public.doc_template_blocks (tenant_id, template_id, position);
select app.module_table('doc_template_blocks');

do $policies$
declare t text;
begin
  foreach t in array array['doc_templates', 'doc_template_blocks'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (tenant_id = any ((select app.tenants_can('documents'))::uuid[]))$f$, t || '_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (tenant_id = any ((select app.tenants_can('documents', 'config', 'write'))::uuid[]))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (tenant_id = any ((select app.tenants_can('documents', 'config', 'write'))::uuid[]))
      with check (tenant_id = any ((select app.tenants_can('documents', 'config', 'write'))::uuid[]))$f$, t || '_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
      using (tenant_id = any ((select app.tenants_can(%s))::uuid[]))$f$, t || '_delete', t,
      case when t = 'doc_template_blocks' then $c$'documents', 'config', 'write'$c$ else $c$'documents', 'config', 'write', 'delete'$c$ end);
  end loop;
end
$policies$;
create trigger doc_templates_audit after insert or update or delete on public.doc_templates for each row execute function app.audit_row();
create trigger doc_template_blocks_audit after insert or update or delete on public.doc_template_blocks for each row execute function app.audit_row('text');

-- Who approved the wording and when is what the session says, never what the row says.
create or replace function app.doc_templates_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if not coalesce(new.approved, false) then
    new.approved_by := null; new.approved_at := null;
  elsif tg_op = 'INSERT' or not old.approved then
    new.approved_by := app.current_member(new.tenant_id); new.approved_at := pg_catalog.now();
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end
$$;
revoke all on function app.doc_templates_stamp() from public, anon;
create trigger doc_templates_stamp before insert or update on public.doc_templates for each row execute function app.doc_templates_stamp();

alter table public.documents add constraint documents_template_fk foreign key (tenant_id, template_id)
  references public.doc_templates (tenant_id, id) on delete set null (template_id);
create index documents_template_idx on public.documents (tenant_id, template_id) where template_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- envelopes
-- ---------------------------------------------------------------------------------------------------------------------
create table public.envelopes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  doc_id         uuid not null,
  -- The client of the document, copied here by a trigger so the office scope can follow the client (0013).
  client_id      uuid,
  title          text not null default '' check (length(title) <= 300),
  status         text not null default 'draft' check (status in ('draft', 'sent', 'partly_signed', 'completed', 'declined', 'expired', 'void')),
  -- Signers sign one after another, in their order.
  ordered        boolean not null default false,
  created        timestamptz not null default now(),
  created_by     uuid,
  sent_at        timestamptz,
  expires_at     timestamptz,
  completed_at   timestamptz,
  -- Remind unsigned signers every N days.
  remind_every   integer check (remind_every between 1 and 365),
  last_reminder  timestamptz,
  -- [{ at, kind, signerId, note }], oldest first. A person only ever adds to the end of it.
  events         jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array' and octet_length(events::text) <= 262144),
  -- A sample request: nothing was sent and nothing is legally signed.
  demo           boolean not null default false,
  -- Signed copy with the completion certificate: { name, size, mime, path }. The bytes are in private storage.
  signed_file    jsonb check (jsonb_typeof(signed_file) = 'object' and not (signed_file ? 'dataUrl')),
  -- (larger than elsewhere: the signature screens keep the page layout of the request with it)
  extra          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  constraint envelopes_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 524288),
  constraint envelopes_completed check (status <> 'completed' or completed_at is not null),
  foreign key (tenant_id, doc_id) references public.documents (tenant_id, id) on delete restrict,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, created_by) references public.tenant_members (tenant_id, id) on delete set null (created_by)
);
create index envelopes_doc_idx on public.envelopes (tenant_id, doc_id);
create index envelopes_client_idx on public.envelopes (tenant_id, client_id);
create index envelopes_created_by_idx on public.envelopes (tenant_id, created_by);
create index envelopes_open_idx on public.envelopes (expires_at) where status in ('sent', 'partly_signed');
select app.module_table('envelopes', 'select, delete');
-- client_id is not a person's to write: it is copied from the document.
grant insert (id, tenant_id, doc_id, title, status, ordered, created, created_by, sent_at, expires_at, completed_at, remind_every, last_reminder, events, demo, signed_file, extra)
  on public.envelopes to authenticated;
grant update (doc_id, title, status, ordered, created, sent_at, expires_at, completed_at, remind_every, last_reminder, events, demo, signed_file, extra)
  on public.envelopes to authenticated;

-- client_id follows the document whenever the document of a request is set. SECURITY DEFINER: the person may not
-- hold "documents". (A direct write of client_id is the server's alone, and still has to pass the foreign key.)
create or replace function app.envelopes_client() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.client_id := (select d.client_id from public.documents d where d.tenant_id = new.tenant_id and d.id = new.doc_id);
  return new;
end
$$;
revoke all on function app.envelopes_client() from public, anon, authenticated, service_role;
create trigger envelopes_00_client before insert or update of doc_id on public.envelopes for each row execute function app.envelopes_client();

-- ... and when the document moves to another client, its signature requests move with it.
create or replace function app.documents_client_moved() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.envelopes e set client_id = new.client_id where e.tenant_id = new.tenant_id and e.doc_id = new.id and e.client_id is distinct from new.client_id;
  return null;
end
$$;
revoke all on function app.documents_client_moved() from public, anon, authenticated, service_role;
create trigger documents_client_moved after update of client_id on public.documents
  for each row when (old.client_id is distinct from new.client_id) execute function app.documents_client_moved();

create policy envelopes_select on public.envelopes for select to authenticated
  using (tenant_id = any ((select app.tenants_can('esign'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy envelopes_insert on public.envelopes for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy envelopes_update on public.envelopes for update to authenticated
  using (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())))
  with check (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy envelopes_delete on public.envelopes for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('esign', 'write', 'delete'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create trigger envelopes_audit after insert or update or delete on public.envelopes
  for each row execute function app.audit_row('events', 'extra');

alter table public.documents add constraint documents_envelope_fk foreign key (tenant_id, envelope_id)
  references public.envelopes (tenant_id, id) on delete set null (envelope_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- envelope_signers and envelope_fields
-- ---------------------------------------------------------------------------------------------------------------------
create table public.envelope_signers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  envelope_id  uuid not null,
  name         text not null default '' check (length(name) <= 200),
  email        text not null default '' check (length(email) <= 320),
  role         text check (length(role) <= 80),
  sign_order   integer not null default 1 check (sign_order between 0 and 1000),
  status       text not null default 'waiting' check (status in ('waiting', 'sent', 'viewed', 'signed', 'declined')),
  viewed_at    timestamptz,
  signed_at    timestamptz,
  typed_name   text check (length(typed_name) <= 200),
  -- The drawn signature: a path in private storage, or a small image. Never larger than a signature needs.
  signature    text check (length(signature) <= 200000),
  consent      boolean,
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint envelope_signers_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 262144),
  constraint envelope_signers_signed check (status <> 'signed' or signed_at is not null),
  foreign key (tenant_id, envelope_id) references public.envelopes (tenant_id, id) on delete cascade
);
create index envelope_signers_envelope_idx on public.envelope_signers (tenant_id, envelope_id, sign_order);
select app.module_table('envelope_signers');

create table public.envelope_fields (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  envelope_id  uuid not null,
  signer_id    uuid not null,
  type         text not null check (type in ('signature', 'initials', 'date', 'text', 'checkbox')),
  page         integer not null default 1 check (page between 1 and 2000),
  -- Position and size, as fractions of the page (0 to 1).
  x            double precision not null default 0 check (x between 0 and 1),
  y            double precision not null default 0 check (y between 0 and 1),
  w            double precision not null default 0 check (w between 0 and 1),
  h            double precision not null default 0 check (h between 0 and 1),
  label        text check (length(label) <= 200),
  required     boolean not null default true,
  value        text check (length(value) <= 2000),
  position     integer not null default 0,
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint envelope_fields_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, envelope_id) references public.envelopes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, signer_id) references public.envelope_signers (tenant_id, id) on delete cascade
);
create index envelope_fields_envelope_idx on public.envelope_fields (tenant_id, envelope_id, position);
create index envelope_fields_signer_idx on public.envelope_fields (tenant_id, signer_id);
select app.module_table('envelope_fields');

-- Signers and boxes follow their request: a person reads and writes them when they can read the request itself
-- (so the office scope of the client reaches the names and addresses of its signers too).
do $children$
declare t text;
begin
  foreach t in array array['envelope_signers', 'envelope_fields'] loop
    execute format($f$create policy %1$I on public.%2$I for select to authenticated
      using (tenant_id = any ((select app.tenants_can('esign'))::uuid[])
        and exists (select 1 from public.envelopes e where e.tenant_id = %2$I.tenant_id and e.id = %2$I.envelope_id))$f$, t || '_select', t);
    execute format($f$create policy %1$I on public.%2$I for insert to authenticated
      with check (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
        and exists (select 1 from public.envelopes e where e.tenant_id = %2$I.tenant_id and e.id = %2$I.envelope_id))$f$, t || '_insert', t);
    execute format($f$create policy %1$I on public.%2$I for update to authenticated
      using (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
        and exists (select 1 from public.envelopes e where e.tenant_id = %2$I.tenant_id and e.id = %2$I.envelope_id))
      with check (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
        and exists (select 1 from public.envelopes e where e.tenant_id = %2$I.tenant_id and e.id = %2$I.envelope_id))$f$, t || '_update', t);
    execute format($f$create policy %1$I on public.%2$I for delete to authenticated
      using (tenant_id = any ((select app.tenants_can('esign', 'write'))::uuid[])
        and exists (select 1 from public.envelopes e where e.tenant_id = %2$I.tenant_id and e.id = %2$I.envelope_id))$f$, t || '_delete', t);
  end loop;
end
$children$;
create trigger envelope_signers_audit after insert or update or delete on public.envelope_signers
  for each row execute function app.audit_row('email', 'signature', 'extra');

-- ---------------------------------------------------------------------------------------------------------------------
-- What a signed-in person may not write (see the head of this file). SECURITY INVOKER guards that look at who runs
-- the statement: the server and the functions of the next round run as another role and pass.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.envelopes_person_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if not old.demo and old.status not in ('draft', 'void') then
      raise exception 'A signature request that was sent is evidence: it can be voided, not removed' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := app.current_member(new.tenant_id);
    if not coalesce(new.demo, false) and (new.status not in ('draft', 'void') or new.sent_at is not null or new.completed_at is not null
        or new.last_reminder is not null or new.signed_file is not null) then
      raise exception 'Only the server records a signature request as sent, signed, completed, declined or expired' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.demo is distinct from old.demo then
    raise exception 'A sample signature request stays a sample' using errcode = '42501';
  end if;
  new.created_by := old.created_by;
  if not old.demo then
    if (new.status <> old.status and new.status <> 'void')
       or (new.sent_at, new.completed_at, new.last_reminder, new.signed_file) is distinct from (old.sent_at, old.completed_at, old.last_reminder, old.signed_file)
       or (old.status <> 'draft' and new.doc_id <> old.doc_id) then
      raise exception 'Only the server records a signature request as sent, signed, completed, declined or expired' using errcode = '42501';
    end if;
    -- the trail of a request only grows: what is already in it stays, in place
    n := pg_catalog.jsonb_array_length(old.events);
    if n > 0 and (pg_catalog.jsonb_array_length(new.events) < n
        or pg_catalog.jsonb_path_query_array(new.events, ('$[0 to ' || (n - 1) || ']')::jsonpath) <> old.events) then
      raise exception 'The trail of a signature request cannot be rewritten' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.envelopes_person_guard() from public, anon;
create trigger envelopes_person_guard before insert or update or delete on public.envelopes
  for each row execute function app.envelopes_person_guard();

-- What the guards of signers and boxes need to know about the request they belong to. SECURITY DEFINER because the
-- answer must not depend on what the caller may read; it says only "sample or not" and the status.
create or replace function app.envelope_state(p_tenant uuid, p_envelope uuid, out demo boolean, out status text)
language sql stable security definer
set search_path = ''
as $$ select e.demo, e.status from public.envelopes e where e.tenant_id = p_tenant and e.id = p_envelope $$;
revoke all on function app.envelope_state(uuid, uuid) from public, anon;
grant execute on function app.envelope_state(uuid, uuid) to authenticated;

create or replace function app.envelope_parts_person_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s record;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    select * into s from app.envelope_state(old.tenant_id, old.envelope_id);
  else
    select * into s from app.envelope_state(new.tenant_id, new.envelope_id);
  end if;
  -- (when the request itself is being removed, its parts go with it through the foreign key: no state is found)
  if s.demo is null then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if s.demo then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- a real request: its signers and boxes are arranged while it is a draft, and belong to the server afterwards
  if s.status <> 'draft' then
    raise exception 'The signers and boxes of a request that was sent cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_table_name = 'envelope_signers' then
    if new.status <> 'waiting' or new.viewed_at is not null or new.signed_at is not null or new.typed_name is not null
       or new.signature is not null or new.consent is not null then
      raise exception 'Only the server records that a signer opened, signed or declined' using errcode = '42501';
    end if;
  elsif new.value is not null then
    raise exception 'Only the signer fills in a box' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.envelope_parts_person_guard() from public, anon;
create trigger envelope_signers_person_guard before insert or update or delete on public.envelope_signers
  for each row execute function app.envelope_parts_person_guard();
create trigger envelope_fields_person_guard before insert or update or delete on public.envelope_fields
  for each row execute function app.envelope_parts_person_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. Templates (65) before documents (70); requests (75) after them. A document names its request and the
-- request names its document, so the document's link is written last ("defer"): "docs" is registered again for that,
-- with the same map as in 0018 otherwise.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "templates", "ord": 65, "relation": "doc_templates",
  "read_caps": ["documents"], "write_caps": ["documents", "config"], "delete_caps": ["delete"], "order_by": "t.created_at, t.name, t.id",
  "fields": { "id": "id", "kind": "kind", "name": "name", "lang": "lang", "source": "source", "approved": "approved",
              "approvedBy": { "col": "approved_by", "ro": true }, "approvedAt": { "col": "approved_at", "ro": true }, "active": "active" }
}$j$);
select app.ws_register($j${
  "name": "templates.blocks", "parent": "templates", "parent_field": "blocks", "parent_col": "template_id", "relation": "doc_template_blocks",
  "read_caps": ["documents"], "write_caps": ["documents", "config"], "position_col": "position",
  "fields": { "id": "id", "type": "type", "text": { "col": "text", "empty": "" } }
}$j$);

select app.ws_register($j${
  "name": "envelopes", "ord": 75, "relation": "envelopes",
  "read_caps": ["esign"], "write_caps": ["esign"], "delete_caps": ["delete"], "order_by": "t.created desc, t.id",
  "fields": {
    "id": "id", "docId": "doc_id", "title": { "col": "title", "empty": "" }, "status": "status", "ordered": "ordered", "created": "created",
    "createdBy": { "col": "created_by", "stamp": "member" }, "sentAt": "sent_at", "expiresAt": "expires_at", "completedAt": "completed_at",
    "remindEvery": "remind_every", "lastReminder": "last_reminder", "events": "events", "demo": { "col": "demo", "omit": false },
    "signedFile": "signed_file"
  }
}$j$);
select app.ws_register($j${
  "name": "envelopes.signers", "ord": 1, "parent": "envelopes", "parent_field": "signers", "parent_col": "envelope_id", "relation": "envelope_signers",
  "read_caps": ["esign"], "write_caps": ["esign"], "order_by": "c.sign_order, c.created_at, c.id",
  "fields": { "id": "id", "name": { "col": "name", "empty": "" }, "email": { "col": "email", "empty": "" }, "role": "role", "order": "sign_order",
              "status": "status", "viewedAt": "viewed_at", "signedAt": "signed_at", "typedName": "typed_name", "signature": "signature", "consent": "consent" }
}$j$);
select app.ws_register($j${
  "name": "envelopes.fields", "ord": 2, "parent": "envelopes", "parent_field": "fields", "parent_col": "envelope_id", "relation": "envelope_fields",
  "read_caps": ["esign"], "write_caps": ["esign"], "position_col": "position",
  "fields": { "id": "id", "signerId": "signer_id", "type": "type", "page": "page", "x": "x", "y": "y", "w": "w", "h": "h", "label": "label",
              "required": "required", "value": "value" }
}$j$);

select app.ws_register($j${
  "name": "docs", "ord": 70, "relation": "documents", "read_caps": ["documents"], "write_caps": ["documents"], "delete_caps": ["delete"],
  "order_by": "t.created desc, t.number desc, t.id",
  "fields": {
    "id": "id", "kind": "kind", "number": "number", "title": "title",
    "jobId": { "col": "job_id", "empty": "" }, "clientId": { "col": "client_id", "empty": "" },
    "status": "status", "created": "created", "updated": "updated", "edits": { "col": "edits", "omit": {} },
    "esign": { "kind": "obj", "ro": true, "cols": {
      "signerName": "esign_signer_name", "signerEmail": "esign_signer_email", "status": "esign_status", "sentAt": "esign_sent_at",
      "viewedAt": "esign_viewed_at", "signedAt": "esign_signed_at", "typedName": "esign_typed_name", "consent": "esign_consent" } },
    "templateId": "template_id", "file": "file", "versions": "versions", "folder": "folder",
    "envelopeId": { "col": "envelope_id", "defer": true }, "leadId": "lead_id"
  } }$j$);

select app.lockdown_check();
