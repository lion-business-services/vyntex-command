-- 0006 Consent capture and the 1099 export
-- Pricing rule (config/vyntex-build-pricing.json): "1099 work is performed by Lion Business Services and requires the
-- customer's written consent to share subcontractor payment data."
-- So: the export of worker payment totals refuses to run unless the company has an active consent record of kind
-- 'share_1099_data', recorded by the owner. Consent can be revoked, and the export stops working the moment it is.

-- ---------------------------------------------------------------------------------------------------------------------
-- consent_records: stamped on the way in, frozen afterwards
-- ---------------------------------------------------------------------------------------------------------------------

-- For a signed-in person the "who recorded it" and "when" come from the session, not from what the browser sent,
-- so a consent cannot be back-dated or recorded in someone else's name. It also cannot arrive already revoked.
create or replace function app.consent_stamp() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() = 'authenticated' then
    new.granted_by := (select auth.uid());
    new.granted_at := pg_catalog.now();
    new.source_ip_hash := coalesce(app.request_ip_hash(), new.source_ip_hash);
    new.revoked_at := null;
    new.revoked_by := null;
    new.revoke_reason := null;
    if new.kind = 'share_1099_data' then
      -- The consent is the owner's own: the subject is the owner who is signed in.
      new.subject_kind := 'member';
      new.subject_member_id := app.current_member(new.tenant_id);
      new.subject_client_id := null;
      new.subject_worker_id := null;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.consent_stamp() from public, anon, authenticated, service_role;
create trigger consent_records_stamp before insert on public.consent_records
  for each row execute function app.consent_stamp();

-- The only change ever allowed is a one-time revocation. Everything else about a consent is permanent evidence.
create or replace function app.consent_freeze() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'consent_records cannot be deleted' using errcode = '42501';
  end if;
  if old.revoked_at is not null then
    raise exception 'This consent is already revoked and cannot change' using errcode = '42501';
  end if;
  if new.revoked_at is null
     or (pg_catalog.to_jsonb(new) - array['revoked_at', 'revoked_by', 'revoke_reason', 'updated_at'])
        is distinct from
        (pg_catalog.to_jsonb(old) - array['revoked_at', 'revoked_by', 'revoke_reason', 'updated_at']) then
    raise exception 'consent_records can only be revoked, not edited' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.consent_freeze() from public, anon, authenticated, service_role;
create trigger consent_records_freeze before update or delete on public.consent_records
  for each row execute function app.consent_freeze();
create trigger consent_records_no_truncate before truncate on public.consent_records
  for each statement execute function app.block_change();
revoke delete on public.consent_records from service_role;

-- Is there a consent of this kind in force for the company (and for that tax year, when the consent names one)?
create or replace function app.has_active_consent(p_tenant uuid, p_kind text, p_tax_year integer default null) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consent_records c
    where c.tenant_id = p_tenant
      and c.kind = p_kind
      and c.revoked_at is null
      and (c.expires_at is null or c.expires_at > pg_catalog.now())
      and (c.tax_year is null or p_tax_year is null or c.tax_year = p_tax_year)
  )
$$;
revoke all on function app.has_active_consent(uuid, text, integer) from public, anon;
grant execute on function app.has_active_consent(uuid, text, integer) to authenticated, service_role;

-- Revokes a consent. Consent to share 1099 data: owner only. Other kinds: owner or manager.
create or replace function public.revoke_consent(p_consent uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_kind text;
begin
  select c.tenant_id, c.kind into v_tenant, v_kind from public.consent_records c where c.id = p_consent;
  if v_tenant is null
     or not app.has_role(v_tenant, case when v_kind = 'share_1099_data' then array['owner'] else array['owner', 'manager'] end) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  update public.consent_records
     set revoked_at = pg_catalog.now(), revoked_by = (select auth.uid()), revoke_reason = pg_catalog.btrim(p_reason)
   where id = p_consent and tenant_id = v_tenant;
end
$$;
revoke all on function public.revoke_consent(uuid, text) from public, anon;
grant execute on function public.revoke_consent(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1099 export
-- Totals paid to each worker in a calendar year, for the people who prepare the forms.
-- Card payments are shown separately because the card processor reports those; the preparer decides what is reportable.
-- Refuses without an active 'share_1099_data' consent. Owner or manager, or the service role acting for the preparer.
-- p_include_tax_id = true also returns the decrypted tax IDs; that is recorded in the audit log.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.export_1099_data(p_tenant uuid, p_year integer, p_include_tax_id boolean default false)
returns table (
  worker_id uuid,
  worker_name text,
  email text,
  phone text,
  w9_on_file boolean,
  w9_date date,
  has_tax_id boolean,
  tax_id text,
  payment_count bigint,
  paid_total numeric,
  paid_by_card numeric,
  paid_other_methods numeric
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (app.has_role(p_tenant, array['owner', 'manager']) or app.jwt_role() = 'service_role') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then
    raise exception 'Tax year out of range' using errcode = '22023';
  end if;
  if not app.has_active_consent(p_tenant, 'share_1099_data', p_year) then
    raise exception 'The 1099 export needs the written consent of the company owner to share worker payment data, and none is on record'
      using errcode = 'P0403';
  end if;

  perform app.audit_write(p_tenant, 'export_1099', 'worker_payments', null, null,
    pg_catalog.jsonb_build_object('tax_year', p_year, 'include_tax_id', coalesce(p_include_tax_id, false)));

  return query
    select w.id,
           w.name,
           w.email,
           w.phone,
           w.w9,
           w.w9_date,
           w.tax_id_enc is not null,
           case when coalesce(p_include_tax_id, false) then app.decrypt_pii(w.tax_id_enc) end,
           pg_catalog.count(p.id),
           coalesce(pg_catalog.sum(p.amount), 0)::numeric,
           coalesce(pg_catalog.sum(p.amount) filter (where p.method = 'card'), 0)::numeric,
           coalesce(pg_catalog.sum(p.amount) filter (where p.method <> 'card'), 0)::numeric
    from public.workers w
    join public.worker_payments p
      on p.tenant_id = w.tenant_id and p.worker_id = w.id
     and p.date >= pg_catalog.make_date(p_year, 1, 1) and p.date < pg_catalog.make_date(p_year + 1, 1, 1)
    where w.tenant_id = p_tenant
    group by w.id
    order by w.name;
end
$$;
revoke all on function public.export_1099_data(uuid, integer, boolean) from public, anon;
grant execute on function public.export_1099_data(uuid, integer, boolean) to authenticated, service_role;
