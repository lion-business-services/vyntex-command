// Tasks: things one person has to do, tied to a job, a lead, a client, or nothing.
// A client request is a task with its own type: it also records who asked and how the request arrived.
// People talk about a task in its comments; writing @Name tells that person (see notices() in ../selectors).
import type { DemoState, ISODate, MessageChannel, Priority, Ref, Task, TaskComment, TaskStatus, TeamUser } from '../types';
import { type Ctx, logActivity } from '../context';
import { CLIENT_REQUEST } from '../selectors';
import { nowIso, today } from '@/lib/dates';
import { uid } from '@/lib/id';

const refOf = (t: Task): Ref => (t.jobId ? { type: 'job', id: t.jobId } : t.leadId ? { type: 'lead', id: t.leadId } : t.clientId ? { type: 'client', id: t.clientId } : { type: 'task', id: t.id });
/** The client's page shows the history of work done for them, so a task on one of their engagements appears there too. */
const alsoOf = (t: Task): Ref[] | undefined => (t.jobId && t.clientId ? [{ type: 'client', id: t.clientId }] : undefined);

export function createTask(d: DemoState, ctx: Ctx, input: Omit<Task, 'id' | 'created' | 'status'> & { status?: TaskStatus }): Task {
  const t: Task = { status: 'todo', ...input, id: uid('t'), created: today() };
  d.tasks.unshift(t);
  logActivity(d, ctx.actor, 'task.created', refOf(t), { task: t.title });
  return t;
}
export function updateTask(d: DemoState, ctx: Ctx, id: string, patch: Partial<Task>) {
  const t = d.tasks.find((x) => x.id === id); if (!t) return;
  const from = t.status; Object.assign(t, patch);
  if (t.status !== from) {
    t.doneAt = t.status === 'done' ? today() : undefined;
    if (t.status === 'done') logActivity(d, ctx.actor, 'task.done', refOf(t), { task: t.title });
    else logActivity(d, ctx.actor, 'task.status', refOf(t), { task: t.title, status: ctx.t('ts.' + t.status) });
  }
}
export const setTaskStatus = (d: DemoState, ctx: Ctx, id: string, status: TaskStatus) => updateTask(d, ctx, id, { status });
export function toggleTask(d: DemoState, ctx: Ctx, id: string) { const t = d.tasks.find((x) => x.id === id); if (t) updateTask(d, ctx, id, { status: t.status === 'done' ? 'todo' : 'done' }); }
export function deleteTask(d: DemoState, _ctx: Ctx, id: string) { d.tasks = d.tasks.filter((t) => t.id !== id); }

/* ---------- client requests ---------- */
export interface ClientRequestInput {
  /** What the client asked for. */
  title: string;
  clientId: string;
  /** The person who asked: the client, or someone who speaks for them. */
  requestedBy: string;
  /** How the request arrived. */
  channel: MessageChannel;
  description?: string;
  /** `u:<TeamUser id>`. Left out, the request goes to whoever looks after the client, or to the person recording it. */
  assignee?: string;
  due?: ISODate;
  pri?: Priority;
  jobId?: string;
  /** The appointment the request came up in. */
  apptId?: string;
}
/**
 * Records something a client asked for. Call it from wherever the request arrives: the client's page, a message, an
 * appointment. Returns null when the client does not exist or nothing was asked.
 */
export function createClientRequest(d: DemoState, ctx: Ctx, input: ClientRequestInput): Task | null {
  const client = d.clients.find((c) => c.id === input.clientId);
  const title = input.title.trim();
  if (!client || !title) return null;
  const t: Task = {
    id: uid('t'), title, description: input.description?.trim() || undefined, type: CLIENT_REQUEST, clientId: client.id, jobId: input.jobId || undefined, apptId: input.apptId || undefined,
    requestedBy: input.requestedBy.trim() || client.name, channel: input.channel,
    assignee: input.assignee || 'u:' + (client.assignedTo && d.users.some((u) => u.id === client.assignedTo && u.active !== false) ? client.assignedTo : ctx.actor),
    due: input.due || undefined, pri: input.pri ?? 'medium', status: 'todo', created: today(),
  };
  d.tasks.unshift(t);
  logActivity(d, ctx.actor, 'task.request', { type: 'client', id: client.id }, { task: t.title, who: t.requestedBy ?? '' }, t.jobId ? [{ type: 'job', id: t.jobId }] : undefined);
  return t;
}

/* ---------- comments and mentions ---------- */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * The team members a text mentions. "@Daniel Okafor" and "@Daniel" both reach Daniel; a first name two people share
 * only counts when the full name is written. Accents and capitals do not matter.
 */
export function mentionsIn(users: TeamUser[], text: string): string[] {
  const hay = plain(text); if (!hay.includes('@')) return [];
  const active = users.filter((u) => u.active !== false);
  const firstOf = (u: TeamUser) => plain(u.name).split(/\s+/)[0];
  const at = (name: string) => new RegExp('@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(hay);
  return active.filter((u) => at(plain(u.name)) || (active.filter((o) => firstOf(o) === firstOf(u)).length === 1 && at(firstOf(u)))).map((u) => u.id);
}
/** Adds a comment to a task. People written as @Name are recorded as mentioned and find it in their notifications. */
export function addTaskComment(d: DemoState, ctx: Ctx, taskId: string, text: string): TaskComment | null {
  const t = d.tasks.find((x) => x.id === taskId); const body = text.trim();
  if (!t || !body) return null;
  const mentions = mentionsIn(d.users, body);
  const c: TaskComment = { id: uid('tc'), at: nowIso(), by: ctx.actor, text: body, ...(mentions.length ? { mentions } : {}) };
  t.comments = [...(t.comments ?? []), c];
  logActivity(d, ctx.actor, 'task.comment', refOf(t), { task: t.title }, alsoOf(t));
  return c;
}
/** Changes the text of a comment. Only its author may. The change is kept in the history. */
export function editTaskComment(d: DemoState, ctx: Ctx, taskId: string, commentId: string, text: string): boolean {
  const t = d.tasks.find((x) => x.id === taskId); const c = t?.comments?.find((x) => x.id === commentId); const body = text.trim();
  if (!t || !c || !body || c.by !== ctx.actor) return false;
  const mentions = mentionsIn(d.users, body);
  c.text = body; if (mentions.length) c.mentions = mentions; else delete c.mentions;
  logActivity(d, ctx.actor, 'task.comment.edited', refOf(t), { task: t.title }, alsoOf(t));
  return true;
}
/** Removes a comment: its author, or the owner or a manager. */
export function deleteTaskComment(d: DemoState, ctx: Ctx, taskId: string, commentId: string): boolean {
  const t = d.tasks.find((x) => x.id === taskId); const c = t?.comments?.find((x) => x.id === commentId);
  const role = d.users.find((u) => u.id === ctx.actor)?.role;
  if (!t || !c || !(c.by === ctx.actor || role === 'owner' || role === 'manager')) return false;
  t.comments = (t.comments ?? []).filter((x) => x.id !== commentId);
  logActivity(d, ctx.actor, 'task.comment.deleted', refOf(t), { task: t.title }, alsoOf(t));
  return true;
}

/* ---------- handing work over ---------- */
/** Gives several tasks to one person at once. Completed tasks stay with whoever did them. Returns how many moved. */
export function reassignTasks(d: DemoState, ctx: Ctx, ids: string[], assignee: string): number {
  const who = assignee.startsWith('w:') ? d.workers.find((w) => w.id === assignee.slice(2))?.name : d.users.find((u) => u.id === assignee.slice(2))?.name;
  if (!who) return 0;
  let n = 0;
  for (const t of d.tasks) {
    if (!ids.includes(t.id) || t.status === 'done' || t.assignee === assignee) continue;
    t.assignee = assignee; n++;
    logActivity(d, ctx.actor, 'task.reassigned', refOf(t), { task: t.title, who }, alsoOf(t));
  }
  return n;
}
