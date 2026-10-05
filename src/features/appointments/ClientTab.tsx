// A client's appointments, on the client page: what is coming, what happened, and the credits the client holds.
// Registered in src/features/clients/tabs.ts.
import { useState } from 'react';
import { LuCalendarPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Button, Card } from '@/ui';
import { byId } from '@/domain/selectors';
import { activeCredits, creditBalance, isOpenAppt, wasMoved } from '@/domain/actions/appointments';
import type { Appointment } from '@/domain/types';
import { today } from '@/lib/dates';
import { money2 } from '@/lib/money';
import type { ClientTabProps } from '@/features/clients/tabs';
import { ApptStatusBadge, BookModal, CreditStateBadge, FeeLine, byWhen, useTypeName } from './parts';
import './appointments.css';

export default function AppointmentsClientTab({ client }: ClientTabProps) {
  const { t, data, can, day, time, date, dateTime } = useApp();
  const typeName = useTypeName();
  const [book, setBook] = useState(false);
  const td = today();
  // the earlier slot of a moved appointment is part of that appointment's own history, not a second entry here
  const all = data.appointments.filter((a) => a.clientId === client.id && !wasMoved(data, a));
  const upcoming = all.filter((a) => isOpenAppt(a) && a.date >= td).sort(byWhen);
  const history = all.filter((a) => !upcoming.includes(a)).sort((a, b) => byWhen(b, a));
  const credits = data.credits.filter((c) => c.clientId === client.id).sort((a, b) => b.at.localeCompare(a.at));
  const usable = activeCredits(data, client.id);
  const row = (a: Appointment) => (
    <A key={a.id} to={`/appointments/${a.id}`} className="item click appointments-item" data-appt={a.id}>
      <div className="grow">
        <div className="t">{day(a.date)}, {time(a.time)} · {typeName(a)}</div>
        <div className="small muted">{[byId(data.users, a.staffId)?.name, t('appointments.minutes', { n: a.minutes })].filter(Boolean).join(' · ')}{can('money') && a.fee > 0 ? <> · <FeeLine appt={a} /></> : null}</div>
      </div>
      <ApptStatusBadge appt={a} />
    </A>
  );
  return (
    <div className="stack">
      <Card title={t('common.upcoming')} actions={can('write') && can('appointments') ? <Button size="sm" icon={<LuCalendarPlus aria-hidden="true" />} onClick={() => setBook(true)} data-testid="clients-appt-book">{t('appointments.book')}</Button> : undefined}>
        <div data-testid="clients-appt-upcoming">{upcoming.length ? <div className="list">{upcoming.map(row)}</div> : <p className="muted small">{t('appointments.client.noUpcoming')}</p>}</div>
      </Card>
      {can('money') && (
        <Card title={t('appointments.credits')} actions={credits.length ? <A to={`/appointments/credits?client=${client.id}`} className="linkbtn small">{t('appointments.cr.openLedger')}</A> : undefined}>
          <div data-testid="clients-appt-credits">
            <p><span className="appointments-figure appointments-balance">{money2(creditBalance(data, client.id))}</span> <span className="small muted">{t('appointments.client.balance', { n: usable.length })}</span></p>
            {credits.length > 0 && (
              <div className="list appointments-gap">
                {credits.map((c) => (
                  <div key={c.id} className="item">
                    <div className="grow"><div className="t">{money2(c.amount)} <CreditStateBadge credit={c} /></div>
                      <div className="small muted">{t('appointments.cr.why.' + c.reason)} · {dateTime(c.at)} · {c.expires ? t('appointments.cr.expiresOn', { date: date(c.expires) }) : t('appointments.cr.noExpiry')}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
      <Card title={t('appointments.client.history')}>
        <div data-testid="clients-appt-history">{history.length ? <div className="list">{history.map(row)}</div> : <p className="muted small">{t('appointments.client.noHistory')}</p>}</div>
      </Card>
      {book && <BookModal defaults={{ clientId: client.id }} onClose={() => setBook(false)} />}
    </div>
  );
}
