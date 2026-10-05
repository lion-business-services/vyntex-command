-- TEST ONLY. Stand-ins for what Supabase provides, so the NOVA schema files can be applied to a throwaway local
-- database. This is never run against NOVA: the migration tool only ever reads from NOVA.
do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end
$r$;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null unique, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
alter table storage.objects enable row level security;
-- Vault: the functions exist so the schema files compile. No secret is ever stored by the tests.
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, description text, secret text);
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create publication supabase_realtime;
grant usage on schema public, auth, storage, vault to anon, authenticated, service_role;
