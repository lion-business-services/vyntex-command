// The sample implementation of the protected operations (src/platform/gateway.ts). It runs in the sample workspaces only
// (/demo and /preview): every operation writes a sample record to the copy of the sample business kept in this browser,
// answers with `sample: true`, and never sends, charges, reveals or connects anything real. A tax ID in particular does not
// exist here: only its type and last four digits are in the sample, so a "reveal" has no value to show and says so.
// Each operation checks the viewer's capability first, the way the server does, so the screens behave the same in both modes.
import type { Appointment, AuditEntry, CashClose, Credit, DemoState, ISODate, OfficeRole } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { assignNextLead, handoffLead } from '@/domain/actions';
import { findClientMatches } from '@/domain/actions/clients';
import { findLeadMatches } from '@/domain/actions/leads';
import { canSeeClient } from '@/domain/access';
import { permissionsOf } from '@/domain/config';
import { rules, type Res } from '@/domain/actions/security';
import { applyCredit, cancelAppointment, cancelProblem, creditProblem, payAppointment, payProblem, voidCredit, voidProblem } from '@/domain/actions/appointments';
import { actorId, ctx, getSnapshot, mutate, viewerCan } from '@/store/store';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { sum } from '@/lib/money';
import {
  registerGateway, type AuthOperations, type ExportKind, type FileOperations, type IntegrationOperations, type Outcome, type ProtectedOperations, type WorkspaceGateway,
} from './gateway';

const ok = <T,>(data: T): Outcome<T> => ({ ok: true, data, sample: true });
const no = <T,>(reason: string): Outcome<T> => ({ ok: false, reason, sample: true });
const data = (): DemoState => getSnapshot().data;

/** Writes to the sample workspace as the viewer, when the viewer holds the capability. Returns false when they do not. */
function change(need: Permission, fn: (d: DemoState) => void): boolean {
  if (!viewerCan(need)) return false;
  mutate(fn, need);
  return true;
}
/**
 * Runs one rule of the protected operations (src/domain/actions/security.ts) against the sample workspace as the viewer and
 * saves what it changed. The rule itself decides who may do it; a refusal comes back as its short reason.
 */
function rule<T>(fn: (d: DemoState, c: ReturnType<typeof ctx>) => Res<T>, need: Permission = 'write'): Outcome<T> {
  if (!viewerCan(need)) return no('not_allowed');
  let out: Res<T> = { ok: false, reason: 'not_available' };
  mutate((d) => { out = fn(d, ctx()); }, need);
  const res = out as Res<T>;
  return res.ok ? ok(res.data) : no(res.reason);
}
/** One line of the sample audit trail. In a live workspace the database writes these and nobody can edit them. */
function audit(d: DemoState, action: string, entity?: string, entityId?: string, summary?: string) {
  const entry: AuditEntry = { id: uid('au'), at: nowIso(), by: actorId(), action, entity, entityId, summary };
  d.audit.unshift(entry);
  if (d.audit.length > 500) d.audit.length = 500;
}

export const sampleProtected: ProtectedOperations = {
  // The tax ID vault. The rules are in src/domain/actions/security.ts: who may store, ask, approve and open, the two-person
  // rule, the approval that runs out and the single viewing. They run here exactly as written there.
  async vaultSet(clientId, type, value) {
    // the number is read once to check its shape and take the last four digits, then dropped: nothing else is kept
    return rule((d, c) => rules.vaultSet(d, c, clientId, type, value));
  },
  async vaultRequest(clientId, reason) {
    return rule((d, c) => rules.vaultRequest(d, c, clientId, reason));
  },
  async vaultDecide(requestId, approve) {
    return rule((d, c) => rules.vaultDecide(d, c, requestId, approve));
  },
  async vaultReveal(requestId) {
    // there is no real value in a sample workspace, and none is made up: `value` is always null here
    return rule((d, c) => rules.vaultReveal(d, c, requestId));
  },

  async memberInvite(input) {
    // a sample person: no invitation email leaves the browser, and nobody can accept it
    return rule((d, c) => rules.memberInvite(d, c, input));
  },
  async memberSetRole(userId, role: OfficeRole) {
    return rule((d, c) => rules.memberSetRole(d, c, userId, role));
  },
  async memberDisable(userId) {
    return rule((d, c) => rules.memberDisable(d, c, userId));
  },
  // `expires` is the optional end date of the access being granted (the screens pass it; see the security module's report)
  async grantDecide(requestId, approve, expires?: ISODate) {
    return rule((d, c) => rules.grantDecide(d, c, requestId, approve, expires));
  },

  async apptMarkPaid(apptId, payment) {
    if (!viewerCan('money') || !viewerCan('write')) return no('not_allowed');
    // paid once, for the whole fee; a second click or a retry is refused before anything is written
    const why = payProblem(data(), apptId, payment); if (why) return no(why);
    change('money', (d) => { if (payAppointment(d, ctx(), apptId, payment).ok) audit(d, 'appointment.paid', 'appointment', apptId, payment.method); });
    return ok(data().appointments.find((x) => x.id === apptId) as Appointment);
  },
  async apptCancel(apptId, by, reason) {
    if (!viewerCan('appointments') || !viewerCan('write')) return no('not_allowed');
    const why = cancelProblem(data(), apptId, reason); if (why) return no(why);
    // the office cancelled something already paid, or the client cancelled and the company's rule keeps it for them: a credit
    const made: { credit?: Credit } = {};
    change('appointments', (d) => {
      const out = cancelAppointment(d, ctx(), apptId, by, reason);
      if (out.ok) { made.credit = out.credit; audit(d, 'appointment.cancel', 'appointment', apptId, out.credit ? `${by}, credit` : out.kept ? `${by}, ${out.kept}` : by); }
    });
    return ok({ appointment: data().appointments.find((x) => x.id === apptId) as Appointment, credit: made.credit && data().credits.find((c) => c.id === made.credit?.id) });
  },
  async creditApply(creditId, apptId) {
    if (!viewerCan('credits') || !viewerCan('write')) return no('not_allowed');
    // used once, by the client it belongs to, before it runs out, and only when it covers the fee
    const why = creditProblem(data(), creditId, apptId); if (why) return no(why);
    change('credits', (d) => { if (applyCredit(d, ctx(), creditId, apptId).ok) audit(d, 'credit.apply', 'appointment', apptId); });
    return ok({ credit: data().credits.find((x) => x.id === creditId) as Credit, appointment: data().appointments.find((x) => x.id === apptId) as Appointment });
  },
  async creditVoid(creditId, reason) {
    if (!viewerCan('credits') || !viewerCan('write')) return no('not_allowed');
    // the entry stays in the ledger with who voided it and why
    const why = voidProblem(data(), creditId, reason); if (why) return no(why);
    change('credits', (d) => { const out = voidCredit(d, ctx(), creditId, reason); if (out.ok) audit(d, 'credit.void', 'client', out.credit.clientId); });
    return ok(data().credits.find((x) => x.id === creditId) as Credit);
  },
  async cashClose(input) {
    // the same arithmetic the screen shows before the person confirms, in whole cents (src/domain/selectors.ts)
    const { cashExpected, cashLockedThrough, sameDrawer, cents, dollars } = await import('@/domain/selectors');
    // looking at the drawer is not enough: counting it changes records
    if (!viewerCan('cash') || !viewerCan('write')) return no('not_allowed');
    const counted = dollars(cents(input.counted));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > today() || !(counted >= 0) || !isFinite(counted)) return no('invalid');
    if (input.officeId && !data().offices.some((o) => o.id === input.officeId)) return no('invalid');
    // a day is counted once, and never a day before one that is already closed
    const through = cashLockedThrough(data(), input.officeId);
    if (through && input.date <= through) return no('locked');
    const expected = cashExpected(data(), input.date, input.officeId);
    const diff = dollars(cents(counted) - cents(expected));
    // a difference has to be explained before the day can be closed
    if (cents(diff) !== 0 && !input.note?.trim()) return no('invalid');
    const close: CashClose = { id: uid('cc'), date: input.date, officeId: input.officeId || undefined, expected, counted, diff, by: actorId(), at: nowIso(), note: input.note?.trim() || undefined };
    const done = change('cash', (d) => {
      d.cashCloses.unshift(close);
      // every entry of this drawer up to that day is locked from here on
      for (const e of d.cash) if (e.date <= input.date && !e.closeId && sameDrawer(e.officeId, input.officeId)) e.closeId = close.id;
      audit(d, 'cash.close', 'cash', close.id, close.date);
    });
    return done ? ok(close) : no('not_allowed');
  },
  async exportRequest(kind: ExportKind) {
    // a copy of what the viewer may already see, never a tax ID; taking it is written to the audit trail
    return rule((d, c) => rules.exportRequest(d, c, kind), 'export');
  },
  async leadAssignNext(leadId) {
    const lead = data().leads.find((l) => l.id === leadId);
    if (!lead) return no('not_found');
    // The same rule as the server (lead_assign_next for one lead): anyone who works leads and may change records can ask,
    // and a lead whose owner is still with the company keeps them without a turn being used, so asking twice skips nobody.
    if (!viewerCan('leads')) return no('not_allowed');
    if (lead.ownerId && data().users.some((u) => u.id === lead.ownerId && u.active !== false)) return ok({ userId: lead.ownerId });
    let userId: string | null = null;
    // the turn is the one every new lead takes (assignNextLead): the pool in order, then the fallback person, then an owner
    const done = change('write', (d) => {
      userId = assignNextLead(d, ctx());
      if (userId) handoffLead(d, ctx(), leadId, userId, undefined, d.config.routing?.pool?.includes(userId) ? 'round_robin' : 'rule');
    });
    return done ? ok({ userId }) : no('not_allowed');
  },
  async leadNextTurn() {
    // the turn every new lead takes in the sample (assignNextLead): the pool in order, then the fallback person, then an owner
    if (!viewerCan('leads')) return no('not_allowed');
    let userId: string | null = null;
    const done = change('write', (d) => { userId = assignNextLead(d, ctx()); });
    return done ? ok({ userId }) : no('not_allowed');
  },
  async clientFindDuplicate(input) {
    if (!viewerCan('clients')) return no('not_allowed');
    // the same search the client form runs in the browser, with the database's weights; a client of another office is
    // named and nothing more, the way the server answers
    const me = data().users.find((u) => u.id === actorId());
    const perms = permissionsOf(data(), ctx().pack, me?.role ?? 'readonly');
    return ok(findClientMatches(data(), input).map((m) => {
      const open = canSeeClient(data(), me, perms, m.client);
      return { clientId: m.client.id, name: m.client.name, company: open ? m.client.company || null : null, matched: m.by, score: m.score, restricted: !open };
    }));
  },
  async leadFindDuplicate(input) {
    if (!viewerCan('leads')) return no('not_allowed');
    return ok(findLeadMatches(data(), ctx().pack, input).map((m) => ({ leadId: m.lead.id, ticket: m.lead.ticket, name: m.lead.name, status: m.lead.status, matched: m.by })));
  },
};

const NOT_HERE = 'not_available';
/** There is nobody to sign in to a sample workspace: the viewer is whoever "View as" says. */
const sampleAuth: AuthOperations = {
  signIn: async () => ({ ok: false, step: 'error', reason: NOT_HERE }),
  mfaVerify: async () => ({ ok: false, step: 'error', reason: NOT_HERE }),
  mfaEnroll: async () => no(NOT_HERE),
  mfaConfirm: async () => no(NOT_HERE),
  mfaRecovery: async () => ({ ok: false, step: 'error', reason: NOT_HERE }),
  signOut: async () => undefined,
  signOutAll: async () => undefined,
  session: async () => null,
  inviteInfo: async () => no(NOT_HERE),
  inviteAccept: async () => ({ ok: false, step: 'error', reason: NOT_HERE }),
  passwordReset: async () => undefined,
  passwordUpdate: async () => no(NOT_HERE),
  stepUp: async () => no(NOT_HERE),
};
/** Files stay in the browser as small data addresses; nothing is uploaded. */
const sampleFiles: FileOperations = {
  upload: (file) => new Promise((resolve) => {
    if (file.size > 1_500_000) { resolve(no('too_large')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(ok({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', dataUrl: String(reader.result) }));
    reader.onerror = () => resolve(no('invalid'));
    reader.readAsDataURL(file);
  }),
  url: async (ref) => (ref.dataUrl ? ok(ref.dataUrl) : no('not_found')),
};
/** In a sample workspace nothing is ever connected: every provider answers "not connected" and connecting is refused. */
const sampleIntegrations: IntegrationOperations = {
  // One row per provider, none of them connected: a sample workspace has no account to connect to. `reason: 'sample'` tells
  // the Integrations screen to say so. A connection row a sample happens to carry is ignored, so nothing can read as connected.
  list: async () => {
    const ids = ['gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai'] as const;
    return ids.map((id) => { const row = { id, state: 'not_connected' as const, reason: 'sample' }; return row; });
  },
  connect: async () => no(NOT_HERE),
  disconnect: async () => no(NOT_HERE),
  sync: async () => no(NOT_HERE),
  test: async () => no(NOT_HERE),
};

export const sampleGateway: WorkspaceGateway = {
  mode: 'demo',
  sample: true,
  // the store builds the sample itself; these two exist so the contract is whole
  load: async () => { const { v: _v, seededOn: _s, seedLang: _l, touched: _t, ...rest } = data(); return rest; },
  apply: async (ops) => ({ ok: true, applied: ops.length, rejected: [] }),
  protected: sampleProtected,
  auth: sampleAuth,
  files: sampleFiles,
  integrations: sampleIntegrations,
  compliance: null,
};

registerGateway('sample', sampleGateway);
