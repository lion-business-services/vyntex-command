-- 0033 Appointments and credits: the protected money operations (the brief, sections 14, 15, 79 and 89)
-- The same rules as the sample implementation in src/domain/actions/appointments.ts, enforced here for a live
-- workspace. Every amount is numeric(12,2): sums and comparisons are exact to the cent.
--
--   appt_mark_paid   records a payment a person took (once), confirms the appointment, and keeps anything above the
--                    fee for the client as a credit. Safe to repeat with the same idempotency key.
--   appt_cancel      cancels an open appointment. What was paid stays with the client as a credit, except when the
--                    client cancels inside the prepay window and the company chose to keep late cancellations.
--   credit_apply     pays an appointment's fee with a credit: single use, same client, not expired, not voided.
--                    The credit row is locked first, so two sessions can never spend the same credit.
--   credit_void      takes a credit out of use, with who and why. The entry stays in the ledger.
--   credit_issue     writes a credit by hand (goodwill, an overpayment taken elsewhere, a move).
--   appt_release_unpaid, credits_expiring   for the server's scheduled jobs (service role only)
--
-- No card is charged anywhere here: "paid" records what a person took, with its method and reference.
-- All of them are SECURITY DEFINER because they write the two things a person never writes directly: the payment
-- of an appointment and the credit ledger. Each one checks the caller first (app.module_gate) and writes its event.

-- The expiry date of a credit issued today, or NULL when the company's credits do not run out.
create or replace function app.credit_expiry(p_tenant uuid) returns date
language sql stable security definer
set search_path = ''
as $$ select case when r.credit_days > 0 then current_date + r.credit_days end from app.appointment_rules(p_tenant) r $$;

-- The clock of an office: its own time zone, then the company's, then UTC. A name the database does not know is
-- treated as not set.
create or replace function app.office_timezone(p_tenant uuid, p_office uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select z.name from pg_catalog.pg_timezone_names z
      where z.name = coalesce((select o.timezone from public.offices o where o.tenant_id = p_tenant and o.id = p_office),
                              (select t.timezone from public.tenants t where t.id = p_tenant)) limit 1),
    'UTC')
$$;

-- The moment an appointment starts: its date and time of day on the clock of its office.
create or replace function app.appointment_start(p_tenant uuid, p_office uuid, p_date date, p_time time) returns timestamptz
language sql stable security definer
set search_path = ''
as $$ select (p_date + p_time) at time zone app.office_timezone(p_tenant, p_office) $$;

-- One ledger entry. Internal: reached only through the functions below.
create or replace function app.credit_write(p_tenant uuid, p_client uuid, p_amount numeric, p_reason text, p_from_appt uuid, p_by uuid, p_expires date) returns uuid
language sql security definer
set search_path = ''
as $$
  insert into public.credits (tenant_id, client_id, amount, reason, from_appt_id, by_member_id, expires)
  values (p_tenant, p_client, p_amount, p_reason, p_from_appt, p_by, p_expires)
  returning id
$$;

revoke all on function app.credit_expiry(uuid), app.office_timezone(uuid, uuid), app.appointment_start(uuid, uuid, date, time), app.credit_write(uuid, uuid, numeric, text, uuid, uuid, date)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- appt_mark_paid
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.appt_mark_paid(p_tenant uuid, p_appt uuid, p_method text, p_ref text, p_amount numeric, p_idem text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'appointments', 'money', 'write');
  v_key text;
  v_idem jsonb;
  a public.appointments%rowtype;
  v_over numeric(12,2);
  v_out jsonb;
begin
  if p_method is null or p_method not in ('cash', 'check', 'transfer', 'zelle', 'card')
     or p_amount is null or p_amount <> pg_catalog.round(p_amount, 2) or p_amount > 9999999999.99 or pg_catalog.length(coalesce(p_ref, '')) > 200 then
    perform app.module_refuse('invalid');
  end if;

  -- a second click or a retry with the same key gets the first answer and records nothing twice
  if p_idem is not null then
    if p_idem !~ '^[A-Za-z0-9_.:-]{8,100}$' then perform app.module_refuse('invalid'); end if;
    v_key := p_tenant::text || ':' || (select auth.uid())::text || ':' || p_idem;
    v_idem := app.idem_begin('appt.paid', v_key,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_appt::text || '|' || p_method || '|' || coalesce(pg_catalog.btrim(p_ref), '') || '|' || p_amount::numeric(12,2)::text, 'UTF8')), 'hex'),
      p_tenant);
    if v_idem ->> 'state' = 'replay' then return v_idem -> 'response'; end if;
    if v_idem ->> 'state' <> 'new' then perform app.module_refuse('conflict'); end if;
  end if;

  select * into a from public.appointments x where x.tenant_id = p_tenant and x.id = p_appt for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if a.client_id is not null and not app.client_visible(p_tenant, a.client_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- paid once: a payment is never recorded twice, and never on an appointment that is off
  if a.paid_at is not null or a.status in ('cancelled_unpaid', 'cancelled_client', 'cancelled_staff', 'no_show', 'requested') then perform app.module_refuse('conflict'); end if;
  if a.fee <= 0 or p_amount <= 0 then perform app.module_refuse('invalid'); end if;
  if p_amount < a.fee then perform app.module_refuse('too_small'); end if;
  -- more than the fee is kept for the client as a credit, which needs a client record
  v_over := p_amount - a.fee;
  if v_over > 0 and a.client_id is null then perform app.module_refuse('invalid'); end if;

  update public.appointments x
     set paid_at = pg_catalog.now(), paid_method = p_method, paid_ref = coalesce(pg_catalog.btrim(p_ref), ''), paid_amount = p_amount,
         status = case when x.status in ('awaiting_payment', 'scheduled') then 'confirmed' else x.status end
   where x.tenant_id = p_tenant and x.id = p_appt;
  if v_over > 0 then
    perform app.credit_write(p_tenant, a.client_id, v_over, 'overpayment', a.id, v_me, app.credit_expiry(p_tenant));
  end if;
  perform app.module_event(p_tenant, 'appointment.paid', 'appointment', a.id,
    pg_catalog.jsonb_build_object('method', p_method, 'amount', p_amount, 'over', v_over));
  v_out := app.ws_read(p_tenant, 'appointments', app.my_permissions(p_tenant), p_appt::text);
  if p_idem is not null then perform app.idem_finish('appt.paid', v_key, v_out); end if;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- appt_cancel. Answer: { appointment, credit?, kept? } where kept is "forfeit" (the company's rule keeps a late
-- cancellation) or "no_client" (paid by someone who is not a client yet, so no credit can be written).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.appt_cancel(p_tenant uuid, p_appt uuid, p_by text, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'appointments', 'write');
  v_perms constant text[] := app.my_permissions(p_tenant);
  a public.appointments%rowtype;
  r record;
  v_held numeric(12,2) := 0;
  v_kept text;
  v_credit uuid;
begin
  if p_by is null or p_by not in ('client', 'staff') then perform app.module_refuse('invalid'); end if;
  select * into a from public.appointments x where x.tenant_id = p_tenant and x.id = p_appt for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if a.client_id is not null and not app.client_visible(p_tenant, a.client_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if a.status not in ('requested', 'scheduled', 'awaiting_payment', 'confirmed') then perform app.module_refuse('conflict'); end if;
  if coalesce(pg_catalog.btrim(p_reason), '') = '' or pg_catalog.length(p_reason) > 1000 then perform app.module_refuse('invalid'); end if;

  -- what the appointment still holds of the client's money (the part above the fee became a credit when it was paid)
  if a.paid_at is not null then v_held := least(a.paid_amount, a.fee); end if;
  if v_held > 0 then
    select * into r from app.appointment_rules(p_tenant);
    if p_by = 'client' and r.client_cancel = 'forfeit'
       and app.appointment_start(p_tenant, a.office_id, a.date, a.start_time) - pg_catalog.now() < pg_catalog.make_interval(secs => (r.prepay_hours * 3600)::double precision) then
      v_kept := 'forfeit';
    elsif a.client_id is null then
      v_kept := 'no_client';
    else
      v_credit := app.credit_write(p_tenant, a.client_id, v_held, case when p_by = 'staff' then 'cancel_staff' else 'reschedule' end, a.id, v_me, app.credit_expiry(p_tenant));
    end if;
  end if;

  update public.appointments x
     set status = case when p_by = 'staff' then 'cancelled_staff' else 'cancelled_client' end, cancel_reason = pg_catalog.btrim(p_reason)
   where x.tenant_id = p_tenant and x.id = p_appt;
  perform app.module_event(p_tenant, 'appointment.cancel', 'appointment', a.id,
    pg_catalog.jsonb_build_object('by', p_by, 'credit', case when v_credit is not null then v_held end, 'kept', v_kept));
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'appointment', app.ws_read(p_tenant, 'appointments', v_perms, p_appt::text),
    'credit', case when v_credit is not null then app.ws_read(p_tenant, 'credits', v_perms, v_credit::text) end,
    'kept', v_kept));
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- credit_apply. Answer: { credit, appointment, remainder? }. The credit is spent whole; what the fee did not use
-- comes back as a new entry with the same expiry.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.credit_apply(p_tenant uuid, p_credit uuid, p_appt uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'appointments', 'credits', 'write');
  v_perms constant text[] := app.my_permissions(p_tenant);
  c public.credits%rowtype;
  a public.appointments%rowtype;
  v_left numeric(12,2);
  v_rest uuid;
begin
  -- The row lock is the single-use rule under load: a second session that wants the same credit waits here, and
  -- when it goes on it reads the credit as the first session left it: used.
  select * into c from public.credits x where x.tenant_id = p_tenant and x.id = p_credit for update;
  if not found then perform app.module_refuse('not_found'); end if;
  select * into a from public.appointments x where x.tenant_id = p_tenant and x.id = p_appt for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if not app.client_visible(p_tenant, c.client_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if c.used_at is not null or c.void_at is not null then perform app.module_refuse('conflict'); end if;
  if c.expires is not null and c.expires < current_date then perform app.module_refuse('expired'); end if;
  if a.paid_at is not null or a.status in ('cancelled_unpaid', 'cancelled_client', 'cancelled_staff', 'no_show', 'requested') then perform app.module_refuse('conflict'); end if;
  if a.client_id is distinct from c.client_id or a.fee <= 0 then perform app.module_refuse('invalid'); end if;
  -- one payment per appointment: a credit that does not cover the fee cannot be part of it
  if c.amount < a.fee then perform app.module_refuse('too_small'); end if;

  update public.credits x set used_appt_id = a.id, used_at = pg_catalog.now() where x.tenant_id = p_tenant and x.id = c.id;
  update public.appointments x
     set paid_at = pg_catalog.now(), paid_method = 'credit', paid_ref = c.id::text, paid_amount = a.fee, credit_id = c.id,
         status = case when x.status in ('awaiting_payment', 'scheduled') then 'confirmed' else x.status end
   where x.tenant_id = p_tenant and x.id = a.id;
  v_left := c.amount - a.fee;
  if v_left > 0 then
    v_rest := app.credit_write(p_tenant, c.client_id, v_left, 'overpayment', a.id, v_me, c.expires);
  end if;
  perform app.module_event(p_tenant, 'credit.apply', 'appointment', a.id, pg_catalog.jsonb_build_object('credit', c.id, 'amount', a.fee, 'left', v_left));
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'credit', app.ws_read(p_tenant, 'credits', v_perms, c.id::text),
    'appointment', app.ws_read(p_tenant, 'appointments', v_perms, a.id::text),
    'remainder', case when v_rest is not null then app.ws_read(p_tenant, 'credits', v_perms, v_rest::text) end));
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- credit_void and credit_issue
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.credit_void(p_tenant uuid, p_credit uuid, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'appointments', 'credits', 'write');
  c public.credits%rowtype;
begin
  select * into c from public.credits x where x.tenant_id = p_tenant and x.id = p_credit for update;
  if not found then perform app.module_refuse('not_found'); end if;
  if not app.client_visible(p_tenant, c.client_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if c.used_at is not null or c.void_at is not null then perform app.module_refuse('conflict'); end if;
  if c.expires is not null and c.expires < current_date then perform app.module_refuse('expired'); end if;
  if coalesce(pg_catalog.btrim(p_reason), '') = '' or pg_catalog.length(p_reason) > 500 then perform app.module_refuse('invalid'); end if;
  update public.credits x set void_at = pg_catalog.now(), void_by = v_me, void_reason = pg_catalog.btrim(p_reason) where x.tenant_id = p_tenant and x.id = c.id;
  perform app.module_event(p_tenant, 'credit.void', 'client', c.client_id, pg_catalog.jsonb_build_object('credit', c.id, 'amount', c.amount));
  return app.ws_read(p_tenant, 'credits', app.my_permissions(p_tenant), c.id::text);
end
$$;

-- A credit written by hand. "cancel_staff" is not offered: that reason belongs to appt_cancel.
create or replace function public.credit_issue(p_tenant uuid, p_client uuid, p_amount numeric, p_reason text, p_appt uuid default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'appointments', 'credits', 'write');
  v_id uuid;
begin
  if p_reason is null or p_reason not in ('goodwill', 'overpayment', 'reschedule')
     or p_amount is null or p_amount <= 0 or p_amount <> pg_catalog.round(p_amount, 2) or p_amount > 9999999999.99 then
    perform app.module_refuse('invalid');
  end if;
  if not app.client_visible(p_tenant, p_client) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_appt is not null and not exists (select 1 from public.appointments x where x.tenant_id = p_tenant and x.id = p_appt and x.client_id = p_client) then
    perform app.module_refuse('invalid');
  end if;
  v_id := app.credit_write(p_tenant, p_client, p_amount, p_reason, p_appt, v_me, app.credit_expiry(p_tenant));
  perform app.module_event(p_tenant, 'credit.issue', 'client', p_client, pg_catalog.jsonb_build_object('credit', v_id, 'amount', p_amount, 'reason', p_reason));
  return app.ws_read(p_tenant, 'credits', app.my_permissions(p_tenant), v_id::text);
end
$$;

revoke all on function public.appt_mark_paid(uuid, uuid, text, text, numeric, text), public.appt_cancel(uuid, uuid, text, text),
  public.credit_apply(uuid, uuid, uuid), public.credit_void(uuid, uuid, text), public.credit_issue(uuid, uuid, numeric, text, uuid) from public, anon, service_role;
grant execute on function public.appt_mark_paid(uuid, uuid, text, text, numeric, text), public.appt_cancel(uuid, uuid, text, text),
  public.credit_apply(uuid, uuid, uuid), public.credit_void(uuid, uuid, text), public.credit_issue(uuid, uuid, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- For the server's scheduled jobs (service role only)
-- ---------------------------------------------------------------------------------------------------------------------

-- Releases prepaid appointments whose pay-by moment has passed: status "cancelled_unpaid". Returns what was released
-- so the job can raise "appointment.unpaid" for each. Safe to run as often as wanted and from several runners at
-- once: an appointment is released once ("skip locked" leaves a row another runner holds to that runner).
create or replace function public.appt_release_unpaid(p_limit integer default 200) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    update public.appointments x set status = 'cancelled_unpaid'
     where x.id in (
       select a.id from public.appointments a
       where a.status = 'awaiting_payment' and a.paid_at is null and a.pay_by is not null and a.pay_by <= pg_catalog.now()
       order by a.pay_by
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
       for update skip locked)
    returning x.tenant_id, x.id, x.client_id, x.lead_id, x.staff_id, x.date, x.start_time
  loop
    perform app.module_event(r.tenant_id, 'appointment.unpaid', 'appointment', r.id, '{}'::jsonb);
    v_out := v_out || pg_catalog.jsonb_build_object('tenantId', r.tenant_id, 'id', r.id, 'clientId', r.client_id, 'leadId', r.lead_id,
      'staffId', r.staff_id, 'date', r.date, 'time', pg_catalog.to_char(r.start_time, 'HH24:MI'));
  end loop;
  return v_out;
end
$$;

-- Credits that can still be used and run out within the given days, for the reminder job.
create or replace function public.credits_expiring(p_days integer default 7) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenantId', c.tenant_id, 'id', c.id, 'clientId', c.client_id, 'amount', c.amount, 'expires', c.expires)
                                       order by c.expires, c.id), '[]'::jsonb)
  from public.credits c
  where c.used_at is null and c.void_at is null and c.expires is not null
    and c.expires between current_date and current_date + greatest(0, least(coalesce(p_days, 7), 365))
$$;

revoke all on function public.appt_release_unpaid(integer), public.credits_expiring(integer) from public, anon, authenticated;
grant execute on function public.appt_release_unpaid(integer), public.credits_expiring(integer) to service_role;

select app.lockdown_check();
