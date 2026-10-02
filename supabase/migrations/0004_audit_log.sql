-- 0004 Audit log
-- An append-only record of every change to the sensitive tables: money, membership, workers, documents, consent and
-- the company record itself. Written by triggers, so it cannot be skipped by the application.
-- Nobody can update or delete an entry: there is no policy for it, the privileges are revoked, and a trigger blocks
-- it even for the service role and for the SQL Editor.

create table public.audit_log (
  id          bigint generated always as identity primary key,
  -- NULL only for platform events that belong to no company.
  tenant_id   uuid references public.tenants (id) on delete restrict,
  -- auth.users id of the person who made the change. NULL for the service role or a direct database session.
  actor       uuid,
  -- Their role at that moment: owner, manager, staff, worker, service_role, or system.
  actor_role  text not null,
  -- insert, update, delete, or a named event such as pii_read, pii_write, export_1099, consent_revoke.
  action      text not null,
  table_name  text not null,
  row_id      uuid,
  -- For updates only the columns that changed. Sensitive columns are replaced with "[redacted]".
  old_data    jsonb,
  new_data    jsonb,
  at          timestamptz not null default now(),
  -- Keyed hash of the caller address when the request came through the Data API and a salt is configured. Never the address.
  ip_hash     text
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, at desc);
create index audit_log_row_idx on public.audit_log (tenant_id, table_name, row_id);
create index audit_log_actor_idx on public.audit_log (tenant_id, actor);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;

-- Only the owner reads the audit log of their company. There is deliberately no insert, update or delete policy.
create policy audit_log_select on public.audit_log for select to authenticated
  using (tenant_id = any ((select app.tenants_with_role('owner'))::uuid[]));

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.block_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.block_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- Secrets used inside the database: read from a database setting first, then from Supabase Vault.
--   setting  app.settings.<name>           (local tests, self-managed Postgres)
--   Vault    a secret named <name>         (recommended on Supabase)
-- Names in use: pii_encryption_key (0005) and ip_hash_salt (below, optional).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.secret(p_name text) returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare v text;
begin
  v := nullif(pg_catalog.current_setting('app.settings.' || p_name, true), '');
  if v is null and pg_catalog.to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
    v := nullif(v, '');
  end if;
  return v;
end
$$;
revoke all on function app.secret(text) from public, anon, authenticated, service_role;

-- Keyed hash (HMAC-SHA256) of the caller address taken from the Data API request headers.
-- Returns NULL when there is no request, no address, or no salt configured: a plain hash of an address is easy to reverse.
create or replace function app.request_ip_hash() returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  h jsonb;
  ip text;
  salt text;
begin
  begin
    h := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  ip := pg_catalog.btrim(pg_catalog.split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1));
  if ip = '' then return null; end if;
  salt := app.secret('ip_hash_salt');
  if salt is null then return null; end if;
  return pg_catalog.encode(extensions.hmac(ip, salt, 'sha256'), 'hex');
end
$$;
revoke all on function app.request_ip_hash() from public, anon, authenticated, service_role;

-- One audit entry. Used by the row trigger below and by the functions that read or export sensitive data.
create or replace function app.audit_write(
  p_tenant uuid, p_action text, p_table text, p_row uuid, p_old jsonb default null, p_new jsonb default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    case when p_tenant is not null then app.member_role(p_tenant) end,
    nullif(app.jwt_role(), ''),
    'system'
  );
  insert into public.audit_log (tenant_id, actor, actor_role, action, table_name, row_id, old_data, new_data, ip_hash)
  values (p_tenant, (select auth.uid()), v_role, p_action, p_table, p_row, p_old, p_new, app.request_ip_hash());
end
$$;
revoke all on function app.audit_write(uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;

-- Row trigger. Arguments are the column names to redact in that table.
create or replace function app.audit_row() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_keep_old jsonb;
  v_keep_new jsonb;
  v_any jsonb;
  v_tenant uuid;
  k text;
begin
  if tg_op <> 'INSERT' then v_old := pg_catalog.to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := pg_catalog.to_jsonb(new); end if;
  v_any := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    -- Keep only what changed (compared before redaction, so a changed secret still shows up as changed).
    select coalesce(pg_catalog.jsonb_object_agg(n.key, o.value), '{}'::jsonb),
           coalesce(pg_catalog.jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      into v_keep_old, v_keep_new
    from pg_catalog.jsonb_each(v_new) n
    join pg_catalog.jsonb_each(v_old) o on o.key = n.key
    where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_keep_new = '{}'::jsonb then
      return null;
    end if;
    v_old := v_keep_old;
    v_new := v_keep_new;
  end if;

  for i in 0 .. tg_nargs - 1 loop
    k := tg_argv[i];
    if v_old ? k and v_old -> k <> 'null'::jsonb then v_old := pg_catalog.jsonb_set(v_old, array[k], '"[redacted]"'::jsonb); end if;
    if v_new ? k and v_new -> k <> 'null'::jsonb then v_new := pg_catalog.jsonb_set(v_new, array[k], '"[redacted]"'::jsonb); end if;
  end loop;

  v_tenant := case when tg_table_name = 'tenants' then (v_any ->> 'id')::uuid else (v_any ->> 'tenant_id')::uuid end;
  perform app.audit_write(v_tenant, pg_catalog.lower(tg_op), tg_table_name, (v_any ->> 'id')::uuid, v_old, v_new);
  return null;
end
$$;
revoke all on function app.audit_row() from public, anon, authenticated, service_role;

-- Money
create trigger client_payments_audit after insert or update or delete on public.client_payments
  for each row execute function app.audit_row('ref');
create trigger worker_payments_audit after insert or update or delete on public.worker_payments
  for each row execute function app.audit_row('ref');
create trigger job_expenses_audit after insert or update or delete on public.job_expenses
  for each row execute function app.audit_row();
create trigger job_assignments_audit after insert or update or delete on public.job_assignments
  for each row execute function app.audit_row();
-- Jobs: the price, and removal of a job.
create trigger jobs_audit_price after update of price on public.jobs
  for each row when (old.price is distinct from new.price) execute function app.audit_row();
create trigger jobs_audit_delete after delete on public.jobs
  for each row execute function app.audit_row();
-- Membership and the company record
create trigger tenant_members_audit after insert or update or delete on public.tenant_members
  for each row execute function app.audit_row('email', 'phone');
-- (a company row is never deleted: it is closed by setting status = 'closed', and its history stays)
create trigger tenants_audit after insert or update on public.tenants
  for each row execute function app.audit_row();
-- Workers (contact details redacted; the encrypted tax ID column added in 0005 is redacted too)
create trigger workers_audit after insert or update or delete on public.workers
  for each row execute function app.audit_row('phone', 'email', 'tax_id_enc');
-- Documents (the signer's email and the saved wording are not copied into the log)
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function app.audit_row('esign_signer_email', 'edits');
-- Consent
create trigger consent_records_audit after insert or update or delete on public.consent_records
  for each row execute function app.audit_row('subject_email');
