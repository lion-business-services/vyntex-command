-- Sample rows for the table of 0048 (the consent switch per company, channel and number).
create function test.seed_messaging(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); x uuid;
begin
  insert into public.messaging_consents (tenant_id, channel, address, status, source, client_id, granted_at)
    values (t, 'text', '+15555550101', 'opted_in', 'form', test.id(p || '.c1'), now() - interval '10 days') returning id into x;
  perform test.remember(p || '.consent_in', x);
  insert into public.messaging_consents (tenant_id, channel, address, status, source, granted_at, revoked_at)
    values (t, 'whatsapp', '+15555550102', 'opted_out', 'keyword', now() - interval '20 days', now() - interval '1 day') returning id into x;
  perform test.remember(p || '.consent_out', x);
end $$;
select test.seed_messaging('a') \g /dev/null
select test.seed_messaging('b') \g /dev/null
select test.seed_messaging('c') \g /dev/null
