-- Module tests: the server side of the public pages and the server workflows (0041 to 0045).
-- Company N (build). Signature requests, review requests, queued messages and the website form are driven here the
-- way the server drives them (as the service role, with the hash of a link token), and every function is tried as
-- the people who must not reach it. The link tokens are made up; only their hashes go in.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('40. public endpoints') \g /dev/null

create or replace function test.h(t text) returns text language sql immutable as $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
-- the request as the rules would hand it back after `change` (a jsonb patch on its top level)
create or replace function test.env(e uuid, change jsonb default '{}') returns jsonb language sql as $$ select app.envelope_json(test.id('n'), e) || change $$;
create or replace function test.events_plus(e uuid, kind text) returns jsonb language sql as
$$ select (select events from public.envelopes where id = e) || jsonb_build_array(jsonb_build_object('at', '2026-01-01T00:00:00.000Z', 'kind', kind)) $$;

insert into public.clients (id, tenant_id, name, email, email_opt_out) values
  (test.u(880001), test.id('n'), 'Public Client One', 'public-one@example.com', false),
  (test.u(880002), test.id('n'), 'Public Client Two', 'public-two@example.com', true);
insert into public.documents (id, tenant_id, kind, number, title, status, client_id) values (test.u(880010), test.id('n'), 'contract', 'PUB-1', 'Sample agreement', 'draft', test.u(880001));
insert into public.envelopes (id, tenant_id, doc_id, title, status, ordered, extra) values
  (test.u(880020), test.id('n'), test.u(880010), 'Sample agreement', 'draft', true, jsonb_build_object('source', jsonb_build_object('path', test.id('n') || '/signature/sample-file.pdf'), 'lang', 'en'));
insert into public.envelope_signers (id, tenant_id, envelope_id, name, email, sign_order) values
  (test.u(880021), test.id('n'), test.u(880020), 'Sample Signer One', 'signer-one@example.com', 1),
  (test.u(880022), test.id('n'), test.u(880020), 'Sample Signer Two', 'signer-two@example.com', 2);
insert into public.envelope_fields (id, tenant_id, envelope_id, signer_id, type, page, x, y, w, h) values
  (test.u(880031), test.id('n'), test.u(880020), test.u(880021), 'signature', 1, 0.1, 0.7, 0.3, 0.06),
  (test.u(880032), test.id('n'), test.u(880020), test.u(880022), 'signature', 1, 0.1, 0.8, 0.3, 0.06);

-- ---- who may call what ----------------------------------------------------------------------------------------------
select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('sign_open', 'sign_commit', 'sign_finalize', 'envelope_get', 'envelope_commit', 'envelopes_due', 'envelopes_unfinished',
      'review_send_commit', 'review_open', 'review_answer', 'messages_queued', 'message_get', 'message_mark', 'intake_submit', 'owner_summary_due', 'public_links_purge')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or not has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  'the sixteen server functions of this range: the server only, never anon or a signed-in person') \g /dev/null
select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('envelope_send_check', 'review_send_check', 'intake_key_rotate', 'intake_key_state')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'the four functions a member calls: signed-in people only, never anon') \g /dev/null
select test.is(test.f('n_owner', format('public.sign_open(%L)', test.h('t1'))) ->> 'error', '42501', 'a signed-in owner cannot call sign_open') \g /dev/null
select test.is(test.f('anon', format('public.review_open(%L)', test.h('t1'))) ->> 'error', '42501', 'anon cannot call review_open') \g /dev/null
select test.is(test.f('n_owner', format('public.intake_submit(%L, %L, %L)', test.h('k'), '{"name":"X Y"}', 'idem-0001')) ->> 'error', '42501', 'nor may a person submit the website form function') \g /dev/null
select test.ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'app.intake_forms'::regclass)
  and not exists (select 1 from pg_policy where polrelid = 'app.intake_forms'::regclass)
  and not has_table_privilege('authenticated', 'app.intake_forms', 'select') and not has_table_privilege('service_role', 'app.intake_forms', 'select'),
  'app.intake_forms is closed like every server table') \g /dev/null

-- ---- sending --------------------------------------------------------------------------------------------------------
select test.is(test.f('b_owner', format('public.envelope_send_check(%L, %L)', test.id('n'), test.u(880020))) ->> 'error', '42501', 'envelope_send_check: not for the owner of another company') \g /dev/null
select test.is(test.f('n_w1', format('public.envelope_send_check(%L, %L)', test.id('n'), test.u(880020))) ->> 'error', '42501', 'nor for a field worker, who has no part in signature requests') \g /dev/null
select test.is(test.f('n_owner', format('public.envelope_send_check(%L, %L)', test.id('n'), test.u(880020))) ->> 'consentApproved', 'false', 'no consent sentence yet: the check says so') \g /dev/null
insert into public.doc_templates (id, tenant_id, kind, name, lang, source, approved, extra) values (test.u(880040), test.id('n'), 'custom', 'Consent', 'en', 'company', false, '{"use":"consent"}');
insert into public.doc_template_blocks (tenant_id, template_id, type, text) values (test.id('n'), test.u(880040), 'p', 'I agree to sign this sample electronically.');
select test.is(test.f('n_owner', format('public.envelope_send_check(%L, %L)', test.id('n'), test.u(880020))) ->> 'consentApproved', 'false', 'a consent sentence nobody approved does not count') \g /dev/null
update public.doc_templates set approved = true, approved_at = now() where id = test.u(880040);
select test.is((select (r ->> 'consentApproved') || '/' || (r ->> 'templateApproved') || '/' || (r ->> 'hasDocument') || '/' || (r ->> 'rev') || '/' || (r ->> 'consentText')
  from test.f('n_owner', format('public.envelope_send_check(%L, %L)', test.id('n'), test.u(880020))) r),
  'true/true/true/0/I agree to sign this sample electronically.', 'approved: the check returns the facts the rules need') \g /dev/null

-- the server records the sending, with the link of the first signer
select test.is(test.f('service', format('public.envelope_commit(%L, %L, %L, %L, %L::jsonb, %L::jsonb)', test.id('n'), test.u(880020), 'sent', 5,
  test.env(test.u(880020)), '[]')) ->> 'conflict', 'true', 'envelope_commit: a write based on a stale reading is refused') \g /dev/null
select test.is(test.f('service', format('public.envelope_commit(%L, %L, %L, %L, %L::jsonb, %L::jsonb)', test.id('n'), test.u(880020), 'sent', 0,
  jsonb_set(test.env(test.u(880020), jsonb_build_object('status', 'sent', 'sentAt', '2026-01-01T00:00:00.000Z', 'expiresAt', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'events', '[{"at":"2026-01-01T00:00:00.000Z","kind":"sent"}]'::jsonb)), '{signers,0,status}', '"sent"'),
  jsonb_build_array(jsonb_build_object('signerId', test.u(880021), 'tokenHash', test.h('t1'))))) ->> 'ok', 'true', 'sent: the request, its first signer and the link are written together') \g /dev/null
select test.is((select status || '/' || (select status from public.envelope_signers where id = test.u(880021)) || '/' || (select status from public.documents where id = test.u(880010)) from public.envelopes where id = test.u(880020)),
  'sent/sent/sent', 'the request, the signer and the document all say sent') \g /dev/null
select test.is(test.f('service', format('public.envelope_commit(%L, %L, %L, %L, %L::jsonb)', test.id('n'), test.u(880020), 'sent', 1, test.env(test.u(880020)))) ->> 'conflict', 'true', 'a request that is not a draft cannot be sent again') \g /dev/null
select test.ok((select count(*) = 1 and bool_and(token_hash = test.h('t1')) from app.public_links where signer_id = test.u(880021))
  and not exists (select 1 from app.public_links l where to_jsonb(l)::text like '%"t1"%'), 'only the hash of the token is stored') \g /dev/null
select test.is(test.f('service', format('public.envelope_commit(%L, %L, %L, %L, %L::jsonb, %L::jsonb)', test.id('n'), test.u(880020), 'reminded', 1, test.env(test.u(880020)),
  jsonb_build_array(jsonb_build_object('signerId', test.u(880022), 'tokenHash', test.h('t2'))))) ->> 'word', 'invalid_link', 'no link for a signer whose turn has not come') \g /dev/null

-- ---- the signing page -----------------------------------------------------------------------------------------------
select test.ok(test.f('service', format('public.sign_open(%L)', test.h('unknown'))) is null, 'sign_open: an unknown token opens nothing') \g /dev/null
select test.is((test.f('service', format('public.sign_open(%L)', test.h('t1'))) #>> '{envelope,signers,0,email}'), 'signer-one@example.com', 'a live token opens its request') \g /dev/null
insert into app.public_links (tenant_id, purpose, token_hash, signer_id, created_at, expires_at) values (test.id('n'), 'sign', test.h('old'), test.u(880021), now() - interval '3 days', now() - interval '1 day');
select test.ok(test.f('service', format('public.sign_open(%L)', test.h('old'))) is null, 'an expired token opens nothing') \g /dev/null
select test.ok(test.f('service', format('public.review_open(%L)', test.h('t1'))) is null, 'a signing token is not a review token') \g /dev/null
select test.is(test.f('service', format('public.sign_commit(%L, %L, %L, %L::jsonb)', test.h('t1'), 'signed', 7, test.env(test.u(880020)))) ->> 'conflict', 'true', 'sign_commit: stale reading, nothing written') \g /dev/null
select test.is(test.f('service', format('public.sign_commit(%L, %L, %L, %L::jsonb)', test.h('t1'), 'signed', 1, test.env(test.u(880020), jsonb_build_object('events', '[{"at":"x","kind":"forged"}]'::jsonb)))) ->> 'word', 'trail_rewritten',
  'the trail of a request can only grow: a rewritten one is refused') \g /dev/null
-- signer one signs; the rules let signer two in
select test.is(test.f('service', format('public.sign_commit(%L, %L, %L, %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)', test.h('t1'), 'signed', 1,
  jsonb_set(jsonb_set(jsonb_set(test.env(test.u(880020), jsonb_build_object('status', 'partly_signed', 'events', test.events_plus(test.u(880020), 'signed'))),
    '{signers,0}', (test.env(test.u(880020)) #> '{signers,0}') || '{"status":"signed","signedAt":"2026-01-02T00:00:00.000Z","typedName":"Sample Signer One","consent":true}'),
    '{signers,1,status}', '"sent"'), '{fields,0,value}', '"signed"'),
  jsonb_build_array(jsonb_build_object('signerId', test.u(880022), 'tokenHash', test.h('t2'))), repeat('a', 64), test.h('request-1'), '{"ok":true,"completed":false}')) ->> 'ok', 'true',
  'a signature is written: signer, box, trail, the next signer''s link') \g /dev/null
select test.is((select string_agg(status, ',' order by sign_order) from public.envelope_signers where envelope_id = test.u(880020)) || '/' || (select status from public.envelopes where id = test.u(880020))
  || '/' || (select value from public.envelope_fields where id = test.u(880031)) || '/' || (select extra ->> 'ipHash' from public.envelope_signers where id = test.u(880021)),
  'signed,sent/partly_signed/signed/' || repeat('a', 64), 'what the database holds afterwards, with the address as a hash') \g /dev/null
select test.ok(test.f('service', format('public.sign_open(%L)', test.h('t1'))) is null, 'the used link opens nothing') \g /dev/null
select test.is(test.f('service', format('public.sign_open(%L, %L)', test.h('t1'), test.h('request-1'))) #>> '{replay,completed}', 'false', 'the same request again gets the answer given then') \g /dev/null
select test.ok(test.f('service', format('public.sign_open(%L, %L)', test.h('t1'), test.h('request-2'))) is null, 'a different request with the used link gets nothing') \g /dev/null
select test.ok(test.f('service', format('public.sign_commit(%L, %L, %L, %L::jsonb)', test.h('t1'), 'signed', 2, test.env(test.u(880020)))) is null, 'and cannot write') \g /dev/null
-- the signed copy
select test.is(test.f('service', format('to_jsonb(public.sign_finalize(%L, %L, %L::jsonb, %L::jsonb))', test.id('n'), test.u(880020),
  jsonb_build_object('name', 'a.pdf', 'size', 1, 'mime', 'application/pdf', 'path', test.id('n') || '/signature/x.pdf'), jsonb_build_object('original', repeat('1', 64), 'signed', repeat('2', 64), 'final', repeat('3', 64)))) ->> 'word',
  'not_completed', 'no signed copy for a request that is not completed') \g /dev/null
select test.is(test.f('service', format('public.sign_commit(%L, %L, %L, %L::jsonb)', test.h('t2'), 'signed', 2,
  jsonb_set(test.env(test.u(880020), jsonb_build_object('status', 'completed', 'completedAt', '2026-01-03T00:00:00.000Z', 'events', test.events_plus(test.u(880020), 'completed'))),
    '{signers,1}', (test.env(test.u(880020)) #> '{signers,1}') || '{"status":"signed","signedAt":"2026-01-03T00:00:00.000Z","typedName":"Sample Signer Two","consent":true}'))) ->> 'ok', 'true', 'the last signature completes the request') \g /dev/null
select test.is(test.f('service', format('to_jsonb(public.sign_finalize(%L, %L, %L::jsonb, %L::jsonb))', test.id('n'), test.u(880020),
  jsonb_build_object('name', 'a.pdf', 'size', 1, 'mime', 'application/pdf', 'path', test.id('b') || '/signature/x.pdf'), jsonb_build_object('original', repeat('1', 64), 'signed', repeat('2', 64), 'final', repeat('3', 64)))) ->> 'error',
  '22023', 'a signed copy in another company''s folder is refused') \g /dev/null
select test.is(test.f('service', format('to_jsonb(public.sign_finalize(%L, %L, %L::jsonb, %L::jsonb))', test.id('n'), test.u(880020),
  jsonb_build_object('name', 'a.pdf', 'size', 1, 'mime', 'application/pdf', 'path', test.id('n') || '/signature/x.pdf'), jsonb_build_object('original', repeat('1', 64), 'signed', repeat('2', 64), 'final', repeat('3', 64))))::text,
  'true', 'the signed copy is recorded') \g /dev/null
select test.is(test.f('service', format('to_jsonb(public.sign_finalize(%L, %L, %L::jsonb, %L::jsonb))', test.id('n'), test.u(880020),
  jsonb_build_object('name', 'b.pdf', 'size', 1, 'mime', 'application/pdf', 'path', test.id('n') || '/signature/y.pdf'), jsonb_build_object('original', repeat('1', 64), 'signed', repeat('2', 64), 'final', repeat('4', 64))))::text,
  'false', 'once: a second signed copy changes nothing') \g /dev/null
select test.is((select (e.signed_file ->> 'path' = test.id('n') || '/signature/x.pdf')::text || '/' || (e.extra #>> '{hashes,final}') || '/' || (d.versions -> -1 ->> 'kind') || '/' || (d.versions -> -1 #>> '{hashes,signed}') || '/' || d.status
  from public.envelopes e join public.documents d on d.id = e.doc_id where e.id = test.u(880020)),
  'true/' || repeat('3', 64) || '/signed/' || repeat('2', 64) || '/signed', 'file, fingerprints and the new document version are on the record') \g /dev/null
select test.is(test.w('n_owner', format('update public.envelopes set signed_file = null where id = %L', test.u(880020))), '42501:Only the server records a signature request as sent, signed, completed, declined or expired',
  'a person still cannot change what the server recorded') \g /dev/null

-- ---- reviews --------------------------------------------------------------------------------------------------------
insert into public.review_requests (id, tenant_id, client_id, channel, status) values
  (test.u(880050), test.id('n'), test.u(880001), 'email', 'draft'), (test.u(880051), test.id('n'), test.u(880002), 'email', 'draft'), (test.u(880052), test.id('n'), test.u(880001), 'email', 'draft');
update public.tenants set settings = settings || '{"reviews":{"publicUrl":"https://reviews.example.com/n"}}' where id = test.id('n');
select test.is(test.f('n_owner', format('public.review_send_check(%L, %L)', test.id('n'), test.u(880051))) ->> 'emailOptOut', 'true', 'review_send_check reports the opt-out') \g /dev/null
select test.is(test.f('b_owner', format('public.review_send_check(%L, %L)', test.id('n'), test.u(880050))) ->> 'error', '42501', 'not for another company') \g /dev/null
select test.is(test.f('service', format('public.review_send_commit(%L, %L, %L, 720, %L, %L, %L)', test.id('n'), test.u(880051), test.h('r-out'), 'S', 'B {{link}}', 'sealed')) ->> 'reason', 'opted_out',
  'the server refuses again: no request to a client who opted out of email') \g /dev/null
select test.is(test.f('service', format('public.review_send_commit(%L, %L, %L, 720, %L, %L, %L)', test.id('n'), test.u(880050), test.h('r1'), 'S', 'B {{link}}', 'sealed')) ->> 'ok', 'true', 'review_send_commit queues the message') \g /dev/null
select test.is((select r.status || '/' || m.status || '/' || m.channel || '/' || (m.extra ->> 'system') from public.review_requests r join public.messages m on m.id::text = r.extra ->> 'messageId' where r.id = test.u(880050)),
  'draft/queued/email/true', 'the request is still a draft: nothing was accepted by a provider yet') \g /dev/null
select test.is(test.f('service', format('to_jsonb(public.message_mark(%L, %L, %L))', test.id('n'), (select extra ->> 'messageId' from public.review_requests where id = test.u(880050)), 'sent')) ->> 'error', '22023',
  '"sent" without the provider''s reference is refused') \g /dev/null
select test.is(test.f('service', format('to_jsonb(public.message_mark(%L, %L, %L, %L, %L))', test.id('n'), (select extra ->> 'messageId' from public.review_requests where id = test.u(880050)), 'sent', 'resend', 'email_1'))::text, 'true', 'accepted by the provider: sent') \g /dev/null
select test.is(test.f('service', format('to_jsonb(public.message_mark(%L, %L, %L, %L, %L))', test.id('n'), (select extra ->> 'messageId' from public.review_requests where id = test.u(880050)), 'failed', null, null))::text, 'false', 'the outcome of a message is written once') \g /dev/null
select test.is((select status from public.review_requests where id = test.u(880050)), 'sent', 'and only now is the review request sent') \g /dev/null
select test.is((select (r ->> 'state') || '/' || (r ->> 'publicUrl') || '/' || (r ->> 'firstName') from test.f('service', format('public.review_open(%L)', test.h('r1'))) r), 'open/https://reviews.example.com/n/Public', 'review_open') \g /dev/null
select test.is((select status from public.review_requests where id = test.u(880050)), 'opened', 'the first opening is recorded') \g /dev/null
select test.is(test.f('service', format('public.review_answer(%L, %L, %L, false)', test.h('r1'), 7, 'x')) ->> 'error', '22023', 'a rating outside 1 to 5 is refused') \g /dev/null
select test.is((select (r ->> 'low') || '/' || (r ->> 'publicUrl') from test.f('service', format('public.review_answer(%L, %L, %L, false, null, %L)', test.h('r1'), 2, 'It started late.', test.h('a1'))) r),
  'true/https://reviews.example.com/n', 'a low rating is answered with the public link all the same') \g /dev/null
select test.is((select count(*)::text || '/' || min(pri) || '/' || min(client_id::text) from public.tasks where auto = 'review-low:' || test.u(880050)), '1/high/' || test.u(880001), 'and creates one follow-up task') \g /dev/null
select test.is(test.f('service', format('public.review_answer(%L, %L, %L, false, null, %L)', test.h('r1'), 2, 'It started late.', test.h('a1'))) ->> 'low', 'true', 'the same answer again: the same reply') \g /dev/null
select test.ok(test.f('service', format('public.review_answer(%L, %L, %L, false, null, %L)', test.h('r1'), 5, '', test.h('a2'))) is null
  and (select count(*) = 1 from public.tasks where auto = 'review-low:' || test.u(880050)) and (select rating = 2 from public.review_requests where id = test.u(880050)),
  'a different answer with the used link changes nothing') \g /dev/null
select test.is(test.f('service', format('public.review_send_commit(%L, %L, %L, 720, %L, %L, %L)', test.id('n'), test.u(880052), test.h('r3'), 'S', 'B {{link}}', 'sealed')) ->> 'ok', 'true', 'a second request') \g /dev/null
select test.is(test.f('service', format('public.review_answer(%L, null, null, true)', test.h('r3'))) ->> 'declined', 'true', '"no thanks" is accepted') \g /dev/null
select test.ok((select status = 'declined' from public.review_requests where id = test.u(880052))
  and not exists (select 1 from public.tasks where auto = 'review-low:' || test.u(880052)), 'and recorded, with no task') \g /dev/null

-- ---- the website form -----------------------------------------------------------------------------------------------
select test.is(test.f('n_staff', format('public.intake_key_rotate(%L)', test.id('n'))) ->> 'error', '42501', 'intake_key_rotate: not without "settings"') \g /dev/null
create temp table _key as select test.f('n_owner', format('public.intake_key_rotate(%L)', test.id('n'))) ->> 'key' as k;
grant select on _key to public;
select test.ok((select k ~ '^[0-9a-f]{64}$' from _key) and (select key_hash = test.h((select k from _key)) from app.intake_forms where tenant_id = test.id('n')), 'the key is returned once and only its hash is stored') \g /dev/null
select test.ok(test.f('service', format('public.intake_submit(%L, %L::jsonb, %L)', test.h('not-a-key'), '{"name":"Sample Prospect"}', 'idem-00001')) is null, 'an unknown form key: nothing') \g /dev/null
select test.is(test.f('service', format('public.intake_submit(%L, %L::jsonb, %L, %L, %L)', test.h((select k from _key)), '{"name":"Sample Prospect","email":"web-prospect@example.com","phone":"609-555-0661"}', 'idem-00001', repeat('b', 64), 'I agree to be contacted.')) ->> 'ok',
  'true', 'a lead is created') \g /dev/null
select test.is((select count(*)::text || '/' || min(source) || '/' || min(status) || '/' || min(extra #>> '{consent,text}') || '/' || (min(owner_id::text) is not null)::text from public.leads where tenant_id = test.id('n') and email = 'web-prospect@example.com'),
  '1/website/new/I agree to be contacted./true', 'with its source, the consent sentence, and an owner from the rotation') \g /dev/null
select test.is(test.f('service', format('public.intake_submit(%L, %L::jsonb, %L)', test.h((select k from _key)), '{"name":"Sample Prospect","email":"web-prospect@example.com"}', 'idem-00001')) ->> 'replay', 'true', 'the same submission again: the same lead') \g /dev/null
select test.is(test.f('service', format('public.intake_submit(%L, %L::jsonb, %L)', test.h((select k from _key)), '{"name":"S. Prospect","email":"WEB-prospect@example.com"}', 'idem-00002')) ->> 'duplicate', 'true', 'the same person again: found, not doubled') \g /dev/null
select test.is((select count(*)::text || '/' || min(extra ->> 'intakeAgain') from public.leads where tenant_id = test.id('n') and lower(email) = 'web-prospect@example.com'), '1/1', 'still one lead, which remembers the second form') \g /dev/null
select test.ok(test.f('n_owner', format('public.intake_key_rotate(%L)', test.id('n'))) ->> 'key' <> (select k from _key)
  and test.f('service', format('public.intake_submit(%L, %L::jsonb, %L)', test.h((select k from _key)), '{"name":"Late Prospect","email":"late@example.com"}', 'idem-00003')) is null, 'a replaced key stops working at once') \g /dev/null
drop table _key;

-- ---- queued messages and the daily numbers --------------------------------------------------------------------------
insert into public.messages (id, tenant_id, channel, recipient, subject, body, status, dir, client_id) values
  (test.u(880060), test.id('n'), 'email', 'public-two@example.com', 'S', 'B', 'queued', 'out', test.u(880002)),
  (test.u(880061), test.id('n'), 'email', 'public-one@example.com', 'S', 'B', 'draft', 'out', test.u(880001));
select test.ok((select count(*) = 1 from jsonb_array_elements(test.f('service', 'public.messages_queued(500)')) x where x ->> 'id' in (test.u(880060)::text, test.u(880061)::text)), 'messages_queued lists what is queued, not drafts') \g /dev/null
select test.is(test.f('service', format('public.message_get(%L, %L)', test.id('n'), test.u(880060))) ->> 'emailOptOut', 'true', 'message_get carries the opt-out as it is now') \g /dev/null
select test.ok((select (x #>> '{counts,signaturesWaiting}') is not null and jsonb_array_length(x -> 'owners') >= 1 and not (x::text ~ 'Public Client|Sample Prospect')
  from jsonb_array_elements(test.f('service', 'public.owner_summary_due(5000)')) x where x ->> 'tenantId' = test.id('n')::text), 'the owner summary holds counts and the owners'' addresses, and no client name') \g /dev/null
select test.is(test.f('service', 'public.public_links_purge(30)')::text, '0', 'links that just expired are kept for a while') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '40. public endpoints' group by section;
