// Tests of scripts/security/scan-pii.mjs: tax ID formats and lists of real-looking people are found, sample data
// written by this repository's rule (example.com, 555 numbers) is not, and no value is ever printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { scanText, scanTree, sqlInserts, plausibleSsn, dummySsn, fictionalEmail, fictionalPhone } from '../../scripts/security/scan-pii.mjs';
import { tempDir, write, rand, run } from './helpers.mjs';

const DIGITS = '0123456789';
// A number in the issued range, made at run time. Not a real person's: it is random.
const ssn = () => ['4' + rand(2, '1234'), '5' + rand(1, '1234'), '6' + rand(3, '1234')].join('-');
const ein = () => '12' + '-' + '3' + rand(6, DIGITS);
// Contacts that look real to the scan (an ordinary domain, an ordinary exchange) and belong to nobody.
const realLooking = (i) => ({ first: 'Person' + i, last: 'Number' + i, email: `person${i}@mail-${rand(5, 'abcdefgh')}.com`, phone: `(609) 4${String(10 + i).padStart(2, '0')}-${String(1000 + i)}` });
const sample = (i) => ({ first: 'Sample' + i, last: 'Client', email: `client${i}@example.com`, phone: `(609) 555-${String(100 + i).padStart(4, '0')}` });
const insertSql = (rows, extraCols = '', extraVals = () => '') =>
  `insert into public.clients (first_name, last_name, email, phone${extraCols}) values\n` +
  rows.map((r, i) => `  ('${r.first}', '${r.last}', '${r.email}', '${r.phone}'${extraVals(i)})`).join(',\n') + '\non conflict (email) do update set phone = excluded.phone;\n';
const rules = (found) => found.map((f) => f.rule);

test('tax ID formats: full numbers are found, masked and stand-in numbers are not', () => {
  assert.deepEqual(rules(scanText(`tax id ${ssn()}`, 'a.txt')), ['ssn']);
  assert.deepEqual(rules(scanText(`ssn: ${ssn().replace(/-/g, '')}`, 'a.txt')), ['ssn']);
  assert.deepEqual(rules(scanText(`EIN ${ein()}`, 'a.txt')), ['ein']);
  for (const clean of ['SSN ***-**-1234', 'XXX-XX-1234', 'tax id 123-45-6789', 'tax id 111-22-3333', 'tax id 999-99-9999', 'tax id 000-12-3456', 'tax id 666-12-3456', 'order 12-' + '3456789', 'last four 1234', '2026-10-03', 'call 609-555-0123']) {
    assert.deepEqual(scanText(clean, 'a.txt'), [], clean);
  }
  assert.equal(plausibleSsn('900', '70', '1234'), true, 'an ITIN is a tax ID too');
  assert.equal(plausibleSsn('900', '10', '1234'), false);
  assert.equal(dummySsn('123', '45', '6789'), true);
});

test('what counts as sample data', () => {
  for (const d of ['example.com', 'mail.example.org', 'example.net', 'firm.example', 'x.test', 'y.invalid']) assert.equal(fictionalEmail(d), true, d);
  for (const d of ['gmail.com', 'examples.com', 'notexample.com', 'lionbusiness.co']) assert.equal(fictionalEmail(d), false, d);
  assert.equal(fictionalPhone('609', '555'), true);
  assert.equal(fictionalPhone('609', '780'), false);
});

test('an import of real-looking customers in a migration is found (the NOVA case)', () => {
  const rows = Array.from({ length: 200 }, (_, i) => realLooking(i));
  const sql = '-- customers import\n' + insertSql(rows, ', square_customer_id', (i) => `, '${rand(26, 'ABCDEFGHJKMNPQRSTVWXYZ0123456789')}'`);
  const found = scanText(sql, 'supabase/migrations/0015_customers_import.sql');
  assert.deepEqual(rules(found).sort(), ['bulk-contacts', 'bulk-contacts', 'provider-export']);
  assert.match(found.find((f) => f.rule === 'provider-export').message, /200 row\(s\)/);
  const text = JSON.stringify(found);
  for (const r of rows.slice(0, 20)) { assert.ok(!text.includes(r.email)); assert.ok(!text.includes(r.phone)); }
});

test('the same shape with sample data is clean', () => {
  const rows = Array.from({ length: 200 }, (_, i) => sample(i));
  assert.deepEqual(scanText(insertSql(rows), 'supabase/seed.sql'), []);
  // a seed written as code, as the packs do
  const ts = rows.map((r) => `{ name: '${r.first} ${r.last}', email: '${r.email}', phone: '${r.phone}' },`).join('\n');
  assert.deepEqual(scanText(ts, 'src/packs/build/seed.ts'), []);
});

test('threshold: a few business addresses are normal, a list is not', () => {
  const text = (n) => Array.from({ length: n }, (_, i) => realLooking(i).email).join('\n');
  assert.deepEqual(scanText(text(4), 'README.md'), []);
  assert.deepEqual(rules(scanText(text(5), 'README.md')), ['bulk-contacts']);
  assert.deepEqual(scanText(text(5), 'README.md', { threshold: 6 }), []);
  assert.deepEqual(scanText('icon@2x.png logo@3x.webp react@19.2.0 actions/checkout@v4 x@types/react', 'a.md'), [], 'file names and versions are not addresses');
});

test('a large block of person rows without contacts still asks for a look', () => {
  const rows = Array.from({ length: 25 }, (_, i) => `('Person${i}', 'Number${i}', '${100 + i} Any Street')`).join(',\n');
  const sql = `insert into clients (first_name, last_name, address_line1) values\n${rows};`;
  assert.deepEqual(rules(scanText(sql, 'supabase/migrations/0099_import.sql')), ['bulk-records']);
  const few = `insert into clients (first_name, last_name, address_line1) values ('A', 'B', 'C'), ('D', 'E', 'F');`;
  assert.deepEqual(scanText(few, 'supabase/migrations/0099_import.sql'), []);
  // reference data with many rows and no person columns is not a customer list
  const ref = `insert into industries (id, label) values\n${Array.from({ length: 40 }, (_, i) => `('i${i}', 'Label ${i}')`).join(',\n')};`;
  assert.deepEqual(scanText(ref, 'supabase/seed.sql'), []);
});

test('CSV and JSON exports are found by their shape', () => {
  const rows = Array.from({ length: 30 }, (_, i) => realLooking(i));
  const csv = 'First Name,Last Name,Email,Phone\n' + rows.map((r) => `${r.first},${r.last},${r.email},${r.phone}`).join('\n');
  assert.ok(rules(scanText(csv, 'data/export.csv')).includes('bulk-records'));
  const json = JSON.stringify(rows.map((r) => ({ first_name: r.first, last_name: r.last, email: r.email, phone: r.phone })), null, 1);
  assert.ok(rules(scanText(json, 'data/customers.json')).includes('bulk-records'));
  const sampleJson = JSON.stringify(Array.from({ length: 30 }, (_, i) => sample(i)).map((r) => ({ first_name: r.first, email: r.email, phone: r.phone })));
  assert.deepEqual(scanText(sampleJson, 'data/sample.json'), []);
});

test('counting the rows of an insert: quotes, brackets inside values and the "on conflict" tail', () => {
  const sql = `insert into t (a, b) values ('x (y)', now()), ('it''s; fine', coalesce(null, 'z')), -- note (not a row)\n ('p', 'q')\non conflict (a) do update set b = coalesce(excluded.b, t.b);\ninsert into "public"."u" (a) values ('one');`;
  const ins = sqlInserts(sql);
  assert.deepEqual(ins.map((i) => [i.table, i.rows]), [['t', 3], ['"public"."u"', 1]]);
});

test('folder scan, allow-list and command line exit codes; the output holds no personal data', (t) => {
  const rows = Array.from({ length: 12 }, (_, i) => realLooking(i));
  const dir = write(tempDir(t), {
    'supabase/migrations/0002_import.sql': insertSql(rows),
    'src/ok.ts': 'export const a = 1;\n',
    'package-lock.json': rows.map((r) => r.email).join('\n'),
    'node_modules/x/people.txt': rows.map((r) => r.email).join('\n'),
  });
  const { findings } = scanTree(dir, { all: true });
  assert.deepEqual([...new Set(findings.map((f) => f.file))], ['supabase/migrations/0002_import.sql']);
  const r = run('scan-pii.mjs', ['--root', dir, '--all']);
  assert.equal(r.code, 1);
  for (const row of rows) { assert.ok(!r.out.includes(row.email)); assert.ok(!r.out.includes(row.phone)); }
  const allow = path.join(dir, 'allow.txt');
  fs.writeFileSync(allow, 'path:supabase/migrations/0002_import.sql   # reviewed in this test\n');
  assert.equal(run('scan-pii.mjs', ['--root', dir, '--all', '--allow', allow]).code, 0);
  assert.equal(run('scan-pii.mjs', ['--root', path.join(dir, 'missing')]).code, 2);
  assert.equal(run('scan-pii.mjs', ['--root', dir, '--threshold', '0']).code, 2);
});

test('this repository is clean', () => {
  const r = run('scan-pii.mjs');
  assert.equal(r.code, 0, r.out);
});
