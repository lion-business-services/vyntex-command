// What the connected assistant works from and what it may propose, kept apart from the network code so it can be tested
// without a browser: the summary of the business that is sent with a question, and the translation of the model's tool
// call into the same proposals the built-in assistant makes.
import type { ISODate, JobStatus, PayMethod } from '@/domain/types';
import { assigneeName, byId, calendarEvents, clientMoney, insuranceState, isOpenLead, jobMoney, kpiValues, workerMoney } from '@/domain/selectors';
import { addDays, today } from '@/lib/dates';
import { moduleOn } from '@/domain/config';
import { reviewStats } from '@/domain/actions/reviews';
import { check, type Env, type Proposal } from './engine';
import { maskTaxIds } from './records';

const CAP = 40;

/**
 * The summary the model answers from. Names, dates, statuses and totals; no phone numbers, emails or addresses, and never
 * a tax ID: the fields are named one by one, the tax ID fields are not among them, and anything shaped like one is masked
 * before the summary leaves. Money only when the role includes it. A screen the edition or the role does not have adds nothing.
 */
export function buildContext(env: Env): Record<string, unknown> {
  const { data, pack, t, can } = env; const cash = can('money');
  const out: Record<string, unknown> = {
    today: today(), company: data.company.name, product: pack.product,
    words: { job: t('project'), jobs: t('projects'), worker: t('sub'), workers: t('subs'), client: t('client'), clients: t('clients') },
    statuses: pack.jobStatuses.map((s) => ({ id: s, label: t('st_' + s) })),
    services: pack.serviceTypes.map((s) => ({ id: s.id, label: t('ty_' + s.id) })),
    people: [...data.users.map((u) => ({ id: 'u:' + u.id, name: u.name, role: u.role })), ...data.workers.filter((w) => w.active !== false).map((w) => ({ id: 'w:' + w.id, name: w.name, role: w.trade }))].slice(0, CAP),
    asking: 'u:' + env.actor,
    tasks: data.tasks.filter((x) => x.status !== 'done').slice(0, CAP).map((x) => ({ id: x.id, title: x.title, due: x.due, status: x.status, assignee: assigneeName(data, x.assignee), job: byId(data.jobs, x.jobId)?.name })),
    leads: data.leads.filter((l) => isOpenLead(l, data)).slice(0, CAP).map((l) => ({ id: l.id, name: l.name, stage: l.status, service: l.type, value: l.value, visit: l.apptDate, visitTime: l.apptTime, followUp: l.followUp })),
    jobs: data.jobs.slice(0, CAP).map((j) => {
      const m = jobMoney(data, j);
      return { id: j.id, name: j.name, client: byId(data.clients, j.clientId)?.name, status: j.status, start: j.start || undefined, end: j.end || undefined, ...(cash ? { price: m.price, received: m.received, balance: m.clientOwes } : {}) };
    }),
    clients: data.clients.slice(0, CAP).map((c) => ({ id: c.id, name: c.name, ...(cash ? { balance: clientMoney(data, c.id).owes } : {}) })),
    calendar: calendarEvents(data, 14).filter((e) => e.date >= today() && e.date <= addDays(6) && !e.done).slice(0, 25).map((e) => ({ date: e.date, time: e.time, kind: e.kind, title: e.title })),
  };
  if (cash) {
    const k = kpiValues(data);
    out.money = {
      clientsOweTotal: k.clientsOwe, oweWorkersTotal: k.oweWorkers, collectedThisMonth: k.collectedMonth, openPipelineValue: k.pipelineValue,
      owedToWorkers: data.workers.map((w) => ({ name: w.name, owed: workerMoney(data, w.id).owed })).filter((w) => w.owed > 0.005).slice(0, CAP),
    };
  }
  if (pack.compliance && can('compliance')) {
    out.compliance = data.workers.filter((w) => w.active !== false).map((w) => ({ name: w.name, w9OnFile: w.w9, insurance: insuranceState(w), insuranceExpires: w.coiExp })).filter((w) => !w.w9OnFile || w.insurance !== 'ok').slice(0, CAP);
  }
  // the newer records, each only where the edition has the screen and the role may open it
  const on = (m: Parameters<typeof moduleOn>[2], p: Parameters<Env['can']>[0]) => moduleOn(data, pack, m) && can(p);
  const who = (clientId?: string, leadId?: string) => byId(data.clients, clientId)?.name ?? byId(data.leads, leadId)?.name;
  const service = (id?: string) => { const x = (data.catalog ?? []).find((c) => c.id === id); return x ? x.i18n?.[env.lang]?.name ?? x.name : undefined; };
  if (on('appointments', 'appointments')) {
    out.appointmentTypes = (data.apptTypes ?? []).filter((a) => a.active).map((a) => ({ id: a.id, name: a.name[env.lang] ?? a.name.en, minutes: a.minutes, paidInAdvance: a.prepay && a.fee > 0 }));
    out.appointments = (data.appointments ?? []).filter((a) => a.date >= today() && a.date <= addDays(13) && !a.status.startsWith('cancelled')).slice(0, CAP)
      .map((a) => ({ id: a.id, date: a.date, time: a.time, with: who(a.clientId, a.leadId), type: (data.apptTypes ?? []).find((x) => x.id === a.typeId)?.name.en, status: a.status, heldBy: byId(data.users, a.staffId)?.name }));
  }
  if (on('catalog', 'catalog')) out.catalog = (data.catalog ?? []).filter((x) => x.active).slice(0, CAP).map((x) => ({ id: x.id, name: x.i18n?.[env.lang]?.name ?? x.name, category: x.category, prices: x.tiers.map((t2) => ({ name: t2.name, price: t2.price, unit: t2.unit })) }));
  if (on('opportunities', 'opportunities')) out.opportunities = (data.opportunities ?? []).filter((o) => o.status === 'open' || o.status === 'contacted').slice(0, CAP).map((o) => ({ client: who(o.clientId), service: service(o.serviceId), status: o.status, ...(cash ? { value: o.value } : {}) }));
  if (on('deadlines', 'deadlines')) out.deadlines = (data.complianceItems ?? []).filter((x) => x.status === 'open' && x.due <= addDays(30)).slice(0, CAP).map((x) => ({ title: x.title, due: x.due, kind: x.kind, client: who(x.clientId) }));
  if (can('documents')) {
    out.awaitingSignature = (data.envelopes ?? []).filter((e) => e.status === 'sent' || e.status === 'partly_signed').slice(0, CAP)
      .map((e) => ({ title: e.title, client: who(byId(data.docs, e.docId)?.clientId), sent: e.sentAt?.slice(0, 10), waitingOn: e.signers.filter((x) => x.status !== 'signed' && x.status !== 'declined').map((x) => x.name) }));
  }
  if (on('reviews', 'reviews')) { const r = reviewStats(data); out.reviews = { requests: r.total, waiting: r.waiting, answered: r.rated, averageRating: r.average }; }
  if (moduleOn(data, pack, 'appointments') && (can('credits') || cash)) {
    out.credits = (data.credits ?? []).filter((c) => !c.used && !c.void && (!c.expires || c.expires >= today())).slice(0, CAP).map((c) => ({ client: who(c.clientId), amount: c.amount, expires: c.expires }));
  }
  // last line of defence: nothing shaped like a tax ID leaves, wherever it was typed
  return JSON.parse(maskTaxIds(JSON.stringify(out))) as Record<string, unknown>;
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoDate = (v: unknown): ISODate | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const METHODS: PayMethod[] = ['cash', 'check', 'transfer', 'zelle', 'card'];

/** Turns the model's tool call into the same kind of proposal the built-in assistant makes. Returns the reason as text when it cannot be carried out, or null when it makes no sense at all. */
export function toProposal(tool: string, input: Record<string, unknown>, env: Env): Proposal | string | null {
  let p: Proposal | null = null;
  switch (tool) {
    case 'create_task': p = { kind: 'task', title: str(input.title, 140), due: isoDate(input.due_date), assignee: str(input.assignee_id, 60) || 'u:' + env.actor }; break;
    case 'add_lead': p = { kind: 'lead', name: str(input.name, 80), phone: str(input.phone, 40), type: str(input.service_type_id, 60) }; break;
    case 'add_note': { const type = input.record_type; if (type === 'lead' || type === 'client' || type === 'job') p = { kind: 'note', ref: { type, id: str(input.record_id, 60) }, text: str(input.text) }; break; }
    case 'complete_task': p = { kind: 'taskDone', taskId: str(input.task_id, 60) }; break;
    case 'set_job_status': p = { kind: 'jobStatus', jobId: str(input.job_id, 60), status: str(input.status, 20) as JobStatus }; break;
    case 'record_client_payment': {
      const amount = typeof input.amount === 'number' && isFinite(input.amount) ? Math.round(input.amount * 100) / 100 : 0;
      const method = METHODS.includes(input.method as PayMethod) ? (input.method as PayMethod) : 'check';
      p = { kind: 'payment', jobId: str(input.job_id, 60), amount, method, date: isoDate(input.date) ?? today() }; break;
    }
    case 'book_appointment': {
      const date = isoDate(input.date); const time = typeof input.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : undefined;
      const client = str(input.client_id, 60); const lead = str(input.lead_id, 60);
      if (date && time && (client || lead)) p = { kind: 'appointment', ...(client ? { clientId: client } : { leadId: lead }), typeId: str(input.appointment_type_id, 60), date, time, staffId: env.actor };
      break;
    }
    case 'request_review': p = { kind: 'review', clientId: str(input.client_id, 60), ...(str(input.job_id, 60) ? { jobId: str(input.job_id, 60) } : {}), channel: 'email' }; break;
    case 'schedule_lead_visit': { const date = isoDate(input.date); const time = typeof input.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : undefined; if (date) p = { kind: 'visit', leadId: str(input.lead_id, 60), date, time }; break; }
  }
  if (!p) return null;
  return check(p, env) ?? p;
}
