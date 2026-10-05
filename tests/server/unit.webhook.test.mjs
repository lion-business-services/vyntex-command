// Webhook signature checks on the raw body, and the replay window. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTestEnv, svixHeaders, mockSignature } from './helpers.mjs';

setTestEnv();
const W = await import('../../api/_lib/integrations/webhook.js');
const secret = 'whsec_' + randomBytes(24).toString('base64');
const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-01-01T00:00:00Z', data: { email_id: 'e_1' } });
const H = (h) => new Headers(h);

test('Svix style: a correct signature over the raw body passes', () => {
  const h = svixHeaders(secret, body, { id: 'msg_1' });
  assert.deepEqual(W.verifySvix(secret, H(h), Buffer.from(body)), { ok: true, id: 'msg_1', timestamp: Number(h['svix-timestamp']) });
});

test('Svix style: a wrong signature, a changed body or a changed id is refused', () => {
  const h = svixHeaders(secret, body, { id: 'msg_1' });
  assert.equal(W.verifySvix(secret, H({ ...h, 'svix-signature': 'v1,' + Buffer.from('wrong').toString('base64') }), Buffer.from(body)).reason, 'bad_signature');
  assert.equal(W.verifySvix(secret, H(h), Buffer.from(body.replace('e_1', 'e_2'))).reason, 'bad_signature');
  assert.equal(W.verifySvix(secret, H(h), Buffer.from(body + ' ')).reason, 'bad_signature', 'even one extra byte: the raw body is what was signed');
  assert.equal(W.verifySvix(secret, H({ ...h, 'svix-id': 'msg_2' }), Buffer.from(body)).reason, 'bad_signature');
  assert.equal(W.verifySvix('whsec_' + randomBytes(24).toString('base64'), H(h), Buffer.from(body)).reason, 'bad_signature', 'signed with another secret');
  assert.equal(W.verifySvix(secret, H({ ...h, 'svix-signature': 'v2,' + h['svix-signature'].slice(3) }), Buffer.from(body)).reason, 'bad_signature', 'an unknown scheme does not count');
});

test('Svix style: missing parts are refused', () => {
  const h = svixHeaders(secret, body);
  for (const k of ['svix-id', 'svix-timestamp', 'svix-signature']) { const x = { ...h }; delete x[k]; assert.equal(W.verifySvix(secret, H(x), Buffer.from(body)).reason, 'signature_missing'); }
  assert.equal(W.verifySvix('', H(h), Buffer.from(body)).reason, 'signature_missing');
  assert.equal(W.verifySvix(secret, H({ ...h, 'svix-timestamp': 'yesterday' }), Buffer.from(body)).reason, 'bad_timestamp');
});

test('Svix style: several signatures (during a secret change) pass when one is right', () => {
  const h = svixHeaders(secret, body);
  h['svix-signature'] = 'v1,' + Buffer.from('old-secret-signature').toString('base64') + ' ' + h['svix-signature'];
  assert.equal(W.verifySvix(secret, H(h), Buffer.from(body)).ok, true);
});

test('replay window: a correctly signed call with an old or far-future time stamp is refused', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(W.verifySvix(secret, H(svixHeaders(secret, body, { at: now - 299 })), Buffer.from(body)).ok, true);
  assert.equal(W.verifySvix(secret, H(svixHeaders(secret, body, { at: now - 301 })), Buffer.from(body)).reason, 'stale');
  assert.equal(W.verifySvix(secret, H(svixHeaders(secret, body, { at: now - 86400 })), Buffer.from(body)).reason, 'stale');
  assert.equal(W.verifySvix(secret, H(svixHeaders(secret, body, { at: now + 301 })), Buffer.from(body)).reason, 'stale');
  // moving the time stamp without re-signing does not help: it is part of what was signed
  const h = svixHeaders(secret, body, { at: now - 86400 });
  assert.equal(W.verifySvix(secret, H({ ...h, 'svix-timestamp': String(now) }), Buffer.from(body)).reason, 'bad_signature');
});

test('the "t=,v1=" scheme: correct, wrong, stale', () => {
  const s = 'plain-webhook-secret-0123456789';
  const now = Math.floor(Date.now() / 1000);
  assert.deepEqual(W.verifyTimestamped(s, mockSignature(s, body, now), Buffer.from(body)), { ok: true, timestamp: now });
  assert.equal(W.verifyTimestamped(s, mockSignature('other-secret', body, now), Buffer.from(body)).reason, 'bad_signature');
  assert.equal(W.verifyTimestamped(s, mockSignature(s, body, now), Buffer.from(body + 'x')).reason, 'bad_signature');
  assert.equal(W.verifyTimestamped(s, mockSignature(s, body, now - 600), Buffer.from(body)).reason, 'stale');
  assert.equal(W.verifyTimestamped(s, '', Buffer.from(body)).reason, 'signature_missing');
  assert.equal(W.verifyTimestamped(s, 'garbage', Buffer.from(body)).reason, 'bad_signature');
  assert.equal(W.verifyTimestamped('', mockSignature(s, body, now), Buffer.from(body)).reason, 'signature_missing');
});

test('helpers', () => {
  assert.equal(W.fresh(Math.floor(Date.now() / 1000)), true);
  assert.equal(W.fresh(NaN), false);
  assert.match(W.payloadHash(Buffer.from(body)), /^[0-9a-f]{64}$/);
  assert.deepEqual(W.parseJson(Buffer.from('{"a":1}')), { a: 1 });
  assert.equal(W.parseJson(Buffer.from('[1]')), null);
  assert.equal(W.parseJson(Buffer.from('not json')), null);
});
