// "Today at a glance" of the professional-services home screen: eight counts for the person looking (or for the whole
// firm), each with the exact records it counted, so a number always opens the list behind it. No React here.
// Records of a client the person may not open are left out of both the count and the list.
import type { DemoState, Lang, TeamUser } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import type { IndustryPack } from '@/packs/types';
import { pick, type TFn } from '@/i18n';
import { moduleOn, openLeads } from '@/domain/config';
import { visibleClientIds, visibleLeads } from '@/domain/access';
import { CLIENT_REQUEST, assigneeName, byId, isCancelledAppt, isDueToday, isOpenTask, isOverdue, openBalances, openDeadlines, requestAge, total } from '@/domain/selectors';
import { addDays, relDay, today } from '@/lib/dates';
import { money2 } from '@/lib/money';

export type GlanceId = 'appts' | 'tasks' | 'requests' | 'leads' | 'signatures' | 'deadlines' | 'unpaid' | 'balances';
export interface GlanceRow { id: string; title: string; sub?: string; meta?: string; tone?: 'bad' | 'warn'; to: string }
export interface GlanceTile {
  id: GlanceId;
  count: number;
  /** Money behind the count, for the two money tiles. */
  amount?: number;
  rows: GlanceRow[];
  /** The screen that holds the full list. */
  more: string;
}
export interface GlanceEnv {
  data: DemoState; pack: IndustryPack; t: TFn; lang: Lang; can: (p: Permission) => boolean; perms: Permission[]; user: TeamUser | undefined;
  /** `mine`: what the person is responsible for. `firm`: everyone's. */
  scope: 'mine' | 'firm';
  date: (d: string | undefined) => string; time: (hhmm: string | undefined) => string;
}
/** How far ahead "deadlines this week" looks. */
export const DEADLINE_DAYS = 7;

export function glance(env: GlanceEnv): GlanceTile[] {
  const { data, pack, t, lang, can, perms, user, scope, date, time } = env;
  const td = today(); const me = user?.id; const mineOnly = scope === 'mine';
  const on = (m: Parameters<typeof moduleOn>[2]) => moduleOn(data, pack, m);
  const seen = visibleClientIds(data, user, perms);
  const ok = (clientId: string | undefined) => !clientId || seen.has(clientId);
  const clientName = (id: string | undefined) => byId(data.clients, id)?.name ?? '';
  const who = (userId: string | undefined) => (mineOnly ? '' : byId(data.users, userId)?.name ?? '');
  const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');
  const out: GlanceTile[] = [];

  // 1. appointments today
  if (on('appointments') && can('appointments')) {
    const list = (data.appointments ?? []).filter((a) => a.date === td && !isCancelledAppt(a) && ok(a.clientId) && (!mineOnly || a.staffId === me)).sort((a, b) => a.time.localeCompare(b.time));
    out.push({ id: 'appts', count: list.length, more: '/appointments', rows: list.map((a) => {
      const type = byId(data.apptTypes, a.typeId);
      return { id: a.id, title: clientName(a.clientId) || byId(data.leads, a.leadId)?.name || t('dash.p.noName'), sub: join(type ? pick(type.name, lang) : '', who(a.staffId)), meta: time(a.time), tone: a.status === 'awaiting_payment' ? 'warn' as const : undefined, to: `/appointments/${a.id}` };
    }) });
  }

  // 2. tasks due today or already late
  if (on('tasks') && can('tasks')) {
    const visible = data.tasks.filter((x) => ok(x.clientId ?? byId(data.jobs, x.jobId)?.clientId));
    const due = visible.filter((x) => (isOverdue(x) || isDueToday(x)) && (!mineOnly || x.assignee === 'u:' + me)).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
    out.push({ id: 'tasks', count: due.length, more: mineOnly ? '/tasks?view=list&who=me&due=now' : '/tasks?view=list&due=now', rows: due.map((x) => (
      { id: x.id, title: x.title, sub: join(clientName(x.clientId ?? byId(data.jobs, x.jobId)?.clientId), byId(data.jobs, x.jobId)?.name, !mineOnly && assigneeName(data, x.assignee)), meta: isOverdue(x) ? relDay(x.due as string, lang) : t('common.today'), tone: isOverdue(x) ? 'bad' as const : undefined, to: `/tasks?task=${x.id}` })) });

    // 3. client requests waiting for an answer
    if (pack.taskTypes.some((o) => o.id === CLIENT_REQUEST) || data.config.taskTypes?.some((o) => o.id === CLIENT_REQUEST)) {
      const reqs = visible.filter((x) => x.type === CLIENT_REQUEST && isOpenTask(x) && (!mineOnly || x.assignee === 'u:' + me)).sort((a, b) => a.created.localeCompare(b.created));
      out.push({ id: 'requests', count: reqs.length, more: mineOnly ? '/tasks?view=requests&who=me' : '/tasks?view=requests', rows: reqs.map((x) => {
        const age = requestAge(x);
        return { id: x.id, title: x.title, sub: join(clientName(x.clientId), x.requestedBy && x.requestedBy !== clientName(x.clientId) ? x.requestedBy : '', !mineOnly && assigneeName(data, x.assignee)), meta: t(age === 1 ? 'tasks.req.day' : 'tasks.req.days', { n: age }), tone: isOverdue(x) || age >= 5 ? 'bad' as const : age >= 2 ? 'warn' as const : undefined, to: `/tasks?task=${x.id}` };
      }) });
    }
  }

  // 4. leads with no next step, or with one that is due
  if (on('leads') && can('leads')) {
    const mayOpen = new Set(visibleLeads(data, user, perms).map((l) => l.id));
    const need = openLeads(data).filter((l) => mayOpen.has(l.id) && (!mineOnly || l.ownerId === me)).map((l) => {
      const due = l.nextAction?.due ?? l.followUp;
      return { l, due, none: !l.nextAction && !l.followUp, late: !!due && due <= td };
    }).filter((x) => x.none || x.late).sort((a, b) => (a.due ?? '0').localeCompare(b.due ?? '0'));
    out.push({ id: 'leads', count: need.length, more: '/leads', rows: need.map(({ l, due, none }) => (
      { id: l.id, title: l.name, sub: join(none ? t('dash.p.noNext') : l.nextAction?.text ?? t('dash.p.followUp'), who(l.ownerId)), meta: none ? '' : due === td ? t('common.today') : relDay(due as string, lang), tone: none ? 'warn' as const : due && due < td ? 'bad' as const : undefined, to: `/leads/${l.id}` })) });
  }

  // 5. documents out for signature
  if ((on('esign') && can('esign')) || (on('documents') && can('documents'))) {
    const rows: GlanceRow[] = [];
    const inEnvelope = new Set<string>();
    for (const e of data.envelopes ?? []) {
      if (e.status !== 'sent' && e.status !== 'partly_signed') continue;
      const doc = byId(data.docs, e.docId); inEnvelope.add(e.docId);
      if (!ok(doc?.clientId) || (mineOnly && e.createdBy !== me)) continue;
      const signed = e.signers.filter((s) => s.status === 'signed').length;
      rows.push({ id: e.id, title: e.title, sub: join(clientName(doc?.clientId), t('dash.p.signed', { n: signed, total: e.signers.length })), meta: e.sentAt ? date(e.sentAt.slice(0, 10)) : '', to: on('esign') && can('esign') ? `/esign/${e.id}` : `/documents/${e.docId}` });
    }
    for (const d of data.docs) {
      if (inEnvelope.has(d.id) || d.envelopeId || !d.esign || (d.esign.status !== 'sent' && d.esign.status !== 'viewed') || !ok(d.clientId)) continue;
      if (mineOnly && byId(data.jobs, d.jobId)?.managerId !== me && byId(data.clients, d.clientId)?.assignedTo !== me) continue;
      rows.push({ id: d.id, title: `${t('doc.kind.' + d.kind)} ${d.number}`, sub: join(clientName(d.clientId), d.title), meta: date(d.esign.sentAt.slice(0, 10)), to: `/documents/${d.id}` });
    }
    out.push({ id: 'signatures', count: rows.length, more: on('esign') && can('esign') ? '/esign' : '/documents', rows });
  }

  // 6. deadlines late or due within the week
  if (on('deadlines') && can('deadlines')) {
    const until = addDays(DEADLINE_DAYS);
    const list = openDeadlines(data).filter((i) => i.due <= until && ok(i.clientId) && (!mineOnly || i.assignee === me));
    out.push({ id: 'deadlines', count: list.length, more: mineOnly ? '/deadlines?who=me' : '/deadlines', rows: list.map((i) => (
      { id: i.id, title: i.title, sub: join(clientName(i.clientId) || t('deadlines.firm'), who(i.assignee)), meta: i.due === td ? t('common.today') : relDay(i.due, lang), tone: i.due < td ? 'bad' as const : undefined, to: `/deadlines/${i.id}` })) });
  }

  if (on('payments') && can('money')) {
    // 7. appointments booked and not paid yet
    if (on('appointments') && can('appointments')) {
      const list = (data.appointments ?? []).filter((a) => a.status === 'awaiting_payment' && ok(a.clientId) && (!mineOnly || a.staffId === me)).sort((a, b) => (a.payBy ?? a.date).localeCompare(b.payBy ?? b.date));
      out.push({ id: 'unpaid', count: list.length, amount: total(list, (a) => a.fee), more: '/payments?tab=appointments', rows: list.map((a) => (
        { id: a.id, title: clientName(a.clientId) || byId(data.leads, a.leadId)?.name || t('dash.p.noName'), sub: join(`${date(a.date)} ${time(a.time)}`, a.payBy ? t('dash.p.payBy', { date: date(a.payBy.slice(0, 10)) }) : '', who(a.staffId)), meta: money2(a.fee), tone: a.payBy && a.payBy < new Date().toISOString() ? 'bad' as const : 'warn' as const, to: `/appointments/${a.id}` })) });
    }
    // 8. engagements with money still to collect
    const list = openBalances(data).filter((b) => ok(b.job.clientId) && (!mineOnly || b.job.managerId === me));
    out.push({ id: 'balances', count: list.length, amount: total(list, (b) => b.balance), more: '/payments?tab=balances', rows: list.map((b) => (
      { id: b.job.id, title: b.job.name, sub: join(b.client?.name, t('dash.p.openFor', { age: t(b.days === 1 ? 'tasks.req.day' : 'tasks.req.days', { n: b.days }) }), who(b.job.managerId)), meta: money2(b.balance), tone: b.bucket === 'd91' ? 'bad' as const : b.bucket === 'd61' ? 'warn' as const : undefined, to: `/jobs/${b.job.id}` })) });
  }
  return out;
}
