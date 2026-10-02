-- 0005 Encryption of sensitive personal data
-- Pattern: the value is encrypted inside the database with pgcrypto (OpenPGP symmetric, AES-256) and stored as bytea.
-- The plaintext is never stored, never returned by a table or view, and only comes back through a function that
-- checks the caller's role and writes an audit entry.
--
-- First use: workers.tax_id_enc (SSN, EIN or ITIN collected on a W-9 for 1099 work).
-- Reuse the same two functions for any sensitive field added later (bank or payment references, for example).
--
-- The key is read by app.secret('pii_encryption_key') (0004):
--   * Supabase Vault secret named  pii_encryption_key   (recommended in production), or
--   * database setting             app.settings.pii_encryption_key   (local tests, self-managed Postgres).
-- A setting can be read by any session that can run SQL, so on Supabase use Vault. See docs/SECURITY.md.

create or replace function app.pii_key() returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare v text;
begin
  v := app.secret('pii_encryption_key');
  if v is null or pg_catalog.length(v) < 32 then
    raise exception 'PII encryption key is not configured (need at least 32 characters). See docs/SECURITY.md.'
      using errcode = 'P0001';
  end if;
  return v;
end
$$;

create or replace function app.encrypt_pii(p_plain text) returns bytea
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_plain is null then return null; end if;
  return extensions.pgp_sym_encrypt(p_plain, app.pii_key(), 'cipher-algo=aes256, compress-algo=0');
end
$$;

create or replace function app.decrypt_pii(p_cipher bytea) returns text
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_cipher is null then return null; end if;
  return extensions.pgp_sym_decrypt(p_cipher, app.pii_key());
end
$$;

-- Internal only: no application role can call these directly.
revoke all on function app.pii_key(), app.encrypt_pii(text), app.decrypt_pii(bytea) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- workers.tax_id_enc
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.workers add column tax_id_enc bytea;
-- Lets the app show "tax ID on file" without touching the encrypted value.
alter table public.workers add column has_tax_id boolean generated always as (tax_id_enc is not null) stored;

-- Signed-in people can no longer read or write the whole workers row: the encrypted column is left out.
-- Consequence for the app: list the columns you want; "select *" on workers is refused.
-- A column added to workers later is closed until it is granted here on purpose.
revoke select, insert, update on public.workers from authenticated;
grant select (id, tenant_id, name, trade, phone, email, pay_type, rate, w9, w9_date, coi_exp, insurer, active, has_tax_id, created_at, updated_at)
  on public.workers to authenticated;
grant insert (id, tenant_id, name, trade, phone, email, pay_type, rate, w9, w9_date, coi_exp, insurer, active)
  on public.workers to authenticated;
grant update (name, trade, phone, email, pay_type, rate, w9, w9_date, coi_exp, insurer, active)
  on public.workers to authenticated;

-- Stores (or clears, with NULL) a worker's tax ID. Owner and manager only. Audited without the value.
create or replace function public.set_worker_tax_id(p_worker uuid, p_tax_id text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_digits text;
begin
  select w.tenant_id into v_tenant from public.workers w where w.id = p_worker;
  if v_tenant is null or not app.has_role(v_tenant, array['owner', 'manager']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_tax_id is null then
    update public.workers set tax_id_enc = null where id = p_worker and tenant_id = v_tenant;
    perform app.audit_write(v_tenant, 'pii_clear', 'workers', p_worker, null, pg_catalog.jsonb_build_object('field', 'tax_id'));
    return;
  end if;
  v_digits := pg_catalog.regexp_replace(p_tax_id, '[^0-9]', '', 'g');
  if pg_catalog.length(v_digits) <> 9 then
    raise exception 'A tax ID has 9 digits' using errcode = '22023';
  end if;
  update public.workers set tax_id_enc = app.encrypt_pii(v_digits) where id = p_worker and tenant_id = v_tenant;
  perform app.audit_write(v_tenant, 'pii_write', 'workers', p_worker, null, pg_catalog.jsonb_build_object('field', 'tax_id'));
end
$$;

-- Returns a worker's tax ID in clear text. Owner and manager only. Every call is written to the audit log.
create or replace function public.get_worker_tax_id(p_worker uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_cipher bytea;
begin
  select w.tenant_id, w.tax_id_enc into v_tenant, v_cipher from public.workers w where w.id = p_worker;
  if v_tenant is null or not app.has_role(v_tenant, array['owner', 'manager']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform app.audit_write(v_tenant, 'pii_read', 'workers', p_worker, null, pg_catalog.jsonb_build_object('field', 'tax_id'));
  return app.decrypt_pii(v_cipher);
end
$$;

revoke all on function public.set_worker_tax_id(uuid, text), public.get_worker_tax_id(uuid) from public, anon;
grant execute on function public.set_worker_tax_id(uuid, text), public.get_worker_tax_id(uuid) to authenticated;
