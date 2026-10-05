-- Module tests, part 7: members, exports and the links of the public pages (0039, 0040).
-- Company N for the member changes (so the people of M stay as the other files expect them); M for the office
-- scope of an export.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('39. members, exports, links') \g /dev/null

create or replace function test.role_of(who text, member uuid, role text) returns jsonb language sql as $$
  select test.f(who, format('public.member_set_role(%L, %L, %L)', test.id('n'), member, role))
$$;
create or replace function test.export(who text, p text, kind text) returns jsonb language sql as $$
  select test.f(who, format('public.export_request(%L, %L)', test.id(p), kind))
$$;

-- member_set_role
select test.is(test.role_of('n_owner', test.id('n.m_readonly'), 'staff')::text, '{"word": "stepup_required", "error": "VX403"}', 'member_set_role needs a fresh identity check') \g /dev/null
select test.stepup('n_owner') \g /dev/null
select test.stepup('n_manager') \g /dev/null
select test.is(test.role_of('n_owner', test.id('n.m_readonly'), 'staff') ->> 'role', 'staff', 'freshly confirmed, the owner changes a role, and the answer is the TeamUser') \g /dev/null
select test.ok((select role = 'staff' from public.tenant_members where id = test.id('n.m_readonly')), 'the role is stored') \g /dev/null
select test.is(test.role_of('n_owner', test.id('n.m_readonly'), 'readonly') ->> 'role', 'readonly', 'and changes it back') \g /dev/null
select test.is(test.role_of('n_manager', test.id('n.m_readonly'), 'manager') ->> 'error', '42501', 'a manager of a field edition does not hold "users": no role changes') \g /dev/null
select test.is(test.role_of('n_staff', test.id('n.m_staff'), 'owner') ->> 'error', '42501', 'staff cannot make themselves owner') \g /dev/null
select test.is(test.role_of('b_owner', test.id('n.m_staff'), 'manager') ->> 'error', '42501', 'the owner of another company changes nothing here') \g /dev/null
select test.is(test.role_of('n_owner', test.id('n.m_staff'), 'worker') ->> 'word', 'invalid', 'an office member is not turned into a field worker this way: invalid') \g /dev/null
select test.is(test.role_of('n_owner', test.id('n.m_staff'), 'boss') ->> 'word', 'invalid', 'a role that does not exist: invalid') \g /dev/null
select test.is(test.role_of('n_owner', gen_random_uuid(), 'staff') ->> 'word', 'not_found', 'a member that does not exist: not_found') \g /dev/null
select test.is(test.role_of('n_owner', test.id('m.m_staff'), 'manager') ->> 'word', 'not_found', 'a member of another company does not exist here') \g /dev/null
select test.is(test.role_of('n_owner', test.id('n.m_owner'), 'manager') ->> 'word', 'locked', 'the last owner cannot stop being one: locked') \g /dev/null
select test.ok((select role = 'owner' from public.tenant_members where id = test.id('n.m_owner')) and (select role = 'staff' from public.tenant_members where id = test.id('n.m_staff')), 'none of the refused changes was stored') \g /dev/null

-- member_disable and member_enable
select test.is(test.f('n_owner', format('public.member_disable(%L, %L)', test.id('n'), test.id('n.m_owner'))) ->> 'word', 'locked', 'member_disable: nobody switches themselves off') \g /dev/null
select test.is(test.f('n_manager', format('public.member_disable(%L, %L)', test.id('n'), test.id('n.m_readonly'))) ->> 'error', '42501', 'not for someone without "users"') \g /dev/null
select test.is(test.f('b_owner', format('public.member_disable(%L, %L)', test.id('n'), test.id('n.m_readonly'))) ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.ok(test.f('n_readonly', format('public.ws_load(%L)', test.id('n'))) ? 'users', 'control: before, the read-only member loads the workspace') \g /dev/null
select test.is(test.f('n_owner', format('public.member_disable(%L, %L)', test.id('n'), test.id('n.m_readonly'))) ->> 'active', 'false', 'the owner switches a member off, and the answer is the TeamUser, no longer active') \g /dev/null
select test.ok((select status = 'disabled' and not in_lead_pool from public.tenant_members where id = test.id('n.m_readonly')), 'the member is disabled and out of the lead rotation') \g /dev/null
select test.ok(exists (select 1 from app.session_revocations where user_id = test.id('n_readonly') and reason = 'by_admin' and by_user = test.id('n_owner'))
           and exists (select 1 from app.security_events where tenant_id = test.id('n') and kind = 'session.revoked_by_admin' and user_id = test.id('n_owner')),
  'every session of that person is ended at once, and that is in the security events') \g /dev/null
select test.ok(test.f('n_readonly', format('public.ws_load(%L)', test.id('n'))) ? 'error', 'the person who was switched off no longer loads the workspace') \g /dev/null
select test.is(test.as('n_readonly', 'select 1 from public.clients'), 'rows:0', 'and reads no row directly') \g /dev/null
select test.is(test.f('n_owner', format('public.member_enable(%L, %L)', test.id('n'), test.id('n.m_staff'))) ->> 'word', 'invalid', 'member_enable: a member who is active has nothing to switch on') \g /dev/null
select test.is(coalesce(test.f('n_owner', format('public.member_enable(%L, %L)', test.id('n'), test.id('n.m_readonly'))) ->> 'active', 'true'), 'true', 'the owner lets the person in again') \g /dev/null
select test.ok((select status = 'active' from public.tenant_members where id = test.id('n.m_readonly')), 'the member is active again (and signs in anew: the sessions that were ended stay ended)') \g /dev/null

-- export_request
select test.stepup('n_owner') \g /dev/null
select test.f('n_owner', format('public.vault_set(%L, %L, %L, %L)', test.id('n'), test.id('n.c1'), 'ssn', '123-45-6789')) \g /dev/null
select test.export('n_owner', 'n', 'clients') as x1 \gset
select test.ok(:'x1'::jsonb ->> 'mime' like 'text/csv%' and (:'x1'::jsonb ->> 'rows')::int >= 1 and :'x1'::jsonb ->> 'fileName' like '%clients%' and :'x1'::jsonb ->> 'content' ~ 'Client n',
  'export_request: the owner gets the clients as a CSV file, with its name and its number of rows') \g /dev/null
select test.ok(split_part(:'x1'::jsonb ->> 'content', E'\n', 1) !~* 'tax|ssn|ein|itin|last4' and :'x1'::jsonb ->> 'content' !~ '123-?45-?6789' and :'x1'::jsonb ->> 'content' !~ '6789',
  'the file has no tax ID column: not the number, not its type, not its last four digits') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('n') and action = 'export.clients' and actor = test.id('n_owner') and (new_data ->> 'rows')::int = (:'x1'::jsonb ->> 'rows')::int)
           and exists (select 1 from app.security_events where tenant_id = test.id('n') and kind = 'export.clients' and user_id = test.id('n_owner')),
  'the export is in the audit log and the security events, with the kind and the number of rows') \g /dev/null
do $$
declare k text; r jsonb;
begin
  foreach k in array array['leads', 'jobs', 'tasks', 'payments', 'appointments', 'catalog', 'audit'] loop
    r := test.export('n_owner', 'n', k);
    perform test.ok(r ->> 'mime' like 'text/csv%' and (r ->> 'rows')::int >= 0 and r ->> 'content' !~ '123-?45-?6789' and length(r ->> 'content') > 0, format('the owner exports %s; the file holds no tax ID', k));
  end loop;
end $$;
select test.is(test.export('n_owner', 'n', 'secrets') ->> 'word', 'invalid', 'a kind that does not exist: invalid') \g /dev/null
select test.is(test.export('n_staff', 'n', 'clients') ->> 'error', '42501', 'staff, who do not hold "export", get no file') \g /dev/null
select test.is(test.export('n_readonly', 'n', 'clients')::text, '{"word": "session_revoked", "error": "VX401"}', 'the member who was switched off and on again cannot go on with the old session: it stays ended') \g /dev/null
select test.is(test.export('b_owner', 'n', 'clients') ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.export('anon', 'n', 'clients') ->> 'error', '42501', 'nor the anonymous visitor') \g /dev/null
select test.is(test.export('n_manager', 'n', 'audit') ->> 'error', '42501', 'a manager holds "export" but not "audit": no export of the audit log') \g /dev/null
select test.ok((test.export('n_manager', 'n', 'clients') ->> 'rows')::int >= 1, 'the same manager exports clients') \g /dev/null
select test.stepup_stale('n_owner') \g /dev/null
select test.is(test.export('n_owner', 'n', 'clients') ->> 'error', 'VX403', 'an export needs a fresh identity check') \g /dev/null
-- the office scope decides what is in the file
insert into public.clients (id, tenant_id, name, office_id) values (test.u(7001), test.id('m'), 'Export Scope Client Of The Second Office', test.id('m.o2'));
select test.stepup('m_owner') \g /dev/null
select test.stepup('m_manager') \g /dev/null
select test.ok(test.export('m_owner', 'm', 'clients') ->> 'content' ~ 'Export Scope Client Of The Second Office', 'control: the owner''s export holds the client of the second office') \g /dev/null
select test.ok(test.export('m_manager', 'm', 'clients') ->> 'content' !~ 'Export Scope Client Of The Second Office' and (test.export('m_manager', 'm', 'clients') ->> 'rows')::int >= 1,
  'the export of a senior associate who cannot open that client does not hold it') \g /dev/null

-- links for the public pages (server only)
select test.is(test.as('n_owner', format($q$select public.link_issue(%L, 'review', %L, %L)$q$, test.id('n'), test.id('n.review_draft'), repeat('a', 64))), 'error:42501', 'link_issue is the server''s: a person cannot issue a link') \g /dev/null
select test.is(test.as('anon', format($q$select public.link_peek('review', %L)$q$, repeat('a', 64))), 'error:42501', 'and the anonymous visitor cannot look one up directly') \g /dev/null
select test.login('service') \g /dev/null
select public.link_issue(test.id('n'), 'review', test.id('n.review_draft'), encode(sha256('first-token'::bytea), 'hex')) as l1 \gset
select public.link_peek('review', encode(sha256('first-token'::bytea), 'hex')) as peek1 \gset
select coalesce(public.link_peek('sign', encode(sha256('first-token'::bytea), 'hex'))::text, 'null') as peek_other \gset
select coalesce(public.link_peek('review', encode(sha256('wrong-token'::bytea), 'hex'))::text, 'null') as peek_wrong \gset
select public.link_issue(test.id('n'), 'review', test.id('n.review_draft'), encode(sha256('second-token'::bytea), 'hex')) as l2 \gset
select coalesce(public.link_peek('review', encode(sha256('first-token'::bytea), 'hex'))::text, 'null') as peek_replaced \gset
select public.link_use('review', encode(sha256('second-token'::bytea), 'hex')) as use1 \gset
select coalesce(public.link_use('review', encode(sha256('second-token'::bytea), 'hex'))::text, 'null') as use2 \gset
select public.link_issue(test.id('n'), 'sign', test.id('n.signer_draft'), encode(sha256('sign-token'::bytea), 'hex'), 1) as l3 \gset
select public.link_revoke(test.id('n'), 'sign', test.id('n.signer_draft')) as revoked \gset
select coalesce(public.link_peek('sign', encode(sha256('sign-token'::bytea), 'hex'))::text, 'null') as peek_revoked \gset
select test.logout() \g /dev/null
select test.ok(:'peek1'::jsonb ->> 'reviewId' = test.id('n.review_draft')::text and :'peek1'::jsonb ->> 'tenantId' = test.id('n')::text and :'peek1'::jsonb ->> 'purpose' = 'review',
  'the server issues a link for a review request and finds it again by the hash of its token') \g /dev/null
select test.is(:'peek_other' || '/' || :'peek_wrong', 'null/null', 'single purpose: the same token presented for signing is not found; nor is a wrong token') \g /dev/null
select test.is(:'peek_replaced', 'null', 'one live link per target: issuing a new one revokes the earlier one') \g /dev/null
select test.ok(:'use1'::jsonb ->> 'reviewId' = test.id('n.review_draft')::text and :'use2' = 'null', 'single use: a link is used once, and not found a second time') \g /dev/null
select test.ok(:revoked = 1 and :'peek_revoked' = 'null', 'a revoked link is not found') \g /dev/null
select test.ok((select bool_and(token_hash ~ '^[0-9a-f]{64}$') and count(*) = 3 from app.public_links where tenant_id = test.id('n')) and test.find_text('first-token|second-token|sign-token') = '',
  'only the hash of a token is stored: the tokens themselves are in no column of any table') \g /dev/null
update app.public_links set expires_at = created_at + interval '1 microsecond' where id = :'l3';
select test.is(test.as('service', format($q$select public.link_issue(%L, 'sign', %L, 'not-a-hash')$q$, test.id('n'), test.id('n.signer_draft'))), 'error:22023', 'a link is issued with the hash of a token, never the token') \g /dev/null
select test.is(test.as('service', format($q$select public.link_issue(%L, 'sign', %L, %L)$q$, test.id('n'), test.id('m.signer_draft'), repeat('b', 64))), 'error:P0001', 'and not for a signer of another company') \g /dev/null
select test.is(test.as('service', 'select 1 from app.public_links'), 'error:42501', 'the table itself is closed, to the server key too') \g /dev/null

-- the search again, now that an export ran with a number on file
select test.is(test.find_text('123-?45-?6789'), '', 'after the exports: the planted number is still in no text of any table') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '39. members, exports, links' group by section;
