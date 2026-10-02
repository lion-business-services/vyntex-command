-- Local stand-ins for what Supabase provides and a plain Postgres does not.
-- Run once, as the cluster superuser, on a fresh empty database, BEFORE the migrations.
-- This file is for local testing only. Never run it on a Supabase project.
--
-- What is imitated, and how closely:
--   roles      anon, authenticated, service_role (BYPASSRLS), authenticator, and "postgres" as on Supabase:
--              NOT a superuser, with CREATEROLE and BYPASSRLS. The migrations are applied as this role.
--   grants     Supabase's default privileges in schema public (everything granted to anon, authenticated and
--              service_role), so the migrations have to take them away just as they must on a real project.
--   auth       schema auth, a minimal auth.users, and auth.uid() / auth.jwt() / auth.role() reading the
--              request.jwt.claims setting the same way the Data API sets it per request.
--   storage    schema storage with minimal buckets and objects tables (row level security on objects).
--   extensions schema extensions with pgcrypto installed in it.
-- Not imitated: the Data API itself (PostgREST), Supabase Auth, the Storage service, Vault, the dashboard.

-- ---------------------------------------------------------------------------------------------------------------------
-- Roles (cluster wide, so only created when missing)
-- ---------------------------------------------------------------------------------------------------------------------
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres login nosuperuser createdb createrole replication bypassrls;
  end if;
end
$roles$;
alter role postgres nosuperuser createdb createrole replication bypassrls;
grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------------------------------------------------------------
-- Database and public schema privileges, as on Supabase
-- ---------------------------------------------------------------------------------------------------------------------
do $db$
begin
  execute format('grant all on database %I to postgres', current_database());
end
$db$;
grant all on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- extensions
-- ---------------------------------------------------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------------------------------------------------
create schema auth;
grant usage on schema auth to postgres, anon, authenticated, service_role;

create table auth.users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  created_at  timestamptz not null default now()
);
grant select, references on auth.users to postgres;

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- storage (only the columns the migration and the policies touch)
-- ---------------------------------------------------------------------------------------------------------------------
create schema storage;
grant usage on schema storage to postgres, anon, authenticated, service_role;

create table storage.buckets (
  id                  text primary key,
  name                text not null unique,
  owner               uuid,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  public              boolean default false,
  avif_autodetection  boolean default false,
  file_size_limit     bigint,
  allowed_mime_types  text[],
  owner_id            text
);

create table storage.objects (
  id                uuid primary key default gen_random_uuid(),
  bucket_id         text references storage.buckets (id),
  name              text,
  owner             uuid,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  last_accessed_at  timestamptz default now(),
  metadata          jsonb,
  path_tokens       text[] generated always as (string_to_array(name, '/')) stored,
  version           text,
  owner_id          text,
  user_metadata     jsonb,
  unique (bucket_id, name)
);
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects, storage.buckets to authenticated, service_role;
grant select on storage.objects, storage.buckets to anon;
