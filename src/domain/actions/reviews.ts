// Review requests: asking a client how the work went, once it is complete, and recording the answer.
// The rules that never bend are checked here, in one place, whoever asks (a person, an automation, the assistant):
//   never before the work is complete, never twice for the same engagement, never a client who opted out.
// The client answers on a page of our own (src/features/public/review.tsx). The answer comes to the company; nothing is
// posted anywhere by this code. Whatever the rating, the client is shown the company's public review link afterwards:
// a low rating also creates a follow-up task, and never hides the link.
import type { Client, DemoState, ISODate, ISODateTime, Job, Lang, Message, MessageChannel, ReviewRequest, Task } from '../types';
import { type Ctx, logActivity } from '../context';
import { makeT, type TFn } from '@/i18n';
import { taskTypesOf } from '../config';
import { addDays, addDaysFrom, daysBetween, nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { isLive } from '@/platform/session';
import { queueMessage, sendDraft, type QueueResult } from './messages';

/**
 * What a review request keeps on top of the data model's `ReviewRequest`. The database keeps unknown fields, so nothing
 * is lost; the list is in the engineer's report so the model can take them in.
 */
export type ReviewRecord = ReviewRequest & {
  /** The private link's key. Sample workspaces use `sample-<id>`; a live one is random. */
  token?: string;
  /** The link stops working after this day. */
  expires?: ISODate;
  openedAt?: ISODateTime;
  answeredAt?: ISODateTime;
  /** The message that carries the link (Message id). */
  messageId?: string;
  /** Follow-up task created after a low rating (Task id). */
  taskId?: string;
  /** Rule that created the request, when an automation did. */
  auto?: string;
};

export interface ReviewSettings {
  /** Days after the work is completed before the automatic request is prepared. */
  delayDays: number;
  /** Where a client can leave a public review, e.g. the company's Google Business Profile review link. Empty until the company pastes one. */
  publicUrl: string;
  /** Days a private link stays usable. */
  linkDays: number;
}
export const REVIEW_DEFAULTS: ReviewSettings = { delayDays: 3, publicUrl: '', linkDays: 30 };
/** A rating at or under this number counts as low: the manager gets a follow-up task. */
export const LOW_RATING = 3;
/** A repeating engagement can be asked about once it has been under way this long, since it is never "completed". */
const RECURRING_MIN_DAYS = 30;
/** A client who was asked is left alone for this long, whatever else gets completed for them in the meantime. */
export const COOL_OFF_DAYS = 90;
/** The automatic request is for work completed lately. Past this many days after the company's delay the moment is gone; a person can still ask by hand. */
export const AUTO_WINDOW_DAYS = 30;

export function reviewSettings(d: Pick<DemoState, 'settings'>): ReviewSettings {
  const own = (d.settings?.reviews ?? {}) as Partial<ReviewSettings>;
  const days = (v: unknown, fallback: number, max: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : fallback);
  return { delayDays: days(own.delayDays, REVIEW_DEFAULTS.delayDays, 90), linkDays: days(own.linkDays, REVIEW_DEFAULTS.linkDays, 365) || REVIEW_DEFAULTS.linkDays, publicUrl: typeof own.publicUrl === 'string' ? own.publicUrl : '' };
}
/** A public review link is only ever a secure web address. Anything else is refused, so the client page never links somewhere odd. */
export const validPublicUrl = (url: string): boolean => { try { const u = new URL(url.trim()); return u.protocol === 'https:' && !!u.hostname.includes('.'); } catch { return false; } };
export function saveReviewSettings(d: DemoState, _ctx: Ctx, patch: Partial<ReviewSettings>): boolean {
  const next = { ...reviewSettings(d), ...patch };
  next.publicUrl = (next.publicUrl ?? '').trim();
  if (next.publicUrl && !validPublicUrl(next.publicUrl)) return false;
  d.settings = { ...d.settings, reviews: next };
  return true;
}

const records = (d: Pick<DemoState, 'reviews'>): ReviewRecord[] => (d.reviews ?? []) as ReviewRecord[];
export const reviewById = (d: Pick<DemoState, 'reviews'>, id: string): ReviewRecord | undefined => records(d).find((r) => r.id === id);
export const reviewByToken = (d: Pick<DemoState, 'reviews'>, token: string | undefined): ReviewRecord | undefined => (token ? records(d).find((r) => r.token === token) : undefined);

/** Whether the work is far enough along to ask about it: completed, or a repeating engagement that has run for a month. */
export function reviewEligible(job: Pick<Job, 'status' | 'repeat' | 'start'>): boolean {
  if (job.status === 'done') return true;
  return job.status === 'progress' && !!job.repeat && job.repeat !== 'once' && !!job.start && daysBetween(job.start, today()) >= RECURRING_MIN_DAYS;
}
/** Days since the work was completed, or null when it is not complete. */
export const daysSinceDone = (job: Pick<Job, 'status' | 'end'>): number | null => (job.status === 'done' ? Math.max(0, daysBetween(job.end || today(), today())) : null);

export type AskProblem = 'no_client' | 'no_job' | 'not_complete' | 'already_asked' | 'asked_recently' | 'opted_out' | 'no_consent' | 'no_address';
/** The address a request would go to on a channel, or the reason there is none. Text and WhatsApp need the client's opt-in. */
function addressFor(c: Client, channel: MessageChannel): { to: string } | { problem: AskProblem } {
  if (channel === 'email') return c.emailOptOut ? { problem: 'opted_out' } : c.email ? { to: c.email } : { problem: 'no_address' };
  if (channel === 'text') return !c.smsOptIn ? { problem: 'no_consent' } : c.phone ? { to: c.phone } : { problem: 'no_address' };
  if (channel === 'whatsapp') return !c.whatsappOptIn ? { problem: 'no_consent' } : c.whatsapp || c.phone ? { to: c.whatsapp || c.phone } : { problem: 'no_address' };
  return { problem: 'no_address' };
}
/** The first period of a repeating engagement: every later period points back at the one before it. A one-time engagement is its own. */
function rootOf(d: Pick<DemoState, 'jobs'>, jobId: string): string {
  let id = jobId;
  for (let i = 0; i < 200; i++) { const parent = d.jobs.find((j) => j.id === id)?.parentId; if (!parent) break; id = parent; }
  return id;
}
/** Whether the client was already asked about this engagement, counting every period of a repeating one as the same engagement. */
export const askedAbout = (d: Pick<DemoState, 'jobs' | 'reviews'>, jobId: string): boolean => { const root = rootOf(d, jobId); return records(d).some((r) => !!r.jobId && rootOf(d, r.jobId) === root); };
/**
 * Why this client cannot be asked right now, or null when they can.
 * Without an engagement the request is about the relationship as a whole: the client needs at least one piece of work that
 * qualifies. Either way a client who was asked in the last three months is not asked again yet.
 */
export function askProblem(d: DemoState, input: { clientId: string; jobId?: string; channel?: MessageChannel }): AskProblem | null {
  const client = d.clients.find((c) => c.id === input.clientId); if (!client) return 'no_client';
  const mine = records(d).filter((r) => r.clientId === client.id);
  if (input.jobId) {
    const job = d.jobs.find((j) => j.id === input.jobId && j.clientId === client.id); if (!job) return 'no_job';
    if (!reviewEligible(job)) return 'not_complete';
    if (askedAbout(d, job.id)) return 'already_asked';
  } else if (!d.jobs.some((j) => j.clientId === client.id && reviewEligible(j))) return 'not_complete';
  if (mine.some((r) => daysBetween(r.at.slice(0, 10), today()) < COOL_OFF_DAYS)) return 'asked_recently';
  const where = addressFor(client, input.channel ?? 'email');
  return 'problem' in where ? where.problem : null;
}
/** The engagements of a client that can be asked about and have not been. */
export const askableJobs = (d: DemoState, clientId: string): Job[] => d.jobs.filter((j) => j.clientId === clientId && reviewEligible(j) && !askedAbout(d, j.id));

/** A key nobody can guess, for the private link of a live workspace. */
function newToken(id: string): string {
  if (!isLive()) return 'sample-' + id;
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
/** The address of the page where the client answers. `base` is the site the workspace runs on. */
export function reviewLink(r: Pick<ReviewRecord, 'token'>, base?: string): string {
  const origin = base ?? ((globalThis as { location?: { origin?: string } }).location?.origin || '');
  return `${origin}/review/${r.token ?? ''}`;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';
const wording = (d: DemoState, ctx: Ctx, lang: Lang | undefined): TFn => (!lang || lang === ctx.lang ? ctx.t : makeT(lang, ctx.pack, d.config));

export interface AskInput { clientId: string; jobId?: string; channel: MessageChannel; /** Rule that asked, when an automation did. */ auto?: string; /** Site address for the link, when the caller knows it. */ linkBase?: string }
export type AskResult = { ok: true; review: ReviewRecord; message?: Message; /** Why no message was prepared, when none was. */ noMessage?: Extract<QueueResult, { ok: false }>['reason'] } | { ok: false; reason: AskProblem };

/**
 * Prepares a review request: the record, and a message with the private link for a person to look over and send.
 * Nothing leaves at this point. Refused when the work is not complete, the client was already asked about it, or the
 * client opted out of the channel.
 */
export function requestReview(d: DemoState, ctx: Ctx, input: AskInput): AskResult {
  const problem = askProblem(d, input); if (problem) return { ok: false, reason: problem };
  const client = d.clients.find((c) => c.id === input.clientId)!;
  const job = input.jobId ? d.jobs.find((j) => j.id === input.jobId) : undefined;
  const id = uid('rv');
  const review: ReviewRecord = {
    id, clientId: client.id, ...(job ? { jobId: job.id } : {}), at: nowIso(), channel: input.channel, status: 'draft', by: input.auto ? 'automation' : ctx.actor,
    token: newToken(id), expires: addDays(reviewSettings(d).linkDays), ...(input.auto ? { auto: input.auto } : {}),
  };
  d.reviews = [review, ...(d.reviews ?? [])];
  const t = wording(d, ctx, client.lang);
  const where = addressFor(client, input.channel);
  const p = { name: firstName(client.name), company: d.company.name, job: job?.name ?? '', link: reviewLink(review, input.linkBase) };
  const out = queueMessage(d, ctx, {
    channel: input.channel, to: 'to' in where ? where.to : '', clientId: client.id, ref: job ? { type: 'job', id: job.id } : { type: 'client', id: client.id },
    subject: t('reviews.mail.subject', p), body: t(input.channel === 'email' ? (job ? 'reviews.mail.body' : 'reviews.mail.bodyNoJob') : 'reviews.mail.short', p),
    auto: input.auto ?? 'review:' + id, mode: 'draft',
  });
  if (out.ok) review.messageId = out.message.id;
  logActivity(d, input.auto ? 'automation' : ctx.actor, 'review.requested', { type: 'client', id: client.id }, undefined, job ? [{ type: 'job', id: job.id }] : undefined);
  return out.ok ? { ok: true, review, message: out.message } : { ok: true, review, noMessage: out.reason };
}

export type SendResult = { ok: true; review: ReviewRecord } | { ok: false; reason: 'not_found' | 'not_draft' | AskProblem | 'channel_off' };
/**
 * Sends a prepared request. In a sample workspace nothing leaves the browser: the request is marked `demo`.
 * In a live one the message goes to the channel's queue and the request stays a draft until the server reports the
 * delivery; this code never writes `sent` itself.
 */
export function sendReview(d: DemoState, ctx: Ctx, id: string): SendResult {
  const r = reviewById(d, id); if (!r) return { ok: false, reason: 'not_found' };
  if (r.status !== 'draft') return { ok: false, reason: 'not_draft' };
  const client = d.clients.find((c) => c.id === r.clientId); if (!client) return { ok: false, reason: 'no_client' };
  const where = addressFor(client, r.channel); if ('problem' in where) return { ok: false, reason: where.problem };
  const draft = r.messageId ? d.messages.find((m) => m.id === r.messageId) : undefined;
  const job = r.jobId ? d.jobs.find((j) => j.id === r.jobId) : undefined;
  const t = wording(d, ctx, client.lang);
  const p = { name: firstName(client.name), company: d.company.name, job: job?.name ?? '', link: reviewLink(r) };
  // the draft a person looked over is the message that goes; without one, the message is written now
  const out = draft && draft.status === 'draft' ? sendDraft(d, ctx, draft.id) : queueMessage(d, ctx, {
    channel: r.channel, to: where.to, clientId: client.id, ref: job ? { type: 'job', id: job.id } : { type: 'client', id: client.id },
    subject: t('reviews.mail.subject', p), body: t(r.channel === 'email' ? (job ? 'reviews.mail.body' : 'reviews.mail.bodyNoJob') : 'reviews.mail.short', p),
    auto: 'review-send:' + r.id, mode: 'send',
  });
  if (out.ok) {
    r.messageId = out.message.id;
    if (out.message.status === 'demo') r.status = 'demo';
  } else if (out.reason === 'not_found' || isLive() || out.reason !== 'channel_off') return { ok: false, reason: out.reason === 'not_found' ? 'channel_off' : out.reason };
  // a sample workspace without that channel: the request is shown the way it would look, and says so
  else r.status = 'demo';
  r.at = nowIso();
  logActivity(d, ctx.actor, 'review.sent', { type: 'client', id: client.id }, undefined, job ? [{ type: 'job', id: job.id }] : undefined);
  return { ok: true, review: r };
}

/** What the screen shows for a request. `queued` and `sent` come from the message's real delivery state; `expired` from the link's date. */
export type ReviewState = ReviewRequest['status'] | 'queued' | 'expired';
export function reviewState(d: Pick<DemoState, 'messages'>, r: ReviewRecord): ReviewState {
  if (r.status === 'rated' || r.status === 'declined') return r.status;
  if (r.status === 'draft') {
    const m = r.messageId ? d.messages.find((x) => x.id === r.messageId) : undefined;
    if (m && (m.status === 'sent' || m.status === 'delivered')) return 'sent';
    if (m && m.status === 'queued') return 'queued';
    return 'draft';
  }
  return r.expires && r.expires < today() ? 'expired' : r.status;
}
/** A request the client can still answer. */
export const reviewOpen = (r: ReviewRecord): boolean => r.status !== 'rated' && r.status !== 'declined' && !(r.expires && r.expires < today());

/** The client opened the private link. */
export function openReview(d: DemoState, _ctx: Ctx, token: string): ReviewRecord | null {
  const r = reviewByToken(d, token); if (!r || !reviewOpen(r)) return null;
  if (!r.openedAt) r.openedAt = nowIso();
  if (r.status === 'draft' || r.status === 'demo' || r.status === 'sent') r.status = 'opened';
  return r;
}

const managerOf = (d: DemoState, job?: Job): string => {
  const active = (id: string | undefined) => d.users.find((u) => u.id === id && u.active !== false);
  const lead = active(job?.managerId);
  return (lead && lead.role !== 'staff' && lead.role !== 'readonly' ? lead.id : undefined)
    ?? d.users.find((u) => u.role === 'manager' && u.active !== false)?.id ?? d.users.find((u) => u.role === 'owner' && u.active !== false)?.id ?? d.users[0]?.id ?? '';
};
/** The task a low rating creates, once: the manager calls the client. */
function followUp(d: DemoState, ctx: Ctx, r: ReviewRecord): Task | null {
  if (r.status !== 'rated' || typeof r.rating !== 'number' || r.rating > LOW_RATING) return null;
  const stamp = 'review-low:' + r.id;
  const there = d.tasks.find((t) => t.auto === stamp); if (there) { r.taskId = there.id; return null; }
  const client = d.clients.find((c) => c.id === r.clientId); if (!client) return null;
  const job = r.jobId ? d.jobs.find((j) => j.id === r.jobId) : undefined;
  const task: Task = {
    id: uid('t'), title: ctx.t('reviews.task.followUp', { client: client.name, rating: r.rating }), description: r.comment ? ctx.t('reviews.task.comment', { text: r.comment }) : undefined,
    clientId: client.id, ...(job ? { jobId: job.id } : {}), assignee: 'u:' + managerOf(d, job), due: today(), status: 'todo', pri: 'high', created: today(), auto: stamp,
    ...(taskTypesOf(d, ctx.pack).some((x) => x.id === 'call') ? { type: 'call' } : {}),
  };
  d.tasks.unshift(task); r.taskId = task.id;
  return task;
}

export type AnswerResult = { ok: true; review: ReviewRecord; low: boolean; task?: Task } | { ok: false; reason: 'not_found' | 'closed' | 'invalid' };
/** Records the client's answer. One answer per request: a second one is refused. A low rating creates the follow-up task. */
export function answerReview(d: DemoState, ctx: Ctx, token: string, answer: { rating: number; comment?: string }): AnswerResult {
  const r = reviewByToken(d, token); if (!r) return { ok: false, reason: 'not_found' };
  if (!reviewOpen(r)) return { ok: false, reason: 'closed' };
  const rating = Math.round(Number(answer.rating));
  if (!(rating >= 1 && rating <= 5)) return { ok: false, reason: 'invalid' };
  r.rating = rating; r.comment = (answer.comment ?? '').trim().slice(0, 2000) || undefined; r.status = 'rated'; r.answeredAt = nowIso();
  if (!r.openedAt) r.openedAt = r.answeredAt;
  logActivity(d, 'system', 'review.rated', { type: 'client', id: r.clientId }, { rating }, r.jobId ? [{ type: 'job', id: r.jobId }] : undefined);
  const task = followUp(d, ctx, r) ?? undefined;
  return { ok: true, review: r, low: rating <= LOW_RATING, task };
}
/** The client said no thanks. They are not asked again about this work. */
export function declineReview(d: DemoState, _ctx: Ctx, token: string): ReviewRecord | null {
  const r = reviewByToken(d, token); if (!r || !reviewOpen(r)) return null;
  r.status = 'declined'; r.answeredAt = nowIso();
  return r;
}
/** Removes a request that was never sent, with its prepared message. Anything that went out stays on record. */
export function deleteReview(d: DemoState, _ctx: Ctx, id: string): boolean {
  const r = reviewById(d, id); if (!r || r.status !== 'draft') return false;
  const m = r.messageId ? d.messages.find((x) => x.id === r.messageId) : undefined;
  if (m && m.status !== 'draft') return false;
  if (m) d.messages = d.messages.filter((x) => x.id !== m.id);
  d.reviews = (d.reviews ?? []).filter((x) => x.id !== id);
  return true;
}

/** Makes sure every low rating on record has its follow-up task. Run with the daily work, so an imported or sample rating is not missed. */
export function sweepReviews(d: DemoState, ctx: Ctx): Task[] {
  const made: Task[] = [];
  for (const r of records(d)) { const t = followUp(d, ctx, r); if (t) made.push(t); }
  return made;
}

export interface ReviewStats { total: number; waiting: number; rated: number; declined: number; /** Null when nobody has rated yet: there is no average of nothing. */ average: number | null; counts: [number, number, number, number, number] }
/** Figures for the reviews screen, computed from the requests on record and nothing else. */
export function reviewStats(d: Pick<DemoState, 'reviews' | 'messages'>): ReviewStats {
  const all = records(d); const rated = all.filter((r) => r.status === 'rated' && typeof r.rating === 'number');
  const counts: ReviewStats['counts'] = [0, 0, 0, 0, 0];
  for (const r of rated) counts[Math.min(5, Math.max(1, r.rating!)) - 1]++;
  return {
    total: all.length, rated: rated.length, declined: all.filter((r) => r.status === 'declined').length,
    waiting: all.filter((r) => { const s = reviewState(d, r); return s === 'demo' || s === 'sent' || s === 'opened' || s === 'queued'; }).length,
    average: rated.length ? Math.round((rated.reduce((n, r) => n + r.rating!, 0) / rated.length) * 10) / 10 : null, counts,
  };
}

/**
 * Completed work that is due for the automatic request: completed lately, not asked about yet, the client reachable by
 * email and not asked about anything in the last three months. One engagement per client at a time: the latest.
 */
export function reviewsDue(d: DemoState): { job: Job; client: Client; days: number }[] {
  const latest = [...d.jobs].sort((a, b) => (b.end || '').localeCompare(a.end || ''));
  const window = reviewSettings(d).delayDays + AUTO_WINDOW_DAYS;
  const out: { job: Job; client: Client; days: number }[] = [];
  for (const job of latest) {
    const days = daysSinceDone(job); if (days === null || days > window) continue;
    if (out.some((x) => x.client.id === job.clientId)) continue;
    const client = d.clients.find((c) => c.id === job.clientId); if (!client) continue;
    if (askProblem(d, { clientId: client.id, jobId: job.id, channel: 'email' })) continue;
    out.push({ job, client, days });
  }
  return out;
}
/** When the automatic request for a completed engagement is due. */
export const reviewDueOn = (d: Pick<DemoState, 'settings'>, job: Pick<Job, 'end'>): ISODate => addDaysFrom(job.end || today(), reviewSettings(d).delayDays);
