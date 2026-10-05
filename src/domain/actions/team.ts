// Field workers and what they are paid, and the profiles of the office team.
import type { DemoState, Lang, TeamUser, Worker, WorkerPayment } from '../types';
import { type Ctx, logActivity } from '../context';
import { uid } from '@/lib/id';
import { money2 } from '@/lib/money';

export function saveWorker(d: DemoState, ctx: Ctx, input: Omit<Worker, 'id'>, id?: string): Worker {
  if (id) { const w = d.workers.find((x) => x.id === id)!; Object.assign(w, input); return w; }
  const w: Worker = { ...input, id: uid('w'), active: true };
  d.workers.push(w); logActivity(d, ctx.actor, 'worker.added', { type: 'worker', id: w.id });
  return w;
}
/** One payment to a worker, optionally split across jobs. Returns false when the input is incomplete. */
export function payWorker(d: DemoState, ctx: Ctx, base: Omit<WorkerPayment, 'id' | 'jobId' | 'amount'>, lines: { jobId: string; amount: number }[]): boolean {
  if (!base.workerId || !lines.length || lines.some((l) => !(l.amount > 0))) return false;
  const w = d.workers.find((x) => x.id === base.workerId);
  for (const l of lines) {
    d.workerPays.push({ ...base, id: uid('wp'), jobId: l.jobId, amount: l.amount });
    logActivity(d, ctx.actor, 'worker.paid', l.jobId ? { type: 'job', id: l.jobId } : { type: 'worker', id: base.workerId }, { amount: money2(l.amount), worker: w?.name ?? '' }, [{ type: 'worker', id: base.workerId }]);
  }
  return true;
}
export function deleteWorkerPay(d: DemoState, _ctx: Ctx, id: string) { d.workerPays = d.workerPays.filter((p) => p.id !== id); }

/* ---------- the office team: profiles ---------- */

/** What a person's profile holds beyond their name and role. Role, sign-in and status are changed through the protected operations. */
export type ProfilePatch = Partial<Pick<TeamUser, 'name' | 'phone' | 'title' | 'bio' | 'photo' | 'languages' | 'away' | 'inLeadPool' | 'officeIds'>>;
const text = (v: string | undefined, max: number) => { const s = (v ?? '').trim().slice(0, max); return s || undefined; };

/**
 * Saves a person's profile: name, title, bio, phone, photo, languages spoken, away dates, and (for whoever manages people)
 * the offices they work from and whether they take part in automatic lead assignment. Returns null when the person does not
 * exist or the name would be left empty.
 */
export function saveProfile(d: DemoState, ctx: Ctx, userId: string, patch: ProfilePatch): TeamUser | null {
  const u = d.users.find((x) => x.id === userId); if (!u) return null;
  if (patch.name !== undefined) { const name = patch.name.trim(); if (!name) return null; u.name = name.slice(0, 80); }
  if ('phone' in patch) u.phone = text(patch.phone, 40);
  if ('title' in patch) u.title = text(patch.title, 80);
  if ('bio' in patch) u.bio = text(patch.bio, 600);
  if ('photo' in patch) u.photo = patch.photo || undefined;
  if (patch.languages) u.languages = (['en', 'es', 'zh'] as Lang[]).filter((l) => patch.languages!.includes(l));
  if (patch.officeIds) { const ids = patch.officeIds.filter((id) => d.offices.some((o) => o.id === id)); u.officeIds = ids.length ? ids : undefined; }
  // an explicit no is kept: it is what takes a person out of the rotation without removing them from the list
  if (patch.inLeadPool !== undefined) u.inLeadPool = patch.inLeadPool;
  if ('away' in patch) {
    const a = patch.away;
    // an absence needs both dates in order; anything else clears it
    u.away = a && a.from && a.to && a.from <= a.to ? { from: a.from, to: a.to, note: text(a.note, 120) } : undefined;
  }
  logActivity(d, ctx.actor, 'user.profile', { type: 'user', id: userId });
  return u;
}
