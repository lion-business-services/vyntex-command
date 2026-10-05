// Checks that the app code and the database say the same thing. Run by run_local.sh against the local test database.
//   1. reserved company addresses: src/platform/mode.ts (RESERVED_SLUGS and RESERVED_EXTRA)  ==  app.reserved_slugs()
//   2. address validation:         isValidSlug()         ==  app.is_valid_slug(), over a list of tricky samples
//   3. capabilities and roles:     the Permission list and every pack's rolePermissions  ==  app.capabilities() and
//                                  app.role_permissions(edition, role); a company's own lists resolve the same way on both sides
//   4. pipeline:                   every pack's leadStages and leadSources  ==  app.edition_defaults(edition)
//   5. value lists:                the unions in src/domain/types.ts  ==  the CHECK constraints of the matching columns
//   6. editions:                   seed rows  ==  the packs in src/packs  ==  the products in the pricing file (priced editions)
//   7. plan ids in the pricing file are accepted by the tenants.plan_id rule
//   8. the gateway:                the keys of WorkspaceData  ==  the registered collections; every mapped field exists in types.ts
// A check whose app-side half does not exist yet (a pack that does not export the blueprint, for example) is not a
// failure: it is listed at the end as "waiting", with what it is waiting for.
// Connection comes from the usual PG* environment variables; PSQL is the path of the psql program.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const psql = process.env.PSQL || 'psql';
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

function sql(query) {
  return execFileSync(psql, ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}
const sqlJson = (query) => JSON.parse(sql(query));
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";

/** Bundles a small entry file together with whatever it imports from src/ and loads the result. */
async function loadBundle(entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyntex-parity-'));
  const out = path.join(dir, 'bundle.mjs');
  try {
    buildSync({
      stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error',
      alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json' },
      define: { __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false' },
    });
    return await import(pathToFileURL(out).href);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

let passed = 0;
const failures = [];
const waiting = [];
const notes = [];
function check(ok, label, detail) {
  if (ok) passed++; else failures.push(label + (detail ? '\n      ' + detail : ''));
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const diff = (a, b) => `only in code: ${JSON.stringify(a.filter((x) => !b.includes(x)))}  only in database: ${JSON.stringify(b.filter((x) => !a.includes(x)))}`;

// ---- 1 and 2: company addresses
const mode = await loadBundle(`export * from '@/platform/mode';`);
const dbReserved = sqlJson('select to_json(app.reserved_slugs())');
const NEW_WORDS = ['preview', 'review', 'book', 'mfa'];
let codeReserved = [...mode.RESERVED_SLUGS];
if (Array.isArray(mode.RESERVED_EXTRA)) {
  codeReserved = [...new Set([...mode.RESERVED_SLUGS, ...mode.RESERVED_EXTRA])];
  check(same(codeReserved, dbReserved), 'reserved company addresses are the same list in mode.ts (RESERVED_SLUGS and RESERVED_EXTRA) and in the database', diff(codeReserved, dbReserved));
} else {
  // the database already keeps the four pages of this build for the site; mode.ts lists them once RESERVED_EXTRA is exported
  const dbOld = dbReserved.filter((w) => !NEW_WORDS.includes(w) || codeReserved.includes(w));
  check(same(codeReserved, dbOld), 'reserved company addresses are the same list in mode.ts and in the database', diff(codeReserved, dbOld));
  waiting.push('reserved addresses preview, review, book, mfa: waiting for RESERVED_EXTRA to be exported next to RESERVED_SLUGS in src/platform/mode.ts');
}

const samples = [
  'acme', 'acme-builders', 'a1', 'abc', 'ab', 'a', '', 'a-b', 'a--b', '-abc', 'abc-', 'Acme', 'ACME', 'acme builders', 'acme_builders',
  'acme.builders', 'acme/builders', 'ácme', 'niño-landscaping', '123', '1-2-3', 'x'.repeat(40), 'x'.repeat(41), 'abc\n', '\nabc', ' abc',
  'abc ', 'ab-c-d-e-f', 'demo', 'demo1', 'demos', 'api', 'apis', 'request-demo', 'request-demos', 'login', 'my-login', 'null',
  'undefined', 'vyntex', 'vyntex-build', 'admin', 'administrator', 'worker', 'workers', 'assets', 'brand', 'pricing', '%61cme',
  'acme?x=1', 'acme#top', '..', 'a-b-', 'a-', '0', '000', 'abc--def', 'sign', 'signs', 'previews', 'reviews', 'books', 'mfa1', ...codeReserved,
];
const dbValid = sqlJson(`select coalesce(json_agg(app.is_valid_slug(s) order by n), '[]') from json_array_elements_text($json$${JSON.stringify(samples)}$json$::json) with ordinality as t(s, n)`);
const wrong = samples.filter((s, i) => mode.isValidSlug(s) !== dbValid[i]);
check(wrong.length === 0, `address validation agrees on all ${samples.length} samples`, 'disagree on: ' + JSON.stringify(wrong));
check(mode.isValidSlug('acme-builders') && !mode.isValidSlug('demo') && !mode.isValidSlug('Acme'), 'address validation accepts and refuses the obvious cases');

const r1 = mode.resolvePath('/demo/jobs/j1');
const r2 = mode.resolvePath('/acme-builders/leads/');
const r3 = mode.resolvePath('/pricing');
const r4 = mode.resolvePath('/');
const r5 = mode.resolvePath('/api/health');
const r6 = mode.resolvePath('/Acme-Builders');
check(r1.mode === 'demo' && r1.base === '/demo' && r1.rest === '/jobs/j1', 'resolvePath: /demo/... is demo mode');
check(r2.mode === 'workspace' && r2.slug === 'acme-builders' && r2.base === '/acme-builders' && r2.rest === '/leads', 'resolvePath: /<company-slug>/... is workspace mode');
check(r3.mode === null && r4.mode === null && r5.mode === null && r6.mode === null, 'resolvePath: sales pages, reserved words and invalid addresses are not workspaces');
check(codeReserved.every((s) => mode.resolvePath('/' + s).slug !== s), 'resolvePath: no reserved word resolves to a company of that name');

// ---- the packs and the configuration resolver, as the app runs them
const packFolders = fs.readdirSync(path.join(root, 'src/packs'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && exists(`src/packs/${d.name}/pack.ts`)).map((d) => d.name);
const app = await loadBundle(`
  export { PACK_LIST } from '@/packs';
  ${exists('src/domain/config.ts') ? `export * as config from '@/domain/config';` : 'export const config = null;'}
  ${exists('src/packs/blueprint.ts') ? `export * as blueprint from '@/packs/blueprint';` : 'export const blueprint = null;'}
`);
const packs = app.PACK_LIST;
check(same(packs.map((p) => p.id), packFolders), 'every folder in src/packs with a pack.ts is in the pack registry', diff(packs.map((p) => p.id), packFolders));

// ---- 3: capabilities and the role matrix, per edition
const typesSrc = read('src/domain/types.ts');
const permSrc = read('src/domain/permissions.ts');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
function union(name, src = typesSrc) {
  const m = stripComments(src).match(new RegExp(`export type ${name} =([^;]+);`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const dbCaps = sqlJson('select to_json(app.capabilities())');
const codeCaps = union('Permission', permSrc);
check(!!codeCaps && codeCaps.length > 0, 'the Permission list was found in src/domain/permissions.ts');
check(!!codeCaps && same(codeCaps, dbCaps), 'the capability names are the same in permissions.ts and in app.capabilities()', codeCaps ? diff(codeCaps, dbCaps) : '');
if (app.blueprint?.ALL_PERMISSIONS) check(same(app.blueprint.ALL_PERMISSIONS, dbCaps), 'ALL_PERMISSIONS in src/packs/blueprint.ts is the same list', diff([...app.blueprint.ALL_PERMISSIONS], dbCaps));
const OFFICE_ROLES = ['owner', 'manager', 'staff', 'readonly'];
check(same(union('OfficeRole') || [], sqlJson('select to_json(app.office_roles())')), 'the office roles are the same in types.ts and in app.office_roles()');
let matrixEditions = 0;
for (const pack of packs) {
  if (!pack.rolePermissions) { waiting.push(`role matrix of ${pack.id}: waiting for the pack to export rolePermissions`); continue; }
  matrixEditions++;
  for (const role of OFFICE_ROLES) {
    const dbPerms = sqlJson(`select to_json(app.role_permissions(${lit(pack.id)}, ${lit(role)}))`);
    check(same(pack.rolePermissions[role] || [], dbPerms), `role matrix: ${pack.id} ${role} holds the same capabilities in the pack and in the database`, diff(pack.rolePermissions[role] || [], dbPerms));
  }
  check(!(pack.rolePermissions.readonly || []).includes('write') && !(pack.rolePermissions.readonly || []).includes('delete'), `role matrix: read only of ${pack.id} can neither write nor delete`);
  check(Object.keys(pack.rolePermissions).sort().join() === 'manager,owner,readonly,staff', `role matrix: ${pack.id} defines exactly the four office roles`);
  if (pack.family) check(sql(`select app.edition_family(${lit(pack.id)})`) === pack.family, `edition family of ${pack.id} is "${pack.family}" on both sides`);
}
check(sqlJson(`select to_json(app.role_permissions('build', 'worker'))`).length === 0, 'role matrix: a worker holds no office capability');

// a company's own lists: the app (permissionsOf) and the database (app.permissions_for) resolve them the same way
if (app.config?.permissionsOf && matrixEditions > 0) {
  const overrides = [
    {},
    { roles: { staff: ['leads', 'clients', 'money', 'write'] } },
    { roles: { manager: ['leads', 'write', 'no-such-capability'], readonly: [] } },
    { roles: { staff: [] } },
    { roles: { readonly: ['leads', 'clients'] }, roleLabels: { staff: { en: 'Associate', es: 'Asociado' } } },
  ];
  let n = 0; const bad = [];
  for (const pack of packs.filter((p) => p.rolePermissions)) {
    for (const config of overrides) {
      for (const role of OFFICE_ROLES) {
        const code = app.config.permissionsOf({ config }, pack, role);
        const db = sqlJson(`select to_json(app.permissions_for(${lit(pack.id)}, ${lit(JSON.stringify(config))}::jsonb, ${lit(role)}))`);
        n++; if (!same(code, db)) bad.push(`${pack.id} ${role} ${JSON.stringify(config)}: ${diff(code, db)}`);
      }
    }
  }
  check(bad.length === 0, `a company's own role lists resolve the same way in domain/config.ts and in app.permissions_for (${n} cases)`, bad.slice(0, 5).join('\n      '));
} else {
  waiting.push('resolution of a company\'s own role lists: waiting for permissionsOf in src/domain/config.ts and rolePermissions in the packs');
}

// ---- 4: pipeline stages and lead sources, per edition
const stageKey = (s) => `${s.id}:${s.kind}:${s.role ?? ''}`;
let stageEditions = 0;
for (const pack of packs) {
  if (!Array.isArray(pack.leadStages) || !Array.isArray(pack.leadSources)) { waiting.push(`stages and sources of ${pack.id}: waiting for the pack to export leadStages and leadSources`); continue; }
  stageEditions++;
  const d = sqlJson(`select app.edition_defaults(${lit(pack.id)})`);
  check(JSON.stringify(pack.leadStages.map(stageKey)) === JSON.stringify(d.leadStages.map(stageKey)),
    `stages of ${pack.id}: same ids, in the same order, with the same kind and role`, `code: ${pack.leadStages.map(stageKey).join(' ')}  database: ${d.leadStages.map(stageKey).join(' ')}`);
  check(same(pack.leadSources.map((s) => s.id), d.leadSources), `lead sources of ${pack.id} are the same on both sides`, diff(pack.leadSources.map((s) => s.id), d.leadSources));
  check(sql(`select app.config_problem(${lit(JSON.stringify({ leadStages: pack.leadStages, leadSources: pack.leadSources, lostReasons: pack.lostReasons ?? [], taskTypes: pack.taskTypes ?? [], clientTypes: pack.clientTypes ?? [], roleLabels: pack.roleLabels ?? {} }))}::jsonb) is null`) === 't',
    `the blueprint of ${pack.id}, saved as a company's own configuration, passes the database's validation`);
}
if (app.config?.stagesOf && stageEditions > 0) {
  const own = { leadStages: [{ id: 'new', label: { en: 'New', es: 'Nuevo' }, kind: 'open' }, { id: 'closed', label: { en: 'Closed', es: 'Cerrado' }, kind: 'won' }, { id: 'gone', label: { en: 'Gone', es: 'Perdido' }, kind: 'lost' }], leadSources: [{ id: 'fair', label: { en: 'Fair', es: 'Feria' } }] };
  const bad = [];
  for (const pack of packs.filter((p) => Array.isArray(p.leadStages))) {
    for (const config of [{}, own, { leadStages: [], leadSources: [] }]) {
      const code = app.config.stagesOf({ config }, pack).map((s) => s.id);
      const db = sqlJson(`select coalesce(json_agg(s ->> 'id' order by n), '[]') from jsonb_array_elements(app.stages_of(${lit(pack.id)}, ${lit(JSON.stringify(config))}::jsonb)) with ordinality as x(s, n)`);
      if (JSON.stringify(code) !== JSON.stringify(db)) bad.push(`${pack.id} stages ${JSON.stringify(code)} vs ${JSON.stringify(db)}`);
      const codeSrc = app.config.sourcesOf({ config }, pack).map((s) => s.id);
      const dbSrc = sqlJson(`select to_json(app.sources_of(${lit(pack.id)}, ${lit(JSON.stringify(config))}::jsonb))`);
      if (!same(codeSrc, dbSrc)) bad.push(`${pack.id} sources ${JSON.stringify(codeSrc)} vs ${JSON.stringify(dbSrc)}`);
    }
  }
  check(bad.length === 0, 'the stages and sources in force (edition, or the company\'s own list) are the same in domain/config.ts and in the database', bad.slice(0, 5).join('\n      '));
}

// ---- 5: value lists in types.ts against CHECK constraints
function inlineUnion(pattern) {
  const m = stripComments(typesSrc).match(pattern);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
}
const constraintRows = sqlJson(`
  select coalesce(json_agg(json_build_object('t', c.conrelid::regclass::text, 'def', pg_get_constraintdef(c.oid))), '[]')
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype = 'c'`);
function allowed(table, column) {
  for (const row of constraintRows) {
    if (row.t !== table) continue;
    const m = row.def.match(new RegExp(`^CHECK \\(\\(${column} = ANY \\(ARRAY\\[(.*)\\]\\)\\)\\)$`));
    if (m) return [...m[1].matchAll(/'([^']+)'::text/g)].map((x) => x[1]);
  }
  return null;
}
const lists = [
  ['JobStatus', union('JobStatus'), [['jobs', 'status']]],
  ['TaskStatus', union('TaskStatus'), [['tasks', 'status']]],
  ['Priority', union('Priority'), [['leads', 'pri'], ['tasks', 'pri']]],
  ['PayMethod', union('PayMethod'), [['client_payments', 'method'], ['worker_payments', 'method']]],
  ['PayType', union('PayType'), [['workers', 'pay_type'], ['job_assignments', 'pay_type'], ['worker_payments', 'pay_type']]],
  ['Repeat', union('Repeat'), [['jobs', 'repeat']]],
  ['AssignStatus', union('AssignStatus'), [['job_assignments', 'status']]],
  ['NoteKind', union('NoteKind'), [['notes', 'kind']]],
  ['DocKind', union('DocKind'), [['documents', 'kind']]],
  ['DocStatus', union('DocStatus'), [['documents', 'status']]],
  ['RefType', union('RefType'), [['messages', 'ref_type'], ['activity', 'ref_type'], ['automation_runs', 'ref_type']]],
  ['OfficeRole + worker', [...(union('OfficeRole') || []), 'worker'], [['tenant_members', 'role']]],
  ['ESign.status', inlineUnion(/export interface ESign \{[\s\S]*?status: ([^;]+);/), [['documents', 'esign_status']]],
  ['MessageChannel', union('MessageChannel'), [['messages', 'channel'], ['tasks', 'channel']]],
  ['Message.status', inlineUnion(/export interface Message \{[\s\S]*?status: ([^;]+);/), [['messages', 'status']]],
  ['Message.dir', inlineUnion(/export interface Message \{[\s\S]*?dir\?: ([^;]+);/), [['messages', 'dir']]],
  ['ProviderId', union('ProviderId'), [['messages', 'provider']]],
  ['AutomationRun.status', inlineUnion(/export interface AutomationRun \{[\s\S]*?status\?: ([^;]+);/), [['automation_runs', 'status']]],
  ['Handoff.how', inlineUnion(/export interface Handoff \{[\s\S]*?how: ([^;}]+)/), [['lead_handoffs', 'how']]],
  ['Lead.kind', inlineUnion(/export interface Lead \{[\s\S]*?kind\?: ([^;]+);/), [['leads', 'kind']]],
  ['Client.kind', inlineUnion(/export interface Client \{[\s\S]*?kind\?: ([^;]+);/), [['clients', 'kind']]],
  ['Client.taxIdType', inlineUnion(/export interface Client \{[\s\S]*?taxIdType\?: ([^;]+);/), [['clients', 'tax_id_type'], ['client_secrets', 'tax_id_type']]],
  ['Client.lifecycle', inlineUnion(/export interface Client \{[\s\S]*?lifecycle\?: ([^;]+);/), [['clients', 'lifecycle']]],
  ['LeadRouting.mode', inlineUnion(/export interface LeadRouting \{[\s\S]*?mode: ([^;]+);/), [['lead_routing', 'mode']]],
  ['Lang', union('Lang'), [['demo_requests', 'language'], ['consent_records', 'language'], ['clients', 'lang'], ['leads', 'lang']]],
  // module tables (migrations 0030 to 0049)
  ['RuleEvent', union('RuleEvent'), [['rules', 'event']]],
  ['ApptStatus', union('ApptStatus'), [['appointments', 'status']]],
  ['Credit.reason', inlineUnion(/export interface Credit \{[\s\S]*?reason: ([^;]+);/), [['credits', 'reason']]],
  ['AccessRequest.status', inlineUnion(/export interface AccessRequest \{[\s\S]*?status: ([^;]+);/), [['access_requests', 'status']]],
  ['SecureAccessLog.action', inlineUnion(/export interface SecureAccessLog \{[\s\S]*?action: ([^;]+);/), [['secure_access_log', 'action']]],
  ['CatalogTier.unit', inlineUnion(/export interface CatalogTier \{[\s\S]*?unit: ([^;]+);/), [['catalog_tiers', 'unit']]],
  ['Opportunity.status', inlineUnion(/export interface Opportunity \{[\s\S]*?status: ([^;]+);/), [['opportunities', 'status']]],
  ['ReviewRequest.status', inlineUnion(/export interface ReviewRequest \{[\s\S]*?status: ([^;]+);/), [['review_requests', 'status']]],
  ['Signer.status', inlineUnion(/export interface Signer \{[\s\S]*?status: ([^;]+);/), [['envelope_signers', 'status']]],
  ['SignField.type', inlineUnion(/export interface SignField \{[\s\S]*?type: ([^;]+);/), [['envelope_fields', 'type']]],
  ['SocialPost.status', inlineUnion(/export interface SocialPost \{[\s\S]*?status: ([^;]+);/), [['social_posts', 'status']]],
  ['CashEntry.dir', inlineUnion(/export interface CashEntry \{[\s\S]*?dir: ([^;]+);/), [['cash_entries', 'dir']]],
  ['ComplianceItem.kind', inlineUnion(/export interface ComplianceItem \{[\s\S]*?kind: ([^;]+);/), [['compliance_items', 'kind']]],
  ['ComplianceItem.status', inlineUnion(/export interface ComplianceItem \{[\s\S]*?status: ([^;]+);/), [['compliance_items', 'status']]],
];
for (const [name, values, columns] of lists) {
  check(Array.isArray(values) && values.length > 0, `types.ts: ${name} was found`);
  for (const [table, column] of columns) {
    const db = allowed(table, column);
    check(!!db && !!values && same(values, db), `${name} matches the allowed values of ${table}.${column}`, db && values ? diff(values, db) : 'no CHECK constraint found on that column');
  }
}
// a rule's conditions and steps are JSON: their operator and step lists live in two functions, not in a CHECK
const ruleOps = inlineUnion(/export interface RuleCond \{[\s\S]*?op: ([^;]+);/);
const ruleSteps = inlineUnion(/export interface RuleStep \{[\s\S]*?do: ([^;]+);/);
check(!!ruleOps && same(ruleOps, sqlJson('select to_json(app.rule_ops())')), 'RuleCond.op in types.ts is the same list as app.rule_ops()', ruleOps ? diff(ruleOps, sqlJson('select to_json(app.rule_ops())')) : 'not found in types.ts');
check(!!ruleSteps && same(ruleSteps, sqlJson('select to_json(app.rule_step_kinds())')), 'RuleStep.do in types.ts is the same list as app.rule_step_kinds()', ruleSteps ? diff(ruleSteps, sqlJson('select to_json(app.rule_step_kinds())')) : 'not found in types.ts');
// every event of RuleEvent, read from types.ts, is accepted by the rule validation as a stored rule would be
const ruleEvents = union('RuleEvent') || [];
const dbEvents = allowed('rules', 'event') || [];
const refusedEvents = ruleEvents.filter((e) => !dbEvents.includes(e));
check(ruleEvents.length >= 30 && refusedEvents.length === 0, `all ${ruleEvents.length} events of RuleEvent in types.ts are accepted by rules.event`, 'refused: ' + JSON.stringify(refusedEvents));
// stages and sources are configuration now: plain strings in types.ts, and no fixed list on the columns
check(/export type LeadStage = string;/.test(typesSrc) && /export type LeadSource = string;/.test(typesSrc) && allowed('leads', 'status') === null && allowed('leads', 'source') === null,
  'lead stages and sources are free ids on both sides (validated against the company\'s configuration, not a fixed list)');
const stageKinds = inlineUnion(/export interface StageDef \{[\s\S]*?kind: ([^;]+);/) || [];
const stageRoles = inlineUnion(/export interface StageDef \{[\s\S]*?role\?: ([^;]+);/) || [];
check(stageKinds.length === 3 && stageKinds.every((k) => sql(`select app.config_problem(${lit(JSON.stringify({ leadStages: [{ id: 'a', label: { en: 'A', es: 'A' }, kind: 'open' }, { id: 'b', label: { en: 'B', es: 'B' }, kind: 'won' }, { id: 'c', label: { en: 'C', es: 'C' }, kind: 'lost' }, { id: 'x', label: { en: 'X', es: 'X' }, kind: k }] }))}::jsonb) is null`) === 't'),
  'the three stage kinds of StageDef are the three the database accepts');
check(stageRoles.length > 0 && stageRoles.every((r) => sql(`select app.config_problem(${lit(JSON.stringify({ leadStages: [{ id: 'a', label: { en: 'A', es: 'A' }, kind: 'open', role: r }, { id: 'b', label: { en: 'B', es: 'B' }, kind: 'won' }, { id: 'c', label: { en: 'C', es: 'C' }, kind: 'lost' }] }))}::jsonb) is null`) === 't'),
  'every stage role of StageDef is accepted by the database');

// ---- 6: editions
const pricing = JSON.parse(read('config/vyntex-build-pricing.json'));
const pricingProducts = [pricing.product, ...pricing.other_industries.products];
const industryIds = union('IndustryId') || [];
const dbIndustries = sqlJson(`select coalesce(json_agg(json_build_object('id', id, 'product', product_name) order by sort_order), '[]') from public.industries`);
check(same(industryIds, dbIndustries.map((r) => r.id)), 'editions in the database are exactly the IndustryId list in types.ts', diff(industryIds, dbIndustries.map((r) => r.id)));
// an edition that is quoted on request (the pack says priced: false) is not in the pricing file; every other one is
const unpriced = packs.filter((p) => p.priced === false).map((p) => p.product);
const pricedInDb = dbIndustries.map((r) => r.product).filter((p) => !unpriced.includes(p));
check(same(pricingProducts, pricedInDb), 'product names of the priced editions in the database are exactly the products in the pricing file', diff(pricingProducts, pricedInDb));
check(unpriced.every((p) => !pricingProducts.includes(p)), 'an edition that says it has no price is not in the pricing file');
for (const row of dbIndustries) {
  const pack = packs.find((p) => p.id === row.id);
  check(!!pack && pack.product === row.product, `edition ${row.id}: the pack names the same id and product (${row.product})`);
}

// ---- 7: plan ids
const planIds = [...pricing.plans.map((p) => p.id), ...pricing.other_industries.plans.map((p) => p.id)];
const badPlans = planIds.filter((id) => sql(`select (${lit(id)} ~ '^[a-z][a-z0-9_]{1,40}$')::int`) !== '1');
check(planIds.length === 6 && badPlans.length === 0, 'every plan id in the pricing file is accepted by the tenants.plan_id rule', 'refused: ' + JSON.stringify(badPlans));
check(sql(`select count(*) from information_schema.columns where table_schema = 'public' and column_name ~ '(price_usd|monthly|yearly|setup_fee)'`) === '0', 'no plan price is stored in the database');

// ---- 8: the gateway and the data model
/** Field names of an interface in types.ts (its own, plus those of the interface it extends). */
function fieldsOf(name) {
  const src = stripComments(typesSrc);
  const m = src.match(new RegExp(`export interface ${name}( extends (\\w+))? \\{`));
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1, body = '';
  for (; i < src.length && depth > 0; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') depth--; if (depth > 0) body += ch; }
  const fields = []; let d = 0, part = '';
  const flush = () => { const k = part.trim().match(/^([A-Za-z_]\w*)\??\s*:/); if (k) fields.push(k[1]); part = ''; };
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') d++;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') d--;
    if (ch === ';' && d === 0) flush(); else part += ch;
  }
  flush();
  return [...(m[2] ? fieldsOf(m[2]) || [] : []), ...fields];
}
const demoKeys = (fieldsOf('DemoState') || []).filter((k) => !['v', 'seededOn', 'seedLang', 'touched'].includes(k));
const registry = sqlJson(`select coalesce(json_agg(json_build_object('name', name, 'kind', kind, 'top', top_level, 'parent', parent) order by name), '[]')
  from (select distinct on (name) name, kind, top_level, parent from app.ws_collections order by name, variant) w`);
const topLevel = registry.filter((c) => c.top && !c.parent).map((c) => c.name);
check(demoKeys.length > 30 && same(demoKeys, topLevel), 'the keys of WorkspaceData (DemoState without its four demo-only keys) are exactly the collections ws_load returns', diff(demoKeys, topLevel));
const moduleCollections = union('ModuleCollection') || [];
check(moduleCollections.length > 0 && moduleCollections.every((c) => topLevel.includes(c)), 'every ModuleCollection of types.ts is registered (built, or announced as pending)', 'missing: ' + JSON.stringify(moduleCollections.filter((c) => !topLevel.includes(c))));

const models = {
  users: 'TeamUser', leads: 'Lead', 'leads.notes': 'Note', 'leads.handoffs': 'Handoff', clients: 'Client', 'clients.notes': 'Note', 'clients.owners': 'ClientPerson',
  'clients.contacts': 'ClientPerson', jobs: 'Job', 'jobs.assign': 'Assignment', 'jobs.expenses': 'Expense', 'jobs.received': 'Payment', 'jobs.log': 'WorkLog',
  'jobs.notes': 'Note', tasks: 'Task', 'tasks.comments': 'TaskComment', workers: 'Worker', workerPays: 'WorkerPayment', docs: 'DocRecord', messages: 'Message',
  activity: 'Activity', automationRuns: 'AutomationRun', audit: 'AuditEntry',
};
// fields the gateway adds on its own, and fields of the model that are deliberately not stored
const serverOnly = { workers: ['hasTaxId'] };
const notStored = { users: ['mfa'], audit: ['summary'] };
for (const [collection, iface] of Object.entries(models)) {
  const fields = fieldsOf(iface);
  const known = sqlJson(`select to_json(app.ws_known(${lit(collection)}))`).filter((k) => !['updatedAt', 'tenantId', 'tenant_id'].includes(k));
  check(!!fields && fields.length > 0, `types.ts: interface ${iface} was found`);
  if (!fields) continue;
  const stale = known.filter((k) => !fields.includes(k) && !(serverOnly[collection] || []).includes(k));
  check(stale.length === 0, `gateway map of ${collection}: every mapped field exists in ${iface}`, 'not in types.ts: ' + JSON.stringify(stale));
  const unmapped = fields.filter((k) => !known.includes(k) && !(notStored[collection] || []).includes(k));
  if (unmapped.length) notes.push(`${collection} (${iface}): ${unmapped.join(', ')} have no column yet and are kept in "extra"`);
}
check(sql(`select count(*) from app.ws_collections where kind = 'table' and to_regclass('public.' || quote_ident(relation)) is null`) === '0', 'every registered collection points at a table or view that exists');

if (failures.length) {
  console.error(`parity: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
console.log(`parity: ${passed} checks passed (addresses, capabilities and roles for ${matrixEditions} editions, stages for ${stageEditions} editions, value lists, editions, plan ids, gateway model)`);
for (const n of notes) console.log('  note: ' + n);
for (const w of waiting) console.log('  waiting: ' + w);
