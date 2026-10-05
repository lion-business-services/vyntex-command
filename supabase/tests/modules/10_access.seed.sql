-- Sample rows for the tables of 0030 (offices, access requests, access grants), for the three sample companies.
-- Included by rls_isolation.sql right after the core sample data. Nothing here touches a core table: the client of
-- every company stays without an office, so the checks of the earlier files count what they always counted.
create function test.seed_access(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); o1 uuid; o2 uuid; r1 uuid;
begin
  insert into public.offices (tenant_id, name, address, phone, timezone, main)
    values (t, 'Main office ' || p, '1 Sample Street', '555-0120', 'America/New_York', true) returning id into o1;
  insert into public.offices (tenant_id, name, address) values (t, 'Second office ' || p, '2 Sample Street') returning id into o2;
  perform test.remember(p || '.o1', o1);
  perform test.remember(p || '.o2', o2);
  -- one request that was approved (with its grant) and one still waiting
  insert into public.access_requests (tenant_id, member_id, client_id, reason, status, decided_by, decided_at)
    values (t, test.id(p || '.m_staff'), test.id(p || '.c1'), 'Covering for a colleague', 'approved', test.id(p || '.m_owner'), now()) returning id into r1;
  perform test.remember(p || '.ar_done', r1);
  insert into public.access_grants (tenant_id, member_id, client_id, granted_by, expires, reason, request_id)
    values (t, test.id(p || '.m_staff'), test.id(p || '.c1'), test.id(p || '.m_owner'), current_date + 30, 'Covering for a colleague', r1)
    returning id into r1;
  perform test.remember(p || '.grant', r1);
  insert into public.access_requests (tenant_id, member_id, client_id, reason)
    values (t, test.id(p || '.m_readonly'), test.id(p || '.c1'), 'Front desk needs the phone number') returning id into r1;
  perform test.remember(p || '.ar_open', r1);
end $$;
select test.seed_access('a') \g /dev/null
select test.seed_access('b') \g /dev/null
select test.seed_access('c') \g /dev/null
