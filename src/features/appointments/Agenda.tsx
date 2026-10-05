// Agenda: the day or the week of each team member. The day is drawn to scale (an hour is always the same height), with the
// minutes kept free after an appointment shown as a hatched tail, so a free gap can be seen at a glance.
// On a phone the columns become one list per person.
import { useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Avatar, Badge, Button, Card, IconButton, Seg, cx } from '@/ui';
import { hoursOf, isCancelled, minutesOf, personOf, typeOfAppt } from '@/domain/actions/appointments';
import type { Appointment, TeamUser } from '@/domain/types';
import { addDaysFrom, fmtDate, parseDate, today } from '@/lib/dates';
import { ApptStatusBadge, byWhen, useStaff, useTypeName, type BookDefaults } from './parts';

type Span = 'day' | 'week';
/** Height of one minute in the day view, in pixels. */
const PX = 1.1;

function useMedia(query: string) {
  const [hit, setHit] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query); const on = () => setHit(m.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, [query]);
  return hit;
}
const awayOn = (u: TeamUser, date: string) => !!u.away && u.away.from <= date && date <= u.away.to;
/** Monday of the week a date is in. */
const weekStart = (date: string) => { const dow = parseDate(date).getDay(); return addDaysFrom(date, dow === 0 ? -6 : 1 - dow); };

export function Agenda({ appointments, onBook }: { appointments: Appointment[]; onBook?: (d: BookDefaults) => void }) {
  const { t, data, lang } = useApp();
  const staff = useStaff();
  const phone = useMedia('(max-width: 760px)');
  const td = today();
  const [span, setSpan] = useState<Span>('day');
  const [date, setDate] = useState(td);
  const [who, setWho] = useState('');
  const people = staff.filter((u) => !who || u.id === who);
  // what stands on an agenda: everything except what was cancelled (the earlier slot of a moved appointment is one of those)
  const shown = appointments.filter((a) => !isCancelled(a));
  const step = span === 'day' ? 1 : 7;
  const from = span === 'day' ? date : weekStart(date);
  const days = span === 'day' ? [date] : [...Array(7)].map((_, i) => addDaysFrom(from, i)).filter((d) => hoursOf(data).days.includes(parseDate(d).getDay()) || shown.some((a) => a.date === d));
  const title = span === 'day'
    ? fmtDate(date, lang, { weekday: 'long', month: 'long', day: 'numeric' })
    : t('appointments.ag.range', { from: fmtDate(days[0] ?? from, lang, { month: 'short', day: 'numeric' }), to: fmtDate(days[days.length - 1] ?? from, lang, { month: 'short', day: 'numeric', year: 'numeric' }) });

  return (
    <>
      <div className="appointments-agbar">
        <div className="row tight nowrap">
          <IconButton label={t(span === 'day' ? 'appointments.ag.prevDay' : 'appointments.ag.prevWeek')} className="appointments-nav" onClick={() => setDate(addDaysFrom(date, -step))} data-testid="appointments-ag-prev"><LuChevronLeft /></IconButton>
          <Button size="sm" onClick={() => setDate(td)} data-testid="appointments-ag-today">{t('common.today')}</Button>
          <IconButton label={t(span === 'day' ? 'appointments.ag.nextDay' : 'appointments.ag.nextWeek')} className="appointments-nav" onClick={() => setDate(addDaysFrom(date, step))} data-testid="appointments-ag-next"><LuChevronRight /></IconButton>
        </div>
        <h2 className="appointments-agtitle" aria-live="polite" data-testid="appointments-ag-title">{title}</h2>
        <span className="grow" />
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('common.assignedTo')} data-testid="appointments-ag-staff">
          <option value="">{t('appointments.all.staff')}</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <Seg label={t('appointments.ag.span')} value={span} onChange={setSpan} options={[{ value: 'day', label: t('appointments.ag.day') }, { value: 'week', label: t('appointments.ag.week') }]} />
      </div>
      {!people.length ? <Card><p className="muted">{t('appointments.ag.noPeople')}</p></Card>
        : span === 'week' ? <Week people={people} days={days} list={shown} onBook={onBook} phone={phone} />
          : phone ? <DayLists people={people} date={date} list={shown} onBook={onBook} />
            : <DayGrid people={people} date={date} list={shown} onBook={onBook} />}
    </>
  );
}

/** One appointment as a block or a row: time, who with, what, and its status. */
function Block({ a, style, compact }: { a: Appointment; style?: React.CSSProperties; compact?: boolean }) {
  const { data, time, t } = useApp();
  const typeName = useTypeName();
  const p = personOf(data, a);
  return (
    <A to={`/appointments/${a.id}`} className={cx('appointments-block-a', 's-' + a.status)} style={style} data-appt={a.id}
      title={`${time(a.time)} · ${p?.name ?? ''} · ${typeName(a)} · ${t('appointments.st.' + a.status)}`}>
      <span className="appointments-b1"><span className="appointments-bt">{time(a.time)}</span><b>{p?.name ?? t('appointments.noPerson')}</b></span>
      {!compact && <span className="appointments-bs">{typeName(a)}</span>}
    </A>
  );
}
function ColumnHead({ u, date, onBook }: { u: TeamUser; date: string; onBook?: (d: BookDefaults) => void }) {
  const { t } = useApp();
  const away = awayOn(u, date);
  return (
    <div className="appointments-colh">
      <Avatar name={u.name} size="sm" /><span className="grow clip">{u.name}</span>
      {away && <Badge tone="warn">{t('appointments.away')}</Badge>}
      {onBook && !away && date >= today() && <IconButton size="sm" label={t('appointments.bookFor', { name: u.name })} onClick={() => onBook({ staffId: u.id, date })}><LuPlus /></IconButton>}
    </div>
  );
}

function DayGrid({ people, date, list, onBook }: { people: TeamUser[]; date: string; list: Appointment[]; onBook?: (d: BookDefaults) => void }) {
  const { t, data, time } = useApp();
  const hours = hoursOf(data);
  const todays = list.filter((a) => a.date === date && people.some((u) => u.id === a.staffId));
  // the office hours, widened to whole hours so that an early or late appointment is never cut off
  const first = Math.floor(Math.min(minutesOf(hours.open), ...todays.map((a) => minutesOf(a.time))) / 60) * 60;
  const last = Math.ceil(Math.max(minutesOf(hours.close), ...todays.map((a) => minutesOf(a.time) + a.minutes)) / 60) * 60;
  const marks = [...Array((last - first) / 60 + 1)].map((_, i) => first + i * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const closed = !hours.days.includes(parseDate(date).getDay());
  return (
    <Card flush className="appointments-day">
      <div className="appointments-scroll">
        <div className="appointments-grid" style={{ gridTemplateColumns: `76px repeat(${people.length}, minmax(168px, 1fr))`, minWidth: 76 + people.length * 168 }} data-testid="appointments-day-grid">
          <div className="appointments-corner" />
          {people.map((u) => <ColumnHead key={u.id} u={u} date={date} onBook={onBook} />)}
          <div className="appointments-hours" style={{ height: (last - first) * PX }} aria-hidden="true">
            {marks.slice(0, -1).map((m) => <span key={m} style={{ top: (m - first) * PX }}>{time(`${pad(m / 60)}:00`)}</span>)}
          </div>
          {people.map((u) => (
            <div key={u.id} className={cx('appointments-col', (awayOn(u, date) || closed) && 'off')} style={{ height: (last - first) * PX, backgroundSize: `100% ${60 * PX}px` }} data-staff={u.id}>
              {date === today() && nowMin >= first && nowMin <= last && <i className="appointments-now" style={{ top: (nowMin - first) * PX }} aria-hidden="true" />}
              {todays.filter((a) => a.staffId === u.id).sort(byWhen).map((a) => {
                const top = (minutesOf(a.time) - first) * PX; const buffer = a.status === 'completed' || a.status === 'no_show' ? 0 : typeOfAppt(data, a)?.buffer ?? 0;
                return (
                  <div key={a.id}>
                    <Block a={a} style={{ top, height: Math.max(a.minutes * PX, 30) }} compact={a.minutes < 45} />
                    {buffer > 0 && <i className="appointments-buffer" style={{ top: top + Math.max(a.minutes * PX, 30), height: buffer * PX }} title={t('appointments.bufferNote', { n: buffer })} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {!todays.length && <p className="muted small appointments-daynone">{t(closed ? 'appointments.ag.closed' : 'appointments.ag.noneDay')}</p>}
    </Card>
  );
}

/** Phone: the same day, one list per person. */
function DayLists({ people, date, list, onBook }: { people: TeamUser[]; date: string; list: Appointment[]; onBook?: (d: BookDefaults) => void }) {
  const { t } = useApp();
  return (
    <div className="stack" data-testid="appointments-day-lists">
      {people.map((u) => {
        const mine = list.filter((a) => a.date === date && a.staffId === u.id).sort(byWhen);
        return (
          <Card key={u.id} flush>
            <ColumnHead u={u} date={date} onBook={onBook} />
            <div className="appointments-rows">{mine.length ? mine.map((a) => <Row key={a.id} a={a} />) : <p className="muted small">{t('appointments.ag.free')}</p>}</div>
          </Card>
        );
      })}
    </div>
  );
}
function Row({ a }: { a: Appointment }) {
  const { data, time } = useApp();
  const typeName = useTypeName();
  return (
    <A to={`/appointments/${a.id}`} className="appointments-row" data-appt={a.id}>
      <span className="appointments-bt">{time(a.time)}</span>
      <span className="grow"><b>{personOf(data, a)?.name ?? ''}</b><span className="small muted appointments-block">{typeName(a)}</span></span>
      <ApptStatusBadge appt={a} />
    </A>
  );
}

function Week({ people, days, list, onBook, phone }: { people: TeamUser[]; days: string[]; list: Appointment[]; onBook?: (d: BookDefaults) => void; phone: boolean }) {
  const { t, lang } = useApp();
  const td = today();
  // "Mon 5", the weekday first in every language
  const head = (d: string) => `${fmtDate(d, lang, { weekday: 'short' })} ${parseDate(d).getDate()}`;
  if (phone) {
    return (
      <div className="stack" data-testid="appointments-week-lists">
        {days.map((d) => {
          const mine = list.filter((a) => a.date === d && people.some((u) => u.id === a.staffId)).sort(byWhen);
          return (
            <Card key={d} title={<span className="appointments-cap">{fmtDate(d, lang, { weekday: 'long', month: 'short', day: 'numeric' })}</span>} actions={d === td ? <Badge tone="accent">{t('common.today')}</Badge> : undefined}>
              <div className="appointments-rows flat">{mine.length ? mine.map((a) => <Row key={a.id} a={a} />) : <p className="muted small">{t('appointments.ag.free')}</p>}</div>
            </Card>
          );
        })}
      </div>
    );
  }
  return (
    <Card flush className="appointments-week">
      <div className="appointments-scroll">
        <table className="appointments-wk" data-testid="appointments-week-grid">
          <thead><tr><th />{days.map((d) => <th key={d} className={cx(d === td && 'today')}><span className="appointments-cap">{head(d)}</span></th>)}</tr></thead>
          <tbody>
            {people.map((u) => (
              <tr key={u.id}>
                <th scope="row"><span className="row tight nowrap"><Avatar name={u.name} size="sm" /><span className="clip">{u.name}</span></span></th>
                {days.map((d) => {
                  const mine = list.filter((a) => a.date === d && a.staffId === u.id).sort(byWhen); const away = awayOn(u, d);
                  return (
                    <td key={d} className={cx(away && 'off', d === td && 'today')}>
                      {away && <span className="xs dim">{t('appointments.away')}</span>}
                      {mine.map((a) => <Block key={a.id} a={a} compact />)}
                      {onBook && !away && d >= td && <button type="button" className="appointments-add" aria-label={t('appointments.bookForOn', { name: u.name, date: head(d) })} onClick={() => onBook({ staffId: u.id, date: d })}><LuPlus aria-hidden="true" /></button>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
