-- TEST ONLY. NOVA's file 0015_customers_import.sql adds six columns to public.clients and then inserts real
-- customers. That file is never opened, copied or run by anything in this repository. The columns are recreated here
-- from their description in the database audit (audit-db.md, table 2, "0015:13-21"), with no rows.
alter table public.clients
  add column if not exists square_customer_id text unique,
  add column if not exists source text default 'manual' check (source in ('manual', 'square', 'import', 'web')),
  add column if not exists needs_review boolean default false,
  add column if not exists preferred_language text default 'en' check (preferred_language in ('en', 'es', 'zh')),
  add column if not exists source_created_at timestamptz,
  add column if not exists source_updated_at timestamptz;
create index if not exists idx_clients_source on public.clients (source);
