-- Sample rows for the tables of 0032 (appointment types, appointments, credits).
-- One appointment that is simply booked, one the office cancelled after it was paid, and one paid with the credit
-- that cancellation left behind; plus a credit that was voided and one that is still open.
create function test.seed_appointments(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); at1 uuid; at2 uuid; a1 uuid; a2 uuid; a3 uuid; c1 uuid; x uuid;
begin
  insert into public.appointment_types (tenant_id, name, minutes, fee, prepay, mode, buffer)
    values (t, '{"en":"First consultation","es":"Primera consulta"}', 30, 0, false, 'office', 10) returning id into at1;
  insert into public.appointment_types (tenant_id, name, minutes, fee, prepay, mode, buffer, service_id)
    values (t, '{"en":"Planning session","es":"Sesión de planeación"}', 45, 75, true, 'video', 15, test.id(p || '.s1')) returning id into at2;
  perform test.remember(p || '.at1', at1);
  perform test.remember(p || '.at2', at2);
  update public.catalog_services set appointment_type_id = at1 where id = test.id(p || '.s1');

  insert into public.appointments (tenant_id, type_id, client_id, lead_id, job_id, staff_id, office_id, date, start_time, minutes, mode, location, status, fee, created_by, notes)
    values (t, at1, test.id(p || '.c1'), test.id(p || '.l1'), test.id(p || '.j1'), test.id(p || '.m_staff'), test.id(p || '.o1'), current_date + 7, '10:00', 30, 'office',
            '1 Sample Street', 'scheduled', 0, test.id(p || '.m_staff'), 'Bring last year''s papers') returning id into a1;
  insert into public.appointments (tenant_id, type_id, client_id, staff_id, date, start_time, minutes, mode, status, fee, paid_at, paid_method, paid_ref, paid_amount, pay_by, created_by, cancel_reason)
    values (t, at2, test.id(p || '.c1'), test.id(p || '.m_manager'), current_date - 5, '14:00', 45, 'video', 'cancelled_staff', 75, now() - interval '8 days', 'cash', '', 75,
            now() - interval '6 days', test.id(p || '.m_manager'), 'The associate was out') returning id into a2;
  insert into public.appointments (tenant_id, type_id, client_id, staff_id, date, start_time, minutes, mode, status, fee, created_by, rescheduled_from, external_ids)
    values (t, at2, test.id(p || '.c1'), test.id(p || '.m_manager'), current_date + 9, '11:00', 45, 'video', 'confirmed', 75, test.id(p || '.m_manager'), a2, '{"gcal":"sample"}') returning id into a3;
  perform test.remember(p || '.ap1', a1);
  perform test.remember(p || '.ap2', a2);
  perform test.remember(p || '.ap3', a3);

  insert into public.credits (tenant_id, client_id, amount, reason, from_appt_id, by_member_id, used_appt_id, used_at)
    values (t, test.id(p || '.c1'), 75, 'cancel_staff', a2, test.id(p || '.m_manager'), a3, now() - interval '4 days') returning id into c1;
  perform test.remember(p || '.cr_used', c1);
  update public.appointments set paid_at = now() - interval '4 days', paid_method = 'credit', paid_ref = c1::text, paid_amount = 75, credit_id = c1 where id = a3;
  insert into public.credits (tenant_id, client_id, amount, reason, by_member_id, expires, void_at, void_by, void_reason)
    values (t, test.id(p || '.c1'), 20.50, 'goodwill', test.id(p || '.m_owner'), current_date + 30, now(), test.id(p || '.m_owner'), 'Entered twice') returning id into x;
  perform test.remember(p || '.cr_void', x);
  insert into public.credits (tenant_id, client_id, amount, reason, by_member_id) values (t, test.id(p || '.c1'), 40, 'goodwill', test.id(p || '.m_owner')) returning id into x;
  perform test.remember(p || '.cr_open', x);
end $$;
select test.seed_appointments('a') \g /dev/null
select test.seed_appointments('b') \g /dev/null
select test.seed_appointments('c') \g /dev/null
