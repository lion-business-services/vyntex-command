// Helpers for writing a pack's sample business with little boilerplate.
// All dates are day offsets from today (negative = past), so the demo always looks current.
// Every name, address, phone and email must be fictional (555 numbers, "Sample" streets, example.com emails).
import type {
  Activity, AssignStatus, Client, DocRecord, Job, JobStatus, Lang, Lead, LeadSource, LeadStage, Message, Note, NoteKind, PayMethod, PayType,
  Priority, Repeat, SeedData, Task, TaskStatus, TeamUser, Worker, WorkerPayment,
} from '@/domain/types';
import { addDays, at } from '@/lib/dates';

export const SAMPLE_USERS: TeamUser[] = [
  { id: 'u1', name: 'Jordan Blake', role: 'owner', email: 'jordan@example.com', phone: '609-555-0001' },
  { id: 'u2', name: 'Priya Shah', role: 'manager', email: 'priya@example.com', phone: '609-555-0002' },
  { id: 'u3', name: 'Sam Rivera', role: 'staff', email: 'sam@example.com', phone: '609-555-0003' },
];
type UserId = 'u1' | 'u2' | 'u3';

export interface WorkerIn { id: string; name: string; trade: string; phone: string; email?: string; payType?: PayType; rate?: number; /** W-9 on file since this many days ago; omit when missing. */ w9?: number; /** Insurance certificate expires in this many days (negative = already expired); omit when none. */ coi?: number; insurer?: string; active?: boolean }
export interface ClientIn { id: string; name: string; company?: string; phone: string; email: string; addresses: string[]; /** Client since, days ago (negative number). */ since: number; note?: string; emailOptOut?: boolean }
export interface LeadIn {
  id: string; name: string; company?: string; phone: string; email?: string; address: string; type: string; source: LeadSource; status: LeadStage;
  pri?: Priority; owner?: UserId; value?: number; /** Visit: [days from today, 'HH:MM']. */ appt?: [number, string]; /** Follow-up in this many days. */ followUp?: number;
  /** Created this many days ago (0 or negative). */ created: number; /** Notes, oldest first: [days, kind, text]. The first one is pinned. */ notes?: [number, NoteKind, string][]; lostReason?: string;
  /** For won leads: the client and job they became. */ clientId?: string; jobId?: string;
}
export interface JobIn {
  id: string; name: string; clientId: string; /** Defaults to the client's first address. */ address?: string; type: string; status: JobStatus; price: number;
  start?: number; end?: number; /** Day the job record was opened (defaults to a week before the start). */ created?: number; repeat?: Repeat; scope: string; payTerms: string; manager?: UserId; leadId?: string;
  assign?: { workerId: string; scope: string; price: number; payType?: PayType; rate?: number; qty?: number; status: AssignStatus }[];
  expenses?: { date: number; vendor: string; desc: string; amount: number }[];
  received?: { date: number; method: PayMethod; ref?: string; amount: number }[];
  workerPays?: { date: number; workerId: string; method: PayMethod; ref?: string; amount: number; payType?: PayType; from?: number; to?: number }[];
  tasks?: TaskIn[];
  log?: { date: number; workerId: string; text: string }[];
  notes?: [number, NoteKind, string][];
}
export interface TaskIn { title: string; /** 'u1' | 'u2' | 'u3' or a worker id. */ who: string; due?: number; status?: TaskStatus; pri?: Priority; description?: string }

export function seedKit(lang: Lang, prefix: string) {
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const workers: Worker[] = []; const clients: Client[] = []; const leads: Lead[] = []; const jobs: Job[] = []; const tasks: Task[] = [];
  const workerPays: WorkerPayment[] = []; const docs: DocRecord[] = []; const activity: Activity[] = []; const messages: Message[] = [];
  let seq = 0; const nid = (p: string) => `${p}${++seq}`;
  const notes = (owner: string, list: [number, NoteKind, string][] | undefined, by: string): Note[] =>
    (list || []).map(([days, kind, text], i) => ({ id: `${owner}-n${i + 1}`, at: notAfterNow(at(days, 9 + (i % 7), 15)), kind, text, pin: i === 0 || undefined, by })).reverse();
  /** Sample notes written "today" must not carry a time that has not happened yet. */
  const notAfterNow = (iso: string) => { const now = new Date(Date.now() - 5 * 60000).toISOString(); return iso > now ? now : iso; };
  const who = (w: string) => (/^u\d$/.test(w) ? 'u:' + w : 'w:' + w);
  const stamp = (days: number, hour: number) => at(days, hour, 0);

  const kit = {
    /** Pick the wording for the language the demo is being viewed in. */
    tx,
    worker(o: WorkerIn) {
      workers.push({ id: o.id, name: o.name, trade: o.trade, phone: o.phone, email: o.email ?? '', payType: o.payType, rate: o.rate, w9: o.w9 !== undefined, w9Date: o.w9 !== undefined ? addDays(-Math.abs(o.w9)) : undefined, coiExp: o.coi !== undefined ? addDays(o.coi) : undefined, insurer: o.insurer, active: o.active ?? true });
    },
    client(o: ClientIn) {
      clients.push({ id: o.id, name: o.name, company: o.company, phone: o.phone, email: o.email, addresses: o.addresses, since: addDays(o.since), emailOptOut: o.emailOptOut, notes: o.note ? notes(o.id, [[o.since, 'note', o.note]], 'u1') : [] });
      activity.push({ id: 'a-' + o.id, at: stamp(o.since, 14), kind: 'client.created', ref: { type: 'client', id: o.id }, by: 'u1' });
    },
    lead(o: LeadIn) {
      const owner = o.owner ?? 'u1';
      leads.push({
        id: o.id, ticket: `${prefix}${1001 + leads.length}`, name: o.name, company: o.company, phone: o.phone, email: o.email ?? '', address: o.address, type: o.type, source: o.source, status: o.status,
        pri: o.pri ?? 'medium', ownerId: owner, value: o.value ?? null, apptDate: o.appt ? addDays(o.appt[0]) : undefined, apptTime: o.appt?.[1], followUp: o.followUp !== undefined ? addDays(o.followUp) : undefined,
        created: addDays(o.created), notes: notes(o.id, o.notes, owner), lostReason: o.lostReason, clientId: o.clientId, jobId: o.jobId,
      });
      activity.push({ id: 'a-' + o.id, at: stamp(o.created, 13), kind: 'lead.created', params: { lead: o.name, source: o.source }, ref: { type: 'lead', id: o.id }, by: o.source === 'website' ? 'automation' : owner });
      if (o.status === 'won') activity.push({ id: 'a-' + o.id + '-won', at: stamp(Math.min(0, o.created + 4), 15), kind: 'lead.won', ref: { type: 'lead', id: o.id }, also: o.clientId ? [{ type: 'client', id: o.clientId }] : undefined, by: owner });
      if (o.status === 'lost') activity.push({ id: 'a-' + o.id + '-lost', at: stamp(Math.min(0, o.created + 6), 15), kind: 'lead.lost', ref: { type: 'lead', id: o.id }, by: owner });
    },
    job(o: JobIn) {
      const client = clients.find((c) => c.id === o.clientId);
      if (!client) throw new Error(`seed: job ${o.id} points at unknown client ${o.clientId}`);
      const manager = o.manager ?? 'u1';
      const createdDays = o.created ?? Math.min(o.start !== undefined ? o.start - 7 : -5, (o.received?.[0]?.date ?? 0) - 1, -1);
      const created = addDays(createdDays);
      const n = jobs.length;
      const job: Job = {
        id: o.id, number: `${prefix}J-${1001 + n}`, name: o.name, clientId: o.clientId, address: o.address ?? client.addresses[0] ?? '', type: o.type, status: o.status, price: o.price,
        start: o.start !== undefined ? addDays(o.start) : '', end: o.end !== undefined ? addDays(o.end) : '', repeat: o.repeat ?? 'once', scope: o.scope, payTerms: o.payTerms, managerId: manager, leadId: o.leadId,
        assign: (o.assign || []).map((a, i) => { if (!workers.some((w) => w.id === a.workerId)) throw new Error(`seed: job ${o.id} assigns unknown worker ${a.workerId}`); return { id: `${o.id}-a${i + 1}`, workerId: a.workerId, scope: a.scope, price: a.price, payType: a.payType ?? 'project', rate: a.rate ?? a.price, qty: a.qty ?? 1, status: a.status }; }),
        expenses: (o.expenses || []).map((e, i) => ({ id: `${o.id}-e${i + 1}`, date: addDays(e.date), vendor: e.vendor, desc: e.desc, amount: e.amount })),
        received: (o.received || []).map((r, i) => ({ id: `${o.id}-r${i + 1}`, date: addDays(r.date), method: r.method, ref: r.ref ?? '', amount: r.amount })),
        log: (o.log || []).map((g, i) => ({ id: `${o.id}-g${i + 1}`, date: addDays(g.date), workerId: g.workerId, text: g.text })),
        notes: notes(o.id, o.notes, manager), created,
      };
      jobs.push(job);
      (o.workerPays || []).forEach((p, i) => workerPays.push({ id: `${o.id}-wp${i + 1}`, date: addDays(p.date), workerId: p.workerId, jobId: o.id, method: p.method, ref: p.ref ?? '', amount: p.amount, payType: p.payType, from: p.from !== undefined ? addDays(p.from) : undefined, to: p.to !== undefined ? addDays(p.to) : undefined }));
      (o.tasks || []).forEach((t, i) => {
        const status: TaskStatus = t.status ?? 'todo';
        tasks.push({ id: `${o.id}-t${i + 1}`, title: t.title, description: t.description, jobId: o.id, clientId: o.clientId, assignee: who(t.who), due: t.due !== undefined ? addDays(t.due) : undefined, status, pri: t.pri ?? 'medium', created, doneAt: status === 'done' ? addDays(Math.min(0, t.due ?? 0)) : undefined });
        if (status === 'done') activity.push({ id: `a-${o.id}-t${i + 1}`, at: stamp(Math.min(0, t.due ?? 0), 17), kind: 'task.done', params: { task: t.title }, ref: { type: 'job', id: o.id }, by: t.who });
      });

      // paperwork this job would already have
      const paid = job.received.reduce((a, r) => a + r.amount, 0);
      const signer = { signerName: client.name, signerEmail: client.email };
      if (job.status === 'estimate') {
        docs.push({ id: `d-${o.id}-e`, kind: 'estimate', number: `${prefix}EST-${1001 + n}`, title: job.name, jobId: o.id, clientId: o.clientId, status: 'sent', created, updated: created });
      } else {
        const signed = job.status !== 'contract';
        docs.push({ id: `d-${o.id}-c`, kind: 'contract', number: `${prefix}C-${1001 + n}`, title: job.name, jobId: o.id, clientId: o.clientId, status: signed ? 'signed' : 'sent', created, updated: signed ? addDays(createdDays + 2) : created,
          esign: { demo: true, ...signer, status: signed ? 'signed' : 'sent', sentAt: stamp(createdDays, 11), viewedAt: signed ? stamp(createdDays + 1, 10) : undefined, signedAt: signed ? stamp(createdDays + 2, 12) : undefined } });
        if (signed) activity.push({ id: `a-${o.id}-sig`, at: stamp(Math.min(0, createdDays + 2), 12), kind: 'doc.signed', params: { doc: `${prefix}C-${1001 + n}` }, ref: { type: 'job', id: o.id }, also: [{ type: 'client', id: o.clientId }], by: 'system' });
      }
      if (job.status === 'progress' || job.status === 'done') {
        const last = job.received[job.received.length - 1];
        // an invoice is never dated in the future, even when the work is booked ahead
        const issued = job.start && job.start <= addDays(0) ? job.start : created;
        docs.push({ id: `d-${o.id}-i`, kind: 'invoice', number: `${prefix}INV-${1001 + n}`, title: job.name, jobId: o.id, clientId: o.clientId, status: paid >= job.price && job.price > 0 ? 'paid' : 'sent', created: issued, updated: last ? last.date : issued });
      }
      activity.push({ id: `a-${o.id}-0`, at: stamp(createdDays, 14), kind: 'job.created', params: { job: job.name }, ref: { type: 'job', id: o.id }, also: [{ type: 'client', id: o.clientId }], by: manager });
      (o.received || []).forEach((r, i) => activity.push({ id: `a-${o.id}-r${i + 1}`, at: stamp(r.date, 16), kind: 'payment.received', params: { amount: r.amount, job: job.name }, ref: { type: 'job', id: o.id }, also: [{ type: 'client', id: o.clientId }], by: 'u1' }));
      (o.workerPays || []).forEach((p, i) => activity.push({ id: `a-${o.id}-wp${i + 1}`, at: stamp(p.date, 15), kind: 'worker.paid', params: { amount: p.amount, worker: workers.find((w) => w.id === p.workerId)?.name ?? '' }, ref: { type: 'job', id: o.id }, also: [{ type: 'worker', id: p.workerId }], by: 'u1' }));
    },
    /** A task that is not tied to a job (office work, lead follow-up). */
    task(o: TaskIn & { leadId?: string; clientId?: string }) {
      const status: TaskStatus = o.status ?? 'todo';
      tasks.push({ id: nid('t-x'), title: o.title, description: o.description, leadId: o.leadId, clientId: o.clientId, assignee: who(o.who), due: o.due !== undefined ? addDays(o.due) : undefined, status, pri: o.pri ?? 'medium', created: addDays(Math.min(-3, (o.due ?? 0) - 1)), doneAt: status === 'done' ? addDays(Math.min(0, o.due ?? 0)) : undefined });
    },
    /** Returns the finished sample business. Amounts in activity are numbers; pages format them. */
    finish(): SeedData {
      for (const l of leads) {
        if (l.clientId && !clients.some((c) => c.id === l.clientId)) throw new Error(`seed: lead ${l.id} points at unknown client ${l.clientId}`);
        if (l.jobId && !jobs.some((j) => j.id === l.jobId)) throw new Error(`seed: lead ${l.id} points at unknown job ${l.jobId}`);
      }
      const now = new Date().toISOString();
      const past = activity.filter((a) => a.at <= now).sort((a, b) => b.at.localeCompare(a.at));
      return { users: SAMPLE_USERS.map((u) => ({ ...u })), leads, clients, jobs, tasks, workers, workerPays, docs, activity: past, messages };
    },
  };
  return kit;
}
