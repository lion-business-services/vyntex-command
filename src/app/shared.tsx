// Pieces every feature reuses so statuses, badges, notes and history look and behave the same everywhere.
import { useState, type ReactNode } from 'react';
import { LuPhone, LuMapPin, LuPin, LuTrash2, LuSparkles, LuFlaskConical, LuLock, LuPlug, LuZap } from 'react-icons/lu';
import { Badge, Button, Card, Empty, IconButton, Seg, type Tone, cx, confirmDialog } from '@/ui';
import { useApp } from './hooks';
import { A, refPath } from './router';
import { act } from '@/store/store';
import { addNote, deleteNote, toggleTask } from '@/domain/actions';
import { actorName, assigneeName, byId, insuranceState } from '@/domain/selectors';
import type { Activity, DocStatus, JobStatus, LeadStage, Note, NoteKind, Priority, Ref, Task, TaskStatus, Worker } from '@/domain/types';
import type { EntitlementId } from '@/domain/entitlements';
import { ADD_ONS, planName } from '@/lib/pricing';
import { addOnView } from '@/lib/pricing-view';
import { today } from '@/lib/dates';
import { money2 } from '@/lib/money';

const JOB_TONE: Record<JobStatus, Tone> = { estimate: 'neutral', contract: 'warn', progress: 'info', hold: 'violet', done: 'ok' };
const LEAD_TONE: Record<LeadStage, Tone> = { new: 'accent', contacted: 'info', scheduled: 'violet', sent: 'warn', won: 'ok', lost: 'neutral' };
const TASK_TONE: Record<TaskStatus, Tone> = { todo: 'neutral', doing: 'info', waiting: 'warn', review: 'violet', done: 'ok' };
const DOC_TONE: Record<DocStatus, Tone> = { draft: 'neutral', sent: 'warn', viewed: 'info', signed: 'ok', paid: 'ok', void: 'neutral' };

export function JobStatusBadge({ status }: { status: JobStatus }) { const { t } = useApp(); return <Badge tone={JOB_TONE[status]}>{t('st_' + status)}</Badge>; }
export function LeadStageBadge({ stage }: { stage: LeadStage }) { const { t } = useApp(); return <Badge tone={LEAD_TONE[stage]}>{t('ls_' + stage)}</Badge>; }
export function TaskStatusBadge({ status }: { status: TaskStatus }) { const { t } = useApp(); return <Badge tone={TASK_TONE[status]}>{t('ts.' + status)}</Badge>; }
export function DocStatusBadge({ status }: { status: DocStatus }) { const { t } = useApp(); return <Badge tone={DOC_TONE[status]}>{t('doc.status.' + status)}</Badge>; }
export const leadTone = (s: LeadStage) => LEAD_TONE[s];
export const taskTone = (s: TaskStatus) => TASK_TONE[s];

export function PriorityBadge({ pri, always }: { pri: Priority; always?: boolean }) {
  const { t } = useApp();
  if (pri === 'medium' && !always) return null;
  return <Badge tone={pri === 'high' ? 'bad' : pri === 'low' ? 'neutral' : 'info'} outline={pri !== 'high'}>{t('pr.' + pri)}</Badge>;
}
export function DueBadge({ due, done }: { due?: string; done?: boolean }) {
  const { t, date } = useApp();
  if (!due) return null;
  const late = !done && due < today(); const now = !done && due === today();
  return <span className={cx('small nowrap', late ? 'neg strong' : now ? 'strong' : 'muted')} style={now ? { color: 'var(--warn)' } : undefined}>{late ? `${t('common.overdue')} · ${date(due)}` : now ? t('dueToday') : date(due)}</span>;
}
export function W9Badge({ worker }: { worker: Worker }) { const { t } = useApp(); return worker.w9 ? <Badge tone="ok">{t('onFile')}</Badge> : <Badge tone="bad">{t('missing')}</Badge>; }
export function InsuranceBadge({ worker }: { worker: Worker }) {
  const { t, date } = useApp(); const s = insuranceState(worker);
  if (s === 'missing') return <Badge tone="bad">{t('missing')}</Badge>;
  return <Badge tone={s === 'expired' ? 'bad' : s === 'soon' ? 'warn' : 'ok'}>{t(s === 'expired' ? 'expired' : 'expires')} {date(worker.coiExp)}</Badge>;
}

/** Shows how a capability is sold for the plan being previewed: included, from a higher plan, add-on, usage-based, custom quote or preview. */
export function PlanBadge({ feature, detail }: { feature: EntitlementId; detail?: boolean }) {
  const { t, standing, lang, planLabel, pack } = useApp();
  const s = standing(feature);
  const addOn = ADD_ONS.find((a) => a.id === s.addOnId);
  const view = addOn ? addOnView(addOn, pack.id, lang, t) : null;
  const price = view?.price ? ` · ${view.price}${view.billing ? ' ' + view.billing.split(',')[0] : ''}` : '';
  switch (s.state) {
    case 'included': return <Badge tone="ok" title={t('ent.inPlan', { plan: planLabel })}>{detail ? t('ent.inPlan', { plan: planLabel }) : t('ent.included')}</Badge>;
    case 'upgrade': return <Badge tone="warn" title={t('ent.upgradeHint', { plan: planName(s.plan!, lang) })}><LuLock aria-hidden="true" />{t('ent.fromPlan', { plan: planName(s.plan!, lang) })}</Badge>;
    case 'addon': return <Badge tone="violet">{t('ent.addon')}{detail ? price : ''}</Badge>;
    case 'usage': return <Badge tone="info">{t('ent.usage')}{detail ? price : ''}</Badge>;
    case 'custom': return <Badge tone="violet" outline>{t('ent.custom')}</Badge>;
    default: return <Badge tone="accent" outline><LuFlaskConical aria-hidden="true" />{t('ent.preview')}</Badge>;
  }
}
/** Marks something that only happens for show in the demo (an email "sent", a signature, an AI answer). */
export function DemoTag({ kind = 'simulation' }: { kind?: 'simulation' | 'connect' | 'preview' }) {
  const { t } = useApp();
  return <Badge tone="accent" outline title={t('demo.simNote')}>{kind === 'connect' ? <LuPlug aria-hidden="true" /> : <LuSparkles aria-hidden="true" />}{t(kind === 'connect' ? 'demo.connect' : kind === 'preview' ? 'demo.preview' : 'demo.simulation')}</Badge>;
}

export function NoAccess() {
  const { t } = useApp();
  return <Card><Empty title={t('common.noPermission')}>{t('common.noPermissionHint')}</Empty></Card>;
}

export function ContactLinks({ phone, address }: { phone?: string; address?: string }) {
  const { t } = useApp();
  return (
    <span className="row tight">
      {phone && <a className="btn sm" href={`tel:${phone.replace(/[^0-9+]/g, '')}`}><LuPhone aria-hidden="true" />{t('common.call')}</a>}
      {address && <a className="btn sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer"><LuMapPin aria-hidden="true" />{t('common.directions')}</a>}
    </span>
  );
}

/* ---------- activity timeline ---------- */
const MONEY_ACTIVITY = ['payment.received', 'worker.paid', 'expense.added', 'invoice.paid'];
export function ActivityList({ items, limit = 12, linkRecords }: { items: Activity[]; limit?: number; linkRecords?: boolean }) {
  const { t, data, dateTime, can } = useApp();
  const [all, setAll] = useState(false);
  // entries that state amounts are only for roles that may see money
  if (!can('money')) items = items.filter((a) => !MONEY_ACTIVITY.includes(a.kind));
  if (!items.length) return <p className="muted small">{t('common.noActivity')}</p>;
  const shown = all ? items : items.slice(0, limit);
  const who = (by: string) => actorName(data, by) ?? t(by === 'automation' ? 'common.automation' : 'common.system');
  // sample data stores raw values (numbers, source ids); entries logged by actions are already worded
  const shownParams = (a: Activity) => {
    if (!a.params) return undefined;
    const p: Record<string, string | number> = { ...a.params };
    if (typeof p.amount === 'number') p.amount = money2(p.amount);
    if (typeof p.source === 'string' && t('src_' + p.source) !== 'src_' + p.source) p.source = t('src_' + p.source);
    return p;
  };
  const label = (a: Activity) => {
    if (!linkRecords) return null;
    const r = a.ref; const name = r.type === 'job' ? byId(data.jobs, r.id)?.name : r.type === 'lead' ? byId(data.leads, r.id)?.name : r.type === 'client' ? byId(data.clients, r.id)?.name : r.type === 'worker' ? byId(data.workers, r.id)?.name : null;
    return name ? <> · <A to={refPath(r)} className="muted">{name}</A></> : null;
  };
  return (
    <>
      <ol className="timeline">
        {shown.map((a) => <li key={a.id} className={a.by === 'automation' ? 'auto' : undefined}><span>{t('act.' + a.kind, shownParams(a))}</span><time>{dateTime(a.at)} · {who(a.by)}{label(a)}</time></li>)}
      </ol>
      {items.length > limit && !all && <button type="button" className="linkbtn small" style={{ marginTop: 10 }} onClick={() => setAll(true)}>{t('common.seeAll')} ({items.length})</button>}
    </>
  );
}

/* ---------- notes and conversations ---------- */
const NOTE_KINDS: NoteKind[] = ['call', 'visit', 'text', 'email', 'note'];
const NOTE_ICON: Record<NoteKind, string> = { call: '📞', visit: '🏠', text: '💬', email: '✉️', note: '📝' };
export function NotesPanel({ target, notes, canEdit = true }: { target: Ref; notes: Note[]; canEdit?: boolean }) {
  const { t, data, dateTime } = useApp();
  const [kind, setKind] = useState<NoteKind>('call');
  const [text, setText] = useState(''); const [pin, setPin] = useState(false);
  const sorted = [...notes].sort((a, b) => Number(!!b.pin) - Number(!!a.pin) || b.at.localeCompare(a.at));
  const save = () => { if (!text.trim()) return; act(addNote, target, kind, text, pin); setText(''); setPin(false); };
  return (
    <Card title={t('notesTitle')}>
      {canEdit && (
        <div className="stack tight" style={{ marginBottom: 14 }}>
          <Seg label={t('notesTitle')} value={kind} onChange={setKind} options={NOTE_KINDS.map((k) => ({ value: k, label: <><span aria-hidden="true">{NOTE_ICON[k]}</span> {t('nk_' + k)}</> }))} />
          <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('notePh')} aria-label={t('notePh')} />
          <div className="row between">
            <label className="check"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /><span>{t('pinIt')}</span></label>
            <Button size="sm" variant="primary" onClick={save} disabled={!text.trim()}>{t('saveNote')}</Button>
          </div>
        </div>
      )}
      {sorted.length ? (
        <div className="list">
          {sorted.map((n) => (
            <div className="item" key={n.id}>
              <span aria-hidden="true">{NOTE_ICON[n.kind]}</span>
              <div className="grow">
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.pin && <LuPin aria-label={t('remember')} style={{ color: 'var(--warn)', verticalAlign: '-2px', marginRight: 4 }} />}{n.text}</div>
                <div className="xs dim">{t('nk_' + n.kind)} · {dateTime(n.at)}{n.by && actorName(data, n.by) ? ` · ${actorName(data, n.by)}` : ''}</div>
              </div>
              {canEdit && <IconButton size="sm" label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDelete'), t('common.delete'), t('common.cancel'))) act(deleteNote, target, n.id); }}><LuTrash2 /></IconButton>}
            </div>
          ))}
        </div>
      ) : <p className="muted small">{t('noNotes')}</p>}
    </Card>
  );
}

/* ---------- task row used on the dashboard, job page and portal ---------- */
export function TaskRow({ task, showJob, onEdit, actions }: { task: Task; showJob?: boolean; onEdit?: () => void; actions?: ReactNode }) {
  const { t, data } = useApp();
  const job = byId(data.jobs, task.jobId); const lead = byId(data.leads, task.leadId);
  const done = task.status === 'done';
  return (
    <div className={cx('item', done && 'done')}>
      <label className="tick"><input type="checkbox" checked={done} onChange={() => act(toggleTask, task.id)} aria-label={`${t(done ? 'ts.done' : 'ts.todo')}: ${task.title}`} /></label>
      <div className="grow">
        <div className="t">{onEdit ? <button type="button" className="linkbtn" style={{ color: 'inherit', textDecoration: 'none', textAlign: 'left', fontWeight: 650 }} onClick={onEdit}>{task.title}</button> : task.title} {!done && <PriorityBadge pri={task.pri} />} {!done && task.status !== 'todo' && <TaskStatusBadge status={task.status} />}</div>
        <div className="small muted">
          {showJob && job && <><A to={`/jobs/${job.id}`}>{byId(data.clients, job.clientId)?.name} · {job.name}</A> · </>}
          {showJob && !job && lead && <><A to={`/leads/${lead.id}`}>{lead.name}</A> · </>}
          {assigneeName(data, task.assignee) || t('common.unassigned')}
          {task.auto && <> · <span className="auto-by"><LuZap aria-hidden="true" />{t('common.automation')}</span></>}
        </div>
      </div>
      <DueBadge due={task.due} done={done} />
      {actions}
    </div>
  );
}
