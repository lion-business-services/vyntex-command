-- Module tests, part 4: the secure tax ID vault (0034).
-- Company M (practice): the owner and the senior associate ask, approve and view; staff see that a number is on file
-- and never the number. The numbers used are obviously made up (123-45-6789 and friends): no real person's number
-- is ever in a test. At the end, every text stored anywhere in the database is searched for them.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('36. tax ID vault') \g /dev/null

create or replace function test.vset(who text, client uuid, kind text, val text, p text default 'm') returns jsonb language sql as $$
  select test.f(who, format('public.vault_set(%L, %L, %L, %L)', test.id(p), client, kind, val))
$$;
create or replace function test.vreq(who text, client uuid, reason text, p text default 'm') returns jsonb language sql as $$
  select test.f(who, format('public.vault_request(%L, %L, %L)', test.id(p), client, reason))
$$;
create or replace function test.vdec(who text, request uuid, approve boolean, p text default 'm') returns jsonb language sql as $$
  select test.f(who, format('public.vault_decide(%L, %L, %L)', test.id(p), request, approve))
$$;
create or replace function test.vrev(who text, request uuid, p text default 'm') returns jsonb language sql as $$
  select test.f(who, format('public.vault_reveal(%L, %L)', test.id(p), request))
$$;
create or replace function test.vstatus(request uuid) returns text language sql as $$ select status from public.reveal_requests where id = request $$;

insert into public.clients (id, tenant_id, name, phone, email) values
  (test.u(5001), test.id('m'), 'Vault Client One', '609-555-0501', 'vault-one@example.com'),
  (test.u(5003), test.id('m'), 'Vault Client Three', '609-555-0503', 'vault-three@example.com'),
  (test.u(5004), test.id('m'), 'Vault Client Without A Number', '609-555-0504', 'vault-four@example.com'),
  (test.u(5005), test.id('m'), 'Vault Client Five', '609-555-0505', 'vault-five@example.com');
insert into public.clients (id, tenant_id, name, phone, email, office_id) values (test.u(5002), test.id('m'), 'Vault Client Of The Second Office', '609-555-0502', 'vault-two@example.com', test.id('m.o2'));

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_set
-- ---------------------------------------------------------------------------------------------------------------------
select test.vset('m_manager', test.u(5001), 'ssn', '123-45-6789') as s1 \gset
select test.is(:'s1'::jsonb::text, '{"taxIdType": "ssn", "taxIdLast4": "6789"}', 'vault_set answers with the type and the last four digits, never the number') \g /dev/null
select test.ok((select tax_id_type = 'ssn' and tax_id_last4 = '6789' from public.clients where id = test.u(5001)), 'the client row shows the type and the last four digits') \g /dev/null
select test.ok((select position('123456789'::bytea in tax_id_enc) = 0 and position('6789'::bytea in tax_id_enc) = 0 and octet_length(tax_id_enc) > 40 and set_by = test.id('m_manager') and last4 = '6789'
                from public.client_secrets where client_id = test.u(5001)), 'the number is stored encrypted: its digits are not in the stored bytes') \g /dev/null
select test.ok((select count(*) = 1 from public.secure_access_log where client_id = test.u(5001) and action = 'set' and member_id = test.id('m.m_manager'))
           and exists (select 1 from app.security_events where tenant_id = test.id('m') and kind = 'vault.set' and user_id = test.id('m_manager') and meta = '{"kind": "ssn"}')
           and exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'vault.set' and table_name = 'client' and row_id = test.u(5001) and actor = test.id('m_manager')),
  'storing it is in the access log, the security events and the audit log: who, which client, which type') \g /dev/null
do $$
declare v text; r jsonb;
begin
  -- [type, value]
  for v in select unnest(array['ssn|123-45-678', 'ssn|123-45-67890', 'ssn|000-45-6789', 'ssn|666-45-6789', 'ssn|912-45-6789', 'ssn|123-00-6789', 'ssn|123-45-0000',
                               'ssn|abc-de-fghi', 'ssn|123456789x', 'ssn|123.45.6789', 'itin|912-45-6789', 'itin|123-70-1234', 'ein|07-1234567', 'ein|00-1234567', 'ein|12-345678',
                               'passport|123-45-6789', 'SSN|123-45-6789']) loop
    r := test.vset('m_manager', test.u(5004), split_part(v, '|', 1), split_part(v, '|', 2));
    perform test.is(r::text, '{"word": "invalid", "error": "22023"}', format('vault_set refuses what cannot be a number of that type (case %s of the list): "invalid", and nothing typed is repeated back', md5(v)));
  end loop;
  r := test.f('m_manager', format('public.vault_set(%L, %L, null, %L)', test.id('m'), test.u(5004), '123-45-6789'));
  perform test.is(r ->> 'word', 'invalid', 'vault_set without a type: invalid');
  perform test.ok(not exists (select 1 from public.client_secrets where client_id = test.u(5004)) and (select tax_id_type is null from public.clients where id = test.u(5004)), 'and none of those attempts stored anything');
end $$;
select test.is(test.vset('m_manager', test.u(5003), 'ein', '12-3456789') ->> 'taxIdLast4', '6789', 'an employer number of an assigned prefix is accepted') \g /dev/null
select test.is(test.vset('m_manager', test.u(5005), 'itin', '912 70 1234') ->> 'taxIdLast4', '1234', 'and an individual taxpayer number, typed with spaces') \g /dev/null
select test.is(test.vset('m_owner', test.u(5005), 'ein', '12-3456789')::text, '{"taxIdType": "ein", "taxIdLast4": "6789"}', 'storing a number again replaces the one on file') \g /dev/null
select test.ok((select tax_id_type = 'ein' and tax_id_last4 = '6789' from public.clients where id = test.u(5005)) and (select count(*) = 1 from public.client_secrets where client_id = test.u(5005))
           and (select count(*) = 2 from public.secure_access_log where client_id = test.u(5005) and action = 'set'), 'one number per client, and both entries are in the access log') \g /dev/null
-- who
select test.is(test.vset('m_staff', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'staff, who see that a number is on file but never the number, cannot store one') \g /dev/null
select test.is(test.vset('m_readonly', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'nor the read-only role') \g /dev/null
select test.is(test.vset('m_w1', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'nor a field worker') \g /dev/null
select test.is(test.vset('m_disabled', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'nor a member who was disabled') \g /dev/null
select test.is(test.vset('b_owner', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.vset('anon', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'nor the anonymous visitor') \g /dev/null
select test.is(test.vset('service', test.u(5004), 'ssn', '123-45-6789') ->> 'error', '42501', 'nor the server key') \g /dev/null
select test.is(test.vset('n_staff', test.id('n.c1'), 'ssn', '123-45-6789', 'n') ->> 'error', '42501', 'nor office staff of a field edition') \g /dev/null
select test.is(test.vset('m_manager', test.u(5002), 'ssn', '123-45-6789') ->> 'word', 'not_found', 'a client of another office does not exist for the senior associate') \g /dev/null
select test.is(test.vset('m_owner', test.id('n.c1'), 'ssn', '123-45-6789') ->> 'word', 'not_found', 'a client of another company does not exist here') \g /dev/null
select test.is(test.vset('m_owner', test.u(5002), 'ssn', '123-45-6789') ->> 'taxIdLast4', '6789', 'the owner, who sees every client, stores one for the client of the second office') \g /dev/null
select test.ok(not exists (select 1 from public.client_secrets where client_id = test.u(5004)), 'none of the refused people stored anything') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_request
-- ---------------------------------------------------------------------------------------------------------------------
select test.vreq('m_manager', test.u(5001), '   Preparing the yearly return   ') as q1 \gset
select (:'q1'::jsonb ->> 'id')::uuid as r1 \gset
select test.ok(:'q1'::jsonb ->> 'status' = 'pending' and :'q1'::jsonb ->> 'requestedBy' = test.id('m.m_manager')::text and :'q1'::jsonb ->> 'reason' = 'Preparing the yearly return'
           and :'q1'::jsonb ->> 'clientId' = test.u(5001)::text and :'q1'::jsonb ->> 'field' = 'tax_id' and not :'q1'::jsonb ? 'expiresAt' and not :'q1'::jsonb ? 'approverId',
  'vault_request answers with the RevealRequest: pending, in the name of the person signed in, with the reason') \g /dev/null
select test.ok(exists (select 1 from public.secure_access_log where request_id = :'r1' and action = 'request' and member_id = test.id('m.m_manager') and reason = 'Preparing the yearly return'),
  'the request is in the access log with its reason') \g /dev/null
select test.is(test.vreq('m_manager', test.u(5001), 'A second time') ->> 'word', 'conflict', 'one open request per person and client: a second is refused') \g /dev/null
select test.is(test.vreq('m_manager', test.u(5003), 'abc') ->> 'word', 'invalid', 'a reason of fewer than five characters: invalid') \g /dev/null
select test.is(test.f('m_manager', format('public.vault_request(%L, %L, null)', test.id('m'), test.u(5003))) ->> 'word', 'invalid', 'no reason: invalid') \g /dev/null
select test.is(test.vreq('m_manager', test.u(5004), 'There is nothing on file') ->> 'word', 'not_found', 'a client without a number on file: not_found') \g /dev/null
select test.is(test.vreq('m_manager', test.u(5002), 'Not my client') ->> 'word', 'not_found', 'a client of another office: not_found') \g /dev/null
select test.is(test.vreq('m_owner', test.id('n.c1'), 'Not our client') ->> 'word', 'not_found', 'a client of another company: not_found') \g /dev/null
select test.is(test.vreq('m_staff', test.u(5001), 'Staff would like to see it') ->> 'error', '42501', 'staff cannot ask: they do not hold "secureReveal"') \g /dev/null
select test.is(test.vreq('m_readonly', test.u(5001), 'Read only would like to see it') ->> 'error', '42501', 'nor the read-only role') \g /dev/null
select test.is(test.vreq('b_owner', test.u(5001), 'Another company would like to see it') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.vreq('anon', test.u(5001), 'Nobody would like to see it') ->> 'error', '42501', 'nor the anonymous visitor') \g /dev/null
select test.ok((select count(*) = 1 from public.reveal_requests where client_id = test.u(5001)), 'one request exists for that client') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_decide, two-person rule (the default)
-- ---------------------------------------------------------------------------------------------------------------------
select test.stepup('m_manager') \g /dev/null
select test.is(test.vdec('m_manager', :'r1', true) ->> 'word', 'needs_other_person', 'the person who asked cannot approve their own request, even right after confirming who they are') \g /dev/null
select test.is(test.vdec('m_staff', :'r1', true) ->> 'error', '42501', 'staff cannot approve: they do not hold "secureApprove"') \g /dev/null
select test.is(test.vdec('m_staff', :'r1', false) ->> 'error', '42501', 'nor deny') \g /dev/null
select test.is(test.vdec('m_readonly', :'r1', true) ->> 'error', '42501', 'nor the read-only role') \g /dev/null
select test.is(test.vdec('b_owner', :'r1', true) ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.vdec('n_owner', :'r1', true, 'n') ->> 'word', 'not_found', 'in another company the request does not exist') \g /dev/null
select test.is(test.vdec('m_owner', :'r1', true)::text, '{"word": "stepup_required", "error": "VX403"}', 'the owner cannot approve without confirming who they are first') \g /dev/null
select test.stepup('m_owner') \g /dev/null
select test.stepup_stale('m_owner') \g /dev/null
select test.is(test.vdec('m_owner', :'r1', true) ->> 'error', 'VX403', 'nor with a check that is 20 minutes old') \g /dev/null
select test.is(test.f('m_owner', format('public.vault_decide(%L, %L, null)', test.id('m'), :'r1')) ->> 'word', 'invalid', 'a decision that is neither yes nor no: invalid') \g /dev/null
select test.is(test.vdec('m_owner', gen_random_uuid(), true) ->> 'word', 'not_found', 'a request that does not exist: not_found') \g /dev/null
select test.is(test.vstatus(:'r1'), 'pending', 'after all of those the request is still waiting') \g /dev/null
select test.is(test.vrev('m_manager', :'r1') ->> 'word', 'expired', 'and a request nobody approved shows nothing') \g /dev/null
select test.stepup('m_owner') \g /dev/null
select test.vdec('m_owner', :'r1', true) as d1 \gset
select test.ok(:'d1'::jsonb ->> 'status' = 'approved' and :'d1'::jsonb ->> 'approverId' = test.id('m.m_owner')::text and :'d1'::jsonb ? 'decidedAt'
           and (:'d1'::jsonb ->> 'expiresAt')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes',
  'a second person, freshly confirmed, approves: the approval is good for 15 minutes') \g /dev/null
select test.is(test.vdec('m_owner', :'r1', false) ->> 'word', 'expired', 'a request is decided once') \g /dev/null
select test.ok(exists (select 1 from public.secure_access_log where request_id = :'r1' and action = 'approve' and member_id = test.id('m.m_owner'))
           and exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'vault.approve' and row_id = test.u(5001) and actor = test.id('m_owner')), 'the approval is in the access log and the audit log') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_reveal
-- ---------------------------------------------------------------------------------------------------------------------
select test.is(test.vrev('m_owner', :'r1') ->> 'error', '42501', 'the person who approved cannot view with someone else''s request') \g /dev/null
select test.is(test.vrev('m_staff', :'r1') ->> 'error', '42501', 'nor staff') \g /dev/null
select test.is(test.vrev('b_owner', :'r1') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.stepup('n_manager') \g /dev/null
select test.is(test.vrev('n_manager', :'r1', 'n') ->> 'word', 'not_found', 'in another company the request does not exist') \g /dev/null
select test.is(test.vrev('anon', :'r1') ->> 'error', '42501', 'nor the anonymous visitor') \g /dev/null
select test.is(test.vrev('service', :'r1') ->> 'error', '42501', 'nor the server key: no server code path can read a client''s number') \g /dev/null
select test.stepup_stale('m_manager') \g /dev/null
select test.is(test.vrev('m_manager', :'r1')::text, '{"word": "stepup_required", "error": "VX403"}', 'the person who asked cannot view without a fresh identity check') \g /dev/null
select test.is(test.vstatus(:'r1'), 'approved', 'after all of those the approval is unused') \g /dev/null
select test.stepup('m_manager') \g /dev/null
select test.vrev('m_manager', :'r1') as v1 \gset
select test.ok(:'v1'::jsonb ->> 'value' = '123456789' and :'v1'::jsonb ->> 'last4' = '6789' and (:'v1'::jsonb ->> 'hideAt')::timestamptz between now() + interval '50 seconds' and now() + interval '70 seconds',
  'vault_reveal: the person who asked, approved by someone else and freshly confirmed, gets the nine digits and the moment to hide them (60 seconds)') \g /dev/null
select test.ok((select status = 'used' and used_at > now() - interval '1 minute' from public.reveal_requests where id = :'r1')
           and (select count(*) = 1 from public.secure_access_log where request_id = :'r1' and action = 'reveal' and member_id = test.id('m.m_manager') and reason = 'Preparing the yearly return')
           and exists (select 1 from app.security_events where tenant_id = test.id('m') and kind = 'vault.reveal' and user_id = test.id('m_manager'))
           and exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'vault.reveal' and table_name = 'client' and row_id = test.u(5001) and actor = test.id('m_manager')),
  'the viewing used the request up and is in the access log (with the reason), the security events and the audit log') \g /dev/null
select test.is(test.vrev('m_manager', :'r1') ->> 'word', 'expired', 'ONE viewing: the same request shows nothing a second time') \g /dev/null
select test.ok((select count(*) = 1 from public.secure_access_log where request_id = :'r1' and action = 'reveal'), 'and the refused second viewing is not logged as a viewing') \g /dev/null
-- copied out of the panel
select test.is(test.f('m_owner', format('to_jsonb(public.vault_copied(%L, %L))', test.id('m'), :'r1')) ->> 'error', '42501', 'vault_copied: only the person who viewed can say they copied it') \g /dev/null
select test.is(test.f('m_manager', format('to_jsonb(public.vault_copied(%L, %L))', test.id('m'), :'r1'))::text, 'true', 'they say so') \g /dev/null
select test.ok(exists (select 1 from public.secure_access_log where request_id = :'r1' and action = 'export' and member_id = test.id('m.m_manager')), 'and it is in the access log as "export"') \g /dev/null

-- denied, pending, and an approval that ran out
select (test.vreq('m_manager', test.u(5003), 'A letter from the agency asks for it') ->> 'id')::uuid as r2 \gset
select test.is(test.vdec('m_owner', :'r2', false) ->> 'status', 'denied', 'the owner denies a request (a denial needs no identity check)') \g /dev/null
select test.is(test.vrev('m_manager', :'r2') ->> 'word', 'expired', 'a denied request shows nothing') \g /dev/null
select test.ok(exists (select 1 from public.secure_access_log where request_id = :'r2' and action = 'deny' and member_id = test.id('m.m_owner')), 'the denial is in the access log') \g /dev/null
select (test.vreq('m_manager', test.u(5003), 'Asking again with more detail') ->> 'id')::uuid as r3 \gset
select test.stepup('m_owner') \g /dev/null
select test.is(test.vdec('m_owner', :'r3', true) ->> 'status', 'approved', 'a new request for the same client is approved') \g /dev/null
select test.is(test.f('m_manager', format('to_jsonb(public.vault_copied(%L, %L))', test.id('m'), :'r3')) ->> 'error', '42501', 'nothing can be "copied" from a request that was not viewed') \g /dev/null
update public.reveal_requests set expires_at = now() - interval '1 second' where id = :'r3';
select test.is(test.vrev('m_manager', :'r3') ->> 'word', 'expired', 'an approval that ran out shows nothing, to the second') \g /dev/null
select test.is(test.as('m_owner', 'select public.vault_expire()'), 'error:42501', 'vault_expire is the server''s: a person cannot call it') \g /dev/null
-- a request nobody answered for a day
insert into public.reveal_requests (id, tenant_id, client_id, requested_by, reason, at) values (test.u(5010), test.id('m'), test.u(5003), test.id('m.m_owner'), 'Asked yesterday morning', now() - interval '25 hours');
select test.is(test.vdec('m_manager', test.u(5010), true) ->> 'word', 'expired', 'a request nobody answered for 24 hours can no longer be approved') \g /dev/null
select test.login('service') \g /dev/null
select public.vault_expire() as swept \gset
select public.vault_expire() as swept2 \gset
select test.logout() \g /dev/null
select test.ok(:swept >= 2 and :swept2 = 0 and test.vstatus(:'r3') = 'expired' and test.vstatus(test.u(5010)) = 'expired', 'the sweep closes the approval that ran out and the request nobody answered; run again it finds nothing') \g /dev/null
select test.ok((select count(*) = 2 from public.secure_access_log where request_id in (:'r3', test.u(5010)) and action = 'expire' and actor_kind = 'system' and member_id is null), 'each is in the access log as "expire", by the system') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- The single-person rule: the company chose "the person confirms who they are" instead of a second person
-- ---------------------------------------------------------------------------------------------------------------------
update public.tenants set config = jsonb_set(coalesce(config, '{}'::jsonb), '{vault}', '{"approval": "step_up", "revealSeconds": 30}') where id = test.id('m');
select (test.vreq('m_manager', test.u(5003), 'Filing the quarterly form') ->> 'id')::uuid as r4 \gset
select test.stepup_stale('m_manager') \g /dev/null
select test.is(test.vdec('m_manager', :'r4', true) ->> 'error', 'VX403', 'single-person rule: approving one''s own request IS the identity check, so without a fresh one it is refused') \g /dev/null
select test.stepup('m_manager') \g /dev/null
select test.vdec('m_manager', :'r4', true) as d4 \gset
select test.ok(:'d4'::jsonb ->> 'status' = 'approved' and :'d4'::jsonb ->> 'approverId' = test.id('m.m_manager')::text, 'freshly confirmed, the person approves their own request') \g /dev/null
select test.vrev('m_manager', :'r4') as v4 \gset
select test.ok(:'v4'::jsonb ->> 'value' = '123456789' and (:'v4'::jsonb ->> 'hideAt')::timestamptz between now() + interval '20 seconds' and now() + interval '40 seconds',
  'and views the number once; the company''s own display time (30 seconds) is in the answer') \g /dev/null
select test.is(test.vrev('m_manager', :'r4') ->> 'word', 'expired', 'once, under this rule too') \g /dev/null
select test.is(test.vreq('m_staff', test.u(5003), 'Staff under the single-person rule') ->> 'error', '42501', 'the single-person rule gives nothing to someone who does not hold "secureReveal"') \g /dev/null
update public.tenants set config = config - 'vault' where id = test.id('m');
select (test.vreq('m_manager', test.u(5003), 'Back under the two-person rule') ->> 'id')::uuid as r5 \gset
select test.is(test.vdec('m_manager', :'r5', true) ->> 'word', 'needs_other_person', 'with the rule back to two people, the person who asked cannot approve again') \g /dev/null
select test.is(test.vdec('m_manager', :'r5', false) ->> 'status', 'denied', 'they can always take their own request back') \g /dev/null
-- a request for a client the approver cannot open
select (test.vreq('m_owner', test.u(5002), 'The owner asks about the second office client') ->> 'id')::uuid as r6 \gset
select test.is(test.vdec('m_manager', :'r6', true) ->> 'word', 'not_found', 'someone who decides requests cannot decide one for a client of another office: for them it does not exist') \g /dev/null
select test.stepup('m_owner') \g /dev/null
select test.is(test.vdec('m_owner', :'r6', true) ->> 'word', 'needs_other_person', 'and the owner cannot approve it themselves') \g /dev/null

-- the second sign-in step, where the company asks for it
update public.tenants set config = jsonb_set(coalesce(config, '{}'::jsonb), '{security}', '{"mfaRoles": ["manager"]}') where id = test.id('m');
select test.is(test.j1('m_manager', format('select public.vault_request(%L, %L, %L)', test.id('m'), test.u(5005), 'Signed in with a password only'))::text, '{"word": "mfa_required", "error": "VX402"}',
  'where the company asks its senior associates for the second sign-in step, a session without it cannot use the vault') \g /dev/null
select test.is(test.j1('m_manager', format('select public.vault_reveal(%L, %L)', test.id('m'), :'r1')) ->> 'error', 'VX402', 'not to ask, and not to view') \g /dev/null
update public.tenants set config = config - 'security' where id = test.id('m');

-- ---------------------------------------------------------------------------------------------------------------------
-- vault_clear
-- ---------------------------------------------------------------------------------------------------------------------
select (test.vreq('m_manager', test.u(5005), 'Waiting when the number is removed') ->> 'id')::uuid as r7 \gset
select test.stepup_stale('m_owner') \g /dev/null
select test.is(test.f('m_owner', format('public.vault_clear(%L, %L)', test.id('m'), test.u(5005))) ->> 'error', 'VX403', 'vault_clear: removing a number cannot be undone, so it needs a fresh identity check') \g /dev/null
select test.is(test.vset('m_owner', test.u(5005), 'ein', '') ->> 'error', 'VX403', 'the same through vault_set with an empty value') \g /dev/null
select test.is(test.f('m_staff', format('public.vault_clear(%L, %L)', test.id('m'), test.u(5005))) ->> 'error', '42501', 'staff cannot remove a number') \g /dev/null
select test.ok(exists (select 1 from public.client_secrets where client_id = test.u(5005)), 'the number is still on file') \g /dev/null
select test.stepup('m_owner') \g /dev/null
select test.is(test.f('m_owner', format('public.vault_clear(%L, %L)', test.id('m'), test.u(5005)))::text, '{"taxIdType": "ein", "taxIdLast4": ""}', 'freshly confirmed, the owner removes it') \g /dev/null
select test.ok(not exists (select 1 from public.client_secrets where client_id = test.u(5005)) and (select tax_id_type is null and tax_id_last4 is null from public.clients where id = test.u(5005)),
  'the stored number is gone and the client row shows none') \g /dev/null
select test.ok(test.vstatus(:'r7') = 'expired' and exists (select 1 from public.secure_access_log where request_id = :'r7' and action = 'expire' and actor_kind = 'system')
           and exists (select 1 from public.secure_access_log where client_id = test.u(5005) and action = 'clear' and member_id = test.id('m.m_owner')),
  'the request that was waiting is closed, and both the removal and that closing are in the access log') \g /dev/null
select test.is(test.f('m_owner', format('public.vault_clear(%L, %L)', test.id('m'), test.u(5005))) ->> 'word', 'not_found', 'there is nothing to remove a second time') \g /dev/null
select test.is(test.vreq('m_manager', test.u(5005), 'After it was removed') ->> 'word', 'not_found', 'and nothing to ask for') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- The records are evidence, for every caller
-- ---------------------------------------------------------------------------------------------------------------------
select test.is(test.as('service', format($q$update public.reveal_requests set reason = 'Rewritten afterwards' where id = %L$q$, :'r1')), 'error:42501', 'not even the server key rewrites the reason of a request') \g /dev/null
select test.is(test.as('service', format($q$update public.reveal_requests set requested_by = %L where id = %L$q$, test.id('m.m_owner'), :'r1')), 'error:42501', 'or who asked') \g /dev/null
select test.is(test.as('service', format($q$update public.reveal_requests set status = 'approved', used_at = null where id = %L$q$, :'r1')), 'error:42501', 'or makes a used request good again') \g /dev/null
select test.is(test.as('service', format($q$update public.reveal_requests set status = 'pending' where id = %L$q$, :'r2')), 'error:42501', 'or reopens a denied one') \g /dev/null
select test.is(test.as('service', format($q$delete from public.reveal_requests where id = %L$q$, :'r1')), 'error:42501', 'or removes one') \g /dev/null
select test.is(test.as('service', format($q$update public.secure_access_log set action = 'set' where request_id = %L$q$, :'r1')), 'error:42501', 'the access log is append only: no line is changed') \g /dev/null
select test.is(test.as('service', format($q$delete from public.secure_access_log where request_id = %L$q$, :'r1')), 'error:42501', 'and none is removed') \g /dev/null
select test.is(test.as('m_owner', format($q$insert into public.reveal_requests (tenant_id, client_id, requested_by, reason, status, approver_id, decided_at, expires_at) values (%L, %L, %L, 'Planted as approved', 'approved', %L, now(), now() + interval '1 hour')$q$,
  test.id('m'), test.u(5001), test.id('m.m_owner'), test.id('m.m_manager'))), 'error:42501', 'a person cannot plant a request that is already approved: the table is written by the functions only') \g /dev/null
select test.is(test.as('m_owner', format($q$update public.reveal_requests set status = 'approved' where id = %L$q$, :'r6')), 'error:42501', 'or approve one with a direct write') \g /dev/null
select test.is(test.as('m_owner', format($q$insert into public.secure_access_log (tenant_id, client_id, member_id, action) values (%L, %L, %L, 'reveal')$q$, test.id('m'), test.u(5001), test.id('m.m_staff'))), 'error:42501', 'or write a line of the access log') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- No other path returns the number
-- ---------------------------------------------------------------------------------------------------------------------
select test.is(test.as('m_owner', 'select tax_id_enc from public.client_secrets'), 'error:42501', 'the owner cannot read the table that holds the encrypted number') \g /dev/null
select test.is(test.as('service', 'select tax_id_enc from public.client_secrets'), 'error:42501', 'nor the server key') \g /dev/null
select test.is(test.as('m_owner', $q$select app.decrypt_pii('\x00'::bytea)$q$), 'error:42501', 'nobody can call the decryption function') \g /dev/null
select test.is(test.as('service', $q$select app.decrypt_pii('\x00'::bytea)$q$), 'error:42501', 'the server key included') \g /dev/null
select test.is(test.as('m_owner', 'select app.pii_key()'), 'error:42501', 'nor read the key') \g /dev/null
select test.ok((select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'app') and p.prosrc ~ 'client_secrets' and p.prosrc ~ 'decrypt_pii') and (select 'public.vault_reveal(uuid,uuid)'::regprocedure is not null),
  'exactly one function in the database both reads client_secrets and decrypts: vault_reveal') \g /dev/null
select test.ok((:'s1' || :'q1' || :'d1' || :'d4') !~ '123-?45-?6789', 'the answers of vault_set, vault_request and vault_decide never carry the number') \g /dev/null
select test.ok(test.load('m_owner', 'm')::text !~ '123-?45-?6789' and test.load('m_manager', 'm')::text !~ '123-?45-?6789', 'ws_load for the owner and for the person who viewed it holds no number') \g /dev/null
select test.ok(test.load('m_manager', 'm')::text ~ 'Preparing the yearly return' and jsonb_array_length(test.load('m_staff', 'm') -> 'reveals') = 0 and jsonb_array_length(test.load('m_staff', 'm') -> 'secureLog') = 0,
  'ws_load gives the requests and the access log to the people who decide them, and neither to staff') \g /dev/null

-- The search: a control first (a marker in a client''s name is found, in the table and in its audit entry), then the numbers.
insert into public.clients (id, tenant_id, name) values (test.u(5006), test.id('m'), 'Search control 987-65-4320');
select test.ok(test.find_text('987-?65-?4320') ~ 'public\.clients\.name' and test.find_text('987-?65-?4320') ~ 'public\.audit_log\.new_data',
  'control: the search over every stored text finds a marker written in clear, in its table and in the audit log') \g /dev/null
select test.is(test.find_text('123-?45-?6789'), '', 'after storing, requesting, approving, viewing, copying, replacing and removing: the planted number 123-45-6789 is in no text, JSON or byte column of any table') \g /dev/null
select test.is(test.find_text('912[- ]?70[- ]?1234'), '', 'nor is the second planted number, in any spelling') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '36. tax ID vault' group by section;
