// Unit tests for the shared CSV code (src/features/data): the parser and the writer, the column matching in English and
// Spanish, the dry run of an import (validation, duplicates, tax ID columns left out) and the import itself.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { parseCsv, parseCsvRecords, toCsv, detectDelimiter } from '@/features/data/csv';
  export { autoMap, planImport, applyImport, errorRows, templateRows, importFields, isSecureColumn, readDate, headerKey } from '@/features/data/importer';
  export { dict } from '@/features/data/i18n';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
`);
const { parseCsv, parseCsvRecords, toCsv, detectDelimiter, autoMap, planImport, applyImport, errorRows, templateRows, importFields, isSecureColumn, readDate, headerKey, dict, PACKS, makeT } = m;

/* ---------- parser ---------- */

test('parseCsv reads plain rows and drops a trailing empty line', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']], 'Windows line endings');
  assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']], 'old Mac line endings, no final line ending');
  assert.deepEqual(parseCsv(''), []);
});

test('parseCsv handles quotes, commas, doubled quotes and line breaks inside a cell', () => {
  const text = 'name,note\n"Rivera, Ana","She said ""call me"" twice"\n"Line one\nline two",x\n';
  assert.deepEqual(parseCsv(text), [['name', 'note'], ['Rivera, Ana', 'She said "call me" twice'], ['Line one\nline two', 'x']]);
});

test('parseCsv removes the mark Excel puts at the start of a file', () => {
  const rows = parseCsv('\uFEFFname,phone\nAna,609-555-0100');
  assert.equal(rows[0][0], 'name');
  assert.equal(rows[0][0].length, 4);
});

test('parseCsv keeps empty cells, including a quoted empty one and a trailing one', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3\n"",2,\n'), [['a', 'b', 'c'], ['1', '', '3'], ['', '2', '']]);
});

test('parseCsv skips rows that are entirely empty, unless asked to keep them', () => {
  assert.deepEqual(parseCsv('a,b\n\n,\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.equal(parseCsv('a,b\n,\n1,2\n', { keepEmptyRows: true }).length, 3);
});

test('parseCsv forgives a quote in the middle of a cell and a quoted cell that never closes', () => {
  assert.deepEqual(parseCsv('a,b\n5" pipe,ok\n'), [['a', 'b'], ['5" pipe', 'ok']]);
  assert.deepEqual(parseCsv('a,b\n"never closed,x\ny,z'), [['a', 'b'], ['never closed,x\ny,z']]);
});

test('a file from Excel in Spanish uses semicolons: the separator is worked out from the first line', () => {
  assert.equal(detectDelimiter('nombre;correo;teléfono\nAna;ana@example.com;609'), ';');
  assert.equal(detectDelimiter('name\tphone\nAna\t609'), '\t');
  assert.equal(detectDelimiter('"Last, First";phone\nx;y'), ';', 'a comma inside quotes does not count');
  assert.equal(detectDelimiter('single'), ',');
  assert.deepEqual(parseCsv('nombre;nota\n"Paredes; Ana";"dijo ""sí"""\n'), [['nombre', 'nota'], ['Paredes; Ana', 'dijo "sí"']]);
});

test('parseCsvRecords splits the header from the rows and trims the column names', () => {
  const { header, rows } = parseCsvRecords(' Name , Email \nAna,ana@example.com\n');
  assert.deepEqual(header, ['Name', 'Email']);
  assert.deepEqual(rows, [['Ana', 'ana@example.com']]);
});

/* ---------- writer ---------- */

test('toCsv quotes what needs quoting and nothing else, with Windows line endings', () => {
  const text = toCsv([['name', 'note', 'n'], ['Rivera, Ana', 'She said "hi"', 3], ['two\nlines', ' padded ', null], ['plain', undefined, 0]]);
  assert.equal(text, 'name,note,n\r\n"Rivera, Ana","She said ""hi""",3\r\n"two\nlines"," padded ",\r\nplain,,0\r\n');
});

test('what toCsv writes, parseCsv reads back unchanged', () => {
  const rows = [['name', 'note'], ['Ana "La Jefa" Paredes', 'line one\r\nline two, with a comma'], ['José Núñez', '日本語; semicolon'], ['', 'only the second cell']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
  assert.deepEqual(parseCsv(toCsv(rows, { delimiter: ';', bom: true })), rows, 'semicolons and the Excel mark too');
});

test('toCsv writes yes or no for a boolean and leaves out what is not a finite number', () => {
  assert.equal(toCsv([[true, false, NaN, Infinity]]), 'yes,no,,\r\n');
});

test('toCsv defuses a cell a spreadsheet would run as a formula, and leaves numbers and phone numbers alone', () => {
  const text = toCsv([['=HYPERLINK("http://evil.example")', '@SUM(A1)', '+1 (609) 555-0100', '-42.50', '-2+3', -7]]);
  const [row] = parseCsv(text);
  assert.equal(row[0], '\'=HYPERLINK("http://evil.example")');
  assert.equal(row[1], "'@SUM(A1)");
  assert.equal(row[2], '+1 (609) 555-0100', 'a phone number with a plus sign is not a formula');
  assert.equal(row[3], '-42.50');
  assert.equal(row[4], "'-2+3");
  assert.equal(row[5], '-7');
});

/* ---------- matching columns ---------- */

test('autoMap recognises English and Spanish column names, however they are typed', () => {
  assert.deepEqual(autoMap(['Full Name', 'E-mail', 'Phone Number', 'Company', 'Street Address', 'City', 'State', 'ZIP Code', 'Notes'], 'clients'),
    ['name', 'email', 'phone', 'company', 'address', 'city', 'state', 'zip', 'note']);
  assert.deepEqual(autoMap(['Nombre completo', 'Correo electrónico', 'TELÉFONO', 'Empresa', 'Dirección', 'Ciudad', 'Estado', 'Código postal', 'Idioma', 'Cumpleaños'], 'clients'),
    ['name', 'email', 'phone', 'company', 'address', 'city', 'state', 'zip', 'lang', 'birthday']);
  assert.deepEqual(autoMap(['First Name', 'Last Name', 'Source', 'Stage', 'Estimated value', 'Next action', 'Something else'], 'leads'),
    ['firstName', 'lastName', 'source', 'status', 'value', 'nextAction', '']);
  assert.deepEqual(autoMap(['Apellido', 'Origen', 'Etapa', 'Responsable', 'Próximo paso'], 'leads'), ['lastName', 'source', 'status', 'ownerId', 'nextAction']);
});

test('autoMap uses a field once and never maps a tax ID column', () => {
  assert.deepEqual(autoMap(['Email', 'Correo', 'SSN', 'Tax ID', 'EIN number', 'Seguro social'], 'clients'), ['email', '', '', '', '', '']);
  for (const h of ['SSN', 'ssn', 'Tax ID', 'TIN', 'EIN', 'ITIN', 'Social Security Number', 'Número de Seguro Social', 'ID fiscal']) assert.ok(isSecureColumn(h), h);
  for (const h of ['Name', 'Business name', 'Rating', 'Destination', 'Meeting', 'Opinion']) assert.ok(!isSecureColumn(h), h);
});

test('a template and an export read back in: every field is found by the name it has on screen, in both languages', () => {
  for (const kind of ['clients', 'leads']) {
    for (const lang of ['en', 'es']) {
      const fields = importFields(kind);
      const header = fields.map((f) => dict[lang][f.labelKey]);
      assert.ok(header.every(Boolean), `${kind}/${lang}: every field has a name`);
      assert.deepEqual(autoMap(header, kind), fields.map((f) => f.key), `${kind}/${lang}`);
    }
  }
});

test('readDate accepts year-month-day and month/day/year and refuses a date that does not exist', () => {
  assert.equal(readDate('2025-03-09'), '2025-03-09');
  assert.equal(readDate('3/9/2025'), '2025-03-09');
  assert.equal(readDate('03/09/84'), '1984-03-09');
  assert.equal(readDate('2025-03-09T14:00:00Z'), '2025-03-09');
  assert.equal(readDate('2/30/2025'), '');
  assert.equal(readDate('next week'), '');
  assert.equal(headerKey('  Teléfono_Móvil  '), 'telefono movil');
});

/* ---------- dry run and import ---------- */

const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
function world(edition = 'practice') {
  const pack = PACKS[edition];
  const d = blank(pack);
  d.users = [user('u1', 'owner', { name: 'Marisol Vega', officeIds: ['o1', 'o2'] }), user('u2', 'manager', { officeIds: ['o1'] }), user('u3', 'staff', { name: 'Ana Paredes', officeIds: ['o1'] })];
  d.offices = [{ id: 'o1', name: 'Northfield office', address: '' }, { id: 'o2', name: 'Vineland office', address: '' }];
  d.clients = [
    { id: 'c1', name: 'Dana Example', phone: '(609) 555-0142', email: 'Dana@Example.com', addresses: ['1 Sample Way'], since: '2024-01-01', notes: [], officeId: 'o1' },
    { id: 'c2', name: 'Hidden Person', phone: '856-555-0177', email: 'hidden@example.com', addresses: [], since: '2024-01-01', notes: [], officeId: 'o2', externalIds: { square: 'SQ-9' } },
  ];
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u3' };
  return { d, ctx, pack };
}
const run = (w, kind, text, opts = {}) => {
  const { header, rows } = parseCsvRecords(text);
  const mapping = autoMap(header, kind);
  const person = w.d.users.find((u) => u.id === (opts.as ?? 'u3'));
  const io = { data: w.d, pack: w.pack, user: person, allClients: !!opts.all, canSee: (c) => !c.officeId || person.officeIds.includes(c.officeId) };
  return { plan: planImport(io, kind, header, rows, mapping), io, header, mapping };
};

test('the dry run sorts rows into new, already on file and with a problem, and writes nothing', () => {
  const w = world();
  const { plan } = run(w, 'clients', [
    'Name,Email,Phone,Type,Language,Birthday,SSN',
    'Rosa Nueva,rosa@example.com,609-555-0101,LLC,Spanish,3/12/1984,000-00-0000',
    'Dana Again,dana@example.com,,Individual,,,',
    'Phone Match,,+1 609 555 0142,,,,',
    'No Contact,,,,,,',
    ',lost@example.com,,,,,',
    'Bad Email,not-an-email,609-555-0102,,,,',
    'Bad Type,type@example.com,,Wholesale,klingon,13/45/2020,',
    'Rosa Twice,ROSA@example.com,,,,,',
  ].join('\n'));
  assert.equal(w.d.clients.length, 2, 'nothing was written');
  assert.deepEqual(plan.counts, { total: 8, fresh: 1, duplicate: 3, invalid: 4, examples: 0 });
  assert.deepEqual(plan.secureColumns, ['SSN']);
  const by = Object.fromEntries(plan.rows.map((r) => [r.line, r]));
  assert.equal(by[2].status, 'new');
  assert.deepEqual({ type: by[2].values.clientType, lang: by[2].values.lang, birthday: by[2].values.birthday }, { type: 'llc', lang: 'es', birthday: '1984-03-12' });
  assert.ok(!Object.values(by[2].values).some((v) => String(v).includes('000-00-0000')), 'the tax ID column never becomes a value');
  assert.deepEqual({ where: by[3].duplicate.where, id: by[3].duplicate.id, by: by[3].duplicate.by }, { where: 'client', id: 'c1', by: 'email' });
  assert.equal(by[4].duplicate.by, 'phone', 'a phone with a country code is the same phone');
  assert.deepEqual(by[5].issues.map((i) => i.code), ['no_contact']);
  assert.deepEqual(by[6].issues.map((i) => i.code), ['no_name']);
  assert.deepEqual(by[7].issues.map((i) => i.code), ['email']);
  assert.deepEqual(by[8].issues.map((i) => i.code).sort(), ['date', 'option', 'option']);
  assert.deepEqual({ where: by[9].duplicate.where, line: by[9].duplicate.line }, { where: 'file', line: 2 }, 'the same person twice in one file');
});

test('a match in another office is reported by name only', () => {
  const w = world();
  const { plan } = run(w, 'clients', 'Name,Email,Square customer id\nSomeone,hidden@example.com,\nOther,other@example.com,SQ-9\n');
  assert.equal(plan.rows[0].duplicate.restricted, true);
  assert.equal(plan.rows[0].duplicate.id, undefined, 'no link to a record the person cannot open');
  assert.equal(plan.rows[1].duplicate.by, 'external', 'the same id in a connected system is the same client');
  const owner = run(w, 'clients', 'Name,Email\nSomeone,hidden@example.com\n', { as: 'u1', all: true });
  assert.equal(owner.plan.rows[0].duplicate.id, 'c2');
});

test('applyImport writes the new rows, skips the rest, and files the records under the office of whoever imports', () => {
  const w = world();
  const { plan, io } = run(w, 'clients', [
    'Full name,Company,Email,Phone,Address,City,State,ZIP code,Tags,Office,Text opt in,Email opt out,Note',
    'Rosa Nueva,,rosa@example.com,609-555-0101,5 Sample Road,Northfield,NJ,08225,"vip, monthly",Vineland office,yes,no,Met at the fair',
    ',Sample Bakery LLC,bakery@example.com,,,,,,,,,,',
    'Dana Again,,dana@example.com,,,,,,,,,,',
    'Broken,,nope,,,,,,,,,,',
  ].join('\n'));
  const out = applyImport(w.d, w.ctx, io, plan);
  assert.deepEqual({ created: out.created, dup: out.skippedDuplicates, invalid: out.invalid }, { created: 2, dup: 1, invalid: 1 });
  assert.equal(w.d.clients.length, 4);
  const rosa = w.d.clients.find((c) => c.name === 'Rosa Nueva');
  assert.deepEqual(rosa.addresses, ['5 Sample Road, Northfield, NJ 08225']);
  assert.deepEqual(rosa.tags, ['vip', 'monthly']);
  assert.equal(rosa.officeId, 'o1', 'an associate of one office cannot file a client under another');
  assert.equal(rosa.smsOptIn, true);
  assert.equal(rosa.emailOptOut, undefined);
  assert.equal(rosa.notes[0].text, 'Met at the fair');
  assert.equal(rosa.kind, 'individual');
  assert.equal(rosa.clientType, 'individual');
  const bakery = w.d.clients.find((c) => c.company === 'Sample Bakery LLC');
  assert.equal(bakery.name, 'Sample Bakery LLC', 'a business with no contact person is filed under its own name');
  assert.equal(bakery.kind, 'business');
  assert.notEqual(bakery.clientType, 'individual');
  assert.ok(w.d.activity.some((a) => a.kind === 'data.importedClients' && a.params.n === 2), 'the import is in the history');
  assert.ok(!JSON.stringify(w.d.clients).match(/taxId/), 'no tax field is ever set by an import');
});

test('someone who sees every office may file under any of them, and a duplicate is added only when ticked', () => {
  const w = world();
  const { plan, io } = run(w, 'clients', 'Name,Email,Office\nRosa Nueva,rosa@example.com,Vineland office\nDana Again,dana@example.com,\n', { as: 'u1', all: true });
  const out = applyImport(w.d, { ...w.ctx, actor: 'u1' }, io, plan, [3]);
  assert.equal(out.created, 2);
  assert.equal(out.skippedDuplicates, 0);
  assert.equal(w.d.clients.find((c) => c.name === 'Rosa Nueva').officeId, 'o2');
  assert.ok(w.d.clients.some((c) => c.name === 'Dana Again'));
});

test('the example row of the template is ignored, in either language', () => {
  const w = world();
  for (const lang of ['en', 'es']) {
    const rows = templateRows('clients', (f) => dict[lang][f.labelKey], dict[lang]['data.tpl.example']);
    const { plan } = run(w, 'clients', toCsv(rows));
    assert.deepEqual(plan.counts, { total: 0, fresh: 0, duplicate: 0, invalid: 0, examples: 1 }, lang);
  }
});

test('errorRows gives back the rows that were not imported, with the reason in a last column', () => {
  const w = world();
  const { plan } = run(w, 'clients', 'Name,Email\nRosa Nueva,rosa@example.com\nDana Again,dana@example.com\n"Broken, Row",nope\n');
  const rows = errorRows(plan, (r) => (r.status === 'invalid' ? r.issues.map((i) => i.code).join('+') : 'dup:' + r.duplicate.by), 'Why');
  assert.deepEqual(rows, [['Name', 'Email', 'Why'], ['Dana Again', 'dana@example.com', 'dup:email'], ['Broken, Row', 'nope', 'email']]);
  assert.deepEqual(parseCsv(toCsv(rows)), rows, 'the error file is itself a file that can be read back');
  assert.equal(errorRows(plan, () => '', 'Why', [3]).length, 2, 'a duplicate the person chose to add is not an error');
  const withTax = run(w, 'clients', 'Name,SSN,Email\nBroken,000-00-0000,nope\n').plan;
  assert.deepEqual(errorRows(withTax, () => 'x', 'Why'), [['Name', 'Email', 'Why'], ['Broken', 'nope', 'x']], 'a tax ID column is not written back out');
});

test('importing leads: stage, source, owner and value are read; no automation runs; the rotation assigns the rest', () => {
  const w = world();
  w.d.config.routing = { mode: 'round_robin', pool: ['u2', 'u3'], cursor: 0, exclude: [], skipAway: true };
  w.d.leads.push({ id: 'l0', ticket: 'VP-1001', name: 'Known Lead', phone: '609-555-0190', email: 'known@example.com', address: '', type: 'tax', source: 'phone', status: 'new', pri: 'medium', ownerId: 'u2', value: null, created: '2025-01-01', notes: [] });
  const { plan, io } = run(w, 'leads', [
    'Name,Phone,Email,Source,Stage,Service,Estimated value,Owner,Next action,Next action due,Received',
    'Lead One,609-555-0111,one@example.com,Referral,Proposal sent,Bookkeeping,"$1,250.00",Ana Paredes,Send the letter,2026-01-15,2025-12-01',
    'Lead Two,609-555-0112,,Sitio web,Ganado,Nómina,,,,,',
    'Lead Three,609-555-0113,,,,,,,,,',
    'Known Again,609-555-0190,,,,,,,,,',
    'Bad Stage,609-555-0114,,Carrier pigeon,Limbo,,abc,Nobody Here,,,',
  ].join('\n'));
  assert.deepEqual(plan.counts, { total: 5, fresh: 3, duplicate: 1, invalid: 1, examples: 0 });
  assert.equal(plan.rows[3].duplicate.where, 'lead');
  assert.deepEqual(plan.rows[4].issues.map((i) => i.code).sort(), ['money', 'option', 'option', 'person']);
  const tasksBefore = w.d.tasks.length; const jobsBefore = w.d.jobs.length;
  const out = applyImport(w.d, w.ctx, io, plan);
  assert.equal(out.created, 3);
  const one = w.d.leads.find((l) => l.name === 'Lead One');
  assert.deepEqual({ source: one.source, status: one.status, type: one.type, value: one.value, owner: one.ownerId, next: one.nextAction, created: one.created },
    { source: 'referral', status: 'proposal', type: 'bookkeeping', value: 1250, owner: 'u3', next: { text: 'Send the letter', due: '2026-01-15' }, created: '2025-12-01' });
  const two = w.d.leads.find((l) => l.name === 'Lead Two');
  assert.deepEqual({ source: two.source, status: two.status, type: two.type }, { source: 'website', status: 'won', type: 'payroll' }, 'Spanish labels are read too');
  assert.equal(two.jobId, undefined, 'a lead imported as won creates nothing');
  assert.equal(w.d.jobs.length, jobsBefore);
  assert.equal(w.d.tasks.length, tasksBefore, 'no call-back tasks for imported leads');
  assert.equal(two.ownerId, 'u2', 'the rotation gives the first unassigned lead to the first person');
  assert.equal(w.d.leads.find((l) => l.name === 'Lead Three').ownerId, 'u3');
  assert.equal(two.handoffs[0].how, 'round_robin');
  assert.equal(new Set(w.d.leads.map((l) => l.ticket)).size, w.d.leads.length, 'every lead has its own ticket number');
});
