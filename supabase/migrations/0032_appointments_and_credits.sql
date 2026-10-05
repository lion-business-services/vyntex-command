-- 0032 Appointments and client credits: the tables (the brief, sections 14 and 15). The money functions are in 0033.
--   AppointmentType -> appointment_types
--   Appointment     -> appointments       time = start_time, paid { at, method, ref, amount } = paid_at / paid_method /
--                                         paid_ref / paid_amount, createdBy = created_by_kind + created_by
--   Credit          -> credits            used { apptId, at } = used_appt_id / used_at, void { at, by, reason } = void_at /
--                                         void_by / void_reason. A ledger: read only through the gateway.
--
-- Who writes what:
--   a person (through ws_apply)   books, moves, completes, marks a no-show, edits notes. Never the payment, never a
--                                 credit, never the video link.
--   public.appt_mark_paid, appt_cancel, credit_apply, credit_void, credit_issue (0033)
--                                 the payment of an appointment and every entry of the credit ledger
--   the server                    the video link (when a meeting provider created one), requests that came in from
--                                 outside (created by "system"), the release of unpaid appointments
--
-- Date and time are stored as the office reads them (a date and a time of day, no time zone). The moment an
-- appointment starts is worked out with the office's time zone, then the company's, then UTC.

-- ---------------------------------------------------------------------------------------------------------------------
-- appointment_types
-- ---------------------------------------------------------------------------------------------------------------------
create table public.appointment_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  -- { "en": "...", "es": "..." }
  name        jsonb not null check (app.is_l10n(name)),
  minutes     integer not null check (minutes between 5 and 1440),
  -- 0 = free.
  fee         numeric(12,2) not null default 0 check (fee >= 0),
  -- The fee must be paid before the appointment is confirmed.
  prepay      boolean not null default false,
  mode        text not null default 'office' check (mode in ('office', 'phone', 'video')),
  -- Minutes kept free after the appointment.
  buffer      integer check (buffer between 0 and 1440),
  active      boolean not null default true,
  service_id  uuid,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint appointment_types_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, service_id) references public.catalog_services (tenant_id, id) on delete set null (service_id)
);
create index appointment_types_service_idx on public.appointment_types (tenant_id, service_id);
select app.module_table('appointment_types');

create policy appointment_types_select on public.appointment_types for select to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[]));
create policy appointment_types_insert on public.appointment_types for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('appointments', 'config', 'write'))::uuid[]));
create policy appointment_types_update on public.appointment_types for update to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'config', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('appointments', 'config', 'write'))::uuid[]));
create policy appointment_types_delete on public.appointment_types for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'config', 'write', 'delete'))::uuid[]));
create trigger appointment_types_audit after insert or update or delete on public.appointment_types
  for each row execute function app.audit_row();

-- The link of 0031 that was waiting for this table.
alter table public.catalog_services add constraint catalog_services_appt_type_fk foreign key (tenant_id, appointment_type_id)
  references public.appointment_types (tenant_id, id) on delete set null (appointment_type_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------------------------------------------------
create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  type_id           uuid not null,
  client_id         uuid,
  lead_id           uuid,
  job_id            uuid,
  -- The team member the appointment is with.
  staff_id          uuid,
  office_id         uuid,
  date              date not null,
  -- Time of day on the office clock.
  start_time        time not null,
  minutes           integer not null check (minutes between 1 and 1440),
  mode              text not null default 'office' check (mode in ('office', 'phone', 'video')),
  location          text check (length(location) <= 400),
  -- Video link. Only the server writes it, when a meeting provider is connected and created one.
  meet_url          text check (length(meet_url) <= 500 and meet_url ~ '^https://'),
  status            text not null default 'scheduled'
                    check (status in ('requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed', 'no_show', 'cancelled_unpaid', 'cancelled_client', 'cancelled_staff')),
  fee               numeric(12,2) not null default 0 check (fee >= 0),
  -- The payment a person took for this appointment. Written by public.appt_mark_paid and public.credit_apply only.
  paid_at           timestamptz,
  paid_method       text check (paid_method in ('cash', 'check', 'transfer', 'zelle', 'card', 'credit')),
  paid_ref          text check (length(paid_ref) <= 200),
  paid_amount       numeric(12,2) check (paid_amount > 0),
  -- Prepaid appointments: pay by this moment or the slot is released.
  pay_by            timestamptz,
  -- The credit that paid it, when one did (credits: below).
  credit_id         uuid,
  notes             text check (length(notes) <= 4000),
  created           timestamptz not null default now(),
  -- Who booked it: a person, an automation, or "system" for a request that came in from outside.
  created_by_kind   text not null default 'member' check (created_by_kind in ('member', 'automation', 'system')),
  created_by        uuid,
  cancel_reason     text check (length(cancel_reason) <= 1000),
  -- The earlier slot this appointment was moved from.
  rescheduled_from  uuid,
  -- Ids of this appointment in connected systems: { "gcal": "..." }
  external_ids      jsonb check (jsonb_typeof(external_ids) = 'object'),
  extra             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  constraint appointments_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint appointments_paid_whole check ((paid_at is null) = (paid_method is null) and (paid_at is null) = (paid_amount is null)
    and (paid_at is not null or paid_ref is null)),
  constraint appointments_credit_is_payment check (credit_id is null or paid_method = 'credit'),
  constraint appointments_created_by_pair check (created_by_kind = 'member' or created_by is null),
  constraint appointments_not_own_earlier_slot check (rescheduled_from is null or rescheduled_from <> id),
  constraint appointments_within_day check (extract(epoch from start_time) / 60 + minutes <= 1440),
  foreign key (tenant_id, type_id) references public.appointment_types (tenant_id, id) on delete restrict,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null (lead_id),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete set null (job_id),
  foreign key (tenant_id, staff_id) references public.tenant_members (tenant_id, id) on delete restrict,
  foreign key (tenant_id, office_id) references public.offices (tenant_id, id) on delete set null (office_id),
  foreign key (tenant_id, created_by) references public.tenant_members (tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, rescheduled_from) references public.appointments (tenant_id, id) on delete set null (rescheduled_from)
);
create index appointments_type_idx on public.appointments (tenant_id, type_id);
create index appointments_client_idx on public.appointments (tenant_id, client_id, date);
create index appointments_lead_idx on public.appointments (tenant_id, lead_id);
create index appointments_job_idx on public.appointments (tenant_id, job_id);
create index appointments_staff_idx on public.appointments (tenant_id, staff_id, date);
create index appointments_office_idx on public.appointments (tenant_id, office_id);
create index appointments_created_by_idx on public.appointments (tenant_id, created_by);
create index appointments_moved_idx on public.appointments (tenant_id, rescheduled_from);
create index appointments_credit_idx on public.appointments (tenant_id, credit_id);
-- what the release of unpaid appointments looks for
create index appointments_unpaid_idx on public.appointments (pay_by) where status = 'awaiting_payment' and paid_at is null;
select app.module_table('appointments', 'select, delete');
-- The payment, the credit and the video link are not a person's to write.
grant insert (id, tenant_id, type_id, client_id, lead_id, job_id, staff_id, office_id, date, start_time, minutes, mode, location, status, fee, pay_by,
              notes, created, created_by_kind, created_by, cancel_reason, rescheduled_from, external_ids, extra) on public.appointments to authenticated;
grant update (type_id, client_id, lead_id, job_id, staff_id, office_id, date, start_time, minutes, mode, location, status, fee, pay_by,
              notes, created, cancel_reason, rescheduled_from, external_ids, extra) on public.appointments to authenticated;

create policy appointments_select on public.appointments for select to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy appointments_update on public.appointments for update to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())))
  with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy appointments_delete on public.appointments for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'write', 'delete'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function app.audit_row('notes', 'location', 'paid_ref', 'cancel_reason');

-- What a signed-in person may not do to an appointment, whatever a policy says. The guard looks at who runs the
-- statement (current_user), so it is SECURITY INVOKER on purpose: a change made by one of the protected functions
-- of 0033, or by the server, runs as another role and passes; a change a person sends does not.
create or replace function app.appointments_person_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.paid_at is not null then
      raise exception 'A paid appointment is a record of money taken: it can be cancelled, not removed' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    -- booked in the person's own name; an automation that ran while they worked stays "automation"
    new.created_by_kind := case when new.created_by_kind = 'automation' then 'automation' else 'member' end;
    new.created_by := case when new.created_by_kind = 'member' then app.current_member(new.tenant_id) end;
    if new.status = 'confirmed' and new.pay_by is not null then
      raise exception 'An appointment that must be paid first is confirmed by recording its payment' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'awaiting_payment' and new.status = 'confirmed' and old.paid_at is null then
    raise exception 'An appointment that must be paid first is confirmed by recording its payment' using errcode = '42501';
  end if;
  if old.paid_at is not null then
    if new.status in ('cancelled_staff', 'cancelled_client', 'cancelled_unpaid') and new.status <> old.status then
      raise exception 'A paid appointment is cancelled through appt_cancel, so the client keeps what they paid' using errcode = '42501';
    end if;
    if new.fee <> old.fee or new.client_id is distinct from old.client_id then
      raise exception 'The fee and the client of a paid appointment cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.appointments_person_guard() from public, anon;
create trigger appointments_person_guard before insert or update or delete on public.appointments
  for each row execute function app.appointments_person_guard();

-- The company's appointment rules, with the same defaults as appointmentRules() in src/domain/config.ts.
--   noDoubleBooking, prepayHours, creditDays   tenants.config -> 'appointments'
--   clientCancel ('credit' or 'forfeit')       tenants.settings -> 'appointments' (where the screen keeps it)
create or replace function app.appointment_rules(p_tenant uuid, out no_double_booking boolean, out prepay_hours numeric, out credit_days integer, out client_cancel text)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(case when pg_catalog.jsonb_typeof(t.config -> 'appointments' -> 'noDoubleBooking') = 'boolean' then (t.config -> 'appointments' ->> 'noDoubleBooking')::boolean end, true),
         coalesce(case when pg_catalog.jsonb_typeof(t.config -> 'appointments' -> 'prepayHours') = 'number' then (t.config -> 'appointments' ->> 'prepayHours')::numeric end, 24),
         coalesce(case when pg_catalog.jsonb_typeof(t.config -> 'appointments' -> 'creditDays') = 'number' then pg_catalog.floor((t.config -> 'appointments' ->> 'creditDays')::numeric)::integer end, 0),
         case when t.settings -> 'appointments' ->> 'clientCancel' = 'forfeit' then 'forfeit' else 'credit' end
  from public.tenants t where t.id = p_tenant
$$;
revoke all on function app.appointment_rules(uuid) from public, anon, authenticated, service_role;

-- Double booking (the brief, section 14): a team member is never in two appointments at once. Two appointments of
-- the same person on the same day collide when one starts before the other has ended AND its minutes kept free
-- (the buffer of its type) have passed. Only appointments that hold the time count: scheduled, awaiting payment,
-- confirmed. A request holds nothing until the office accepts it. The rule is the company's choice
-- (config.appointments.noDoubleBooking, on unless switched off) and holds for every caller, the server included.
-- An AFTER trigger: it runs once the row passed row level security and its foreign keys. Two bookings for the same
-- person arriving at the same moment wait for each other on a lock taken per person, so neither can miss the other.
create or replace function app.appointments_double_booking() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_start integer;
  v_end integer;
  v_other uuid;
begin
  if new.staff_id is null or new.status not in ('scheduled', 'awaiting_payment', 'confirmed') then return null; end if;
  if tg_op = 'UPDATE' and old.status in ('scheduled', 'awaiting_payment', 'confirmed')
     and (old.staff_id, old.date, old.start_time, old.minutes, old.type_id) is not distinct from (new.staff_id, new.date, new.start_time, new.minutes, new.type_id) then
    return null;   -- it already held this very slot
  end if;
  if not (select r.no_double_booking from app.appointment_rules(new.tenant_id) r) then return null; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vx.appointments:' || new.tenant_id::text || ':' || new.staff_id::text, 0));
  v_start := (extract(epoch from new.start_time) / 60)::integer;
  v_end := v_start + new.minutes + coalesce((select y.buffer from public.appointment_types y where y.tenant_id = new.tenant_id and y.id = new.type_id), 0);
  select a.id into v_other
  from public.appointments a
  left join public.appointment_types y on y.tenant_id = a.tenant_id and y.id = a.type_id
  where a.tenant_id = new.tenant_id and a.staff_id = new.staff_id and a.date = new.date and a.id <> new.id
    and a.status in ('scheduled', 'awaiting_payment', 'confirmed')
    and v_start < (extract(epoch from a.start_time) / 60)::integer + a.minutes + coalesce(y.buffer, 0)
    and (extract(epoch from a.start_time) / 60)::integer < v_end
  limit 1;
  if v_other is not null then
    raise exception 'This team member already has an appointment at that time' using errcode = '23P01', constraint = 'appointments_no_double_booking';
  end if;
  return null;
end
$$;
revoke all on function app.appointments_double_booking() from public, anon, authenticated, service_role;
create trigger appointments_double_booking after insert or update of staff_id, date, start_time, minutes, status, type_id on public.appointments
  for each row execute function app.appointments_double_booking();

-- The link of 0012 that was waiting for this table: a task that belongs to an appointment.
alter table public.tasks add constraint tasks_appt_fk foreign key (tenant_id, appt_id)
  references public.appointments (tenant_id, id) on delete set null (appt_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- credits: money the business owes a client in service. A ledger: an entry is written once, then used once, or
-- voided once with a reason, or it runs out on its date. Nothing else about it ever changes, for anyone.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.credits (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  client_id      uuid not null,
  amount         numeric(12,2) not null check (amount > 0),
  reason         text not null check (reason in ('cancel_staff', 'reschedule', 'goodwill', 'overpayment')),
  from_appt_id   uuid,
  at             timestamptz not null default now(),
  by_member_id   uuid,
  used_appt_id   uuid,
  used_at        timestamptz,
  -- Last day the credit can be used. NULL = it does not run out.
  expires        date,
  void_at        timestamptz,
  void_by        uuid,
  void_reason    text check (length(void_reason) <= 500),
  extra          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  constraint credits_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint credits_used_pair check ((used_appt_id is null) = (used_at is null)),
  constraint credits_void_pair check ((void_at is null) = (void_reason is null)),
  constraint credits_used_or_void check (used_at is null or void_at is null),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict,
  foreign key (tenant_id, from_appt_id) references public.appointments (tenant_id, id) on delete restrict,
  foreign key (tenant_id, used_appt_id) references public.appointments (tenant_id, id) on delete restrict,
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id),
  foreign key (tenant_id, void_by) references public.tenant_members (tenant_id, id) on delete set null (void_by)
);
create index credits_client_idx on public.credits (tenant_id, client_id, at);
create index credits_from_appt_idx on public.credits (tenant_id, from_appt_id);
create index credits_used_appt_idx on public.credits (tenant_id, used_appt_id);
create index credits_by_idx on public.credits (tenant_id, by_member_id);
create index credits_void_by_idx on public.credits (tenant_id, void_by);
select app.module_table('credits', 'select');

alter table public.appointments add constraint appointments_credit_fk foreign key (tenant_id, credit_id)
  references public.credits (tenant_id, id) on delete restrict;

create policy credits_select on public.credits for select to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[])
    and client_id not in (select app.hidden_clients()));
create trigger credits_audit after insert or update or delete on public.credits
  for each row execute function app.audit_row('void_reason');

-- The ledger rule, for every caller: the server key and the protected functions included. An AFTER trigger, so a
-- link that points at another company is still answered by the foreign key first.
create or replace function app.credits_ledger_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.client_id, new.amount, new.reason, new.from_appt_id, new.at, new.expires) is distinct from (old.client_id, old.amount, old.reason, old.from_appt_id, old.at, old.expires)
     -- the person who wrote or voided it can only fall away (a member that was removed), never be replaced
     or (new.by_member_id is distinct from old.by_member_id and new.by_member_id is not null)
     or (new.void_by is distinct from old.void_by and old.void_at is not null and new.void_by is not null) then
    raise exception 'A credit is a ledger entry: it is never edited' using errcode = '42501', constraint = 'credits_ledger';
  end if;
  if (old.used_at is not null or old.void_at is not null)
     and (new.used_at, new.used_appt_id, new.void_at, new.void_reason) is distinct from (old.used_at, old.used_appt_id, old.void_at, old.void_reason) then
    raise exception 'A credit is used once or voided once' using errcode = '42501', constraint = 'credits_single_use';
  end if;
  return null;
end
$$;
revoke all on function app.credits_ledger_guard() from public, anon;
create trigger credits_ledger_guard after update on public.credits for each row execute function app.credits_ledger_guard();
create trigger credits_no_delete before delete on public.credits for each row execute function app.block_change();
create trigger credits_no_truncate before truncate on public.credits for each statement execute function app.block_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. Appointment types (16) after the catalog (14); appointments (45) after clients, leads and jobs and
-- before tasks (50), which may name an appointment; credits (46) are read only.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "apptTypes", "ord": 16, "relation": "appointment_types",
  "read_caps": ["appointments"], "write_caps": ["appointments", "config"], "delete_caps": ["delete"], "order_by": "t.created_at, t.id",
  "fields": { "id": "id", "name": "name", "minutes": "minutes", "fee": "fee", "prepay": "prepay", "mode": "mode", "buffer": "buffer",
              "active": "active", "serviceId": "service_id" }
}$j$);

select app.ws_register($j${
  "name": "appointments", "ord": 45, "relation": "appointments",
  "read_caps": ["appointments"], "write_caps": ["appointments"], "delete_caps": ["delete"], "order_by": "t.date desc, t.start_time desc, t.id",
  "fields": {
    "id": "id", "typeId": "type_id", "clientId": "client_id", "leadId": "lead_id", "jobId": "job_id",
    "staffId": { "col": "staff_id", "empty": "" }, "officeId": "office_id", "date": "date", "time": "start_time", "minutes": "minutes",
    "mode": "mode", "location": "location", "meetUrl": { "col": "meet_url", "ro": true }, "status": "status", "fee": "fee",
    "paid": { "kind": "obj", "ro": true, "cols": { "at": "paid_at", "method": "paid_method", "ref": "paid_ref", "amount": "paid_amount" } },
    "payBy": "pay_by", "creditId": { "col": "credit_id", "ro": true }, "notes": "notes", "created": "created",
    "createdBy": { "kind": "actor", "kind_col": "created_by_kind", "id_col": "created_by" },
    "cancelReason": "cancel_reason", "rescheduledFrom": { "col": "rescheduled_from", "defer": true }, "externalIds": "external_ids"
  }
}$j$);

select app.ws_register($j${
  "name": "credits", "ord": 46, "relation": "credits", "read_caps": ["appointments"], "order_by": "t.at desc, t.id",
  "fields": {
    "id": "id", "clientId": "client_id", "amount": "amount", "reason": "reason", "fromApptId": "from_appt_id", "at": "at",
    "by": { "col": "by_member_id", "empty": "" },
    "used": { "kind": "obj", "cols": { "apptId": "used_appt_id", "at": "used_at" } },
    "expires": "expires",
    "void": { "kind": "obj", "cols": { "at": "void_at", "by": "void_by", "reason": "void_reason" } }
  }
}$j$);

select app.lockdown_check();
