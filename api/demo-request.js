// POST /api/demo-request: receives the "Request a demo" form from the sales pages.
//
// What it does, in order: limits requests per address, checks and cleans the input, and then
//   1. sends one plain-text email through Resend when RESEND_API_KEY, DEMO_REQUEST_TO and DEMO_REQUEST_FROM are set
//      (sender: DEMO_REQUEST_FROM, reply-to: the visitor), and
//   2. also stores the request in the `demo_requests` table when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
// When email delivery is not configured it does nothing and says so: { ok: true, delivered: false, reason: 'not_configured' }.
// The page then tells the visitor the truth and offers email, phone and WhatsApp instead.
//
// Secrets are read from the environment only. They are never returned, never logged, and upstream error bodies are never echoed.
import { clientAddress, hashAddress } from './_lib/request.js';

const MAX_BODY_BYTES = 8 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MAX_TRACKED_ADDRESSES = 5000;
const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_CONSENT_TEXT = 'I agree to be contacted by VYNTEX USA about this request.';

const LANGUAGES = ['en', 'es'];
const CONTACT_METHODS = ['phone', 'whatsapp', 'email'];
const TEAM_SIZES = ['1', '2-5', '6-15', '16+'];

/** address -> timestamps of recent requests. Lives in the memory of one server instance, so it is a first line of defence, not a guarantee. */
const recent = new Map();

function json(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(extra || {}) },
  });
}

function addressOf(request) {
  const real = request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');
  const first = (real || (forwarded ? forwarded.split(',')[0] : '') || '').trim();
  return first.slice(0, 64) || 'unknown';
}

/** Returns 0 when the request may go on, or the number of seconds to wait. */
function throttle(address, now) {
  const list = (recent.get(address) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { recent.set(address, list); return Math.max(1, Math.ceil((WINDOW_MS - (now - list[0])) / 1000)); }
  list.push(now);
  recent.delete(address); recent.set(address, list);
  if (recent.size > MAX_TRACKED_ADDRESSES) {
    for (const [key, times] of recent) { if (!times.some((t) => now - t < WINDOW_MS)) recent.delete(key); }
    while (recent.size > MAX_TRACKED_ADDRESSES) recent.delete(recent.keys().next().value);
  }
  return 0;
}

/** Reads the body as text and gives up as soon as it is larger than allowed. Returns null when it is too large. */
async function readLimited(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { try { await reader.cancel(); } catch { /* already closed */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

const oneLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim() : '');
const manyLines = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '');

/** Checks every field and returns the cleaned request, or the list of fields that need fixing. */
function validate(input) {
  const errors = {};
  const out = {};
  const text = (key, min, max) => {
    if (input[key] !== undefined && typeof input[key] !== 'string') { errors[key] = 'invalid'; return ''; }
    const v = oneLine(input[key]);
    if (!v) errors[key] = 'required'; else if (v.length < min) errors[key] = 'too_short'; else if (v.length > max) errors[key] = 'too_long';
    return v;
  };
  const choice = (key, allowed) => {
    const v = oneLine(input[key]).toLowerCase();
    if (!v) errors[key] = 'required'; else if (!allowed.includes(v)) errors[key] = 'invalid';
    return v;
  };

  out.name = text('name', 2, 100);
  out.business = text('business', 2, 120);

  out.industry = oneLine(input.industry).toLowerCase();
  if (!out.industry) errors.industry = 'required'; else if (!/^[a-z][a-z0-9_-]{1,30}$/.test(out.industry)) errors.industry = 'invalid';

  const phone = text('phone', 7, 40);
  const digits = phone.replace(/\D/g, '');
  if (!errors.phone && (digits.length < 10 || digits.length > 15)) errors.phone = 'invalid';
  out.phone = digits.length === 10 ? '+1' + digits : digits.length === 11 && digits[0] === '1' ? '+' + digits : (phone.startsWith('+') ? '+' : '') + digits;

  out.email = text('email', 6, 254).toLowerCase();
  if (!errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) errors.email = 'invalid';

  out.language = choice('language', LANGUAGES);
  out.contactMethod = choice('contactMethod', CONTACT_METHODS);
  out.teamSize = choice('teamSize', TEAM_SIZES);

  if (input.message !== undefined && input.message !== null && typeof input.message !== 'string') errors.message = 'invalid';
  out.message = manyLines(input.message);
  if (out.message.length > 1000) errors.message = 'too_long';

  if (input.consent !== true) errors.consent = 'required';
  out.consentText = oneLine(input.consentText).slice(0, 300) || DEFAULT_CONSENT_TEXT;

  return Object.keys(errors).length ? { errors } : { value: out };
}

function emailText(r, at) {
  return [
    'New demo request from the VYNTEX sales pages.',
    '',
    'Name: ' + r.name,
    'Business: ' + r.business,
    'Industry: ' + r.industry,
    'Phone: ' + r.phone,
    'Email: ' + r.email,
    'Preferred language: ' + (r.language === 'es' ? 'Spanish' : 'English'),
    'Contact by: ' + r.contactMethod,
    'Team size: ' + r.teamSize,
    '',
    'Message:',
    r.message || '(none)',
    '',
    'Consent given at ' + at + ':',
    '"' + r.consentText + '"',
  ].join('\n');
}

async function sendEmail(env, r, at) {
  const to = env.DEMO_REQUEST_TO.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.DEMO_REQUEST_FROM, to, reply_to: r.email, subject: `Demo request: ${r.business} (${r.industry})`, text: emailText(r, at) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error('demo-request: the email service answered with status', res.status);
    return res.ok;
  } catch (e) {
    console.error('demo-request: the email service could not be reached', e && e.name ? e.name : 'Error');
    return false;
  }
}

async function storeRequest(env, r, at, emailDelivered, source) {
  const row = {
    name: r.name, business: r.business, industry: r.industry, phone: r.phone, email: r.email,
    language: r.language, contact_method: r.contactMethod, team_size: r.teamSize, message: r.message || null,
    consent: true, consent_text: r.consentText, consent_at: at, email_delivered: emailDelivered,
    // keyed hash of the sender address (never the address itself; null unless IP_HASH_SALT is set) and the browser signature
    source_ip_hash: source.ipHash, user_agent: source.userAgent,
  };
  try {
    const res = await fetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/demo_requests', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.error('demo-request: the database answered with status', res.status);
    return res.ok;
  } catch (e) {
    console.error('demo-request: the database could not be reached', e && e.name ? e.name : 'Error');
    return false;
  }
}

export async function POST(request) {
  const wait = throttle(addressOf(request), Date.now());
  if (wait) return json(429, { ok: false, error: 'rate_limited', retryAfterSeconds: wait }, { 'retry-after': String(wait) });

  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json(415, { ok: false, error: 'unsupported_media_type' });

  let raw;
  try { raw = await readLimited(request); } catch { return json(400, { ok: false, error: 'invalid_body' }); }
  if (raw === null) return json(413, { ok: false, error: 'too_large' });

  let input;
  try { input = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'invalid_json' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { ok: false, error: 'invalid_json' });

  // Hidden field that people never see. Anything in it means the form was filled by a script: accept quietly, deliver nothing.
  if (input.website !== undefined && input.website !== null && String(input.website).trim() !== '') return json(200, { ok: true, delivered: false, reason: 'filtered' });

  const checked = validate(input);
  if (checked.errors) return json(400, { ok: false, error: 'invalid', fields: checked.errors });
  const r = checked.value;

  const env = process.env;
  // all three are needed: without a verified sender the email would not reach the team, so that counts as not configured
  if (!env.RESEND_API_KEY || !env.DEMO_REQUEST_TO || !env.DEMO_REQUEST_FROM) return json(200, { ok: true, delivered: false, reason: 'not_configured' });

  const at = new Date().toISOString();
  const delivered = await sendEmail(env, r, at);
  // The database copy is extra: if it fails, an email that went out still counts as delivered.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) await storeRequest(env, r, at, delivered, { ipHash: hashAddress(clientAddress(request), env.IP_HASH_SALT), userAgent: (request.headers.get('user-agent') || '').slice(0, 500) || null });
  if (!delivered) return json(502, { ok: false, error: 'delivery_failed' });
  return json(200, { ok: true, delivered: true });
}

const notAllowed = () => json(405, { ok: false, error: 'method_not_allowed' }, { allow: 'POST' });
export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
