// Sealing of stored provider tokens, and the small crypto helpers. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTestEnv } from './helpers.mjs';

setTestEnv();
const { sealToken, openToken, needsReseal, sameString, pkcePair, pkceChallenge, randomToken, sha256Hex } = await import('../../api/_lib/crypto.js');
const tokens = { access_token: 'at-PLAINTEXT-ACCESS-TOKEN-123456', refresh_token: 'rt-PLAINTEXT-REFRESH-TOKEN-654321', expires_at: '2030-01-01T00:00:00.000Z' };

test('a sealed token opens to the same value', () => {
  const env = sealToken(tokens, 'conn:tenant-a:mock');
  assert.deepEqual(openToken(env, 'conn:tenant-a:mock'), tokens);
});

test('the envelope is versioned and holds nothing readable', () => {
  const env = sealToken(tokens, 'x');
  const parts = env.split('.');
  assert.equal(parts.length, 5);
  assert.equal(parts[0], 'v1');
  assert.match(parts[1], /^[0-9a-f]{8}$/);
  assert.ok(!env.includes('PLAINTEXT'));
  assert.ok(!Buffer.from(parts[4], 'base64url').toString('latin1').includes('PLAINTEXT'));
});

test('sealing the same value twice gives different envelopes', () => {
  assert.notEqual(sealToken(tokens, 'x'), sealToken(tokens, 'x'));
});

test('a changed envelope does not open', () => {
  const env = sealToken(tokens, 'x');
  const parts = env.split('.');
  for (const i of [2, 3, 4]) {
    const p = [...parts];
    const b = Buffer.from(p[i], 'base64url'); b[0] ^= 0x01; p[i] = b.toString('base64url');
    assert.equal(openToken(p.join('.'), 'x'), null, `part ${i} changed`);
  }
  assert.equal(openToken(env.replace(/^v1/, 'v2'), 'x'), null);
  assert.equal(openToken(env.slice(0, -3), 'x'), null);
  assert.equal(openToken('', 'x'), null);
  assert.equal(openToken(null, 'x'), null);
  assert.equal(openToken('not an envelope', 'x'), null);
});

test('a token sealed for one company and provider does not open for another', () => {
  const env = sealToken(tokens, 'conn:tenant-a:mock');
  assert.equal(openToken(env, 'conn:tenant-b:mock'), null);
  assert.equal(openToken(env, 'conn:tenant-a:other'), null);
  assert.equal(openToken(env, ''), null);
});

test('key rotation: the previous key still opens, and the envelope asks to be sealed again', () => {
  const oldKey = process.env.TOKEN_ENC_KEY;
  const env = sealToken(tokens, 'x');
  assert.equal(needsReseal(env), false);
  process.env.TOKEN_ENC_KEY = randomBytes(32).toString('base64');
  assert.equal(openToken(env, 'x'), null, 'without the previous key the old envelope is unreadable');
  process.env.TOKEN_ENC_KEY_PREVIOUS = oldKey;
  assert.deepEqual(openToken(env, 'x'), tokens);
  assert.equal(needsReseal(env), true);
  const again = sealToken(openToken(env, 'x'), 'x');
  assert.equal(needsReseal(again), false);
  assert.notEqual(again.split('.')[1], env.split('.')[1], 'the new envelope names the new key');
  delete process.env.TOKEN_ENC_KEY_PREVIOUS;
  assert.deepEqual(openToken(again, 'x'), tokens);
  process.env.TOKEN_ENC_KEY = oldKey;
});

test('a key of the wrong size is refused', () => {
  const keep = process.env.TOKEN_ENC_KEY;
  process.env.TOKEN_ENC_KEY = Buffer.from('too short').toString('base64');
  assert.throws(() => sealToken(tokens, 'x'), (e) => e.code === 'not_configured' && !String(e.message).includes('too short'));
  process.env.TOKEN_ENC_KEY = keep;
});

test('PKCE: the challenge is the S256 of the verifier (RFC 7636 appendix B)', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const p = pkcePair();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(p.challenge, pkceChallenge(p.verifier));
  assert.notEqual(pkcePair().verifier, p.verifier);
});

test('helpers', () => {
  assert.equal(sameString('abc', 'abc'), true);
  assert.equal(sameString('abc', 'abd'), false);
  assert.equal(sameString('abc', 'abcd'), false);
  assert.equal(sameString('abc', undefined), false);
  assert.match(randomToken(32), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
