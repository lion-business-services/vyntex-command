-- Migration staging: the bookkeeping of a one-time import from an older system (first use: NOVA to LBS Command).
--
-- Why a schema of its own: staged rows are copies of client records that have not been checked yet. They must not be
-- reachable through the Data API (only "public" is exposed), must not be mixed with live tables, and must be easy to
-- remove once the import is confirmed. Nothing in this schema is readable by anon or authenticated.
--
-- What lives here permanently (small, no client data beyond ids):
--   migrate.batches     one row per import run: who approved it, which backup it relied on, what happened
--   migrate.id_map      source id to target id, per entity. This is what makes a second run insert nothing twice,
--                       and what lets one batch be taken out again without touching anything else
--   migrate.outcomes    one row per source record: created, skipped, duplicate, invalid or needs_review, and why
--   migrate.decisions   the answers a person gave to "duplicate", "invalid" and "needs review" rows
-- What the tool adds and removes itself: migrate.src_* (the staged copy of the source) and migrate.map_* (the same
-- rows in the shape of this platform). Both hold personal data and are dropped by the purge stage.
--
-- service_role may read the plan and write the id map: the load itself runs as service_role (the server key's role),
-- so it cannot reach client_secrets and cannot change or remove history. Never add "migrate" to the exposed schemas.
create schema if not exists migrate;
revoke all on schema migrate from public, anon, authenticated;
grant usage on schema migrate to service_role;

create table if not exists migrate.batches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  label           text not null check (label ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  source_system   text not null default 'nova',
  created_at      timestamptz not null default now(),
  is_current      boolean not null default true,
  source_counts   jsonb not null default '{}' check (jsonb_typeof(source_counts) = 'object'),
  backup_sha256   text check (backup_sha256 ~ '^[0-9a-f]{64}$'),
  dry_run_at      timestamptz,
  dry_run_hash    text check (dry_run_hash ~ '^[0-9a-f]{64}$'),
  plan_hash       text,
  approved_by     text check (length(approved_by) between 2 and 120),
  approved_at     timestamptz,
  applied_at      timestamptz,
  reconciled_at   timestamptz,
  reconcile_ok    boolean,
  rolled_back_at  timestamptz,
  notes           jsonb not null default '{}' check (jsonb_typeof(notes) = 'object')
);
create unique index if not exists batches_one_current on migrate.batches (tenant_id) where is_current;

create table if not exists migrate.id_map (
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  entity        text not null,
  source_id     text not null,
  target_table  text not null,
  target_id     uuid not null,
  batch_id      uuid not null references migrate.batches (id) on delete restrict,
  loaded_at     timestamptz not null default now(),
  primary key (tenant_id, entity, source_id),
  unique (target_table, target_id)
);
create index if not exists id_map_batch_idx on migrate.id_map (batch_id, entity);

create table if not exists migrate.outcomes (
  batch_id          uuid not null references migrate.batches (id) on delete cascade,
  entity            text not null,
  source_id         text not null,
  outcome           text not null check (outcome in ('created', 'skipped', 'duplicate', 'invalid', 'needs_review')),
  reason            text not null default '',
  field             text,
  question          text,
  matched_kind      text check (matched_kind in ('source', 'target')),
  matched_id        text,
  matched_on        text[],
  primary key (batch_id, entity, source_id)
);
create index if not exists outcomes_outcome_idx on migrate.outcomes (batch_id, entity, outcome);

create table if not exists migrate.decisions (
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  entity      text not null,
  source_id   text not null,
  decision    text not null check (decision in ('load', 'skip', 'load_without_field')),
  decided_by  text not null check (length(decided_by) between 2 and 120),
  decided_at  timestamptz not null default now(),
  primary key (tenant_id, entity, source_id)
);

alter table migrate.batches enable row level security;
alter table migrate.id_map enable row level security;
alter table migrate.outcomes enable row level security;
alter table migrate.decisions enable row level security;
revoke all on all tables in schema migrate from public, anon, authenticated, service_role;
grant select on migrate.batches, migrate.outcomes, migrate.decisions to service_role;
grant select, insert on migrate.id_map to service_role;

select app.lockdown_check();
