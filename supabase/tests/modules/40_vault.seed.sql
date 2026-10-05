-- Sample rows for the tables of 0034 (reveal requests, the access log). The number itself is the fictional one the
-- core sample data stored for the first client of every company; nothing here holds a digit of it.
create function test.seed_vault(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); r1 uuid; r2 uuid;
begin
  insert into public.reveal_requests (tenant_id, client_id, requested_by, reason, at, status, approver_id, decided_at, expires_at, used_at)
    values (t, test.id(p || '.c1'), test.id(p || '.m_manager'), 'Preparing the yearly return', now() - interval '3 days', 'used', test.id(p || '.m_owner'),
            now() - interval '3 days' + interval '5 minutes', now() - interval '3 days' + interval '20 minutes', now() - interval '3 days' + interval '6 minutes') returning id into r1;
  insert into public.reveal_requests (tenant_id, client_id, requested_by, reason)
    values (t, test.id(p || '.c1'), test.id(p || '.m_manager'), 'A letter from the agency asks for it') returning id into r2;
  perform test.remember(p || '.rv_used', r1);
  perform test.remember(p || '.rv_open', r2);
  insert into public.secure_access_log (tenant_id, at, client_id, actor_kind, member_id, action, reason, request_id) values
    (t, now() - interval '30 days', test.id(p || '.c1'), 'member', test.id(p || '.m_owner'), 'set', null, null),
    (t, now() - interval '3 days', test.id(p || '.c1'), 'member', test.id(p || '.m_manager'), 'request', 'Preparing the yearly return', r1),
    (t, now() - interval '3 days' + interval '5 minutes', test.id(p || '.c1'), 'member', test.id(p || '.m_owner'), 'approve', null, r1),
    (t, now() - interval '3 days' + interval '6 minutes', test.id(p || '.c1'), 'member', test.id(p || '.m_manager'), 'reveal', 'Preparing the yearly return', r1),
    (t, now() - interval '10 days', test.id(p || '.c1'), 'system', null, 'expire', null, null),
    (t, now(), test.id(p || '.c1'), 'member', test.id(p || '.m_manager'), 'request', 'A letter from the agency asks for it', r2);
end $$;
select test.seed_vault('a') \g /dev/null
select test.seed_vault('b') \g /dev/null
select test.seed_vault('c') \g /dev/null
