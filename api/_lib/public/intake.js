// POST /api/public/intake/<form key>: a lead from the company's own website form.
//
// The form key says which company the form belongs to (it is made and replaced in the company's settings, and only its
// hash is stored). A submission is accepted as JSON or as an ordinary HTML form post, so a plain form on the company's
// site works without any script. What is checked here: size, the shape of every field, a hidden field people never
// fill in and robots do, and limits per address and per form. What the database then does in one step: look for the
// same person among the company's leads (no second lead for the same email or phone), create the lead, give it to the
// next person in the rotation, and remember the consent sentence with the time.
//
// The answer is the same short "ok" for a real form key and an unknown one, a new lead and a repeated one.
import { ok, fail, readRaw, isPlainObject, HttpError } from '../respond.js';
import { serviceRpc } from '../supabase.js';
import { limit, addressKey, keyHash, ipHash } from '../ratelimit.js';
import { sha256Hex } from '../crypto.js';

const KEY = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = 16 * 1024;
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n) : '');
const yes = (v) => v === true || v === 'true' || v === 'on' || v === 'yes' || v === '1';

async function read(request) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && type !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'unsupported_media_type');
  let raw;
  try { raw = await readRaw(request, MAX); } catch { throw new HttpError(400, 'invalid_body'); }
  if (raw === null) throw new HttpError(413, 'too_large');
  if (type === 'application/json') {
    let b; try { b = JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid_json'); }
    if (!isPlainObject(b)) throw new HttpError(400, 'invalid_json');
    return b;
  }
  return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
}

/** Checks and tidies the fields. Returns { fields } or { problem }. */
export function intakeFields(b) {
  const name = text(b.name, 200);
  const email = text(b.email, 320).toLowerCase();
  const phone = text(b.phone, 40);
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2) return { problem: 'name' };
  if (!email && !phone) return { problem: 'contact' };
  if (email && !EMAIL.test(email)) return { problem: 'email' };
  if (phone && (digits.length < 7 || digits.length > 15 || !/^[0-9+()\-. ]+$/.test(phone))) return { problem: 'phone' };
  const lang = ['en', 'es', 'zh'].includes(b.lang) ? b.lang : undefined;
  const consent = yes(b.consent);
  return { fields: {
    name, email, phone, company: text(b.company, 200), address: text(b.address, 300), service: text(b.service, 80), message: text(b.message, 4000),
    ...(lang ? { lang } : {}),
    // a text message opt-in counts only together with the consent box: no tick, no texts
    ...(consent && yes(b.smsOptIn) ? { smsOptIn: true } : {}),
  }, consentText: consent ? text(b.consentText, 2000) : '' };
}

export async function intake(request, key) {
  await limit('pub.intake.addr', addressKey(request), 10, 600);
  await limit('pub.intake.form', keyHash('intake', String(key).slice(0, 80)), 240, 600);
  const b = await read(request);
  // The hidden field: a person never sees it. Whoever fills it in gets the usual answer and nothing is stored.
  if (text(b.website, 200) || text(b._hp, 200)) return ok({});
  if (typeof key !== 'string' || !KEY.test(key)) return ok({});
  const v = intakeFields(b);
  if (v.problem) return fail(400, 'invalid', { reason: v.problem });
  // The form may send its own key for "this submission"; without one, the same details on the same day are one submission.
  const idem = typeof b.idem === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(b.idem) ? b.idem
    : 'auto-' + sha256Hex([key, v.fields.name, v.fields.email, v.fields.phone, new Date().toISOString().slice(0, 10)].join('|')).slice(0, 40);
  const r = await serviceRpc('intake_submit', { p_key_hash: sha256Hex(key), p_fields: v.fields, p_idem: idem, p_ip_hash: ipHash(request), p_consent_text: v.consentText || null });
  if (!r.ok) return fail(503, 'store_unavailable');
  return ok({});
}
