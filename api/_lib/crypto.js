// Sealing of values the server stores for later: provider tokens, PKCE verifiers. AES-256-GCM.
//
// Envelope:  v1.<key id>.<iv>.<tag>.<ciphertext>   (base64url parts)
//   key id   first 8 hex characters of SHA-256 of the key. It says which key sealed the value, so a key can be
//            replaced: set the new key as TOKEN_ENC_KEY, keep the old one as TOKEN_ENC_KEY_PREVIOUS, and values
//            sealed with either one open. needsReseal() tells the caller to seal a value again with the new key.
//   aad      "additional data" bound into the seal: the company and the provider. A sealed token copied onto
//            another company's row does not open.
// The key exists only in the server environment. The database stores the envelope and can never open it.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual, hkdfSync } from 'node:crypto';
import { envKey, has } from './env.js';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');
const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8);

function tokenKeys() {
  const current = envKey('TOKEN_ENC_KEY');
  const keys = [{ id: keyId(current), key: current }];
  if (has('TOKEN_ENC_KEY_PREVIOUS')) {
    const prev = envKey('TOKEN_ENC_KEY_PREVIOUS');
    keys.push({ id: keyId(prev), key: prev });
  }
  return keys;
}

/** Seals with an explicit key list (first key seals, all keys open). Shared with the session cookie. */
export function sealWith(keys, value, aad = '', prefix = 'v1') {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keys[0].key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [prefix, keys[0].id, b64(iv), b64(c.getAuthTag()), b64(ct)].join('.');
}

/** Opens an envelope. Returns null for anything that is not a value sealed by one of the keys with the same aad. */
export function openWith(keys, envelope, aad = '', prefix = 'v1') {
  if (typeof envelope !== 'string') return null;
  const parts = envelope.split('.');
  if (parts.length !== 5 || parts[0] !== prefix) return null;
  const k = keys.find((x) => x.id === parts[1]);
  if (!k) return null;
  try {
    const iv = unb64(parts[2]); const tag = unb64(parts[3]);
    if (iv.length !== 12 || tag.length !== 16) return null;
    const d = createDecipheriv('aes-256-gcm', k.key, iv);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(unb64(parts[4])), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

/** Seals provider tokens (or any small object) for storage. */
export const sealToken = (value, aad = '') => sealWith(tokenKeys(), value, aad);
/** Opens a stored envelope. Null when it was tampered with, sealed for another row, or sealed with a key no longer configured. */
export const openToken = (envelope, aad = '') => openWith(tokenKeys(), envelope, aad);
/** True when the envelope was sealed with a previous key and should be sealed again with the current one. */
export function needsReseal(envelope) {
  const parts = String(envelope || '').split('.');
  return parts.length === 5 && parts[1] !== tokenKeys()[0].id;
}

/** A key for one purpose, derived from a secret with HKDF. The secret itself is never used directly as a key. */
export function deriveKey(secret, purpose) {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(purpose, 'utf8'), 32));
  return { id: keyId(key), key };
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
export const hmacHex = (key, value) => createHmac('sha256', key).update(value).digest('hex');

/** Compares two strings without telling, through timing, where they differ. */
export function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

/** PKCE (RFC 7636): the S256 challenge for a verifier. */
export const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');
/** PKCE: a new random verifier (64 characters) and its challenge. */
export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}
