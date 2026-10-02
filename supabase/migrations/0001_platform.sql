-- 0001 Platform foundation
-- Schemas, shared trigger helpers, and the platform level tables:
-- industries (reference rows), tenants (customer companies), tenant_members (who belongs to which company), demo_requests (sales form).
--
-- Run as the Supabase "postgres" role (SQL Editor does this). That role is not a superuser but has BYPASSRLS, and the
-- SECURITY DEFINER helpers in 0003 rely on it: they must be able to read tenant_members while row level security is forced.

do $guard$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Migrations must run as a role with BYPASSRLS (on Supabase: postgres). Current role: %', current_user;
  end if;
end
$guard$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- "app" holds internal helpers. It is not listed in the Data API "exposed schemas", so nothing in it can be called from a browser.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- New objects start closed. Supabase grants everything in "public" to anon and authenticated by default; this project does not.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

-- Words that can never be a company address, because the site uses them for its own pages.
-- Keep in step with RESERVED_SLUGS in src/platform/mode.ts (supabase/tests/parity.mjs compares the two).
create or replace function app.reserved_slugs() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array[
    'demo', 'pricing', 'request-demo', 'api', 'assets', 'brand', 'login', 'logout', 'signup', 'signin', 'register',
    'auth', 'callback', 'invite', 'reset-password', 'admin', 'app', 'www', 'static', 'public', 'settings', 'account',
    'billing', 'checkout', 'pay', 'webhooks', 'support', 'help', 'docs', 'legal', 'privacy', 'terms', 'about',
    'contact', 'blog', 'status', 'health', 'new', 'onboarding', 'portal', 'worker', 'client', 'dashboard', 'sign',
    'vyntex', 'null', 'undefined'
  ]::text[]
$$;

-- 3 to 40 characters: lowercase letters and digits, single hyphens between them, not a reserved word.
create or replace function app.is_valid_slug(p_slug text) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select p_slug is not null
     and pg_catalog.length(p_slug) between 3 and 40
     and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     and p_slug <> all (app.reserved_slugs())
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- industries: the industry editions (packs). Reference data, loaded by supabase/seed.sql.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.industries (
  id            text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  product_name  text not null unique check (pg_catalog.length(pg_catalog.btrim(product_name)) > 0),
  sort_order    smallint not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger industries_touch before update on public.industries for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- tenants: one row per customer company. The company address is /<slug> on the shared subdomain.
-- plan_id is the id of a plan in config/vyntex-build-pricing.json. Prices are never stored here.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (app.is_valid_slug(slug)),
  name         text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 200),
  industry_id  text not null references public.industries (id) on delete restrict,
  plan_id      text not null check (plan_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  status       text not null default 'onboarding' check (status in ('onboarding', 'active', 'suspended', 'closed')),
  -- Company presentation: initials, license line, phone, email, logo path, accent colour (Company in src/domain/types.ts).
  branding     jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(branding) = 'object'),
  -- Workspace choices (WorkspaceSettings in src/domain/types.ts). 1099 consent is NOT kept here: see consent_records.
  settings     jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(settings) = 'object'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tenants_industry_idx on public.tenants (industry_id);
create trigger tenants_touch before update on public.tenants for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------------
-- tenant_members: links a signed-in person (auth.users) to a company with one role.
-- Office roles: owner, manager, staff. Field workers have role "worker" and point at their workers row (added in 0002).
-- This table is also the "TeamUser" of the data model: leads.owner_id, jobs.manager_id and tasks point at tenant_members.id.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.tenant_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'manager', 'staff', 'worker')),
  worker_id   uuid,
  status      text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  name        text not null default '',
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id),
  constraint tenant_members_worker_link check ((role = 'worker') = (worker_id is not null))
);
create index tenant_members_user_idx on public.tenant_members (user_id);
create unique index tenant_members_worker_uidx on public.tenant_members (tenant_id, worker_id) where worker_id is not null;
create trigger tenant_members_touch before update on public.tenant_members for each row execute function app.touch_updated_at();

-- A company must always keep at least one active owner, otherwise nobody could manage it.
create or replace function app.guard_last_owner() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active' or new.tenant_id <> old.tenant_id) then
    -- Serialise concurrent changes to the same company so two owners cannot remove each other at the same moment.
    perform 1 from public.tenants t where t.id = old.tenant_id for update;
    if not exists (
      select 1 from public.tenant_members m
      where m.tenant_id = old.tenant_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id
    ) then
      raise exception 'A company must keep at least one active owner' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function app.guard_last_owner() from public;
create trigger tenant_members_last_owner before update or delete on public.tenant_members
  for each row execute function app.guard_last_owner();

-- ---------------------------------------------------------------------------------------------------------------------
-- demo_requests: the public "request a demo" form. Platform level, no tenant.
-- Written only by the server function api/demo-request.js with the service role key. Browsers never touch this table.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.demo_requests (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 200),
  business        text check (pg_catalog.length(business) <= 200),
  industry        text check (pg_catalog.length(industry) <= 60),
  phone           text check (pg_catalog.length(phone) <= 40),
  email           text check (pg_catalog.length(email) <= 320),
  language        text not null default 'en' check (language in ('en', 'es')),
  contact_method  text check (pg_catalog.length(contact_method) <= 40),
  team_size       text check (pg_catalog.length(team_size) <= 40),
  message         text check (pg_catalog.length(message) <= 4000),
  consent         boolean not null default false,
  -- The exact sentence the person agreed to, and when. Required whenever consent is true.
  consent_text    text check (pg_catalog.length(consent_text) <= 2000),
  consent_at      timestamptz,
  -- Whether the notification email for this request went out. False means someone must follow up from this table.
  email_delivered boolean,
  -- Keyed hash of the sender address (never the address itself) and the browser signature, for abuse review.
  source_ip_hash  text check (pg_catalog.length(source_ip_hash) <= 128),
  user_agent      text check (pg_catalog.length(user_agent) <= 500),
  constraint demo_requests_reachable check (phone is not null or email is not null),
  constraint demo_requests_consent_evidence check (not consent or (consent_text is not null and consent_at is not null))
);
create index demo_requests_created_idx on public.demo_requests (created_at desc);
