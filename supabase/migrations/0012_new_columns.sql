-- 0012 New columns and child tables
-- The fields added to src/domain/types.ts for this build, on the tables that already exist. Same rules as 0002:
-- tenant_id everywhere, composite foreign keys, money numeric(12,2), typed columns for anything filtered or reported on.
--
-- Every tenant table also gets  extra jsonb not null default '{}'  (docs/MASTER-BUILD-SPEC.md, section 7). The gateway
-- (0014 to 0016) stores any field it has no column for in "extra" and returns it merged into the row, so a field the
-- app adds later is never lost and never silently dropped: it shows up in "extra" until a migration gives it a column.
--
-- How the new fields map (in addition to the list at the top of 0002):
--   Company.legalName / address / website / timezone -> tenants.legal_name / address / website / timezone
--   TeamUser.title, bio, photo, languages, officeIds, inLeadPool -> tenant_members.title, bio, photo, languages, office_ids, in_lead_pool
--   TeamUser.away { from, to, note }  -> tenant_members.away_from / away_to / away_note
--   TeamUser.active                   -> tenant_members.status <> 'disabled'
--   TeamUser.invitedAt / lastSeen     -> tenant_members.invited_at / last_seen_at     (mfa is never stored: it comes from sign-in)
--   Lead.nextAction { text, due }     -> leads.next_action_text / next_action_due
--   Lead.handoffs[]                   -> lead_handoffs (append only)
--   Lead.lastContact, originalOwnerId, lostAt, sourceDetail, serviceIds, lang, kind, smsOptIn, officeId -> columns on leads
--   Client.owners[] / contacts[]      -> client_people (role 'owner' or 'contact')
--   Client.taxIdType / taxIdLast4     -> clients.tax_id_type / tax_id_last4, copied from client_secrets by a trigger
--   the tax ID itself                 -> client_secrets.tax_id_enc (encrypted; no policy lets anyone read this table)
--   Client.assignedTo                 -> clients.assigned_to          Client.externalIds -> clients.external_ids (jsonb)
--   Job.serviceId, tierId, period, parentId, officeId -> columns on jobs      Job.repeat gains quarterly and yearly
--   Note.mentions                     -> notes.mentions
--   Task.type, requestedBy, channel, apptId -> tasks.type / requested_by / channel / appt_id
--   Task.comments[]                   -> task_comments
--   DocRecord.templateId, file, versions, folder, envelopeId, leadId -> columns on documents
--   Message.dir, from, threadId, clientId, by, read, provider, externalId, error, seconds, attachments
--                                     -> messages.dir / sender / thread_id / client_id / by_member_id / read / provider / external_id / error / seconds / attachments
--   AutomationRun.status, error, dedupe -> columns on automation_runs
--   CompanyConfig.routing             -> lead_routing (one row per company; the turn is locked there)
--   DemoState.readNotifications       -> member_state.read_notifications (one row per person)
--
-- Columns that point at module tables which do not exist yet are plain uuid columns for now:
--   office_id (clients, leads, jobs), tenant_members.office_ids, service_id and tier_id (jobs), leads.service_ids,
--   tasks.appt_id, documents.template_id and envelope_id.
-- The module migrations (0030 and later) add the foreign keys when they create offices, catalog, appointments,
-- templates and envelopes.

-- ---------------------------------------------------------------------------------------------------------------------
-- "extra" on every tenant table that exists so far (not on the audit log: evidence is never extended by the app)
-- ---------------------------------------------------------------------------------------------------------------------
do $extra$
declare r record;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('audit_log', 'industries', 'demo_requests')
      and not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attname = 'extra' and not a.attisdropped)
    order by c.relname
  loop
    execute format('alter table public.%I add column extra jsonb not null default ''{}''::jsonb', r.relname);
    -- an object, and small: "extra" is for presentation attributes, not for files or blobs
    execute format('alter table public.%I add constraint %I check (pg_catalog.jsonb_typeof(extra) = ''object'' and pg_catalog.octet_length(extra::text) <= 65536)',
      r.relname, r.relname || '_extra_shape');
  end loop;
end
$extra$;

-- ---------------------------------------------------------------------------------------------------------------------
-- tenants (Company)
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.tenants
  add column legal_name text check (pg_catalog.length(legal_name) <= 200),
  add column address    text check (pg_catalog.length(address) <= 400),
  add column website    text check (pg_catalog.length(website) <= 300),
  -- IANA time zone, for example America/New_York.
  add column timezone   text check (timezone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  -- A logo is a file in private storage and the row keeps its path. An image pasted into the row would be sent to
  -- every person on every load.
  add constraint tenants_logo_is_a_path check (coalesce(branding ->> 'logo', '') not like 'data:%');

-- ---------------------------------------------------------------------------------------------------------------------
-- tenant_members (TeamUser)
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.tenant_members
  add column title         text check (pg_catalog.length(title) <= 120),
  add column bio           text check (pg_catalog.length(bio) <= 2000),
  -- Path of the photo in private storage.
  add column photo         text check (pg_catalog.length(photo) <= 500 and photo not like 'data:%'),
  add column languages     text[] check (languages <@ array['en', 'es', 'zh']::text[]),
  -- Offices the person works from (offices table: module migrations). Empty means "no office in particular".
  add column office_ids    uuid[] not null default '{}'::uuid[],
  -- Takes part in automatic lead assignment. NULL means "not said": the routing pool decides.
  add column in_lead_pool  boolean,
  -- Out of office: skipped by automatic assignment between these dates.
  add column away_from     date,
  add column away_to       date,
  add column away_note     text check (pg_catalog.length(away_note) <= 300),
  add column invited_at    timestamptz,
  add column last_seen_at  timestamptz,
  add constraint tenant_members_away_pair check ((away_from is null) = (away_to is null) and (away_to is null or away_to >= away_from));

-- ---------------------------------------------------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.clients
  add column kind             text check (kind in ('individual', 'business')),
  -- Client type id from the edition or the company's configuration.
  add column client_type      text check (client_type is null or app.is_option_id(client_type)),
  add column birthday         date,
  add column lang             text check (lang in ('en', 'es', 'zh')),
  -- What kind of tax ID is on file, and its last four digits for recognition. Both are copied from client_secrets by a
  -- trigger and can be written no other way (see app.clients_tax_guard below).
  add column tax_id_type      text check (tax_id_type in ('ssn', 'ein', 'itin')),
  add column tax_id_last4     text check (tax_id_last4 ~ '^[0-9]{4}$'),
  add column sms_opt_in       boolean,
  add column whatsapp_opt_in  boolean,
  add column whatsapp         text check (pg_catalog.length(whatsapp) <= 40),
  -- { "facebook": "...", "instagram": "..." }
  add column social           jsonb check (pg_catalog.jsonb_typeof(social) = 'object'),
  add column office_id        uuid,
  add column assigned_to      uuid,
  add column lifecycle        text check (lifecycle in ('active', 'inactive', 'former')),
  add column tags             text[],
  add column referred_by      text check (pg_catalog.length(referred_by) <= 200),
  -- Ids of this client in connected systems: { "square": "...", "quickbooks": "..." }. Unique per provider (below).
  add column external_ids     jsonb check (pg_catalog.jsonb_typeof(external_ids) = 'object'),
  add constraint clients_tax_pair check ((tax_id_type is null) = (tax_id_last4 is null)),
  add constraint clients_assigned_fk foreign key (tenant_id, assigned_to)
    references public.tenant_members (tenant_id, id) on delete set null (assigned_to);
create index clients_assigned_idx on public.clients (tenant_id, assigned_to);
create index clients_office_idx on public.clients (tenant_id, office_id) where office_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- client_people: owners or officers of a business client, and other people to contact there.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.client_people (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  client_id   uuid not null,
  -- 'owner' = Client.owners[], 'contact' = Client.contacts[]
  role        text not null check (role in ('owner', 'contact')),
  name        text not null check (length(btrim(name)) > 0),
  title       text,
  phone       text,
  email       text,
  -- Ownership percentage, when known.
  pct         numeric(5,2) check (pct between 0 and 100),
  is_primary  boolean,
  -- Place in the list, so the people come back in the order they were entered.
  position    integer not null default 0,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint client_people_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade
);
create index client_people_client_idx on public.client_people (tenant_id, client_id, role, position);

-- ---------------------------------------------------------------------------------------------------------------------
-- client_secrets: the tax ID of a client, encrypted with app.encrypt_pii (0005). One row per client.
-- No policy exists for this table and no application role holds a privilege on it, the service role included:
-- the only way in or out is a SECURITY DEFINER function that checks the caller and writes the audit entry
-- (the vault functions of the module migrations). tax_id_type and last4 are what may be shown; a trigger copies
-- them to the client row so screens never need this table.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.client_secrets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  client_id    uuid not null,
  tax_id_enc   bytea not null,
  tax_id_type  text not null check (tax_id_type in ('ssn', 'ein', 'itin')),
  last4        text not null check (last4 ~ '^[0-9]{4}$'),
  -- auth.users id of the person who stored it.
  set_by       uuid,
  set_at       timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, client_id),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade
);

-- Keeps clients.tax_id_type / tax_id_last4 equal to what the secret says. SECURITY DEFINER because it must update
-- the two columns nobody else may write.
create or replace function app.client_secret_sync() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.clients set tax_id_type = null, tax_id_last4 = null where tenant_id = old.tenant_id and id = old.client_id;
    return old;
  end if;
  update public.clients set tax_id_type = new.tax_id_type, tax_id_last4 = new.last4 where tenant_id = new.tenant_id and id = new.client_id;
  return new;
end
$$;
revoke all on function app.client_secret_sync() from public, anon, authenticated, service_role;
create trigger client_secrets_sync after insert or update or delete on public.client_secrets
  for each row execute function app.client_secret_sync();

-- The two display columns only ever change from inside the trigger above (trigger depth 2 or more). A direct write,
-- by anyone, is refused: nobody can make a client look as if a tax ID were on file, or swap the last four digits.
create or replace function app.clients_tax_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.pg_trigger_depth() < 2
     and ((tg_op = 'INSERT' and (new.tax_id_type is not null or new.tax_id_last4 is not null))
       or (tg_op = 'UPDATE' and (new.tax_id_type is distinct from old.tax_id_type or new.tax_id_last4 is distinct from old.tax_id_last4))) then
    raise exception 'The tax ID fields of a client are set through the vault, not by editing the client'
      using errcode = '42501', constraint = 'clients_tax_fields_vault_only';
  end if;
  return new;
end
$$;
revoke all on function app.clients_tax_guard() from public, anon;
create trigger clients_tax_guard before insert or update of tax_id_type, tax_id_last4 on public.clients
  for each row execute function app.clients_tax_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.leads
  -- What happens next and when. A lead without one shows up as needing attention.
  add column next_action_text   text check (pg_catalog.length(next_action_text) <= 500),
  add column next_action_due    date,
  add column last_contact       timestamptz,
  -- First owner, kept when the lead is handed to someone else.
  add column original_owner_id  uuid,
  add column lost_at            date,
  -- Free text next to the source: the campaign, the person who referred them.
  add column source_detail      text check (pg_catalog.length(source_detail) <= 300),
  -- Catalog services the person asked about (catalog table: module migrations).
  add column service_ids        uuid[],
  add column lang               text check (lang in ('en', 'es', 'zh')),
  add column kind               text check (kind in ('individual', 'business')),
  add column sms_opt_in         boolean,
  add column office_id          uuid,
  add constraint leads_original_owner_fk foreign key (tenant_id, original_owner_id)
    references public.tenant_members (tenant_id, id) on delete set null (original_owner_id);
create index leads_original_owner_idx on public.leads (tenant_id, original_owner_id);
create index leads_office_idx on public.leads (tenant_id, office_id) where office_id is not null;
create index leads_next_action_idx on public.leads (tenant_id, next_action_due) where next_action_due is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- lead_handoffs: a lead changing hands. Append only, so the history is never lost (the brief, section 8).
-- ---------------------------------------------------------------------------------------------------------------------
create table public.lead_handoffs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  lead_id         uuid not null,
  at              timestamptz not null default now(),
  -- NULL when the lead had no owner before.
  from_member_id  uuid,
  to_member_id    uuid,
  -- Who made the change: a person, or the assignment itself ('automation' for the rotation and for rules).
  by_kind         text not null default 'member' check (by_kind in ('member', 'automation', 'system')),
  by_member_id    uuid,
  reason          text check (length(reason) <= 500),
  how             text not null default 'manual' check (how in ('manual', 'round_robin', 'rule')),
  extra           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  constraint lead_handoffs_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint lead_handoffs_by_pair check ((by_kind = 'member') or (by_member_id is null)),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, from_member_id) references public.tenant_members (tenant_id, id) on delete set null (from_member_id),
  foreign key (tenant_id, to_member_id) references public.tenant_members (tenant_id, id) on delete set null (to_member_id),
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id)
);
create index lead_handoffs_lead_idx on public.lead_handoffs (tenant_id, lead_id, at);
create index lead_handoffs_from_idx on public.lead_handoffs (tenant_id, from_member_id);
create index lead_handoffs_to_idx on public.lead_handoffs (tenant_id, to_member_id);
create index lead_handoffs_by_idx on public.lead_handoffs (tenant_id, by_member_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- lead_routing: automatic lead assignment (CompanyConfig.routing). One row per company.
-- The turn ("cursor") lives here so public.lead_assign_next (0017) can lock this row: two leads arriving at the same
-- moment wait for each other and never get the same turn.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.lead_routing (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null unique references public.tenants (id) on delete restrict,
  mode            text not null default 'manual' check (mode in ('manual', 'round_robin')),
  -- tenant_members ids in turn order.
  pool            uuid[] not null default '{}'::uuid[],
  -- Index in pool of the person who gets the next lead.
  cursor          integer not null default 0 check (cursor >= 0),
  -- People left out without removing them from the pool.
  exclude         uuid[] not null default '{}'::uuid[],
  -- Skip people who are marked away.
  skip_away       boolean not null default true,
  -- Who gets the lead when nobody in the pool is available.
  fallback_id     uuid,
  -- Kept by lead_assign_next: how many turns were handed out, and to whom last.
  turns           bigint not null default 0,
  last_member_id  uuid,
  extra           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  constraint lead_routing_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint lead_routing_pool_size check (cardinality(pool) <= 200 and cardinality(exclude) <= 200),
  foreign key (tenant_id, fallback_id) references public.tenant_members (tenant_id, id) on delete set null (fallback_id),
  foreign key (tenant_id, last_member_id) references public.tenant_members (tenant_id, id) on delete set null (last_member_id)
);
create index lead_routing_fallback_idx on public.lead_routing (tenant_id, fallback_id);
create index lead_routing_last_idx on public.lead_routing (tenant_id, last_member_id);

-- Everyone in the pool and the exclusion list must be an office member of the same company. An array cannot carry
-- a foreign key, so a trigger checks it. SECURITY DEFINER: the person saving the routing may not read every member.
create or replace function app.lead_routing_check() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_bad text;
begin
  select coalesce(x.member::text, 'an empty entry') into v_bad
  from pg_catalog.unnest(new.pool || new.exclude) as x(member)
  where x.member is null or not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = new.tenant_id and m.id = x.member and m.role = any (app.office_roles()))
  limit 1;
  if v_bad is not null then
    raise exception 'Lead routing: % is not an office member of this company', v_bad
      using errcode = '23503', constraint = 'lead_routing_members';
  end if;
  return new;
end
$$;
revoke all on function app.lead_routing_check() from public, anon, authenticated, service_role;
create trigger lead_routing_check before insert or update of pool, exclude on public.lead_routing
  for each row execute function app.lead_routing_check();

-- ---------------------------------------------------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.jobs drop constraint jobs_repeat_check;
alter table public.jobs
  add constraint jobs_repeat_check check (repeat in ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  -- Catalog service and price tier this work was created from (catalog tables: module migrations).
  add column service_id  uuid,
  add column tier_id     uuid,
  -- Period the work covers, as the business writes it: "2025", "Q3 2026", "October 2026".
  add column period      text check (pg_catalog.length(period) <= 60),
  -- For repeating work: the earlier job this one follows.
  add column parent_id   uuid,
  add column office_id   uuid,
  add constraint jobs_parent_fk foreign key (tenant_id, parent_id) references public.jobs (tenant_id, id) on delete set null (parent_id),
  add constraint jobs_not_own_parent check (parent_id is null or parent_id <> id);
create index jobs_parent_idx on public.jobs (tenant_id, parent_id);
create index jobs_service_idx on public.jobs (tenant_id, service_id) where service_id is not null;
create index jobs_office_idx on public.jobs (tenant_id, office_id) where office_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------------------------------------------------
-- tenant_members ids mentioned in the note.
alter table public.notes add column mentions uuid[];

-- ---------------------------------------------------------------------------------------------------------------------
-- tasks and task_comments
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.tasks
  -- Task type id from the edition or the company's configuration, for example todo, client_request, call.
  add column type          text check (type is null or app.is_option_id(type)),
  -- For a client request: who asked, and how it arrived.
  add column requested_by  text check (pg_catalog.length(requested_by) <= 200),
  add column channel       text check (channel in ('email', 'text', 'whatsapp', 'facebook', 'instagram', 'call', 'system')),
  -- Appointment this task belongs to (appointments table: module migrations).
  add column appt_id       uuid;
create index tasks_appt_idx on public.tasks (tenant_id, appt_id) where appt_id is not null;

create table public.task_comments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  task_id       uuid not null,
  at            timestamptz not null default now(),
  by_member_id  uuid,
  text          text not null check (length(btrim(text)) > 0),
  mentions      uuid[],
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint task_comments_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id) on delete cascade,
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id)
);
create index task_comments_task_idx on public.task_comments (tenant_id, task_id, at);
create index task_comments_by_idx on public.task_comments (tenant_id, by_member_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- documents
-- A document may now belong to a client or a lead without a job (an uploaded file, an engagement letter for a
-- prospect), so job_id and client_id become optional; one of the three links is always there.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.documents drop constraint documents_kind_check;
alter table public.documents
  add constraint documents_kind_check check (kind in (
    'contract', 'invoice', 'estimate', 'engagement_letter', 'service_order', 'service_agreement', 'consent_7216', 'poa_2848', 'upload', 'custom')),
  alter column job_id drop not null,
  alter column client_id drop not null,
  -- Template the document was made from, and the signature request for it (templates, envelopes: module migrations).
  add column template_id  uuid,
  add column envelope_id  uuid,
  -- Uploaded file or signed copy: { name, size, mime, path }. The path points into private storage; the bytes are never here.
  add column file         jsonb check (pg_catalog.jsonb_typeof(file) = 'object' and not (file ? 'dataUrl')),
  -- [{ v, at, by, note, file }]
  add column versions     jsonb check (pg_catalog.jsonb_typeof(versions) = 'array' and versions::text not like '%"dataUrl"%'),
  add column folder       text check (pg_catalog.length(folder) <= 200),
  add column lead_id      uuid,
  add constraint documents_has_parent check (num_nonnulls(job_id, client_id, lead_id) >= 1),
  add constraint documents_lead_fk foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null (lead_id);
create index documents_lead_idx on public.documents (tenant_id, lead_id);
create index documents_envelope_idx on public.documents (tenant_id, envelope_id) where envelope_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- messages: the communications center. More channels, both directions, threads, and the provider's own ids.
-- Delivery states (queued, sent, delivered, failed, received) are facts reported by a provider: only the server
-- (service role) writes them. A signed-in person writes drafts; "demo" exists for sample workspaces only (0013).
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.messages drop constraint messages_channel_check;
alter table public.messages drop constraint messages_status_check;
alter table public.messages drop constraint messages_ref_type_check;
alter table public.messages
  add constraint messages_channel_check check (channel in ('email', 'text', 'whatsapp', 'facebook', 'instagram', 'call', 'system')),
  add constraint messages_status_check check (status in ('draft', 'demo', 'queued', 'sent', 'delivered', 'failed', 'received')),
  add constraint messages_ref_type_check check (ref_type in (
    'lead', 'client', 'job', 'task', 'worker', 'doc', 'payment', 'appointment', 'service', 'opportunity', 'envelope', 'review', 'post', 'cash', 'compliance', 'user')),
  -- 'in' for something the client sent us. NULL means outgoing.
  add column dir           text check (dir in ('out', 'in')),
  add column sender        text check (pg_catalog.length(sender) <= 320),
  -- Messages with the same thread id are shown as one conversation.
  add column thread_id     text check (pg_catalog.length(thread_id) <= 200),
  add column client_id     uuid,
  -- The person who wrote an outgoing message.
  add column by_member_id  uuid,
  -- False for an incoming message nobody has opened yet.
  add column read          boolean,
  add column provider      text check (provider in ('gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai')),
  -- The provider's id for this message or call. Unique per provider (below), so a retried webhook cannot add it twice.
  add column external_id   text check (pg_catalog.length(external_id) <= 300),
  add column error         text check (pg_catalog.length(error) <= 1000),
  -- Calls: length in seconds.
  add column seconds       integer check (seconds >= 0),
  -- [{ name, size, mime, path }]
  add column attachments   jsonb check (pg_catalog.jsonb_typeof(attachments) = 'array' and attachments::text not like '%"dataUrl"%'),
  add constraint messages_client_fk foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  add constraint messages_by_fk foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id),
  add constraint messages_external_pair check (external_id is null or provider is not null);
create index messages_client_idx on public.messages (tenant_id, client_id, at desc);
create index messages_by_idx on public.messages (tenant_id, by_member_id);
create index messages_thread_idx on public.messages (tenant_id, thread_id) where thread_id is not null;
create unique index messages_external_uidx on public.messages (tenant_id, provider, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- activity and automation_runs: the wider list of record types, and the outcome of a run
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.activity drop constraint activity_ref_type_check;
alter table public.activity add constraint activity_ref_type_check check (ref_type in (
  'lead', 'client', 'job', 'task', 'worker', 'doc', 'payment', 'appointment', 'service', 'opportunity', 'envelope', 'review', 'post', 'cash', 'compliance', 'user'));

alter table public.automation_runs drop constraint automation_runs_ref_type_check;
alter table public.automation_runs
  add constraint automation_runs_ref_type_check check (ref_type in (
    'lead', 'client', 'job', 'task', 'worker', 'doc', 'payment', 'appointment', 'service', 'opportunity', 'envelope', 'review', 'post', 'cash', 'compliance', 'user')),
  -- NULL means it ran fine.
  add column status  text check (status in ('ok', 'failed', 'skipped')),
  add column error   text check (pg_catalog.length(error) <= 1000),
  -- The same rule never runs twice for the same key (rule + record + occasion).
  add column dedupe  text check (pg_catalog.length(dedupe) <= 300);
create unique index automation_runs_dedupe_uidx on public.automation_runs (tenant_id, dedupe) where dedupe is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- Languages: Chinese is offered where a deployment lists it.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.demo_requests drop constraint demo_requests_language_check;
alter table public.demo_requests add constraint demo_requests_language_check check (language in ('en', 'es', 'zh'));
alter table public.consent_records drop constraint consent_records_language_check;
alter table public.consent_records add constraint consent_records_language_check check (language in ('en', 'es', 'zh'));

-- ---------------------------------------------------------------------------------------------------------------------
-- member_state: small things a person keeps for themselves in one company (which notifications they dismissed).
-- ---------------------------------------------------------------------------------------------------------------------
create table public.member_state (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  member_id           uuid not null,
  read_notifications  text[] not null default '{}'::text[] check (cardinality(read_notifications) <= 2000),
  extra               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, member_id),
  constraint member_state_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------------------------------
-- ws_requests: idempotency keys of the gateway (the brief, section 89). The same key from the same person in the
-- same company returns the stored answer instead of applying the changes again (public.ws_apply, 0016).
-- ---------------------------------------------------------------------------------------------------------------------
create table public.ws_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  -- auth.users id of the caller.
  user_id       uuid not null,
  key           text not null check (length(key) between 8 and 200),
  -- SHA-256 of the request, so a key reused for a different request is refused instead of answered wrongly.
  request_hash  text not null,
  -- NULL while the first call is still running.
  result        jsonb,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id, key)
);
create index ws_requests_created_idx on public.ws_requests (created_at);

-- ---------------------------------------------------------------------------------------------------------------------
-- Normalised forms for duplicate search (the brief, section 90), and the indexes that make the search fast.
-- Email and phone are NOT unique per company: a family shares an address, a business shares a phone. Matches are
-- reported by public.client_find_duplicate (0017) and the person decides. Ids from connected systems ARE unique.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.norm_email(p text) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select nullif(pg_catalog.lower(pg_catalog.btrim(p)), '') $$;

-- Digits only, without a leading US country code, so "(609) 555-0101" and "+1 609 555 0101" compare equal.
create or replace function app.norm_phone(p text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(case
    when pg_catalog.length(d.digits) = 11 and pg_catalog.left(d.digits, 1) = '1' then pg_catalog.substr(d.digits, 2)
    else d.digits end, '')
  from (select pg_catalog.regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as digits) d
$$;

-- Lowercase, punctuation removed, single spaces.
create or replace function app.norm_name(p text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p, '')), '[^[:alnum:][:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g')), '')
$$;

revoke all on function app.norm_email(text), app.norm_phone(text), app.norm_name(text) from public, anon;
grant execute on function app.norm_email(text), app.norm_phone(text), app.norm_name(text) to authenticated, service_role;

create index clients_email_key_idx on public.clients (tenant_id, (app.norm_email(email))) where app.norm_email(email) is not null;
create index clients_phone_key_idx on public.clients (tenant_id, (app.norm_phone(phone))) where app.norm_phone(phone) is not null;
create index clients_name_key_idx on public.clients (tenant_id, (app.norm_name(name)));
create index leads_email_key_idx on public.leads (tenant_id, (app.norm_email(email))) where app.norm_email(email) is not null;
create index leads_phone_key_idx on public.leads (tenant_id, (app.norm_phone(phone))) where app.norm_phone(phone) is not null;

-- One client per id in each connected system: the same Square or QuickBooks customer can never be linked twice.
do $external$
declare p text;
begin
  foreach p in array array['gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai'] loop
    execute format(
      'create unique index %I on public.clients (tenant_id, (external_ids ->> %L)) where external_ids ->> %L is not null',
      'clients_external_' || p || '_uidx', p, p);
  end loop;
end
$external$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Role views: the new job columns for office staff. Same rule and same options as in 0007; columns are only added.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace view public.jobs_basic with (security_barrier = true) as
  select j.id, j.tenant_id, j.number, j.name, j.client_id, j.address, j.type, j.status, j.start_date, j.end_date,
         j.repeat, j.scope, j.manager_id, j.created, j.lead_id, j.created_at, j.updated_at,
         j.service_id, j.tier_id, j.period, j.parent_id, j.office_id, j.extra
  from public.jobs j
  where j.tenant_id = any ((select app.tenants_can('jobs'))::uuid[])
  with cascaded check option;

-- ---------------------------------------------------------------------------------------------------------------------
-- updated_at and "a row never changes company" for the tables created here (same loops as 0002 and 0003)
-- ---------------------------------------------------------------------------------------------------------------------
do $triggers$
declare r record;
begin
  for r in
    select c.relname,
           exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped) as has_updated
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('client_people', 'client_secrets', 'lead_handoffs', 'lead_routing', 'task_comments', 'member_state', 'ws_requests')
  loop
    if r.has_updated then
      execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', r.relname || '_touch', r.relname);
    end if;
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function app.tenant_id_immutable()', r.relname || '_00_tenant_fixed', r.relname);
  end loop;
end
$triggers$;
