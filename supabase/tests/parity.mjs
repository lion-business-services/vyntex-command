// Checks that the app code and the database say the same thing. Run by run_local.sh against the local test database.
//   1. reserved company addresses: src/platform/mode.ts  ==  app.reserved_slugs()
//   2. address validation:         isValidSlug()         ==  app.is_valid_slug(), over a list of tricky samples
//   3. role matrix:                src/domain/permissions.ts  ==  app.role_permissions()
//   4. value lists:                the unions in src/domain/types.ts  ==  the CHECK constraints of the matching columns
//   5. industries:                 seed rows  ==  the packs in src/packs  ==  the products in the pricing file
//   6. plan ids in the pricing file are accepted by the tenants.plan_id rule
// Connection comes from the usual PG* environment variables; PSQL is the path of the psql program.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const psql = process.env.PSQL || 'psql';
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function sql(query) {
  return execFileSync(psql, ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
}
const sqlJson = (query) => JSON.parse(sql(query));

/** Compiles one TypeScript file that has no runtime imports and loads it as a module. */
async function loadTs(rel) {
  const js = transformSync(read(rel), { loader: 'ts', format: 'esm' }).code;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vyntex-parity-')), path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(file, js);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

let passed = 0;
const failures = [];
function check(ok, label, detail) {
  if (ok) passed++; else failures.push(label + (detail ? '\n      ' + detail : ''));
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const diff = (a, b) => `only in code: ${JSON.stringify(a.filter((x) => !b.includes(x)))}  only in database: ${JSON.stringify(b.filter((x) => !a.includes(x)))}`;

// ---- 1 and 2: company addresses
const mode = await loadTs('src/platform/mode.ts');
const dbReserved = sqlJson('select to_json(app.reserved_slugs())');
check(same(mode.RESERVED_SLUGS, dbReserved), 'reserved company addresses are the same list in mode.ts and in the database', diff([...mode.RESERVED_SLUGS], dbReserved));

const samples = [
  'acme', 'acme-builders', 'a1', 'abc', 'ab', 'a', '', 'a-b', 'a--b', '-abc', 'abc-', 'Acme', 'ACME', 'acme builders', 'acme_builders',
  'acme.builders', 'acme/builders', 'ácme', 'niño-landscaping', '123', '1-2-3', 'x'.repeat(40), 'x'.repeat(41), 'abc\n', '\nabc', ' abc',
  'abc ', 'ab-c-d-e-f', 'demo', 'demo1', 'demos', 'api', 'apis', 'request-demo', 'request-demos', 'login', 'my-login', 'null',
  'undefined', 'vyntex', 'vyntex-build', 'admin', 'administrator', 'worker', 'workers', 'assets', 'brand', 'pricing', '%61cme',
  'acme?x=1', 'acme#top', '..', 'a-b-', 'a-', '0', '000', 'abc--def', 'sign', 'signs', ...mode.RESERVED_SLUGS,
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
check(mode.RESERVED_SLUGS.every((s) => mode.resolvePath('/' + s).mode !== 'workspace'), 'resolvePath: no reserved word resolves to a company');

// ---- 3: role matrix
const permSrc = read('src/domain/permissions.ts');
const matrixText = permSrc.match(/const MATRIX[^=]*=\s*(\{[\s\S]*?\n\});/);
check(!!matrixText, 'the role matrix was found in src/domain/permissions.ts');
if (matrixText) {
  const codeMatrix = new Function('return ' + matrixText[1])();
  const perms = await loadTs('src/domain/permissions.ts');
  for (const role of ['owner', 'manager', 'staff']) {
    const dbPerms = sqlJson(`select to_json(app.role_permissions('${role}'))`);
    check(same(codeMatrix[role] || [], dbPerms), `role matrix: ${role} holds the same permissions in permissions.ts and in the database`, diff(codeMatrix[role] || [], dbPerms));
    check(dbPerms.every((p) => perms.can(role, p)), `role matrix: can('${role}', ...) agrees for every permission`);
  }
  check(Object.keys(codeMatrix).sort().join() === 'manager,owner,staff', 'role matrix: the office roles are owner, manager, staff');
  check(sqlJson(`select to_json(app.role_permissions('worker'))`).length === 0 && !perms.can('worker:w1', 'tasks'), 'role matrix: a worker holds no office permission on either side');
}

// ---- 4: value lists in types.ts against CHECK constraints
const typesSrc = read('src/domain/types.ts');
function union(name) {
  const m = typesSrc.match(new RegExp(`export type ${name} = ([^;]+);`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
function inlineUnion(pattern) {
  const m = typesSrc.match(pattern);
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
  ['LeadStage', union('LeadStage'), [['leads', 'status']]],
  ['LeadSource', union('LeadSource'), [['leads', 'source']]],
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
  ['Message.channel', inlineUnion(/export interface Message \{[\s\S]*?channel: ([^;]+);/), [['messages', 'channel']]],
  ['Lang', union('Lang'), [['demo_requests', 'language'], ['consent_records', 'language']]],
];
for (const [name, values, columns] of lists) {
  check(Array.isArray(values) && values.length > 0, `types.ts: ${name} was found`);
  for (const [table, column] of columns) {
    const db = allowed(table, column);
    check(!!db && !!values && same(values, db), `${name} matches the allowed values of ${table}.${column}`, db && values ? diff(values, db) : 'no CHECK constraint found on that column');
  }
}

// ---- 5: industries
const pricing = JSON.parse(read('config/vyntex-build-pricing.json'));
const pricingProducts = [pricing.product, ...pricing.other_industries.products];
const industryIds = union('IndustryId') || [];
const dbIndustries = sqlJson(`select coalesce(json_agg(json_build_object('id', id, 'product', product_name) order by sort_order), '[]') from public.industries`);
check(same(industryIds, dbIndustries.map((r) => r.id)), 'industries in the database are exactly the IndustryId list in types.ts', diff(industryIds, dbIndustries.map((r) => r.id)));
check(same(pricingProducts, dbIndustries.map((r) => r.product)), 'industry product names in the database are exactly the products in the pricing file', diff(pricingProducts, dbIndustries.map((r) => r.product)));
for (const row of dbIndustries) {
  const file = `src/packs/${row.id}/pack.ts`;
  const src = fs.existsSync(path.join(root, file)) ? read(file) : '';
  const id = src.match(/\bid:\s*["']([^"']+)["']/);
  const product = src.match(/\bproduct:\s*["']([^"']+)["']/);
  check(!!id && id[1] === row.id && !!product && product[1] === row.product, `industry ${row.id}: the pack names the same id and product (${row.product})`);
}

// ---- 6: plan ids
const planIds = [...pricing.plans.map((p) => p.id), ...pricing.other_industries.plans.map((p) => p.id)];
const badPlans = planIds.filter((id) => sql(`select ('${id.replace(/'/g, "''")}' ~ '^[a-z][a-z0-9_]{1,40}$')::int`) !== '1');
check(planIds.length === 6 && badPlans.length === 0, 'every plan id in the pricing file is accepted by the tenants.plan_id rule', 'refused: ' + JSON.stringify(badPlans));
check(sql(`select count(*) from information_schema.columns where table_schema = 'public' and column_name ~ '(price_usd|monthly|yearly|setup_fee)'`) === '0', 'no plan price is stored in the database');

if (failures.length) {
  console.error(`parity: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
console.log(`parity: ${passed} checks passed (addresses, role matrix, value lists, industries, plan ids)`);
