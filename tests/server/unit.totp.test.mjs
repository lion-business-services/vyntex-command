// The TOTP implementation of the Supabase test double, against the published test vectors of RFC 6238 (SHA-1).
// The second sign-in step of the end-to-end tests is only as real as this function is correct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totp, totpValid, base32Encode, base32Decode, signJwt, verifyJwt } from '../../scripts/dev-supabase.mjs';

const SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

test('base32 round trip', () => {
  assert.equal(SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(SECRET).toString('ascii'), '12345678901234567890');
});

test('RFC 6238 appendix B vectors (the last six digits of the eight-digit values)', () => {
  const vectors = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
  for (const [seconds, code] of vectors) assert.equal(totp(SECRET, seconds * 1000), code, `T=${seconds}`);
});

test('a code is accepted for its own step and the one before and after, nothing else', () => {
  const at = 1_700_000_000_000;
  assert.equal(totpValid(SECRET, totp(SECRET, at), at), true);
  assert.equal(totpValid(SECRET, totp(SECRET, at - 30_000), at), true);
  assert.equal(totpValid(SECRET, totp(SECRET, at + 30_000), at), true);
  assert.equal(totpValid(SECRET, totp(SECRET, at - 90_000), at), false);
  assert.equal(totpValid(SECRET, '000000', at), totp(SECRET, at) === '000000' || totp(SECRET, at - 30000) === '000000' || totp(SECRET, at + 30000) === '000000');
  assert.equal(totpValid(SECRET, '', at), false);
});

test('the double signs and checks its tokens (HS256)', () => {
  const t = signJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 60 }, 'secret-a');
  assert.equal(verifyJwt(t, 'secret-a').sub, 'u');
  assert.equal(verifyJwt(t, 'secret-b'), null);
  assert.equal(verifyJwt(t.slice(0, -2) + 'xx', 'secret-a'), null);
  const forged = t.split('.'); forged[1] = Buffer.from(JSON.stringify({ sub: 'admin', role: 'service_role' })).toString('base64url');
  assert.equal(verifyJwt(forged.join('.'), 'secret-a'), null);
  assert.equal(verifyJwt(signJwt({ sub: 'u', exp: 1 }, 'secret-a'), 'secret-a').expired, true);
});
