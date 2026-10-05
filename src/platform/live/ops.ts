// The live implementations of everything that is not an ordinary change: the protected operations, files, connections
// and the 1099 functions. Each is one call to this site's server, which checks the session, the capability and, where
// the operation is sensitive, a fresh identity check, and then lets the database decide (docs/SERVER.md, section 7).
//
// Honest states: an operation whose database function is not installed yet answers `not_available` (the server says
// 501), and the screen says so. Nothing here pretends. A tax ID exists in this file only for the moment it is typed or
// revealed: it is never logged, stored, or put in an address.
import type { AccessRequest, Appointment, CashClose, Connection, ConnState, Credit, ProviderId, RevealRequest, TeamUser } from '@/domain/types';
import { vaultRules } from '@/domain/config';
import { applyServer, getSnapshot } from '@/store/store';
import type { ComplianceOperations, Export1099Row, ExportFile, FileOperations, IntegrationOperations, Outcome, ProtectedOperations, ServerPatch } from '../gateway';
import { session } from '../session';
import { get, post, reasonOf, type Answer, type CallOptions, type Fail } from './http';
import { newKey } from './carry';

const tenant = (): string => session()?.tenantId ?? '';
const ok = <T,>(data: T): Outcome<T> => ({ ok: true, data, sample: false });
const no = <T,>(a: Fail): Outcome<T> => ({ ok: false, reason: reasonOf(a), sample: false });
const refuse = <T,>(reason: string): Outcome<T> => ({ ok: false, reason, sample: false });
const isRow = (v: unknown): v is { id: string } => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string';

/** Asked by the workspace after a protected operation: bring the server's copy in, since the database changed rows itself. */
let refresh: () => void = () => undefined;
export function setRefresher(fn: () => void): void { refresh = fn; }

/** POST /api/ws/rpc/<name>. Argument names are the database function's (`p_...`); the server adds the company. */
export function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}, options?: CallOptions & { idem?: string }): Promise<Answer<{ result: T }>> {
  return post<{ result: T }>('/api/ws/rpc/' + name, { tenant: tenant(), args, ...(options?.idem ? { idem: options.idem } : {}) }, options);
}
/** Runs a protected function and puts the row it returns into the workspace. */
async function run<T>(name: string, args: Record<string, unknown>, into?: (result: T) => ServerPatch): Promise<Outcome<T>> {
  const a = await rpc<T>(name, args);
  if (!a.ok) return no(a);
  const result = a.data.result;
  if (into && result) { try { applyServer(into(result)); } catch { /* an answer in a shape this build does not know: the refresh below brings the rows */ } }
  refresh();
  return ok(result);
}
const one = (c: string, row: unknown): ServerPatch => (isRow(row) ? { [c]: [row] } as ServerPatch : {});

export const liveProtected: ProtectedOperations = {
  async vaultSet(clientId, type, value) {
    const a = await rpc<{ taxIdType?: string; taxIdLast4?: string }>('vault_set', { p_client: clientId, p_type: type, p_value: value });
    if (!a.ok) return no(a);
    // only the type and the last four digits ever come back or stay in memory
    const last4 = a.data.result?.taxIdLast4 ?? value.replace(/\D/g, '').slice(-4);
    const c = getSnapshot().data.clients.find((x) => x.id === clientId);
    if (c) applyServer({ clients: [{ ...c, taxIdType: type, taxIdLast4: last4 } as { id: string }] });
    refresh();
    return ok({ taxIdType: type, taxIdLast4: last4 });
  },
  vaultRequest: (clientId, reason) => run<RevealRequest>('vault_request', { p_client: clientId, p_reason: reason }, (r) => one('reveals', r)),
  vaultDecide: (requestId, approve) => run<RevealRequest>('vault_decide', { p_request: requestId, p_approve: approve }, (r) => one('reveals', r)),
  async vaultReveal(requestId) {
    const a = await rpc<{ value?: string; last4?: string; hideAt?: string } | string>('vault_reveal', { p_request: requestId });
    if (!a.ok) return no(a);
    const r = a.data.result;
    const value = typeof r === 'string' ? r : r?.value ?? null;
    const seconds = vaultRules(getSnapshot().data).revealSeconds;
    refresh();
    return ok({ value, hideAt: (typeof r === 'object' && r?.hideAt) || new Date(Date.now() + seconds * 1000).toISOString(), last4: typeof r === 'object' ? r?.last4 : undefined });
  },

  async memberInvite(input) {
    const email = input.email.trim();
    // the server makes the link and emails it to the invited address; the inviter never sees it
    const a = await rpc<never>('member_invite', { email, role: input.role, name: input.name.trim(), lang: getSnapshot().prefs.lang }, { idem: newKey() });
    if (!a.ok) return no(a);
    const inv = (a.data as unknown as { invitation?: { id: string; email: string; role: TeamUser['role']; expiresAt?: string } }).invitation;
    if (!inv) return refuse('offline');
    // Not a member yet: the person appears in the team once they accept. This is the invitation, shaped for the screen.
    return ok({ id: inv.id, name: input.name.trim(), email: inv.email, role: inv.role, title: input.title, officeIds: input.officeIds, active: false, invitedAt: new Date().toISOString() });
  },
  memberSetRole: (userId, role) => run<TeamUser>('member_set_role', { p_member: userId, p_role: role }, (r) => one('users', r)),
  memberDisable: (userId) => run<TeamUser>('member_disable', { p_member: userId }, (r) => one('users', r)),
  grantDecide: (requestId, approve) => run<AccessRequest>('grant_decide', { p_request: requestId, p_approve: approve }, (r) => one('accessRequests', r)),

  // the key makes a double click or a repeated request record the payment once
  apptMarkPaid: (apptId, payment) => run<Appointment>('appt_mark_paid', { p_appt: apptId, p_method: payment.method, p_ref: payment.ref, p_amount: payment.amount, p_idem: newKey() }, (r) => one('appointments', r)),
  apptCancel: (apptId, by, reason) => run<{ appointment: Appointment; credit?: Credit }>('appt_cancel', { p_appt: apptId, p_by: by, p_reason: reason },
    (r) => ({ ...one('appointments', r.appointment), ...one('credits', r.credit) })),
  creditApply: (creditId, apptId) => run<{ credit: Credit; appointment: Appointment; remainder?: Credit }>('credit_apply', { p_credit: creditId, p_appt: apptId },
    (r) => ({ ...one('appointments', r.appointment), credits: [r.credit, r.remainder].filter(isRow) } as ServerPatch)),
  creditVoid: (creditId, reason) => run<Credit>('credit_void', { p_credit: creditId, p_reason: reason }, (r) => one('credits', r)),
  cashClose: (input) => run<CashClose>('cash_close', { p_date: input.date, p_office: input.officeId ?? null, p_counted: input.counted, p_note: input.note ?? null }, (r) => one('cashCloses', r)),
  async exportRequest(kind) {
    const a = await rpc<ExportFile>('export_request', { p_kind: kind });
    if (!a.ok) return no(a);
    const f = a.data.result;
    return f && typeof f.content === 'string' ? ok(f) : refuse('not_available');
  },
  async leadAssignNext(leadId) {
    // the database takes the turn under a lock, sets the owner and records the handoff
    const a = await rpc<{ assigned: string | null }>('lead_assign_next', { p_lead: leadId });
    if (!a.ok) return no(a);
    refresh();
    return ok({ userId: a.data.result?.assigned ?? null });
  },
  async leadNextTurn() {
    // the same function without a lead: it takes the turn under the lock and returns the member
    const a = await rpc<string | null>('lead_assign_next', {});
    return a.ok ? ok({ userId: typeof a.data.result === 'string' ? a.data.result : null }) : no(a);
  },
  async clientFindDuplicate(input) {
    const a = await rpc<{ client_id: string; name: string; company: string | null; matched: string[]; score: number; restricted: boolean }[]>(
      'client_find_duplicate', { p_email: input.email || null, p_phone: input.phone || null, p_name: input.name || null, p_address: input.address || null });
    if (!a.ok) return no(a);
    return ok((a.data.result ?? []).map((r) => ({ clientId: r.client_id, name: r.name, company: r.company ?? null, matched: r.matched ?? [], score: Number(r.score) || 0, restricted: r.restricted === true })));
  },
  async leadFindDuplicate(input) {
    const a = await rpc<{ lead_id: string; ticket: string; name: string; status: string; matched: string[] }[]>('lead_find_duplicate', { p_email: input.email || null, p_phone: input.phone || null });
    if (!a.ok) return no(a);
    return ok((a.data.result ?? []).map((r) => ({ leadId: r.lead_id, ticket: r.ticket, name: r.name, status: r.status, matched: r.matched ?? [] })));
  },
};

/** Types the server stores (api/ws.js). Anything else is refused there; saying so here saves the upload. */
const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv'];
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const liveFiles: FileOperations = {
  async upload(file, where) {
    if (file.size > MAX_FILE_BYTES) return refuse('too_large');
    if (!FILE_TYPES.includes(file.type)) return refuse('invalid_type');
    const area = (where.folder ?? 'documents').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    const a = await post<{ file: { name: string; size: number; mime: string; path: string } }>('/api/ws/file/upload', undefined, {
      raw: file, timeoutMs: 120000,
      headers: { 'content-type': file.type, 'x-vx-tenant': tenant(), 'x-vx-area': /^[a-z][a-z0-9_-]{1,30}$/.test(area) ? area : 'documents', 'x-vx-filename': encodeURIComponent(file.name) },
    });
    // a stored file is a path in the company's private folder, never the file's content
    return a.ok ? ok({ name: a.data.file.name, size: a.data.file.size, mime: a.data.file.mime, path: a.data.file.path }) : no(a);
  },
  async url(ref) {
    if (!ref.path) return refuse('not_found');
    const a = await post<{ url: string }>('/api/ws/file/url', { tenant: tenant(), path: ref.path, name: ref.name });
    return a.ok ? ok(a.data.url) : no(a);
  },
};

type Card = { id: ProviderId; state: ConnState; account?: string | { label?: string }; scopes?: string[]; connectedAt?: string; lastSyncAt?: string; lastError?: string; by?: string; reason?: string; health?: string };
const connection = (c: Card): Connection => ({
  id: c.id, state: c.state, account: typeof c.account === 'string' ? c.account : c.account?.label, scopes: c.scopes,
  connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt, lastError: c.lastError ?? (c.state === 'connected' ? undefined : c.reason), by: c.by,
});
const provider = (id: ProviderId) => '/api/integrations/' + encodeURIComponent(id);

export const liveIntegrations: IntegrationOperations = {
  async list() {
    const a = await get<{ connections: Card[] }>('/api/integrations?tenant=' + encodeURIComponent(tenant()));
    const list = a.ok ? a.data.connections.map(connection) : [];
    // the states come from the server and only from the server: the workspace shows what it said
    if (a.ok) applyServer({ connections: list as unknown as { id: string }[] });
    return list;
  },
  async connect(id) {
    const a = await post<{ url?: string; connection?: Card }>(provider(id) + '/connect', { tenant: tenant(), returnTo: location.pathname + location.search });
    if (!a.ok) return no(a);
    if (a.data.connection) applyServer({ connections: [connection(a.data.connection)] as unknown as { id: string }[] });
    return ok({ redirect: a.data.url });
  },
  async disconnect(id) {
    const a = await post(provider(id) + '/disconnect', { tenant: tenant() });
    if (!a.ok) return no(a);
    const left: Connection = { id, state: 'setup' };
    applyServer({ connections: [left] as unknown as { id: string }[] });
    return ok(left);
  },
  async sync(id, what) {
    const a = await post(provider(id) + '/sync', { tenant: tenant(), ...(what ? { what } : {}) });
    if (!a.ok) return no(a);
    return ok(getSnapshot().data.connections.find((c) => c.id === id) ?? { id, state: 'connected' as ConnState });
  },
  async test(id) {
    const a = await post<{ working: boolean; health?: string; reason?: string }>(provider(id) + '/test', { tenant: tenant() });
    return a.ok ? ok({ healthy: a.data.working === true, detail: a.data.reason ?? a.data.health }) : no(a);
  },
};

const must = <T,>(a: Answer<{ result: T }>): T => { if (!a.ok) throw new Error(reasonOf(a)); return a.data.result; };
/** 1099 functions of the database (migrations 0005 and 0006). Each throws a short reason code when it is refused. */
export const liveCompliance: ComplianceOperations = {
  // Recording the consent has no function the browser can reach yet: it is honest to say so instead of writing a record
  // that the export would not accept.
  async grant1099Consent() { throw new Error('not_available'); },
  async revokeConsent(consentId, reason) { must(await rpc('revoke_consent', { p_consent: consentId, p_reason: reason })); refresh(); },
  async export1099(taxYear, includeTaxIds) {
    const rows = must(await rpc<Record<string, unknown>[]>('export_1099_data', { p_year: taxYear, p_include_tax_id: includeTaxIds })) ?? [];
    const s = (v: unknown) => (typeof v === 'string' ? v : ''); const n = (v: unknown) => Number(v) || 0;
    return rows.map((r): Export1099Row => ({
      workerId: s(r.worker_id), workerName: s(r.worker_name), email: s(r.email), phone: s(r.phone), w9OnFile: r.w9_on_file === true, w9Date: s(r.w9_date) || null,
      hasTaxId: r.has_tax_id === true, taxId: typeof r.tax_id === 'string' ? r.tax_id : null, paymentCount: n(r.payment_count), paidTotal: n(r.paid_total),
      paidByCard: n(r.paid_by_card), paidOtherMethods: n(r.paid_other_methods),
    }));
  },
  async setWorkerTaxId(workerId, taxId) { must(await rpc('set_worker_tax_id', { p_worker: workerId, p_tax_id: taxId })); refresh(); },
  async getWorkerTaxId(workerId) { return must(await rpc<string | null>('get_worker_tax_id', { p_worker: workerId })) ?? null; },
};

/* ---------- signature requests (added by the documents and e-signature module) ---------- */

/**
 * An operation a member starts that the server carries out itself (docs/SERVER.md, section 17). It is served with the
 * other protected operations; a deployment that still has it at its earlier address answers "unknown operation" there,
 * and the call is then made at that address. One function, so no screen has to know which of the two it was.
 */
export async function officeOp<T = unknown>(name: string, args: Record<string, unknown>): Promise<Answer<{ result: T }>> {
  const a = await rpc<T>(name, args);
  if (a.ok || !(a.status === 404 && a.code === 'unknown_operation')) return a;
  return post<{ result: T }>('/api/public/office/' + encodeURIComponent(name), { tenant: tenant(), args });
}
/** What the server said about sending or reminding, in words a screen can tell apart. Nothing here is assumed sent. */
export type EnvelopeAnswer<T> = { ok: true; data: T } | { ok: false; reason: string; blockers?: string[] };
function envelopeFail<T>(a: Fail): EnvelopeAnswer<T> {
  // delivery that is not set up, or refused by the provider, leaves the request a draft: the screen says exactly that
  if (a.code === 'delivery_not_configured' || a.code === 'delivery_failed' || a.code === 'busy') return { ok: false, reason: a.code };
  const blockers = Array.isArray(a.data.blockers) ? a.data.blockers.filter((x): x is string => typeof x === 'string' && /^[a-z_]{2,40}$/.test(x)) : undefined;
  return { ok: false, reason: reasonOf(a), ...(blockers?.length ? { blockers } : {}) };
}
/** Asks the server to send a saved draft: it checks it again, emails each signer whose turn it is, and only then records it as sent. */
export async function envelopeSend(envelopeId: string): Promise<EnvelopeAnswer<{ status: string; sentTo: number; expiresAt?: string }>> {
  const a = await officeOp<{ status: string; sentTo: number; expiresAt?: string }>('envelope_send', { p_envelope: envelopeId });
  if (!a.ok) return envelopeFail(a);
  refresh();
  return { ok: true, data: a.data.result };
}
/** Asks the server to remind everyone who has their link and has not answered. Each gets a new link. */
export async function envelopeRemind(envelopeId: string): Promise<EnvelopeAnswer<{ reminded: number; expired: boolean }>> {
  const a = await officeOp<{ reminded?: number; expired?: boolean }>('envelope_remind', { p_envelope: envelopeId });
  if (!a.ok) return envelopeFail(a);
  refresh();
  return { ok: true, data: { reminded: Number(a.data.result?.reminded) || 0, expired: a.data.result?.expired === true } };
}
