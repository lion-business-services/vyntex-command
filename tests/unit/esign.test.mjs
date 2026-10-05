// Unit tests for documents and signature requests: merge fields, templates and their approval, signing order, required
// boxes, expiry, reminders, and the signed copy with its completion certificate. No browser: the same functions the
// server will run. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export * from '@/domain/esign';
  export { createDocFromTemplate, addUpload, addDocVersion, saveTemplate, approveTemplate, saveDocEdits, restoreDocVersion, createEnvelope, saveEnvelope, sendEnvelope, viewEnvelope, signEnvelope,
    declineEnvelope, voidEnvelope, remindEnvelope, attachSignedCopy, sweepEnvelopes, saveEsignSettings, approveConsent } from '@/domain/actions';
  export { envelopeBlockers, consentOf, envelopesWaiting } from '@/domain/actions/esign';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
  export { seed as practiceSeed } from '@/packs/practice/seed';
`);
const { PACKS, makeT } = m;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
const iso = (days) => new Date(Date.UTC(2026, 0, 10, 15, 0, 0) + days * 86400000).toISOString();

function world(lang = 'en') {
  const pack = PACKS.practice;
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff'), user('u5', 'readonly')];
  d.clients = [
    { id: 'c1', name: 'Dana Example', company: 'Sample Bakery LLC', phone: '609-555-0142', email: 'dana@example.com', addresses: ['1 Sample Way, Northfield, NJ'], since: '2025-01-01', notes: [], lang: 'en', owners: [{ id: 'o1', name: 'Dana Example' }, { id: 'o2', name: 'Robin Example', email: 'robin@example.com' }] },
    { id: 'c2', name: 'Paz Ejemplo', phone: '609-555-0143', email: 'paz@example.com', addresses: [], since: '2025-01-01', notes: [], lang: 'es' },
  ];
  d.jobs = [{ id: 'j1', number: 'VP-J-1001', name: 'Monthly bookkeeping', clientId: 'c1', address: '', type: 'bookkeeping', status: 'contract', price: 3000, start: '2026-02-01', end: '', scope: 'Books', payTerms: '', managerId: 'u2', assign: [], expenses: [], received: [], log: [], notes: [], created: '2026-01-01', period: '2026' }];
  const ctx = (actor = 'u1') => ({ pack, lang, t: makeT(lang, pack), actor });
  return { d, ctx, pack };
}
/** A template the company wrote and approved, and an approved consent sentence: what a company needs before it can send. */
function ready(w) {
  const tpl = m.saveTemplate(w.d, w.ctx(), { kind: 'custom', name: 'Test template', lang: 'en', blocks: [{ id: 'b1', type: 'p', text: 'Test text for {{client.name}}.' }, { id: 'b2', type: 'sign', text: 'client, firm' }] });
  assert.equal(m.approveTemplate(w.d, w.ctx(), tpl.id).ok, true);
  m.saveEsignSettings(w.d, w.ctx(), { consent: { en: 'Test consent sentence.', es: 'Frase de consentimiento de prueba.' } });
  assert.equal(m.approveConsent(w.d, w.ctx()).ok, true);
  return tpl;
}
const prepared = (bytes = new Uint8Array([37, 80, 68, 70])) => ({ source: { name: 'doc.pdf', size: bytes.length, mime: 'application/pdf', dataUrl: m.bytesDataUrl(bytes, 'application/pdf') }, pages: [{ w: 612, h: 792 }], originalHash: 'x', hasPlaceholders: false });
// (the first page of a document is page 1)
const box = (id, signerId, type, more = {}) => ({ id, signerId, type, page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05, required: true, ...more });
const answer = (more = {}) => ({ consent: true, typedName: 'Dana Example', signature: PNG, values: {}, ...more });
/** An envelope with two signers that is out for signature. */
function sent(w, { ordered = true, fields } = {}) {
  const tpl = ready(w);
  const doc = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'custom', clientId: 'c1', templateId: tpl.id });
  const made = m.createEnvelope(w.d, w.ctx(), doc.id);
  assert.equal(made.ok, true);
  const e = made.data;
  const [a, b] = e.signers;
  m.saveEnvelope(w.d, w.ctx(), e.id, { ordered, fields: fields ? fields(a.id, b.id) : [box('f1', a.id, 'signature'), box('f2', b.id, 'signature', { x: 0.55 })] });
  const r = m.sendEnvelope(w.d, w.ctx(), e.id, prepared());
  assert.equal(r.ok, true, JSON.stringify(r));
  return { e, doc, a: e.signers[0], b: e.signers[1] };
}

/* ---------- merge fields ---------- */

test('merge fields are filled from the client, the engagement and the company', () => {
  const { d, pack } = world();
  const v = m.mergeValues(d, pack, { client: d.clients[0], job: d.jobs[0], lang: 'en' });
  const r = m.resolveMerge('{{client.name}} of {{client.business}}, {{service.name}} for {{service.period}} at {{service.price}} with {{firm.name}}. Owners: {{client.owners}}', v, 'en');
  assert.equal(r.text, 'Dana Example of Sample Bakery LLC, Monthly bookkeeping for 2026 at $3,000.00 with Sample Test Co. Owners: Dana Example, Robin Example');
  assert.deepEqual(r.missing, []);
});

test('a marker with no value becomes a visible bracketed note, never a blank and never a guess', () => {
  const { d, pack } = world();
  const v = m.mergeValues(d, pack, { client: d.clients[1], lang: 'en' });
  const r = m.resolveMerge('Business: {{client.business}}. Address: {{client.address}}. {{no.such}}', v, 'en');
  assert.equal(r.text, 'Business: [Missing: Business name]. Address: [Missing: Client address]. [Missing: no.such]');
  assert.deepEqual(r.missing, ['client.business', 'client.address', 'no.such']);
  assert.equal(m.hasPlaceholder(r.text), true);
  assert.equal(m.resolveMerge('{{client.address}}', v, 'es').text, '[Falta: Dirección del cliente]');
});

test('an optional marker may be empty, and a list line that only held one is left out', () => {
  const { d, pack } = world();
  const v = m.mergeValues(d, pack, { client: d.clients[1], lang: 'en' });
  const r = m.resolveList('Client: {{client.name}}\nBusiness: {{client.business?}}\nEmail: {{client.email?}}', v, 'en');
  assert.equal(r.text, 'Client: Paz Ejemplo\nEmail: paz@example.com');
  assert.deepEqual(r.missing, []);
});

/* ---------- templates ---------- */

test('starter templates are structure only: unapproved, marked as starters, with placeholders, in English and Spanish', () => {
  const all = m.starterTemplates(PACKS.practice.docKinds);
  assert.equal(all.length, 12, 'six template kinds in two languages');
  for (const t of all) {
    assert.equal(t.approved, false); assert.equal(t.source, 'starter');
    assert.equal(m.canApprove(t), false, t.id + ' cannot be approved while its placeholders are in');
    assert.ok(t.blocks.some((b) => b.type === 'sign'), t.id + ' has a signature line');
    assert.deepEqual(m.templateIssues(t).unknown, [], t.id + ' uses only known merge fields');
  }
});

test('createDocFromTemplate picks the client language, then English, then the starter', () => {
  const w = world();
  const es = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'engagement_letter', clientId: 'c2' });
  assert.equal(es.templateId, 'starter-engagement_letter-es');
  assert.ok(w.d.templates.some((t) => t.id === es.templateId), 'the starter became the company\'s own copy');
  const own = m.saveTemplate(w.d, w.ctx(), { kind: 'service_order', name: 'Our order', lang: 'en', blocks: [{ id: 'b1', type: 'p', text: 'Order text' }] });
  assert.equal(m.createDocFromTemplate(w.d, w.ctx(), { kind: 'service_order', clientId: 'c2' }).templateId, own.id, 'no Spanish one: the English one is used');
  const withJob = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'engagement_letter', clientId: 'c1', jobId: 'j1' });
  assert.equal(withJob.jobId, 'j1'); assert.equal(withJob.number, 'VP-EL-1002');
  assert.equal(m.createDocFromTemplate(w.d, w.ctx(), { kind: 'engagement_letter', clientId: 'c1', jobId: 'j1' }).id, withJob.id, 'asking twice gives the same draft');
  assert.equal(m.createDocFromTemplate(w.d, w.ctx(), { kind: 'engagement_letter', clientId: 'nobody' }), null);
});

test('a document made from an unapproved template cannot be sent for signature', () => {
  const w = world();
  m.saveEsignSettings(w.d, w.ctx(), { consent: { en: 'Test consent sentence.', es: 'Frase de prueba.' } }); m.approveConsent(w.d, w.ctx());
  const doc = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'service_order', clientId: 'c1', jobId: 'j1' });
  const e = m.createEnvelope(w.d, w.ctx(), doc.id).data;
  m.saveEnvelope(w.d, w.ctx(), e.id, { fields: e.signers.map((s, i) => box('f' + i, s.id, 'signature')) });
  const r = m.sendEnvelope(w.d, w.ctx(), e.id, prepared());
  assert.equal(r.ok, false); assert.ok(r.blockers.includes('template_unapproved'));
  assert.equal(e.status, 'draft'); assert.equal(doc.status, 'draft');
  // approval is refused while the placeholders are in, and needs the `config` capability
  assert.equal(m.approveTemplate(w.d, w.ctx(), doc.templateId).reason, 'placeholders');
  const tpl = w.d.templates.find((t) => t.id === doc.templateId);
  assert.equal(m.saveTemplate(w.d, w.ctx('u3'), { ...tpl, blocks: tpl.blocks }), null, 'an associate cannot change a template');
  m.saveTemplate(w.d, w.ctx(), { ...tpl, blocks: tpl.blocks.map((b) => ({ ...b, text: b.text.replace(/\[[^\]]+\]/g, 'Wording the company wrote.') })) });
  assert.equal(tpl.source, 'company', 'edited wording belongs to the company');
  assert.equal(m.approveTemplate(w.d, w.ctx('u3'), tpl.id).reason, 'not_allowed');
  assert.equal(m.approveTemplate(w.d, w.ctx(), tpl.id).ok, true);
  assert.equal(tpl.approvedBy, 'u1'); assert.ok(tpl.approvedAt);
  assert.equal(m.sendEnvelope(w.d, w.ctx(), e.id, prepared()).ok, true);
  assert.equal(doc.status, 'sent'); assert.equal(e.demo, true, 'a sample envelope says it is one');
  // changing approved wording takes the approval away
  m.saveTemplate(w.d, w.ctx(), { ...tpl, blocks: tpl.blocks.map((b, i) => (i === 0 ? { ...b, text: b.text + ' More.' } : b)) });
  assert.equal(tpl.approved, false); assert.equal(tpl.approvedBy, undefined);
});

test('sending also needs an approved consent sentence, a signature box for every signer and a text without placeholders', () => {
  const w = world();
  const tpl = m.saveTemplate(w.d, w.ctx(), { kind: 'custom', name: 'T', lang: 'en', blocks: [{ id: 'b1', type: 'p', text: 'Text' }, { id: 'b2', type: 'sign', text: 'client, firm' }] });
  m.approveTemplate(w.d, w.ctx(), tpl.id);
  const doc = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'custom', clientId: 'c1', templateId: tpl.id });
  const e = m.createEnvelope(w.d, w.ctx(), doc.id).data;
  assert.deepEqual(e.signers.map((s) => s.role), ['client', 'firm']);
  assert.deepEqual(m.envelopeBlockers(w.d, e), ['consent_unapproved', 'no_fields']);
  m.saveEsignSettings(w.d, w.ctx(), { consent: { en: '[Consent sentence]', es: '' } });
  assert.equal(m.approveConsent(w.d, w.ctx()).reason, 'placeholders');
  m.saveEsignSettings(w.d, w.ctx(), { consent: { en: 'Test consent sentence.', es: '' } }); m.approveConsent(w.d, w.ctx());
  assert.equal(m.consentOf(w.d, 'es').text, 'Test consent sentence.', 'Spanish falls back to the English sentence');
  m.saveEnvelope(w.d, w.ctx(), e.id, { fields: [box('f1', e.signers[0].id, 'signature')] });
  assert.deepEqual(m.envelopeBlockers(w.d, e), ['no_signature_box']);
  m.saveEnvelope(w.d, w.ctx(), e.id, { fields: [box('f1', e.signers[0].id, 'signature'), box('f2', e.signers[1].id, 'signature')] });
  assert.deepEqual(m.envelopeBlockers(w.d, e, { ...prepared(), hasPlaceholders: true }), ['placeholders']);
  assert.equal(m.sendEnvelope(w.d, w.ctx('u5'), e.id, prepared()).reason, 'not_allowed', 'a read-only person cannot send');
});

/* ---------- order ---------- */

test('with a signing order the second signer is let in only after the first one finishes', () => {
  const w = world();
  const { e, doc, a, b } = sent(w);
  assert.equal(e.status, 'sent'); assert.equal(a.status, 'sent'); assert.equal(b.status, 'waiting');
  assert.equal(m.cannotSign(e, b.id, new Date().toISOString()), 'not_your_turn');
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, b.id, answer()).reason, 'not_your_turn');
  assert.equal(m.viewEnvelope(w.d, w.ctx(), e.id, a.id), true); assert.equal(doc.status, 'viewed');
  assert.equal(m.viewEnvelope(w.d, w.ctx(), e.id, a.id), false, 'opening twice is recorded once');
  const first = m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer());
  assert.equal(first.ok, true); assert.equal(first.data.completed, false);
  assert.deepEqual(first.data.released.map((s) => s.id), [b.id]);
  assert.equal(e.status, 'partly_signed'); assert.equal(b.status, 'sent'); assert.ok(b.sentAt);
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer()).reason, 'already_signed');
  const second = m.signEnvelope(w.d, w.ctx(), e.id, b.id, answer({ typedName: 'Person u1' }));
  assert.equal(second.data.completed, true);
  assert.equal(e.status, 'completed'); assert.ok(e.completedAt); assert.equal(doc.status, 'signed');
  assert.deepEqual(e.events.map((x) => x.kind), ['created', 'sent', 'viewed', 'signed', 'sent', 'signed', 'completed']);
  assert.equal(m.envelopesWaiting(w.d), 0);
});

test('without a signing order everyone gets their link at once', () => {
  const w = world();
  const { e, a, b } = sent(w, { ordered: false });
  assert.equal(a.status, 'sent'); assert.equal(b.status, 'sent');
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, b.id, answer()).ok, true);
  assert.equal(e.status, 'partly_signed');
  assert.deepEqual(m.waitingOn(e).map((s) => s.id), [a.id]);
});

test('a signed agreement starts the engagement that was waiting for it', () => {
  const w = world();
  const tpl = ready(w);
  const el = m.saveTemplate(w.d, w.ctx(), { kind: 'engagement_letter', name: 'EL', lang: 'en', blocks: [{ id: 'b1', type: 'p', text: 'Text' }, { id: 'b2', type: 'sign', text: 'client' }] });
  m.approveTemplate(w.d, w.ctx(), el.id);
  const doc = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'engagement_letter', clientId: 'c1', jobId: 'j1', templateId: el.id });
  const e = m.createEnvelope(w.d, w.ctx(), doc.id).data;
  m.saveEnvelope(w.d, w.ctx(), e.id, { fields: [box('f1', e.signers[0].id, 'signature')] });
  m.sendEnvelope(w.d, w.ctx(), e.id, prepared());
  m.signEnvelope(w.d, w.ctx(), e.id, e.signers[0].id, answer());
  assert.equal(w.d.jobs[0].status, 'progress'); assert.ok(tpl);
});

/* ---------- required boxes ---------- */

test('every required box must be filled; an optional one may stay empty; the date is the day of signing', () => {
  const w = world();
  const { e, a } = sent(w, { fields: (x, y) => [box('sig', x, 'signature'), box('ini', x, 'initials'), box('txt', x, 'text', { label: 'Title' }), box('chk', x, 'checkbox'), box('opt', x, 'text', { required: false }), box('day', x, 'date'), box('s2', y, 'signature')] });
  const miss = m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer());
  assert.equal(miss.ok, false); assert.equal(miss.reason, 'missing_fields');
  assert.deepEqual(miss.fields.sort(), ['chk', 'ini', 'txt']);
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer({ consent: false })).reason, 'no_consent');
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer({ typedName: ' ' })).reason, 'no_name');
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer({ signature: 'data:text/html;base64,AAAA' })).reason, 'bad_signature');
  const ok = m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer({ initials: PNG, values: { txt: 'Member', chk: 'yes' } }));
  assert.equal(ok.ok, true);
  const val = (id) => e.fields.find((f) => f.id === id).value;
  assert.equal(val('txt'), 'Member'); assert.equal(val('chk'), 'yes'); assert.equal(val('opt'), undefined); assert.equal(val('sig'), 'signed');
  assert.match(val('day'), /\d{4}/, 'the date box holds the day of signing');
  assert.equal(val('s2'), undefined, 'the other signer\'s box is untouched');
  assert.ok(a.consentAt && a.consent === true && a.typedName === 'Dana Example');
});

/* ---------- expiry and reminders ---------- */

test('a request expires when its time is up, and nobody can sign it afterwards', () => {
  const w = world();
  const { e, doc, a } = sent(w);
  assert.ok(Date.parse(e.expiresAt) - Date.parse(e.sentAt) === 30 * 86400000, '30 days unless the company chose otherwise');
  assert.equal(m.isExpired(e, e.sentAt), false);
  const late = new Date(Date.parse(e.expiresAt) + 1000).toISOString();
  assert.equal(m.isExpired(e, late), true);
  assert.equal(m.cannotSign(e, a.id, late), 'expired');
  assert.equal(m.sign(e, a.id, answer(), late).reason, 'expired');
  e.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(m.sweepEnvelopes(w.d, w.ctx()), { expired: 1, reminded: 0 });
  assert.equal(e.status, 'expired'); assert.equal(doc.status, 'draft', 'the document can be sent again');
  assert.equal(e.events.at(-1).kind, 'expired');
  assert.deepEqual(m.sweepEnvelopes(w.d, w.ctx()), { expired: 0, reminded: 0 }, 'an expired request is left alone');
});

test('reminders go to whoever has their link, once per interval, and never when switched off', () => {
  const pure = () => { const e = m.makeEnvelope({ id: 'e1', docId: 'd1', title: 'T', createdBy: 'u1', now: iso(0), remindEvery: 3, signers: [{ id: 'a', name: 'Ann Example', email: 'ann@example.com' }, { id: 'b', name: 'Ben Example', email: 'ben@example.com' }] }); m.send(e, iso(0), { consentText: 'c' }); return e; };
  const e = pure();
  assert.equal(m.reminderDue(e, iso(2)), false);
  assert.equal(m.reminderDue(e, iso(3)), true);
  let r = m.sweep(e, iso(3));
  assert.deepEqual(r.reminded.map((s) => s.id), ['a'], 'only the signer whose turn it is');
  assert.equal(e.events.at(-1).kind, 'reminded'); assert.equal(e.events.at(-1).note, 'auto');
  assert.equal(m.sweep(e, iso(4)).reminded.length, 0, 'not again the next day');
  assert.equal(m.sweep(e, iso(6)).reminded.length, 1);
  const off = pure(); off.remindEvery = 0;
  assert.equal(m.reminderDue(off, iso(20)), false);
  const gone = pure();
  assert.equal(m.sweep(gone, iso(31)).expired, true, 'expiry wins over a reminder');
  assert.equal(m.remind(gone, iso(31), 'manual').length, 0);
});

/* ---------- decline and void ---------- */

test('declining closes the request with the reason; voiding does too; both return the document to a draft', () => {
  const w = world();
  const one = sent(w);
  assert.equal(m.declineEnvelope(w.d, w.ctx(), one.e.id, one.b.id, 'x').reason, 'not_your_turn');
  assert.equal(m.declineEnvelope(w.d, w.ctx(), one.e.id, one.a.id, 'Wrong fee').ok, true);
  assert.equal(one.e.status, 'declined'); assert.equal(one.a.declineReason, 'Wrong fee'); assert.equal(one.doc.status, 'draft');
  assert.equal(m.signEnvelope(w.d, w.ctx(), one.e.id, one.a.id, answer()).reason, 'not_open');
  // a new request can be made for the same document
  const again = m.createEnvelope(w.d, w.ctx(), one.doc.id);
  assert.equal(again.ok, true); assert.notEqual(again.data.id, one.e.id);
  assert.equal(m.voidEnvelope(w.d, w.ctx('u5'), again.data.id).reason, 'not_allowed');
  assert.equal(m.voidEnvelope(w.d, w.ctx(), again.data.id, 'Sent by mistake').ok, true);
  assert.equal(again.data.status, 'void'); assert.equal(again.data.voidReason, 'Sent by mistake');
  assert.equal(m.voidEnvelope(w.d, w.ctx(), again.data.id).reason, 'not_open');
});

test('a signer sees their own boxes and what others already signed, and nobody else\'s email address', () => {
  const w = world();
  const { e, a, b } = sent(w);
  let v = m.signerView(e, b.id, { company: 'Co', now: new Date().toISOString() });
  assert.equal(v.state, 'waiting'); assert.equal(v.fields.length, 1); assert.equal(v.fields[0].mine, true);
  assert.equal(JSON.stringify(v).includes(a.email), false);
  m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer());
  v = m.signerView(e, b.id, { company: 'Co', now: new Date().toISOString() });
  assert.equal(v.state, 'open'); assert.equal(v.fields.length, 2);
  assert.equal(v.fields.find((f) => !f.mine).ink, PNG, 'the first signature shows on the page');
  assert.equal(v.consentText, 'Test consent sentence.');
  assert.equal(m.signerView(e, 'nobody', { company: 'Co', now: iso(0) }), null);
});

/* ---------- boxes ---------- */

test('boxes stay on the page, are read top to bottom, and are placed on the signature lines of the document', () => {
  assert.deepEqual(m.clampField({ x: 0.95, y: -0.2, w: 0.3, h: 0.05 }), { x: 0.7, y: 0, w: 0.3, h: 0.05 });
  const sorted = [box('c', 's', 'text', { page: 2, y: 0.1 }), box('b', 's', 'text', { y: 0.5, x: 0.6 }), box('a', 's', 'text', { y: 0.5, x: 0.1 }), box('z', 's', 'text', { y: 0.2 })].sort(m.byPosition).map((f) => f.id);
  assert.deepEqual(sorted, ['z', 'a', 'b', 'c']);
  let n = 0;
  const placed = m.autoPlace([{ page: 1, role: 'client', kind: 'signature', x: 0.1, y: 0.8, w: 0.35, h: 0.06 }, { page: 1, role: 'client', kind: 'date', x: 0.1, y: 0.88, w: 0.2, h: 0.02 }, { page: 1, role: 'spouse', kind: 'signature', x: 0.5, y: 0.8, w: 0.35, h: 0.06 }],
    [{ id: 's1', role: 'client' }, { id: 's2', role: 'firm' }], () => 'f' + ++n);
  assert.deepEqual(placed.map((f) => [f.signerId, f.type, f.required]), [['s1', 'signature', true], ['s1', 'date', true]], 'no box for a role nobody signs as');
});

/* ---------- uploads and versions ---------- */

test('an upload is filed under its client; a new file is a new version and the old one stays', () => {
  const w = world();
  const f = (name) => ({ name, size: 10, mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERg==' });
  assert.equal(m.addUpload(w.d, w.ctx(), { file: f('a.pdf') }), null, 'a file belongs to a client, an engagement or a lead');
  const doc = m.addUpload(w.d, w.ctx(), { file: f('Bank statement.pdf'), clientId: 'c1', folder: 'Statements' });
  assert.equal(doc.kind, 'upload'); assert.equal(doc.title, 'Bank statement'); assert.equal(doc.number, 'VP-FILE-1001'); assert.equal(doc.folder, 'Statements');
  assert.equal(m.addDocVersion(w.d, w.ctx(), doc.id, f('Bank statement (corrected).pdf'), 'Corrected'), true);
  assert.deepEqual(doc.versions.map((v) => [v.v, v.file.name]), [[1, 'Bank statement.pdf'], [2, 'Bank statement (corrected).pdf']]);
  assert.equal(doc.file.name, 'Bank statement (corrected).pdf');
});

test('saving an edit keeps the earlier text as a version that can be brought back', () => {
  const w = world();
  const doc = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'custom', clientId: 'c1' });
  m.saveDocEdits(w.d, w.ctx(), doc.id, { 'en:b4': 'First wording' });
  m.saveDocEdits(w.d, w.ctx(), doc.id, { 'en:b4': 'Second wording' });
  assert.deepEqual(doc.versions.map((v) => v.edits), [{}, { 'en:b4': 'First wording' }]);
  assert.equal(m.restoreDocVersion(w.d, w.ctx(), doc.id, 2), true);
  assert.deepEqual(doc.edits, { 'en:b4': 'First wording' });
});

/* ---------- the signed copy ---------- */

async function sourcePdf() {
  const lib = await m.pdfLib();
  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  for (const text of ['Page one of the test document', 'Page two']) pdf.addPage([612, 792]).drawText(text, { x: 60, y: 700, font, size: 12 });
  return pdf.save();
}
/** Every piece of text drawn in a PDF made by pdf-lib (it writes text as hex strings inside compressed streams). */
function drawnText(bytes) {
  const buf = Buffer.from(bytes); let out = ''; let at = 0;
  for (;;) {
    const s = buf.indexOf('stream', at); if (s < 0) break;
    const start = buf[s + 6] === 13 ? s + 8 : s + 7; const end = buf.indexOf('endstream', start); if (end < 0) break;
    try { const body = zlib.inflateSync(buf.subarray(start, end)).toString('latin1'); for (const h of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(h[1], 'hex').toString('latin1') + '\n'; } catch { /* not a compressed text stream */ }
    at = end + 9;
  }
  return out;
}

test('the signed copy keeps the pages, adds a certificate with both fingerprints, and a sample carries the watermark', async () => {
  const w = world();
  const { e, a, b } = sent(w, { fields: (x, y) => [box('f1', x, 'signature'), box('f1d', x, 'date', { y: 0.9 }), box('f1t', x, 'text', { y: 0.7 }), box('f2', y, 'signature', { page: 2 })] });
  m.viewEnvelope(w.d, w.ctx(), e.id, a.id);
  m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer({ values: { f1t: 'Managing member' } }));
  m.signEnvelope(w.d, w.ctx(), e.id, b.id, answer({ typedName: 'Person u1' }));
  assert.equal(e.status, 'completed');
  const source = await sourcePdf();
  const out = await m.buildSignedPdf(source, e, { docTitle: 'Test document', docNumber: 'VP-DOC-1001', company: 'Sample Test Co', sentBy: 'Person u1', product: 'VYNTEX Command' });
  const sha = (x) => crypto.createHash('sha256').update(Buffer.from(x)).digest('hex');
  assert.equal(out.hashes.original, sha(source), 'the original fingerprint is the SHA-256 of the file that was sent');
  assert.equal(out.hashes.final, sha(out.bytes), 'the final fingerprint is the SHA-256 of the finished file');
  assert.match(out.hashes.signed, /^[0-9a-f]{64}$/); assert.notEqual(out.hashes.signed, out.hashes.original); assert.notEqual(out.hashes.signed, out.hashes.final);
  assert.equal(out.pages, 3, 'two pages and one certificate page');
  assert.equal(sha(source), out.hashes.original, 'the file that was sent is not changed');
  const text = drawnText(out.bytes);
  assert.ok(text.includes(out.hashes.original), 'the certificate prints the fingerprint of the original');
  assert.ok(text.includes(out.hashes.signed), 'the certificate prints the fingerprint of the signed pages');
  for (const s of ['Completion certificate', 'Dana Example', 'dana@example.com', 'u1@example.com', 'Test consent sentence.', 'Managing member', e.id, 'VP-DOC-1001']) assert.ok(text.includes(s), 'drawn in the signed copy: ' + s);
  assert.equal((text.match(/Sample: not a legally binding signature/g) || []).length, 3, 'the sample line is on every page, certificate included');
  assert.equal(/complian|legally valid|ESIGN|UETA|certified/i.test(text), false, 'no claim about any law');
  // the certificate model itself: facts, both fingerprints, every signer with the three moments and the consent
  const model = m.certificateModel({ env: e, docTitle: 'Test document', company: 'Sample Test Co', product: 'VYNTEX Command', hashes: out.hashes, lang: 'en', sample: true });
  assert.deepEqual(model.rows.filter((r) => r.mono).map((r) => r.value), [out.hashes.original, out.hashes.signed]);
  assert.equal(model.signers.length, 2);
  for (const s of model.signers) assert.deepEqual(s.rows.map((r) => r.label).filter((l) => ['Link made available', 'Opened', 'Signed', 'Consent'].includes(l)), ['Link made available', 'Opened', 'Signed', 'Consent']);
  assert.ok(model.sample);
  // storing it: a new version of the document, and it cannot be stored twice
  const file = { name: 'signed.pdf', size: out.bytes.length, mime: 'application/pdf', dataUrl: m.bytesDataUrl(out.bytes, 'application/pdf') };
  assert.equal(m.attachSignedCopy(w.d, w.ctx(), e.id, file, out.hashes), true);
  assert.equal(m.attachSignedCopy(w.d, w.ctx(), e.id, file, out.hashes), false);
  const doc = w.d.docs.find((x) => x.id === e.docId);
  assert.equal(doc.file.name, 'signed.pdf'); assert.equal(doc.versions.at(-1).kind, 'signed');
  assert.equal(e.hashes.final, out.hashes.final);
});

test('a live envelope has no sample watermark, and the Spanish certificate is in Spanish', async () => {
  const w = world('es');
  const { e, a, b } = sent(w);
  m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer()); m.signEnvelope(w.d, w.ctx(), e.id, b.id, answer());
  e.demo = undefined; e.lang = 'es';
  const out = await m.buildSignedPdf(await sourcePdf(), e, { docTitle: 'Documento de prueba', company: 'Sample Test Co', product: 'LBS Command' });
  const text = drawnText(out.bytes);
  assert.ok(text.includes('Certificado de finalizaci'));
  assert.equal(/Sample: not|Muestra: no es/.test(text), false);
  assert.ok(text.includes('LBS Command'));
});

test('a file that is not a PDF, or is password protected, is refused when its pages are read', async () => {
  assert.deepEqual(await m.readPages(new Uint8Array([1, 2, 3, 4])), { ok: false, reason: 'unreadable' });
  const ok = await m.readPages(await sourcePdf());
  assert.deepEqual(ok, { ok: true, pages: [{ w: 612, h: 792 }, { w: 612, h: 792 }] });
});

/* ---------- what the database will accept (supabase/migrations/0035 and 0012) ---------- */

test('records keep to what the database stores: pages from 1, no zero reminder, a bounded signature, ids of their own', () => {
  // boxes placed on the signature lines of a document carry the page they are on, counted from 1
  const placed = m.autoPlace([{ page: 1, role: 'client', kind: 'signature', x: 0.1, y: 0.8, w: 0.3, h: 0.05 }], [{ id: 's1', role: 'client' }], () => 'f1');
  assert.equal(placed[0].page, 1);
  // "no reminders" is no number at all
  const base = { id: 'e1', docId: 'd1', title: 'T', createdBy: 'u1', now: iso(0), signers: [{ id: 'a', name: 'Ann Example', email: 'ann@example.com' }] };
  assert.equal(m.makeEnvelope({ ...base, remindEvery: 0 }).remindEvery, undefined);
  assert.equal(m.makeEnvelope(base).remindEvery, m.DEFAULT_REMIND_EVERY);
  const w = world(); const { e, a } = sent(w);
  // a drawn signature larger than the database keeps is refused, not cut
  assert.equal(m.MAX_SIGNATURE_CHARS, 200000);
  const huge = 'data:image/png;base64,' + 'A'.repeat(m.MAX_SIGNATURE_CHARS);
  assert.deepEqual(m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer({ signature: huge })).reason, 'bad_signature');
  // every block of every starter has an id no other block has
  const ids = m.starterTemplates(m.TEMPLATE_KINDS).flatMap((t) => t.blocks.map((b) => b.id));
  assert.equal(new Set(ids).size, ids.length);
  // a starter taken into a company workspace gets ids of the database's kind and remembers where it came from
  const starter = m.starterTemplate('service_order', 'en'); let n = 0;
  const copy = m.adoptStarter(starter, (p) => p + '-uuid-' + ++n);
  assert.notEqual(copy.id, starter.id); assert.equal(copy.blocks.length, starter.blocks.length);
  assert.ok(m.fromStarter(copy, starter.id)); assert.equal(m.fromStarter(copy, 'starter-custom-en'), false);
  assert.equal(m.adoptStarter(starter), starter, 'the sample keeps the starter as it is');
});

test('the sample business brings no file bytes in its records, and its made-up files open as PDFs', async () => {
  for (const lang of ['en', 'es']) {
    const seed = m.practiceSeed(lang);
    const text = JSON.stringify([seed.docs, seed.envelopes, seed.templates]);
    assert.equal(text.includes('dataUrl'), false, 'no file bytes in a record (' + lang + ')');
    const blockIds = seed.templates.flatMap((t) => t.blocks.map((b) => b.id));
    assert.equal(new Set(blockIds).size, blockIds.length, 'block ids are unique across the templates (' + lang + ')');
    const files = seed.docs.filter((d) => d.file).flatMap((d) => [d.file, ...(d.versions ?? []).map((v) => v.file)]);
    assert.ok(files.length >= 4);
    for (const f of files) {
      const bytes = m.tinyPdf(f.sample);
      assert.equal(bytes.length, f.size, 'the size on record is the size of the file');
      assert.deepEqual(await m.readPages(bytes), { ok: true, pages: [{ w: 612, h: 792 }] });
      assert.ok(Buffer.from(bytes).toString('latin1').includes('no legal meaning') || Buffer.from(bytes).toString('latin1').includes('valor legal'), 'the file says it is a sample');
    }
    // each sample request is a sample, so a person may hold it in any state
    for (const e of seed.envelopes) { assert.equal(e.demo, true); assert.ok(e.remindEvery === undefined || e.remindEvery >= 1); }
  }
});

test('a request that is not a sample is the server\'s once it leaves: a person can prepare it and void it, nothing else', () => {
  const w = world(); const tpl = ready(w);
  const doc = m.createDocFromTemplate(w.d, w.ctx(), { kind: 'custom', clientId: 'c1', templateId: tpl.id });
  const e = m.createEnvelope(w.d, w.ctx(), doc.id).data; const [a, b] = e.signers;
  e.demo = undefined; // what a company workspace creates
  assert.equal(m.saveEnvelope(w.d, w.ctx(), e.id, { fields: [box('f1', a.id, 'signature'), box('f2', b.id, 'signature', { x: 0.55 })] }).ok, true, 'the draft is the person\'s to arrange');
  const before = JSON.stringify(e);
  assert.equal(m.sendEnvelope(w.d, w.ctx(), e.id, prepared()).reason, 'server_only');
  assert.equal(JSON.stringify(e), before, 'refusing changes nothing'); assert.equal(doc.status, 'draft');
  // a request the server sent: no change from the person's side except voiding it
  m.send(e, iso(0), { consentText: 'Test consent sentence.' });
  assert.equal(m.viewEnvelope(w.d, w.ctx(), e.id, a.id), false);
  assert.equal(m.signEnvelope(w.d, w.ctx(), e.id, a.id, answer()).reason, 'server_only');
  assert.equal(m.declineEnvelope(w.d, w.ctx(), e.id, a.id, 'No').reason, 'server_only');
  assert.equal(m.remindEnvelope(w.d, w.ctx(), e.id).reason, 'server_only');
  e.expiresAt = iso(-1);
  assert.deepEqual(m.sweepEnvelopes(w.d, w.ctx()), { expired: 0, reminded: 0 }, 'the server sweeps its own requests');
  assert.equal(e.status, 'sent');
  assert.equal(m.voidEnvelope(w.d, w.ctx(), e.id).ok, true); assert.equal(e.status, 'void');
});
