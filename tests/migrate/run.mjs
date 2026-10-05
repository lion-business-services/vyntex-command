// End-to-end proof of the NOVA to LBS migration tool, on generated data only.
//
//   node tests/migrate/run.mjs            (npm run test:migrate)
//
// What it does, on a throwaway local PostgreSQL (PGTEST_DIR, default /tmp/vx-pg-migrate; no network port):
//   1. builds a copy of the NOVA schema from NOVA's own schema files and fills it with a generated, fictional data
//      set (generate-source.sql). NOVA's customer import files are never opened: see SKIPPED below;
//   2. builds the target from this platform's migrations with one "practice" company;
//   3. makes a real encrypted backup of the fictional source with scripts/backup/backup.sh;
//   4. runs every stage of tools/migrate-nova as its own process, the way an operator would, and checks the result.
// Nothing here connects to NOVA or to any Supabase project.
//
// Settings: PGBIN, PGTEST_DIR, PGTEST_USER (as in supabase/tests/run_local.sh), NOVA_REPO (folder of the NOVA code,
// default /home/claude/nova/nova-crm-main), KEEP=1 to leave the server running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const here = path.join(root, 'tests', 'migrate');
const tool = path.join(root, 'tools', 'migrate-nova');
const PGBIN = process.env.PGBIN || '/usr/lib/postgresql/16/bin';
const dir = process.env.PGTEST_DIR || '/tmp/vx-pg-migrate';
const sock = path.join(dir, 'sock'); const data = path.join(dir, 'data');
const osUser = process.env.PGTEST_USER || 'postgres';
const novaRepo = process.env.NOVA_REPO || '/home/claude/nova/nova-crm-main';
const reports = path.join(dir, 'reports'); const backups = path.join(dir, 'backups');
// NOVA files that hold or describe real customers. Never read, never run. 0015 is replaced by its six column
// definitions (source-0015-schema-only.sql, written from the audit's description).
const SKIPPED = /^(0015_|0018_|_combined)/;

let passed = 0; const failures = []; const timings = {};
const ok = (cond, what) => { if (cond) { passed += 1; console.log(`  ok   ${what}`); } else { failures.push(what); console.log(`  FAIL ${what}`); } };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
const asServer = (args) => (process.getuid && process.getuid() === 0 ? sh('runuser', ['-u', osUser, '--', ...args]) : sh(args[0], args.slice(1)));
function psql(db, sql, { role = 'supabase_admin', file } = {}) {
  const r = sh(path.join(PGBIN, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', role, '-d', db, ...(file ? ['-f', file] : ['-f', '-'])],
    { input: file ? undefined : sql, env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning -c timezone=UTC' } });
  if (r.status !== 0) throw new Error(`psql failed on ${db}: ${r.stderr.split('\n').slice(0, 4).join(' | ')}`);
  return r.stdout.trim();
}
const timed = async (name, fn) => { const t = Date.now(); const r = await fn(); timings[name] = Date.now() - t; return r; };

// ---------------------------------------------------------------------------------------------------------------------
console.log(`== throwaway PostgreSQL in ${dir}`);
if (fs.existsSync(path.join(data, 'postmaster.pid'))) asServer([path.join(PGBIN, 'pg_ctl'), '-D', data, '-m', 'fast', '-w', 'stop']);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(sock, { recursive: true });
if (process.getuid && process.getuid() === 0) sh('chown', ['-R', osUser, dir]);
fs.chmodSync(dir, 0o755); fs.chmodSync(sock, 0o755);
let r = asServer([path.join(PGBIN, 'initdb'), '-D', data, '-U', 'supabase_admin', '--auth=trust', '--encoding=UTF8', '--locale=C']);
if (r.status !== 0) throw new Error(`initdb failed: ${r.stderr}`);
r = asServer([path.join(PGBIN, 'pg_ctl'), '-D', data, '-l', path.join(dir, 'server.log'), '-w', '-o', `-c listen_addresses='' -c unix_socket_directories='${sock}' -c fsync=off`, 'start']);
if (r.status !== 0) throw new Error(`the server did not start: ${r.stderr}`);
const stop = () => { if (process.env.KEEP !== '1') asServer([path.join(PGBIN, 'pg_ctl'), '-D', data, '-m', 'fast', '-w', 'stop']); };
process.on('exit', stop);

await timed('build source', () => {
  console.log('== source: the NOVA schema, with generated fictional data');
  psql('postgres', 'create database nova_source');
  psql('nova_source', null, { file: path.join(here, 'source-standins.sql') });
  const migs = fs.readdirSync(path.join(novaRepo, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of migs) {
    if (SKIPPED.test(f)) continue;
    // The one line that asks for Supabase's Vault extension is left out: a stand-in schema takes its place.
    const sql = fs.readFileSync(path.join(novaRepo, 'supabase', 'migrations', f), 'utf8').split('\n').filter((l) => !/create extension.*supabase_vault/i.test(l)).join('\n');
    psql('nova_source', sql);
    applied.push(f);
    if (f.startsWith('0014_')) psql('nova_source', null, { file: path.join(here, 'source-0015-schema-only.sql') });
  }
  ok(!applied.some((f) => SKIPPED.test(f)) && applied.length === migs.filter((f) => !SKIPPED.test(f)).length, `NOVA schema built from ${applied.length} files; the customer import files were not opened`);
  psql('nova_source', null, { file: path.join(here, 'generate-source.sql') });
  // two roles for the source: the one the operator is told to create (read only), and one that may write
  psql('nova_source', `
    create role nova_migration_ro login bypassrls; grant usage on schema public to nova_migration_ro; grant select on all tables in schema public to nova_migration_ro;
    create role nova_writer login bypassrls; grant usage on schema public to nova_writer; grant select, insert, update, delete on all tables in schema public to nova_writer;`);
});
const srcCount = (t) => Number(psql('nova_source', `select count(*) from public.${t}`));
const shape = JSON.parse(psql('nova_source', `select jsonb_build_object('tables', (select count(*) from pg_tables where schemaname = 'public'),
  'clients', (select count(*) from clients), 'square', (select count(*) from clients where source = 'square'), 'noOffice', (select count(*) from clients where office_id is null),
  'services', (select count(*) from services), 'sampleServices', (select count(*) from services where source = 'legacy'), 'tiers', (select count(*) from service_variations),
  'apptTypes', (select count(*) from appointment_types), 'staff', (select count(*) from profiles), 'offices', (select count(*) from offices),
  'leads', (select count(*) from clients where lifecycle_stage = 'lead'), 'taxIds', (select count(*) from clients where tax_id is not null or tax_id_vault_secret_id is not null or tax_id_last4 is not null))`));
console.log(`   source shape: ${JSON.stringify(shape)}`);
ok(shape.tables === 31 && shape.services === 153 && shape.sampleServices === 5 && shape.tiers === 244 && shape.apptTypes === 11 && shape.staff === 2 && shape.offices === 1 && shape.taxIds === 0,
  '31 tables, 153 services (5 samples), 244 tiers, 11 appointment types, 2 staff, 1 office, no tax ID');

await timed('build target', () => {
  console.log('== target: this platform, one practice company');
  psql('postgres', 'create database lbs_target');
  psql('lbs_target', null, { file: path.join(root, 'supabase', 'tests', 'setup_local.sql') });
  for (const f of fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) psql('lbs_target', null, { role: 'postgres', file: path.join(root, 'supabase', 'migrations', f) });
  psql('lbs_target', null, { role: 'postgres', file: path.join(root, 'supabase', 'seed.sql') });
  // On Supabase the role "postgres" is a member of service_role. The local stand-in has to be told.
  psql('lbs_target', `grant service_role to postgres;
    insert into public.tenants (id, slug, name, industry_id, plan_id, status) values ('00000000-0000-4000-8000-00000000aaaa', 'lbs-proof', 'Practice Proof Company', 'practice', 'builder', 'active');
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'duena.ficticia@equipo-ficticio.invalid'), ('00000000-0000-4000-8000-0000000000a2', 'otra.persona@equipo-ficticio.invalid');
    insert into public.tenant_members (tenant_id, user_id, role, name, email) values
      ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a1', 'owner', 'Dueña Ficticia', 'Duena.Ficticia@equipo-ficticio.invalid'),
      ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a2', 'staff', 'Otra Persona', 'otra.persona@equipo-ficticio.invalid');
    -- one client that is already in the new platform and is also in NOVA (same email as generated client 100), and a second company
    insert into public.clients (tenant_id, name, email, phone) values ('00000000-0000-4000-8000-00000000aaaa', 'Ya Existe Ficticio', 'PERSONA100@correo-ficticio.invalid', '');
    insert into public.tenants (id, slug, name, industry_id, plan_id, status) values ('00000000-0000-4000-8000-00000000bbbb', 'other-proof', 'Other Proof Company', 'practice', 'builder', 'active');
    insert into public.clients (tenant_id, name, email) values ('00000000-0000-4000-8000-00000000bbbb', 'Otra Empresa Ficticia', 'persona101@correo-ficticio.invalid');`);
});

// ---- fingerprints ----
const sourceFingerprint = () => psql('nova_source', `select string_agg(format('%s:%s:%s', c.relname,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text,
    (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) as h from public.%I t', c.relname), false, true, '')))[1]::text), E'\n' order by c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public') and c.relkind = 'r'`);
const targetFingerprint = () => Object.fromEntries(psql('lbs_target', `select format('%s:%s:%s', c.relname,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text,
    (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) as h from public.%I t', c.relname), false, true, '')))[1]::text)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`).split('\n').map((l) => { const [t, n, h] = l.split(':'); return [t, `${n}:${h}`]; }));
const sameExceptAudit = (a, b) => Object.keys(a).filter((t) => t !== 'audit_log' && a[t] !== b[t]);
const source0 = sourceFingerprint();
const target0 = targetFingerprint();

// ---- an encrypted backup of the (fictional) source, made by the real backup script ----
fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
const keyFile = path.join(dir, 'age.key');
sh('age-keygen', ['-o', keyFile]);
const recipient = /public key: (age1\S+)/.exec(fs.readFileSync(keyFile, 'utf8'))?.[1] || sh('age-keygen', ['-y', keyFile]).stdout.trim();
r = sh('bash', [path.join(root, 'scripts', 'backup', 'backup.sh')], { env: { ...process.env, BACKUP_LABEL: 'nova-proof', BACKUP_DIR: backups, BACKUP_AGE_RECIPIENT: recipient, PGBIN, PGHOST: sock, PGUSER: 'supabase_admin', PGDATABASE: 'nova_source', BACKUP_SCHEMAS: 'public' } });
const backupFile = fs.readdirSync(backups).filter((f) => f.endsWith('.dump.age')).map((f) => path.join(backups, f))[0];
ok(r.status === 0 && backupFile, 'scripts/backup/backup.sh made an encrypted backup of the source');
const backupSum = fs.readFileSync(`${backupFile}.sha256`, 'utf8').trim().split(/\s+/)[0];

// ---- running the stages the way an operator does ----
const baseEnv = (sourceRole = 'nova_migration_ro') => ({
  ...process.env, PGBIN, MIGRATE_REPORT_DIR: reports, MIGRATE_BACKUP_FILE: backupFile, LBS_TENANT_SLUG: 'lbs-proof', MIGRATE_BATCH_SIZE: '150',
  NOVA_PGHOST: sock, NOVA_PGUSER: sourceRole, NOVA_PGDATABASE: 'nova_source', LBS_PGHOST: sock, LBS_PGUSER: 'postgres', LBS_PGDATABASE: 'lbs_target',
});
let allOutput = '';
function stage(name, args = [], env = baseEnv()) {
  const t = Date.now();
  const res = sh(process.execPath, [path.join(tool, `${name}.mjs`), ...args], { env });
  timings[name] = (timings[name] || 0) + (Date.now() - t);
  allOutput += res.stdout + res.stderr;
  const last = res.stdout.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).pop() || {};
  return { code: res.status, out: res.stdout, err: res.stderr, last };
}
const tq = (sql) => psql('lbs_target', sql);
const TENANT = '00000000-0000-4000-8000-00000000aaaa';

console.log('== safety: the source cannot be written');
let s = stage('00-preflight', [], baseEnv('nova_writer'));
ok(s.code === 1 && /may change \d+ NOVA table/.test(s.err), 'preflight refuses a source role that may write');
{
  const { connEnv } = await import(path.join(tool, 'lib.mjs'));
  const src = await import(path.join(tool, 'source.mjs'));
  Object.assign(process.env, { NOVA_PGHOST: sock, NOVA_PGUSER: 'nova_writer', NOVA_PGDATABASE: 'nova_source', PGBIN });
  for (const bad of ["update public.clients set notes = 'x'", 'delete from public.clients', "select 1; delete from public.clients", "with x as (delete from public.clients returning 1) select count(*) from x",
    "copy public.clients from stdin", "select nextval('s')", 'truncate public.clients', 'select * into copia from public.clients']) {
    let refused = false; try { src.assertReadOnlySql(bad); } catch { refused = true; }
    ok(refused, `source guard refuses: ${bad.slice(0, 44)}`);
  }
  let through = true; try { src.assertReadOnlySql('select count(*) from public.clients'); src.assertReadOnlySql('copy (select id, updated_at, created_by from public.clients order by id) to stdout'); } catch { through = false; }
  ok(through, 'source guard lets SELECT and COPY (SELECT) TO STDOUT through');
  // Below the guard: the same session settings the tool uses, with a role that IS allowed to write, sent straight to PostgreSQL.
  const opts = /const READ_ONLY_OPTIONS = '([^']+)'/.exec(fs.readFileSync(path.join(tool, 'source.mjs'), 'utf8'))[1];
  const direct = (sql) => sh(path.join(PGBIN, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: connEnv('NOVA', opts), input: sql });
  const w1 = direct("update public.clients set notes = 'changed' where true;");
  ok(w1.status !== 0 && /read-only transaction/.test(w1.stderr), 'PostgreSQL refuses UPDATE in the tool\'s source session even for a role that may write');
  const w2 = direct("begin transaction isolation level repeatable read read only; delete from public.clients; commit;");
  ok(w2.status !== 0 && /read-only transaction/.test(w2.stderr), 'and DELETE inside the read-only transaction');
  const w3 = sh(path.join(PGBIN, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'nova_writer', '-d', 'nova_source', '-c', "begin; update public.clients set notes = notes where false; rollback;"]);
  ok(w3.status === 0, '(control: without those settings the same role can write, so the refusal comes from the guard)');
  for (const k of ['NOVA_PGHOST', 'NOVA_PGUSER', 'NOVA_PGDATABASE']) delete process.env[k];
}
{ // static: only source.mjs connects to the source, and every statement handed to it is a read
  const files = fs.readdirSync(tool).filter((f) => f.endsWith('.mjs'));
  const connects = files.filter((f) => /connEnv\(\s*'NOVA'/.test(fs.readFileSync(path.join(tool, f), 'utf8')));
  ok(connects.length === 1 && connects[0] === 'source.mjs', 'only source.mjs opens a connection to the source');
  const calls = [];
  for (const f of files.filter((x) => x !== 'source.mjs')) {
    const text = fs.readFileSync(path.join(tool, f), 'utf8');
    if (!/from '\.\/source\.mjs'/.test(text)) continue;
    for (const m of text.matchAll(/(?<![.\w])(read|readJson|copyOut)\(\s*([`'"]?)\s*([A-Za-z_]+)/g)) calls.push({ f, first: m[3].toLowerCase(), literal: m[2] !== '' });
  }
  const wrong = calls.filter((c) => (c.literal ? c.first !== 'select' : !['checksumsql', 'selectfor'].includes(c.first)));
  ok(calls.length >= 5 && wrong.length === 0, `every one of the ${calls.length} statements sent to the source is a SELECT (static check)`);
  ok(!/source\.mjs/.test(fs.readFileSync(path.join(tool, '70-rollback.mjs'), 'utf8').replace(/\/\/.*$/gm, '')) && !/source\.mjs/.test(fs.readFileSync(path.join(tool, '50-apply.mjs'), 'utf8').replace(/\/\/.*$/gm, '')),
    'apply and rollback do not load the source module at all');
  // tax IDs: the only mentions of client_secrets are a privilege check and comments; the tax columns are never selected
  const mentions = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : mentions.push(...fs.readFileSync(path.join(d, e.name), 'utf8').split('\n')
    .filter((l) => /client_secrets/.test(l) && !/^\s*(\/\/|--|\*)/.test(l)).map((l) => l.trim()))));
  walk(tool);
  ok(mentions.length > 0 && mentions.every((l) => /has_table_privilege\('service_role', 'public\.client_secrets'/.test(l) || /refuse\(/.test(l)), 'the tool never reads or writes client_secrets (its only mention is a privilege check)');
  const tables = fs.readFileSync(path.join(tool, 'source-tables.mjs'), 'utf8');
  const carried = tables.slice(tables.indexOf('export const CARRIED'), tables.indexOf('export const COUNTED'));
  ok(!/tax_id/.test(carried), 'no tax ID column is in the list of columns read from NOVA');
}

console.log('== 00 preflight');
s = stage('00-preflight', [], { ...baseEnv(), MIGRATE_BACKUP_FILE: path.join(backups, 'missing.dump.age') });
ok(s.code === 1 && /backup/i.test(s.err), 'preflight refuses without a backup file');
fs.writeFileSync(path.join(backups, 'plain.dump.age'), 'PGDMP not encrypted'); fs.writeFileSync(path.join(backups, 'plain.dump.age.sha256'), 'x  plain.dump.age\n');
s = stage('00-preflight', [], { ...baseEnv(), MIGRATE_BACKUP_FILE: path.join(backups, 'plain.dump.age') });
ok(s.code === 1 && /not an age-encrypted/.test(s.err), 'preflight refuses a backup that is not encrypted');
fs.copyFileSync(backupFile, path.join(backups, 'tampered.dump.age')); fs.appendFileSync(path.join(backups, 'tampered.dump.age'), 'x'); fs.copyFileSync(`${backupFile}.sha256`, path.join(backups, 'tampered.dump.age.sha256'));
s = stage('00-preflight', [], { ...baseEnv(), MIGRATE_BACKUP_FILE: path.join(backups, 'tampered.dump.age') });
ok(s.code === 1 && /does not match its recorded checksum/.test(s.err), 'preflight refuses a backup whose checksum does not match');
psql('nova_source', 'create role nova_blind login; grant usage on schema public to nova_blind; grant select on all tables in schema public to nova_blind;');
s = stage('00-preflight', [], baseEnv('nova_blind'));
ok(s.code === 1 && /Row level security would hide/.test(s.err), 'preflight refuses a read-only role that row level security would blind');
s = stage('00-preflight');
ok(s.code === 0 && fs.existsSync(path.join(reports, '00-preflight.md')), 'preflight passes with the read-only role and writes its report');

console.log('== 10 extract, 20 map, 30 validate');
s = stage('10-extract');
ok(s.code === 0 && s.last.tables === 12, `extract copied 12 tables, ${s.last.rows} rows, each compared with the source by checksum`);
const batch = s.last.batch;
ok(Number(tq('select count(*) from migrate.src_clients')) === shape.clients, `staged clients = source clients (${shape.clients})`);
ok(tq(`select count(*) from information_schema.columns where table_schema = 'migrate' and column_name like 'tax_id%'`) === '0', 'no tax ID column exists in staging');
s = stage('20-map');
ok(s.code === 0 && s.last.staffMatched === 1 && s.last.unmappedSources === 1 && s.last.unmappedStages === 0, 'map: 1 of 2 staff matched by email, 1 unmapped lead source reported, every lead stage mapped');
s = stage('30-validate');
ok(s.code === 0, 'validate ran');
const outcomes = () => Object.fromEntries(tq(`select entity || '.' || outcome || '=' || count(*) from migrate.outcomes where batch_id = '${batch}' group by entity, outcome order by 1`).split('\n').map((l) => l.split('=')).map(([k, v]) => [k, Number(v)]));
let o = outcomes();
console.log(`   outcomes: ${JSON.stringify(o)}`);
const reason = (entity, like) => Number(tq(`select count(*) from migrate.outcomes where batch_id = '${batch}' and entity = '${entity}' and reason like '${like}'`));
ok(o['service.skipped'] === 5 && o['service.created'] === 148 && reason('service', 'sample:listed_legacy_service') === 5, 'the 5 sample services are skipped by the listed rule, 148 will be created');
ok(o['tier.created'] === 244, '244 price tiers will be created');
ok(o['appointment_type.created'] === 11, '11 appointment types will be created');
ok(reason('lead', 'sample:%') === 1 && o['lead.created'] === 6, 'the sample lead is skipped; 4 open leads and 2 closed leads (history of converted clients) will be created');
ok(reason('client', 'sample:listed_id') === 2 && reason('client', 'sample:name_word:%') === 2 && reason('client', 'sample:email_domain:%') === 1, 'sample clients: 2 by listed id, 2 by a test word, 1 by an example address');
ok(reason('client', 'same_email%') === 13 && reason('client', 'same_email:names_differ') === 6 && reason('client', 'same_phone%') === 6 && reason('client', 'same_name_and_address') === 4,
  'duplicates: 12 by email inside NOVA (6 with another name) + 1 against a client already in the target, 6 by telephone, 4 by name and address');
ok(tq(`select matched_kind || ':' || (matched_id = (select id::text from public.clients where name = 'Ya Existe Ficticio')) from migrate.outcomes where batch_id = '${batch}' and entity = 'client' and source_id = '55555555-0000-0000-0000-000000000100'`) === 'target:true',
  'the duplicate against the target names the matched record');
ok(tq(`select outcome from migrate.outcomes where batch_id = '${batch}' and entity = 'client' and source_id = '55555555-0000-0000-0000-000000000101'`) === 'created', 'a client with the same email in ANOTHER company is not a duplicate');
ok(Number(tq(`select count(*) from migrate.outcomes where batch_id = '${batch}' and entity = 'client' and outcome = 'invalid' and field = 'email'`)) === 9
  && Number(tq(`select count(*) from migrate.outcomes where batch_id = '${batch}' and entity = 'client' and outcome = 'invalid' and field = 'name'`)) === 3
  && Number(tq(`select count(*) from migrate.outcomes where batch_id = '${batch}' and entity = 'client' and outcome = 'invalid' and field = 'phone'`)) === 2, 'invalid: 9 by email, 3 without any name, 2 by telephone, each naming the field');
ok(o['client.needs_review'] === 3 && o['staff.needs_review'] === 1 && o['invoice.needs_review'] === 2 && o['payment.needs_review'] === 1 && o['invoice.skipped'] === 6 && o['payment.skipped'] === 4,
  'needs review: 3 clients marked in NOVA, 1 staff without a member, 2 invoices and 1 payment of real-shaped clients; the demo firm\'s 6 invoices and 4 payments are skipped');
ok(Number(tq(`select count(*) from (select source_id from migrate.outcomes where batch_id = '${batch}' and entity = 'client' group by 1 having count(*) <> 1) x`)) === 0
  && Number(tq(`select count(*) from migrate.outcomes where batch_id = '${batch}' and entity = 'client'`)) === Number(tq('select count(*) from migrate.map_clients')), 'every client has exactly one outcome');

console.log('== 40 dry run');
const targetBeforeDry = targetFingerprint();
s = stage('40-dry-run');
const token1 = /APPROVAL TOKEN: ([0-9a-f]{64})/.exec(s.out)?.[1];
ok(s.code === 0 && token1, 'dry run produced the report and an approval token');
ok(sameExceptAudit(targetBeforeDry, targetFingerprint()).length === 0 && targetBeforeDry.audit_log === targetFingerprint().audit_log && tq(`select count(*) from migrate.id_map`) === '0', 'the dry run left the target exactly as it was (audit log included)');
for (const f of ['40-dry-run.md', '40-dry-run-totals.csv', '40-dry-run-counts.csv', '40-dry-run-samples.csv', '40-needs-review.csv']) ok(fs.existsSync(path.join(reports, f)), `report file ${f}`);
const mode = (f) => (fs.statSync(path.join(reports, f)).mode & 0o777).toString(8);
ok(mode('40-needs-review.csv') === '600' && mode('.') === '700', 'the needs-review file is readable by its owner only (600), in a folder only the owner can open (700)');
const md1 = fs.readFileSync(path.join(reports, '40-dry-run.md'), 'utf8');
ok((md1.match(/^### /gm) || []).length === 8 && !/\| NO \|/.test(md1), 'the report has samples for 8 kinds of record and every count comparison matches');

console.log('== 50 apply: refusals');
const applyArgs = (t, who = 'Aprobadora Ficticia', sum = backupSum) => ['--approve', t, '--approver', who, '--backup-sha256', sum];
ok(stage('50-apply').code === 1, 'apply refuses without a token');
ok(stage('50-apply', applyArgs('0'.repeat(64))).code === 1, 'apply refuses a token that is not the dry run\'s');
ok(stage('50-apply', ['--approve', token1, '--backup-sha256', backupSum]).code === 1, 'apply refuses without a named approver');
ok(stage('50-apply', applyArgs(token1, 'Aprobadora Ficticia', 'f'.repeat(64))).code === 1, 'apply refuses a backup checksum that is not the batch\'s');
ok(tq('select count(*) from migrate.id_map') === '0', 'nothing was loaded by the refused attempts');

console.log('== decisions: the owner answers, the plan changes, the old approval is void');
const review = fs.readFileSync(path.join(reports, '40-needs-review.csv'), 'utf8');
const answers = path.join(dir, 'answers.csv');
fs.writeFileSync(answers, ['entity,source_id,decision',
  'client,55555555-0000-0000-0000-000000000301,load',           // relatives who share an email: keep both
  'client,55555555-0000-0000-0000-000000000302,skip',
  'client,55555555-0000-0000-0000-000000000401,load_without_field', // a mail address that cannot be one: load without it
  'client,55555555-0000-0000-0000-000000000190,load',           // marked for review in NOVA: a real client
  'staff,11111111-0000-0000-0000-000000000002,load', ''].join('\n'), { mode: 0o600 });
ok(stage('30-validate', ['--decisions', answers]).code === 1, 'answers are refused without the name of the person who gave them');
s = stage('30-validate', ['--decisions', answers, '--decided-by', 'Dueña Ficticia']);
const o2 = outcomes();
ok(s.code === 0 && o2['client.created'] === o['client.created'] + 3 && (o2['staff.needs_review'] || 0) === 0, 'three more clients will be created after the answers (one duplicate kept on purpose, one without its bad email, one reviewed)');
ok(stage('50-apply', applyArgs(token1)).code === 1 && tq('select count(*) from migrate.id_map') === '0', 'the approval of the earlier report no longer opens the load');
s = stage('40-dry-run');
const token = /APPROVAL TOKEN: ([0-9a-f]{64})/.exec(s.out)?.[1];
ok(s.code === 0 && token && token !== token1, 'a new dry run gives a new token');
o = o2;

console.log('== 50 apply, twice');
const beforeApply = targetFingerprint();
const auditBefore = Number(beforeApply.audit_log.split(':')[0]);
s = stage('50-apply', applyArgs(token));
ok(s.code === 0, `apply inserted ${s.last.inserted} rows in batches of 150`);
const inserted = s.last.inserted;
const tcount = (t) => Number(tq(`select count(*) from public.${t} where tenant_id = '${TENANT}'`));
const created = (...ents) => ents.reduce((n, e) => n + (o[`${e}.created`] || 0), 0);
ok(tcount('clients') === 1 + created('client') && tcount('catalog_services') === 148 && tcount('catalog_tiers') === 244 && tcount('appointment_types') === 11 && tcount('offices') === 1
  && tcount('leads') === 6 && tcount('client_people') === created('client_owner', 'client_contact') && tcount('lead_handoffs') === created('handoff')
  && tcount('notes') === created('client_note', 'lead_note', 'comment', 'lead_contact') && tcount('activity') === created('lead_activity'),
  `target counts: ${tcount('clients')} clients, 148 services, 244 tiers, 11 appointment types, 1 office, ${tcount('leads')} leads, ${tcount('client_people')} people, ${tcount('lead_handoffs')} handoffs, ${tcount('notes')} notes, ${tcount('activity')} timeline entries`);
ok(Number(tq(`select count(*) from public.clients where tenant_id = '00000000-0000-4000-8000-00000000bbbb'`)) === 1, 'the other company was not touched');
ok(tq(`select count(*) from public.client_secrets`) === '0' && tq(`select count(*) from public.clients where tax_id_type is not null or tax_id_last4 is not null`) === '0', 'no tax ID anywhere in the target after the load');
ok(tq(`select to_char(h.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || '|' || h.by_kind || '|' || (h.by_member_id is not null) from public.lead_handoffs h join migrate.id_map i on i.target_id = h.id where i.source_id = '88888888-0000-0000-0000-000000000003'`) === '2026-02-08 09:30|member|true',
  'a handoff keeps its original moment and the member who made it');
ok(tq(`select to_char(a.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || '|' || a.kind || '|' || (a.params ->> 'to') from public.activity a join migrate.id_map i on i.target_id = a.id where i.source_id = '99999999-0000-0000-0000-000000000006'`) === '2026-02-12 12:00|lead.stage|proposal',
  'a stage change keeps its original moment and is mapped to the company\'s stage id');
ok(tq(`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') || '|' || (external_ids ->> 'square') || '|' || lang || '|' || (office_id is null) from public.clients c join migrate.id_map i on i.target_id = c.id where i.source_id = '55555555-0000-0000-0000-000000000007'`) === '2026-03-10|SQFICT0000000007|es|true',
  'a client keeps its creation date, its Square customer id (external_ids.square) and its language, and stays without an office');
ok(tq(`select name from public.clients c join migrate.id_map i on i.target_id = c.id where i.source_id = '55555555-0000-0000-0000-000000000097'`) === '虚构 李 97'
  && tq(`select name from public.clients c join migrate.id_map i on i.target_id = c.id where i.source_id = '55555555-0000-0000-0000-000000000043'`) === "Zoë O'Inventado 43", 'Unicode names and apostrophes arrive unchanged');
ok(Number(tq(`select count(*) from public.clients c join migrate.id_map i on i.target_id = c.id and i.entity = 'client' where c.office_id is null`)) === created('client') - 3, `${created('client') - 3} clients arrive without an office, 3 with the mapped office`);
ok(tq(`select email from public.clients c join migrate.id_map i on i.target_id = c.id where i.source_id = '55555555-0000-0000-0000-000000000401'`) === '', 'the client loaded "without the field" has an empty email');
const afterApply = targetFingerprint();
s = stage('50-apply', applyArgs(token));
ok(s.code === 0 && s.last.inserted === 0, 'running apply again inserts nothing');
const afterSecond = targetFingerprint();
ok(sameExceptAudit(afterApply, afterSecond).length === 0 && afterApply.audit_log === afterSecond.audit_log, 'and leaves every table, the audit log included, exactly as it was');

console.log('== 60 reconcile');
s = stage('60-reconcile');
ok(s.code === 0 && s.last.equal === true, `reconcile: equal (${fs.readFileSync(path.join(reports, '60-reconcile.md'), 'utf8').match(/Critical samples[^\n]+/)?.[0] || ''})`);
tq(`update public.clients set name = name || ' (editado)' where id = (select target_id from migrate.id_map where entity = 'client' order by source_id limit 1)`);
s = stage('60-reconcile');
ok(s.code === 1 && s.last.equal === false && /client: 1 loaded row\(s\) differ from the mapping in: name, updated_at/.test(fs.readFileSync(path.join(reports, '60-reconcile.md'), 'utf8')), 'reconcile notices one changed name, exits 1 and lists it as an unresolved difference');

console.log('== 70 rollback');
ok(stage('70-rollback', ['--batch', batch]).code === 1, 'rollback refuses without the confirmation phrase');
s = stage('70-rollback', ['--batch', batch, '--confirm', 'REMOVE THIS IMPORT']);
ok(s.code === 1 && /1 imported record\(s\) were changed by people/.test(s.err) && tcount('clients') === 1 + created('client'), 'rollback refuses when a person changed an imported record, and removes nothing');
tq(`alter table public.clients disable trigger clients_touch; update public.clients c set name = m.name, updated_at = m.updated_at from migrate.id_map i join migrate.map_clients m on m.source_id = i.source_id where i.entity = 'client' and c.id = i.target_id and c.name like '% (editado)'; alter table public.clients enable trigger clients_touch;`);
s = stage('70-rollback', ['--batch', batch, '--confirm', 'REMOVE THIS IMPORT']);
ok(s.code === 0 && s.last.removed === inserted, `rollback removed ${s.last.removed} rows: exactly the ${inserted} that were inserted`);
const afterRollback = targetFingerprint();
const diff = sameExceptAudit(beforeApply, afterRollback);
ok(diff.length === 0, `after rollback every table of the target is as before the load${diff.length ? ` (differs: ${diff.join(', ')})` : ''}`);
const auditAfter = Number(afterRollback.audit_log.split(':')[0]);
ok(auditAfter > auditBefore, `the audit log kept the record of the import and of its removal (${auditBefore} entries before, ${auditAfter} after): audit entries are never removed`);
ok(tq(`select tgenabled from pg_trigger where tgname = 'activity_append_only'`) === 'O', 'the append-only rule of the activity feed is back in force after the rollback');
ok(tq('select count(*) from migrate.id_map') === '0', 'the id map of the batch is empty');
ok(stage('50-apply', applyArgs(token)).code === 1, 'a rolled-back batch cannot be applied again');

console.log('== the source is unchanged, the logs carry no personal data');
ok(sourceFingerprint() === source0, 'all 31 source tables have the same row counts and checksums as before the first stage');
ok(sameExceptAudit(target0, afterRollback).length === 0, 'the target is as it was before the first stage, apart from the audit log');
{
  const personal = psql('nova_source', `
    select distinct v from (
      select lower(email) v from clients where email is not null and position('@' in email) > 1
      union all select phone from clients where length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
      union all select btrim(concat_ws(' ', first_name, last_name)) from clients where length(btrim(concat_ws(' ', first_name, last_name))) > 6
      union all select business_name from clients where length(business_name) > 6
      union all select address_line1 from clients where address_line1 is not null
      union all select lower(email) from client_owners union all select full_name from client_owners union all select phone from client_owners
      union all select email from profiles union all select full_name from profiles
      union all select body from client_comments union all select square_customer_id from clients where square_customer_id is not null
    ) x where v is not null and v <> ''`).split('\n').filter((v) => v.length > 5);
  const logText = allOutput + fs.readFileSync(path.join(reports, 'migrate.log'), 'utf8');
  const lower = logText.toLowerCase();
  const leaked = personal.filter((v) => lower.includes(v.toLowerCase()));
  ok(personal.length > 2000 && leaked.length === 0, `none of ${personal.length} names, addresses, emails, telephones and customer ids of the source appears in ${logText.split('\n').length} lines of stage output and log`);
  const masked = fs.readdirSync(reports).filter((f) => f !== '40-needs-review.csv' && f !== 'migrate.log').map((f) => fs.readFileSync(path.join(reports, f), 'utf8')).join('\n').toLowerCase();
  const leaked2 = personal.filter((v) => masked.includes(v.toLowerCase()));
  ok(leaked2.length === 0, `nor in any report other than the needs-review file (${fs.readdirSync(reports).length - 2} files)`);
  ok(/@correo-ficticio\.invalid/.test(review) && review.split('\n').length > 40, `the needs-review file does carry the values in full (${review.trim().split('\n').length - 1} rows), which is why it is restricted`);
}

console.log('\n== counts and timings');
console.log(`   source: ${shape.clients} clients (${shape.square} from Square, ${shape.noOffice} without an office, ${shape.leads} leads), ${shape.services} services, ${shape.tiers} tiers, ${shape.apptTypes} appointment types, ${shape.staff} staff, ${shape.offices} office`);
console.log(`   final plan: ${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`   rows inserted by apply: ${inserted}; removed by rollback: ${inserted}`);
console.log(`   milliseconds: ${Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(failures.length ? `\nFAILED: ${failures.length} of ${passed + failures.length} checks\n - ${failures.join('\n - ')}` : `\nALL ${passed} MIGRATION CHECKS PASSED (generated data only; never run against NOVA or an LBS database)`);
process.exitCode = failures.length ? 1 : 0;
