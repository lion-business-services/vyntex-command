// The sample business of the professional-services edition: a fictional firm, "Harbor Ledger Advisors".
// It is put together from parts, one file per area, so each area can grow without touching the others:
//   seed/people.ts        the team and the offices            seed/tasks.ts          tasks and client requests
//   seed/clients.ts       individuals and businesses          seed/catalog.ts        services and sample prices
//   seed/leads.ts         the pipeline, all seven stages      seed/appointments.ts   appointments
//   seed/engagements.ts   engagements (jobs)                  seed/documents.ts      documents, templates, signatures
//   seed/messages.ts      conversations                       seed/ops.ts            cash and deadlines (reviews, opportunities, social, security: own files)
// Nothing here is a real person, company, price or tax ID.
import type { Activity, Lang, SeedData } from '@/domain/types';
import { people } from './seed/people';
import { clients } from './seed/clients';
import { leads } from './seed/leads';
import { engagements } from './seed/engagements';
import { tasks } from './seed/tasks';
import { catalog } from './seed/catalog';
import { appointments } from './seed/appointments';
import { documents } from './seed/documents';
import { messages } from './seed/messages';
import { ops } from './seed/ops';
import { reviews } from './seed/reviews';
import { opportunities } from './seed/opportunities';
import { social } from './seed/social';
import { security } from './seed/security';
import { stamp } from './seed/util';
import { daysBetween, today } from '@/lib/dates';

export function seed(lang: Lang): SeedData {
  const team = people(lang); const cl = clients(lang); const ld = leads(lang); const en = engagements(lang);
  const signer = (clientId: string) => { const c = cl.clients.find((x) => x.id === clientId); return { name: c?.name ?? '', email: c?.email ?? '' }; };
  // history the records imply: when each one was opened and each payment received
  const ago = (date: string) => -daysBetween(date, today());
  const activity: Activity[] = [
    ...cl.clients.map((c): Activity => ({ id: 'a-' + c.id, at: stamp(ago(c.since), 14), kind: 'client.created', ref: { type: 'client', id: c.id }, by: c.assignedTo ?? 'u1' })),
    ...ld.leads.map((l): Activity => ({ id: 'a-' + l.id, at: stamp(ago(l.created), 13), kind: 'lead.created', params: { lead: l.name, source: l.source }, ref: { type: 'lead', id: l.id }, by: l.source === 'website' ? 'automation' : l.ownerId })),
    ...en.jobs.map((j): Activity => ({ id: 'a-' + j.id, at: stamp(ago(j.created), 15), kind: 'job.created', params: { job: j.name }, ref: { type: 'job', id: j.id }, also: [{ type: 'client', id: j.clientId }], by: j.managerId })),
    ...en.jobs.flatMap((j) => j.received.map((r): Activity => ({ id: 'a-' + r.id, at: stamp(ago(r.date), 16), kind: 'payment.received', params: { amount: r.amount, job: j.name }, ref: { type: 'job', id: j.id }, also: [{ type: 'client', id: j.clientId }], by: j.managerId }))),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...team, ...cl, ...ld, ...en, ...tasks(lang), ...catalog(lang), ...appointments(lang), ...documents(lang, en.jobs, signer), ...messages(lang), ...ops(lang), ...reviews(lang), ...opportunities(lang), ...social(lang), ...security(lang),
    // a practice has no field workers
    workers: [], workerPays: [], activity,
  };
}
