// Connected mode: the server function api/assistant.js talks to an AI model when one is set up for the workspace.
// The browser sends a compact summary of the business (only what an answer needs) and gets back text plus, at most, one
// proposed action, which goes through the same confirmation card as the built-in assistant. Nothing is executed on the server.
import { PREVIEW } from '@/app/router';
import type { ISODate, JobStatus, PayMethod } from '@/domain/types';
import { assigneeName, byId, calendarEvents, clientMoney, insuranceState, isOpenLead, jobMoney, kpiValues, workerMoney } from '@/domain/selectors';
import { addDays, today } from '@/lib/dates';
import { check, type Env, type Proposal } from './engine';

const ENDPOINT = '/api/assistant';
const CAP = 40;

/** Asks once, on page load, whether an AI model is connected. Any failure means "no": the page stays on the built-in assistant. */
export async function checkConfigured(): Promise<boolean> {
  if (PREVIEW) return false; // an embedded preview has no server behind it
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return false;
    const body = await res.json();
    return body?.configured === true;
  } catch { return false; }
}

/** The summary the model answers from. Names, dates, statuses and totals; no phone numbers, emails or addresses. Money only when the role includes it. */
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
    leads: data.leads.filter(isOpenLead).slice(0, CAP).map((l) => ({ id: l.id, name: l.name, stage: l.status, service: l.type, value: l.value, visit: l.apptDate, visitTime: l.apptTime, followUp: l.followUp })),
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
  return out;
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
    case 'schedule_lead_visit': { const date = isoDate(input.date); const time = typeof input.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : undefined; if (date) p = { kind: 'visit', leadId: str(input.lead_id, 60), date, time }; break; }
  }
  if (!p) return null;
  return check(p, env) ?? p;
}

export interface Turn { role: 'user' | 'assistant'; content: string }
export interface ModelReply { text: string; proposal?: Proposal; /** Why the change the model asked for cannot be prepared. */ problem?: string }

/** One round trip to the server function. Returns null when the model could not answer, so the caller can fall back to the built-in assistant. */
export async function askModel(turns: Turn[], env: Env): Promise<ModelReply | null> {
  try {
    const messages = turns.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 1900) }));
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) return null;
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ lang: env.lang, messages, context: buildContext(env) }) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || body.ok !== true || typeof body.text !== 'string') return null;
    const action = body.action;
    if (action && typeof action.tool === 'string' && action.input && typeof action.input === 'object') {
      const proposal = toProposal(action.tool, action.input as Record<string, unknown>, env);
      if (proposal && typeof proposal === 'object') return { text: body.text, proposal };
      return { text: body.text, problem: proposal ?? env.t('asst.model.badAction') };
    }
    return body.text.trim() ? { text: body.text } : null;
  } catch { return null; }
}
