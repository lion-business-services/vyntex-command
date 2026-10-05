// Unit tests for the lead actions: winning a lead never duplicates a client, automatic assignment takes turns, and a
// handoff keeps the trail. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { createLead, convertLead, assignNextLead, handoffLead, setLeadStage } from '@/domain/actions';
  export { matchClient } from '@/domain/actions/leads';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
  export { isWon, routingOf } from '@/domain/config';
`);
const { createLead, convertLead, assignNextLead, handoffLead, setLeadStage, matchClient, PACKS, makeT, isWon, routingOf } = m;

const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
function world(edition = 'build') {
  const pack = PACKS[edition];
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff'), user('u4', 'staff'), user('u5', 'readonly')];
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u1' };
  return { d, ctx, pack };
}
const client = (id, o) => ({ id, name: 'Dana Example', phone: '', email: '', addresses: [], since: '2025-01-01', notes: [], ...o });
const leadIn = (o = {}) => ({ name: 'Dana Example', phone: '609-555-0142', email: 'dana@example.com', address: '1 Sample Way', type: o.type ?? 'kitchen', source: 'phone', pri: 'medium', value: 5000, ownerId: 'u2', ...o });
const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/* ---------- convertLead ---------- */

test('convertLead reuses a client with the same email, whatever the letter case', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1', { name: 'D. Example', email: 'Dana@Example.com', addresses: ['9 Sample Road'] }));
  const lead = createLead(d, ctx, leadIn());
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.clients.length, 1, 'no second client record');
  assert.equal(job.clientId, 'c1');
  assert.equal(lead.clientId, 'c1');
  assert.deepEqual(d.clients[0].addresses, ['9 Sample Road', '1 Sample Way'], 'the new address is added to the client');
});

test('convertLead reuses a client with the same phone number, however it is written', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1', { name: 'Someone Else', phone: '(609) 555 0142' }));
  const lead = createLead(d, ctx, leadIn({ email: '' }));
  convertLead(d, ctx, lead.id);
  assert.equal(d.clients.length, 1);
  assert.equal(lead.clientId, 'c1');
});

test('email is checked before phone, and phone before name and address', () => {
  const { d, ctx } = world();
  d.clients.push(client('by-name', { addresses: ['1 Sample Way'] }), client('by-phone', { name: 'P', phone: '609-555-0142' }), client('by-email', { name: 'E', email: 'dana@example.com' }));
  assert.equal(matchClient(d, { ...leadIn(), id: 'x' }).id, 'by-email');
  assert.equal(matchClient(d, { ...leadIn({ email: '' }), id: 'x' }).id, 'by-phone');
  assert.equal(matchClient(d, { ...leadIn({ email: '', phone: '' }), id: 'x' }).id, 'by-name');
});

test('the same name alone is not a match: it takes the same name at the same address', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1', { addresses: ['77 Other Street'] }));
  const lead = createLead(d, ctx, leadIn({ email: '', phone: '' }));
  convertLead(d, ctx, lead.id);
  assert.equal(d.clients.length, 2, 'a different person with the same name gets their own record');
  const same = createLead(d, ctx, leadIn({ email: '', phone: '', address: '77 other street' }));
  convertLead(d, ctx, same.id);
  assert.equal(d.clients.length, 2, 'same name and same address is the same client');
  assert.equal(same.clientId, 'c1');
});

test('convertLead creates the client once, and converting again returns the same job', () => {
  const { d, ctx, pack } = world();
  const lead = createLead(d, ctx, leadIn());
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.clients.length, 1);
  assert.equal(d.jobs.length, 1);
  assert.ok(isWon(d, pack, lead.status), 'the lead sits in a won stage');
  assert.equal(job.status, 'contract');
  assert.equal(job.managerId, 'u2');
  assert.equal(job.leadId, lead.id);
  const again = convertLead(d, ctx, lead.id);
  assert.equal(again.id, job.id);
  assert.equal(d.jobs.length, 1, 'no second job');
  assert.ok(d.tasks.some((t) => t.jobId === job.id), 'the won-lead rule added the kickoff tasks');
});

test('convertLead works for the practice edition: the engagement comes from the first service of the lead', () => {
  const { d, ctx, pack } = world('practice');
  d.catalog.push(
    { id: 's-books', name: 'Monthly bookkeeping', category: 'bookkeeping', active: true, repeat: 'monthly', tiers: [{ id: 's-books-t1', name: 'Standard', price: 250, unit: 'month' }], i18n: { es: { name: 'Contabilidad mensual' } } },
    { id: 's-payroll', name: 'Payroll service', category: 'payroll', active: true, tiers: [{ id: 's-payroll-t1', name: 'Standard', price: 95, unit: 'month' }] },
  );
  const lead = createLead(d, ctx, leadIn({ type: 'bookkeeping', source: 'walk_in', value: null, serviceIds: ['s-books', 's-payroll'], kind: 'business', lang: 'es', officeId: 'o1' }));
  const job = convertLead(d, ctx, lead.id);
  assert.equal(job.name, 'Monthly bookkeeping');
  assert.equal(job.serviceId, 's-books');
  assert.equal(job.tierId, 's-books-t1');
  assert.equal(job.price, 250, 'the tier price stands in when the lead has no value');
  assert.equal(job.repeat, 'monthly');
  assert.equal(job.officeId, 'o1');
  assert.equal(lead.status, 'won');
  assert.ok(isWon(d, pack, lead.status));
  const c = d.clients.find((x) => x.id === lead.clientId);
  assert.equal(c.kind, 'business');
  assert.equal(c.lang, 'es');
  assert.equal(c.officeId, 'o1');
  assert.equal(c.assignedTo, 'u2');
});

test('setLeadStage to a won stage converts; a company with its own stages still works', () => {
  const { d, ctx, pack } = world('practice');
  d.config.leadStages = [{ id: 'open', label: { en: 'Open', es: 'Abierto' }, kind: 'open', role: 'new' }, { id: 'signed', label: { en: 'Signed', es: 'Firmado' }, kind: 'won' }, { id: 'gone', label: { en: 'Gone', es: 'Perdido' }, kind: 'lost' }];
  const lead = createLead(d, ctx, leadIn({ type: 'tax', source: 'phone' }));
  assert.equal(lead.status, 'open', 'a new lead starts in the company\'s first stage');
  setLeadStage(d, ctx, lead.id, 'signed');
  assert.equal(lead.status, 'signed');
  assert.ok(isWon(d, pack, lead.status));
  assert.equal(d.jobs.length, 1);
  const other = createLead(d, ctx, leadIn({ type: 'tax', source: 'phone', name: 'Other Person', email: 'other@example.com', phone: '609-555-0143' }));
  setLeadStage(d, ctx, other.id, 'gone');
  assert.equal(other.status, 'gone');
  assert.equal(typeof other.lostAt, 'string');
  assert.equal(d.jobs.length, 1, 'a lost lead creates nothing');
});

/* ---------- assignNextLead ---------- */

const routing = (d, more = {}) => { d.config.routing = { mode: 'round_robin', pool: ['u2', 'u3', 'u4'], cursor: 0, exclude: [], skipAway: true, ...more }; };

test('assignNextLead takes turns in pool order and wraps around', () => {
  const { d, ctx } = world();
  routing(d);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => assignNextLead(d, ctx)), ['u2', 'u3', 'u4', 'u2', 'u3']);
  assert.equal(routingOf(d).cursor, 2, 'the cursor points at whoever is next');
});

test('assignNextLead starts from the cursor', () => {
  const { d, ctx } = world();
  routing(d, { cursor: 2 });
  assert.deepEqual([1, 2].map(() => assignNextLead(d, ctx)), ['u4', 'u2']);
});

test('assignNextLead skips people who are excluded, switched off, read only or away', () => {
  const { d, ctx } = world();
  routing(d, { pool: ['u2', 'u3', 'u4', 'u5'], exclude: ['u2'] });
  d.users.find((u) => u.id === 'u3').away = { from: day(-1), to: day(2) };
  assert.deepEqual([1, 2, 3].map(() => assignNextLead(d, ctx)), ['u4', 'u4', 'u4'], 'only u4 can take a lead: u2 excluded, u3 away, u5 read only');
  d.users.find((u) => u.id === 'u4').active = false;
  d.config.routing.fallbackId = 'u2';
  assert.equal(assignNextLead(d, ctx), 'u2', 'nobody in the pool: the fallback person takes it');
});

test('someone marked away still takes a turn when the company does not skip people who are away, and after they are back', () => {
  const { d, ctx } = world();
  routing(d, { pool: ['u3', 'u4'], skipAway: false });
  d.users.find((u) => u.id === 'u3').away = { from: day(-1), to: day(2) };
  assert.equal(assignNextLead(d, ctx), 'u3');
  routing(d, { pool: ['u3', 'u4'] });
  d.users.find((u) => u.id === 'u3').away = { from: day(-9), to: day(-2) };
  assert.equal(assignNextLead(d, ctx), 'u3', 'the away dates are over');
});

test('assignNextLead falls back to the fallback person, then an owner, then nobody', () => {
  const { d, ctx } = world();
  routing(d, { pool: [], fallbackId: 'u3' });
  assert.equal(assignNextLead(d, ctx), 'u3');
  routing(d, { pool: ['u9'], fallbackId: 'u8' });
  assert.equal(assignNextLead(d, ctx), 'u1', 'an unknown fallback is ignored and the owner takes it');
  d.users = [];
  assert.equal(assignNextLead(d, ctx), null);
});

test('createLead assigns the next person in turn when nobody is chosen, and records how', () => {
  const { d, ctx } = world();
  routing(d);
  const a = createLead(d, ctx, leadIn({ ownerId: undefined }));
  const b = createLead(d, ctx, leadIn({ ownerId: undefined, name: 'Second', email: 'second@example.com', phone: '609-555-0144' }));
  assert.equal(a.ownerId, 'u2');
  assert.equal(b.ownerId, 'u3');
  assert.equal(a.originalOwnerId, 'u2');
  assert.equal(a.handoffs.length, 1);
  assert.equal(a.handoffs[0].how, 'round_robin');
  assert.equal(a.handoffs[0].to, 'u2');
  const c = createLead(d, ctx, leadIn({ ownerId: 'u4', name: 'Third', email: 'third@example.com', phone: '609-555-0145' }));
  assert.equal(c.ownerId, 'u4', 'a person chosen by hand is kept');
  assert.equal(c.handoffs, undefined);
  assert.equal(routingOf(d).cursor, 2, 'a lead assigned by hand does not use up a turn');
});

test('with manual assignment a lead without an owner goes to the owner, as before', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn({ ownerId: undefined }));
  assert.equal(lead.ownerId, 'u1');
  assert.equal(lead.handoffs, undefined);
});

/* ---------- handoffLead ---------- */

test('handoffLead records who had it, who has it, who decided and why, and keeps the first owner', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn());
  const task = d.tasks.find((t) => t.leadId === lead.id);
  assert.equal(task.assignee, 'u:u2');
  const h = handoffLead(d, { ...ctx, actor: 'u1' }, lead.id, 'u3', '  Speaks Spanish  ');
  assert.equal(lead.ownerId, 'u3');
  assert.equal(lead.originalOwnerId, 'u2');
  assert.deepEqual({ from: h.from, to: h.to, by: h.by, reason: h.reason, how: h.how }, { from: 'u2', to: 'u3', by: 'u1', reason: 'Speaks Spanish', how: 'manual' });
  assert.equal(task.assignee, 'u:u3', 'the open task of the previous owner moves with the lead');
  handoffLead(d, ctx, lead.id, 'u4');
  assert.equal(lead.ownerId, 'u4');
  assert.equal(lead.originalOwnerId, 'u2', 'the first owner is kept through a second handoff');
  assert.equal(lead.handoffs.length, 2);
  assert.equal(lead.handoffs[1].from, 'u3');
  assert.equal('reason' in lead.handoffs[1], false);
});

test('handoffLead does nothing for the same owner, an unknown person or an unknown lead', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn());
  assert.equal(handoffLead(d, ctx, lead.id, 'u2'), null);
  assert.equal(handoffLead(d, ctx, lead.id, 'nobody'), null);
  assert.equal(handoffLead(d, ctx, 'no-lead', 'u3'), null);
  assert.equal(lead.ownerId, 'u2');
  assert.equal(lead.handoffs, undefined);
  assert.equal(lead.originalOwnerId, undefined);
});
