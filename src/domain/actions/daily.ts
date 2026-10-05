// Start of day: everything that depends on the calendar rather than on someone doing something.
//   1. the `daily` event (the compliance watch, and whatever a company builds on it);
//   2. the sweeps other modules own, when they exist (unpaid appointments released, signature requests expired,
//      cross-sell rules looked at again);
//   3. the events that come from counting days: a lead nobody has contacted, a task past its date, a deadline, a
//      birthday or an appointment coming up, a credit about to run out, completed work that is due for a review request.
// It runs when a workspace opens and from the server's daily job. Every part is safe to run as often as wanted: the rule
// engine acts once per record and occasion.
import type { DemoState, Ref } from '../types';
import type { Ctx } from '../context';
import { emit, type RuleSubject } from '../rules/engine';
import { ev } from '../rules/fields';
import { leadIsOpen } from '../config';
import { daysBetween, today } from '@/lib/dates';
import { reviewSettings, reviewsDue, sweepReviews } from './reviews';
import * as actions from './index';
import * as appointments from './appointments';

/** Sweeps that belong to other modules. Looked up by name, so this file builds and runs whether or not they exist yet. */
const OTHER_SWEEPS = ['sweepAppointments', 'sweepEnvelopes', 'evaluateCrossSell'] as const;
/** The sweeps of other modules that are there to call, by name. For the status line of the Automations screen and the tests. */
const lookup = (): Record<string, unknown> => ({ ...(appointments as unknown as Record<string, unknown>), ...(actions as unknown as Record<string, unknown>) });
export function sweepsAvailable(): string[] {
  const all = lookup();
  return OTHER_SWEEPS.filter((name) => typeof all[name] === 'function');
}
function runOtherSweeps(d: DemoState, ctx: Ctx) {
  const all = lookup();
  for (const name of OTHER_SWEEPS) {
    const fn = all[name];
    if (typeof fn !== 'function') continue;
    // one module's sweep breaking must not stop the day's work of the others
    try {
      // the cross-sell rules are looked at one client at a time
      if (name === 'evaluateCrossSell' && fn.length >= 3) for (const c of [...d.clients]) (fn as (d: DemoState, ctx: Ctx, clientId: string) => unknown)(d, ctx, c.id);
      else (fn as (d: DemoState, ctx: Ctx) => unknown)(d, ctx);
    } catch { /* reported by that module's own screen */ }
  }
}

const day = (iso: string | undefined) => (iso ?? '').slice(0, 10);
const clientOf = (d: DemoState, id: string | undefined) => (id ? d.clients.find((c) => c.id === id) : undefined);

/** The last day anyone was in touch with a lead: the contact stamp, the newest note, or the day it came in. */
function lastTouch(l: DemoState['leads'][number]): string {
  return [day(l.lastContact), ...l.notes.map((n) => day(n.at)), l.created].filter(Boolean).sort().pop() ?? l.created;
}
/** Days until the next time a month and day come round (0 = today). */
function daysToAnniversary(date: string, from: string): number {
  const [y, m, dd] = from.split('-').map(Number); const [, bm, bd] = date.split('-').map(Number);
  let next = new Date(y, bm - 1, bd); const start = new Date(y, m - 1, dd);
  if (next.getTime() < start.getTime()) next = new Date(y + 1, bm - 1, bd);
  return Math.round((next.getTime() - start.getTime()) / 86400000);
}

/**
 * The events that come from counting days. Each record is announced with how many days it has been (`extra.days`); the
 * engine compares that with each rule's own number and acts once per occasion (the same idle spell, the same due date).
 */
export function runTimed(d: DemoState, ctx: Ctx, now: Date = new Date()): void {
  const td = today();
  const say = (event: Parameters<typeof ev>[0], subject: RuleSubject) => emit(d, ctx, ev(event), subject);

  for (const l of d.leads) {
    if (!leadIsOpen(d, l)) continue;
    const since = lastTouch(l); const days = daysBetween(since, td);
    if (days >= 1) say('lead.idle', { ref: { type: 'lead', id: l.id }, lead: l, extra: { days, occasion: since } });
  }
  for (const t of d.tasks) {
    if (t.status === 'done' || !t.due || t.due >= td) continue;
    say('task.overdue', { ref: { type: 'task', id: t.id }, task: t, client: clientOf(d, t.clientId), job: d.jobs.find((j) => j.id === t.jobId), lead: d.leads.find((l) => l.id === t.leadId), extra: { days: daysBetween(t.due, td), occasion: t.due } });
  }
  for (const x of d.complianceItems ?? []) {
    if (x.status !== 'open') continue;
    // a date already past is the deadlines screen's business; the rules are about what is coming
    const left = daysBetween(td, x.due); if (left < 0 || left > 120) continue;
    const ref: Ref = { type: 'compliance', id: x.id };
    say('deadline.near', { ref, client: clientOf(d, x.clientId), job: d.jobs.find((j) => j.id === x.jobId), extra: { days: left, kind: x.kind, title: x.title, occasion: x.due, ...(x.assignee ? { assignee: x.assignee } : {}) } });
  }
  for (const c of d.clients) {
    if (!c.birthday || c.lifecycle === 'former') continue;
    const left = daysToAnniversary(c.birthday, td); if (left > 30) continue;
    say('client.birthday', { ref: { type: 'client', id: c.id }, client: c, extra: { days: left, occasion: String(new Date(now.getTime() + left * 86400000).getFullYear()) } });
  }
  // a signature request nobody answered is announced by the e-signature sweep itself (`envelope.idle`), at the interval set on the request
  for (const a of d.appointments ?? []) {
    const on = a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'awaiting_payment';
    if (!on) continue;
    const subject = (extra: RuleSubject['extra']): RuleSubject => ({ ref: { type: 'appointment', id: a.id }, appointment: a, client: clientOf(d, a.clientId), lead: d.leads.find((l) => l.id === a.leadId), job: d.jobs.find((j) => j.id === a.jobId), extra });
    const left = daysBetween(td, a.date);
    if (left >= 0 && left <= 14 && a.status !== 'awaiting_payment') say('appointment.soon', subject({ days: left }));
    if (a.status === 'awaiting_payment' && !a.paid && a.payBy) {
      const hours = (new Date(a.payBy).getTime() - now.getTime()) / 3600000;
      if (hours > 0 && hours <= 24) say('appointment.pay_soon', subject({ hoursLeft: Math.round(hours), occasion: a.payBy }));
    }
  }
  for (const c of d.credits ?? []) {
    if (c.used || c.void || !c.expires || c.expires < td) continue;
    const left = daysBetween(td, c.expires); if (left > 60) continue;
    say('credit.expiring', { ref: { type: 'client', id: c.clientId }, client: clientOf(d, c.clientId), extra: { days: left, amount: c.amount, occasion: c.id } });
  }
  for (const o of d.opportunities ?? []) {
    if (o.status !== 'open') continue;
    const service = (d.catalog ?? []).find((s) => s.id === o.serviceId);
    say('opportunity.created', { ref: { type: 'opportunity', id: o.id }, client: clientOf(d, o.clientId), extra: { serviceId: o.serviceId, service: service?.i18n?.[ctx.lang]?.name ?? service?.name ?? '' } });
  }
  const delay = reviewSettings(d).delayDays;
  for (const due of reviewsDue(d)) say('review.due', { ref: { type: 'job', id: due.job.id }, job: due.job, client: due.client, extra: { days: due.days, threshold: delay } });
  // a low rating always gets its follow-up task, however the rating arrived
  sweepReviews(d, ctx);
}

export function runDaily(d: DemoState, ctx: Ctx) {
  emit(d, ctx, 'daily', {});
  runOtherSweeps(d, ctx);
  runTimed(d, ctx);
}
