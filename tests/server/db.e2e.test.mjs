// The database rules of the server range (supabase/migrations/0020 to 0029), tested in SQL, and a test of that test.
//
//   1. tests/server/sql/server_core_test.sql runs inside a transaction that is rolled back: every check raises on failure.
//   2. the same file runs again after one rule was broken on purpose, once per breakage. Each run must FAIL.
//      A breakage the file does not notice would mean the checks have a blind spot.
// Runs on the throwaway local PostgreSQL. Nothing here talks to Supabase.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startPostgres, stopPostgres, root, PORTS, setTestEnv } from './helpers.mjs';

const PSQL = process.env.PSQL || '/usr/lib/postgresql/16/bin/psql';
const file = path.join(root, 'tests/server/sql/server_core_test.sql');

function run(mutation) {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '/tmp/vx-pg-server/sock', '-U', 'supabase_admin', '-d', 'vyntex_server', '-c', 'begin'];
  if (mutation) args.push('-c', mutation);
  args.push('-f', file, '-c', 'rollback');
  const r = spawnSync(PSQL, args, { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
  return { status: r.status, out: r.stdout + r.stderr };
}

before(async () => {
  setTestEnv();
  startPostgres();
  // the stand-in tables for Supabase Auth's sessions and factors come with the test double
  const { startDevSupabase } = await import('../../scripts/dev-supabase.mjs');
  const sb = await startDevSupabase({ port: PORTS.supabase });
  await sb.stop();
});
after(() => { stopPostgres(); });

test('the server range passes its database checks', () => {
  const r = run(null);
  assert.equal(r.status, 0, r.out.split('\n').filter((l) => /FAILED|ERROR/.test(l)).join('\n'));
  const m = /SERVER CORE CHECKS PASSED: (\d+)/.exec(r.out);
  assert.ok(m, 'the summary line is printed');
  assert.ok(Number(m[1]) >= 319, `at least 319 checks ran (${m[1]})`);
  console.log(`# database checks passed: ${m[1]}`);
});

const fn = (signature, body, { definer = true, lang = 'plpgsql', returns = 'void' } = {}) =>
  `create or replace function ${signature} returns ${returns} language ${lang} ${definer ? 'security definer ' : ''}set search_path = '' as $m$ ${body} $m$`;

const BREAKAGES = [
  ['the fresh identity check does nothing', fn('app.require_stepup(p_seconds integer default 300)', 'begin return; end')],
  ['the second sign-in step is never required', fn('app.mfa_needed(p_tenant uuid)', 'select false', { lang: 'sql', returns: 'boolean' })],
  ['revoked sessions are treated as live', fn('app.session_live()', 'select true', { lang: 'sql', returns: 'boolean' })],
  ['the assurance level is always aal2', fn('app.session_aal()', `select 'aal2'`, { lang: 'sql', returns: 'text', definer: false })],
  ['a signed-in person can read the sealed token row', 'grant execute on function public.conn_get(uuid, text) to authenticated'],
  ['a signed-in person can write a connection', 'grant execute on function public.conn_put(uuid, text, jsonb) to authenticated'],
  ['a signed-in person can stamp their own session', 'grant execute on function public.session_stepup_mark(uuid, uuid, text) to authenticated'],
  ['a signed-in person can spend rate limit counters', 'grant execute on function public.rate_hit(text, text, integer, integer) to authenticated'],
  ['the server key can invite a first owner', 'grant execute on function public.invite_bootstrap(uuid, text, integer) to service_role'],
  ['anon can call a server function', 'grant execute on function public.job_claim(text, integer, integer) to anon'],
  ['"connected" needs no proof', 'alter table app.integration_connections drop constraint integration_connections_connected_proof'],
  ['invitations are readable directly', 'grant select on app.invitations to authenticated'],
  ['a server table is not forced under row level security', 'alter table app.jobs no force row level security'],
  ['security events can be deleted', 'drop trigger security_events_append_only on app.security_events'],
  ['secret-looking fields are stored with events', fn('app.safe_meta(p_meta jsonb)', 'select p_meta', { lang: 'sql', returns: 'jsonb', definer: false })],
  ['role changes are not security events', 'drop trigger tenant_members_security_event on public.tenant_members'],
  ['an unverified webhook body can be stored', 'alter table app.webhook_events drop constraint webhook_events_rejected_shape'],
  ['failures never lock', fn('app.lock_fail(p_bucket text, p_key text, p_threshold integer, p_window_seconds integer, p_base_seconds integer, p_max_seconds integer)', `select pg_catalog.jsonb_build_object('locked', false, 'retry_after', 0, 'failures', 0)`, { lang: 'sql', returns: 'jsonb' })],
  ['a raw address is accepted as a rate limit key', 'alter table app.rate_limits drop constraint rate_limits_key_hash_check'],
  ['files can be uploaded into any company folder', `drop policy workspace_files_insert on storage.objects; create policy workspace_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'workspace-files')`],
  ['files of other companies are readable', `drop policy workspace_files_read on storage.objects; create policy workspace_files_read on storage.objects for select to authenticated using (bucket_id = 'workspace-files')`],
  ['an OAuth return address can be any site', 'alter table app.oauth_states drop constraint oauth_states_return_to_check'],
  ['an invitation can be used twice', fn('public.invite_complete(p_token_hash text, p_user uuid, p_name text default null, p_ip_hash text default null)', `begin return pg_catalog.jsonb_build_object('role', (select i.role from app.invitations i where i.token_hash = p_token_hash)); end`, { returns: 'jsonb' })],
  ['a webhook event id can be recorded twice', 'drop index app.webhook_events_event_uidx; create index webhook_events_event_uidx on app.webhook_events (provider, event_id)'],
];

test(`a test of the test: ${BREAKAGES.length} rules broken on purpose are all noticed`, () => {
  const missed = [];
  for (const [what, sql] of BREAKAGES) {
    const r = run(sql);
    if (r.status === 0) { missed.push(what); continue; }
    // the failure must come from a check in the test file, not from the breakage statement itself being wrong
    assert.match(r.out, /server_core_test\.sql:\d+: ERROR:\s+FAILED: /, `${what}: ${r.out.split('\n').find((l) => /ERROR/.test(l))}`);
    if (process.env.VX_SHOW_CAUGHT) console.log(`# caught | ${what} | ${/FAILED: (.*)/.exec(r.out)[1].slice(0, 110)}`);
  }
  assert.deepEqual(missed, [], 'breakages the checks did not notice');
});
