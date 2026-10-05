// Unit tests for the client and pipeline logic added with the professional-services edition: finding a client already on
// file, merging two records, asking for access, office scope for leads, the lost reason, last contact, the company's own
// stages, lead routing and its "who is next" read-out, and the list totals.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { createLead, setLeadStage, handoffLead, addNote, saveClient, assignNextLead } from '@/domain/actions';
  export { markLeadLost, setNextAction, findLeadMatches, upcomingTurns, assignLeadTurn, takesTurn, skipReason, saveLeadStages, resetLeadStages, saveLeadSources, saveLostReasons, saveRouting, stageProblem } from '@/domain/actions/leads';
  export { findClientMatches, isLikelyDuplicate, mergeClients, mergeBlock, requestClientAccess, withdrawAccessRequest, normPhone, normName } from '@/domain/actions/clients';
  export { canSeeLead, visibleLeads, hiddenLeadCount, visibleClients, hiddenClients, accessState, officesFor } from '@/domain/access';
  export { stagesOf, routingOf, sourcesOf, lostReasonsOf, isLost, isOpen, permissionsOf } from '@/domain/config';
  export { clientMoney } from '@/domain/selectors';
  export { moneyByClient, nextAppointment, optOuts, kindOf } from '@/features/clients/model';
  export { leadSignals, nextStepOf, lastContactOf, messageContacts, STALE_DAYS } from '@/features/leads/model';
  export { seed } from '@/packs/practice/seed';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
`);
const { createLead, setLeadStage, handoffLead, addNote, saveClient, markLeadLost, setNextAction, findLeadMatches, upcomingTurns, assignLeadTurn, takesTurn, skipReason, saveLeadStages, resetLeadStages, saveLeadSources,
  saveLostReasons, saveRouting, stageProblem, findClientMatches, isLikelyDuplicate, mergeClients, mergeBlock, requestClientAccess, withdrawAccessRequest, normPhone, normName, canSeeLead, visibleLeads, hiddenLeadCount,
  visibleClients, hiddenClients, accessState, officesFor, stagesOf, routingOf, sourcesOf, lostReasonsOf, isLost, isOpen, permissionsOf, clientMoney, moneyByClient, nextAppointment, optOuts, kindOf, leadSignals, nextStepOf,
  lastContactOf, messageContacts, STALE_DAYS, seed, PACKS, makeT } = m;

const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
function world(edition = 'practice') {
  const pack = PACKS[edition];
  const d = blank(pack);
  d.users = [user('u1', 'owner', { officeIds: ['o1', 'o2'] }), user('u2', 'manager', { officeIds: ['o1'] }), user('u3', 'staff', { officeIds: ['o1'] }), user('u4', 'staff', { officeIds: ['o2'] }), user('u5', 'readonly', { officeIds: ['o1'] })];
  d.offices = [{ id: 'o1', name: 'North', address: '' }, { id: 'o2', name: 'South', address: '' }];
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u1' };
  return { d, ctx, pack };
}
const client = (id, o = {}) => ({ id, name: 'Dana Example', phone: '', email: '', addresses: [], since: '2025-01-01', notes: [], ...o });
const leadIn = (o = {}) => ({ name: 'Dana Example', phone: '609-555-0142', email: 'dana@example.com', address: '1 Sample Way', type: 'tax', source: 'phone', pri: 'medium', value: 500, ownerId: 'u2', ...o });
const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const perms = (w, id) => permissionsOf(w.d, w.pack, w.d.users.find((u) => u.id === id).role);

/* ---------- is this person already on file? ---------- */

test('findClientMatches scores email over phone over name, and an address only adds weight', () => {
  const { d } = world();
  d.clients.push(client('by-name', { addresses: ['1 Sample Way'] }), client('by-phone', { name: 'P', phone: '+1 (609) 555-0142' }), client('by-email', { name: 'E', email: 'DANA@example.com' }),
    client('by-contact', { name: 'C', contacts: [{ id: 'k', name: 'Dana', email: 'dana@example.com' }] }), client('other', { name: 'Somebody Else', addresses: ['1 Sample Way'] }));
  const hits = findClientMatches(d, { name: 'dana  example', email: 'dana@example.com', phone: '609.555.0142', address: '1 sample way' });
  assert.deepEqual(hits.map((h) => [h.client.id, h.score]), [['by-email', 40], ['by-contact', 30], ['by-name', 30], ['by-phone', 30]]);
  assert.ok(!hits.some((h) => h.client.id === 'other'), 'the same address alone is not a match');
  assert.deepEqual(hits.find((h) => h.client.id === 'by-name').by, ['name', 'address']);
  assert.ok(hits.every(isLikelyDuplicate));
});

test('a shared name alone is not a likely duplicate; excluding a record leaves it out', () => {
  const { d } = world();
  d.clients.push(client('c1'), client('c2', { email: 'x@example.com' }));
  const hits = findClientMatches(d, { name: 'Dana Example' });
  assert.equal(hits.length, 2);
  assert.ok(!hits.some(isLikelyDuplicate), 'two people can have the same name');
  assert.deepEqual(findClientMatches(d, { name: 'Dana Example' }, { excludeId: 'c1' }).map((h) => h.client.id), ['c2']);
  assert.equal(normPhone('+1 (609) 555-0142'), '6095550142');
  assert.equal(normName('  O\'Brien,   María-José '), 'obrien maríajosé');
});

test('findLeadMatches finds the same email or phone, open leads first', () => {
  const { d, ctx, pack } = world();
  const a = createLead(d, ctx, leadIn());
  const b = createLead(d, ctx, leadIn({ name: 'Other', email: 'other@example.com', phone: '(609) 555-0142' }));
  markLeadLost(d, ctx, a.id, 'lost', 'price');
  const hits = findLeadMatches(d, pack, { email: 'DANA@example.com', phone: '6095550142' });
  assert.deepEqual(hits.map((h) => [h.lead.id, h.by]), [[b.id, ['phone']], [a.id, ['email', 'phone']]]);
  assert.deepEqual(findLeadMatches(d, pack, {}), []);
});

/* ---------- merge ---------- */

test('mergeClients moves everything to the record that stays, fills its blanks and removes the other', () => {
  const { d, ctx } = world();
  d.clients.push(
    client('keep', { email: 'dana@example.com', addresses: ['1 Sample Way'], tags: ['vip'], since: '2025-03-01', notes: [{ id: 'n1', at: '2025-03-02T10:00:00.000Z', kind: 'note', text: 'kept note' }], owners: [{ id: 'o1', name: 'Dana Example', pct: 60 }] }),
    client('drop', { name: 'D. Example', phone: '609-555-0142', email: 'old@example.com', company: 'Example LLC', addresses: ['1 sample way', '9 Other Road'], tags: ['VIP', 'monthly'], since: '2024-06-01', emailOptOut: true, lang: 'es',
      notes: [{ id: 'n2', at: '2025-04-02T10:00:00.000Z', kind: 'call', text: 'dropped note' }], owners: [{ id: 'o9', name: 'dana example', pct: 60 }, { id: 'o8', name: 'Sam Example', pct: 40 }], externalIds: { square: 'SQ-1' } }),
    client('bystander'));
  d.jobs.push({ id: 'j1', clientId: 'drop', received: [] }, { id: 'j2', clientId: 'bystander', received: [] });
  d.tasks.push({ id: 't1', clientId: 'drop' }, { id: 't2' });
  d.docs.push({ id: 'd1', clientId: 'drop', jobId: 'j1' });
  d.leads.push({ id: 'l1', clientId: 'drop', notes: [], status: 'won' });
  d.messages.push({ id: 'm1', clientId: 'drop', ref: { type: 'client', id: 'drop' } }, { id: 'm2', ref: { type: 'job', id: 'j1' } });
  d.appointments.push({ id: 'a1', clientId: 'drop' });
  d.opportunities.push({ id: 'op1', clientId: 'drop' });
  d.reviews.push({ id: 'r1', clientId: 'drop' });
  d.complianceItems.push({ id: 'ci1', clientId: 'drop' });
  d.accessRequests.push({ id: 'ar1', userId: 'u3', clientId: 'drop', status: 'pending' });
  d.activity.push({ id: 'ac1', kind: 'client.created', ref: { type: 'client', id: 'drop' }, also: [{ type: 'client', id: 'drop' }], by: 'u1', at: '2024-06-01T10:00:00.000Z' });

  const out = mergeClients(d, ctx, 'keep', 'drop');
  assert.equal(out.ok, true);
  assert.deepEqual(out.moved, { jobs: 1, tasks: 1, docs: 1, messages: 1, appointments: 1, opportunities: 1, notes: 1 });
  assert.deepEqual(d.clients.map((c) => c.id), ['keep', 'bystander']);
  const k = d.clients[0];
  assert.equal(k.name, 'Dana Example', 'the record that stays wins where both say something');
  assert.equal(k.email, 'dana@example.com');
  assert.deepEqual({ phone: k.phone, company: k.company, lang: k.lang, since: k.since, optOut: k.emailOptOut }, { phone: '609-555-0142', company: 'Example LLC', lang: 'es', since: '2024-06-01', optOut: true });
  assert.deepEqual(k.addresses, ['1 Sample Way', '9 Other Road'], 'the same address is not listed twice');
  assert.deepEqual(k.tags, ['vip', 'monthly']);
  assert.deepEqual(k.owners.map((o) => o.name), ['Dana Example', 'Sam Example']);
  assert.deepEqual(k.externalIds, { square: 'SQ-1' });
  assert.deepEqual(k.notes.map((n) => n.id), ['n2', 'n1'], 'notes of both, newest first');
  for (const [list, id] of [[d.jobs, 'j1'], [d.tasks, 't1'], [d.docs, 'd1'], [d.leads, 'l1'], [d.messages, 'm1'], [d.appointments, 'a1'], [d.opportunities, 'op1'], [d.reviews, 'r1'], [d.complianceItems, 'ci1']])
    assert.equal(list.find((x) => x.id === id).clientId, 'keep', id);
  assert.deepEqual(d.messages[0].ref, { type: 'client', id: 'keep' });
  assert.equal(d.jobs.find((j) => j.id === 'j2').clientId, 'bystander', 'other clients are untouched');
  assert.equal(d.accessRequests.length, 0);
  assert.ok(!JSON.stringify(d).includes('"drop"'), 'nothing points at the removed record any more');
  const log = d.activity.find((a) => a.kind === 'client.merged');
  assert.deepEqual({ ref: log.ref, name: log.params.name, by: log.by }, { ref: { type: 'client', id: 'keep' }, name: 'D. Example (Example LLC)', by: 'u1' });
});

test('mergeClients refuses to remove a record that holds what only the server may write, and changes nothing', () => {
  const { d, ctx } = world();
  d.clients.push(client('a', { taxIdType: 'ssn', taxIdLast4: '0142' }), client('b'), client('c', { taxIdType: 'ein', taxIdLast4: '4410' }), client('e'), client('f'));
  d.credits.push({ id: 'cr1', clientId: 'e', amount: 50 });
  d.secureLog.push({ id: 'sl1', clientId: 'f', action: 'request' });
  const before = JSON.stringify(d);
  assert.deepEqual(mergeClients(d, ctx, 'b', 'a'), { ok: false, reason: 'protected_history' });
  assert.deepEqual(mergeClients(d, ctx, 'c', 'a'), { ok: false, reason: 'both_tax_ids' });
  assert.deepEqual(mergeClients(d, ctx, 'b', 'e'), { ok: false, reason: 'credits' });
  assert.deepEqual(mergeClients(d, ctx, 'b', 'f'), { ok: false, reason: 'protected_history' });
  assert.deepEqual(mergeClients(d, ctx, 'b', 'b'), { ok: false, reason: 'same' });
  assert.deepEqual(mergeClients(d, ctx, 'b', 'nobody'), { ok: false, reason: 'not_found' });
  assert.equal(JSON.stringify(d), before, 'a refused merge changes nothing');
  assert.equal(mergeBlock(d, 'a', 'b'), null, 'the other way round works: the record with the tax ID is the one that stays');
  assert.equal(mergeClients(d, ctx, 'a', 'b').ok, true);
  assert.equal(d.clients.find((c) => c.id === 'a').taxIdLast4, '0142');
});

/* ---------- office scope ---------- */

test('a lead with an office is seen by its office, its owner and anyone who sees all clients', () => {
  const w = world(); const { d } = w;
  d.leads.push({ id: 'north', officeId: 'o1', ownerId: 'u2' }, { id: 'south', officeId: 'o2', ownerId: 'u4' }, { id: 'none', ownerId: 'u4' }, { id: 'south-mine', officeId: 'o2', ownerId: 'u3' });
  const u = (id) => d.users.find((x) => x.id === id);
  assert.deepEqual(visibleLeads(d, u('u3'), perms(w, 'u3')).map((l) => l.id), ['north', 'none', 'south-mine']);
  assert.equal(hiddenLeadCount(d, u('u3'), perms(w, 'u3')), 1);
  assert.deepEqual(visibleLeads(d, u('u4'), perms(w, 'u4')).map((l) => l.id), ['south', 'none', 'south-mine']);
  assert.equal(visibleLeads(d, u('u1'), perms(w, 'u1')).length, 4, 'the owner sees every lead');
  assert.equal(hiddenLeadCount(d, u('u1'), perms(w, 'u1')), 0);
  assert.equal(canSeeLead(undefined, [], d.leads[1]), false);
  assert.deepEqual(officesFor(d, u('u3'), perms(w, 'u3')).map((o) => o.id), ['o1']);
  assert.deepEqual(officesFor(d, u('u1'), perms(w, 'u1')).map((o) => o.id), ['o1', 'o2']);
});

test('asking for access files one waiting request per person and client, and its state is readable', () => {
  const w = world(); const { d, ctx } = w;
  d.clients.push(client('c-south', { officeId: 'o2' }), client('c-north', { officeId: 'o1' }));
  const me = d.users.find((u) => u.id === 'u3'); const mine = { ...ctx, actor: 'u3' };
  assert.deepEqual(hiddenClients(d, me, perms(w, 'u3')).map((c) => c.id), ['c-south']);
  assert.equal(accessState(d, me, 'c-south').state, 'none');
  const req = requestClientAccess(d, mine, 'c-south', '  Preparing her return  ');
  assert.deepEqual({ userId: req.userId, clientId: req.clientId, reason: req.reason, status: req.status }, { userId: 'u3', clientId: 'c-south', reason: 'Preparing her return', status: 'pending' });
  assert.equal(requestClientAccess(d, mine, 'c-south', 'again').id, req.id, 'asking twice returns the waiting request');
  assert.equal(d.accessRequests.length, 1);
  assert.equal(requestClientAccess(d, mine, 'no-such-client', 'x'), null);
  assert.equal(accessState(d, me, 'c-south').state, 'pending');
  assert.equal(withdrawAccessRequest(d, { ...ctx, actor: 'u2' }, req.id), false, 'only the person who asked can take it back');
  req.status = 'denied';
  assert.equal(accessState(d, me, 'c-south').state, 'denied');
  assert.equal(withdrawAccessRequest(d, mine, req.id), false, 'a decided request stays on record');
  const again = requestClientAccess(d, mine, 'c-south', 'New reason');
  assert.notEqual(again.id, req.id);
  assert.equal(withdrawAccessRequest(d, mine, again.id), true);
  // the grant is the server's: once it exists the client is visible and needs no state
  d.grants.push({ id: 'g1', userId: 'u3', clientId: 'c-south', grantedBy: 'u1', at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(visibleClients(d, me, perms(w, 'u3')).map((c) => c.id), ['c-south', 'c-north']);
});

/* ---------- lost, next action, last contact ---------- */

test('markLeadLost files the lead under a lost stage with the reason id, stamps the day and keeps the detail as a note', () => {
  const { d, ctx, pack } = world();
  const lead = createLead(d, ctx, leadIn());
  markLeadLost(d, ctx, lead.id, 'lost', 'competitor', '  Went with her cousin  ');
  assert.ok(isLost(d, pack, lead.status));
  assert.equal(lead.lostReason, 'competitor');
  assert.equal(lead.lostAt, day(0));
  assert.equal(lead.notes[0].text, 'Went with her cousin');
  assert.ok(d.activity.some((a) => a.kind === 'lead.lost' && a.ref.id === lead.id));
  markLeadLost(d, ctx, lead.id, 'lost', 'price');
  assert.equal(lead.lostReason, 'price', 'the reason of a lost lead can be corrected');
  assert.equal(d.activity.filter((a) => a.kind === 'lead.lost').length, 1, 'correcting the reason is not losing it again');
  markLeadLost(d, ctx, lead.id, 'won', 'price');
  assert.ok(isLost(d, pack, lead.status), 'a stage that is not a lost stage is refused');
  setLeadStage(d, ctx, lead.id, 'contacted');
  assert.deepEqual({ at: lead.lostAt, reason: lead.lostReason }, { at: undefined, reason: undefined }, 'a reopened lead is no longer lost');
});

test('a note of a call, visit, text or email is a contact; a plain note is not', () => {
  const { d, ctx, pack } = world();
  const lead = createLead(d, ctx, leadIn());
  assert.equal(lead.lastContact, undefined);
  addNote(d, ctx, { type: 'lead', id: lead.id }, 'note', 'Looked up the file');
  assert.equal(lead.lastContact, undefined);
  assert.equal(lead.status, 'new');
  addNote(d, ctx, { type: 'lead', id: lead.id }, 'call', 'Spoke for ten minutes');
  assert.ok(lead.lastContact);
  assert.equal(lead.status, 'contacted', 'the first conversation moves a new lead to contacted in a professional-services office');
  setLeadStage(d, ctx, lead.id, 'proposal');
  addNote(d, ctx, { type: 'lead', id: lead.id }, 'email', 'Sent the proposal');
  assert.equal(lead.status, 'proposal', 'a later contact never moves the lead back');
  // the field editions keep moving the stage by hand
  const field = world('build');
  const fl = createLead(field.d, field.ctx, leadIn({ type: 'kitchen' }));
  addNote(field.d, field.ctx, { type: 'lead', id: fl.id }, 'call', 'Spoke');
  assert.equal(fl.status, 'new');
  assert.ok(fl.lastContact);
});

test('lead signals: next step, overdue, nothing planned, going cold, close to a decision', () => {
  const { d, ctx, pack } = world();
  const lead = createLead(d, ctx, leadIn());
  lead.followUp = undefined;
  assert.equal(leadSignals(d, pack, lead).next.kind, 'none');
  assert.equal(leadSignals(d, pack, lead).attention, true, 'an open lead with nothing planned needs attention');
  setNextAction(d, ctx, lead.id, '  Call about the documents ', day(-2));
  assert.deepEqual(lead.nextAction, { text: 'Call about the documents', due: day(-2) });
  let s = leadSignals(d, pack, lead);
  assert.deepEqual({ kind: s.next.kind, late: s.next.late, attention: s.attention }, { kind: 'action', late: true, attention: true });
  setNextAction(d, ctx, lead.id, 'Call about the documents', day(3));
  s = leadSignals(d, pack, lead);
  assert.deepEqual({ late: s.next.late, attention: s.attention, hot: s.hot }, { late: false, attention: false, hot: false });
  setNextAction(d, ctx, lead.id, '');
  assert.equal(lead.nextAction, undefined);
  lead.followUp = day(1); lead.apptDate = day(4);
  assert.equal(nextStepOf(lead, pack).kind, 'appt', 'without a written next action the appointment drives the lead');
  assert.equal(nextStepOf({ ...lead, nextAction: { text: 'x' } }, PACKS.build).kind, 'appt', 'a field business is driven by the visit first');
  assert.equal(nextStepOf({ ...lead, nextAction: { text: 'x' } }, pack).kind, 'action');
  // going cold: created long ago and never contacted, then contacted through a message
  lead.created = day(-(STALE_DAYS + 3));
  assert.deepEqual({ idle: leadSignals(d, pack, lead).idle, stale: leadSignals(d, pack, lead).stale }, { idle: STALE_DAYS + 3, stale: true });
  d.messages.push({ id: 'm1', at: new Date().toISOString(), channel: 'email', status: 'demo', ref: { type: 'lead', id: lead.id } }, { id: 'm2', at: '2999-01-01T00:00:00.000Z', channel: 'email', status: 'draft', ref: { type: 'lead', id: lead.id } });
  const msgs = messageContacts(d);
  assert.equal(lastContactOf(lead, msgs), d.messages.find((x) => x.id === 'm1').at, 'a draft is not a contact');
  assert.equal(leadSignals(d, pack, lead, msgs).stale, false);
  setLeadStage(d, ctx, lead.id, 'negotiating');
  assert.equal(leadSignals(d, pack, lead, msgs).hot, true);
  markLeadLost(d, ctx, lead.id, 'lost', 'price');
  assert.deepEqual({ a: leadSignals(d, pack, lead).attention, s: leadSignals(d, pack, lead).stale, h: leadSignals(d, pack, lead).hot }, { a: false, s: false, h: false }, 'a closed lead needs nothing');
});

test('each shipped automation runs once per lead event', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn({ ownerId: undefined }));
  assert.equal(d.automation.runs.filter((r) => r.ruleId === 'lead-intake').length, 1);
  assert.equal(d.tasks.filter((t) => t.auto === 'lead-intake:' + lead.id).length, 1);
  setLeadStage(d, ctx, lead.id, 'won');
  assert.equal(d.automation.runs.filter((r) => r.ruleId === 'lead-won').length, 1);
});

/* ---------- the company's own stages, sources and reasons ---------- */

const st = (id, kind, more = {}) => ({ id, label: { en: id, es: id }, kind, ...more });

test('a pipeline always keeps an open stage, a won stage and a lost stage, each with a name in both languages', () => {
  assert.equal(stageProblem([st('a', 'open'), st('b', 'won'), st('c', 'lost')]), null);
  assert.equal(stageProblem([st('b', 'won'), st('c', 'lost')]), 'no_open');
  assert.equal(stageProblem([st('a', 'open'), st('c', 'lost')]), 'no_won');
  assert.equal(stageProblem([st('a', 'open'), st('b', 'won')]), 'no_lost');
  assert.equal(stageProblem([st('a', 'open'), st('b', 'won'), { id: 'c', label: { en: 'Lost', es: ' ' }, kind: 'lost' }]), 'no_label');
  assert.equal(stageProblem([st('a', 'open'), st('a', 'won'), st('c', 'lost')]), 'duplicate_id');
});

test('saveLeadStages renames, reorders and adds; a stage in use is not removed until its leads have somewhere to go', () => {
  const { d, ctx, pack } = world();
  const a = createLead(d, ctx, leadIn()); setLeadStage(d, ctx, a.id, 'negotiating');
  const b = createLead(d, ctx, leadIn({ name: 'B', email: 'b@example.com', phone: '609-555-0143' }));
  const runs = d.automation.runs.length;
  const own = stagesOf(d, pack).map((s) => ({ ...s, label: { ...s.label } }));
  own[1].label = { en: '  Reached  ', es: 'Localizado' };
  own.splice(2, 0, { id: 'st-docs', label: { en: 'Waiting on documents', es: 'Esperando documentos' }, kind: 'open', hot: true, role: undefined });
  const without = own.filter((s) => s.id !== 'negotiating');
  assert.equal(saveLeadStages(d, ctx, without), 'in_use');
  assert.equal(d.config.leadStages, undefined, 'a refused list changes nothing');
  assert.equal(saveLeadStages(d, ctx, without, { negotiating: 'nowhere' }), 'in_use', 'the leads must go to a stage that stays');
  assert.equal(saveLeadStages(d, ctx, without, { negotiating: 'proposal' }), null);
  assert.equal(a.status, 'proposal');
  assert.equal(b.status, 'new');
  assert.equal(d.automation.runs.length, runs, 'moving leads out of a removed stage runs no automation');
  assert.deepEqual(stagesOf(d, pack).map((s) => s.id), ['new', 'contacted', 'st-docs', 'appointment', 'proposal', 'won', 'lost']);
  assert.equal(makeT('en', pack, d.config)('ls_contacted'), 'Reached');
  assert.equal(makeT('es', pack, d.config)('ls_st-docs'), 'Esperando documentos');
  assert.equal(stagesOf(d, pack).find((s) => s.id === 'st-docs').hot, true);
  assert.equal(saveLeadStages(d, ctx, without.filter((s) => s.kind !== 'lost')), 'no_lost');
  // back to the edition's list only when no lead would be left in a stage it does not have
  setLeadStage(d, ctx, b.id, 'st-docs');
  assert.equal(resetLeadStages(d, ctx), 'in_use');
  setLeadStage(d, ctx, b.id, 'contacted');
  assert.equal(resetLeadStages(d, ctx), null);
  assert.equal(d.config.leadStages, undefined);
  assert.equal(stagesOf(d, pack).length, pack.leadStages.length);
});

test('sources and lost reasons are the company\'s own list, and an empty list means the edition\'s', () => {
  const { d, ctx, pack } = world();
  saveLeadSources(d, ctx, [{ id: 'phone', label: { en: 'Phone', es: 'Teléfono' } }, { id: 'src-radio', label: { en: ' Radio ad ', es: 'Anuncio de radio' } }, { id: 'blank', label: { en: '', es: '' } }]);
  assert.deepEqual(sourcesOf(d, pack).map((s) => [s.id, s.label.en]), [['phone', 'Phone'], ['src-radio', 'Radio ad']]);
  saveLostReasons(d, ctx, [{ id: 'price', label: { en: 'Too expensive', es: 'Muy caro' } }]);
  assert.deepEqual(lostReasonsOf(d, pack).map((r) => r.label.es), ['Muy caro']);
  saveLeadSources(d, ctx, []); saveLostReasons(d, ctx, []);
  assert.equal(d.config.leadSources, undefined);
  assert.equal(sourcesOf(d, pack).length, pack.leadSources.length);
  assert.equal(lostReasonsOf(d, pack).length, pack.lostReasons.length);
});

/* ---------- routing ---------- */

test('upcomingTurns says who is next without taking a turn, and matches what happens', () => {
  const { d, ctx, pack } = world();
  saveRouting(d, ctx, { mode: 'round_robin', pool: ['u2', 'u3', 'u4', 'u5', 'u2', 'ghost'], fallbackId: 'u1' });
  assert.deepEqual(routingOf(d).pool, ['u2', 'u3', 'u4'], 'no repeats, nobody who cannot work leads');
  d.users.find((u) => u.id === 'u4').away = { from: day(-1), to: day(2) };
  const before = JSON.stringify(d.config);
  assert.deepEqual(upcomingTurns(d, pack, 4).map((t) => t.userId), ['u2', 'u3', 'u2', 'u3']);
  assert.equal(JSON.stringify(d.config), before, 'looking does not move the rotation');
  const got = [1, 2, 3].map(() => createLead(d, ctx, leadIn({ ownerId: undefined, name: 'L' + Math.random(), email: Math.random() + '@example.com', phone: '' })).ownerId);
  assert.deepEqual(got, ['u2', 'u3', 'u2']);
  assert.deepEqual([skipReason(d, pack, 'u4'), skipReason(d, pack, 'u5'), skipReason(d, pack, 'u2'), skipReason(d, pack, 'ghost')], ['away', 'role', null, 'gone']);
  saveRouting(d, ctx, { exclude: ['u2', 'u3'] });
  assert.deepEqual(upcomingTurns(d, pack).map((t) => [t.userId, t.how]), [['u1', 'fallback']], 'nobody in the pool can take a lead: the fallback person');
  assert.equal(takesTurn(d, pack, 'u2'), false);
  d.users.find((u) => u.id === 'u3').inLeadPool = false;
  saveRouting(d, ctx, { exclude: [] });
  assert.equal(skipReason(d, pack, 'u3'), 'opted_out');
  saveRouting(d, ctx, { mode: 'manual' });
  assert.deepEqual(upcomingTurns(d, pack).map((t) => t.how), ['fallback']);
  saveRouting(d, ctx, { fallbackId: undefined });
  assert.deepEqual(upcomingTurns(d, pack), []);
});

test('changing the routing settings never makes someone lose or repeat a turn', () => {
  const { d, ctx, pack } = world();
  saveRouting(d, ctx, { mode: 'round_robin', pool: ['u2', 'u3', 'u4'] });
  createLead(d, ctx, leadIn({ ownerId: undefined }));
  assert.equal(upcomingTurns(d, pack)[0].userId, 'u3');
  saveRouting(d, ctx, { pool: ['u4', 'u3', 'u2'] });
  assert.equal(upcomingTurns(d, pack)[0].userId, 'u3', 'reordering keeps the turn on the same person');
  saveRouting(d, ctx, { pool: ['u4', 'u2'] });
  assert.ok(['u4', 'u2'].includes(upcomingTurns(d, pack)[0].userId));
  assert.ok(routingOf(d).cursor < 2);
});

test('with manual assignment and a fallback person, a lead nobody was chosen for goes to the fallback and says how', () => {
  const { d, ctx } = world();
  saveRouting(d, ctx, { mode: 'manual', fallbackId: 'u3' });
  const lead = createLead(d, ctx, leadIn({ ownerId: undefined }));
  assert.equal(lead.ownerId, 'u3');
  assert.deepEqual({ how: lead.handoffs[0].how, by: lead.handoffs[0].by, from: lead.handoffs[0].from }, { how: 'rule', by: 'automation', from: '' });
});

test('assignLeadTurn gives a lead nobody holds to the next person, and leaves a lead that has an owner alone', () => {
  const { d, ctx } = world();
  saveRouting(d, ctx, { mode: 'round_robin', pool: ['u2', 'u3'] });
  const lead = createLead(d, ctx, leadIn({ ownerId: 'u4' }));
  assert.deepEqual(assignLeadTurn(d, ctx, lead.id), { userId: 'u4', how: 'kept' });
  assert.equal(routingOf(d).cursor, 0, 'no turn was used');
  d.users.find((u) => u.id === 'u4').active = false;
  assert.deepEqual(assignLeadTurn(d, ctx, lead.id), { userId: 'u2', how: 'round_robin' });
  assert.equal(lead.ownerId, 'u2');
  assert.equal(lead.originalOwnerId, 'u4');
  const last = lead.handoffs[lead.handoffs.length - 1];
  assert.deepEqual({ from: last.from, to: last.to, by: last.by, how: last.how }, { from: 'u4', to: 'u2', by: 'automation', how: 'round_robin' });
  assert.deepEqual(assignLeadTurn(d, ctx, lead.id), { userId: 'u2', how: 'kept' }, 'asking twice never skips anyone');
  assert.deepEqual(assignLeadTurn(d, ctx, 'no-lead'), { userId: null, how: null });
});

/* ---------- client figures and the sample business ---------- */

test('the list totals equal the selector the client page uses, for every client of the sample firm', () => {
  for (const lang of ['en', 'es']) {
    const s = seed(lang);
    const totals = moneyByClient(s);
    for (const c of s.clients) {
      const one = clientMoney(s, c.id); const fast = totals(c.id);
      assert.deepEqual({ jobs: fast.jobs, billed: fast.billed, received: fast.received, owes: fast.owes }, one, `${lang}: ${c.id}`);
    }
  }
});

test('the sample firm shows every state: stages, flags, a handoff, lost reasons, both kinds of client, two offices, opt-outs', () => {
  const pack = PACKS.practice;
  for (const lang of ['en', 'es']) {
    const s = { ...blank(pack), ...seed(lang) };
    const stages = new Set(s.leads.map((l) => l.status));
    for (const st of pack.leadStages) assert.ok(stages.has(st.id), `${lang}: a lead in stage ${st.id}`);
    const sig = s.leads.map((l) => leadSignals(s, pack, l));
    assert.ok(sig.some((x) => x.next.late), 'an overdue next action');
    assert.ok(sig.some((x) => x.open && x.next.kind === 'none'), 'a lead with nothing planned');
    assert.ok(sig.some((x) => x.stale), 'a lead going cold');
    assert.ok(s.leads.some((l) => l.handoffs?.some((h) => h.how === 'manual' && h.reason)), 'a handoff with its reason');
    assert.ok(s.leads.some((l) => l.handoffs?.some((h) => h.how === 'round_robin')), 'a lead given out by the rotation');
    const reasons = new Set(pack.lostReasons.map((r) => r.id));
    const lost = s.leads.filter((l) => isLost(s, pack, l.status));
    assert.ok(lost.length && lost.every((l) => reasons.has(l.lostReason) && l.lostAt), 'lost leads carry a reason from the list');
    assert.ok(s.leads.filter((l) => isOpen(s, pack, l.status)).every((l) => l.serviceIds?.length), 'open leads name the services of interest');
    assert.ok(s.clients.some((c) => kindOf(c) === 'individual') && s.clients.some((c) => kindOf(c) === 'business'));
    assert.ok(s.clients.some((c) => c.owners?.length > 1 && c.owners.every((o) => typeof o.pct === 'number')), 'owners with their shares');
    assert.ok(s.clients.some((c) => c.contacts?.length), 'other contacts');
    assert.ok(s.clients.some((c) => c.tags?.length) && s.clients.some((c) => c.externalIds));
    assert.ok(s.clients.some((c) => optOuts(c).length === 2), 'a client who asked not to be emailed or texted');
    assert.deepEqual([...new Set(s.clients.map((c) => c.lifecycle))].sort(), ['active', 'former', 'inactive']);
    const staff = s.users.find((u) => u.role === 'staff'); const staffPerms = permissionsOf(s, pack, 'staff');
    assert.ok(hiddenClients(s, staff, staffPerms).length >= 1, 'a client outside the associate\'s office');
    assert.ok(hiddenLeadCount(s, staff, staffPerms) >= 1, 'a lead outside the associate\'s office');
    assert.ok(findClientMatches(s, s.clients.find((c) => c.id === 'pc13'), { excludeId: 'pc13' }).some((m) => m.client.id === 'pc1' && isLikelyDuplicate(m)), 'one person entered twice');
    assert.ok(!JSON.stringify(s.clients).match(/\d{3}-\d{2}-\d{4}|\d{2}-\d{7}/), 'no tax ID anywhere, only the last four digits');
    assert.equal(nextAppointment(s, 'pc1')?.clientId ?? 'pc1', 'pc1');
  }
});
