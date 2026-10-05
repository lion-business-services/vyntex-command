// Unit tests for the protected operations of the security module, as a sample workspace runs them:
// the tax ID vault (who may store, ask, approve and open; the two-person rule; an approval that runs out; one viewing),
// people (invitations, roles, the last owner), access to a client of another office, and exports.
// The first part tests the rules as plain functions over a workspace (src/domain/actions/security.ts). The second part
// drives the sample gateway itself (src/platform/sample.ts) over the sample firm, switching the "View as" role.
// No number in this file is a real tax ID: they are stand-ins built from parts, and none is ever stored.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

// the store reads its preferences when it is loaded: start it in the professional-services edition
const mem = new Map([['vyntex.prefs', JSON.stringify({ pack: 'practice', lang: 'en', viewAs: 'owner', tourSeen: true })]]);
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };

const m = await load(`
  export { rules, taxIdProblem, formatTaxId, maskedTaxId, revealState, memberState, waitingFor, setRolePermissions, setSecurityRules, setVaultRules, saveOffice, removeOffice, APPROVAL_MINUTES, REQUEST_HOURS } from '@/domain/actions/security';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
  export { permissionsOf, vaultRules, securityRules } from '@/domain/config';
  export { sampleProtected } from '@/platform/sample';
  export { boot, setPrefs, getSnapshot, resetDemo, mutateQuiet } from '@/store/store';
`);
const { rules, taxIdProblem, formatTaxId, maskedTaxId, revealState, memberState, waitingFor, setRolePermissions, setSecurityRules, setVaultRules, saveOffice, removeOffice, PACKS, makeT, permissionsOf, vaultRules, securityRules } = m;

// stand-in numbers, put together from parts so no file ever holds one written out
const SSN = ['123', '45', '6789'].join('-');
const EIN = ['12', '3456789'].join('-');
const ITIN = ['912', '70', '1234'].join('-');

const pack = PACKS.practice;
const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
const client = (id, more = {}) => ({ id, name: 'Client ' + id, phone: '', email: '', addresses: [], since: '2025-01-01', notes: [], ...more });
/** A small firm: two owners are not the default, so the "last owner" rule can be tested. */
function world(config = {}) {
  const d = blank(pack);
  d.config = config;
  d.offices = [{ id: 'o1', name: 'North', address: '', main: true }, { id: 'o2', name: 'South', address: '' }];
  d.users = [user('own', 'owner', { officeIds: ['o1', 'o2'] }), user('mgr', 'manager', { officeIds: ['o1'] }), user('mgr2', 'manager', { officeIds: ['o1'] }), user('stf', 'staff', { officeIds: ['o1'] }), user('ro', 'readonly', { officeIds: ['o1'] })];
  d.clients = [client('c1', { officeId: 'o1', taxIdType: 'ssn', taxIdLast4: '6789' }), client('c2', { officeId: 'o2', taxIdType: 'ein', taxIdLast4: '0001' }), client('c3', { officeId: 'o1' })];
  const as = (actor) => ({ pack, lang: 'en', t: makeT('en', pack), actor });
  return { d, as };
}
const minutes = (n) => new Date(Date.now() + n * 60000).toISOString();

/* ---------- formats ---------- */

test('tax ID shapes: nine digits, and the ranges that are never issued are refused', () => {
  assert.equal(taxIdProblem('ssn', SSN), null);
  assert.equal(taxIdProblem('ssn', SSN.replace(/-/g, '')), null, 'dashes are optional');
  assert.equal(taxIdProblem('ssn', '123-45-678'), 'length');
  assert.equal(taxIdProblem('ssn', ['000', '45', '6789'].join('-')), 'pattern');
  assert.equal(taxIdProblem('ssn', ['666', '45', '6789'].join('-')), 'pattern');
  assert.equal(taxIdProblem('ssn', ['123', '00', '6789'].join('-')), 'pattern');
  assert.equal(taxIdProblem('ssn', ['123', '45', '0000'].join('-')), 'pattern');
  assert.equal(taxIdProblem('ssn', ITIN), 'pattern', 'a number that starts with 9 is the other type');
  assert.equal(taxIdProblem('itin', ITIN), null);
  assert.equal(taxIdProblem('itin', SSN), 'pattern');
  assert.equal(taxIdProblem('itin', ['912', '10', '1234'].join('-')), 'pattern', 'middle digits outside the issued ranges');
  assert.equal(taxIdProblem('ein', EIN), null);
  assert.equal(taxIdProblem('ein', ['00', '3456789'].join('-')), 'pattern');
  assert.equal(taxIdProblem('ein', ['07', '3456789'].join('-')), 'pattern', 'a prefix that was never assigned');
  assert.equal(taxIdProblem('ssn', '12345678x'), 'pattern', 'letters are a typing mistake');
});

test('formatting and masking', () => {
  assert.equal(formatTaxId('ssn', '123456789'), SSN);
  assert.equal(formatTaxId('ein', '123456789'), EIN);
  assert.equal(formatTaxId('ssn', '1234'), '123-4');
  assert.equal(maskedTaxId('ssn', '6789'), '•••-••-6789');
  assert.equal(maskedTaxId('ein', '0001'), '••-•••0001');
  assert.equal(maskedTaxId('ssn', undefined), '•••-••-••••');
});

/* ---------- storing a number ---------- */

test('vaultSet keeps the type and the last four digits and nothing else', () => {
  const { d, as } = world();
  const res = rules.vaultSet(d, as('own'), 'c3', 'ssn', SSN);
  assert.deepEqual(res, { ok: true, data: { taxIdType: 'ssn', taxIdLast4: '6789' } });
  const c = d.clients.find((x) => x.id === 'c3');
  assert.equal(c.taxIdType, 'ssn'); assert.equal(c.taxIdLast4, '6789');
  // the full number is nowhere in the workspace: not on the client, not in the logs
  const dump = JSON.stringify(d);
  assert.ok(!dump.includes(SSN) && !dump.includes(SSN.replace(/-/g, '')), 'the number itself was dropped');
  assert.equal(d.secureLog[0].action, 'set'); assert.equal(d.secureLog[0].userId, 'own'); assert.equal(d.secureLog[0].clientId, 'c3');
  assert.equal(d.audit[0].action, 'vault.set');
  assert.ok(!/\d{4}/.test(d.audit[0].summary ?? ''), 'the audit line carries no digits');
});

test('vaultSet: wrong shape, wrong role, client of another office', () => {
  const { d, as } = world();
  assert.equal(rules.vaultSet(d, as('own'), 'c3', 'ssn', '12-34').reason, 'invalid');
  assert.equal(rules.vaultSet(d, as('own'), 'c3', 'ein', SSN.replace('123', '003')).reason, 'invalid');
  assert.equal(rules.vaultSet(d, as('stf'), 'c3', 'ssn', SSN).reason, 'not_allowed', 'an associate cannot store one');
  assert.equal(rules.vaultSet(d, as('ro'), 'c3', 'ssn', SSN).reason, 'not_allowed');
  assert.equal(rules.vaultSet(d, as('mgr'), 'c2', 'ein', EIN).reason, 'not_found', 'the senior associate does not see the other office');
  assert.equal(rules.vaultSet(d, as('nobody'), 'c3', 'ssn', SSN).reason, 'not_allowed');
  assert.equal(d.secureLog.length, 0, 'a refusal writes nothing');
  assert.equal(d.clients.find((x) => x.id === 'c3').taxIdType, undefined);
});

test('an empty value removes the number and closes what was waiting for it', () => {
  const { d, as } = world();
  const req = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  const res = rules.vaultSet(d, as('own'), 'c1', 'ssn', '');
  assert.equal(res.ok, true);
  const c = d.clients.find((x) => x.id === 'c1');
  assert.equal(c.taxIdType, undefined); assert.equal(c.taxIdLast4, undefined);
  assert.equal(d.reveals.find((r) => r.id === req.id).status, 'expired');
  assert.deepEqual(d.secureLog.slice(0, 2).map((e) => e.action), ['clear', 'expire']);
  assert.equal(rules.vaultSet(d, as('own'), 'c1', 'ssn', '').reason, 'not_found', 'nothing left to remove');
});

/* ---------- asking ---------- */

test('vaultRequest needs the role, a written reason and a number on file', () => {
  const { d, as } = world();
  assert.equal(rules.vaultRequest(d, as('stf'), 'c1', 'Preparing the return').reason, 'not_allowed');
  assert.equal(rules.vaultRequest(d, as('ro'), 'c1', 'Preparing the return').reason, 'not_allowed');
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c1', '   ').reason, 'invalid');
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c1', 'ok').reason, 'invalid', 'two letters are not a reason');
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c3', 'Preparing the return').reason, 'not_found', 'no number on file');
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c2', 'Preparing the return').reason, 'not_found', 'client of another office');
  const res = rules.vaultRequest(d, as('mgr'), 'c1', '  Preparing the return  ');
  assert.equal(res.ok, true);
  assert.equal(res.data.status, 'pending'); assert.equal(res.data.requestedBy, 'mgr'); assert.equal(res.data.reason, 'Preparing the return');
  assert.equal(d.secureLog[0].action, 'request'); assert.equal(d.secureLog[0].reason, 'Preparing the return'); assert.equal(d.secureLog[0].requestId, res.data.id);
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c1', 'Asking again').reason, 'conflict', 'one open request per person and client');
});

/* ---------- deciding: the two-person rule ---------- */

test('two-person rule: the person who asked can never approve their own request', () => {
  const { d, as } = world({ vault: { approval: 'second_person', revealSeconds: 60 } });
  const req = rules.vaultRequest(d, as('own'), 'c1', 'Letter from the agency').data;
  assert.equal(rules.vaultDecide(d, as('own'), req.id, true).reason, 'needs_other_person', 'not even the owner');
  assert.equal(d.reveals[0].status, 'pending');
  assert.equal(rules.vaultDecide(d, as('stf'), req.id, true).reason, 'not_allowed', 'an associate cannot approve');
  assert.equal(rules.vaultDecide(d, as('ro'), req.id, false).reason, 'not_allowed');
  const res = rules.vaultDecide(d, as('mgr'), req.id, true);
  assert.equal(res.ok, true);
  assert.equal(res.data.status, 'approved'); assert.equal(res.data.approverId, 'mgr');
  const left = (new Date(res.data.expiresAt) - Date.now()) / 60000;
  assert.ok(left > m.APPROVAL_MINUTES - 1 && left <= m.APPROVAL_MINUTES, 'the approval is good for a short, fixed time');
  assert.equal(d.secureLog[0].action, 'approve'); assert.equal(d.secureLog[0].userId, 'mgr');
  assert.equal(rules.vaultDecide(d, as('mgr2'), req.id, false).reason, 'expired', 'a decided request cannot be decided again');
});

test('a denial is final, and the requester may withdraw their own request', () => {
  const { d, as } = world();
  const a = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  assert.equal(rules.vaultDecide(d, as('own'), a.id, false).data.status, 'denied');
  assert.equal(d.secureLog[0].action, 'deny');
  assert.equal(rules.vaultReveal(d, as('mgr'), a.id).reason, 'expired', 'a denied request shows nothing');
  const b = rules.vaultRequest(d, as('mgr'), 'c1', 'Asking once more').data;
  assert.equal(rules.vaultDecide(d, as('mgr'), b.id, false).data.status, 'denied', 'withdrawn by the person who asked');
});

test('an approver cannot decide for a client of an office they do not see', () => {
  const { d, as } = world();
  const req = rules.vaultRequest(d, as('own'), 'c2', 'State filing for the quarter').data;
  assert.equal(rules.vaultDecide(d, as('mgr'), req.id, true).reason, 'not_found');
  assert.equal(d.reveals[0].status, 'pending');
});

test('single-person rule: the requester approves their own request only when their role may reveal', () => {
  const { d, as } = world({ vault: { approval: 'step_up', revealSeconds: 30 } });
  const req = rules.vaultRequest(d, as('own'), 'c1', 'Letter from the agency').data;
  assert.equal(req.status, 'pending', 'still a request first: the identity check comes before the approval');
  const res = rules.vaultDecide(d, as('own'), req.id, true);
  assert.equal(res.ok, true); assert.equal(res.data.approverId, 'own');
  // somebody else can still approve under this rule
  const other = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  assert.equal(rules.vaultDecide(d, as('own'), other.id, true).ok, true);
  // a role that lost the capability in the company's own matrix cannot approve itself
  setRolePermissions(d, as('own'), 'manager', permissionsOf(d, pack, 'manager').filter((p) => p !== 'secureReveal'));
  assert.equal(rules.vaultRequest(d, as('mgr2'), 'c1', 'Preparing the return').reason, 'not_allowed');
});

/* ---------- opening: once, in time, by the requester ---------- */

test('vaultReveal: only the requester, only once, never a value in a sample workspace', () => {
  const { d, as } = world({ vault: { approval: 'second_person', revealSeconds: 45 } });
  const req = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  assert.equal(rules.vaultReveal(d, as('mgr'), req.id).reason, 'expired', 'not approved yet');
  rules.vaultDecide(d, as('own'), req.id, true);
  assert.equal(rules.vaultReveal(d, as('own'), req.id).reason, 'not_allowed', 'the approver cannot open it');
  assert.equal(rules.vaultReveal(d, as('mgr2'), req.id).reason, 'not_allowed', 'nor can anyone else');
  const res = rules.vaultReveal(d, as('mgr'), req.id);
  assert.equal(res.ok, true);
  assert.equal(res.data.value, null, 'a sample workspace has no number to show');
  assert.equal(res.data.last4, '6789');
  const shown = (new Date(res.data.hideAt) - Date.now()) / 1000;
  assert.ok(shown > 40 && shown <= 45, 'hidden again after the company\'s number of seconds');
  assert.equal(d.reveals[0].status, 'used');
  assert.equal(d.secureLog[0].action, 'reveal'); assert.equal(d.secureLog[0].reason, 'Preparing the return'); assert.equal(d.secureLog[0].userId, 'mgr');
  assert.equal(rules.vaultReveal(d, as('mgr'), req.id).reason, 'expired', 'a second viewing is refused');
  assert.equal(d.secureLog.filter((e) => e.action === 'reveal').length, 1);
});

test('an approval that was not used in time runs out and says so in the log', () => {
  const { d, as } = world();
  const req = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  rules.vaultDecide(d, as('own'), req.id, true);
  d.reveals[0].expiresAt = minutes(-1);
  assert.equal(revealState(d.reveals[0]), 'expired');
  assert.equal(rules.vaultReveal(d, as('mgr'), req.id).reason, 'expired');
  assert.equal(d.reveals[0].status, 'expired');
  const last = d.secureLog[0];
  assert.equal(last.action, 'expire'); assert.equal(last.userId, 'system'); assert.equal(last.requestId, req.id);
  assert.equal(d.secureLog.filter((e) => e.action === 'reveal').length, 0);
  // a new request can be filed afterwards
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return, again').ok, true);
});

test('a request nobody answered lapses after a day', () => {
  const { d, as } = world();
  const req = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  d.reveals[0].at = minutes(-(m.REQUEST_HOURS * 60 + 1));
  assert.equal(rules.vaultDecide(d, as('own'), req.id, true).reason, 'expired');
  assert.equal(d.reveals[0].status, 'expired');
});

test('the copy is only for the person who just opened it, and it is logged', () => {
  const { d, as } = world();
  const req = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  rules.vaultDecide(d, as('own'), req.id, true);
  assert.equal(rules.vaultCopied(d, as('mgr'), req.id).reason, 'not_allowed', 'nothing was opened yet');
  rules.vaultReveal(d, as('mgr'), req.id);
  assert.equal(rules.vaultCopied(d, as('own'), req.id).reason, 'not_allowed');
  assert.equal(rules.vaultCopied(d, as('mgr'), req.id).ok, true);
  assert.equal(d.secureLog[0].action, 'export');
});

test('someone who was switched off holds nothing, whatever their role was', () => {
  const { d, as } = world();
  const req = rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').data;
  rules.vaultDecide(d, as('own'), req.id, true);
  assert.equal(rules.memberDisable(d, as('own'), 'mgr').ok, true);
  assert.equal(d.reveals[0].status, 'expired', 'their approved request is closed with them');
  assert.equal(rules.vaultReveal(d, as('mgr'), req.id).reason, 'not_allowed');
  assert.equal(rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return').reason, 'not_allowed');
});

test('waitingFor lists what a person can decide, never their own requests', () => {
  const { d, as } = world();
  rules.vaultRequest(d, as('mgr'), 'c1', 'Preparing the return');
  d.accessRequests.push({ id: 'ar1', userId: 'stf', clientId: 'c2', reason: 'Covering', at: minutes(-5), status: 'pending' });
  const perms = (id) => permissionsOf(d, pack, d.users.find((u) => u.id === id).role);
  assert.equal(waitingFor(d, 'own', perms('own')).reveals.length, 1);
  assert.equal(waitingFor(d, 'own', perms('own')).access.length, 1);
  assert.equal(waitingFor(d, 'mgr', perms('mgr')).reveals.length, 0, 'not the requester');
  assert.equal(waitingFor(d, 'mgr2', perms('mgr2')).reveals.length, 1);
  assert.equal(waitingFor(d, 'mgr2', perms('mgr2')).access.length, 0, 'a senior associate does not decide office access');
  assert.equal(waitingFor(d, 'stf', perms('stf')).reveals.length, 0);
});

/* ---------- people ---------- */

test('memberInvite: needs the capability, a real address and a free one; only an owner invites an owner', () => {
  const { d, as } = world();
  assert.equal(rules.memberInvite(d, as('mgr'), { name: 'New Person', email: 'new@example.com', role: 'staff' }).reason, 'not_allowed');
  assert.equal(rules.memberInvite(d, as('own'), { name: '', email: 'new@example.com', role: 'staff' }).reason, 'invalid');
  assert.equal(rules.memberInvite(d, as('own'), { name: 'New Person', email: 'not an address', role: 'staff' }).reason, 'invalid');
  assert.equal(rules.memberInvite(d, as('own'), { name: 'New Person', email: 'MGR@example.com', role: 'staff' }).reason, 'conflict');
  const res = rules.memberInvite(d, as('own'), { name: ' New Person ', email: 'New@Example.com', role: 'staff', officeIds: ['o2', 'nope'] });
  assert.equal(res.ok, true);
  assert.equal(res.data.name, 'New Person'); assert.equal(res.data.email, 'new@example.com'); assert.deepEqual(res.data.officeIds, ['o2']);
  assert.equal(res.data.active, false, 'not active until the invitation is accepted');
  assert.equal(memberState(res.data), 'invited');
  assert.equal(memberState({ ...res.data, invitedAt: minutes(-73 * 60) }), 'invite_expired');
  assert.equal(d.audit[0].action, 'invite.created');
  // a company that lets managers manage people still keeps owner invitations for owners
  setRolePermissions(d, as('own'), 'manager', [...permissionsOf(d, pack, 'manager'), 'users']);
  assert.equal(rules.memberInvite(d, as('mgr'), { name: 'Second Owner', email: 'owner2@example.com', role: 'owner' }).reason, 'not_allowed');
  assert.equal(rules.memberInvite(d, as('mgr'), { name: 'Helper', email: 'helper@example.com', role: 'readonly' }).ok, true);
});

test('invitations: resend restarts the clock, revoke removes the person; members are not touched by either', () => {
  const { d, as } = world();
  const u = rules.memberInvite(d, as('own'), { name: 'New Person', email: 'new@example.com', role: 'staff' }).data;
  d.users.find((x) => x.id === u.id).invitedAt = minutes(-80 * 60);
  assert.equal(memberState(d.users.find((x) => x.id === u.id)), 'invite_expired');
  assert.equal(rules.inviteResend(d, as('own'), u.id).ok, true);
  assert.equal(memberState(d.users.find((x) => x.id === u.id)), 'invited');
  assert.equal(rules.inviteResend(d, as('own'), 'stf').reason, 'invalid');
  assert.equal(rules.inviteRevoke(d, as('own'), 'stf').reason, 'invalid');
  assert.equal(rules.inviteRevoke(d, as('stf'), u.id).reason, 'not_allowed');
  assert.equal(rules.inviteRevoke(d, as('own'), u.id).ok, true);
  assert.equal(d.users.some((x) => x.id === u.id), false);
});

test('roles: the last owner cannot be demoted or switched off', () => {
  const { d, as } = world();
  assert.equal(rules.memberSetRole(d, as('own'), 'own', 'manager').reason, 'locked');
  assert.equal(rules.memberDisable(d, as('own'), 'own').reason, 'locked', 'nobody switches themselves off');
  assert.equal(rules.memberSetRole(d, as('own'), 'stf', 'manager').data.role, 'manager');
  assert.equal(d.audit[0].action, 'member.role_changed'); assert.equal(d.audit[0].summary, 'staff > manager');
  assert.equal(rules.memberSetRole(d, as('own'), 'mgr', 'owner').data.role, 'owner');
  // with two owners the first one can step down
  assert.equal(rules.memberSetRole(d, as('own'), 'own', 'manager').ok, true);
  assert.equal(rules.memberSetRole(d, as('mgr'), 'mgr', 'staff').reason, 'locked', 'and now the other one is the last');
  assert.equal(rules.memberSetRole(d, as('ro'), 'stf', 'owner').reason, 'not_allowed');
  assert.equal(rules.memberSetRole(d, as('mgr'), 'ghost', 'staff').reason, 'not_found');
});

test('disable keeps the person and their history; enable brings them back', () => {
  const { d, as } = world();
  d.users.find((u) => u.id === 'stf').inLeadPool = true;
  const res = rules.memberDisable(d, as('own'), 'stf');
  assert.equal(res.ok, true);
  const u = d.users.find((x) => x.id === 'stf');
  assert.equal(u.active, false); assert.ok(!u.inLeadPool, 'no new leads for someone who cannot sign in');
  assert.equal(memberState(u), 'disabled');
  assert.equal(d.users.length, 5, 'still on the list');
  assert.equal(rules.memberDisable(d, as('mgr'), 'ro').reason, 'not_allowed');
  assert.equal(rules.memberEnable(d, as('own'), 'stf').data.active, true);
  assert.equal(rules.memberEnable(d, as('own'), 'stf').reason, 'invalid');
});

/* ---------- access to a client of another office ---------- */

test('grantDecide creates the grant, with an end date when one is given', () => {
  const { d, as } = world();
  d.accessRequests.push({ id: 'ar1', userId: 'stf', clientId: 'c2', reason: 'Covering', at: minutes(-5), status: 'pending' }, { id: 'ar2', userId: 'mgr', clientId: 'c2', reason: '', at: minutes(-4), status: 'pending' });
  assert.equal(rules.grantDecide(d, as('mgr2'), 'ar1', true).reason, 'not_allowed', 'needs the capability to see every client');
  assert.equal(rules.grantDecide(d, as('own'), 'ar1', true, '2020-01-01').reason, 'invalid', 'an end date in the past');
  const res = rules.grantDecide(d, as('own'), 'ar1', true, '2099-12-31');
  assert.equal(res.data.status, 'approved'); assert.equal(res.data.decidedBy, 'own');
  assert.deepEqual(d.grants.map((g) => [g.userId, g.clientId, g.expires, g.grantedBy]), [['stf', 'c2', '2099-12-31', 'own']]);
  assert.equal(rules.grantDecide(d, as('own'), 'ar1', false).reason, 'expired');
  assert.equal(rules.grantDecide(d, as('own'), 'ar2', false).data.status, 'denied');
  assert.equal(d.grants.length, 1, 'a denial grants nothing');
  // with the grant the associate can now be handed that client's number, and loses it when the grant is taken back
  assert.equal(rules.grantRevoke(d, as('mgr'), d.grants[0].id).reason, 'not_allowed');
  assert.equal(rules.grantRevoke(d, as('own'), d.grants[0].id).ok, true);
  assert.equal(d.grants.length, 0);
});

/* ---------- exports ---------- */

test('exports hold only what the person may see, never a tax ID, and are written to the trail', () => {
  const { d, as } = world();
  assert.equal(rules.exportRequest(d, as('stf'), 'clients').reason, 'not_allowed');
  assert.equal(rules.exportRequest(d, as('mgr'), 'audit').reason, 'not_allowed', 'the audit trail needs its own capability');
  const res = rules.exportRequest(d, as('mgr'), 'clients');
  assert.equal(res.ok, true);
  assert.match(res.data.fileName, /^clients-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(res.data.content.includes('Client c1') && res.data.content.includes('Client c3'));
  assert.ok(!res.data.content.includes('Client c2'), 'a client of another office is left out');
  assert.ok(!/6789|0001|ssn|ein/i.test(res.data.content), 'no tax ID marker of any kind');
  assert.equal(d.audit[0].action, 'export.clients'); assert.equal(d.audit[0].by, 'mgr');
  assert.ok(rules.exportRequest(d, as('own'), 'clients').data.content.includes('Client c2'));
  // a cell that a spreadsheet would run as a formula is defused
  d.clients[0].name = '=HYPERLINK("http://example.com")';
  assert.ok(rules.exportRequest(d, as('own'), 'clients').data.content.includes("\"'=HYPERLINK"));
});

/* ---------- company rules ---------- */

test('role matrix: only real capabilities, read only never writes, the edition default removes the override', () => {
  const { d, as } = world();
  const shipped = permissionsOf(d, pack, 'staff');
  setRolePermissions(d, as('own'), 'staff', [...shipped, 'secureReveal', 'made_up']);
  assert.ok(permissionsOf(d, pack, 'staff').includes('secureReveal'));
  assert.ok(!d.config.roles.staff.includes('made_up'));
  assert.equal(d.audit[0].action, 'config.roles'); assert.equal(d.audit[0].summary, '+secureReveal');
  setRolePermissions(d, as('own'), 'readonly', [...permissionsOf(d, pack, 'readonly'), 'write', 'delete', 'reports']);
  assert.deepEqual(permissionsOf(d, pack, 'readonly').filter((p) => p === 'write' || p === 'delete'), []);
  assert.ok(permissionsOf(d, pack, 'readonly').includes('reports'));
  assert.equal(setRolePermissions(d, as('own'), 'owner', []), null, 'the owner cannot be reduced');
  setRolePermissions(d, as('own'), 'staff', shipped);
  assert.equal(d.config.roles.staff, undefined, 'back to the edition: no override is kept');
});

test('sign-in and vault rules stay inside their limits; required roles cannot be removed', () => {
  const { d, as } = world();
  setSecurityRules(d, as('own'), { idleMinutes: 1, mfaRoles: ['manager'] }, ['owner']);
  assert.deepEqual(securityRules(d), { idleMinutes: 5, mfaRoles: ['owner', 'manager'] });
  setSecurityRules(d, as('own'), { idleMinutes: 100000, mfaRoles: [] }, ['owner', 'manager', 'staff', 'readonly']);
  assert.deepEqual(securityRules(d), { idleMinutes: 720, mfaRoles: ['owner', 'manager', 'staff', 'readonly'] });
  setVaultRules(d, as('own'), { approval: 'step_up', revealSeconds: 2 });
  assert.deepEqual(vaultRules(d), { approval: 'step_up', revealSeconds: 15 });
});

test('offices: one main office, and an office with clients cannot be removed', () => {
  const { d, as } = world();
  const o = saveOffice(d, as('own'), { name: ' East ', address: '1 Sample Way', main: true });
  assert.equal(o.name, 'East');
  assert.deepEqual(d.offices.filter((x) => x.main).map((x) => x.id), [o.id]);
  assert.equal(removeOffice(d, as('own'), 'o1'), false, 'clients belong to it');
  assert.equal(removeOffice(d, as('own'), o.id), true);
  assert.equal(d.offices.filter((x) => x.main).length, 1, 'another office becomes the main one');
  assert.equal(saveOffice(d, as('own'), { name: '  ', address: '' }), null);
});

/* ---------- the sample gateway itself, over the sample firm ---------- */

await m.boot(true);
const data = () => m.getSnapshot().data;
const viewAs = (role) => m.setPrefs({ viewAs: role });
const P = m.sampleProtected;

test('sample firm: the seed has a waiting request, a used one, a waiting access request and only markers', () => {
  const d = data();
  assert.equal(d.pack, 'practice');
  assert.ok(d.reveals.some((r) => r.status === 'pending') && d.reveals.some((r) => r.status === 'used'));
  assert.ok(d.accessRequests.some((r) => r.status === 'pending'));
  assert.ok(d.grants.length >= 1 && d.secureLog.length >= 5 && d.audit.length >= 5);
  for (const c of d.clients) { assert.ok(c.taxIdLast4 === undefined || /^\d{4}$/.test(c.taxIdLast4)); assert.ok(!('taxId' in c) && !('ssn' in c)); }
  assert.ok(!/\d{3}-\d{2}-\d{4}|\d{2}-\d{7}/.test(JSON.stringify({ c: d.clients, r: d.reveals, s: d.secureLog, a: d.audit })), 'no full number anywhere');
  const away = d.users.filter((u) => u.away);
  assert.equal(away.length, 1); assert.ok(away[0].away.from > new Date().toISOString().slice(0, 10), 'away next week, not today');
  assert.ok(d.users.filter((u) => u.active !== false).length >= 5 && d.offices.length === 2);
});

test('sample gateway: every answer is marked as a sample, and read only is refused everywhere', async () => {
  viewAs('readonly');
  const pending = data().reveals.find((r) => r.status === 'pending');
  for (const res of [await P.vaultSet('pc1', 'ssn', SSN), await P.vaultRequest('pc1', 'Preparing the return'), await P.vaultDecide(pending.id, true), await P.vaultReveal(pending.id),
    await P.memberInvite({ name: 'New Person', email: 'new@example.com', role: 'staff' }), await P.memberSetRole('u3', 'manager'), await P.memberDisable('u3'), await P.grantDecide('ar2', true), await P.exportRequest('clients')]) {
    assert.deepEqual(res, { ok: false, reason: 'not_allowed', sample: true });
  }
  viewAs('staff');
  assert.equal((await P.vaultRequest('pc1', 'Preparing the return')).reason, 'not_allowed', 'an associate cannot ask under the shipped matrix');
  assert.equal((await P.memberInvite({ name: 'New Person', email: 'new@example.com', role: 'staff' })).reason, 'not_allowed');
});

test('sample gateway: the whole two-person flow, and the value is never there', async () => {
  viewAs('manager');
  const mine = data().reveals.find((r) => r.status === 'pending' && r.requestedBy === 'u2');
  assert.deepEqual(await P.vaultDecide(mine.id, true), { ok: false, reason: 'needs_other_person', sample: true });
  viewAs('owner');
  const ok = await P.vaultDecide(mine.id, true);
  assert.equal(ok.ok, true); assert.equal(ok.sample, true); assert.equal(ok.data.approverId, 'u1');
  assert.equal((await P.vaultReveal(mine.id)).reason, 'not_allowed', 'the owner approved it, the owner cannot open it');
  viewAs('manager');
  const shown = await P.vaultReveal(mine.id);
  assert.equal(shown.ok, true); assert.equal(shown.sample, true);
  assert.equal(shown.data.value, null);
  assert.match(shown.data.last4, /^\d{4}$/);
  assert.equal((await P.vaultReveal(mine.id)).reason, 'expired');
  const log = data().secureLog.filter((e) => e.requestId === mine.id).map((e) => e.action);
  assert.deepEqual(log, ['reveal', 'approve', 'request']);
});

test('sample gateway: storing a number keeps the last four only, in the saved copy too', async () => {
  viewAs('owner');
  const res = await P.vaultSet('pc10', 'ein', EIN);
  assert.deepEqual(res, { ok: true, data: { taxIdType: 'ein', taxIdLast4: '6789' }, sample: true });
  const saved = [...mem.values()].join('\n');
  assert.ok(!saved.includes(EIN) && !saved.includes(EIN.replace('-', '')), 'the browser storage of the sample never holds the number');
  assert.ok(saved.includes('"taxIdLast4":"6789"'));
});

test('sample gateway: people, access with an end date, export', async () => {
  viewAs('owner');
  const inv = await P.memberInvite({ name: 'Quinn Tester', email: 'quinn@example.com', role: 'staff', officeIds: ['o1'] });
  assert.equal(inv.ok, true); assert.equal(inv.data.active, false);
  assert.equal((await P.memberSetRole('u1', 'manager')).reason, 'locked');
  assert.equal((await P.memberDisable('u5')).data.active, false);
  const g = await P.grantDecide('ar2', true, '2099-01-31');
  assert.equal(g.data.status, 'approved');
  assert.equal(data().grants.find((x) => x.userId === 'u3' && x.clientId === 'pc9').expires, '2099-01-31');
  const file = await P.exportRequest('clients');
  assert.equal(file.ok, true); assert.equal(file.sample, true);
  assert.ok(file.data.content.split('\r\n').length === data().clients.length + 1);
  assert.equal(data().audit[0].action, 'export.clients');
  viewAs('manager');
  const scoped = await P.exportRequest('clients');
  assert.ok(scoped.data.content.split('\r\n').length < data().clients.length + 1, 'the senior associate exports the clients of their office only');
});
