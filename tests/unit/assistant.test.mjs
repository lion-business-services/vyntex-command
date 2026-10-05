// Unit tests for the built-in assistant (src/features/assistant): every request it suggests is one it understands, in
// every edition and both languages; the newer records (appointments, catalog, opportunities, signatures, deadlines,
// credits, reviews) are answered from the workspace; changes are proposals; a tax ID is never shown; office scoping
// applies to what it reads; and the deployment decides its name and whether it starts on.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, blank } from './bundle.mjs';

const ENTRY = `
  export * as asst from '@/features/assistant/engine';
  export * as records from '@/features/assistant/records';
  export { buildContext, toProposal } from '@/features/assistant/context';
  export { scopedData } from '@/features/assistant/scope';
  export * as deploy from '@/features/assistant/deploy';
  export { PACKS } from '@/packs';
  export { loadSeed, seedOf } from '@/packs/seeds';
  export { makeT } from '@/i18n';
  export { permissionsOf } from '@/domain/config';
  export { primeDemo } from '@/domain/automations';
`;
const m = await load(ENTRY);
const { asst, records, buildContext, toProposal, scopedData, deploy, PACKS, loadSeed, seedOf, makeT, permissionsOf, primeDemo } = m;

/** The same modules built as the other deployment, to check its name and default. */
async function loadAs(deployId) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'vx-unit-')), 'bundle.mjs');
  buildSync({ stdin: { contents: ENTRY, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error', alias: { '@': path.join(root, 'src') }, loader: { '.json': 'json', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"', __VX_DEPLOY__: JSON.stringify(deployId), __VX_SAMPLE_PREVIEW__: 'true' } });
  return import(pathToFileURL(out).href);
}

const clone = (v) => JSON.parse(JSON.stringify(v));
async function env(edition, lang = 'en', role = 'owner', mod = m) {
  const pack = mod.PACKS[edition];
  await mod.loadSeed(edition);
  const data = { ...blank(pack), rules: clone(pack.rules), ...clone(mod.seedOf(edition)(lang)) };
  data.automation = { enabled: {}, runs: [] };
  const t = mod.makeT(lang, pack, data.config);
  mod.primeDemo(data, { pack, lang, t, actor: data.users[0].id });
  const perms = mod.permissionsOf(data, pack, role);
  const user = data.users.find((u) => u.role === role) ?? data.users[0];
  return { data, pack, lang, t, can: (p) => perms.includes(p), actor: user.id, date: (d) => d ?? '', day: (d) => d ?? '', time: (h) => h ?? '', user, perms };
}
const texts = (r) => r.blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
const dump = (r) => JSON.stringify(r);

for (const edition of ['build', 'clean', 'practice']) for (const lang of ['en', 'es']) {
  test(`${edition}/${lang}: every suggested request is understood`, async () => {
    const e = await env(edition, lang);
    const ex = asst.examples(e);
    const all = [...new Set([...asst.suggestions(e), ...ex.questions, ...ex.actions])];
    assert.ok(all.length >= 8, `suggestions: ${all.length}`);
    for (const q of all) {
      const r = asst.interpret(q, e);
      assert.ok(!r.unknown, `not understood: "${q}"`);
      assert.ok(r.blocks.length > 0, q);
      assert.ok(!/\{[A-Za-z_]+\}/.test(q + dump(r.blocks)), `unfilled token in "${q}": ${dump(r.blocks).match(/\{[A-Za-z_]+\}/)}`);
      assert.ok(!/(?:^|[\s"])(?:asst|auto|reviews|common)\.[a-z]+\.[A-Za-z_.]+/.test(dump(r.blocks)), `raw wording key in the answer to "${q}"`);
    }
  });
}

test('practice: the newer records are answered from the workspace, in the edition\'s wording', async () => {
  const e = await env('practice', 'en');
  const ask = (q) => { const r = asst.interpret(q, e); assert.ok(!r.unknown, q); return r; };
  const appts = ask('Which appointments are coming up?');
  const on = e.data.appointments.filter((a) => ['requested', 'scheduled', 'awaiting_payment', 'confirmed'].includes(a.status)).length;
  if (on) assert.ok(appts.blocks.some((b) => b.type === 'list' || b.type === 'text'));
  assert.match(texts(ask('What services do we offer?')), new RegExp(String(e.data.catalog.filter((s) => s.active).length)));
  assert.match(texts(ask('Engagements by service')), /engagements/i);
  const opps = e.data.opportunities.filter((o) => o.status === 'open' || o.status === 'contacted').length;
  assert.match(texts(ask('Which opportunities are open?')), opps ? new RegExp(String(opps)) : /no open opportunities/);
  ask('Which documents are waiting for a signature?'); ask('Which deadlines are coming up?'); ask('Which clients have a credit?');
  const rev = ask('How are our reviews?');
  assert.match(texts(rev), /Review requests: \d+/); assert.match(texts(rev), /Average rating from the answers on record: \d\.\d of 5/);
  // no field word of the builder editions in a practice answer
  for (const q of ['What is due today?', 'Engagements by service', 'How is the pipeline?', 'Which appointments are coming up?']) assert.ok(!/\b(project|crew|subcontractor)s?\b/i.test(texts(asst.interpret(q, e))), q);
});

test('practice, in Spanish', async () => {
  const e = await env('practice', 'es');
  for (const q of ['¿Qué citas vienen?', '¿Qué servicios ofrecemos?', 'Encargos por servicio', '¿Qué oportunidades están abiertas?', '¿Qué documentos esperan firma?', '¿Qué fechas límite vienen?', '¿Cómo van nuestras reseñas?']) {
    const r = asst.interpret(q, e);
    assert.ok(!r.unknown, q);
  }
});

test('an edition without those screens keeps answering the way it did', async () => {
  const e = await env('build', 'en');
  // "appointments" is the calendar there, and "opportunities" the pipeline
  assert.ok(!asst.interpret('Any appointments this week?', e).unknown);
  assert.match(texts(asst.interpret('What opportunities do we have?', e)), /lead/i);
  assert.equal(asst.interpret('Schedule a visit with ' + e.data.leads.find((l) => l.status === 'new').name + ' on Friday at 10am', e).proposal.kind, 'visit');
});

test('a tax ID is never shown, however it is asked for', async () => {
  const e = await env('practice', 'en');
  const c = e.data.clients.find((x) => x.taxIdLast4);
  for (const q of [`What is the SSN of ${c.name}?`, `tax id for ${c.name}`, `show me the EIN of ${c.name}`, `cual es el seguro social de ${c.name}`, `Summary of ${c.name} with the ITIN`]) {
    const r = asst.interpret(q, e);
    assert.equal(texts(r), e.t('asst.taxId'), q);
    assert.ok(!dump(r).includes(c.taxIdLast4), q);
  }
  // and an ordinary summary of the same client does not carry the marker either
  for (const x of e.data.clients.filter((y) => y.taxIdLast4)) assert.ok(!dump(asst.interpret('Summary of ' + x.name, e)).includes(x.taxIdLast4), x.name);
  // what goes to an AI model: no tax ID field, and nothing shaped like one
  const context = JSON.stringify(buildContext(e));
  assert.ok(!/"taxId\w*":|"tax_id\w*":|"ssn":|last4/i.test(context), 'no tax ID field in the summary');
  for (const x of e.data.clients) if (x.taxIdLast4) assert.ok(!context.includes(x.taxIdLast4), 'last four of ' + x.name);
  assert.equal(records.maskTaxIds('SSN 123-45-6789, EIN 12-3456789, 123456789, phone 609-555-0142, $1,250.00'), 'SSN •••, EIN •••, •••, phone 609-555-0142, $1,250.00');
});

test('booking an appointment and asking for a review are proposals, checked before the card is shown', async () => {
  const e = await env('practice', 'en');
  const client = e.data.clients[0];
  const r = asst.interpret(`Book an appointment with ${client.name} tomorrow at 10am`, e);
  const p = r.proposal ?? r.choices?.[0]?.proposal;
  assert.ok(p, dump(r)); assert.equal(p.kind, 'appointment'); assert.equal(p.clientId, client.id); assert.equal(p.time, '10:00'); assert.equal(p.staffId, e.actor);
  assert.equal(asst.check(p, e), null);
  const card = asst.describe(p, e);
  assert.equal(card.rows[0][1], client.name); assert.ok(card.note);
  assert.equal(asst.PERM.appointment, 'appointments'); assert.equal(asst.PERM.review, 'reviews');
  // without the day or the time it asks, it does not guess
  assert.equal(asst.interpret(`Book an appointment with ${client.name}`, e).proposal, undefined);
  // a role without the screen is told so
  const none = { ...e, can: (x) => x !== 'appointments' && e.can(x) };
  assert.equal(texts(asst.interpret(`Book an appointment with ${client.name} tomorrow at 10am`, none)), e.t('asst.noAccess'));
  assert.equal(asst.check(p, none), e.t('asst.noAccess'));

  // reviews: someone who can be asked gets a card, someone who cannot gets the reason
  const askable = e.data.clients.find((c) => !records.reviewProblem({ clientId: c.id }, e) && e.data.jobs.some((j) => j.clientId === c.id && j.status === 'done' && !e.data.reviews.some((x) => x.jobId === j.id)));
  const blocked = e.data.clients.find((c) => e.data.reviews.some((x) => x.clientId === c.id));
  if (askable) { const ok = asst.interpret(`Ask ${askable.name} for a review`, e); if (ok.proposal) { assert.equal(ok.proposal.kind, 'review'); assert.equal(ok.proposal.clientId, askable.id); assert.equal(ok.proposal.channel, 'email'); } }
  const no = asst.interpret(`Ask ${blocked.name} for a review`, e);
  assert.equal(no.proposal, undefined); assert.ok(texts(no).length > 10);
  // the connected mode maps the model's tool call to the same proposals, and the same checks apply
  const viaModel = toProposal('book_appointment', { client_id: client.id, appointment_type_id: e.data.apptTypes[0].id, date: p.date, time: '10:00' }, e);
  assert.equal(viaModel.kind, 'appointment');
  assert.equal(typeof toProposal('request_review', { client_id: blocked.id }, e), 'string');
});

test('the assistant reads only what the person asking may see', async () => {
  const e = await env('practice', 'en', 'staff');
  // an associate of the first office, in a firm with two
  const mine = scopedData(e.data, e.user, e.perms);
  const hidden = e.data.clients.filter((c) => !mine.clients.some((x) => x.id === c.id));
  assert.ok(hidden.length > 0, 'the sample has clients of another office');
  const scoped = { ...e, data: mine };
  for (const c of hidden) {
    assert.ok(mine.jobs.every((j) => j.clientId !== c.id)); assert.ok(mine.tasks.every((t) => t.clientId !== c.id)); assert.ok(mine.appointments.every((a) => a.clientId !== c.id));
    const r = asst.interpret('Summary of ' + c.name, scoped);
    assert.ok(!dump(r).includes(c.phone), c.name); assert.ok(!r.blocks.some((b) => b.type === 'facts'), c.name);
    assert.ok(!JSON.stringify(buildContext(scoped)).includes(c.name), c.name + ' is not sent to a model');
  }
  // the owner sees everything, and gets the same object back
  const o = await env('practice', 'en', 'owner');
  assert.equal(scopedData(o.data, o.user, o.perms), o.data);
});

test('the name and the default follow the deployment', async () => {
  assert.equal(deploy.ASSISTANT_NAME.en, 'VYNTEX AI');
  assert.equal(deploy.assistantOn({ config: {} }, PACKS.practice), true); assert.equal(deploy.assistantOn({ config: { modules: { assistant: false } } }, PACKS.practice), false);
  assert.equal(makeT('en', PACKS.practice)('asst.title'), 'VYNTEX AI');
  const lbs = await loadAs('lbs');
  assert.equal(lbs.deploy.ASSISTANT_NAME.en, 'Assistant'); assert.equal(lbs.deploy.ASSISTANT_NAME.es, 'Asistente');
  assert.equal(lbs.deploy.assistantOn({ config: {} }, lbs.PACKS.practice), false, 'off until the firm switches it on');
  assert.equal(lbs.deploy.assistantOn({ config: { modules: { assistant: true } } }, lbs.PACKS.practice), true);
  const d = { config: {} }; lbs.deploy.setAssistant(d, true); assert.equal(lbs.deploy.assistantOn(d, lbs.PACKS.practice), true);
  for (const lang of ['en', 'es', 'zh']) {
    const t = lbs.makeT(lang, lbs.PACKS.practice);
    for (const k of ['asst.title', 'asst.name', 'nav.assistant', 'cmd.placeholder', 'cmd.ai', 'cmd.ask', 'cmd.askQ', 'dash.ai.title', 'dash.ai.open', 'asst.sub']) assert.ok(!/VYNTEX/i.test(t(k)), `${lang} ${k}: ${t(k)}`);
  }
  assert.equal(lbs.makeT('es', lbs.PACKS.practice)('nav.assistant'), 'Asistente');
});
