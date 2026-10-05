// One appointment: what it is, where it stands, its payment and credit, its notes, and what it is linked to.
import { useState } from 'react';
import { LuBan, LuCalendarClock, LuCalendarPlus, LuCheck, LuCircleCheck, LuCreditCard, LuLink, LuMapPin, LuPencil, LuTicket, LuUserX, LuVideo } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, FormModal, Note, PageHeader, confirmDialog, toast } from '@/ui';
import { byId } from '@/domain/selectors';
import {
  acceptAppointment, activeCredits, apptBalance, completeAppointment, confirmAppointment, creditState, earlierSlots, holdsSlot, isOpenAppt, markNoShow, movedTo, movesBlocked,
  noShowCount, personOf, rescheduleCount, startOf, toCents, typeOfAppt, updateAppointment, wasMoved, apptPolicy,
} from '@/domain/actions/appointments';
import type { Appointment } from '@/domain/types';
import { money2 } from '@/lib/money';
import { gcalUrl } from '@/features/calendar/gcal';
import { ApptStatusBadge, CancelModal, CreditModal, CreditStateBadge, ModeIcon, MoveModal, PayModal, PersonLink, mapsUrl, useAppointments, useConnections, useProblemText, useTypeName } from './parts';

type Dialog = 'move' | 'pay' | 'cancel' | 'credit' | 'fee' | null;

export function ApptDetail({ id }: { id: string }) {
  const { t } = useApp();
  // an appointment of a client the viewer may not open is not found, the same as on the client list
  const a = useAppointments().find((x) => x.id === id);
  if (!a) return <Empty title={t('appointments.notFound')} action={<A to="/appointments" className="btn">{t('appointments.back')}</A>} />;
  return <ApptPage key={a.id} a={a} />;
}

function ApptPage({ a }: { a: Appointment }) {
  const { t, data, can, day, time, date, dateTime } = useApp();
  const typeName = useTypeName(); const problem = useProblemText(); const conn = useConnections();
  const [dialog, setDialog] = useState<Dialog>(null);

  const person = personOf(data, a); const staff = byId(data.users, a.staffId); const office = byId(data.offices, a.officeId);
  const job = byId(data.jobs, a.jobId); const type = typeOfAppt(data, a);
  const mayChange = can('write') && can('appointments'); const money = can('money');
  const started = startOf(a).getTime() <= Date.now();
  const moved = wasMoved(data, a); const later = movedTo(data, a);
  const balance = apptBalance(a);
  const credits = data.credits.filter((c) => c.fromApptId === a.id);
  const usable = a.clientId ? activeCredits(data, a.clientId) : [];
  const payable = !moved && !a.paid && a.fee > 0 && (holdsSlot(a) || a.status === 'completed');
  const tasks = data.tasks.filter((x) => x.apptId === a.id);
  const misses = noShowCount(data, a); const limit = apptPolicy(data).noShowLimit;

  const done = (r: ReturnType<typeof confirmAppointment>, msg: string) => { if (r.ok) toast(msg); else toast(problem(r), true); };
  const noShow = async () => { if (await confirmDialog(t(a.paid ? 'appointments.noShow.askPaid' : 'appointments.noShow.ask'), t('appointments.noShow'), t('common.cancel'))) done(act(markNoShow, a.id), t('appointments.noShow.done')); };
  const [notes, setNotes] = useState(a.notes ?? '');
  const saveNotes = () => { act(updateAppointment, a.id, { notes }); toast(t('common.saved')); };

  // what happened, in order. Times come from the record; a step the record keeps no time for shows without one.
  const stamp = (kind: string) => data.activity.find((x) => x.ref.type === 'appointment' && x.ref.id === a.id && x.kind === 'appointment.' + kind)?.at;
  const by = (uid: string | undefined) => byId(data.users, uid)?.name ?? t(uid === 'automation' ? 'common.automation' : 'common.system');
  const steps: { key: string; text: string; at?: string; sub?: string; auto?: boolean }[] = [
    { key: 'booked', text: t(a.createdBy === 'system' ? 'appointments.tl.requested' : 'appointments.tl.booked'), at: a.created, sub: by(a.createdBy) },
    ...[...earlierSlots(data, a)].reverse().map((e) => ({ key: 'm' + e.id, text: t('appointments.tl.moved', { from: `${day(e.date)}, ${time(e.time)}` }),
      sub: [t(e.status === 'cancelled_client' ? 'appointments.tl.askedClient' : 'appointments.tl.askedStaff'), e.cancelReason].filter(Boolean).join(' · ') })),
    ...(a.payBy ? [{ key: 'due', text: t('appointments.tl.payBy', { when: dateTime(a.payBy) }) }] : []),
    ...(a.paid ? [{ key: 'paid', at: a.paid.at, text: a.paid.method === 'credit' ? t('appointments.tl.paidCredit') : t('appointments.tl.paid'),
      sub: money ? [money2(a.paid.amount), a.paid.method === 'credit' ? '' : t('m_' + a.paid.method), a.paid.method !== 'credit' && a.paid.ref ? t('appointments.tl.ref', { ref: a.paid.ref }) : ''].filter(Boolean).join(' · ') : undefined }] : []),
    ...(a.status === 'confirmed' && !a.paid ? [{ key: 'confirmed', text: t('appointments.tl.confirmed'), at: stamp('confirmed') }] : []),
    ...(a.status === 'completed' ? [{ key: 'completed', text: t('appointments.tl.completed'), at: stamp('completed') }] : []),
    ...(a.status === 'no_show' ? [{ key: 'no_show', text: t('appointments.tl.no_show'), at: stamp('no_show') }] : []),
    ...(a.status === 'cancelled_unpaid' ? [{ key: 'unpaid', text: t('appointments.tl.cancelled_unpaid'), at: stamp('unpaid'), auto: true }] : []),
    ...(!moved && (a.status === 'cancelled_client' || a.status === 'cancelled_staff') ? [{ key: 'cancelled', text: t('appointments.tl.' + a.status), at: stamp(a.status), sub: a.cancelReason }] : []),
    ...(moved && later ? [{ key: 'later', text: t('appointments.tl.movedTo', { to: `${day(later.date)}, ${time(later.time)}` }), sub: a.cancelReason }] : []),
    ...(money ? credits.map((c) => ({ key: c.id, at: c.at, text: t('appointments.tl.credit', { amount: money2(c.amount) }), sub: t('appointments.cr.why.' + c.reason) })) : []),
  ];

  const actions = !mayChange || moved ? null : (
    <>
      {a.status === 'requested' && <Button variant="primary" icon={<LuCheck />} onClick={() => done(act(acceptAppointment, a.id), t('appointments.accepted'))} data-testid="appointments-accept">{t('appointments.accept')}</Button>}
      {a.status === 'awaiting_payment' && money && <Button variant="primary" icon={<LuCreditCard />} onClick={() => setDialog('pay')} data-testid="appointments-pay">{t('appointments.pay.title')}</Button>}
      {a.status === 'scheduled' && !started && <Button variant="primary" icon={<LuCheck />} onClick={() => done(act(confirmAppointment, a.id), t('appointments.confirmed'))} data-testid="appointments-confirm">{t('appointments.confirm')}</Button>}
      {(a.status === 'scheduled' || a.status === 'confirmed') && started && <Button variant="primary" icon={<LuCircleCheck />} onClick={() => done(act(completeAppointment, a.id), t('appointments.completed'))} data-testid="appointments-complete">{t('appointments.complete')}</Button>}
      {holdsSlot(a) && started && <Button icon={<LuUserX />} onClick={noShow} data-testid="appointments-noshow">{t('appointments.noShow')}</Button>}
      {holdsSlot(a) && <Button icon={<LuCalendarClock />} onClick={() => setDialog('move')} data-testid="appointments-move">{t('appointments.move')}</Button>}
      {isOpenAppt(a) && <Button variant="ghost" icon={<LuBan />} onClick={() => setDialog('cancel')} data-testid="appointments-cancel">{t(a.status === 'requested' ? 'appointments.decline' : 'appointments.cancel.title')}</Button>}
    </>
  );

  return (
    <>
      <BackLink to="/appointments">{t('appointments.back')}</BackLink>
      <PageHeader title={<>{person?.name ?? typeName(a)} <ApptStatusBadge appt={a} /></>} sub={`${typeName(a)} · ${day(a.date)}, ${time(a.time)} · ${t('appointments.minutes', { n: a.minutes })}`} actions={actions ?? undefined} />

      {moved && later && <div className="appointments-banner"><Note>{t('appointments.movedBanner')} <A to={`/appointments/${later.id}`}>{t('appointments.openCurrent')}</A></Note></div>}
      {holdsSlot(a) && started && <div className="appointments-banner"><Note tone="warn">{t('appointments.outcomeBanner')}</Note></div>}

      <div className="split">
        <div className="stack">
          <Card title={t('common.details')}>
            <dl className="kv" data-testid="appointments-details">
              <dt>{t('appointments.col.when')}</dt><dd>{day(a.date)}, {time(a.time)} <span className="dim">· {t('appointments.minutes', { n: a.minutes })}</span></dd>
              <dt>{t('appointments.col.with')}</dt><dd><PersonLink appt={a} />{person?.kind === 'lead' && <span className="dim"> · {t('appointments.lead')}</span>}{person?.company ? <span className="dim"> · {person.company}</span> : null}</dd>
              <dt>{t('common.assignedTo')}</dt><dd>{staff?.name ?? t('common.unassigned')}</dd>
              <dt>{t('common.type')}</dt><dd>{typeName(a)}{type?.buffer ? <span className="dim"> · {t('appointments.bufferNote', { n: type.buffer })}</span> : null}</dd>
              <dt>{t('appointments.f.mode')}</dt><dd><span className="appointments-type"><ModeIcon mode={a.mode} />{t('appointments.mode.' + a.mode)}</span></dd>
              {office && <><dt>{t('appointments.f.office')}</dt><dd>{office.name}</dd></>}
              {a.location && <><dt>{t('appointments.f.place')}</dt><dd>{a.location} <a className="appointments-inline" href={mapsUrl(a.location)} target="_blank" rel="noopener noreferrer" data-testid="appointments-map"><LuMapPin aria-hidden="true" />{t('appointments.map')}</a></dd></>}
              {a.mode === 'video' && (a.meetUrl || isOpenAppt(a)) && <><dt>{t('appointments.video')}</dt><dd>{a.meetUrl
                ? <a href={a.meetUrl} target="_blank" rel="noopener noreferrer" data-testid="appointments-meet"><LuVideo aria-hidden="true" className="appointments-ico" />{t('appointments.video.join')}</a>
                : <span className="muted" data-testid="appointments-no-meet">{t(conn('gmeet') === 'connected' ? 'appointments.video.none' : 'appointments.video.notConnected')}</span>}</dd></>}
              {job && <><dt>{t('project')}</dt><dd><A to={`/jobs/${job.id}`}>{job.name}</A> <span className="dim">· {job.number}</span></dd></>}
              {rescheduleCount(data, a) > 0 && <><dt>{t('appointments.moves')}</dt><dd>{rescheduleCount(data, a)}</dd></>}
              {misses > 0 && <><dt>{t('appointments.noShows')}</dt><dd>{misses}{limit > 0 && movesBlocked(data, a) ? <span className="dim"> · {t('appointments.noShows.blocked', { n: limit })}</span> : null}</dd></>}
            </dl>
            {person && (person.phone || person.email) && <p className="small muted appointments-contact">{[person.phone, person.email].filter(Boolean).join(' · ')}</p>}
          </Card>

          {money && (
            <Card title={t('appointments.payment')} className={a.status === 'awaiting_payment' ? 'raised' : undefined}>
              <div data-testid="appointments-payment">
                {!(a.fee > 0) ? <p className="muted">{t('appointments.pay.free')}</p> : (
                  <>
                    <dl className="kv">
                      <dt>{t('appointments.col.fee')}</dt><dd>{money2(a.fee)}{mayChange && !a.paid && isOpenAppt(a) && <button type="button" className="linkbtn small appointments-inline" onClick={() => setDialog('fee')}><LuPencil aria-hidden="true" />{t('appointments.pay.changeFee')}</button>}</dd>
                      {a.paid ? <>
                        <dt>{t('common.paid')}</dt><dd className="appointments-paid">{money2(a.paid.amount)} <span className="dim">· {a.paid.method === 'credit' ? t('appointments.paidCredit') : t('m_' + a.paid.method)}{a.paid.method !== 'credit' && a.paid.ref ? ` · ${t('appointments.tl.ref', { ref: a.paid.ref })}` : ''} · {dateTime(a.paid.at)}</span></dd>
                      </> : <>
                        <dt>{t('appointments.pay.toPay')}</dt><dd>{money2(balance)}</dd>
                        {a.status === 'awaiting_payment' && a.payBy && <><dt>{t('appointments.pay.by')}</dt><dd><Badge tone="warn">{dateTime(a.payBy)}</Badge></dd></>}
                      </>}
                    </dl>
                    {a.status === 'awaiting_payment' && <p className="small muted appointments-gap">{t('appointments.pay.releaseNote')}</p>}
                    {a.status === 'cancelled_unpaid' && <p className="small muted appointments-gap">{t('appointments.pay.released')}</p>}
                    {payable && mayChange && (
                      <div className="row appointments-gap">
                        {/* while it waits for payment, recording it is the main action at the top of the page */}
                        {a.status !== 'awaiting_payment' && <Button size="sm" variant="primary" icon={<LuCreditCard />} onClick={() => setDialog('pay')} data-testid="appointments-pay-2">{t('appointments.pay.title')}</Button>}
                        {a.clientId && can('credits') && usable.length > 0 && <Button size="sm" icon={<LuTicket />} onClick={() => setDialog('credit')} data-testid="appointments-use-credit">{t('appointments.cr.use')}</Button>}
                        {/* a link that takes a card payment needs the payment provider; until it is connected this stays off and says why */}
                        <Button size="sm" variant="ghost" icon={<LuLink />} disabled aria-describedby="appt-link-why" data-testid="appointments-pay-link">{t('appointments.pay.link')}</Button>
                      </div>
                    )}
                    {payable && mayChange && <p id="appt-link-why" className="xs dim appointments-gap">{t(conn('square') === 'connected' ? 'appointments.pay.linkSoon' : 'appointments.pay.linkOff')}</p>}
                    {payable && a.clientId && usable.length > 0 && !usable.some((c) => toCents(c.amount) >= toCents(a.fee)) && <p className="xs dim">{t('appointments.cr.noneCovers')}</p>}
                    <p className="xs dim appointments-gap">{t('appointments.pay.honest')}</p>
                  </>
                )}
                {credits.length > 0 && (
                  <div className="appointments-credits">
                    <div className="label">{t('appointments.cr.fromThis')}</div>
                    <div className="list">
                      {credits.map((c) => (
                        <div key={c.id} className="item" data-credit={c.id}>
                          <div className="grow"><div className="t">{money2(c.amount)} <CreditStateBadge credit={c} /></div>
                            <div className="small muted">{t('appointments.cr.why.' + c.reason)} · {c.expires ? t('appointments.cr.expiresOn', { date: date(c.expires) }) : t('appointments.cr.noExpiry')}
                              {c.used ? <> · <A to={`/appointments/${c.used.apptId}`}>{t('appointments.cr.usedOn', { date: dateTime(c.used.at) })}</A></> : null}</div></div>
                        </div>
                      ))}
                    </div>
                    <A to={`/appointments/credits${a.clientId ? `?client=${a.clientId}` : ''}`} className="linkbtn small">{t('appointments.cr.openLedger')}</A>
                  </div>
                )}
                {a.creditId && byId(data.credits, a.creditId) && creditState(byId(data.credits, a.creditId)!) === 'used' && <p className="small muted appointments-gap">{t('appointments.cr.paidWith')} <A to={`/appointments/credits${a.clientId ? `?client=${a.clientId}` : ''}`}>{t('appointments.cr.openLedger')}</A></p>}
              </div>
            </Card>
          )}

          <Card title={t('common.notes')}>
            {mayChange ? (
              <>
                <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('appointments.notesPh')} aria-label={t('common.notes')} data-testid="appointments-notes" />
                <div className="row appointments-gap"><Button size="sm" onClick={saveNotes} disabled={notes.trim() === (a.notes ?? '')} data-testid="appointments-notes-save">{t('common.save')}</Button></div>
              </>
            ) : <p className={a.notes ? undefined : 'muted small'}>{a.notes || t('appointments.noNotes')}</p>}
          </Card>
        </div>

        <div className="stack">
          <Card title={t('appointments.timeline')}>
            <ol className="timeline" data-testid="appointments-timeline">
              {steps.map((s) => <li key={s.key} className={s.auto ? 'auto' : undefined}><span>{s.text}</span><time>{[s.at ? dateTime(s.at) : '', s.sub].filter(Boolean).join(' · ')}</time></li>)}
            </ol>
          </Card>
          {!moved && isOpenAppt(a) && (
            <Card title={t('appointments.cal.title')}>
              <a className="btn sm" href={gcalUrl({ date: a.date, time: a.time, minutes: a.minutes, title: `${typeName(a)}: ${person?.name ?? ''}`, where: a.location, detail: [staff?.name, person?.phone].filter(Boolean).join(' · '), note: a.meetUrl })}
                target="_blank" rel="noopener noreferrer" data-testid="appointments-add-google"><LuCalendarPlus aria-hidden="true" />{t('calendar.addGoogleFor', { title: person?.name ?? typeName(a) })}</a>
              <p className="xs dim appointments-gap" data-testid="appointments-sync-state">{t(conn('gcal') === 'connected' ? 'appointments.cal.synced' : 'appointments.cal.notConnected')}</p>
            </Card>
          )}
          {tasks.length > 0 && can('tasks') && (
            <Card title={t('nav.tasks')}>
              <div className="list">{tasks.map((x) => <div key={x.id} className="item"><A to={`/tasks?task=${x.id}`} className="t">{x.title}</A></div>)}</div>
            </Card>
          )}
        </div>
      </div>

      {dialog === 'move' && <MoveModal appt={a} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PayModal appt={a} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelModal appt={a} onClose={() => setDialog(null)} />}
      {dialog === 'credit' && <CreditModal appt={a} onClose={() => setDialog(null)} />}
      {dialog === 'fee' && (
        <FormModal title={t('appointments.pay.changeFee')} initial={{ fee: a.fee }} onClose={() => setDialog(null)} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
          fields={[{ k: 'fee', label: t('appointments.col.fee'), type: 'money', req: true, full: true, hint: t('appointments.pay.feeHint') }]}
          onSave={(v) => { const r = act(updateAppointment, a.id, { fee: v.fee }); if (r.ok) toast(t('common.saved')); else toast(problem(r), true); }} />
      )}
    </>
  );
}
