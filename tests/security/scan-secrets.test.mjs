// Tests of scripts/security/scan-secrets.mjs: every key format is found, stand-ins are not, the value is never
// printed, and the command line answers with the right exit code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanText, scanTree, isPlaceholder, isWordy } from '../../scripts/security/scan-secrets.mjs';
import { fingerprint } from '../../scripts/security/lib.mjs';
import { tempDir, write, rand, mixed, fakeJwt, run, hasGit, git } from './helpers.mjs';

const HEX = '0123456789abcdef';
// name of the case, the rule that must fire, and a function that builds a value of that shape
const SHAPES = [
  ['Supabase service role key', 'supabase-service-role-jwt', () => fakeJwt('service_role')],
  ['Supabase anon key', 'supabase-anon-jwt', () => fakeJwt('anon')],
  ['other signed token', 'jwt', () => fakeJwt('authenticated')],
  ['Supabase secret key (new format)', 'supabase-secret-key', () => 'sb_' + 'secret_' + rand(32)],
  ['Supabase account token', 'supabase-access-token', () => 'sbp' + '_' + rand(40, HEX)],
  ['Resend', 'resend-key', () => 're' + '_' + rand(8) + '_' + rand(24)],
  ['Square access token', 'square-token', () => 'EA' + 'AA' + rand(60)],
  ['Square application secret', 'square-token', () => 'sq0' + 'csp-' + rand(43)],
  ['Meta access token', 'meta-token', () => 'EA' + 'AG' + rand(120)],
  ['Google API key', 'google-api-key', () => 'AI' + 'za' + rand(35)],
  ['Google OAuth client secret', 'google-oauth-secret', () => 'GOC' + 'SPX-' + rand(28)],
  ['Google refresh token', 'google-refresh-token', () => '1/' + '/0' + rand(60)],
  ['Anthropic', 'anthropic-key', () => 'sk-' + 'ant-' + 'api03-' + rand(80)],
  ['Stripe live key', 'stripe-key', () => 'sk' + '_live_' + rand(24)],
  ['Stripe test key', 'stripe-key', () => 'sk' + '_test_' + rand(24)],
  ['Stripe restricted key', 'stripe-key', () => 'rk' + '_live_' + rand(24)],
  ['Stripe webhook secret', 'stripe-webhook-secret', () => 'wh' + 'sec_' + rand(32)],
  ['GitHub token', 'github-token', () => 'gh' + 'p_' + rand(36)],
  ['AWS access key id', 'aws-access-key', () => 'AK' + 'IA' + rand(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')],
  ['age private key', 'age-secret-key', () => 'AGE-' + 'SECRET-KEY-1' + rand(58, 'ABCDEFGHJKLMNPQRSTUVWXYZ023456789')],
  ['private key block', 'private-key-block', () => '-----BEGIN ' + 'PRIVATE KEY-----\n' + rand(64) + '\n-----END ' + 'PRIVATE KEY-----'],
  ['RSA private key block', 'private-key-block', () => '-----BEGIN RSA ' + 'PRIVATE KEY-----'],
  ['OpenSSH private key block', 'private-key-block', () => '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----'],
  ['database address with password', 'database-url-password', () => 'postgres' + 'ql://postgres:' + rand(20) + '@db.abcdefghijklmnop.supabase.co:5432/postgres'],
  ['npm token', 'npm-token', () => '//registry.npmjs.org/:_auth' + 'Token=' + 'npm_' + rand(36)],
];

for (const [name, rule, make] of SHAPES) {
  test(`finds: ${name}`, () => {
    const value = make();
    const found = scanText(`const x = "${value}";\n`, 'src/a.js');
    assert.ok(found.some((f) => f.rule === rule), `expected rule ${rule}, got ${JSON.stringify(found.map((f) => f.rule))}`);
  });
}

test('a finding never contains the value it found', () => {
  for (const [, , make] of SHAPES) {
    const value = make();
    const secretPart = value.split('\n')[0];
    for (const f of scanText(`line one\nkey = "${value}"\n`, 'a.txt')) {
      assert.ok(!JSON.stringify(f).includes(secretPart.slice(0, 16)), 'the finding repeats the start of the secret');
      assert.equal(f.line, 2);
    }
  }
});

test('finds a random value assigned to a secret-looking name, quoted or in a settings file', () => {
  const v = mixed(40);
  assert.ok(scanText(`const SESSION_SECRET = '${v}';`, 'api/x.js').some((f) => f.rule === 'generic-secret'));
  assert.ok(scanText(`{ "apiKey": "${v}" }`, 'config/x.json').some((f) => f.rule === 'generic-secret'));
  assert.ok(scanText(`CRON_SECRET=${v}\n`, 'deploy/settings.sh').some((f) => f.rule === 'generic-secret'));
  assert.ok(scanText(`  WEBHOOK_TOKEN: ${v}\n`, 'deploy/k8s/secret.yaml').some((f) => f.rule === 'generic-secret'));
});

test('does not flag names, references and stand-ins', () => {
  const clean = [
    ['api/x.js', "const key = process.env.SUPABASE_SERVICE_ROLE_KEY;"],
    ['api/x.js', "const SESSION_SECRET = process.env.SESSION_SECRET || '';"],
    ['.env.example', 'SUPABASE_SERVICE_ROLE_KEY=\nRESEND_API_KEY=\nIP_HASH_SALT=\n'],
    ['docs/x.md', 'Set `STRIPE_SECRET_KEY` to the test key (begins with sk_test_).'],
    ['docs/x.md', 'postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'],
    ['docs/x.md', 'postgresql://postgres:[YOUR-PASSWORD]@host:5432/postgres'.replace('[YOUR-PASSWORD]', '${PGPASSWORD}')],
    ['.github/workflows/x.yml', '      GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}\n      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n'],
    ['tests/x.sh', "alter database d set app.settings.pii_encryption_key = 'local-test-key-0123456789-abcdefghijklmnop'"],
    ['src/x.ts', "const tokenStorageKey = 'vyntex.workspace.session.token.v1';"],
    ['deploy/k8s/secret.yaml', '  SESSION_SECRET: REPLACE_WITH_VALUE_FROM_PASSWORD_MANAGER\n'],
  ];
  for (const [file, text] of clean) assert.deepEqual(scanText(text, file).map((f) => f.rule), [], `${file}: ${text}`);
  assert.equal(isPlaceholder('<your-key-here>'), true);
  // values written as words are test values that say what they are
  for (const [file, text] of [
    ['tests/x.test.mjs', "process.env.SESSION_SECRET = '" + 'another-secret' + "-entirely-0123456789abcdef';"],
    ['tests/x.test.mjs', "const t = { access_token: '" + 'at-PLAINTEXT' + "-ACCESS-TOKEN-123456' };"],
    ['tests/x.test.mjs', "setTestEnv({ SUPABASE_SERVICE_ROLE_KEY: '" + 'service-key' + "-for-unit-tests-0123456789' });"],
  ]) assert.deepEqual(scanText(text, file), [], text);
  assert.equal(isWordy(mixed(40)), false);
  assert.equal(isWordy(mixed(12) + '-' + mixed(12) + '-' + mixed(12)), false, 'random parts between dashes are not words');
  assert.equal(isPlaceholder(mixed(40)), false);
});

test('the example environment file may list names only', () => {
  const filled = scanText(`RESEND_API_KEY=${'abc' + 'def' + '123456'}\nDEMO_REQUEST_TO=\n`, '.env.example');
  assert.deepEqual(filled.map((f) => f.rule), ['env-example-has-value']);
  assert.deepEqual(scanText('VX_DEPLOY=vyntex\nRESEND_API_KEY=\n', '.env.example'), []);
});

test('folder scan: finds environment and key files by name, skips installed packages and build output', (t) => {
  const dir = write(tempDir(t), {
    'src/ok.js': 'export const a = 1;\n',
    '.env': 'A=1\n',
    '.env.production': 'A=1\n',
    '.env.example': 'A=\n',
    'certs/server.pem': 'not really a key\n',
    'node_modules/pkg/index.js': `const k = "${'sk' + '_live_' + rand(24)}";\n`,
    'dist/assets/app.js': `const k = "${'sk' + '_live_' + rand(24)}";\n`,
    'dist-lbs/assets/app.js': `const k = "${'sk' + '_live_' + rand(24)}";\n`,
  });
  const { findings } = scanTree(dir, { all: true });
  assert.deepEqual(findings.map((f) => `${f.file}:${f.rule}`).sort(), ['.env.production:env-file', '.env:env-file', 'certs/server.pem:key-file']);
});

test('in a Git folder, a file that .gitignore excludes is left alone and a file that is not excluded is reported', { skip: !hasGit() && 'git is not installed' }, (t) => {
  const dir = write(tempDir(t), {
    '.gitignore': '.env\n.env.*\n!.env.example\n',
    '.env.local': `RESEND_API_KEY=${'re' + '_' + rand(8) + '_' + rand(24)}\n`,
    '.env.example': 'RESEND_API_KEY=\n',
    'src/a.js': 'export const a = 1;\n',
  });
  git(dir, 'init', '-q');
  // a build folder that .gitignore does not list yet is still not scanned as source
  write(dir, { 'dist-lbs/assets/app.js': `const k = "${'sk' + '_live_' + rand(24)}";\n` });
  assert.deepEqual(scanTree(dir).findings, [], 'the ignored .env.local must not be reported in Git mode');
  assert.ok(scanTree(dir, { all: true }).findings.some((f) => f.file === '.env.local'), '--all reads ignored files too');
  // a new file with a key that nothing ignores: found before it is ever committed
  write(dir, { 'src/leak.js': `const k = "${'sk-' + 'ant-' + rand(60)}";\n` });
  assert.deepEqual(scanTree(dir).findings.map((f) => `${f.file}:${f.rule}`), ['src/leak.js:anthropic-key']);
  // and still found once it is tracked
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'x');
  assert.equal(scanTree(dir).findings.length, 1);
});

test('allow-list: one exact value in one file, or a whole path, and nothing wider', (t) => {
  const value = 'sk' + '_test_' + rand(24);
  const other = 'sk' + '_test_' + rand(24);
  const dir = write(tempDir(t), { 'tests/fixture.js': `a("${value}");\n`, 'src/real.js': `a("${value}");\nb("${other}");\n`, 'vendor/x.js': `a("${other}");\n` });
  const allow = path.join(dir, 'allow.txt');
  fs.writeFileSync(allow, `# reviewed\nstripe-key:tests/fixture.js:${fingerprint(value)}   # a comment\npath:vendor/\npath:allow.txt\n`);
  const { findings } = scanTree(dir, { all: true, allow });
  assert.deepEqual(findings.map((f) => f.file), ['src/real.js', 'src/real.js'], 'the same value in another file is still reported');
  fs.writeFileSync(allow, 'this line has no colon\n');
  assert.throws(() => scanTree(dir, { all: true, allow }), /cannot read the line/);
});

test('command line: exit 0 when clean, 1 with findings, 2 when it cannot run; output has no secret', (t) => {
  const clean = write(tempDir(t), { 'a.js': 'export const a = 1;\n' });
  assert.equal(run('scan-secrets.mjs', ['--root', clean, '--all']).code, 0);
  const value = 'wh' + 'sec_' + rand(32);
  const dirty = write(tempDir(t), { 'a.js': `const s = "${value}";\n` });
  const r = run('scan-secrets.mjs', ['--root', dirty, '--all']);
  assert.equal(r.code, 1);
  assert.match(r.out, /a\.js:1\s+\[stripe-webhook-secret\]/);
  assert.ok(!r.out.includes(value), 'the output must not contain the secret');
  const j = run('scan-secrets.mjs', ['--root', dirty, '--all', '--json']);
  assert.equal(JSON.parse(j.out).findings.length, 1);
  assert.ok(!j.out.includes(value));
  assert.equal(run('scan-secrets.mjs', ['--root', path.join(clean, 'missing')]).code, 2);
});

test('this repository is clean', () => {
  const r = run('scan-secrets.mjs');
  assert.equal(r.code, 0, r.out);
});
