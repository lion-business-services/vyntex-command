// Every change to business data goes through an action here, so the same change always
// writes the same history, updates the same totals and starts the same automations.
import type { Assignment, Client, DemoState, DocKind, DocRecord, Expense, Job, JobStatus, Lead, LeadStage, Note, NoteKind, Payment, Ref, Task, TaskStatus, Worker, WorkerPayment } from './types';
import { type Ctx, logActivity } from './context';
import { emit } from './automations';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';
import { money2, sum } from '@/lib/money';

const slugId = (prefix: string) => uid(prefix);

/* ---------- leads ---------- */
export function nextTicket(d: DemoState, ctx: Ctx): string {
  const n = d.leads.map((l) => parseInt(String(l.ticket).replace(/\D/g, ''), 10) || 0);
  return ctx.pack.ticketPrefix + (Math.max(1000, ...n) + 1);
}
export function createLead(d: DemoState, ctx: Ctx, input: Omit<Lead, 'id' | 'ticket' | 'created' | 'notes' | 'status'> & { firstNote?: string; status?: LeadStage }): Lead {
  const { firstNote, ...rest } = input;
  const lead: Lead = { ...rest, id: slugId('l'), ticket: nextTicket(d, ctx), created: today(), status: input.status ?? 'new', notes: [] };
  if (firstNote) lead.notes.push({ id: uid('n'), at: nowIso(), kind: 'note', text: firstNote, pin: true, by: ctx.actor });
  if (lead.apptDate && lead.status === 'new') lead.status = 'scheduled';
  d.leads.unshift(lead);
  logActivity(d, ctx.actor, 'lead.created', { type: 'lead', id: lead.id }, { lead: lead.name, source: ctx.t('src_' + lead.source) });
  emit(d, ctx, { type: 'lead.created', lead });
  if (lead.status === 'scheduled') emit(d, ctx, { type: 'lead.stage', lead, from: 'new' });
  return lead;
}
export function updateLead(d: DemoState, ctx: Ctx, id: string, patch: Partial<Lead>) {
  const l = d.leads.find((x) => x.id === id); if (!l) return;
  const before = l.status;
  Object.assign(l, patch);
  if (patch.apptDate && (l.status === 'new' || l.status === 'contacted')) l.status = 'scheduled';
  if (l.status !== before) stageChanged(d, ctx, l, before);
}
function stageChanged(d: DemoState, ctx: Ctx, l: Lead, from: string) {
  logActivity(d, ctx.actor, l.status === 'lost' ? 'lead.lost' : 'lead.stage', { type: 'lead', id: l.id }, { stage: ctx.t('ls_' + l.status) });
  emit(d, ctx, { type: 'lead.stage', lead: l, from });
}
export function setLeadStage(d: DemoState, ctx: Ctx, id: string, stage: LeadStage) {
  const l = d.leads.find((x) => x.id === id); if (!l || l.status === stage) return;
  if (stage === 'won') { convertLead(d, ctx, id); return; }
  const from = l.status; l.status = stage; stageChanged(d, ctx, l, from);
}
export function deleteLead(d: DemoState, _ctx: Ctx, id: string) {
  d.leads = d.leads.filter((l) => l.id !== id); d.tasks = d.tasks.filter((t) => t.leadId !== id);
}
/** Finds the client a lead belongs to (same name, or same email or phone) or creates the record. */
function clientForLead(d: DemoState, ctx: Ctx, l: Lead): Client {
  const hit = d.clients.find((c) => c.name.toLowerCase() === l.name.toLowerCase() || (!!l.email && c.email.toLowerCase() === l.email.toLowerCase()) || (!!l.phone && c.phone === l.phone));
  if (hit) { if (l.address && !hit.addresses.includes(l.address)) hit.addresses.push(l.address); return hit; }
  const c: Client = { id: slugId('c'), name: l.name, company: l.company, phone: l.phone, email: l.email, addresses: l.address ? [l.address] : [], since: today(), notes: [] };
  d.clients.unshift(c);
  logActivity(d, 'automation', 'client.created', { type: 'client', id: c.id });
  return c;
}
/** Won lead: creates (or links) the client and the job, carries the notes over and starts the kickoff workflow. */
export function convertLead(d: DemoState, ctx: Ctx, id: string): Job | null {
  const l = d.leads.find((x) => x.id === id); if (!l) return null;
  if (l.jobId) return d.jobs.find((j) => j.id === l.jobId) ?? null;
  const client = clientForLead(d, ctx, l);
  const job = blankJob(d, ctx, { name: ctx.t('ty_' + l.type), clientId: client.id, address: l.address, type: l.type, price: Number(l.value) || 0, status: 'contract', managerId: l.ownerId, leadId: l.id });
  job.notes = l.notes.map((n) => ({ ...n, id: uid('n') }));
  d.jobs.unshift(job);
  const from = l.status; l.status = 'won'; l.clientId = client.id; l.jobId = job.id;
  logActivity(d, ctx.actor, 'lead.won', { type: 'lead', id: l.id }, undefined, [{ type: 'client', id: client.id }]);
  logActivity(d, ctx.actor, 'job.created', { type: 'job', id: job.id }, { job: job.name }, [{ type: 'client', id: client.id }]);
  void from;
  emit(d, ctx, { type: 'lead.won', lead: l, job });
  return job;
}

/* ---------- notes ---------- */
export function addNote(d: DemoState, ctx: Ctx, ref: Ref, kind: NoteKind, text: string, pin = false) {
  const owner: { notes: Note[] } | undefined = ref.type === 'lead' ? d.leads.find((x) => x.id === ref.id) : ref.type === 'job' ? d.jobs.find((x) => x.id === ref.id) : ref.type === 'client' ? d.clients.find((x) => x.id === ref.id) : undefined;
  if (!owner || !text.trim()) return;
  owner.notes.unshift({ id: uid('n'), at: nowIso(), kind, text: text.trim(), pin, by: ctx.actor });
  logActivity(d, ctx.actor, 'note.added', ref, { text: text.trim().slice(0, 80) });
}
export function deleteNote(d: DemoState, _ctx: Ctx, ref: Ref, noteId: string) {
  const owner: { notes: Note[] } | undefined = ref.type === 'lead' ? d.leads.find((x) => x.id === ref.id) : ref.type === 'job' ? d.jobs.find((x) => x.id === ref.id) : d.clients.find((x) => x.id === ref.id);
  if (owner) owner.notes = owner.notes.filter((n) => n.id !== noteId);
}

/* ---------- clients ---------- */
export function saveClient(d: DemoState, ctx: Ctx, input: Partial<Client> & { name: string }, id?: string): Client {
  if (id) { const c = d.clients.find((x) => x.id === id)!; Object.assign(c, input); return c; }
  const c: Client = { id: slugId('c'), phone: '', email: '', addresses: [], since: today(), notes: [], ...input };
  d.clients.unshift(c); logActivity(d, ctx.actor, 'client.created', { type: 'client', id: c.id });
  return c;
}

/* ---------- jobs ---------- */
export function nextJobNumber(d: DemoState, ctx: Ctx): string {
  const n = d.jobs.map((j) => parseInt(String(j.number).replace(/\D/g, ''), 10) || 0);
  return `${ctx.pack.ticketPrefix}J-${Math.max(1000, ...n) + 1}`;
}
function blankJob(d: DemoState, ctx: Ctx, o: Partial<Job> & { name: string; clientId: string }): Job {
  return { id: slugId('j'), number: nextJobNumber(d, ctx), address: '', type: ctx.pack.serviceTypes[0].id, status: 'estimate', price: 0, start: '', end: '', repeat: 'once', scope: '', payTerms: '', managerId: ctx.actor.startsWith('u') ? ctx.actor : d.users[0].id, assign: [], expenses: [], received: [], log: [], notes: [], created: today(), ...o };
}
export function createJob(d: DemoState, ctx: Ctx, o: Partial<Job> & { name: string; clientId: string }): Job {
  const job = blankJob(d, ctx, o); d.jobs.unshift(job);
  logActivity(d, ctx.actor, 'job.created', { type: 'job', id: job.id }, { job: job.name }, [{ type: 'client', id: job.clientId }]);
  if (job.status === 'progress' || job.status === 'done') emit(d, ctx, { type: 'job.status', job, from: 'estimate' });
  return job;
}
export function updateJob(d: DemoState, ctx: Ctx, id: string, patch: Partial<Job>) {
  const j = d.jobs.find((x) => x.id === id); if (!j) return;
  const from = j.status; Object.assign(j, patch);
  if (patch.status && patch.status !== from) statusChanged(d, ctx, j, from);
}
function statusChanged(d: DemoState, ctx: Ctx, j: Job, from: JobStatus) {
  logActivity(d, ctx.actor, 'job.status', { type: 'job', id: j.id }, { status: ctx.t('st_' + j.status) }, [{ type: 'client', id: j.clientId }]);
  emit(d, ctx, { type: 'job.status', job: j, from });
}
export function setJobStatus(d: DemoState, ctx: Ctx, id: string, status: JobStatus) {
  const j = d.jobs.find((x) => x.id === id); if (!j || j.status === status) return;
  const from = j.status; j.status = status; statusChanged(d, ctx, j, from);
}
export function deleteJob(d: DemoState, _ctx: Ctx, id: string) {
  d.jobs = d.jobs.filter((j) => j.id !== id); d.tasks = d.tasks.filter((t) => t.jobId !== id);
  d.docs = d.docs.filter((x) => x.jobId !== id); d.workerPays = d.workerPays.filter((p) => p.jobId !== id);
}
export function saveAssignment(d: DemoState, ctx: Ctx, jobId: string, a: Omit<Assignment, 'id'>, id?: string) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  if (id) { const cur = j.assign.find((x) => x.id === id); if (cur) Object.assign(cur, a); return; }
  j.assign.push({ ...a, id: uid('as') });
  const w = d.workers.find((x) => x.id === a.workerId);
  logActivity(d, ctx.actor, 'worker.assigned', { type: 'job', id: jobId }, { worker: w?.name ?? '', scope: a.scope }, [{ type: 'worker', id: a.workerId }]);
}
export function removeFromJob(d: DemoState, _ctx: Ctx, jobId: string, coll: 'assign' | 'expenses' | 'received' | 'log', id: string) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  (j as any)[coll] = (j[coll] as { id: string }[]).filter((x) => x.id !== id);
  // taking a client payment back reopens an invoice that was marked paid
  if (coll === 'received') {
    const inv = d.docs.find((x) => x.jobId === jobId && x.kind === 'invoice' && x.status === 'paid');
    if (inv && j.price - sum(j.received, (r) => r.amount) > 0.005) { inv.status = 'sent'; inv.updated = today(); }
  }
}
export function addExpense(d: DemoState, ctx: Ctx, jobId: string, e: Omit<Expense, 'id'>) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  j.expenses.push({ ...e, id: uid('e') });
  logActivity(d, ctx.actor, 'expense.added', { type: 'job', id: jobId }, { desc: e.desc, amount: money2(e.amount) });
}
export function addClientPayment(d: DemoState, ctx: Ctx, jobId: string, p: Omit<Payment, 'id'>) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return;
  j.received.push({ ...p, id: uid('r') });
  logActivity(d, ctx.actor, 'payment.received', { type: 'job', id: jobId }, { amount: money2(p.amount), job: j.name }, [{ type: 'client', id: j.clientId }]);
  emit(d, ctx, { type: 'payment.received', job: j, amount: p.amount });
}
export function addWorkLog(d: DemoState, _ctx: Ctx, jobId: string, workerId: string, text: string) {
  const j = d.jobs.find((x) => x.id === jobId); if (!j || !text.trim()) return;
  j.log.unshift({ id: uid('g'), date: today(), workerId, text: text.trim() });
}

/* ---------- workers ---------- */
export function saveWorker(d: DemoState, ctx: Ctx, input: Omit<Worker, 'id'>, id?: string): Worker {
  if (id) { const w = d.workers.find((x) => x.id === id)!; Object.assign(w, input); return w; }
  const w: Worker = { ...input, id: slugId('w'), active: true };
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

/* ---------- tasks ---------- */
export function createTask(d: DemoState, ctx: Ctx, input: Omit<Task, 'id' | 'created' | 'status'> & { status?: TaskStatus }): Task {
  const t: Task = { status: 'todo', ...input, id: slugId('t'), created: today() };
  d.tasks.unshift(t);
  const ref: Ref = t.jobId ? { type: 'job', id: t.jobId } : t.leadId ? { type: 'lead', id: t.leadId } : { type: 'task', id: t.id };
  logActivity(d, ctx.actor, 'task.created', ref, { task: t.title });
  return t;
}
export function updateTask(d: DemoState, ctx: Ctx, id: string, patch: Partial<Task>) {
  const t = d.tasks.find((x) => x.id === id); if (!t) return;
  const from = t.status; Object.assign(t, patch);
  if (t.status !== from) {
    t.doneAt = t.status === 'done' ? today() : undefined;
    const ref: Ref = t.jobId ? { type: 'job', id: t.jobId } : t.leadId ? { type: 'lead', id: t.leadId } : { type: 'task', id: t.id };
    if (t.status === 'done') logActivity(d, ctx.actor, 'task.done', ref, { task: t.title });
    else logActivity(d, ctx.actor, 'task.status', ref, { task: t.title, status: ctx.t('ts.' + t.status) });
  }
}
export const setTaskStatus = (d: DemoState, ctx: Ctx, id: string, status: TaskStatus) => updateTask(d, ctx, id, { status });
export function toggleTask(d: DemoState, ctx: Ctx, id: string) { const t = d.tasks.find((x) => x.id === id); if (t) updateTask(d, ctx, id, { status: t.status === 'done' ? 'todo' : 'done' }); }
export function deleteTask(d: DemoState, _ctx: Ctx, id: string) { d.tasks = d.tasks.filter((t) => t.id !== id); }

/* ---------- documents ---------- */
export function createDoc(d: DemoState, ctx: Ctx, jobId: string, kind: DocKind): DocRecord | null {
  const j = d.jobs.find((x) => x.id === jobId); if (!j) return null;
  const existing = d.docs.find((x) => x.jobId === jobId && x.kind === kind && x.status !== 'void'); if (existing) return existing;
  const code = kind === 'contract' ? 'C' : kind === 'invoice' ? 'INV' : 'EST';
  // next free number for this kind of document (highest in use + 1)
  const n = Math.max(1000, ...d.docs.filter((x) => x.kind === kind).map((x) => parseInt(x.number.split('-').pop() || '', 10) || 0)) + 1;
  const doc: DocRecord = { id: slugId('d'), kind, number: `${ctx.pack.ticketPrefix}${code}-${n}`, title: j.name, jobId, clientId: j.clientId, status: 'draft', created: today(), updated: today() };
  d.docs.unshift(doc);
  logActivity(d, ctx.actor, 'doc.created', { type: 'job', id: jobId }, { doc: ctx.t('doc.kind.' + kind) }, [{ type: 'client', id: j.clientId }]);
  return doc;
}
export function saveDocEdits(d: DemoState, ctx: Ctx, docId: string, edits: Record<string, string> | undefined) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  doc.edits = edits && Object.keys(edits).length ? edits : undefined; doc.updated = today();
  if (edits) logActivity(d, ctx.actor, 'doc.edited', { type: 'job', id: doc.jobId }, { doc: ctx.t('doc.kind.' + doc.kind) });
}
/** Demo e-signature: records the request and its status changes. No legal signature takes place in demo mode. */
export function sendForSignature(d: DemoState, ctx: Ctx, docId: string, signerName: string, signerEmail: string) {
  const doc = d.docs.find((x) => x.id === docId); if (!doc) return;
  doc.esign = { demo: true, signerName, signerEmail, status: 'sent', sentAt: nowIso() }; doc.status = 'sent'; doc.updated = today();
  logActivity(d, ctx.actor, 'doc.sent', { type: 'job', id: doc.jobId }, { doc: ctx.t('doc.kind.' + doc.kind) }, [{ type: 'client', id: doc.clientId }]);
}
export function advanceSignature(d: DemoState, ctx: Ctx, docId: string, to: 'viewed' | 'signed') {
  const doc = d.docs.find((x) => x.id === docId); if (!doc || !doc.esign) return;
  if (to === 'viewed') { doc.esign.status = 'viewed'; doc.esign.viewedAt = nowIso(); doc.status = 'viewed'; }
  else {
    doc.esign.status = 'signed'; doc.esign.signedAt = nowIso(); if (!doc.esign.viewedAt) doc.esign.viewedAt = doc.esign.signedAt; doc.status = 'signed';
    logActivity(d, 'system', 'doc.signed', { type: 'job', id: doc.jobId }, { doc: ctx.t('doc.kind.' + doc.kind) }, [{ type: 'client', id: doc.clientId }]);
    const j = d.jobs.find((x) => x.id === doc.jobId);
    if (j && doc.kind === 'contract' && j.status === 'contract') setJobStatus(d, ctx, j.id, 'progress');
  }
  doc.updated = today();
}
export function setDocStatus(d: DemoState, _ctx: Ctx, docId: string, status: DocRecord['status']) { const doc = d.docs.find((x) => x.id === docId); if (doc) { doc.status = status; doc.updated = today(); } }

/* ---------- start of day ---------- */
export function runDaily(d: DemoState, ctx: Ctx) { emit(d, ctx, { type: 'daily' }); }
