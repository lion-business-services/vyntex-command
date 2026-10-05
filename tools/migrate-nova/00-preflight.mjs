// Stage 00: is it safe to start? Reads only. Writes one report file. Changes nothing anywhere.
//
//   node tools/migrate-nova/00-preflight.mjs
//
// Refuses when: the source role could write, the source role would silently see no rows (row level security), a
// NOVA table or column the mapping needs is missing, the target is not an LBS practice company with the staging
// migration applied, the source and the target are the same database, or there is no fresh encrypted backup of NOVA
// whose checksum matches.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runStage, refuse, log, settings, target, targetJson, tenantId, writeReport, sha256File, mdTable } from './lib.mjs';
import { read, readJson } from './source.mjs';
import { CARRIED, COUNTED, NEVER_READ } from './source-tables.mjs';

export function checkBackup(s) {
  const file = s.backupFile;
  if (!file) refuse('MIGRATE_BACKUP_FILE is not set. Make the encrypted backup of NOVA with scripts/backup/backup.sh and point this setting at the .dump.age file.');
  if (!fs.existsSync(file)) refuse('The backup file named in MIGRATE_BACKUP_FILE does not exist.');
  const head = Buffer.alloc(21);
  const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 21, 0); fs.closeSync(fd);
  if (head.toString('latin1') !== 'age-encryption.org/v1') refuse('The backup file is not an age-encrypted file. An unencrypted dump is not accepted.');
  const sumFile = `${file}.sha256`;
  if (!fs.existsSync(sumFile)) refuse('The checksum file next to the backup (.sha256) is missing.');
  const recorded = fs.readFileSync(sumFile, 'utf8').trim().split(/\s+/)[0];
  const actual = sha256File(file);
  if (recorded !== actual) refuse('The backup file does not match its recorded checksum. Make a new backup.');
  const ageHours = (Date.now() - fs.statSync(file).mtimeMs) / 3600000;
  if (ageHours > s.backupMaxAgeHours) refuse(`The backup is older than ${s.backupMaxAgeHours} hours. Make a new one right before the migration.`);
  return { sha256: actual, bytes: fs.statSync(file).size, ageHours: Math.round(ageHours * 10) / 10, name: path.basename(file) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runStage('00-preflight', (s) => {
  // ---- source ----
  const src = readJson(`select jsonb_build_object(
    'version', current_setting('server_version'), 'role', current_user, 'database', current_database(),
    'system', (select system_identifier::text from pg_control_system()),
    'readOnlySession', current_setting('transaction_read_only'),
    'superuser', (select rolsuper from pg_roles where rolname = current_user),
    'bypassRls', (select rolbypassrls from pg_roles where rolname = current_user),
    'tables', (select jsonb_object_agg(c.relname, jsonb_build_object(
        'write', has_table_privilege(current_user, c.oid, 'INSERT') or has_table_privilege(current_user, c.oid, 'UPDATE')
              or has_table_privilege(current_user, c.oid, 'DELETE') or has_table_privilege(current_user, c.oid, 'TRUNCATE'),
        'read', has_table_privilege(current_user, c.oid, 'SELECT'),
        'rls', c.relrowsecurity,
        'owner', pg_get_userbyid(c.relowner) = current_user,
        'columns', (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'))`);
  if (src.readOnlySession !== 'on') refuse('The session on the source is not read only. This should be impossible: stop and report it.');
  const tables = src.tables || {};
  const writable = Object.keys(tables).filter((k) => tables[k].write);
  if (src.superuser || writable.length > 0) {
    refuse(`The source role may change ${writable.length} NOVA table(s). Connect with a role that can only read (docs/migration/nova-to-lbs.md, step 2). Nothing was read.`);
  }
  const expected = [...Object.keys(CARRIED), ...Object.keys(COUNTED)];
  const missing = expected.filter((k) => !tables[k]);
  const unknown = Object.keys(tables).filter((k) => !expected.includes(k));
  if (missing.length) refuse(`NOVA tables missing from the source: ${missing.join(', ')}. This is not the database the mapping was written for.`);
  const unreadable = expected.filter((k) => !tables[k].read);
  if (unreadable.length) refuse(`The source role cannot read: ${unreadable.join(', ')}.`);
  const blind = expected.filter((k) => tables[k].rls && !src.bypassRls && !tables[k].owner);
  if (blind.length) refuse(`Row level security would hide rows of ${blind.length} table(s) from the source role, and the counts would silently be zero. The read-only role needs BYPASSRLS (docs/migration/nova-to-lbs.md, step 2).`);
  const missingColumns = [];
  for (const [table, cols] of Object.entries(CARRIED)) for (const [c] of cols) if (!tables[table].columns.includes(c)) missingColumns.push(`${table}.${c}`);
  if (missingColumns.length) refuse(`Columns the mapping needs are missing in NOVA: ${missingColumns.join(', ')}.`);
  const notCarriedColumns = [];
  for (const [table, cols] of Object.entries(CARRIED)) for (const c of tables[table].columns) if (!cols.some(([n]) => n === c)) notCarriedColumns.push(`${table}.${c}`);

  const counts = {};
  for (const table of expected) counts[table] = Number(read(`select count(*) from public.${table}`));
  // How many clients have something in a tax ID column. A count only: the values are never selected.
  const tax = readJson(`select jsonb_build_object(${NEVER_READ.clients.filter((c) => tables.clients.columns.includes(c)).map((c) => `'${c}', count(${c})`).join(', ')}) from public.clients`);

  // ---- target ----
  const tenant = tenantId(s);
  const tgt = targetJson(`select jsonb_build_object(
    'version', current_setting('server_version'), 'role', current_user, 'database', current_database(),
    'system', (select system_identifier::text from pg_control_system()),
    'staging', to_regclass('migrate.id_map') is not null,
    'canActAsServer', pg_has_role(current_user, 'service_role', 'MEMBER'),
    'serverSeesSecrets', has_table_privilege('service_role', 'public.client_secrets', 'SELECT') or has_table_privilege('service_role', 'public.client_secrets', 'INSERT'),
    'clients', (select count(*) from public.clients where tenant_id = :'tenant'),
    'members', (select count(*) from public.tenant_members where tenant_id = :'tenant' and role <> 'worker'))`, { tenant });
  if (src.system === tgt.system && src.database === tgt.database) refuse('The source and the target are the same database.');
  if (!tgt.staging) refuse('The staging tables are missing in the target: apply supabase/migrations/0060_migration_staging.sql first.');
  if (!tgt.canActAsServer) refuse('The target role cannot act as service_role. On Supabase the role "postgres" can; connect with it (direct connection, port 5432).');
  if (tgt.serverSeesSecrets) refuse('service_role holds a privilege on client_secrets in the target. That is a defect in the target: stop and report it.');

  // ---- backup ----
  const backup = checkBackup(s);

  const rows = expected.map((k) => ({ table: k, rows: counts[k], handling: CARRIED[k] ? 'copied to staging' : `counted only: ${COUNTED[k]}` }));
  const taxTotal = ['tax_id', 'tax_id_vault_secret_id', 'tax_id_last4'].reduce((n, k) => n + Number(tax[k] || 0), 0);
  const md = [
    '# Preflight: NOVA to LBS', '',
    `Source: PostgreSQL ${src.version}, read-only session, role holds no write privilege. Target: PostgreSQL ${tgt.version}.`,
    `Backup: ${backup.name}, ${backup.bytes} bytes, ${backup.ageHours} hours old, checksum verified: \`${backup.sha256}\``, '',
    `Clients already in the target: ${tgt.clients}. Team members in the target: ${tgt.members}.`, '',
    taxTotal === 0 ? 'Tax IDs stored in NOVA: none (counted, never read).' : `**Tax IDs stored in NOVA: ${taxTotal} field(s) have a value. They are NOT migrated. Each one is re-entered by a person through the vault.**`, '',
    mdTable(rows, ['table', 'rows', 'handling']), '',
    unknown.length ? `Tables in NOVA that the mapping does not know (not read): ${unknown.join(', ')}` : 'No unknown tables in NOVA.',
    `Columns that exist in NOVA and are not read: ${notCarriedColumns.join(', ') || 'none'}`, '',
  ].join('\n');
  writeReport(s.reportDir, '00-preflight.md', md);
  writeReport(s.reportDir, '00-preflight.json', JSON.stringify({ at: new Date().toISOString(), counts, tax, backup, unknown, notCarriedColumns, sourceVersion: src.version, targetVersion: tgt.version }, null, 2));
  log('00-preflight', 'counts', { tables: expected.length, rows: Object.values(counts).reduce((a, n) => a + n, 0), taxFields: taxTotal });
  return { ok: true };
});
