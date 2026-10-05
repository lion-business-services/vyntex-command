// Gateway round trip. For every edition that has a sample business (src/packs/<id>/seed.ts), in English and Spanish:
//   1. a company of that edition and its team are created in the local test database
//   2. the sample business is sent through public.ws_apply as the owner, in requests of at most 200 changes,
//      with the short sample ids ("c1", "j1-a2") turned into UUIDs the same way every time
//   3. the workspace is read back with public.ws_load as the owner
//   4. what came back is compared, field by field, with what was sent
// The comparison must find no difference except the fields the database fills in itself (who wrote a note, when a
// history entry was written, signature evidence, the tax ID markers of a client, the turn of the lead rotation). Each
// of those is listed with its reason below; anything else is printed as a readable difference and fails the run.
// It also checks the promises the answer of ws_apply makes: "server" names exactly the rows that were stored
// differently, a request repeated with the same idempotency key is answered from memory, and sending the whole
// business again changes nothing.
//
// The module collections (migrations 0030 and later) add a second step. Some records are not a person's to write:
// a credit, a grant, a reveal request, the access log, a daily cash close, the payment of an appointment, a review a
// client answered. ws_apply must refuse or ignore those (step 3 checks that it does), so they are then stored the
// way the server and the protected functions store them: as the database owner, straight into the tables, by a
// small writer of this file that knows nothing of the gateway's own statements. After that every collection is
// read back through ws_load and must be identical to the sample, with no exception for a module collection.
// The audit trail and the connections are the two lists a sample cannot bring: the database writes its own trail,
// and a connection exists only after a provider answered.
//
// Run by supabase/tests/run_local.sh against the local database (never against Supabase):
//   PSQL=<path to psql> PGHOST=<socket folder> PGUSER=supabase_admin PGDATABASE=vyntex_test node tests/gateway_roundtrip.mjs [edition ...]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const psql = process.env.PSQL || 'psql';
const CHUNK = 200;
const LANGS = ['en', 'es'];
const only = process.argv.slice(2);

function run(script) {
  return execFileSync(psql, ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: script, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}
const lit = (v) => (v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
/** A JSON value as an SQL literal that survives any quote or backslash in the sample text. */
const jsonLit = (v) => { const s = JSON.stringify(v); if (s.includes('$vxrt$')) throw new Error('sample text contains the quoting tag'); return `$vxrt$${s}$vxrt$::jsonb`; };
// (aal2: the person passed the second sign-in step. A sample business may ask for it, and then nothing loads without it.)
const asPerson = (uid) => `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2' }))}, false) \\g /dev/null\nset role authenticated;\n`;

/** The same UUID for the same name, every time (version 5 layout, SHA-1 of the name). */
function uuid(name) {
  const h = crypto.createHash('sha1').update('vyntex-roundtrip:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// ---- the packs and the sample businesses that exist today, discovered from the folders
const packIds = fs.readdirSync(path.join(root, 'src/packs'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, 'src/packs', d.name, 'pack.ts'))).map((d) => d.name).sort();
const withSeed = packIds.filter((p) => fs.existsSync(path.join(root, 'src/packs', p, 'seed.ts')));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyntex-roundtrip-'));
let PACKS, SEEDS;
try {
  const out = path.join(dir, 'bundle.mjs');
  buildSync({
    stdin: {
      contents: `export { PACK_LIST } from '@/packs';\n${withSeed.map((p) => `import { seed as seed_${p} } from '@/packs/${p}/seed';`).join('\n')}\nexport const SEEDS = { ${withSeed.map((p) => `${p}: seed_${p}`).join(', ')} };`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error', alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json' },
    define: { __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false' },
  });
  ({ PACK_LIST: PACKS, SEEDS } = await import(pathToFileURL(out).href));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// ---- what the gateway knows: which collections are built, which are only announced, in which order they apply,
//      and (for the writer of the second step) which table and columns each field lives in
const registry = JSON.parse(run(`select coalesce(json_agg(json_build_object('name', name, 'kind', kind, 'ord', ord, 'keyType', key_type, 'writable', writable,
    'relation', relation, 'keyCol', key_col, 'fields', fields) order by ord, name), '[]')
  from (select name, min(kind) as kind, min(ord) as ord, min(key_type) as key_type, bool_or(write_caps is not null) as writable,
               (array_agg(relation order by variant))[1] as relation, (array_agg(key_col order by variant))[1] as key_col, (array_agg(fields order by variant))[1] as fields
        from app.ws_collections where parent is null group by name) w;`));
const reg = Object.fromEntries(registry.map((c) => [c.name, c]));
const nested = JSON.parse(run(`select coalesce(json_agg(json_build_object('parent', parent, 'field', parent_field, 'relation', relation, 'parentCol', parent_col,
    'positionCol', position_col, 'fixed', fixed, 'fields', fields, 'ord', ord) order by ord, name), '[]')
  from (select distinct on (name) * from app.ws_collections where parent is not null order by name, variant) w;`));
const childrenOf = (name) => nested.filter((n) => n.parent === name);

/** Collections of the core data model (0018). Everything else registered is a module collection (0030 and later). */
const CORE = new Set(['users', 'workers', 'clients', 'leads', 'jobs', 'tasks', 'workerPays', 'docs', 'messages', 'activity', 'automationRuns', 'audit']);
/** Lists a sample cannot bring, with the reason. Their sample rows are counted and left out. */
const NOT_A_SAMPLE = {
  audit: 'the database writes its own trail: the changes of this run are in it, the sample lines are not',
  connections: 'a connection exists only after a provider answered; the list is read from the server',
};
/** Collections a person never creates a row of, although one field of a row is theirs to change later. */
const SERVER_CREATED = { cashCloses: 'a close is created by cash_close; a person only adds the approval' };
/**
 * Rows that state a fact only the server may record (something left the building, or someone outside answered).
 * ws_apply must refuse them from a person; the second step stores them the way the server does.
 * The same rules as the guards in the migrations: messages 0013, appointments 0032, envelopes 0035, reviews and posts 0038.
 */
const SERVER_STATE = {
  messages: (r) => !['draft', 'demo'].includes(r.status) || r.dir === 'in',
  reviews: (r) => !['draft', 'demo'].includes(r.status) || (r.status === 'draft' && (r.rating !== undefined || r.comment !== undefined)),
  posts: (r) => ['published', 'failed'].includes(r.status),
  envelopes: (r) => !r.demo && (!['draft', 'void'].includes(r.status) || !!r.sentAt || !!r.completedAt || !!r.lastReminder || !!r.signedFile
    || (r.signers || []).some((x) => x.status !== 'waiting' || x.viewedAt || x.signedAt || x.typedName || x.signature || x.consent !== undefined)
    || (r.fields || []).some((x) => x.value !== undefined && x.value !== null)),
  appointments: (r) => r.status === 'confirmed' && !!r.payBy,
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBlank = (v) => v === null || v === undefined || v === false || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

/** Keys whose value is the id of another record of the sample business. */
const REF_KEY = /(^id$|Id$|Ids$|^by$|By$|^from$|^to$|^mentions$|^pool$|^exclude$|^assignedTo$|^rescheduledFrom$)/;
function mapIds(value, ids, key = '') {
  if (Array.isArray(value)) return value.map((v) => mapIds(v, ids, key));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, mapIds(v, ids, k)]));
  if (typeof value !== 'string') return value;
  if (key === 'assignee' && /^[uw]:/.test(value) && ids.has(value.slice(2))) return value.slice(0, 2) + ids.get(value.slice(2));
  // a deadline names its person without the "u:" a task uses
  if ((REF_KEY.test(key) || key === 'assignee') && ids.has(value)) return ids.get(value);
  return value;
}
function collectIds(value, add) {
  if (Array.isArray(value)) value.forEach((v) => collectIds(v, add));
  else if (isObj(value)) { if (typeof value.id === 'string' && value.id) add(value.id); Object.values(value).forEach((v) => collectIds(v, add)); }
}

/** What matters when two rows are compared: no version, no "nothing there" values, lists of records in id order. */
function norm(v) {
  if (Array.isArray(v)) {
    const a = v.map(norm);
    return a.length && a.every((x) => isObj(x) && typeof x.id === 'string') ? [...a].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) : a;
  }
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v).sort()) { if (k === 'updatedAt') continue; const n = norm(v[k]); if (!isBlank(n)) o[k] = n; }
    return o;
  }
  return v;
}
/** Differences between what was sent and what was read back, as paths: leads[<id>].notes[<id>].by */
function differences(sent, got, at, out) {
  if (isBlank(sent) && isBlank(got)) return;
  if (Array.isArray(sent) && Array.isArray(got) && [...sent, ...got].every((x) => isObj(x) && typeof x.id === 'string')) {
    const g = new Map(got.map((x) => [x.id, x])); const s = new Map(sent.map((x) => [x.id, x]));
    for (const [id, x] of s) { if (g.has(id)) differences(x, g.get(id), `${at}[${id}]`, out); else out.push({ path: `${at}[${id}]`, field: `${at.replace(/\[[^\]]*\]/g, '[]')}[]`, sent: x, got: undefined }); }
    for (const [id, x] of g) if (!s.has(id)) out.push({ path: `${at}[${id}]`, field: `${at.replace(/\[[^\]]*\]/g, '[]')}[]`, sent: undefined, got: x });
    return;
  }
  if (isObj(sent) && isObj(got)) {
    for (const k of new Set([...Object.keys(sent), ...Object.keys(got)])) differences(sent[k], got[k], at ? `${at}.${k}` : k, out);
    return;
  }
  const same = typeof sent === 'number' && typeof got === 'number' ? Math.abs(sent - got) < 1e-9 : JSON.stringify(sent) === JSON.stringify(got);
  if (!same) out.push({ path: at, field: at.replace(/\[[^\]]*\]/g, '[]'), sent, got });
}

/** Fields the database fills in itself, with the reason. A difference anywhere else fails the run. */
const SERVER_FIELDS = [
  [/^activity\[\]\.at$/, 'history is stamped with the moment it is written (0003)'],
  [/^activity\[\]\.by$/, 'history is written in the name of the person signed in (0003)'],
  [/^(leads|clients|jobs)\[\]\.notes\[\]\.by$/, 'a note carries the person who saved it (0003)'],
  [/^tasks\[\]\.comments\[\]\.by$/, 'a comment carries the person who saved it (0013)'],
  [/^leads\[\]\.handoffs\[\]\.by$/, 'a handoff made by a person carries the person signed in (0013)'],
  [/^messages\[\]\.by$/, 'a message carries the person who wrote it (0013)'],
  [/^docs\[\]\.esign(\.|$)/, 'signature evidence is written by the server only (0003); a sample signature is not stored'],
  [/^clients\[\]\.taxId(Type|Last4)$/, 'the tax ID markers of a client are set by the vault only (0012)'],
  [/^config\.routing\.cursor$/, 'the turn of the lead rotation belongs to the database (0017)'],
  [/^users\[\]\.mfa$/, 'whether a person uses the second sign-in step comes from the sign-in system, never from the workspace'],
];
// For the module collections the same list is read from the registry: a field that is returned and never written
// ("ro"), or stamped with the person signed in ("stamp", or a "who did it" field), cannot be sent by a person.
const serverOwned = (spec) => isObj(spec) && (spec.ro === true || !!spec.stamp || spec.kind === 'actor');
for (const c of registry.filter((x) => !CORE.has(x.name) && x.fields)) {
  for (const [f, spec] of Object.entries(c.fields)) if (serverOwned(spec)) SERVER_FIELDS.push([new RegExp(`^${c.name}\\[\\]\\.${f}(\\.|$)`), 'written by the server or stamped with the person signed in (module range)']);
  for (const n of childrenOf(c.name)) for (const [f, spec] of Object.entries(n.fields)) if (serverOwned(spec)) SERVER_FIELDS.push([new RegExp(`^${c.name}\\[\\]\\.${n.field}\\[\\]\\.${f}(\\.|$)`), 'written by the server (module range)']);
}
const reasonFor = (field) => SERVER_FIELDS.find(([re]) => re.test(field));

// ---- the second step: what the server stores. One row becomes "column: value" from the registry's field map.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The columns of one sample row: those of stamped fields, of server-only fields, of the others, and the fields nobody mapped. */
function columnsOf(row, fields, skip = []) {
  const stamp = {}; const ro = {}; const rest = {}; const extra = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id' || skip.includes(k)) continue;
    const spec = fields[k];
    if (spec === undefined) { extra[k] = v; continue; }
    const s = typeof spec === 'string' ? { col: spec } : spec;
    const into = s.ro === true ? ro : serverOwned(s) ? stamp : rest;
    if (s.kind === 'expr') continue;
    if (s.kind === 'obj') { if (isObj(v)) for (const [sub, col] of Object.entries(s.cols)) if (v[sub] !== undefined) into[col] = v[sub]; continue; }
    if (s.kind === 'actor') { if (UUID.test(v)) { into[s.kind_col] = 'member'; into[s.id_col] = v; } else { into[s.kind_col] = v; into[s.id_col] = null; } continue; }
    if (s.kind === 'ref') { if (isObj(v)) { into[s.type_col] = v.type; into[s.id_col] = v.id; } continue; }
    // the value the app writes for "nothing" is stored as nothing: the column keeps its default
    if ('empty' in s && JSON.stringify(v) === JSON.stringify(s.empty)) continue;
    into[s.col] = v;
  }
  return { stamp, ro, rest, extra };
}
const quoted = (cols) => cols.map((c) => `"${c}"`).join(', ');
/** A new row: every column the sample gives a value for; the rest keep their defaults. */
const insertSql = (relation, values) =>
  `insert into public."${relation}" (${quoted(Object.keys(values))}) select ${Object.keys(values).map((c) => `r."${c}"`).join(', ')} from jsonb_populate_record(null::public."${relation}", $1) r`;
/** A row a person already sent: only the named columns change. */
const updateSql = (relation, keyCol, values) =>
  `update public."${relation}" t set ${Object.keys(values).filter((c) => c !== 'tenant_id' && c !== keyCol).map((c) => `"${c}" = r."${c}"`).join(', ')} `
  + `from jsonb_populate_record(null::public."${relation}", $1) r where t.tenant_id = r.tenant_id and t."${keyCol}" = r."${keyCol}"`;
/**
 * The statements that store one sample row as the server. A row nobody could send is inserted whole, with its lists.
 * A row a person did send gets what was missing: first who it was written by, then what only the server records
 * (two statements, because a cash entry is counted by its close in a change of its own).
 */
function serverStatements(c, row, tenant, isNew) {
  const out = [];
  const kids = childrenOf(c.name);
  const { stamp, ro, rest, extra } = columnsOf(row, c.fields, kids.map((n) => n.field));
  const key = { tenant_id: tenant, [c.keyCol]: row.id };
  if (isNew) out.push({ sql: insertSql(c.relation, { ...key, ...rest, ...stamp, ...ro, extra }), row: { ...key, ...rest, ...stamp, ...ro, extra } });
  else for (const part of [stamp, ro]) if (Object.keys(part).length) out.push({ sql: updateSql(c.relation, c.keyCol, { ...key, ...part }), row: { ...key, ...part } });
  for (const n of kids) {
    (Array.isArray(row[n.field]) ? row[n.field] : []).forEach((el, i) => {
      const p = columnsOf(el, n.fields);
      const k = { tenant_id: tenant, id: el.id };
      if (isNew) {
        const values = { ...k, [n.parentCol]: row.id, ...(n.fixed || {}), ...p.rest, ...p.stamp, ...p.ro, extra: p.extra, ...(n.positionCol ? { [n.positionCol]: i + 1 } : {}) };
        out.push({ sql: insertSql(n.relation, values), row: values });
      } else for (const part of [p.stamp, p.ro]) if (Object.keys(part).length) out.push({ sql: updateSql(n.relation, 'id', { ...k, ...part }), row: { ...k, ...part } });
    });
  }
  return out;
}
/**
 * Runs the statements as the database owner, in order. A row that points at one stored further down the list (a cash
 * entry and its close, an appointment and the credit that paid it) is tried again once the rest is in.
 */
function runAsServer(statements) {
  if (!statements.length) return;
  run(`do $server$
declare
  todo jsonb := ${jsonLit(statements)};
  later jsonb; s jsonb; moved boolean; why text;
begin
  for round in 1 .. 6 loop
    later := '[]'::jsonb; moved := false;
    for s in select value from jsonb_array_elements(todo) loop
      begin
        execute s ->> 'sql' using s -> 'row';
        moved := true;
      exception when foreign_key_violation then
        later := later || s; why := sqlerrm;
      end;
    end loop;
    exit when jsonb_array_length(later) = 0;
    if not moved then raise exception 'the server step could not store % rows: %', jsonb_array_length(later), why; end if;
    todo := later;
  end loop;
end
$server$;`);
}

let failed = 0; let businesses = 0; let totalRows = 0; let totalChecks = 0;
const fail = (msg) => { failed++; console.error('   FAILED: ' + msg); };
const ok = (cond, msg) => { totalChecks++; if (!cond) fail(msg); return cond; };

for (const pack of PACKS) {
  if (only.length && !only.includes(pack.id)) continue;
  if (!SEEDS[pack.id]) { console.log(`${pack.id}: no sample business yet (src/packs/${pack.id}/seed.ts is missing), skipped`); continue; }
  for (const lang of LANGS) {
    const label = `${pack.id} (${lang})`;
    const seed = SEEDS[pack.id](lang);
    // what every workspace of the edition starts with, the way the store adds it (src/store/store.ts, starters):
    // the edition's appointment types and rules, unless the sample brings its own
    if (!seed.apptTypes?.length && pack.appointmentTypes?.length) seed.apptTypes = pack.appointmentTypes.map((a, i) => ({ ...a, id: 'at' + (i + 1) }));
    if (!seed.rules?.length && pack.rules?.length) seed.rules = pack.rules;
    const tenant = uuid(`tenant:${pack.id}:${lang}`);

    // ---- ids: every record id of the sample business becomes a UUID, the same one wherever it is referred to
    const ids = new Map();
    collectIds(seed, (id) => { if (!ids.has(id)) ids.set(id, uuid(`${pack.id}:${lang}:${id}`)); });
    for (const [name, c] of Object.entries(reg)) {
      // a collection keyed by something other than a UUID (a provider name, a rule name) keeps its ids
      if (c.keyType && c.keyType !== 'uuid' && Array.isArray(seed[name])) for (const row of seed[name]) ids.delete(row.id);
    }
    const sample = mapIds(JSON.parse(JSON.stringify(seed)), ids);
    const users = sample.users || [];
    const owner = users.find((u) => u.role === 'owner');
    if (!owner) { fail(`${label}: the sample business has no owner`); continue; }
    const authId = (u) => uuid(`auth:${pack.id}:${lang}:${u.id}`);

    // ---- 1. the company and its team (people are never created through ws_apply: "users" is read only there)
    let setup = `insert into public.tenants (id, slug, name, industry_id, plan_id, status) values (${lit(tenant)}, ${lit(`rt-${pack.id}-${lang}`)}, ${lit(pack.sampleCompany.name)}, ${lit(pack.id)}, 'roundtrip', 'active');\n`;
    // offices first: a person's offices are checked nowhere, but the sample is easier to read in the database with them there
    for (const u of users) {
      setup += `insert into auth.users (id, email) values (${lit(authId(u))}, ${lit(`rt-${pack.id}-${lang}-${u.id}@example.com`)});\n`;
      setup += `insert into public.tenant_members (id, tenant_id, user_id, role, status, name, email, phone, title, bio, photo, languages, office_ids, in_lead_pool, away_from, away_to, away_note, invited_at, last_seen_at) values (`
        + [lit(u.id), lit(tenant), lit(authId(u)), lit(u.role), lit(u.active === false ? 'disabled' : 'active'), lit(u.name), lit(u.email), lit(u.phone), lit(u.title), lit(u.bio), lit(u.photo),
          u.languages ? `array[${u.languages.map(lit).join(', ')}]::text[]` : 'null', `array[${(u.officeIds || []).map(lit).join(', ')}]::uuid[]`,
          u.inLeadPool === undefined ? 'null' : String(u.inLeadPool), lit(u.away?.from), lit(u.away?.to), lit(u.away?.note), lit(u.invitedAt), lit(u.lastSeen)].join(', ') + ');\n';
    }
    run(setup);

    // ---- 2. the operations, in the order the registry applies collections
    const expected = { company: { ...pack.sampleCompany }, config: sample.config || {}, users };
    const ops = [{ c: 'company', op: 'upsert', id: 'company', row: expected.company }];
    if (sample.config) ops.push({ c: 'config', op: 'upsert', id: 'config', row: sample.config });
    const notBuilt = []; const notSample = []; const sentCounts = {};
    const serverOnly = [];        // core rows only the server writes: refused, and not stored by this test
    const byServer = [];          // module rows the second step stores: [collection, row]
    const laterOps = [];          // operations that only make sense once the server step has run
    for (const c of registry) {
      const rows = sample[c.name];
      if (!Array.isArray(rows) || c.name === 'users') continue;
      if (NOT_A_SAMPLE[c.name]) { if (rows.length) notSample.push(`${c.name} ${rows.length}`); continue; }
      if (c.kind === 'pending') { if (rows.length) notBuilt.push(`${c.name} ${rows.length}`); continue; }
      if (c.kind !== 'table') continue;
      if (!c.writable && CORE.has(c.name)) { if (rows.length) fail(`${label}: the sample business has rows in "${c.name}", which is read only through the gateway`); continue; }
      expected[c.name] = [];
      sentCounts[c.name] = rows.length;
      for (const row of rows) {
        const op = { c: c.name, op: 'upsert', id: row.id, row };
        if (!c.writable) { byServer.push([c.name, row]); expected[c.name].push(row); continue; }
        if (SERVER_CREATED[c.name]) { byServer.push([c.name, row]); expected[c.name].push(row); laterOps.push(op); continue; }
        if (SERVER_STATE[c.name]?.(row)) {
          // a fact only the server records: it must be refused here. A module row is then stored by the server step
          // and compared; a delivery record of the core (a sent message) is not stored by this test at all.
          serverOnly.push(row.id);
          if (!CORE.has(c.name)) { byServer.push([c.name, row]); expected[c.name].push(row); }
        } else expected[c.name].push(row);
        ops.push(op);
      }
    }
    for (const key of Object.keys(sample)) {
      if (Array.isArray(sample[key]) && !reg[key]) fail(`${label}: the sample business has a collection "${key}" that the gateway does not know`);
    }
    const storedByServer = new Set(byServer.map(([c, row]) => `${c}/${row.id}`));

    // ---- 3. send, in requests of at most CHUNK changes
    const answers = []; let applied = 0; const refused = []; const retry = [];
    const send = (chunk, key) => JSON.parse(run(`${asPerson(authId(owner))}select public.ws_apply(${lit(tenant)}, ${jsonLit(chunk)}, ${lit(key)});`).split('\n').pop());
    let requests = 0;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const chunk = ops.slice(i, i + CHUNK);
      const answer = send(chunk, `roundtrip-${pack.id}-${lang}-${i}`);
      answers.push(answer); requests++; applied += answer.applied;
      for (const r of answer.rejected) {
        // a fact only the server records is refused ("forbidden"); a received message from someone who is not on file
        // carries no record to point at and is refused even earlier ("invalid"). Either way a person did not store it.
        if (serverOnly.includes(r.id) && (r.reason === 'forbidden' || (CORE.has(r.c) && r.reason === 'invalid'))) continue;
        // a link to a row that arrives in a later request: stored without the link, and sent again once everything is in
        if (r.reason === 'missing_reference') retry.push(chunk.find((o) => o.c === r.c && o.id === r.id)); else refused.push(r);
      }
      if (i === 0) {
        const again = send(chunk, `roundtrip-${pack.id}-${lang}-${i}`);
        ok(again.replayed === true && JSON.stringify({ ...again, replayed: undefined }) === JSON.stringify(answer), `${label}: the first request, repeated with the same idempotency key, was answered from memory`);
      }
    }
    if (retry.length) {
      const answer = send(retry, `roundtrip-${pack.id}-${lang}-retry`);
      answers.push(answer); requests++; applied += answer.applied; refused.push(...answer.rejected);
    }
    ok(refused.length === 0, `${label}: ${refused.length} changes were refused: ${JSON.stringify(refused.slice(0, 5))}${refused.length ? '\n      first one sent: ' + JSON.stringify(ops.find((o) => o.id === refused[0].id && o.c === refused[0].c)?.row).slice(0, 600) : ''}`);
    const refusedServerOnly = answers.flatMap((a) => a.rejected).filter((r) => serverOnly.includes(r.id));
    ok(refusedServerOnly.length === serverOnly.length, `${label}: every record that only the server may write (${serverOnly.length}) was refused when a person sent it`);

    // ---- 4. read back and compare what a person could send
    const load = () => JSON.parse(run(`${asPerson(authId(owner))}select public.ws_load(${lit(tenant)});`).split('\n').pop());
    const compare = (got, keep) => {
      const diffs = [];
      for (const key of Object.keys(expected)) {
        // "active" is only ever false for someone who left: a person without the field is active
        const sent = key === 'users' ? expected.users.map((u) => ({ active: true, ...u })) : Array.isArray(expected[key]) ? expected[key].filter((row) => keep(key, row)) : expected[key];
        const back = Array.isArray(got[key]) && Array.isArray(expected[key]) && key !== 'users' ? got[key].filter((row) => keep(key, row)) : got[key];
        differences(norm(sent), norm(back), key, diffs);
      }
      return diffs;
    };
    const report = (unexpected, what) => {
      if (!ok(unexpected.length === 0, `${label}: ${unexpected.length} differences between what was sent and what ws_load returned ${what}`)) {
        for (const d of unexpected.slice(0, 25)) console.error(`      ${d.path}\n         sent:   ${JSON.stringify(d.sent)}\n         loaded: ${JSON.stringify(d.got)}`);
        if (unexpected.length > 25) console.error(`      ... and ${unexpected.length - 25} more`);
      }
    };
    const first = load();
    // (rows the server step will store are not there yet: they are compared after it)
    const diffs = compare(first, (c, row) => !storedByServer.has(`${c}/${row.id}`));
    report(diffs.filter((d) => !reasonFor(d.field)), 'after ws_apply');
    const stamped = {};
    for (const d of diffs.filter((x) => reasonFor(x.field) && CORE.has(x.field.split('[')[0].split('.')[0]) || /^(config|users)/.test(x.field))) {
      const f = d.field.replace(/^(docs\[\]\.esign).*/, '$1'); (stamped[f] ||= new Set()).add(d.path.replace(/(\.esign).*/, '$1'));
    }
    for (const c of registry.filter((x) => x.kind === 'pending')) ok(Array.isArray(first[c.name]) && first[c.name].length === 0, `${label}: "${c.name}" (not built yet) loads as an empty list`);
    for (const c of registry.filter((x) => x.kind === 'table' && !x.writable && !CORE.has(x.name))) ok(Array.isArray(first[c.name]) && first[c.name].length === 0, `${label}: "${c.name}" holds nothing a person sent`);
    ok(first.pack === pack.id, `${label}: ws_load names the edition`);

    // the stamped values are the right ones: the person who was signed in
    const stampedBy = [];
    for (const key of ['leads', 'clients', 'jobs']) for (const row of first[key] || []) for (const n of row.notes || []) stampedBy.push(n.by);
    for (const a of first.activity || []) if (a.by !== 'automation') stampedBy.push(a.by);
    ok(stampedBy.every((b) => b === owner.id), `${label}: every note and history entry carries the owner who sent it, or "automation"`);

    // "server" in the answers names exactly the rows that were stored differently from what was sent
    const changedRows = new Set(diffs.filter((d) => /^[A-Za-z]+\[/.test(d.path) && !d.path.startsWith('users[')).map((d) => d.path.match(/^([A-Za-z]+)\[([^\]]+)\]/).slice(1, 3).join('/')));
    const serverRows = new Set(answers.flatMap((a) => Object.entries(a.server || {}).flatMap(([c, rows]) => (Array.isArray(rows) ? rows.filter((r) => r && r.id).map((r) => `${c}/${r.id}`) : []))));
    const missing = [...changedRows].filter((x) => !serverRows.has(x)); const extra = [...serverRows].filter((x) => !changedRows.has(x));
    ok(missing.length === 0 && extra.length === 0, `${label}: "server" in the answers of ws_apply names exactly the rows stored differently (missing ${JSON.stringify(missing.slice(0, 3))}, extra ${JSON.stringify(extra.slice(0, 3))})`);

    // ---- 5. the server step: what a person cannot write is stored the way the server and the protected functions store it
    const moduleRows = new Map(byServer.map(([c, row]) => [`${c}/${row.id}`, [c, row]]));
    // ... and the rows a person did send, whose server-owned fields are still missing (who booked it, the payment, the close)
    for (const key of changedRows) { const [c, id] = key.split('/'); if (!CORE.has(c) && reg[c]?.kind === 'table') { const row = (sample[c] || []).find((r) => r.id === id); if (row) moduleRows.set(key, [c, row]); } }
    const statements = [...moduleRows.entries()].sort((a, b) => reg[a[1][0]].ord - reg[b[1][0]].ord).flatMap(([key, [c, row]]) => serverStatements(reg[c], row, tenant, storedByServer.has(key)));
    runAsServer(statements);

    // ---- 6. read back again: now everything is there, and a module collection has no exception at all
    const got = load();
    const all = compare(got, () => true);
    report(all.filter((d) => !reasonFor(d.field) || !(CORE.has(d.field.split('[')[0]) || /^(config|users)/.test(d.field))), 'after the server stored what only it may write');

    // sending everything again changes nothing: same rows, same versions
    const before = JSON.stringify(got);
    const everything = [...ops, ...laterOps];
    let reapplied = 0; let rerefused = [];
    for (let i = 0; i < everything.length; i += CHUNK) {
      const a = send(everything.slice(i, i + CHUNK), `roundtrip-${pack.id}-${lang}-second-${i}`);
      // a core delivery record is refused again; a module row the server stored is simply found unchanged
      reapplied += a.applied; rerefused.push(...a.rejected.filter((r) => !(serverOnly.includes(r.id) && CORE.has(r.c))));
    }
    ok(rerefused.length === 0 && JSON.stringify(load()) === before, `${label}: sending the whole business a second time changes nothing (${rerefused.length} refused${rerefused.length ? ': ' + JSON.stringify(rerefused.slice(0, 3)) : ''})`);

    const rows = Object.values(sentCounts).reduce((a, b) => a + b, 0);
    businesses++; totalRows += rows;
    const stampedText = Object.entries(stamped).map(([f, set]) => `${f.replace(/\[\]/g, '')} x${set.size}`).join(', ');
    console.log(`${label}: ${rows} records in ${Object.keys(sentCounts).filter((k) => sentCounts[k]).length} collections (${Object.entries(sentCounts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}), ${requests} requests, ${applied} changes applied`
      + `, read back identical except what the database fills in itself: ${stampedText || 'nothing'}`
      + (moduleRows.size ? `. Stored by the server step and read back identical: ${moduleRows.size} module records (${serverOnly.filter((id) => [...storedByServer].some((k) => k.endsWith('/' + id))).length} of them refused from a person first)` : '')
      + (notSample.length ? `. Not a sample's to bring: ${notSample.join(', ')}` : '')
      + (notBuilt.length ? `. Not sent, tables not built yet: ${notBuilt.join(', ')}` : ''));
  }
}

if (failed) { console.error(`\ngateway round trip: ${failed} FAILED`); process.exit(1); }
const editions = new Set(PACKS.filter((p) => SEEDS[p.id] && (!only.length || only.includes(p.id))).map((p) => p.id)).size;
console.log(`gateway round trip: ${businesses} sample businesses (${editions} editions, ${LANGS.length} languages), ${totalRows} records, ${totalChecks} checks passed`);
