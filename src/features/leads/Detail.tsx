// One lead: where it stands, what happens next, who has it and who had it, and, once it is won, what winning it created.
import { useMemo, useState } from 'react';
import { LuArrowRightLeft, LuBellRing, LuCalendarClock, LuCircleX, LuFileText, LuListChecks, LuMail, LuPencil, LuPlus, LuRotateCcw, LuTrash2, LuTrophy, LuUserRound, LuBriefcase, LuRepeat } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, FormModal, IconButton, PageHeader, Seg, cx, confirmDialog, toast } from '@/ui';
import { ActivityList, ContactLinks, DemoTag, DocStatusBadge, JobStatusBadge, LeadStageBadge, NoAccess, NotesPanel, PriorityBadge, TaskRow } from '@/app/shared';
import { convertLead, deleteLead, setLeadStage, updateLead } from '@/domain/actions';
import { TaskFormModal } from '@/app/forms';
import { activityFor, byId } from '@/domain/selectors';
import { canSeeClient, canSeeLead } from '@/domain/access';
import { firstStage, isOpen, isWon, moduleOn, openStages, routingOf, stageByRole } from '@/domain/config';
import { gateway } from '@/platform/gateway';
import type { Lead } from '@/domain/types';
import { money } from '@/lib/money';
import { today } from '@/lib/dates';
import { leadSignals, messageContacts, STALE_DAYS } from './model';
import { ContactAge, NextStepLine, serviceName, useReasonLabel } from './parts';
import { HandoffModal, LeadForm, LostModal, NextActionModal } from './forms';

export function LeadDetail({ id }: { id: string }) {
  const { t, data, pack, lang, can, date, day, time, dateTime, user, perms, live } = useApp();
  const lead = byId(data.leads, id);
  const canWrite = can('write');
  const full = pack.family === 'practice';
  const [edit, setEdit] = useState(false);
  const [lost, setLost] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [nextAction, setNextAction] = useState(false);
  const [when, setWhen] = useState<'visit' | 'follow' | null>(null);
  const [task, setTask] = useState(false);
  const [editTask, setEditTask] = useState<string | null>(null);
  const reasonLabel = useReasonLabel();
  const messages = useMemo(() => messageContacts(data), [data]);
  if (!lead) return <Empty title={t('leads.notFound')} action={<A to="/leads" className="btn">{t('leads.back')}</A>} />;
  // a lead of another office: the address may be typed by hand, the record stays closed
  if (!canSeeLead(user, perms, lead)) return <><BackLink to="/leads">{t('leads.back')}</BackLink><NoAccess /></>;

  const sig = leadSignals(data, pack, lead, messages);
  const owner = byId(data.users, lead.ownerId);
  const tasks = data.tasks.filter((x) => x.leadId === lead.id);
  const job = byId(data.jobs, lead.jobId); const client = byId(data.clients, lead.clientId);
  const open = sig.open;
  const original = lead.originalOwnerId && lead.originalOwnerId !== lead.ownerId ? byId(data.users, lead.originalOwnerId) : undefined;
  const office = byId(data.offices, lead.officeId);
  const services = (lead.serviceIds ?? []).map((sid) => byId(data.catalog, sid)).filter((x): x is NonNullable<typeof x> => !!x);
  const mayAssign = canWrite && can('assignLeads') && open;
  const ownerGone = !owner || owner.active === false;

  const remove = async () => { if (await confirmDialog(t('common.confirmDelete'), t('common.delete'), t('common.cancel'))) { act(deleteLead, lead.id); toast(t('leads.deleted')); go('/leads'); } };
  const win = async () => {
    if (!(await confirmDialog(t('leads.convertHint'), t('leads.convert'), t('common.cancel'), false))) return;
    const j = act(convertLead, lead.id); toast(t('leads.converted'));
    // the field editions go straight to the new job, as they always have; an office stays on the lead, which now lists
    // everything that winning it created
    if (j && !full) go(`/jobs/${j.id}`);
  };
  /** Gives a lead nobody holds to whoever is next in the rotation. The turn is taken by the gateway: on the server, under a lock. */
  const giveNext = async () => {
    const out = await gateway().protected.leadAssignNext(lead.id);
    if (!out.ok) { toast(t('leads.turn.failed'), true); return; }
    const who = byId(data.users, out.data.userId ?? undefined);
    toast(who ? t('leads.handoff.done', { name: who.name }) : t('leads.turn.nobody'), !who);
  };

  return (
    <>
      <BackLink to="/leads">{t('leads.back')}</BackLink>
      <PageHeader title={<>{lead.name} <LeadStageBadge stage={lead.status} /></>} sub={`${lead.ticket} · ${t('leads.received', { date: date(lead.created), source: t('src_' + lead.source) })}`} actions={canWrite ? <>
        <Button icon={<LuPencil />} onClick={() => setEdit(true)} data-testid="leads-edit">{t('common.edit')}</Button>
        {can('delete') && <IconButton label={t('common.delete')} onClick={remove}><LuTrash2 /></IconButton>}
      </> : undefined} />

      <div className="split">
        <div className="stack">
          {open ? (
            <Card title={t('leads.stage')} className="leads-stage raised">
              {canWrite && <p className="small muted" style={{ marginBottom: 10 }}>{t('leads.stageHint')}</p>}
              {canWrite
                ? <Seg label={t('leads.stage')} value={lead.status} onChange={(s) => act(setLeadStage, lead.id, s)} options={openStages(data, pack).map((s) => ({ value: s.id, label: t('ls_' + s.id) }))} />
                : <LeadStageBadge stage={lead.status} />}
              <div className="leads-next">
                <div className="leads-next-what">
                  <div className="xs dim">{t('leads.nextStep')}</div>
                  {full ? (
                    <>
                      <div className="strong" data-testid="leads-next-action"><NextStepLine lead={lead} signals={sig} /></div>
                      {lead.apptDate && sig.next.kind !== 'appt' ? <div className="small muted">{t('leads.visitOn', { date: `${day(lead.apptDate)}${lead.apptTime ? ', ' + time(lead.apptTime) : ''}` })}</div> : null}
                      {lead.followUp && sig.next.kind !== 'follow' && lead.followUp !== sig.next.due ? <div className={cx('small', lead.followUp < today() ? 'neg' : 'muted')}>{t('leads.followOn', { date: day(lead.followUp) })}</div> : null}
                    </>
                  ) : (
                    <>
                      {lead.apptDate ? <div className="strong">{t('leads.visitOn', { date: `${day(lead.apptDate)}${lead.apptTime ? ', ' + time(lead.apptTime) : ''}` })}</div> : null}
                      {lead.followUp ? <div className={cx(lead.followUp < today() && 'neg', !lead.apptDate && 'strong')}>{t('leads.followOn', { date: day(lead.followUp) })}</div> : null}
                      {lead.nextAction && <div className={cx(!!lead.nextAction.due && lead.nextAction.due < today() && 'neg')} data-testid="leads-next-action">{lead.nextAction.text}{lead.nextAction.due ? ` · ${day(lead.nextAction.due)}` : ''}</div>}
                      {!lead.apptDate && !lead.followUp && !lead.nextAction && <div className="muted">{t('leads.noNext')}</div>}
                    </>
                  )}
                </div>
                {canWrite && <div className="row">
                  {full && <Button size="sm" variant={sig.attention ? 'primary' : 'default'} icon={<LuListChecks />} onClick={() => setNextAction(true)} data-testid="leads-set-next">{t(lead.nextAction ? 'leads.next.change' : 'leads.next.set')}</Button>}
                  <Button size="sm" icon={<LuCalendarClock />} onClick={() => setWhen('visit')} data-testid="leads-schedule">{t(lead.apptDate ? 'leads.reschedule' : 'leads.schedule')}</Button>
                  <Button size="sm" icon={<LuBellRing />} onClick={() => setWhen('follow')}>{t('leads.setFollowUp')}</Button>
                </div>}
              </div>
              {canWrite && <div className="leads-outcome">
                <Button variant={full && sig.attention ? 'default' : 'primary'} icon={<LuTrophy />} onClick={win} data-testid="leads-convert">{t('leads.convert')}</Button>
                <Button variant="ghost" icon={<LuCircleX />} onClick={() => setLost(true)} data-testid="leads-lost">{t('leads.markLost')}</Button>
              </div>}
            </Card>
          ) : isWon(data, pack, lead.status) ? (
            full ? <WonResult lead={lead} /> : (
              <Card>
                <div className="row between">
                  <div><Badge tone="ok">{t('ls_' + lead.status)}</Badge> <span className="muted">{t('leads.wonNote')}</span></div>
                  <div className="row">
                    {job && <A to={`/jobs/${job.id}`} className="btn primary sm" data-testid="leads-open-job">{t('leads.openJob')}</A>}
                    {client && <A to={`/clients/${client.id}`} className="btn sm">{t('leads.openClient')}</A>}
                  </div>
                </div>
              </Card>
            )
          ) : (
            <Card>
              <div className="row between">
                <div><Badge tone="bad">{t('ls_' + lead.status)}</Badge> <span className="muted" data-testid="leads-lost-reason">{lead.lostReason ? t('leads.lostBecause', { reason: reasonLabel(lead.lostReason) }) : ''}{full && lead.lostAt ? ` · ${date(lead.lostAt)}` : ''}</span></div>
                {canWrite && <div className="row">
                  {full && <Button size="sm" variant="ghost" onClick={() => setLost(true)}>{t('leads.lostChange')}</Button>}
                  <Button size="sm" icon={<LuRotateCcw />} onClick={() => act(setLeadStage, lead.id, (stageByRole(data, pack, 'contacted') ?? firstStage(data, pack)).id)}>{t('leads.reopen')}</Button>
                </div>}
              </div>
            </Card>
          )}
          <NotesPanel target={{ type: 'lead', id: lead.id }} notes={lead.notes} />
          <Card title={t('leads.tasks')} actions={canWrite ? <Button size="sm" icon={<LuPlus />} onClick={() => setTask(true)}>{t('leads.addTask')}</Button> : undefined}>
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
              {full && <><dt>{t('leads.f.kind')}</dt><dd>{t('leads.kind.' + (lead.kind ?? (lead.company ? 'business' : 'individual')))}</dd></>}
              {full && lead.lang && <><dt>{t('leads.f.lang')}</dt><dd>{t('lang.' + lead.lang)}</dd></>}
              {full && <><dt>{t('leads.sms')}</dt><dd>{lead.smsOptIn ? <Badge tone="ok" outline>{t('leads.sms.yes')}</Badge> : <span className="muted">{t('leads.sms.no')}</span>}</dd></>}
            </dl>
            <div style={{ marginTop: 12 }}><ContactLinks phone={lead.phone} address={lead.address} /></div>
          </Card>
          <Card title={t('leads.details')}>
            <dl className="kv">
              <dt>{t('leads.f.service')}</dt><dd>{t('ty_' + lead.type)}</dd>
              {full && <><dt>{t('leads.f.services')}</dt><dd data-testid="leads-services-list">{services.length ? <span className="leads-tags">{services.map((s) => <Badge key={s.id} outline>{serviceName(s, lang)}</Badge>)}</span> : <span className="muted">{t('common.none')}</span>}</dd></>}
              <dt>{t('leads.f.value')}</dt><dd>{lead.value ? money(lead.value) : t('leads.noValue')}</dd>
              <dt>{t('common.priority')}</dt><dd><PriorityBadge pri={lead.pri} always /></dd>
              {!full && <><dt>{t('leads.f.owner')}</dt><dd>{owner ? owner.name : t('common.unassigned')}{original ? <span className="xs dim"> · {t('leads.originalOwner', { name: original.name })}</span> : null}</dd></>}
              <dt>{t('common.source')}</dt><dd>{t('src_' + lead.source)}{lead.sourceDetail ? <span className="dim"> · {lead.sourceDetail}</span> : null}</dd>
              {full && data.offices.length > 0 && <><dt>{t('leads.f.office')}</dt><dd>{office ? office.name : <span className="muted">{t('leads.f.noOffice')}</span>}</dd></>}
            </dl>
            {!full && mayAssign && <div style={{ marginTop: 12 }}><Button size="sm" icon={<LuArrowRightLeft />} onClick={() => setHandoff(true)} data-testid="leads-handoff">{t('leads.handoff')}</Button></div>}
          </Card>
          {full && (
            <Card title={t('leads.who')}>
              <dl className="kv">
                <dt>{t('leads.f.owner')}</dt><dd data-testid="leads-owner">{owner ? owner.name : t('common.unassigned')}{owner?.active === false ? <span className="xs dim"> · {t('leads.ownerGone')}</span> : null}{original ? <span className="xs dim"> · {t('leads.originalOwner', { name: original.name })}</span> : null}</dd>
                <dt>{t('leads.col.contact')}</dt><dd>{sig.lastContact ? dateTime(sig.lastContact) : <span className="muted">{t('leads.contact.never')}</span>}</dd>
                {open && <><dt>{t('leads.waiting')}</dt><dd><ContactAge signals={sig} />{sig.stale ? <span className="xs dim"> · {t('leads.contact.staleHint', { n: STALE_DAYS })}</span> : null}</dd></>}
              </dl>
              {mayAssign && <div className="row leads-who-actions">
                <Button size="sm" icon={<LuArrowRightLeft />} onClick={() => setHandoff(true)} data-testid="leads-handoff">{t('leads.handoff')}</Button>
                {ownerGone && routingOf(data).mode === 'round_robin' && <Button size="sm" icon={<LuRepeat />} onClick={giveNext} data-testid="leads-give-next">{t('leads.turn.give')}</Button>}
              </div>}
            </Card>
          )}
          {!!lead.handoffs?.length && (
            <Card title={t('leads.handoffs')}>
              <ol className="timeline" data-testid="leads-handoffs">
                {[...lead.handoffs].reverse().map((h) => (
                  <li key={h.id}><span>{t(h.from ? 'leads.handoff.line' : 'leads.handoff.first', { from: byId(data.users, h.from)?.name ?? '', to: byId(data.users, h.to)?.name ?? '' })}{h.reason ? `. ${h.reason}` : ''}</span>
                    <time>{dateTime(h.at)} · {h.how === 'round_robin' ? t('leads.handoff.auto') : h.how === 'rule' ? t('leads.handoff.rule') : byId(data.users, h.by)?.name ?? t('common.system')}</time></li>
                ))}
              </ol>
            </Card>
          )}
          <Card title={t('common.activity')}><ActivityList items={activityFor(data, { type: 'lead', id: lead.id })} limit={8} /></Card>
        </div>
      </div>

      {edit && <LeadForm lead={lead} onClose={() => setEdit(false)} />}
      {lost && <LostModal lead={lead} to={isOpen(data, pack, lead.status) ? undefined : lead.status} onClose={() => setLost(false)} />}
      {handoff && <HandoffModal lead={lead} onClose={() => setHandoff(false)} />}
      {nextAction && <NextActionModal lead={lead} onClose={() => setNextAction(false)} />}
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

/**
 * What winning the lead created, read from the records: the client, the engagement, its documents, its tasks, the
 * messages prepared for the client and any appointment. Other modules add steps to the won-lead workflow; whatever they
 * create shows up here because it points at this lead or at its engagement.
 */
function WonResult({ lead: l }: { lead: Lead }) {
  const { t, data, pack, can, day, time, user, perms, live } = useApp();
  const client = byId(data.clients, l.clientId);
  // a lead that asked about several services opens one engagement for each: the first is named on the lead, the others point back at it
  const first = byId(data.jobs, l.jobId);
  const jobs = [...(first ? [first] : []), ...data.jobs.filter((j) => j.leadId === l.id && j.id !== l.jobId)];
  const jobIds = new Set(jobs.map((j) => j.id));
  const seen = !!client && canSeeClient(data, user, perms, client);
  const docs = data.docs.filter((x) => x.leadId === l.id || (!!x.jobId && jobIds.has(x.jobId)));
  const tasksOf = (id: string) => data.tasks.filter((x) => x.jobId === id);
  // what was written to the person. A notice to the office about the win is not one of those; it is read in Messages
  const mail = data.messages.filter((m) => m.channel !== 'system' && ((m.ref.type === 'job' && jobIds.has(m.ref.id)) || (m.ref.type === 'lead' && m.ref.id === l.id && !!m.auto)));
  const appts = moduleOn(data, pack, 'appointments') ? data.appointments.filter((a) => a.leadId === l.id || (!!a.jobId && jobIds.has(a.jobId))) : [];
  return (
    <Card title={<><Badge tone="ok">{t('ls_' + l.status)}</Badge> {t('leads.won.title')}</>} className="raised">
      <div className="list leads-won" data-testid="leads-won">
        {client && (seen
          ? <A to={`/clients/${client.id}`} className="item click" data-testid="leads-open-client"><LuUserRound aria-hidden="true" className="leads-ico" /><span className="grow"><span className="t">{client.name}</span><span className="xs dim leads-sub">{t('leads.won.client')}{client.company ? ` · ${client.company}` : ''}</span></span></A>
          : <div className="item"><LuUserRound aria-hidden="true" className="leads-ico" /><span className="grow"><span className="t">{client.name}</span><span className="xs dim leads-sub">{t('leads.dup.otherOffice')}</span></span></div>)}
        {can('jobs') && jobs.map((job) => (
          <A key={job.id} to={`/jobs/${job.id}`} className="item click" data-testid="leads-open-job"><LuBriefcase aria-hidden="true" className="leads-ico" />
            <span className="grow"><span className="t">{job.name}</span><span className="xs dim leads-sub">{t('leads.won.job')} · {job.number}{can('money') && job.price ? ` · ${money(job.price)}` : ''}</span></span><JobStatusBadge status={job.status} /></A>
        ))}
        {can('documents') && docs.map((x) => (
          <A key={x.id} to={`/documents/${x.id}`} className="item click"><LuFileText aria-hidden="true" className="leads-ico" />
            <span className="grow"><span className="t">{t('doc.kind.' + x.kind)} {x.number}</span><span className="xs dim leads-sub">{x.title}</span></span><DocStatusBadge status={x.status} /></A>
        ))}
        {can('tasks') && jobs.map((job) => {
          const list = tasksOf(job.id); if (!list.length) return null;
          return (
            <A key={job.id} to={`/jobs/${job.id}/tasks`} className="item click"><LuListChecks aria-hidden="true" className="leads-ico" />
              <span className="grow"><span className="t">{t('leads.won.tasks', { n: list.length })}</span><span className="xs dim leads-sub">{jobs.length > 1 ? `${job.name} · ` : ''}{t('leads.won.tasksOpen', { n: list.filter((x) => x.status !== 'done').length })}</span></span></A>
          );
        })}
        {can('comms') && mail.map((m) => (
          <A key={m.id} to="/messages" className="item click"><LuMail aria-hidden="true" className="leads-ico" />
            <span className="grow"><span className="t">{m.subject || t('leads.won.message')}</span><span className="xs dim leads-sub">{t(m.status === 'draft' ? 'leads.won.mailDraft' : 'leads.won.mailOther')}</span></span>{!live && <DemoTag />}</A>
        ))}
        {can('appointments') && appts.map((a) => (
          <A key={a.id} to={`/appointments/${a.id}`} className="item click"><LuCalendarClock aria-hidden="true" className="leads-ico" />
            <span className="grow"><span className="t">{t('leads.visitOn', { date: `${day(a.date)}, ${time(a.time)}` })}</span><span className="xs dim leads-sub">{byId(data.users, a.staffId)?.name ?? ''}</span></span></A>
        ))}
      </div>
      {!jobs.length && <p className="small muted">{t('leads.wonNote')}</p>}
    </Card>
  );
}
