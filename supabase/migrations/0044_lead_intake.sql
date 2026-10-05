-- 0044 Leads from the company's own website form (the brief, sections 20 and 36)
-- A company gets a "form key": a random value its website sends with each submission, so the server knows which
-- company the form belongs to. Only the hash of the key is stored; the key is shown once, when it is made or replaced
-- (intake_key_rotate, by someone who may change settings). Replacing it makes the old one stop working at once.
-- intake_submit is the server's: it finds the company, refuses nothing loudly (an unknown key gets the same quiet
-- answer), looks for a duplicate first, creates the lead, gives it to the next person in the rotation, and is safe
-- to repeat with the same client key.

create table app.intake_forms (
  tenant_id   uuid primary key references public.tenants (id) on delete cascade,
  key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz not null default now(),
  rotated_by  uuid
);
alter table app.intake_forms enable row level security;
alter table app.intake_forms force row level security;
revoke all on app.intake_forms from public, anon, authenticated, service_role;

create or replace function public.intake_key_rotate(p_tenant uuid, p_active boolean default true) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_key text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform app.require_mfa(p_tenant);
  if not (app.can(p_tenant, 'settings') and app.can(p_tenant, 'write')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into app.intake_forms (tenant_id, key_hash, active, rotated_by)
  values (p_tenant, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), coalesce(p_active, true), app.current_member(p_tenant))
  on conflict (tenant_id) do update set key_hash = excluded.key_hash, active = excluded.active, rotated_at = now(), rotated_by = excluded.rotated_by;
  perform app.security_event(p_tenant, (select auth.uid()), 'intake.key_rotated', 'ok', null, jsonb_build_object('active', coalesce(p_active, true)));
  -- the key leaves the database once, here
  return jsonb_build_object('key', case when coalesce(p_active, true) then v_key end, 'active', coalesce(p_active, true));
end
$$;

create or replace function public.intake_key_state(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not app.can(p_tenant, 'settings') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_build_object('exists', true, 'active', f.active, 'rotatedAt', app.ws_iso(f.rotated_at)) from app.intake_forms f where f.tenant_id = p_tenant),
                  jsonb_build_object('exists', false));
end
$$;

-- p_fields: { name, email, phone, company, address, service, message, lang, smsOptIn }, already checked by the server.
create or replace function public.intake_submit(p_key_hash text, p_fields jsonb, p_idem text, p_ip_hash text default null, p_consent_text text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_lead uuid;
  v_dup uuid;
  v_ticket text;
  v_prefix text;
  v_n bigint;
begin
  select f.tenant_id into v_tenant from app.intake_forms f join public.tenants t on t.id = f.tenant_id
   where f.key_hash = p_key_hash and f.active and t.status = 'active';
  if v_tenant is null then return null; end if;
  if p_idem is null or p_idem !~ '^[A-Za-z0-9_-]{8,80}$' or btrim(coalesce(p_fields ->> 'name', '')) = '' then raise exception 'invalid' using errcode = '22023'; end if;
  -- one submission at a time per company and key: a double click cannot make two leads
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_idem, 44));
  select l.id into v_lead from public.leads l where l.tenant_id = v_tenant and l.extra ->> 'intakeIdem' = p_idem;
  if v_lead is not null then return jsonb_build_object('ok', true, 'tenantId', v_tenant, 'leadId', v_lead, 'replay', true); end if;

  select d.lead_id into v_dup from app.lead_find_duplicate(v_tenant, nullif(p_fields ->> 'email', ''), nullif(p_fields ->> 'phone', '')) d limit 1;
  if v_dup is not null then
    -- the same person wrote again: no second lead. The one that exists remembers it, so the office sees it.
    update public.leads l set extra = l.extra || jsonb_build_object('intakeAgainAt', app.ws_iso(now()), 'intakeAgain', coalesce((l.extra ->> 'intakeAgain')::integer, 0) + 1)
     where l.tenant_id = v_tenant and l.id = v_dup;
    perform app.security_event(v_tenant, null, 'intake.duplicate', 'info', p_ip_hash, jsonb_build_object('lead', v_dup));
    return jsonb_build_object('ok', true, 'tenantId', v_tenant, 'leadId', v_dup, 'duplicate', true);
  end if;

  -- the next ticket: the company's own prefix (taken from its newest lead) and the next number
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':ticket', 44));
  select coalesce(max(nullif(regexp_replace(l.ticket, '\D', '', 'g'), '')::bigint), 1000),
         coalesce((select regexp_replace(x.ticket, '\d+$', '') from public.leads x where x.tenant_id = v_tenant order by x.created_at desc limit 1), 'W-')
    into v_n, v_prefix from public.leads l where l.tenant_id = v_tenant and length(regexp_replace(l.ticket, '\D', '', 'g')) between 1 and 15;
  v_ticket := coalesce(v_prefix, 'W-') || (coalesce(v_n, 1000) + 1);
  insert into public.leads (tenant_id, ticket, name, company, phone, email, address, type, source, source_detail, status, lang, sms_opt_in, extra)
  values (v_tenant, v_ticket, left(btrim(p_fields ->> 'name'), 200), nullif(left(btrim(coalesce(p_fields ->> 'company', '')), 200), ''),
          left(coalesce(p_fields ->> 'phone', ''), 40), left(lower(coalesce(p_fields ->> 'email', '')), 320), left(coalesce(p_fields ->> 'address', ''), 300),
          coalesce(nullif(left(btrim(coalesce(p_fields ->> 'service', '')), 80), ''), 'General'), 'website', 'website form', 'new',
          case when p_fields ->> 'lang' in ('en', 'es', 'zh') then p_fields ->> 'lang' end, (p_fields ->> 'smsOptIn')::boolean,
          jsonb_strip_nulls(jsonb_build_object('intakeIdem', p_idem, 'intake', true, 'message', nullif(left(coalesce(p_fields ->> 'message', ''), 4000), ''),
            'consent', case when coalesce(p_consent_text, '') <> '' then jsonb_strip_nulls(jsonb_build_object('text', left(p_consent_text, 2000), 'at', app.ws_iso(now()), 'ipHash', p_ip_hash)) end)))
  returning id into v_lead;
  perform app.lead_assign_next(v_tenant, v_lead);
  perform app.security_event(v_tenant, null, 'intake.lead', 'ok', p_ip_hash, jsonb_build_object('lead', v_lead));
  return jsonb_build_object('ok', true, 'tenantId', v_tenant, 'leadId', v_lead);
end
$$;

revoke all on function public.intake_submit(text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.intake_submit(text, jsonb, text, text, text) to service_role;
revoke all on function public.intake_key_rotate(uuid, boolean), public.intake_key_state(uuid) from public, anon, service_role;
grant execute on function public.intake_key_rotate(uuid, boolean), public.intake_key_state(uuid) to authenticated;

select app.lockdown_check();
