// Office operations: the petty cash drawer, the deadlines the firm keeps for itself and its clients, and the few settings
// the service-line screens (payroll, bookkeeping, licensing) and the home screen's client links keep.
//
// Petty cash rules: an entry is money in or money out of one drawer (one per office). A day is closed by counting the
// drawer (a protected operation, see gateway().protected.cashClose); from then on every entry up to that day is locked:
// it cannot be added, changed or removed. A close is approved by the owner or a manager who did not count it.
// Nothing here knows a tax date, a rate or an agency rule: a deadline is whatever the business typed or imported.
import type { CashClose, CashEntry, ComplianceItem, DemoState, FileRef, ISODate, L10n, Ref, Repeat } from '../types';
import { type Ctx, logActivity } from '../context';
import { cashLockedThrough, cents, dollars, sameDrawer } from '../selectors';
import { parseDate, toISODate, today } from '@/lib/dates';
import { money2 } from '@/lib/money';
import { uid } from '@/lib/id';

export type OpsRefusal = 'locked' | 'invalid' | 'not_found' | 'not_allowed' | 'needs_other_person';
export type OpsResult<T> = { ok: true; value: T } | { ok: false; reason: OpsRefusal };
const yes = <T,>(value: T): OpsResult<T> => ({ ok: true, value });
const no = <T,>(reason: OpsRefusal): OpsResult<T> => ({ ok: false, reason });
/** A day that exists on the calendar: 2026-02-31 is not one. */
const isDate = (v: unknown): v is ISODate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toISODate(parseDate(v)) === v;

/* =====================================================================================================================
   Petty cash
   ===================================================================================================================== */

/** Categories a new company starts with. The company edits the list; an id from this list is shown in the viewer's language. */
export const DEFAULT_CASH_CATEGORIES = ['client_payment', 'change_fund', 'bank_withdrawal', 'supplies', 'postage', 'filing_fees', 'meals', 'transport', 'bank_deposit', 'transfer', 'other'];
export interface CashSettings { categories?: string[] }
export const cashCategories = (d: Pick<DemoState, 'settings'>): string[] => {
  const own = (d.settings?.cash as CashSettings | undefined)?.categories;
  return own && own.length ? own : DEFAULT_CASH_CATEGORIES;
};
/** Replaces the company's list of categories. An empty list goes back to the starting one. Entries keep the category they were given. */
export function saveCashCategories(d: DemoState, list: string[]): void {
  const clean = [...new Set(list.map((c) => c.trim()).filter(Boolean))];
  d.settings = { ...d.settings, cash: { ...(d.settings.cash as CashSettings | undefined), categories: clean.length ? clean : undefined } };
}

export interface CashInput { date: ISODate; officeId?: string; dir: 'in' | 'out'; amount: number; category: string; memo: string; receipt?: FileRef }
const locked = (d: DemoState, date: ISODate, officeId?: string) => { const through = cashLockedThrough(d, officeId); return !!through && date <= through; };
/** An amount as the drawer holds it: positive, in whole cents. Zero when it is not a usable amount. */
const amountOf = (v: unknown): number => { const c = cents(Number(v)); return c > 0 && isFinite(c) ? dollars(c) : 0; };

export function addCashEntry(d: DemoState, ctx: Ctx, input: CashInput): OpsResult<CashEntry> {
  const amount = amountOf(input.amount);
  if (!amount || !isDate(input.date) || input.date > today() || !input.category.trim() || (input.dir !== 'in' && input.dir !== 'out')) return no('invalid');
  if (input.officeId && !d.offices.some((o) => o.id === input.officeId)) return no('invalid');
  if (locked(d, input.date, input.officeId)) return no('locked');
  const e: CashEntry = { id: uid('ce'), date: input.date, officeId: input.officeId || undefined, dir: input.dir, amount, category: input.category.trim(), memo: input.memo.trim(), by: ctx.actor, receipt: input.receipt };
  // the list is kept in the order the entries were recorded: that is the order of a day's lines in the ledger
  d.cash.push(e);
  logActivity(d, ctx.actor, 'cash.' + e.dir, { type: 'cash', id: e.id }, { amount: money2(e.amount), memo: e.memo || e.category });
  return yes(e);
}
export function updateCashEntry(d: DemoState, ctx: Ctx, id: string, patch: Partial<CashInput>): OpsResult<CashEntry> {
  const e = d.cash.find((x) => x.id === id);
  if (!e) return no('not_found');
  // neither where the entry is, nor where it would go, may be a day that was already counted
  if (e.closeId || locked(d, e.date, e.officeId)) return no('locked');
  const next = { ...e, ...patch, officeId: 'officeId' in patch ? patch.officeId || undefined : e.officeId };
  const amount = amountOf(next.amount);
  if (!amount || !isDate(next.date) || next.date > today() || !next.category.trim() || (next.dir !== 'in' && next.dir !== 'out')) return no('invalid');
  if (locked(d, next.date, next.officeId)) return no('locked');
  Object.assign(e, { date: next.date, officeId: next.officeId, dir: next.dir, amount, category: next.category.trim(), memo: (next.memo ?? '').trim(), receipt: next.receipt });
  logActivity(d, ctx.actor, 'cash.edited', { type: 'cash', id: e.id }, { amount: money2(e.amount), memo: e.memo || e.category });
  return yes(e);
}
export function deleteCashEntry(d: DemoState, ctx: Ctx, id: string): OpsResult<true> {
  const e = d.cash.find((x) => x.id === id);
  if (!e) return no('not_found');
  if (e.closeId || locked(d, e.date, e.officeId)) return no('locked');
  d.cash = d.cash.filter((x) => x.id !== id);
  logActivity(d, ctx.actor, 'cash.deleted', { type: 'cash', id }, { amount: money2(e.amount), memo: e.memo || e.category });
  return yes(true);
}
/** Moves cash from one office's drawer to another's: one entry out, one entry in, same day and amount. */
export function transferCash(d: DemoState, ctx: Ctx, input: { date: ISODate; from: string; to: string; amount: number; memo?: string }): OpsResult<[CashEntry, CashEntry]> {
  const from = d.offices.find((o) => o.id === input.from), to = d.offices.find((o) => o.id === input.to);
  if (!from || !to || from.id === to.id || !amountOf(input.amount)) return no('invalid');
  if (locked(d, input.date, from.id) || locked(d, input.date, to.id)) return no('locked');
  const memo = input.memo?.trim();
  const out = addCashEntry(d, ctx, { date: input.date, officeId: from.id, dir: 'out', amount: input.amount, category: 'transfer', memo: [`→ ${to.name}`, memo].filter(Boolean).join(' · ') });
  if (!out.ok) return out;
  const into = addCashEntry(d, ctx, { date: input.date, officeId: to.id, dir: 'in', amount: input.amount, category: 'transfer', memo: [`← ${from.name}`, memo].filter(Boolean).join(' · ') });
  if (!into.ok) { d.cash = d.cash.filter((x) => x.id !== out.value.id); return into; }
  return yes([out.value, into.value]);
}

/**
 * Whether a person may approve a close: the owner or a manager, and not whoever counted the drawer. A firm with a single
 * owner or manager has nobody else to ask, so that one person approves their own count.
 */
export function canApproveClose(d: Pick<DemoState, 'users'>, userId: string | undefined, close: CashClose): boolean {
  const senior = d.users.filter((u) => u.active !== false && (u.role === 'owner' || u.role === 'manager'));
  if (!userId || close.approvedBy || !senior.some((u) => u.id === userId)) return false;
  return close.by !== userId || senior.length === 1;
}
export function approveCashClose(d: DemoState, ctx: Ctx, closeId: string): OpsResult<CashClose> {
  const c = d.cashCloses.find((x) => x.id === closeId);
  if (!c) return no('not_found');
  if (c.approvedBy) return no('invalid');
  if (!canApproveClose(d, ctx.actor, c)) return no(c.by === ctx.actor ? 'needs_other_person' : 'not_allowed');
  c.approvedBy = ctx.actor;
  logActivity(d, ctx.actor, 'cash.approved', { type: 'cash', id: c.id }, { date: c.date });
  return yes(c);
}
/** True when some drawer still has a close waiting for approval. */
export const closesAwaitingApproval = (d: Pick<DemoState, 'cashCloses'>, officeId?: string | null): CashClose[] =>
  (d.cashCloses ?? []).filter((c) => !c.approvedBy && (officeId === null || officeId === undefined ? true : sameDrawer(c.officeId, officeId)));

/* =====================================================================================================================
   Deadlines
   ===================================================================================================================== */

export const DEADLINE_KINDS: ComplianceItem['kind'][] = ['filing', 'license', 'renewal', 'deadline', 'insurance', 'other'];
export const REPEATS: Repeat[] = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
/**
 * A deadline as this module keeps it: the shared record plus the proof that it was met and the day of the month a
 * repeating series started on (so the 31st stays the 31st after a short month). The database keeps both in `extra`.
 */
export type Deadline = ComplianceItem & { evidence?: FileRef; anchor?: number };
export interface DeadlineInput {
  title: string; kind: ComplianceItem['kind']; due: ISODate;
  clientId?: string; jobId?: string; repeat?: Repeat; /** TeamUser id. */ assignee?: string; authority?: string; note?: string; remind?: number[];
}

/** The next due date of a repeating item, by the calendar: a month later is the same day of the next month, or its last day. */
export function nextDue(due: ISODate, repeat: Repeat | undefined, anchor?: number): ISODate {
  const d = parseDate(due);
  const months = repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : repeat === 'yearly' ? 12 : 0;
  if (!months) return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (repeat === 'weekly' ? 7 : repeat === 'biweekly' ? 14 : 0)));
  const want = anchor ?? d.getDate();
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return toISODate(new Date(first.getFullYear(), first.getMonth(), Math.min(want, last)));
}
const cleanRemind = (list: number[] | undefined): number[] | undefined => {
  const out = [...new Set((list ?? []).map((n) => Math.round(Number(n))).filter((n) => n >= 0 && n <= 365))].sort((a, b) => b - a);
  return out.length ? out : undefined;
};
function fill(d: DemoState, input: DeadlineInput): Omit<Deadline, 'id' | 'status'> | null {
  const title = input.title.trim();
  if (!title || !isDate(input.due) || !DEADLINE_KINDS.includes(input.kind)) return null;
  if (input.clientId && !d.clients.some((c) => c.id === input.clientId)) return null;
  const job = input.jobId ? d.jobs.find((j) => j.id === input.jobId) : undefined;
  return {
    title, kind: input.kind, due: input.due, clientId: input.clientId || job?.clientId || undefined, jobId: job?.id,
    repeat: input.repeat && input.repeat !== 'once' && REPEATS.includes(input.repeat) ? input.repeat : undefined,
    assignee: input.assignee && d.users.some((u) => u.id === input.assignee) ? input.assignee : undefined,
    authority: input.authority?.trim() || undefined, note: input.note?.trim() || undefined, remind: cleanRemind(input.remind),
  };
}
const dlRefs = (i: ComplianceItem): Ref[] | undefined => (i.clientId ? [{ type: 'client', id: i.clientId }] : undefined);

/** Adds a deadline, or changes one when `id` is given. Returns null when the title, the date or the kind is not usable. */
export function saveDeadline(d: DemoState, ctx: Ctx, input: DeadlineInput, id?: string): Deadline | null {
  const next = fill(d, input); if (!next) return null;
  if (id) {
    const cur = d.complianceItems.find((x) => x.id === id) as Deadline | undefined; if (!cur) return null;
    // a new date starts the series from that day of the month
    const anchor = cur.due !== next.due ? undefined : cur.anchor;
    Object.assign(cur, next, { anchor });
    return cur;
  }
  const item: Deadline = { ...next, id: uid('dl'), status: 'open' };
  d.complianceItems.unshift(item);
  logActivity(d, ctx.actor, 'deadline.created', { type: 'compliance', id: item.id }, { title: item.title }, dlRefs(item));
  return item;
}
/**
 * Marks a deadline as met. A repeating one rolls forward: this occurrence stays in the history as done and the next one
 * is created open, with the same details. Returns the next occurrence, or null when the item does not repeat.
 */
export function completeDeadline(d: DemoState, ctx: Ctx, id: string, evidence?: FileRef): Deadline | null {
  const cur = d.complianceItems.find((x) => x.id === id) as Deadline | undefined;
  if (!cur || cur.status === 'done') return null;
  cur.status = 'done'; cur.doneAt = today(); if (evidence) cur.evidence = evidence;
  logActivity(d, ctx.actor, 'deadline.done', { type: 'compliance', id: cur.id }, { title: cur.title }, dlRefs(cur));
  if (!cur.repeat || cur.repeat === 'once') return null;
  const anchor = cur.anchor ?? parseDate(cur.due).getDate();
  const { evidence: _proof, doneAt: _done, ...rest } = cur;
  const next: Deadline = { ...rest, id: uid('dl'), status: 'open', due: nextDue(cur.due, cur.repeat, anchor), anchor, remind: cur.remind ? [...cur.remind] : undefined };
  d.complianceItems.unshift(next);
  return next;
}
/** Sets an item aside (it does not apply this time) or opens it again. Opening a completed item removes its completion. */
export function setDeadlineStatus(d: DemoState, ctx: Ctx, id: string, status: 'open' | 'waived'): Deadline | null {
  const cur = d.complianceItems.find((x) => x.id === id) as Deadline | undefined;
  if (!cur || cur.status === status) return null;
  cur.status = status; cur.doneAt = undefined;
  logActivity(d, ctx.actor, status === 'waived' ? 'deadline.waived' : 'deadline.reopened', { type: 'compliance', id: cur.id }, { title: cur.title }, dlRefs(cur));
  return cur;
}
export function attachDeadlineEvidence(d: DemoState, _ctx: Ctx, id: string, evidence: FileRef | undefined): void {
  const cur = d.complianceItems.find((x) => x.id === id) as Deadline | undefined;
  if (cur) cur.evidence = evidence;
}
export function deleteDeadline(d: DemoState, _ctx: Ctx, id: string): void { d.complianceItems = d.complianceItems.filter((x) => x.id !== id); }
/** Adds many deadlines at once (a file the business prepared). Rows that are not usable are skipped. Returns how many were added. */
export function importDeadlines(d: DemoState, ctx: Ctx, rows: DeadlineInput[]): number {
  let n = 0;
  for (const row of rows) {
    const next = fill(d, row); if (!next) continue;
    d.complianceItems.unshift({ ...next, id: uid('dl'), status: 'open' }); n++;
  }
  if (n) logActivity(d, ctx.actor, 'deadline.imported', { type: 'compliance', id: '' }, { n });
  return n;
}

/* =====================================================================================================================
   Small settings: the service-line screens and the client links on the home screen.
   These are company configuration: the screens change them with `mutate(fn, 'config')`, so only people who may
   configure the company can.
   ===================================================================================================================== */

/** What a service-line screen (payroll, bookkeeping, licensing) remembers for the company. */
export interface LineSettings {
  /** The catalog category (service line) whose engagements the screen shows. */
  category?: string;
  /** Address of the firm's own application for its staff. Typed by the company, never guessed. */
  staffUrl?: string;
}
export type LineId = 'payroll' | 'bookkeeping' | 'licensing';
export const lineSettings = (d: Pick<DemoState, 'settings'>, line: LineId): LineSettings => (d.settings?.[line] as LineSettings | undefined) ?? {};
export function saveLineSettings(d: DemoState, line: LineId, patch: LineSettings): void {
  const next = { ...lineSettings(d, line), ...patch };
  d.settings = { ...d.settings, [line]: { category: next.category || undefined, staffUrl: safeUrl(next.staffUrl) || undefined } };
}

/** A web address a person typed, when it is one a browser may open (http or https). Otherwise an empty string. */
export function safeUrl(v: string | undefined | null): string {
  const s = (v ?? '').trim(); if (!s) return '';
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.toString() : ''; } catch { return ''; }
}

export interface QuickLink { id: string; label: L10n; url: string; /** Shipped with this deployment: the company gives it an address but cannot remove it. */ fixed?: boolean }
/**
 * The links the team sends to clients often: the ones the deployment ships (bookkeeping and payroll for LBS) with the
 * company's own addresses on top, then any link the company added. A link without an address stays in the list, empty.
 */
export function quickLinksOf(d: Pick<DemoState, 'config'>, shipped: { id: string; label: L10n; url: string }[]): QuickLink[] {
  const own = d.config?.quickLinks ?? [];
  const fixed = shipped.map((s) => ({ id: s.id, label: s.label, url: safeUrl(own.find((o) => o.id === s.id)?.url) || safeUrl(s.url), fixed: true }));
  return [...fixed, ...own.filter((o) => !shipped.some((s) => s.id === o.id)).map((o) => ({ id: o.id, label: o.label, url: safeUrl(o.url) }))];
}
/** Sets the address of a link, or adds a link of the company's own. Returns false when the address is not a web address. */
export function saveQuickLink(d: DemoState, link: { id?: string; label?: string; url: string }): boolean {
  const url = safeUrl(link.url); if (link.url.trim() && !url) return false;
  const list = [...(d.config.quickLinks ?? [])];
  const at = link.id ? list.findIndex((l) => l.id === link.id) : -1;
  const label: L10n = link.label?.trim() ? { en: link.label.trim(), es: link.label.trim() } : at >= 0 ? list[at].label : { en: '', es: '' };
  if (at >= 0) list[at] = { ...list[at], label: link.label?.trim() ? label : list[at].label, url };
  else { if (!link.id && !label.en) return false; list.push({ id: link.id ?? uid('ql'), label, url }); }
  d.config = { ...d.config, quickLinks: list };
  return true;
}
export function removeQuickLink(d: DemoState, id: string): void {
  d.config = { ...d.config, quickLinks: (d.config.quickLinks ?? []).filter((l) => l.id !== id) };
}
