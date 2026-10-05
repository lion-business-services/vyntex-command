// Clients, and the notes kept on a lead, a job or a client (one note panel serves all three).
// Also here: finding a client that is probably already on file, merging two records into one, and asking for access to a
// client of another office.
import type { AccessRequest, Client, ClientPerson, DemoState, Note, NoteKind, Ref } from '../types';
import { type Ctx, logActivity } from '../context';
import { emit as announce } from '../rules/engine';
import { firstStage, isOpen, stageByRole } from '../config';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';

export function saveClient(d: DemoState, ctx: Ctx, input: Partial<Client> & { name: string }, id?: string): Client {
  if (id) { const c = d.clients.find((x) => x.id === id)!; Object.assign(c, input); return c; }
  const c: Client = { id: uid('c'), phone: '', email: '', addresses: [], since: today(), notes: [], ...input };
  d.clients.unshift(c); logActivity(d, ctx.actor, 'client.created', { type: 'client', id: c.id });
  announce(d, ctx, 'client.created', { ref: { type: 'client', id: c.id }, client: c });
  return c;
}

const notesOf = (d: DemoState, ref: Ref): { notes: Note[] } | undefined =>
  (ref.type === 'lead' ? d.leads.find((x) => x.id === ref.id) : ref.type === 'job' ? d.jobs.find((x) => x.id === ref.id) : ref.type === 'client' ? d.clients.find((x) => x.id === ref.id) : undefined);

/** Notes that record talking to the person. A plain note is something the team wrote down for itself. */
export const isContactNote = (kind: NoteKind): boolean => kind !== 'note';

export function addNote(d: DemoState, ctx: Ctx, ref: Ref, kind: NoteKind, text: string, pin = false) {
  const owner = notesOf(d, ref);
  if (!owner || !text.trim()) return;
  const at = nowIso();
  owner.notes.unshift({ id: uid('n'), at, kind, text: text.trim(), pin, by: ctx.actor });
  logActivity(d, ctx.actor, 'note.added', ref, { text: text.trim().slice(0, 80) });
  // a call, a visit, a text or an email written on a lead is a contact: it resets how long the lead has been waiting
  if (ref.type === 'lead' && isContactNote(kind)) {
    const l = d.leads.find((x) => x.id === ref.id);
    if (l) {
      l.lastContact = at;
      // an office that keeps a full pipeline counts the first conversation as "contacted", the way its earlier system did;
      // the field editions keep moving the stage by hand, as they always have
      const contacted = stageByRole(d, ctx.pack, 'contacted');
      if (ctx.pack.family === 'practice' && contacted && isOpen(d, ctx.pack, l.status) && l.status === firstStage(d, ctx.pack).id && l.status !== contacted.id) {
        const from = l.status; l.status = contacted.id;
        logActivity(d, ctx.actor, 'lead.stage', { type: 'lead', id: l.id }, { stage: ctx.t('ls_' + l.status) });
        announce(d, ctx, 'lead.stage', { ref: { type: 'lead', id: l.id }, lead: l, extra: { from, to: l.status } });
      }
    }
  }
}
export function deleteNote(d: DemoState, _ctx: Ctx, ref: Ref, noteId: string) {
  const owner = notesOf(d, ref);
  if (owner) owner.notes = owner.notes.filter((n) => n.id !== noteId);
}

/* ---------- is this person already on file? ---------- */

// The same normal forms the database uses for its duplicate search (app.norm_email, app.norm_phone, app.norm_name),
// so the sample workspace and a live one agree on what "the same" means.
export const normEmail = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();
/** Digits only, without a leading US country code: "(609) 555-0101" and "+1 609 555 0101" compare equal. */
export function normPhone(s: string | undefined | null): string {
  const digits = (s ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
}
/** Lowercase, punctuation removed, single spaces. */
export const normName = (s: string | undefined | null): string => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

export type MatchReason = 'email' | 'contact_email' | 'phone' | 'name' | 'address' | 'external';
export interface ClientMatch {
  client: Client;
  /** Everything that matched, strongest first. */
  by: MatchReason[];
  /** Email 40, a contact's email 30, phone 30, name 20, plus 10 when an address matches too. Same weights as the database. */
  score: number;
}
export interface ClientProbe { name?: string; company?: string; email?: string; phone?: string; address?: string; externalIds?: Record<string, string> }

/** Lookup tables over the clients, built once when many people are checked in a row (an import). */
export interface ClientIndex { email: Map<string, Client[]>; contactEmail: Map<string, Client[]>; phone: Map<string, Client[]>; name: Map<string, Client[]>; external: Map<string, Client> }
export function clientIndex(clients: Client[]): ClientIndex {
  const ix: ClientIndex = { email: new Map(), contactEmail: new Map(), phone: new Map(), name: new Map(), external: new Map() };
  const put = (m: Map<string, Client[]>, k: string, c: Client) => { if (!k) return; const list = m.get(k); if (list) list.push(c); else m.set(k, [c]); };
  for (const c of clients) {
    put(ix.email, normEmail(c.email), c);
    const phone = normPhone(c.phone); if (phone.length >= 7) put(ix.phone, phone, c);
    put(ix.name, normName(c.name), c);
    for (const p of [...(c.owners ?? []), ...(c.contacts ?? [])]) put(ix.contactEmail, normEmail(p.email), c);
    for (const [system, id] of Object.entries(c.externalIds ?? {})) if (id) ix.external.set(system + ':' + id, c);
  }
  return ix;
}

/**
 * Clients that are probably the person being entered, best match first. Email, then phone, then the name; an address only
 * adds weight to a client already found (two different people at one address are two clients). An id from a connected
 * system (a card processor's customer id) is certain. The person decides what to do with a match: nothing is refused here.
 */
export function findClientMatches(d: Pick<DemoState, 'clients'>, probe: ClientProbe, opts: { excludeId?: string; index?: ClientIndex } = {}): ClientMatch[] {
  const ix = opts.index ?? clientIndex(d.clients);
  const found = new Map<string, ClientMatch>();
  const hit = (list: Client[] | undefined, by: MatchReason, points: number) => {
    for (const c of list ?? []) {
      if (c.id === opts.excludeId) continue;
      const m = found.get(c.id) ?? { client: c, by: [], score: 0 };
      if (!m.by.includes(by)) { m.by.push(by); m.score += points; }
      found.set(c.id, m);
    }
  };
  for (const [system, id] of Object.entries(probe.externalIds ?? {})) { const c = id ? ix.external.get(system + ':' + id) : undefined; if (c) hit([c], 'external', 100); }
  const email = normEmail(probe.email); const phone = normPhone(probe.phone); const name = normName(probe.name); const address = normName(probe.address);
  if (email) { hit(ix.email.get(email), 'email', 40); hit(ix.contactEmail.get(email), 'contact_email', 30); }
  if (phone.length >= 7) hit(ix.phone.get(phone), 'phone', 30);
  if (name) hit(ix.name.get(name), 'name', 20);
  if (address) for (const m of found.values()) if (m.client.addresses.some((a) => normName(a) === address)) { m.by.push('address'); m.score += 10; }
  return [...found.values()].sort((a, b) => b.score - a.score || a.client.name.localeCompare(b.client.name));
}
/**
 * Whether a match is strong enough to stop and ask. A shared name alone is not: two people can have the same one.
 * It takes the same email, the same phone, the same id in a connected system, or the same name at the same address.
 */
export const isLikelyDuplicate = (m: ClientMatch): boolean => m.by.some((b) => b === 'email' || b === 'contact_email' || b === 'phone' || b === 'external') || (m.by.includes('name') && m.by.includes('address'));

/* ---------- two records for one client: merge them ---------- */

export type MergeBlock = 'same' | 'not_found' | 'both_tax_ids' | 'protected_history' | 'credits';
/**
 * Why two records cannot be merged this way round, or null when they can.
 * The record that goes away must not carry anything only the server may write: a tax ID on file, the history of who saw
 * it, or credits. Those stay where they are, so the record that has them is the one to keep.
 */
export function mergeBlock(d: DemoState, keepId: string, dropId: string): MergeBlock | null {
  if (keepId === dropId) return 'same';
  const keep = d.clients.find((c) => c.id === keepId); const drop = d.clients.find((c) => c.id === dropId);
  if (!keep || !drop) return 'not_found';
  if (drop.taxIdType || drop.taxIdLast4) return keep.taxIdType || keep.taxIdLast4 ? 'both_tax_ids' : 'protected_history';
  if ((d.reveals ?? []).some((r) => r.clientId === dropId) || (d.secureLog ?? []).some((r) => r.clientId === dropId)) return 'protected_history';
  if ((d.credits ?? []).some((c) => c.clientId === dropId)) return 'credits';
  return null;
}
/** What would move from one record to the other, for the confirmation screen. */
export function mergeCounts(d: DemoState, dropId: string) {
  return {
    jobs: d.jobs.filter((j) => j.clientId === dropId).length,
    tasks: d.tasks.filter((t) => t.clientId === dropId).length,
    docs: d.docs.filter((x) => x.clientId === dropId).length,
    messages: d.messages.filter((m) => m.clientId === dropId || (m.ref.type === 'client' && m.ref.id === dropId)).length,
    appointments: (d.appointments ?? []).filter((a) => a.clientId === dropId).length,
    opportunities: (d.opportunities ?? []).filter((o) => o.clientId === dropId).length,
    notes: d.clients.find((c) => c.id === dropId)?.notes.length ?? 0,
  };
}
const samePerson = (a: ClientPerson, b: ClientPerson) => normName(a.name) === normName(b.name);
const union = <T,>(a: T[] | undefined, b: T[] | undefined, same: (x: T, y: T) => boolean): T[] | undefined => {
  const out = [...(a ?? [])];
  for (const x of b ?? []) if (!out.some((y) => same(x, y))) out.push(x);
  return out.length ? out : undefined;
};
/**
 * Makes one client out of two. Everything that belonged to `dropId` (engagements or jobs, tasks, documents, messages,
 * appointments, opportunities, review requests, deadlines, leads, notes, history) moves to `keepId`; details the kept
 * record lacks are filled in from the other; then the other record is removed and the merge is written to the history.
 * Returns the reason when the merge is refused, and changes nothing in that case.
 */
export function mergeClients(d: DemoState, ctx: Ctx, keepId: string, dropId: string): { ok: true; client: Client; moved: ReturnType<typeof mergeCounts> } | { ok: false; reason: MergeBlock } {
  const reason = mergeBlock(d, keepId, dropId);
  if (reason) return { ok: false, reason };
  const keep = d.clients.find((c) => c.id === keepId)!; const drop = d.clients.find((c) => c.id === dropId)!;
  const moved = mergeCounts(d, dropId);

  for (const j of d.jobs) if (j.clientId === dropId) j.clientId = keepId;
  for (const t of d.tasks) if (t.clientId === dropId) t.clientId = keepId;
  for (const x of d.docs) if (x.clientId === dropId) x.clientId = keepId;
  for (const l of d.leads) if (l.clientId === dropId) l.clientId = keepId;
  for (const m of d.messages) { if (m.clientId === dropId) m.clientId = keepId; if (m.ref.type === 'client' && m.ref.id === dropId) m.ref = { type: 'client', id: keepId }; }
  for (const a of d.appointments ?? []) if (a.clientId === dropId) a.clientId = keepId;
  for (const o of d.opportunities ?? []) if (o.clientId === dropId) o.clientId = keepId;
  for (const r of d.reviews ?? []) if (r.clientId === dropId) r.clientId = keepId;
  for (const c of d.complianceItems ?? []) if (c.clientId === dropId) c.clientId = keepId;
  // a request to see the removed record has nothing left to open
  d.accessRequests = (d.accessRequests ?? []).filter((r) => r.clientId !== dropId);
  const point = (r: Ref): Ref => (r.type === 'client' && r.id === dropId ? { type: 'client', id: keepId } : r);
  for (const a of d.activity) { a.ref = point(a.ref); if (a.also) a.also = a.also.map(point); }
  for (const run of d.automation.runs) if (run.ref) run.ref = point(run.ref);

  // the kept record wins wherever both say something; the other one fills the blanks
  const fill = <K extends keyof Client>(k: K) => { if ((keep[k] === undefined || keep[k] === '' || keep[k] === null) && drop[k] !== undefined && drop[k] !== '') keep[k] = drop[k]; };
  (['company', 'phone', 'email', 'kind', 'clientType', 'birthday', 'lang', 'whatsapp', 'officeId', 'assignedTo', 'referredBy', 'lifecycle', 'smsOptIn', 'whatsappOptIn'] as (keyof Client)[]).forEach(fill);
  // someone who asked not to be emailed keeps that wish, whichever record it was written on
  if (drop.emailOptOut) keep.emailOptOut = true;
  if (drop.since && drop.since < keep.since) keep.since = drop.since;
  keep.addresses = union(keep.addresses, drop.addresses, (a, b) => normName(a) === normName(b)) ?? [];
  keep.owners = union(keep.owners, drop.owners, samePerson);
  keep.contacts = union(keep.contacts, drop.contacts, samePerson);
  keep.tags = union(keep.tags, drop.tags, (a, b) => a.toLowerCase() === b.toLowerCase());
  if (drop.social) keep.social = { ...drop.social, ...keep.social };
  if (drop.externalIds) keep.externalIds = { ...drop.externalIds, ...keep.externalIds };
  keep.notes = [...keep.notes, ...drop.notes].sort((a, b) => b.at.localeCompare(a.at));

  d.clients = d.clients.filter((c) => c.id !== dropId);
  logActivity(d, ctx.actor, 'client.merged', { type: 'client', id: keepId }, { name: drop.company ? `${drop.name} (${drop.company})` : drop.name });
  return { ok: true, client: keep, moved };
}

/* ---------- a client of another office ---------- */

/**
 * Asks for access to a client the person cannot open. One waiting request per person and client: asking again while the
 * first is waiting returns the first. Who decides, and the grant that follows, are the server's (gateway `grantDecide`).
 */
export function requestClientAccess(d: DemoState, ctx: Ctx, clientId: string, reason: string): AccessRequest | null {
  if (!d.clients.some((c) => c.id === clientId)) return null;
  const waiting = (d.accessRequests ?? []).find((r) => r.userId === ctx.actor && r.clientId === clientId && r.status === 'pending');
  if (waiting) return waiting;
  const req: AccessRequest = { id: uid('ar'), userId: ctx.actor, clientId, reason: reason.trim(), at: nowIso(), status: 'pending' };
  (d.accessRequests ??= []).push(req);
  return req;
}
/** Takes back a request that nobody has decided yet. */
export function withdrawAccessRequest(d: DemoState, ctx: Ctx, requestId: string): boolean {
  const before = (d.accessRequests ?? []).length;
  d.accessRequests = (d.accessRequests ?? []).filter((r) => !(r.id === requestId && r.userId === ctx.actor && r.status === 'pending'));
  return d.accessRequests.length < before;
}
