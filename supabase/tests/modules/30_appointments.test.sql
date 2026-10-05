-- Module tests, part 3: appointments, their payment, credits and the double booking rule (0032, 0033).
-- Company M (practice) for the money functions: its staff hold "money" and "credits". Company N (field edition) for
-- the people who do not: office staff there book and cancel, and never record a payment.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('34. appointments and credits') \g /dev/null

-- One appointment of the prepaid type (45 minutes, fee as given), each on its own day so none collides with another.
create or replace function test.mk_appt(n integer, p text, client uuid, status text, fee numeric, paid numeric default null, on_date date default null, lead uuid default null) returns uuid language plpgsql as $$
begin
  insert into public.appointments (id, tenant_id, type_id, client_id, lead_id, staff_id, office_id, date, start_time, minutes, mode, status, fee, pay_by, paid_at, paid_method, paid_ref, paid_amount)
  values (test.u(n), test.id(p), test.id(p || '.at2'), client, lead, test.id(p || '.m_owner'), test.id(p || '.o1'), coalesce(on_date, current_date + 40 + (n % 300)), '09:00', 45, 'video', status, fee,
          case when status = 'awaiting_payment' then now() + interval '2 days' end,
          case when paid is not null then now() end, case when paid is not null then 'cash' end, case when paid is not null then '' end, paid);
  return test.u(n);
end $$;
create or replace function test.pay(who text, p text, n integer, method text, ref text, amount text, idem text default null) returns jsonb language sql as $$
  select test.f(who, format('public.appt_mark_paid(%L, %L, %L, %L, %s, %L)', test.id(p), test.u(n), method, ref, amount, idem))
$$;
create or replace function test.cancel(who text, p text, n integer, by text, reason text) returns jsonb language sql as $$
  select test.f(who, format('public.appt_cancel(%L, %L, %L, %L)', test.id(p), test.u(n), by, reason))
$$;
create or replace function test.use_credit(who text, p text, credit uuid, n integer) returns jsonb language sql as $$
  select test.f(who, format('public.credit_apply(%L, %L, %L)', test.id(p), credit, test.u(n)))
$$;
create or replace function test.mk_credit(n integer, p text, client uuid, amount numeric, expires date default null) returns uuid language plpgsql as $$
begin
  insert into public.credits (id, tenant_id, client_id, amount, reason, by_member_id, expires) values (test.u(n), test.id(p), client, amount, 'goodwill', test.id(p || '.m_owner'), expires);
  return test.u(n);
end $$;

-- Two clients of M: one everyone sees, one of the second office (staff of M work from the first).
update public.tenant_members set office_ids = array[test.id('m.o1')] where id = test.id('m.m_staff');
insert into public.clients (id, tenant_id, name, phone, email) values (test.u(4001), test.id('m'), 'Appointment Client', '609-555-0401', 'appt-client@example.com');
insert into public.clients (id, tenant_id, name, phone, email, office_id) values (test.u(4002), test.id('m'), 'Second Office Appointment Client', '609-555-0402', 'appt-hidden@example.com', test.id('m.o2'));
insert into public.clients (id, tenant_id, name, phone, email) values (test.u(4003), test.id('m'), 'Another Appointment Client', '609-555-0403', 'appt-other@example.com');
insert into public.leads (id, tenant_id, ticket, name, type, source, status) values (test.u(4004), test.id('m'), 'M-4004', 'Walk-in Lead', 'service', 'website', 'new');

-- ---------------------------------------------------------------------------------------------------------------------
-- appt_mark_paid
-- ---------------------------------------------------------------------------------------------------------------------
select test.mk_appt(4010, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.pay('m_staff', 'm', 4010, 'cash', '  R-1  ', '75.00') as p1 \gset
select test.ok(:'p1'::jsonb ->> 'status' = 'confirmed' and :'p1'::jsonb -> 'paid' ->> 'method' = 'cash' and :'p1'::jsonb -> 'paid' ->> 'ref' = 'R-1' and (:'p1'::jsonb -> 'paid' ->> 'amount')::numeric = 75
           and :'p1'::jsonb -> 'paid' ? 'at' and :'p1'::jsonb ->> 'id' = test.u(4010)::text,
  'appt_mark_paid: the exact fee confirms the appointment and answers with the Appointment, payment included') \g /dev/null
select test.ok((select status = 'confirmed' and paid_amount = 75.00 and paid_method = 'cash' and paid_ref = 'R-1' and paid_at > now() - interval '1 minute' and credit_id is null from public.appointments where id = test.u(4010))
           and not exists (select 1 from public.credits where from_appt_id = test.u(4010)),
  'the payment is on the row, and the exact fee leaves no credit') \g /dev/null
select test.ok(exists (select 1 from app.security_events where tenant_id = test.id('m') and kind = 'appointment.paid' and user_id = test.id('m_staff') and meta ->> 'method' = 'cash')
           and exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'appointment.paid' and table_name = 'appointment' and row_id = test.u(4010) and actor = test.id('m_staff')),
  'the payment is in the security events and in the audit log, with the appointment and who recorded it') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4010, 'cash', 'R-2', '75.00') ->> 'word', 'conflict', 'a payment is recorded once: a second one on the same appointment is refused') \g /dev/null
select test.is(test.pay('m_owner', 'm', 4010, 'check', 'R-3', '80.00') ->> 'word', 'conflict', 'by anyone, with any amount') \g /dev/null
select test.ok((select paid_ref = 'R-1' and paid_amount = 75.00 from public.appointments where id = test.u(4010)), 'and the first payment stands as it was') \g /dev/null

-- more than the fee: the difference is the client's, to the cent
select test.mk_appt(4011, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.pay('m_manager', 'm', 4011, 'zelle', 'Z-100', '100.10') as p2 \gset
select test.ok((:'p2'::jsonb -> 'paid' ->> 'amount')::numeric = 100.10
           and (select count(*) = 1 and min(amount) = 25.10 and min(reason) = 'overpayment' and min(by_member_id::text) = test.id('m.m_manager')::text and bool_and(expires is null and used_at is null)
                from public.credits where from_appt_id = test.u(4011)),
  'paying 100.10 for a fee of 75.00 leaves one credit of exactly 25.10 for the client') \g /dev/null
select test.mk_appt(4012, 'm', test.u(4001), 'scheduled', 19.99) \g /dev/null
select test.is(test.pay('m_staff', 'm', 4012, 'card', 'terminal 4', '20') ->> 'status', 'confirmed', 'a scheduled appointment is confirmed by its payment too (20.00 for a fee of 19.99)') \g /dev/null
select test.ok((select count(*) = 1 and min(amount) = 0.01 from public.credits where from_appt_id = test.u(4012)), 'one cent above the fee is a credit of one cent') \g /dev/null
select test.mk_appt(4013, 'm', test.u(4001), 'awaiting_payment', 0.30) \g /dev/null
select test.is(test.pay('m_staff', 'm', 4013, 'transfer', '', '0.3') ->> 'status', 'confirmed', 'thirty cents pay a fee of thirty cents') \g /dev/null
select test.ok(not exists (select 1 from public.credits where from_appt_id = test.u(4013)), 'exactly: no credit of a rounding error') \g /dev/null

-- refusals for what was sent
select test.mk_appt(4014, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', '74.99') ->> 'word', 'too_small', 'one cent less than the fee: too_small') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', '0') ->> 'word', 'invalid', 'nothing: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', '-75') ->> 'word', 'invalid', 'a negative amount: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', '75.001') ->> 'word', 'invalid', 'a fraction of a cent: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', 'null') ->> 'word', 'invalid', 'no amount: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'credit', '', '75') ->> 'word', 'invalid', 'the method "credit" belongs to credit_apply: invalid here') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'barter', '', '75') ->> 'word', 'invalid', 'a method that does not exist: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', repeat('x', 201), '75') ->> 'word', 'invalid', 'a reference longer than 200 characters: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4999, 'cash', '', '75') ->> 'word', 'not_found', 'an appointment that does not exist: not_found') \g /dev/null
select test.is(test.f('m_staff', format('public.appt_mark_paid(%L, %L, %L, %L, 75)', test.id('m'), test.id('n.ap1'), 'cash', '')) ->> 'word', 'not_found', 'an appointment of another company does not exist here') \g /dev/null
select test.mk_appt(4015, 'm', test.u(4001), 'cancelled_client', 75) \g /dev/null
select test.mk_appt(4016, 'm', test.u(4001), 'requested', 75) \g /dev/null
select test.mk_appt(4017, 'm', test.u(4001), 'scheduled', 0) \g /dev/null
select test.is(test.pay('m_staff', 'm', 4015, 'cash', '', '75') ->> 'word', 'conflict', 'a cancelled appointment takes no payment: conflict') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4016, 'cash', '', '75') ->> 'word', 'conflict', 'nor a request the office has not accepted yet') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4017, 'cash', '', '10') ->> 'word', 'invalid', 'an appointment without a fee has nothing to pay: invalid') \g /dev/null
select test.ok((select bool_and(paid_at is null) from public.appointments where id in (test.u(4014), test.u(4015), test.u(4016), test.u(4017)))
           and not exists (select 1 from public.credits where from_appt_id in (test.u(4014), test.u(4015), test.u(4016), test.u(4017))), 'and none of those attempts recorded anything') \g /dev/null

-- refusals for who asks
select test.is(test.pay('m_readonly', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'the read-only role cannot record a payment') \g /dev/null
select test.is(test.pay('m_w1', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'nor a field worker') \g /dev/null
select test.is(test.pay('m_disabled', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'nor a member who was disabled') \g /dev/null
select test.is(test.pay('b_owner', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.pay('nobody', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'nor a person with no company') \g /dev/null
select test.is(test.pay('anon', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'nor the anonymous visitor') \g /dev/null
select test.is(test.pay('service', 'm', 4014, 'cash', '', '75') ->> 'error', '42501', 'nor the server key: a payment is recorded by a person') \g /dev/null
select test.mk_appt(4018, 'n', test.id('n.c1'), 'awaiting_payment', 75) \g /dev/null
select test.is(test.pay('n_staff', 'n', 4018, 'cash', '', '75') ->> 'error', '42501', 'office staff of a field edition do not hold "money": they cannot record a payment') \g /dev/null
select test.ok(test.pay('n_manager', 'n', 4018, 'cash', '', '75') ->> 'status' = 'confirmed', 'their manager can') \g /dev/null
-- the office scope
select test.mk_appt(4019, 'm', test.u(4002), 'awaiting_payment', 75) \g /dev/null
select test.is(test.pay('m_staff', 'm', 4019, 'cash', '', '75') ->> 'error', '42501', 'staff cannot record a payment for a client of another office') \g /dev/null
select test.ok(test.pay('m_owner', 'm', 4019, 'cash', '', '75') ->> 'status' = 'confirmed', 'the owner, who sees every client, can') \g /dev/null
-- an appointment of someone who is not a client yet
select test.mk_appt(4020, 'm', null, 'awaiting_payment', 75, null, null, test.u(4004)) \g /dev/null
select test.is(test.pay('m_staff', 'm', 4020, 'cash', '', '80') ->> 'word', 'invalid', 'more than the fee from someone who is not a client yet: invalid, a credit needs a client record') \g /dev/null
select test.ok(test.pay('m_staff', 'm', 4020, 'cash', '', '75') ->> 'status' = 'confirmed', 'the exact fee from them is recorded') \g /dev/null

-- the same request twice (a second click, a retry after a lost answer)
select test.mk_appt(4021, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.pay('m_staff', 'm', 4021, 'cash', 'R-21', '80.00', 'pay-key-4021') as i1 \gset
select test.pay('m_staff', 'm', 4021, 'cash', 'R-21', '80.00', 'pay-key-4021') as i2 \gset
select test.ok(:'i1'::jsonb = :'i2'::jsonb and :'i1'::jsonb ->> 'status' = 'confirmed', 'appt_mark_paid with the same idempotency key answers the same Appointment again') \g /dev/null
select test.ok((select count(*) = 1 and min(amount) = 5.00 from public.credits where from_appt_id = test.u(4021))
           and (select count(*) = 1 from public.audit_log where action = 'appointment.paid' and row_id = test.u(4021)),
  'and records nothing twice: one payment, one credit of 5.00, one line in the audit log') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4021, 'cash', 'R-21', '90.00', 'pay-key-4021') ->> 'word', 'conflict', 'the same key with another amount is refused: conflict') \g /dev/null
select test.is(test.pay('m_manager', 'm', 4021, 'cash', 'R-21', '80.00', 'pay-key-4021') ->> 'word', 'conflict', 'a key belongs to the person who used it: someone else with the same key meets the paid appointment') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', '75', 'short') ->> 'word', 'invalid', 'a key that is too short: invalid') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4014, 'cash', '', '74.00', 'pay-key-4014') ->> 'word', 'too_small', 'a refused request with a key ...') \g /dev/null
select test.ok(test.pay('m_staff', 'm', 4014, 'cash', '', '74.00', 'pay-key-4014') ->> 'word' = 'too_small' and test.pay('m_staff', 'm', 4014, 'cash', '', '75.00', 'pay-key-4014b') ->> 'status' = 'confirmed',
  '... leaves the key free: the same request is judged again, and a corrected one with a new key goes through') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- What a person cannot do to an appointment directly, whatever their role
-- ---------------------------------------------------------------------------------------------------------------------
select test.mk_appt(4030, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.is(test.as('m_owner', format($q$update public.appointments set status = 'confirmed' where id = %L$q$, test.u(4030))), 'error:42501', 'an appointment that must be paid first cannot be confirmed by hand, even by the owner') \g /dev/null
select test.is(test.as('m_owner', format($q$update public.appointments set paid_at = now(), paid_method = 'cash', paid_amount = 75 where id = %L$q$, test.u(4030))), 'error:42501', 'nor can its payment be written directly') \g /dev/null
select test.is(test.as('m_owner', format($q$insert into public.appointments (tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status, fee, pay_by) values (%L, %L, %L, %L, current_date + 39, '15:00', 45, 'confirmed', 75, now() + interval '1 day')$q$,
  test.id('m'), test.id('m.at2'), test.u(4001), test.id('m.m_owner'))), 'error:42501', 'nor can a prepaid appointment be created already confirmed') \g /dev/null
select test.is(test.as('m_owner', format($q$update public.appointments set status = 'cancelled_staff' where id = %L$q$, test.u(4010))), 'error:42501', 'a paid appointment cannot be cancelled by changing its status: that would lose the client''s money') \g /dev/null
select test.is(test.as('m_owner', format($q$update public.appointments set fee = 10 where id = %L$q$, test.u(4010))), 'error:42501', 'the fee of a paid appointment cannot be changed') \g /dev/null
select test.is(test.as('m_owner', format($q$update public.appointments set client_id = %L where id = %L$q$, test.u(4003), test.u(4010))), 'error:42501', 'nor its client') \g /dev/null
select test.is(test.as('m_owner', format($q$delete from public.appointments where id = %L$q$, test.u(4010))), 'error:42501', 'a paid appointment cannot be removed') \g /dev/null
select test.is(test.as('m_owner', format($q$update public.appointments set notes = 'Moved to the front room', status = 'no_show' where id = %L$q$, test.u(4010))), 'rows:1', 'control: its notes and a no-show can be recorded') \g /dev/null
select test.is(test.as('m_owner', format($q$delete from public.appointments where id = %L$q$, test.u(4030))), 'rows:1', 'control: an unpaid appointment can be removed by someone who may delete') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- appt_cancel
-- ---------------------------------------------------------------------------------------------------------------------
select test.mk_appt(4040, 'm', test.u(4001), 'scheduled', 75) \g /dev/null
select test.cancel('m_staff', 'm', 4040, 'staff', '  The office is closed that day  ') as c1 \gset
select test.ok(:'c1'::jsonb -> 'appointment' ->> 'status' = 'cancelled_staff' and :'c1'::jsonb -> 'appointment' ->> 'cancelReason' = 'The office is closed that day' and not :'c1'::jsonb ? 'credit' and not :'c1'::jsonb ? 'kept',
  'appt_cancel: an unpaid appointment is cancelled with its reason, and there is nothing to give back') \g /dev/null
select test.is(test.cancel('m_staff', 'm', 4040, 'staff', 'Again') ->> 'word', 'conflict', 'an appointment is cancelled once') \g /dev/null

select test.mk_appt(4041, 'm', test.u(4001), 'confirmed', 75, 75) \g /dev/null
select test.cancel('m_staff', 'm', 4041, 'staff', 'The associate is out') as c2 \gset
select test.ok(:'c2'::jsonb -> 'appointment' ->> 'status' = 'cancelled_staff' and (:'c2'::jsonb -> 'credit' ->> 'amount')::numeric = 75 and :'c2'::jsonb -> 'credit' ->> 'reason' = 'cancel_staff'
           and :'c2'::jsonb -> 'credit' ->> 'fromApptId' = test.u(4041)::text and :'c2'::jsonb -> 'credit' ->> 'clientId' = test.u(4001)::text and :'c2'::jsonb -> 'credit' ->> 'by' = test.id('m.m_staff')::text,
  'the office cancels a paid appointment: the client keeps the fee as a credit, and the answer carries it') \g /dev/null
select test.ok((select count(*) = 1 and sum(amount) = 75.00 from public.credits where from_appt_id = test.u(4041))
           and (select paid_amount = 75.00 and status = 'cancelled_staff' from public.appointments where id = test.u(4041)), 'one credit of 75.00; the record of the payment stays on the appointment') \g /dev/null
-- the appointment that was overpaid (100.10 for 75.00): the part above the fee became a credit when it was paid
select test.cancel('m_staff', 'm', 4011, 'client', 'Cannot make it') as c3 \gset
select test.ok(:'c3'::jsonb -> 'appointment' ->> 'status' = 'cancelled_client' and (:'c3'::jsonb -> 'credit' ->> 'amount')::numeric = 75 and :'c3'::jsonb -> 'credit' ->> 'reason' = 'reschedule'
           and (select count(*) = 2 and sum(amount) = 100.10 from public.credits where from_appt_id = test.u(4011)),
  'the client cancels the appointment paid with 100.10: a credit of 75.00, and with the 25.10 of the day it was paid the client holds exactly 100.10') \g /dev/null

-- the company's rule for a client who cancels late
update public.tenants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{appointments}', '{"clientCancel":"forfeit"}') where id = test.id('m');
select test.mk_appt(4042, 'm', test.u(4001), 'confirmed', 75, 75, current_date - 1) \g /dev/null
select test.mk_appt(4043, 'm', test.u(4001), 'confirmed', 75, 75, current_date + 60) \g /dev/null
select test.mk_appt(4044, 'm', test.u(4001), 'confirmed', 75, 75, current_date - 2) \g /dev/null
select test.cancel('m_staff', 'm', 4042, 'client', 'Called after the hour') as c4 \gset
select test.ok(:'c4'::jsonb ->> 'kept' = 'forfeit' and not :'c4'::jsonb ? 'credit' and :'c4'::jsonb -> 'appointment' ->> 'status' = 'cancelled_client' and not exists (select 1 from public.credits where from_appt_id = test.u(4042)),
  'with "late cancellations are kept" switched on, a client who cancels inside the prepay window gets no credit, and the answer says so') \g /dev/null
select test.ok((test.cancel('m_staff', 'm', 4043, 'client', 'Two months ahead') -> 'credit' ->> 'amount')::numeric = 75, 'the same client cancelling well ahead of time keeps the fee as a credit') \g /dev/null
select test.ok((test.cancel('m_staff', 'm', 4044, 'staff', 'Our mistake') -> 'credit' ->> 'reason') = 'cancel_staff', 'and when the office cancels, the client always keeps it, late or not') \g /dev/null
update public.tenants set settings = settings - 'appointments' where id = test.id('m');
select test.mk_appt(4045, 'm', test.u(4001), 'confirmed', 75, 75, current_date - 3) \g /dev/null
select test.ok((test.cancel('m_staff', 'm', 4045, 'client', 'Late, default rule') -> 'credit' ->> 'amount')::numeric = 75, 'without that switch a late cancellation by the client is a credit (the default)') \g /dev/null
-- paid by someone who is not a client yet
select test.cancel('m_staff', 'm', 4020, 'staff', 'No longer needed') as c5 \gset
select test.ok(:'c5'::jsonb ->> 'kept' = 'no_client' and not :'c5'::jsonb ? 'credit', 'a paid appointment of someone who is not a client yet: no credit can be written, and the answer says "no_client" so the office settles it by hand') \g /dev/null

-- refusals
select test.mk_appt(4046, 'm', test.u(4001), 'confirmed', 75, 75) \g /dev/null
select test.is(test.cancel('m_staff', 'm', 4046, 'robot', 'x') ->> 'word', 'invalid', 'cancelled by someone who is neither the client nor the office: invalid') \g /dev/null
select test.is(test.cancel('m_staff', 'm', 4046, 'staff', '   ') ->> 'word', 'invalid', 'a cancellation needs a reason') \g /dev/null
select test.is(test.cancel('m_staff', 'm', 4999, 'staff', 'x') ->> 'word', 'not_found', 'an appointment that does not exist: not_found') \g /dev/null
select test.is(test.cancel('m_readonly', 'm', 4046, 'staff', 'x') ->> 'error', '42501', 'the read-only role cannot cancel') \g /dev/null
select test.is(test.cancel('b_owner', 'm', 4046, 'staff', 'x') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.cancel('m_staff', 'm', 4019, 'staff', 'x') ->> 'error', '42501', 'nor staff, for a client of another office') \g /dev/null
select test.ok((select status = 'confirmed' from public.appointments where id = test.u(4046)) and not exists (select 1 from public.credits where from_appt_id in (test.u(4046), test.u(4019))), 'and nothing was cancelled or credited by those attempts') \g /dev/null
-- office staff of a field edition cancel; the client's money is safe although they do not hold "credits"
select test.cancel('n_staff', 'n', 4018, 'staff', 'Crew is on another site') as c6 \gset
select test.ok((:'c6'::jsonb -> 'credit' ->> 'amount')::numeric = 75 and (select count(*) = 1 from public.credits where from_appt_id = test.u(4018)), 'office staff of a field edition cancel a paid appointment, and the credit is written all the same') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('n') and action = 'appointment.cancel' and row_id = test.u(4018) and actor = test.id('n_staff') and new_data ->> 'by' = 'staff'), 'the cancellation is in the audit log') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- credit_issue, credit_apply, credit_void
-- ---------------------------------------------------------------------------------------------------------------------
select test.f('m_staff', format('public.credit_issue(%L, %L, 12.34, %L)', test.id('m'), test.u(4001), 'goodwill')) as k1 \gset
select test.ok((:'k1'::jsonb ->> 'amount')::numeric = 12.34 and :'k1'::jsonb ->> 'reason' = 'goodwill' and :'k1'::jsonb ->> 'by' = test.id('m.m_staff')::text and not :'k1'::jsonb ? 'expires' and not :'k1'::jsonb ? 'used',
  'credit_issue: a credit written by hand, in the name of the person signed in; credits do not run out unless the company says so') \g /dev/null
update public.tenants set config = jsonb_set(coalesce(config, '{}'::jsonb), '{appointments}', '{"creditDays": 90}') where id = test.id('m');
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 5, %L)', test.id('m'), test.u(4001), 'overpayment')) ->> 'expires', (current_date + 90)::text, 'with "credits last 90 days" in the configuration, a new credit carries its last day') \g /dev/null
select test.mk_appt(4050, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.ok(test.pay('m_staff', 'm', 4050, 'cash', '', '76.50') ->> 'status' = 'confirmed', 'a payment of 76.50 for a fee of 75.00 while credits last 90 days') \g /dev/null
select test.ok((select count(*) = 1 and min(amount) = 1.50 and min(expires) = current_date + 90 from public.credits where from_appt_id = test.u(4050)), 'and so does the credit of an overpayment') \g /dev/null
update public.tenants set config = config - 'appointments' where id = test.id('m');
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 5, %L)', test.id('m'), test.u(4001), 'cancel_staff')) ->> 'word', 'invalid', 'the reason "the office cancelled" belongs to appt_cancel: invalid by hand') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 0, %L)', test.id('m'), test.u(4001), 'goodwill')) ->> 'word', 'invalid', 'a credit of nothing: invalid') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, -5, %L)', test.id('m'), test.u(4001), 'goodwill')) ->> 'word', 'invalid', 'a negative credit: invalid') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 1.005, %L)', test.id('m'), test.u(4001), 'goodwill')) ->> 'word', 'invalid', 'a fraction of a cent: invalid') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 5, %L)', test.id('m'), test.u(4002), 'goodwill')) ->> 'error', '42501', 'a credit for a client of another office: not allowed') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 5, %L)', test.id('m'), test.id('n.c1'), 'goodwill')) ->> 'error', '42501', 'a client of another company is not there') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_issue(%L, %L, 5, %L, %L)', test.id('m'), test.u(4003), 'goodwill', test.u(4010))) ->> 'word', 'invalid', 'a credit that names an appointment of another client: invalid') \g /dev/null
select test.is(test.f('m_readonly', format('public.credit_issue(%L, %L, 5, %L)', test.id('m'), test.u(4001), 'goodwill')) ->> 'error', '42501', 'the read-only role writes no credit') \g /dev/null
select test.is(test.f('n_staff', format('public.credit_issue(%L, %L, 5, %L)', test.id('n'), test.id('n.c1'), 'goodwill')) ->> 'error', '42501', 'nor office staff of a field edition, who do not hold "credits"') \g /dev/null

-- credit_apply: a credit pays an appointment, whole, once
select test.mk_credit(4060, 'm', test.u(4001), 100.10, current_date + 12) \g /dev/null
select test.mk_appt(4061, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.use_credit('m_staff', 'm', test.u(4060), 4061) as u1 \gset
select test.ok(:'u1'::jsonb -> 'credit' -> 'used' ->> 'apptId' = test.u(4061)::text and :'u1'::jsonb -> 'appointment' ->> 'status' = 'confirmed' and :'u1'::jsonb -> 'appointment' -> 'paid' ->> 'method' = 'credit'
           and :'u1'::jsonb -> 'appointment' -> 'paid' ->> 'ref' = test.u(4060)::text and (:'u1'::jsonb -> 'appointment' -> 'paid' ->> 'amount')::numeric = 75 and :'u1'::jsonb -> 'appointment' ->> 'creditId' = test.u(4060)::text
           and (:'u1'::jsonb -> 'remainder' ->> 'amount')::numeric = 25.10 and :'u1'::jsonb -> 'remainder' ->> 'expires' = (current_date + 12)::text and :'u1'::jsonb -> 'remainder' ->> 'reason' = 'overpayment',
  'credit_apply: a credit of 100.10 pays a fee of 75.00; the 25.10 left over comes back as a new credit with the same last day') \g /dev/null
select test.ok((select used_appt_id = test.u(4061) and used_at is not null and amount = 100.10 from public.credits where id = test.u(4060))
           and (select count(*) = 1 and sum(amount) = 25.10 from public.credits where from_appt_id = test.u(4061) and used_at is null and void_at is null)
           and (select paid_amount = 75.00 and credit_id = test.u(4060) from public.appointments where id = test.u(4061)),
  'the ledger: the credit is used on that appointment with its amount unchanged, and 75.00 + 25.10 = 100.10') \g /dev/null
select test.mk_appt(4062, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4060), 4062) ->> 'word', 'conflict', 'a credit is used once: a second appointment is refused') \g /dev/null
select test.is(test.use_credit('m_owner', 'm', test.u(4060), 4061) ->> 'word', 'conflict', 'and so is the same appointment again') \g /dev/null
select test.ok((select paid_at is null from public.appointments where id = test.u(4062)) and (select count(*) = 1 from public.credits where from_appt_id = test.u(4061)), 'neither attempt paid anything or wrote a second remainder') \g /dev/null
-- exact, and large amounts to the cent
select test.mk_credit(4063, 'm', test.u(4001), 75) \g /dev/null
select test.use_credit('m_staff', 'm', test.u(4063), 4062) as u2 \gset
select test.ok(not :'u2'::jsonb ? 'remainder' and :'u2'::jsonb -> 'appointment' ->> 'status' = 'confirmed' and not exists (select 1 from public.credits where from_appt_id = test.u(4062)), 'a credit of exactly the fee leaves no remainder') \g /dev/null
select test.mk_credit(4064, 'm', test.u(4001), 1000000.01) \g /dev/null
select test.mk_appt(4065, 'm', test.u(4001), 'scheduled', 999999.99) \g /dev/null
select test.ok((test.use_credit('m_staff', 'm', test.u(4064), 4065) -> 'remainder' ->> 'amount')::numeric = 0.02, 'a credit of 1,000,000.01 on a fee of 999,999.99 leaves exactly 0.02') \g /dev/null
-- refusals
select test.mk_credit(4066, 'm', test.u(4001), 40) \g /dev/null
select test.mk_credit(4067, 'm', test.u(4001), 80, current_date - 1) \g /dev/null
select test.mk_credit(4068, 'm', test.u(4001), 80, current_date) \g /dev/null
select test.mk_credit(4069, 'm', test.u(4003), 80) \g /dev/null
select test.mk_credit(4070, 'm', test.u(4002), 80) \g /dev/null
select test.mk_appt(4071, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4066), 4071) ->> 'word', 'too_small', 'a credit smaller than the fee cannot pay part of it: too_small') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4067), 4071) ->> 'word', 'expired', 'a credit whose last day was yesterday: expired') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4069), 4071) ->> 'word', 'invalid', 'a credit of another client: invalid') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.id('m.cr_void'), 4071) ->> 'word', 'conflict', 'a credit that was voided: conflict') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4068), 4010) ->> 'word', 'conflict', 'an appointment that is already paid: conflict') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4068), 4040) ->> 'word', 'conflict', 'an appointment that was cancelled: conflict') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4068), 4017) ->> 'word', 'invalid', 'an appointment without a fee: invalid') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4999), 4071) ->> 'word', 'not_found', 'a credit that does not exist: not_found') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4068), 4999) ->> 'word', 'not_found', 'an appointment that does not exist: not_found') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.id('n.cr_open'), 4071) ->> 'word', 'not_found', 'a credit of another company does not exist here') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4070), 4019) ->> 'error', '42501', 'a credit of a client of another office: not allowed') \g /dev/null
select test.is(test.use_credit('m_readonly', 'm', test.u(4068), 4071) ->> 'error', '42501', 'the read-only role spends no credit') \g /dev/null
select test.is(test.use_credit('b_owner', 'm', test.u(4068), 4071) ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.f('n_staff', format('public.credit_apply(%L, %L, %L)', test.id('n'), test.id('n.cr_open'), test.id('n.ap1'))) ->> 'error', '42501', 'nor office staff of a field edition') \g /dev/null
select test.ok((select paid_at is null from public.appointments where id = test.u(4071)) and (select bool_and(used_at is null) from public.credits where id in (test.u(4066), test.u(4067), test.u(4068), test.u(4069), test.u(4070))),
  'none of those attempts spent a credit or paid the appointment') \g /dev/null
select test.ok(test.use_credit('m_staff', 'm', test.u(4068), 4071) -> 'appointment' ->> 'status' = 'confirmed', 'a credit whose last day is today is still good') \g /dev/null

-- credit_void
select test.f('m_manager', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4066), '  Issued to the wrong client  ')) as v1 \gset
select test.ok(:'v1'::jsonb -> 'void' ->> 'reason' = 'Issued to the wrong client' and :'v1'::jsonb -> 'void' ->> 'by' = test.id('m.m_manager')::text and :'v1'::jsonb -> 'void' ? 'at' and (:'v1'::jsonb ->> 'amount')::numeric = 40,
  'credit_void: the credit is out of use, with who and why; the entry stays in the ledger with its amount') \g /dev/null
select test.is(test.f('m_manager', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4066), 'Again')) ->> 'word', 'conflict', 'a credit is voided once') \g /dev/null
select test.is(test.f('m_manager', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4060), 'Used already')) ->> 'word', 'conflict', 'a credit that was used cannot be voided') \g /dev/null
select test.is(test.f('m_manager', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4067), 'Too late')) ->> 'word', 'expired', 'a credit that ran out is already out of use: expired') \g /dev/null
select test.is(test.f('m_manager', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4069), ' ')) ->> 'word', 'invalid', 'voiding needs a reason') \g /dev/null
select test.is(test.f('m_manager', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4999), 'x')) ->> 'word', 'not_found', 'a credit that does not exist: not_found') \g /dev/null
select test.is(test.f('m_readonly', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4069), 'x')) ->> 'error', '42501', 'the read-only role voids nothing') \g /dev/null
select test.is(test.f('m_staff', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4070), 'x')) ->> 'error', '42501', 'nor staff, for a client of another office') \g /dev/null
select test.is(test.use_credit('m_staff', 'm', test.u(4066), 4017) ->> 'word', 'conflict', 'and a voided credit pays nothing') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'credit.void' and table_name = 'client' and row_id = test.u(4001) and actor = test.id('m_manager'))
           and exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'credit.apply' and row_id = test.u(4061) and actor = test.id('m_staff'))
           and exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'credit.issue' and row_id = test.u(4001) and actor = test.id('m_staff')),
  'issuing, using and voiding a credit are each in the audit log') \g /dev/null

-- the ledger rule holds for the server key too
select test.is(test.as('service', format('update public.credits set amount = 999 where id = %L', test.u(4069))), 'error:42501', 'the ledger: not even the server key changes the amount of a credit') \g /dev/null
select test.is(test.as('service', format('update public.credits set client_id = %L where id = %L', test.u(4003), test.u(4068))), 'error:42501', 'or moves it to another client') \g /dev/null
select test.is(test.as('service', format('update public.credits set used_at = null, used_appt_id = null where id = %L', test.u(4060))), 'error:42501', 'or makes a used credit usable again') \g /dev/null
select test.is(test.as('service', format('update public.credits set void_at = null, void_reason = null, void_by = null where id = %L', test.u(4066))), 'error:42501', 'or takes back a void') \g /dev/null
select test.is(test.as('service', format('delete from public.credits where id = %L', test.u(4069))), 'error:42501', 'or removes an entry') \g /dev/null
select test.is(test.as('m_owner', format('update public.credits set void_at = now(), void_reason = %L where id = %L', 'by hand', test.u(4069))), 'error:42501', 'and a person, the owner included, writes to the ledger only through the functions') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- The scheduled jobs of the server
-- ---------------------------------------------------------------------------------------------------------------------
select test.mk_appt(4080, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.mk_appt(4081, 'm', test.u(4001), 'awaiting_payment', 75) \g /dev/null
select test.mk_appt(4082, 'n', test.id('n.c1'), 'awaiting_payment', 75) \g /dev/null
update public.appointments set pay_by = now() - interval '1 minute' where id in (test.u(4080), test.u(4082));
select test.is(test.as('m_owner', 'select public.appt_release_unpaid()'), 'error:42501', 'appt_release_unpaid is the server''s: a person cannot call it, the owner included') \g /dev/null
select test.is(test.as('anon', 'select public.appt_release_unpaid()'), 'error:42501', 'nor the anonymous visitor') \g /dev/null
select test.login('service') \g /dev/null
select public.appt_release_unpaid() as rel \gset
select public.appt_release_unpaid() as rel2 \gset
select test.logout() \g /dev/null
select test.ok((select count(*) = 2 from jsonb_array_elements(:'rel'::jsonb) e where e ->> 'id' in (test.u(4080)::text, test.u(4082)::text))
           and not exists (select 1 from jsonb_array_elements(:'rel'::jsonb) e where e ->> 'id' = test.u(4081)::text)
           and (select e ->> 'tenantId' = test.id('m')::text and e ->> 'clientId' = test.u(4001)::text and e ->> 'time' = '09:00' from jsonb_array_elements(:'rel'::jsonb) e where e ->> 'id' = test.u(4080)::text),
  'appt_release_unpaid releases the appointments whose pay-by moment passed, in every company, and says which') \g /dev/null
select test.ok((select bool_and(status = 'cancelled_unpaid') from public.appointments where id in (test.u(4080), test.u(4082))) and (select status = 'awaiting_payment' from public.appointments where id = test.u(4081)),
  'they are "cancelled_unpaid"; one that still has time is untouched') \g /dev/null
select test.is(:'rel2', '[]', 'run again, it releases nothing: an appointment is released once') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'appointment.unpaid' and row_id = test.u(4080)), 'the release is in the audit log of the company') \g /dev/null
select test.is(test.pay('m_staff', 'm', 4080, 'cash', '', '75') ->> 'word', 'conflict', 'a released appointment takes no payment: it is booked again instead') \g /dev/null

select test.mk_credit(4085, 'm', test.u(4001), 10, current_date + 3) \g /dev/null
select test.mk_credit(4086, 'm', test.u(4001), 10, current_date + 10) \g /dev/null
select test.mk_credit(4087, 'm', test.u(4001), 10, current_date + 2) \g /dev/null
select test.mk_credit(4088, 'm', test.u(4001), 10) \g /dev/null
select test.f('m_owner', format('public.credit_void(%L, %L, %L)', test.id('m'), test.u(4087), 'Out of use')) \g /dev/null
select test.login('service') \g /dev/null
select public.credits_expiring(7) as exp7 \gset
select test.logout() \g /dev/null
select test.ok(exists (select 1 from jsonb_array_elements(:'exp7'::jsonb) e where e ->> 'id' = test.u(4085)::text and (e ->> 'amount')::numeric = 10 and e ->> 'expires' = (current_date + 3)::text and e ->> 'tenantId' = test.id('m')::text)
           and not exists (select 1 from jsonb_array_elements(:'exp7'::jsonb) e where e ->> 'id' in (test.u(4086)::text, test.u(4087)::text, test.u(4088)::text, test.u(4067)::text, test.u(4060)::text)),
  'credits_expiring lists the usable credits that run out within the days asked: not a later one, a voided one, one without an end, one that ran out, or a used one') \g /dev/null
select test.is(test.as('m_owner', 'select public.credits_expiring(7)'), 'error:42501', 'and it is the server''s: a person cannot call it') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- Double booking
-- ---------------------------------------------------------------------------------------------------------------------
select test.begin_section('35. double booking') \g /dev/null
-- One slot of a team member: 10:00 to 10:30, and the type keeps 10 more minutes free after it.
create or replace function test.slot(who text, n integer, at time, status text default 'scheduled', staff text default 'm.m_manager', on_date date default current_date + 400, mins integer default 30) returns text language sql as $$
  select test.as(who, format($q$insert into public.appointments (id, tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status) values (%L, %L, %L, %L, %L, %L, %L, %s, %L)$q$,
    test.u(n), test.id('m'), test.id('m.at1'), test.u(4001), test.id(staff), on_date, at, mins, status))
$$;
select test.is(test.slot('m_staff', 4101, '10:00'), 'rows:1', 'a first appointment at 10:00 for 30 minutes') \g /dev/null
select test.is(test.slot('m_staff', 4102, '10:00'), 'error:23P01', 'a second one for the same person at the same time is refused') \g /dev/null
select test.is(test.slot('m_staff', 4102, '10:15'), 'error:23P01', 'one that starts while the first is running is refused') \g /dev/null
select test.is(test.slot('m_staff', 4102, '10:39'), 'error:23P01', 'one that starts inside the 10 minutes kept free after it is refused') \g /dev/null
select test.is(test.slot('m_staff', 4102, '09:45'), 'error:23P01', 'one that would still be running at 10:00 is refused') \g /dev/null
select test.is(test.slot('m_staff', 4102, '09:25'), 'error:23P01', 'one whose own free minutes would run into 10:00 is refused') \g /dev/null
select test.is(test.slot('m_owner', 4102, '10:15'), 'error:23P01', 'the rule is the same for the owner') \g /dev/null
select test.is(test.slot('service', 4102, '10:15'), 'error:23P01', 'and for the server key') \g /dev/null
select test.is(test.slot('m_staff', 4102, '10:40'), 'rows:1', 'one that starts when the free minutes have passed is accepted') \g /dev/null
select test.is(test.slot('m_staff', 4103, '09:20'), 'rows:1', 'and so is one that ends, free minutes included, at 10:00 sharp') \g /dev/null
select test.is(test.slot('m_staff', 4104, '10:00', 'scheduled', 'm.m_owner'), 'rows:1', 'another team member is free at 10:00') \g /dev/null
select test.is(test.slot('m_staff', 4105, '10:00', 'scheduled', 'm.m_manager', current_date + 401), 'rows:1', 'and the same person on another day') \g /dev/null
select test.is(test.slot('m_staff', 4106, '10:00', 'requested'), 'rows:1', 'a request holds no time: it can sit on top of an appointment') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set status = 'scheduled' where id = %L$q$, test.u(4106))), 'error:23P01', 'until the office accepts it: then the time must be free') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set start_time = '10:20' where id = %L$q$, test.u(4102))), 'error:23P01', 'an appointment cannot be moved onto another one') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set staff_id = %L where id = %L$q$, test.id('m.m_manager'), test.u(4104))), 'error:23P01', 'nor handed to a person who is busy then') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set minutes = 41 where id = %L$q$, test.u(4103))), 'error:23P01', 'nor made longer into the next one') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set notes = 'Room 2', minutes = 30 where id = %L$q$, test.u(4101))), 'rows:1', 'control: an appointment keeps its own slot when something else about it changes') \g /dev/null
-- through the gateway the refusal names the rule
select test.apply('m_staff', 'm', jsonb_build_array(test.op('appointments', test.u(4107), jsonb_build_object('typeId', test.id('m.at1'), 'clientId', test.u(4001), 'staffId', test.id('m.m_manager'),
  'date', (current_date + 400)::text, 'time', '10:05', 'minutes', 30, 'mode', 'office', 'status', 'scheduled', 'fee', 0)))) as db1 \gset
select test.is(test.reason(:'db1'::jsonb, test.u(4107)::text) || ':' || test.detail(:'db1'::jsonb, test.u(4107)::text), 'invalid:appointments_no_double_booking', 'through ws_apply a double booking is refused as "invalid", with the name of the rule') \g /dev/null
-- a cancelled appointment gives its time back
select test.cancel('m_staff', 'm', 4101, 'client', 'Feeling unwell') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set status = 'scheduled' where id = %L$q$, test.u(4106))), 'rows:1', 'once the first appointment is cancelled, the request for 10:00 can be accepted') \g /dev/null
-- the rule is the company's choice
update public.tenants set config = jsonb_set(coalesce(config, '{}'::jsonb), '{appointments}', '{"noDoubleBooking": false}') where id = test.id('m');
select test.is(test.slot('m_staff', 4108, '10:15'), 'rows:1', 'a company that switched the rule off can book two at once') \g /dev/null
update public.tenants set config = config - 'appointments' where id = test.id('m');
select test.is(test.slot('m_staff', 4109, '10:15'), 'error:23P01', 'and with the rule back on, the next one is refused again') \g /dev/null
select test.is(test.as('m_staff', format($q$update public.appointments set notes = 'Kept' where id = %L$q$, test.u(4108))), 'rows:1', 'what was booked while it was off can still be edited in place') \g /dev/null
select test.is(test.as('m_staff', format($q$insert into public.appointments (tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status) values (%L, %L, %L, %L, current_date + 402, '23:45', 30, 'requested')$q$,
  test.id('m'), test.id('m.at1'), test.u(4001), test.id('m.m_manager'))), 'error:23514', 'an appointment ends on the day it starts: 23:45 for 30 minutes is refused') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section in ('34. appointments and credits', '35. double booking') group by section order by section;
