-- 0002 Tenant data
-- One table per record type in src/domain/types.ts, in snake_case. Rules that hold for every table here:
--   * tenant_id uuid not null, with an index that starts with tenant_id (the unique (tenant_id, id) pair).
--   * Every link to another record is a composite foreign key that includes tenant_id, so a row can never point at
--     a record that belongs to another company, even when row level security is bypassed (service role, SQL Editor).
--   * Money is numeric(12,2) and can never be negative.
--   * created_at and updated_at are system timestamps kept by a trigger. Where the data model has its own business
--     date ("created", "since", "date"), that column is kept as well because it can be back-dated on import.
--
-- Names that differ from types.ts because the original word is reserved in SQL or the shape is relational:
--   Job.start / Job.end          -> jobs.start_date / jobs.end_date        ('' in the demo is NULL here)
--   Job.assign[]                 -> job_assignments          Job.expenses[] -> job_expenses
--   Job.received[]               -> client_payments          Job.log[]      -> work_logs
--   Lead.notes[] / Client.notes[] / Job.notes[] -> notes (parent_type + one of lead_id, client_id, job_id)
--   Expense.desc                 -> job_expenses.description
--   WorkerPayment.from / .to     -> worker_payments.period_from / period_to;  jobId '' -> NULL
--   Task.assignee "u:<id>" / "w:<id>" -> tasks.assignee_member_id / tasks.assignee_worker_id
--   Message.to                   -> messages.recipient
--   Ref { type, id }             -> ref_type + ref_id
--   Activity.by                  -> activity.by_kind + activity.by_id
--   DocRecord.esign              -> documents.esign_* columns
--   DemoState.automation.enabled -> automation_settings      DemoState.automation.runs -> automation_runs
--   DemoState.workerPays         -> worker_payments          DemoState.docs -> documents

-- ---------------------------------------------------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------------------------------------------------
create table public.clients (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  name           text not null check (length(btrim(name)) > 0),
  company        text,
  phone          text not null default '',
  email          text not null default '',
  addresses      text[] not null default '{}'::text[],
  since          date not null default current_date,
  -- Client asked not to receive automatic service emails.
  email_opt_out  boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- workers: field workers and subcontractors. The encrypted tax ID column is added in 0004.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.workers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (length(btrim(name)) > 0),
  trade       text not null default '',
  phone       text not null default '',
  email       text not null default '',
  pay_type    text check (pay_type in ('project', 'milestone', 'daily', 'weekly', 'monthly', 'hourly')),
  rate        numeric(12,2) check (rate >= 0),
  w9          boolean not null default false,
  w9_date     date,
  -- Insurance certificate expiry.
  coi_exp     date,
  insurer     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);

alter table public.tenant_members
  add constraint tenant_members_worker_fk foreign key (tenant_id, worker_id)
  references public.workers (tenant_id, id) on delete restrict;

-- ---------------------------------------------------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------------------------------------------------
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  ticket       text not null,
  name         text not null check (length(btrim(name)) > 0),
  company      text,
  phone        text not null default '',
  email        text not null default '',
  address      text not null default '',
  -- Service type id from the industry pack.
  type         text not null,
  source       text not null default 'other' check (source in ('website', 'phone', 'referral', 'facebook', 'instagram', 'google', 'other')),
  status       text not null default 'new' check (status in ('new', 'contacted', 'scheduled', 'sent', 'won', 'lost')),
  pri          text not null default 'medium' check (pri in ('high', 'medium', 'low')),
  owner_id     uuid,
  value        numeric(12,2) check (value >= 0),
  appt_date    date,
  appt_time    time,
  follow_up    date,
  created      date not null default current_date,
  client_id    uuid,
  job_id       uuid,
  lost_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ticket),
  foreign key (tenant_id, owner_id) references public.tenant_members (tenant_id, id) on delete set null (owner_id),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id)
);
create index leads_status_idx on public.leads (tenant_id, status);
create index leads_owner_idx on public.leads (tenant_id, owner_id);
create index leads_client_idx on public.leads (tenant_id, client_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------------------------------------------------
create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  -- Human-friendly number, for example VB-J-1004.
  number      text not null,
  name        text not null check (length(btrim(name)) > 0),
  client_id   uuid not null,
  address     text not null default '',
  type        text not null,
  status      text not null default 'estimate' check (status in ('estimate', 'contract', 'progress', 'hold', 'done')),
  -- Agreed price or contract total. Money column: office staff and workers never read it (see 0003).
  price       numeric(12,2) not null default 0 check (price >= 0),
  start_date  date,
  end_date    date,
  repeat      text not null default 'once' check (repeat in ('once', 'weekly', 'biweekly', 'monthly')),
  scope       text not null default '',
  pay_terms   text not null default '',
  manager_id  uuid,
  created     date not null default current_date,
  lead_id     uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  constraint jobs_dates_in_order check (start_date is null or end_date is null or end_date >= start_date),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, manager_id) references public.tenant_members (tenant_id, id) on delete set null (manager_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null (lead_id)
);
create index jobs_client_idx on public.jobs (tenant_id, client_id);
create index jobs_status_idx on public.jobs (tenant_id, status);
create index jobs_manager_idx on public.jobs (tenant_id, manager_id);
create index jobs_lead_idx on public.jobs (tenant_id, lead_id);

alter table public.leads
  add constraint leads_job_fk foreign key (tenant_id, job_id)
  references public.jobs (tenant_id, id) on delete set null (job_id);
create index leads_job_idx on public.leads (tenant_id, job_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- notes: one table for the notes of leads, clients and jobs. The parent is typed and each parent has a real foreign key.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  parent_type   text not null check (parent_type in ('lead', 'client', 'job')),
  lead_id       uuid,
  client_id     uuid,
  job_id        uuid,
  at            timestamptz not null default now(),
  kind          text not null default 'note' check (kind in ('call', 'visit', 'text', 'email', 'note')),
  text          text not null check (length(btrim(text)) > 0),
  pin           boolean not null default false,
  by_member_id  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint notes_one_parent check (
    num_nonnulls(lead_id, client_id, job_id) = 1
    and ((parent_type = 'lead' and lead_id is not null)
      or (parent_type = 'client' and client_id is not null)
      or (parent_type = 'job' and job_id is not null))
  ),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id)
);
create index notes_lead_idx on public.notes (tenant_id, lead_id);
create index notes_client_idx on public.notes (tenant_id, client_id);
create index notes_job_idx on public.notes (tenant_id, job_id);
create index notes_by_idx on public.notes (tenant_id, by_member_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- job_assignments: which worker does which part of a job, and the agreed amount for that part.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.job_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  job_id      uuid not null,
  worker_id   uuid not null,
  scope       text not null default '',
  -- Agreed total for this part of the work.
  price       numeric(12,2) not null default 0 check (price >= 0),
  pay_type    text check (pay_type in ('project', 'milestone', 'daily', 'weekly', 'monthly', 'hourly')),
  rate        numeric(12,2) check (rate >= 0),
  qty         numeric(12,2) check (qty >= 0),
  status      text not null default 'pending' check (status in ('pending', 'progress', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, worker_id) references public.workers (tenant_id, id) on delete restrict
);
create index job_assignments_job_idx on public.job_assignments (tenant_id, job_id);
create index job_assignments_worker_idx on public.job_assignments (tenant_id, worker_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- job_expenses
-- ---------------------------------------------------------------------------------------------------------------------
create table public.job_expenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  job_id       uuid not null,
  date         date not null default current_date,
  vendor       text not null default '',
  description  text not null default '',
  amount       numeric(12,2) not null check (amount >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade
);
create index job_expenses_job_idx on public.job_expenses (tenant_id, job_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- client_payments: money received from the client for a job.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.client_payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  job_id      uuid not null,
  date        date not null default current_date,
  method      text not null check (method in ('cash', 'check', 'transfer', 'zelle', 'card')),
  -- Check number or similar reference typed by the office. Never a card or bank account number.
  ref         text not null default '',
  amount      numeric(12,2) not null check (amount >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade
);
create index client_payments_job_idx on public.client_payments (tenant_id, job_id);
create index client_payments_date_idx on public.client_payments (tenant_id, date);

-- ---------------------------------------------------------------------------------------------------------------------
-- work_logs: daily notes from the field.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.work_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  job_id      uuid not null,
  date        date not null default current_date,
  worker_id   uuid not null,
  text        text not null check (length(btrim(text)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, worker_id) references public.workers (tenant_id, id) on delete restrict
);
create index work_logs_job_idx on public.work_logs (tenant_id, job_id);
create index work_logs_worker_idx on public.work_logs (tenant_id, worker_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------------------------------------------------
create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  title               text not null check (length(btrim(title)) > 0),
  description         text,
  job_id              uuid,
  lead_id             uuid,
  client_id           uuid,
  -- Assigned to an office member or to a field worker, never both.
  assignee_member_id  uuid,
  assignee_worker_id  uuid,
  due                 date,
  status              text not null default 'todo' check (status in ('todo', 'doing', 'waiting', 'review', 'done')),
  pri                 text not null default 'medium' check (pri in ('high', 'medium', 'low')),
  created             date not null default current_date,
  done_at             date,
  -- Key of the automation that created the task. Unique per company so a rule never creates the same task twice.
  auto                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  constraint tasks_one_assignee check (num_nonnulls(assignee_member_id, assignee_worker_id) <= 1),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, assignee_member_id) references public.tenant_members (tenant_id, id) on delete set null (assignee_member_id),
  foreign key (tenant_id, assignee_worker_id) references public.workers (tenant_id, id) on delete set null (assignee_worker_id)
);
create index tasks_job_idx on public.tasks (tenant_id, job_id);
create index tasks_lead_idx on public.tasks (tenant_id, lead_id);
create index tasks_client_idx on public.tasks (tenant_id, client_id);
create index tasks_member_idx on public.tasks (tenant_id, assignee_member_id);
create index tasks_worker_idx on public.tasks (tenant_id, assignee_worker_id);
create index tasks_due_idx on public.tasks (tenant_id, status, due);
create unique index tasks_auto_uidx on public.tasks (tenant_id, auto) where auto is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- worker_payments: money paid to a worker. These feed the 1099 totals, so deleting a job never deletes them
-- (the job link is cleared instead).
-- ---------------------------------------------------------------------------------------------------------------------
create table public.worker_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  worker_id    uuid not null,
  job_id       uuid,
  date         date not null default current_date,
  method       text not null check (method in ('cash', 'check', 'transfer', 'zelle', 'card')),
  ref          text not null default '',
  amount       numeric(12,2) not null check (amount >= 0),
  pay_type     text check (pay_type in ('project', 'milestone', 'daily', 'weekly', 'monthly', 'hourly')),
  period_from  date,
  period_to    date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint worker_payments_period_in_order check (period_from is null or period_to is null or period_to >= period_from),
  foreign key (tenant_id, worker_id) references public.workers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete set null (job_id)
);
create index worker_payments_worker_idx on public.worker_payments (tenant_id, worker_id, date);
create index worker_payments_job_idx on public.worker_payments (tenant_id, job_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- documents: contracts, invoices and estimates generated from a job, with saved edits and the e-signature trail.
-- esign_demo is always false here. Demo signatures exist only in the browser demo and never reach this database.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete restrict,
  kind                  text not null check (kind in ('contract', 'invoice', 'estimate')),
  number                text not null,
  title                 text not null default '',
  job_id                uuid not null,
  client_id             uuid not null,
  status                text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'signed', 'paid', 'void')),
  created               date not null default current_date,
  updated               date not null default current_date,
  -- Saved edits: block path -> text. Empty when the document is generated from the job as it is.
  edits                 jsonb not null default '{}'::jsonb check (jsonb_typeof(edits) = 'object'),
  esign_status          text check (esign_status in ('sent', 'viewed', 'signed', 'declined')),
  esign_demo            boolean not null default false check (esign_demo = false),
  esign_signer_name     text,
  esign_signer_email    text,
  esign_sent_at         timestamptz,
  esign_viewed_at       timestamptz,
  esign_signed_at       timestamptz,
  esign_typed_name      text,
  -- Path of the drawn signature image in private file storage. The image itself is never stored in this table.
  esign_signature_path  text,
  esign_consent         boolean,
  -- The exact consent sentence the signer accepted, plus where the signature came from.
  esign_consent_text    text,
  esign_ip_hash         text,
  esign_user_agent      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  constraint documents_esign_request check (
    esign_status is null
    or (esign_signer_name is not null and esign_signer_email is not null and esign_sent_at is not null)
  ),
  constraint documents_esign_signed check (
    esign_status is distinct from 'signed'
    or (esign_signed_at is not null and esign_consent is true and esign_consent_text is not null and esign_typed_name is not null)
  ),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict
);
create index documents_job_idx on public.documents (tenant_id, job_id);
create index documents_client_idx on public.documents (tenant_id, client_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- messages: emails and texts prepared or sent for a record.
-- The demo status "demo" does not exist here: in production a message is a draft, queued, sent or failed.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  at          timestamptz not null default now(),
  channel     text not null check (channel in ('email', 'text')),
  recipient   text not null,
  subject     text not null default '',
  body        text not null default '',
  status      text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'failed')),
  ref_type    text check (ref_type in ('lead', 'client', 'job', 'task', 'worker', 'doc', 'payment')),
  ref_id      uuid,
  auto        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint messages_ref_pair check ((ref_type is null) = (ref_id is null))
);
create index messages_ref_idx on public.messages (tenant_id, ref_type, ref_id);
create index messages_at_idx on public.messages (tenant_id, at desc);
create unique index messages_auto_uidx on public.messages (tenant_id, auto) where auto is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- activity: the history shown on each record. Append only (enforced in 0003). Stored as a kind plus parameters and
-- rendered in the viewer's language. "money" marks entries whose parameters contain amounts.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.activity (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  at          timestamptz not null default now(),
  kind        text not null check (length(kind) between 1 and 80),
  params      jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  ref_type    text not null check (ref_type in ('lead', 'client', 'job', 'task', 'worker', 'doc', 'payment')),
  ref_id      uuid not null,
  -- Extra records the entry should appear under: [{ "type": "client", "id": "..." }].
  also        jsonb not null default '[]'::jsonb check (jsonb_typeof(also) = 'array'),
  by_kind     text not null check (by_kind in ('member', 'worker', 'system', 'automation')),
  by_id       uuid,
  money       boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint activity_by_pair check ((by_kind in ('member', 'worker')) = (by_id is not null))
);
create index activity_ref_idx on public.activity (tenant_id, ref_type, ref_id, at desc);
create index activity_at_idx on public.activity (tenant_id, at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- automation_settings and automation_runs
-- ---------------------------------------------------------------------------------------------------------------------
create table public.automation_settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  -- Rule id from src/domain/automations.ts.
  rule_id     text not null check (length(rule_id) between 1 and 80),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, rule_id)
);

create table public.automation_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  at          timestamptz not null default now(),
  rule_id     text not null check (length(rule_id) between 1 and 80),
  -- [{ "key": "auto.step.task", "params": { ... } }]
  steps       jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  ref_type    text check (ref_type in ('lead', 'client', 'job', 'task', 'worker', 'doc', 'payment')),
  ref_id      uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint automation_runs_ref_pair check ((ref_type is null) = (ref_id is null))
);
create index automation_runs_at_idx on public.automation_runs (tenant_id, at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- consent_records: who agreed to what, the exact text, when, and from where.
-- A record is never edited or deleted. It can only be revoked, through public.revoke_consent (0006).
-- ---------------------------------------------------------------------------------------------------------------------
create table public.consent_records (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  kind               text not null check (kind in ('share_1099_data', 'electronic_signature', 'service_emails', 'text_messages', 'terms_of_service')),
  -- Who consented.
  subject_kind       text not null check (subject_kind in ('member', 'client', 'worker', 'external')),
  subject_member_id  uuid,
  subject_client_id  uuid,
  subject_worker_id  uuid,
  subject_name       text not null check (length(btrim(subject_name)) > 0),
  subject_email      text,
  -- What they agreed to: the exact text shown, its language and an optional version label.
  consent_text       text not null check (length(btrim(consent_text)) >= 20),
  language           text not null default 'en' check (language in ('en', 'es')),
  text_version       text,
  method             text not null default 'checkbox' check (method in ('checkbox', 'typed_name', 'signature', 'paper')),
  -- Optional scope: a tax year for 1099 consent, a document for an e-signature.
  tax_year           smallint check (tax_year between 2020 and 2100),
  document_id        uuid,
  -- When and from where.
  granted_at         timestamptz not null default now(),
  granted_by         uuid,
  source_ip_hash     text,
  user_agent         text,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid,
  revoke_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  constraint consent_subject_matches check (
    (subject_kind = 'member' and subject_member_id is not null and subject_client_id is null and subject_worker_id is null)
    or (subject_kind = 'client' and subject_client_id is not null and subject_member_id is null and subject_worker_id is null)
    or (subject_kind = 'worker' and subject_worker_id is not null and subject_member_id is null and subject_client_id is null)
    or (subject_kind = 'external' and num_nonnulls(subject_member_id, subject_client_id, subject_worker_id) = 0)
  ),
  constraint consent_revocation_pair check ((revoked_at is null) = (revoke_reason is null)),
  foreign key (tenant_id, subject_member_id) references public.tenant_members (tenant_id, id) on delete restrict,
  foreign key (tenant_id, subject_client_id) references public.clients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, subject_worker_id) references public.workers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, document_id) references public.documents (tenant_id, id) on delete restrict
);
create index consent_records_kind_idx on public.consent_records (tenant_id, kind, granted_at desc);
create index consent_records_member_idx on public.consent_records (tenant_id, subject_member_id);
create index consent_records_client_idx on public.consent_records (tenant_id, subject_client_id);
create index consent_records_worker_idx on public.consent_records (tenant_id, subject_worker_id);
create index consent_records_document_idx on public.consent_records (tenant_id, document_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- updated_at triggers for every table above that has the column
-- ---------------------------------------------------------------------------------------------------------------------
do $touch$
declare r record;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = c.oid and t.tgname = c.relname || '_touch')
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', r.relname || '_touch', r.relname);
  end loop;
end
$touch$;
