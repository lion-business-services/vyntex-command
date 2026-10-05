// Tests of scripts/security/check-evidence.mjs: a security document may only point at files and tests that exist,
// and the product's screens may not claim a certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAll, citedPaths } from '../../scripts/security/check-evidence.mjs';
import { tempDir, write, run } from './helpers.mjs';

const repo = (t, files) => write(tempDir(t), { 'supabase/tests/rules.sql': "select test.ok(true, 'anon reads nothing');\n", 'src/app.ts': 'export const a = 1;\n', ...files });
const rules = (dir) => checkAll(dir).findings.map((f) => `${f.rule}:${f.line}`);

test('a document that points at files and tests that exist is clean', (t) => {
  const dir = repo(t, { 'docs/security/map.md': '| Isolation | `supabase/tests/rules.sql` test: "anon reads nothing" | Implemented |\nSee `src/app.ts` and `supabase/tests/*.sql`.\n' });
  assert.deepEqual(rules(dir), []);
});

test('a missing file, a missing test and a test with no file are each reported with their line', (t) => {
  const dir = repo(t, { 'docs/security/map.md': [
    'Proved by `supabase/tests/gone.sql`.',
    '`supabase/tests/rules.sql` test: "a check that was renamed"',
    'It is covered, test: "anon reads nothing"',
    'Nothing matches `supabase/tests/*.mjs`.',
  ].join('\n') });
  assert.deepEqual(rules(dir), ['missing-file:1', 'missing-test:2', 'test-without-file:3', 'missing-file:4']);
});

test('open items, the other repository, code blocks and things that are never in the repository are not citations', (t) => {
  const dir = repo(t, { 'docs/security/map.md': [
    'The server document (planned as `docs/SERVER.md`) is not written.',
    'Reveal flow: not yet proven, see `supabase/tests/vault.sql` when it exists.',
    'In the NOVA repository there is `supabase/migrations/0015_customers_import.sql`.',
    '```',
    'node `supabase/tests/not-a-citation.sql`',
    '```',
    'The build goes to `dist/` and `dist-lbs/`, libraries to `node_modules/`, local settings to `.env.local`.',
    'Commands such as `npm run test:db` and names such as `SUPABASE_URL` or `app.can()` are not paths.',
  ].join('\n') });
  assert.deepEqual(rules(dir), []);
});

test('only the security documents are checked', (t) => {
  const dir = repo(t, { 'docs/OTHER.md': 'See `supabase/tests/gone.sql`.', 'README.md': 'See `supabase/tests/gone.sql`.', 'deploy/k8s/README.md': 'See `supabase/tests/gone.sql`.', 'SECURITY.md': 'See `supabase/tests/gone.sql`.', 'docs/DEPLOYMENT.md': 'See `supabase/tests/gone.sql`.' });
  assert.deepEqual(checkAll(dir).findings.map((f) => f.file).sort(), ['SECURITY.md', 'deploy/k8s/README.md', 'docs/DEPLOYMENT.md']);
});

test('reading the paths of a line', () => {
  const top = new Set(['supabase', 'api', 'vercel.json', '.github']);
  assert.deepEqual(citedPaths('`supabase/tests/a.sql`, `api/_lib/env.js`. `vercel.json` and `.github/CODEOWNERS`; not `other/x.js`, `https://example.com/api`, `api/<name>.js`', top),
    ['supabase/tests/a.sql', 'api/_lib/env.js', 'vercel.json', '.github/CODEOWNERS']);
});

test('a screen that claims a certification is reported; a sentence that only names a rule is not', (t) => {
  const claims = ['IRS ' + 'compliant', 'SOC 2 ' + 'certified', 'HIPAA-' + 'compliant', 'PCI ' + 'compliant', 'legally ' + 'compliant', 'bank-level ' + 'security', 'WISP ' + 'certified'];
  for (const c of claims) {
    const dir = repo(t, { 'src/features/about/i18n.ts': `export const dict = { en: { 'about.badge': '${c} platform' } };\n` });
    assert.deepEqual(checkAll(dir).findings.map((f) => f.rule), ['compliance-claim'], c);
  }
  const fine = repo(t, { 'src/features/about/i18n.ts': "export const dict = { en: { a: 'Built to support your written information security plan', b: '1099 compliance tracking', c: 'Records for an IRS review' } };\n" });
  assert.deepEqual(checkAll(fine).findings, []);
  // the documents may quote the forbidden phrases to forbid them
  const doc = repo(t, { 'docs/security/map.md': 'The product never says "' + 'IRS ' + 'compliant".' });
  assert.deepEqual(checkAll(doc).findings, []);
});

test('command line exit codes, and this repository is clean', (t) => {
  const bad = repo(t, { 'docs/security/map.md': 'See `supabase/tests/gone.sql`.' });
  assert.equal(run('check-evidence.mjs', ['--root', bad]).code, 1);
  assert.equal(run('check-evidence.mjs', ['--root', bad + '/missing']).code, 2);
  const here = run('check-evidence.mjs');
  assert.equal(here.code, 0, here.out);
});
