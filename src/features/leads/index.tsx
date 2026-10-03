// Leads: every request from first contact to a won job. Table and pipeline views over the same data.
import { useMemo, useState } from 'react';
import { LuPlus, LuTable, LuKanban, LuCalendarClock, LuPencil, LuTrash2, LuTrophy, LuCircleX, LuRotateCcw, LuMail, LuBellRing, LuArrowRightLeft, LuChevronDown } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute } from '@/app/router';
import { BackLink } from '@/app/Shell';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, FormModal, IconButton, Modal, PageHeader, SearchBox, Seg, cx, confirmDialog, toast, type FieldDef } from '@/ui';
import { ActivityList, ContactLinks, LeadStageBadge, NotesPanel, PriorityBadge, TaskRow } from '@/app/shared';
import { convertLead, createLead, deleteLead, setLeadStage, updateLead } from '@/domain/actions';
import { TaskFormModal } from '@/app/forms';
import { activityFor, byId, isOpenLead } from '@/domain/selectors';
import type { Lead, LeadSource, LeadStage, Priority } from '@/domain/types';
import { money, sum } from '@/lib/money';
import { today } from '@/lib/dates';
import './work.css';
import './board.css';
import './leads.css';

const STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent', 'won', 'lost'];
const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'scheduled', 'sent'];
const SOURCES: LeadSource[] = ['website', 'phone', 'referral', 'facebook', 'instagram', 'google', 'other'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

export default function LeadsPage({ id }: PageProps) {
  return id ? <LeadDetail id={id} /> : <LeadList />;
}

/** What should happen next with a lead, in one short line. */
function useNextStep() {
  const { t, day, time } = useApp();
  return (l: Lead): { text: string; late: boolean } | null => {
    if (!isOpenLead(l)) return null;
    if (l.apptDate && l.apptDate >= today()) return { text: t('leads.visitOn', { date: `${day(l.apptDate)}${l.apptTime ? ', ' + time(l.apptTime) : ''}` }), late: false };
    if (l.followUp) return { text: t(l.followUp < today() ? 'leads.followLate' : 'leads.followOn', { date: day(l.followUp) }), late: l.followUp < today() };
    return { text: t('leads.noNext'), late: false };
  };
}

/* ---------- list: table or pipeline ---------- */
function LeadList() {
  const { t, data, date } = useApp();
  const route = useRoute();
  const view = route.query.get('view') === 'board' ? 'board' : 'table';
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<'open' | 'all' | LeadStage>('open');
  const [source, setSource] = useState<'' | LeadSource>('');
  const [owner, setOwner] = useState('');
  const [pri, setPri] = useState<'' | Priority>('');
  const [form, setForm] = useState(() => route.query.get('new') === '1');
  const [lost, setLost] = useState<Lead | null>(null);
  const next = useNextStep();

  const base = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.leads.filter((l) =>
      (!s || [l.name, l.company, l.phone, l.email, l.address, l.ticket].some((v) => v && v.toLowerCase().includes(s)))
      && (!source || l.source === source) && (!owner || l.ownerId === owner) && (!pri || l.pri === pri));
  }, [data.leads, q, source, owner, pri]);
  const rows = base.filter((l) => (stage === 'open' ? isOpenLead(l) : stage === 'all' ? true : l.status === stage));
  const open = data.leads.filter(isOpenLead);
  const filtered = !!(q || source || owner || pri || stage !== 'open');
  const clear = () => { setQ(''); setSource(''); setOwner(''); setPri(''); setStage('open'); };

  /** Moving a card to Won converts it; moving to Lost asks why. */
  const move = async (l: Lead, to: LeadStage) => {
    if (l.status === to) return;
    if (to === 'won') { if (await confirmDialog(t('leads.convertHint'), t('leads.convert'), t('common.cancel'), false)) { act(convertLead, l.id); toast(t('leads.converted')); } return; }
    if (to === 'lost') { setLost(l); return; }
    act(setLeadStage, l.id, to); toast(t('leads.moved', { stage: t('ls_' + to) }));
  };

  return (
    <>
      <PageHeader title={t('leads.title')} sub={t('leads.sub')} actions={<>
        <Seg label={t('leads.view')} value={view} onChange={(v) => go(v === 'board' ? '/leads?view=board' : '/leads')} options={[
          { value: 'table', label: <><LuTable aria-hidden="true" />{t('leads.view.table')}</> }, { value: 'board', label: <><LuKanban aria-hidden="true" />{t('leads.view.board')}</> }]} />
        <Button variant={data.leads.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="leads-new">{t('leads.new')}</Button>
      </>} />

      <div className="filters leads-filters">
        <SearchBox value={q} onChange={setQ} placeholder={t('leads.search')} />
        {view === 'table' && (
          <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label={t('leads.col.stage')} data-testid="leads-filter-stage">
            <option value="open">{t('leads.allStages')}</option><option value="all">{t('leads.everything')}</option>
            {STAGES.map((s) => <option key={s} value={s}>{t('ls_' + s)}</option>)}
          </select>
        )}
        <select value={source} onChange={(e) => setSource(e.target.value as LeadSource | '')} aria-label={t('common.source')} data-testid="leads-filter-source">
          <option value="">{t('leads.allSources')}</option>{SOURCES.map((s) => <option key={s} value={s}>{t('src_' + s)}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t('leads.col.owner')} data-testid="leads-filter-owner">
          <option value="">{t('leads.allOwners')}</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={pri} onChange={(e) => setPri(e.target.value as Priority | '')} aria-label={t('common.priority')}>
          <option value="">{t('leads.allPriorities')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}
        </select>
        {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
      </div>
      {data.leads.length > 0 && <p className="small muted leads-sum">{t('leads.open', { n: open.length })} · {t('leads.pipeline')}: <b>{money(sum(open, (l) => l.value))}</b></p>}

      {!data.leads.length ? (
        <Card className="work-none"><Empty title={t('leads.empty')} action={<Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('leads.new')}</Button>}>{t('leads.emptyHint')}</Empty></Card>
      ) : view === 'board' ? (
        <Board leads={base} onMove={move} />
      ) : !rows.length ? (
        <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="tbl stackable" data-testid="leads-table">
              <thead><tr><th>{t('leads.col.lead')}</th><th>{t('leads.col.service')}</th><th>{t('leads.col.stage')}</th><th>{t('leads.col.next')}</th><th className="num">{t('leads.col.value')}</th><th>{t('leads.col.owner')}</th><th>{t('leads.col.age')}</th></tr></thead>
              <tbody>
                {rows.map((l) => {
                  const n = next(l); const u = byId(data.users, l.ownerId);
                  return (
                    <tr key={l.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/leads/${l.id}`); }}>
                      <td className="t1"><A to={`/leads/${l.id}`} className="leads-name">{l.name}</A> <PriorityBadge pri={l.pri} /><div className="xs dim">{l.ticket}{l.company ? ` · ${l.company}` : ''}</div></td>
                      <td data-label={t('leads.col.service')}>{t('ty_' + l.type)}<div className="xs dim">{t('src_' + l.source)}</div></td>
                      <td data-label={t('leads.col.stage')}><LeadStageBadge stage={l.status} /></td>
                      <td data-label={t('leads.col.next')}>{n ? <span className={cx('small', n.late && 'neg strong')}>{n.text}</span> : null}</td>
                      <td data-label={t('leads.col.value')} className="num">{l.value ? money(l.value) : <span className="dim">{'—'}</span>}</td>
                      <td data-label={t('leads.col.owner')}>{u ? <span className="row tight nowrap"><Avatar name={u.name} size="sm" />{u.name.split(' ')[0]}</span> : <span className="dim">{t('common.unassigned')}</span>}</td>
                      <td data-label={t('leads.col.age')} className="small muted">{date(l.created)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={4}>{t('leads.total')} ({rows.length})</td><td className="num">{money(sum(rows, (l) => l.value))}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        </Card>
      )}

      {form && <LeadForm onClose={() => setForm(false)} />}
      {lost && <LostModal lead={lost} onClose={() => setLost(null)} />}
    </>
  );
}

/* ---------- pipeline board: drag a card, or use the Move menu on it ---------- */
function Board({ leads, onMove }: { leads: Lead[]; onMove: (l: Lead, to: LeadStage) => void }) {
  const { t } = useApp();
  const [over, setOver] = useState<LeadStage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The card that was just moved and where to, so it can settle once in its new column. */
  const [landed, setLanded] = useState<{ id: string; to: LeadStage } | null>(null);
  const moveTo = (l: Lead, to: LeadStage) => { if (l.status !== to) setLanded({ id: l.id, to }); onMove(l, to); };
  const next = useNextStep();
  return (
    <div className="kanban leads-board" data-testid="leads-board">
      {STAGES.map((s) => {
        const col = leads.filter((l) => l.status === s);
        return (
          <section key={s} className={cx('kcol', over === s && 'over')} aria-label={t('ls_' + s)} data-stage={s}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); const l = leads.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragging)); if (l) moveTo(l, s); setDragging(null); }}>
            <div className="kcol-h"><span>{t('ls_' + s)} <span className="count">{col.length}</span></span><span className="small muted">{money(sum(col, (l) => l.value))}</span></div>
            <div className="kcol-b">
              {col.map((l) => {
                const n = next(l);
                return (
                  <article key={l.id} className={cx('kcard', dragging === l.id && 'drag', landed?.id === l.id && landed.to === l.status && 'landed')} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDragging(l.id); }} onDragEnd={() => { setDragging(null); setOver(null); }} data-lead={l.id}>
                    <div className="row between nowrap top"><A to={`/leads/${l.id}`} className="t leads-name">{l.name}</A><PriorityBadge pri={l.pri} /></div>
                    <div className="small muted">{t('ty_' + l.type)}{l.value ? ` · ${money(l.value)}` : ''}</div>
                    {n && <div className={cx('xs', n.late ? 'neg strong' : 'dim')}>{n.text}</div>}
                    <label className="leads-move"><span><LuArrowRightLeft aria-hidden="true" />{t('leads.moveTo')}<LuChevronDown aria-hidden="true" /></span>
                      <select value={l.status} onChange={(e) => moveTo(l, e.target.value as LeadStage)} aria-label={`${t('leads.moveTo')}: ${l.name}`}>
                        {STAGES.map((x) => <option key={x} value={x}>{t('ls_' + x)}</option>)}
                      </select>
                    </label>
                  </article>
                );
              })}
              {!col.length && <p className="xs dim leads-drop">{t('leads.drop')}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- add / edit ---------- */
function LeadForm({ lead, onClose }: { lead?: Lead; onClose: () => void }) {
  const { t, data, pack } = useApp();
  const fields: FieldDef[] = [
    { k: 'name', label: t('leads.f.name'), req: true }, { k: 'company', label: `${t('leads.f.company')} (${t('common.optional')})` },
    { k: 'phone', label: t('common.phone'), type: 'tel', req: true }, { k: 'email', label: t('common.email'), type: 'email' },
    { k: 'address', label: t('common.address'), full: true },
    { k: 'type', label: t('leads.f.service'), type: 'select', options: pack.serviceTypes.map((s) => [s.id, t('ty_' + s.id)]) },
    { k: 'source', label: t('leads.f.source'), type: 'select', options: SOURCES.map((s) => [s, t('src_' + s)]) },
    { k: 'value', label: t('leads.f.value'), type: 'money' }, { k: 'pri', label: t('common.priority'), type: 'select', options: PRIORITIES.map((p) => [p, t('pr.' + p)]) },
    { k: 'ownerId', label: t('leads.f.owner'), type: 'select', options: data.users.map((u) => [u.id, u.name]) },
    { k: 'followUp', label: t('leads.f.followUp'), type: 'date' }, { k: 'apptDate', label: t('leads.f.visitDate'), type: 'date' }, { k: 'apptTime', label: t('leads.f.visitTime'), type: 'time' },
    ...(lead ? [] : [{ k: 'firstNote', label: t('leads.f.firstNote'), type: 'textarea' as const }]),
  ];
  const initial = lead ? { ...lead, value: lead.value ?? '' } : { type: pack.serviceTypes[0]?.id, source: 'phone', pri: 'medium', ownerId: data.users[0]?.id };
  return (
    <FormModal title={t(lead ? 'leads.edit' : 'leads.new')} fields={fields} initial={initial} onClose={onClose} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
      onSave={(v) => {
        const patch = { name: v.name, company: v.company || undefined, phone: v.phone, email: v.email, address: v.address, type: v.type, source: v.source as LeadSource, value: v.value, pri: v.pri as Priority, ownerId: v.ownerId, followUp: v.followUp || undefined, apptDate: v.apptDate || undefined, apptTime: v.apptTime || undefined };
        if (lead) { act(updateLead, lead.id, patch); toast(t('leads.saved')); }
        else { const l = act(createLead, { ...patch, firstNote: v.firstNote || undefined }); toast(t('leads.created')); go(`/leads/${l.id}`); }
      }} />
  );
}

function LostModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const save = () => { act(updateLead, lead.id, { status: 'lost', lostReason: reason.trim() || undefined }); toast(t('leads.moved', { stage: t('ls_lost') })); onClose(); };
  return (
    <Modal title={t('leads.markLost')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="leads-lost-save">{t('leads.markLost')}</Button></>}>
      <label className="field"><span>{t('leads.lostReason')}</span><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('leads.lostPh')} autoFocus /></label>
    </Modal>
  );
}

/* ---------- one lead ---------- */
function LeadDetail({ id }: { id: string }) {
  const { t, data, can, date, day, time } = useApp();
  const lead = byId(data.leads, id);
  const [edit, setEdit] = useState(false);
  const [lost, setLost] = useState(false);
  const [when, setWhen] = useState<'visit' | 'follow' | null>(null);
  const [task, setTask] = useState(false);
  const [editTask, setEditTask] = useState<string | null>(null);
  if (!lead) return <Empty title={t('leads.notFound')} action={<A to="/leads" className="btn">{t('leads.back')}</A>} />;

  const owner = byId(data.users, lead.ownerId);
  const tasks = data.tasks.filter((x) => x.leadId === lead.id);
  const job = byId(data.jobs, lead.jobId); const client = byId(data.clients, lead.clientId);
  const open = isOpenLead(lead);
  const remove = async () => { if (await confirmDialog(t('common.confirmDelete'), t('common.delete'), t('common.cancel'))) { act(deleteLead, lead.id); toast(t('leads.deleted')); go('/leads'); } };
  const win = async () => { if (await confirmDialog(t('leads.convertHint'), t('leads.convert'), t('common.cancel'), false)) { const j = act(convertLead, lead.id); toast(t('leads.converted')); if (j) go(`/jobs/${j.id}`); } };

  return (
    <>
      <BackLink to="/leads">{t('leads.back')}</BackLink>
      <PageHeader title={<>{lead.name} <LeadStageBadge stage={lead.status} /></>} sub={`${lead.ticket} · ${t('leads.received', { date: date(lead.created), source: t('src_' + lead.source) })}`} actions={<>
        <Button icon={<LuPencil />} onClick={() => setEdit(true)} data-testid="leads-edit">{t('common.edit')}</Button>
        {can('delete') && <IconButton label={t('common.delete')} onClick={remove}><LuTrash2 /></IconButton>}
      </>} />

      <div className="split">
        <div className="stack">
          {open ? (
            <Card title={t('leads.stage')} className="leads-stage raised">
              <p className="small muted" style={{ marginBottom: 10 }}>{t('leads.stageHint')}</p>
              <Seg label={t('leads.stage')} value={lead.status} onChange={(s) => act(setLeadStage, lead.id, s)} options={OPEN_STAGES.map((s) => ({ value: s, label: t('ls_' + s) }))} />
              <div className="leads-next">
                <div>
                  <div className="xs dim">{t('leads.nextStep')}</div>
                  {lead.apptDate ? <div className="strong">{t('leads.visitOn', { date: `${day(lead.apptDate)}${lead.apptTime ? ', ' + time(lead.apptTime) : ''}` })}</div> : null}
                  {lead.followUp ? <div className={cx(lead.followUp < today() && 'neg', !lead.apptDate && 'strong')}>{t('leads.followOn', { date: day(lead.followUp) })}</div> : null}
                  {!lead.apptDate && !lead.followUp && <div className="muted">{t('leads.noNext')}</div>}
                </div>
                <div className="row">
                  <Button size="sm" icon={<LuCalendarClock />} onClick={() => setWhen('visit')} data-testid="leads-schedule">{t(lead.apptDate ? 'leads.reschedule' : 'leads.schedule')}</Button>
                  <Button size="sm" icon={<LuBellRing />} onClick={() => setWhen('follow')}>{t('leads.setFollowUp')}</Button>
                </div>
              </div>
              <div className="leads-outcome">
                <Button variant="primary" icon={<LuTrophy />} onClick={win} data-testid="leads-convert">{t('leads.convert')}</Button>
                <Button variant="ghost" icon={<LuCircleX />} onClick={() => setLost(true)} data-testid="leads-lost">{t('leads.markLost')}</Button>
              </div>
            </Card>
          ) : lead.status === 'won' ? (
            <Card>
              <div className="row between">
                <div><Badge tone="ok">{t('ls_won')}</Badge> <span className="muted">{t('leads.wonNote')}</span></div>
                <div className="row">
                  {job && <A to={`/jobs/${job.id}`} className="btn primary sm" data-testid="leads-open-job">{t('leads.openJob')}</A>}
                  {client && <A to={`/clients/${client.id}`} className="btn sm">{t('leads.openClient')}</A>}
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="row between">
                <div><Badge tone="bad">{t('ls_lost')}</Badge> <span className="muted">{lead.lostReason ? t('leads.lostBecause', { reason: lead.lostReason }) : ''}</span></div>
                <Button size="sm" icon={<LuRotateCcw />} onClick={() => act(setLeadStage, lead.id, 'contacted')}>{t('leads.reopen')}</Button>
              </div>
            </Card>
          )}
          <NotesPanel target={{ type: 'lead', id: lead.id }} notes={lead.notes} />
          <Card title={t('leads.tasks')} actions={<Button size="sm" icon={<LuPlus />} onClick={() => setTask(true)}>{t('leads.addTask')}</Button>}>
            {tasks.length ? <div className="list">{tasks.map((x) => <TaskRow key={x.id} task={x} onEdit={() => setEditTask(x.id)} />)}</div> : <p className="muted small">{t('leads.noTasks')}</p>}
          </Card>
        </div>

        <div className="stack">
          <Card title={t('leads.contact')}>
            <dl className="kv">
              {lead.company && <><dt>{t('common.company')}</dt><dd>{lead.company}</dd></>}
              <dt>{t('common.phone')}</dt><dd>{lead.phone || '—'}</dd>
              <dt>{t('common.email')}</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`}><LuMail aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />{lead.email}</a> : '—'}</dd>
              <dt>{t('common.address')}</dt><dd>{lead.address || '—'}</dd>
            </dl>
            <div style={{ marginTop: 12 }}><ContactLinks phone={lead.phone} address={lead.address} /></div>
          </Card>
          <Card title={t('leads.details')}>
            <dl className="kv">
              <dt>{t('leads.f.service')}</dt><dd>{t('ty_' + lead.type)}</dd>
              <dt>{t('leads.f.value')}</dt><dd>{lead.value ? money(lead.value) : t('leads.noValue')}</dd>
              <dt>{t('common.priority')}</dt><dd><PriorityBadge pri={lead.pri} always /></dd>
              <dt>{t('leads.f.owner')}</dt><dd>{owner ? owner.name : t('common.unassigned')}</dd>
              <dt>{t('common.source')}</dt><dd>{t('src_' + lead.source)}</dd>
            </dl>
          </Card>
          <Card title={t('common.activity')}><ActivityList items={activityFor(data, { type: 'lead', id: lead.id })} limit={8} /></Card>
        </div>
      </div>

      {edit && <LeadForm lead={lead} onClose={() => setEdit(false)} />}
      {lost && <LostModal lead={lead} onClose={() => setLost(false)} />}
      {when === 'visit' && <FormModal title={t(lead.apptDate ? 'leads.reschedule' : 'leads.schedule')} initial={{ apptDate: lead.apptDate || today(), apptTime: lead.apptTime || '10:00' }} onClose={() => setWhen(null)} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
        fields={[{ k: 'apptDate', label: t('leads.f.visitDate'), type: 'date', req: true }, { k: 'apptTime', label: t('leads.f.visitTime'), type: 'time' }]}
        onSave={(v) => { act(updateLead, lead.id, { apptDate: v.apptDate, apptTime: v.apptTime || undefined }); toast(t('leads.saved')); }} />}
      {when === 'follow' && <FormModal title={t('leads.setFollowUp')} initial={{ followUp: lead.followUp || today() }} onClose={() => setWhen(null)} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
        fields={[{ k: 'followUp', label: t('leads.f.followUp'), type: 'date', req: true, full: true }]}
        onSave={(v) => { act(updateLead, lead.id, { followUp: v.followUp }); toast(t('leads.saved')); }} />}
      {editTask && byId(data.tasks, editTask) && <TaskFormModal task={byId(data.tasks, editTask)} onClose={() => setEditTask(null)} />}
      {task && <TaskFormModal defaults={{ leadId: lead.id, assignee: 'u:' + lead.ownerId }} onClose={() => setTask(false)} />}
    </>
  );
}
