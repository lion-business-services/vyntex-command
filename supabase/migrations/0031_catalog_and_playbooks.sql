-- 0031 Service catalog and playbooks (the brief, sections 12 and 13)
--   Playbook        -> playbooks          PlaybookStep  -> playbook_steps   (nested list "steps", in order)
--   CatalogService  -> catalog_services   CatalogTier   -> catalog_tiers    (nested list "tiers", in order)
-- Both are configuration of the company: everyone who works with clients reads them ("catalog"); changing a service,
-- a price or a playbook needs "catalog" and "config" together (and "write", like every change).
-- Fields the screens add on top of types.ts (a service code, an internal note, effective dates) are kept in "extra"
-- by the gateway until types.ts names them and a migration gives them a column.
--
-- jobs.service_id and jobs.tier_id (plain ids since 0012) become real links here. leads.service_ids and the
-- service lists of a cross-sell rule are arrays and cannot carry a foreign key: an id of a service that is gone
-- simply matches nothing.

-- ---------------------------------------------------------------------------------------------------------------------
-- playbooks: what happens when an engagement for a service begins
-- ---------------------------------------------------------------------------------------------------------------------
create table public.playbooks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 200),
  -- Message template sent as the welcome.
  welcome     text check (length(welcome) <= 4000),
  active      boolean not null default true,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint playbooks_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536)
);
select app.module_table('playbooks');

create table public.playbook_steps (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  playbook_id  uuid not null,
  -- { "en": "...", "es": "..." }
  title        jsonb not null check (app.is_l10n(title)),
  -- Days after the engagement starts.
  due_in       integer not null default 0 check (due_in between 0 and 3650),
  for_role     text not null default 'assignee' check (for_role in ('owner', 'manager', 'assignee')),
  -- Task type id from the edition or the company's configuration.
  type         text check (type is null or app.is_option_id(type)),
  pri          text check (pri in ('high', 'medium', 'low')),
  position     integer not null default 0,
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint playbook_steps_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, playbook_id) references public.playbooks (tenant_id, id) on delete cascade
);
create index playbook_steps_playbook_idx on public.playbook_steps (tenant_id, playbook_id, position);
select app.module_table('playbook_steps');

-- ---------------------------------------------------------------------------------------------------------------------
-- catalog_services and catalog_tiers
-- ---------------------------------------------------------------------------------------------------------------------
create table public.catalog_services (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete restrict,
  name                 text not null check (length(btrim(name)) between 1 and 200),
  -- Names and descriptions in other languages: { "es": { "name": "...", "description": "..." } }
  i18n                 jsonb check (jsonb_typeof(i18n) = 'object'),
  category             text not null default '' check (length(category) <= 120),
  description          text check (length(description) <= 4000),
  active               boolean not null default true,
  -- How often the work normally repeats.
  repeat               text check (repeat in ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  playbook_id          uuid,
  -- Documents to prepare when this service is sold.
  doc_kinds            text[] check (doc_kinds <@ array['contract', 'invoice', 'estimate', 'engagement_letter', 'service_order', 'service_agreement',
                                                         'consent_7216', 'poa_2848', 'upload', 'custom']::text[]),
  -- Appointment type booked for this service (appointment_types: 0032 adds the foreign key).
  appointment_type_id  uuid,
  -- Ids of this service in connected systems: { "square": "...", "quickbooks": "..." }
  external_ids         jsonb check (jsonb_typeof(external_ids) = 'object'),
  extra                jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  constraint catalog_services_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, playbook_id) references public.playbooks (tenant_id, id) on delete set null (playbook_id)
);
create index catalog_services_playbook_idx on public.catalog_services (tenant_id, playbook_id);
create index catalog_services_appt_type_idx on public.catalog_services (tenant_id, appointment_type_id);
create index catalog_services_category_idx on public.catalog_services (tenant_id, category, name);
select app.module_table('catalog_services');

create table public.catalog_tiers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  service_id    uuid not null,
  name          text not null check (length(btrim(name)) between 1 and 200),
  price         numeric(12,2) not null default 0 check (price >= 0),
  unit          text not null default 'flat' check (unit in ('flat', 'hour', 'month', 'quarter', 'year')),
  note          text check (length(note) <= 1000),
  external_ids  jsonb check (jsonb_typeof(external_ids) = 'object'),
  position      integer not null default 0,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint catalog_tiers_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, service_id) references public.catalog_services (tenant_id, id) on delete cascade
);
create index catalog_tiers_service_idx on public.catalog_tiers (tenant_id, service_id, position);
select app.module_table('catalog_tiers');

-- One set of rules for the four tables: read with "catalog", change with "catalog", "config" and "write".
-- Removing a step or a price tier is an edit of its parent, so it does not ask for "delete"; removing a whole
-- service or playbook does.
do $policies$
declare t text;
begin
  foreach t in array array['playbooks', 'playbook_steps', 'catalog_services', 'catalog_tiers'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (tenant_id = any ((select app.tenants_can('catalog'))::uuid[]))$f$, t || '_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (tenant_id = any ((select app.tenants_can('catalog', 'config', 'write'))::uuid[]))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (tenant_id = any ((select app.tenants_can('catalog', 'config', 'write'))::uuid[]))
      with check (tenant_id = any ((select app.tenants_can('catalog', 'config', 'write'))::uuid[]))$f$, t || '_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
      using (tenant_id = any ((select app.tenants_can(%s))::uuid[]))$f$, t || '_delete', t,
      case when t in ('playbook_steps', 'catalog_tiers') then $c$'catalog', 'config', 'write'$c$ else $c$'catalog', 'config', 'write', 'delete'$c$ end);
    -- what a service costs and what a playbook does are decisions of the company: every change is on record
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end
$policies$;

-- The links of 0012 that were waiting for the catalog. A job keeps its history when a service or a tier is removed.
alter table public.jobs add constraint jobs_service_fk foreign key (tenant_id, service_id)
  references public.catalog_services (tenant_id, id) on delete set null (service_id);
alter table public.jobs add constraint jobs_tier_fk foreign key (tenant_id, tier_id)
  references public.catalog_tiers (tenant_id, id) on delete set null (tier_id);
create index jobs_tier_idx on public.jobs (tenant_id, tier_id) where tier_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. Playbooks (12) before the services that name them (14); both before jobs (40).
-- A service names its appointment type, and an appointment type names its service: the service's link is written
-- after everything else in the request ("defer"), so the two can arrive together.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "playbooks", "ord": 12, "relation": "playbooks",
  "read_caps": ["catalog"], "write_caps": ["catalog", "config"], "delete_caps": ["delete"], "order_by": "t.created_at, t.name, t.id",
  "fields": { "id": "id", "name": "name", "welcome": "welcome", "active": "active" }
}$j$);
select app.ws_register($j${
  "name": "playbooks.steps", "parent": "playbooks", "parent_field": "steps", "parent_col": "playbook_id", "relation": "playbook_steps",
  "read_caps": ["catalog"], "write_caps": ["catalog", "config"], "position_col": "position",
  "fields": { "id": "id", "title": "title", "dueIn": "due_in", "for": "for_role", "type": "type", "pri": "pri" }
}$j$);

select app.ws_register($j${
  "name": "catalog", "ord": 14, "relation": "catalog_services",
  "read_caps": ["catalog"], "write_caps": ["catalog", "config"], "delete_caps": ["delete"], "order_by": "t.created_at, t.name, t.id",
  "fields": { "id": "id", "name": "name", "i18n": "i18n", "category": { "col": "category", "empty": "" }, "description": "description",
              "active": "active", "repeat": "repeat", "playbookId": "playbook_id", "docKinds": "doc_kinds",
              "appointmentTypeId": { "col": "appointment_type_id", "defer": true }, "externalIds": "external_ids" }
}$j$);
select app.ws_register($j${
  "name": "catalog.tiers", "parent": "catalog", "parent_field": "tiers", "parent_col": "service_id", "relation": "catalog_tiers",
  "read_caps": ["catalog"], "write_caps": ["catalog", "config"], "position_col": "position",
  "fields": { "id": "id", "name": "name", "price": "price", "unit": "unit", "note": "note", "externalIds": "external_ids" }
}$j$);

select app.lockdown_check();
