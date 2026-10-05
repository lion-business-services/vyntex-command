// Rate limits and sign-in lockouts.
// The counters live in the database (supabase/migrations/0023), because a server function has no memory between
// requests and runs in many copies. When the database cannot be reached the same rules are applied from memory:
// weaker (one copy only counts what it saw) but never "no limit".
//
// What is counted is never an address or an email. Both are turned into a keyed hash first (HMAC-SHA256 with
// IP_HASH_SALT), so the tables hold nothing that identifies a person or a network.
import { createHmac, randomBytes } from 'node:crypto';
import { env, has } from './env.js';
import { clientAddress } from './request.js';
import { serviceRpc, configured } from './supabase.js';
import { HttpError, log } from './respond.js';

const processSalt = randomBytes(32).toString('hex');
function salt() {
  // The configured salt; without it, a key derived from the session secret; without either (the public demo, which
  // has no settings at all) a salt made up when this server copy started. Limits then count in memory only anyway.
  if (has('IP_HASH_SALT') && env('IP_HASH_SALT').length >= 16) return env('IP_HASH_SALT');
  return has('SESSION_SECRET') ? 'rl:' + env('SESSION_SECRET') : processSalt;
}
/** Keyed hash (64 hex characters) of an address, an email or any other identifier, for one purpose. */
export const keyHash = (purpose, value) => createHmac('sha256', salt()).update(purpose + ':' + String(value).trim().toLowerCase()).digest('hex');
export const addressKey = (request) => keyHash('addr', clientAddress(request) || 'unknown');
export const accountKey = (email) => keyHash('acct', email);
/** The hash stored with security events and audit entries ("from where"), never the address. */
export const ipHash = (request) => { const a = clientAddress(request); return a ? keyHash('ip', a) : null; };

// ---- memory fallback -------------------------------------------------------------------------------------------------
const windows = new Map();   // bucket|key -> { start, count }
const locks = new Map();     // bucket|key -> { failures, strikes, last, until }
const MAX_TRACKED = 20000;
const trim = (map) => { while (map.size > MAX_TRACKED) map.delete(map.keys().next().value); };

function memoryHit(bucket, key, limit, windowS, now = Date.now()) {
  const id = bucket + '|' + key;
  const start = Math.floor(now / 1000 / windowS) * windowS;
  const w = windows.get(id);
  const count = w && w.start === start ? w.count + 1 : 1;
  windows.delete(id); windows.set(id, { start, count }); trim(windows);
  return { allowed: count <= limit, retryAfter: count <= limit ? 0 : Math.max(1, start + windowS - Math.floor(now / 1000)) };
}
function memoryLockState(bucket, key, now = Date.now()) {
  const l = locks.get(bucket + '|' + key);
  const wait = l && l.until > now ? Math.ceil((l.until - now) / 1000) : 0;
  return { locked: wait > 0, retryAfter: wait };
}
function memoryLockFail(bucket, key, threshold, windowS, baseS, maxS, now = Date.now()) {
  const id = bucket + '|' + key;
  const l = locks.get(id) || { failures: 0, strikes: 0, last: 0, until: 0 };
  if (now - l.last > windowS * 1000) l.failures = 0;
  if (now - l.last > 86400000) l.strikes = 0;
  l.failures += 1; l.last = now;
  if (l.failures >= threshold) { l.strikes += 1; l.until = now + Math.min(maxS, baseS * 2 ** Math.min(l.strikes - 1, 16)) * 1000; l.failures = 0; }
  locks.delete(id); locks.set(id, l); trim(locks);
  return memoryLockState(bucket, key, now);
}
function memoryLockClear(bucket, key) {
  const l = locks.get(bucket + '|' + key);
  if (l) { l.failures = 0; l.until = 0; }
}
/** For tests: forget everything counted in memory. */
export function resetMemoryLimits() { windows.clear(); locks.clear(); }

const pairKey = (acct, addr) => keyHash('pair', acct + ':' + addr);

// ---- public API ------------------------------------------------------------------------------------------------------

/** Counts one hit. { allowed, retryAfter (seconds), source: 'db' | 'memory' }. */
export async function hit(bucket, key, limit, windowSeconds) {
  if (configured()) {
    const r = await serviceRpc('rate_hit', { p_bucket: bucket, p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
    if (r.ok && r.data && typeof r.data.allowed === 'boolean') return { allowed: r.data.allowed, retryAfter: Number(r.data.retry_after) || 0, source: 'db' };
    log('ratelimit', 'db_unavailable', { status: r.status });
  }
  return { ...memoryHit(bucket, key, limit, windowSeconds), source: 'memory' };
}

/** Counts one hit and ends the request with 429 when the limit is passed. */
export async function limit(bucket, key, max, windowSeconds) {
  const r = await hit(bucket, key, max, windowSeconds);
  if (!r.allowed) throw new HttpError(429, 'rate_limited', { retryAfterSeconds: r.retryAfter }, { headers: { 'retry-after': String(r.retryAfter) } });
  return r;
}

/** Before a sign-in attempt. Counts the address and looks at the locks. { allowed, retryAfter }. */
export async function signinGate(addr, acct) {
  if (configured()) {
    const r = await serviceRpc('signin_gate', { p_addr: addr, p_acct: acct });
    if (r.ok && r.data && typeof r.data.allowed === 'boolean') return { allowed: r.data.allowed, retryAfter: Number(r.data.retry_after) || 0, source: 'db' };
    log('ratelimit', 'db_unavailable', { status: r.status });
  }
  const a = memoryHit('signin.addr', addr, 30, 600);
  const wait = Math.max(a.retryAfter, memoryLockState('signin.pair', pairKey(acct, addr)).retryAfter, memoryLockState('signin.acct', acct).retryAfter);
  return { allowed: wait === 0, retryAfter: wait, source: 'memory' };
}

/**
 * After a sign-in attempt. A failure counts toward the lock on this account from this address (5 in 15 minutes, then
 * a lock that doubles from 1 minute up to 30) and toward a short lock on the account from anywhere (20 in 15 minutes,
 * 5 to 15 minutes). A success forgets the failures. The database call also writes the security event.
 */
export async function signinResult(addr, acct, okay, email, ipHashValue) {
  if (configured()) {
    const r = await serviceRpc('signin_result', { p_addr: addr, p_acct: acct, p_ok: okay, p_email: email, p_ip_hash: ipHashValue });
    if (r.ok && r.data) return { locked: !!r.data.locked, retryAfter: Number(r.data.retry_after) || 0, source: 'db' };
    log('ratelimit', 'db_unavailable', { status: r.status });
  }
  if (okay) { memoryLockClear('signin.pair', pairKey(acct, addr)); return { locked: false, retryAfter: 0, source: 'memory' }; }
  const p = memoryLockFail('signin.pair', pairKey(acct, addr), 5, 900, 60, 1800);
  const a = memoryLockFail('signin.acct', acct, 20, 900, 300, 900);
  return { locked: p.locked || a.locked, retryAfter: Math.max(p.retryAfter, a.retryAfter), source: 'memory' };
}

/** A lock with backoff for anything else that takes guesses (recovery codes, the fresh identity check). */
export async function failLock(bucket, key, threshold = 5, windowS = 900, baseS = 60, maxS = 1800) {
  if (configured()) {
    const r = await serviceRpc('rate_lock_fail', { p_bucket: bucket, p_key: key, p_threshold: threshold, p_window_seconds: windowS, p_base_seconds: baseS, p_max_seconds: maxS });
    if (r.ok && r.data) return { locked: !!r.data.locked, retryAfter: Number(r.data.retry_after) || 0 };
  }
  return memoryLockFail(bucket, key, threshold, windowS, baseS, maxS);
}
export async function lockState(bucket, key) {
  if (configured()) {
    const r = await serviceRpc('rate_lock_state', { p_bucket: bucket, p_key: key });
    if (r.ok && r.data) return { locked: !!r.data.locked, retryAfter: Number(r.data.retry_after) || 0 };
  }
  return memoryLockState(bucket, key);
}
export async function clearLock(bucket, key) {
  if (configured()) { const r = await serviceRpc('rate_lock_clear', { p_bucket: bucket, p_key: key }); if (r.ok) return; }
  memoryLockClear(bucket, key);
}
/** Ends the request with 429 while a lock is in force. */
export async function assertNotLocked(bucket, key) {
  const s = await lockState(bucket, key);
  if (s.locked) throw new HttpError(429, 'locked', { retryAfterSeconds: s.retryAfter }, { headers: { 'retry-after': String(s.retryAfter) } });
}
