// Calendar: a month grid and an agenda over the same events (visits, follow-ups, job dates, repeat visits, task deadlines).
// Where the edition has the appointments screen, booked appointments stand here too, with their own look.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCalendarDays, LuCalendarCheck2, LuList, LuPlus, LuCalendarPlus, LuCalendarClock, LuMapPin, LuRefreshCw, LuSend, LuVideo } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, go, navigate, refPath, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Badge, Button, Card, FormModal, IconButton, PageHeader, Seg, cx, toast } from '@/ui';
import { DemoTag, PlanBadge, PriorityBadge, CanWrite } from '@/app/shared';
import { TaskFormModal } from '@/app/forms';
import { updateLead } from '@/domain/actions';
import { byId, isOpenLead } from '@/domain/selectors';
import { moduleOn } from '@/domain/config';
import { visibleAppointments } from '@/domain/actions/appointments';
import { gateway } from '@/platform/gateway';
import type { ConnState, Priority } from '@/domain/types';
import { planName } from '@/lib/pricing';
import { addDays, daysBetween, fmtDate, monthLabel, today } from '@/lib/dates';
import { gcalUrl, googleItem, kindLabel, type CalItem, type CalKind } from './gcal';
import { calendarItems } from './items';
import '@/features/leads/work.css';
import './calendar.css';

const KINDS: CalKind[] = ['meet', 'appt', 'follow', 'start', 'visit', 'end', 'task'];
/** A plain maps search for an address: a link, no key and nobody's location. */
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
type View = 'month' | 'agenda';
type Range = 'month' | 'next30' | 'week' | 'today' | 'overdue' | 'custom';
const RANGES: Range[] = ['month', 'next30', 'week', 'today', 'overdue', 'custom'];
const pad = (n: number) => String(n).padStart(2, '0');

function useMedia(query: string) {
  const [hit, setHit] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query); const on = () => setHit(m.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, [query]);
  return hit;
}
function shiftMonth(ym: string, n: number) { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
const monthEnd = (ym: string) => `${ym}-${pad(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate())}`;

export default function CalendarPage(_: PageProps) {
  const { t, data, lang, pack, can, standing, user, perms } = useApp();
  const route = useRoute();
  const phone = useMedia('(max-width: 720px)');
  const td = today();
  const thisMonth = td.slice(0, 7);
  const viewParam = route.query.get('view');
  const view: View = viewParam === 'agenda' || viewParam === 'month' ? viewParam : phone ? 'agenda' : 'month';
  const mParam = route.query.get('m');
  const month = mParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(mParam) ? mParam : thisMonth;

  const [day, setDay] = useState(td);
  const [off, setOff] = useState<CalKind[]>([]);
  const [pri, setPri] = useState<'' | Priority>('');
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState(td);
  const [to, setTo] = useState(addDays(14));
  const [taskDue, setTaskDue] = useState<string | null>(null);
  const [visitDay, setVisitDay] = useState<string | null>(null);
  const dayRef = useRef<HTMLDivElement>(null);

  const pathFor = (v: View, m: string) => `/calendar?view=${v}${m !== thisMonth ? `&m=${m}` : ''}`;
  const show = (v: View) => navigate(appPath(pathFor(v, month)));
  const move = (m: string) => { setRange('month'); setDay(m === thisMonth ? td : `${m}-01`); navigate(appPath(pathFor(view, m)), { replace: true }); };
  const pick = (d: string) => { setDay(d); requestAnimationFrame(() => dayRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };

  const first = `${month}-01`; const last = monthEnd(month);
  // repeat visits are generated up to a horizon, so looking further ahead asks for more of them
  const horizon = Math.max(70, daysBetween(td, last) + 1, range === 'custom' && to ? daysBetween(td, to) + 1 : 0);
  // booked appointments join the calendar only where the edition has that screen and the viewer may open it
  const withAppts = moduleOn(data, pack, 'appointments') && can('appointments');
  const all = useMemo(() => calendarItems(data, horizon, withAppts ? visibleAppointments(data, user, perms) : null, lang), [data, horizon, withAppts, user, perms, lang]);
  const shown = useMemo(() => all.filter((e) => !off.includes(e.kind) && (!pri || (e.pri ?? 'medium') === pri)), [all, off, pri]);
  const kinds = KINDS.filter((k) => (k === 'meet' ? withAppts : k === 'appt' ? !withAppts : k !== 'visit' || pack.recurring || all.some((e) => e.kind === 'visit')));
  const filtered = off.length > 0 || !!pri;
  const clear = () => { setOff([]); setPri(''); };
  const toggle = (k: CalKind) => setOff((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  const coming = shown.filter((e) => !e.done && e.date >= td && e.date <= addDays(7));
  const openLeads = can('leads') ? data.leads.filter((l) => isOpenLead(l, data)) : [];
  const sync = standing('calendarSync'); const send = standing('calendarSend');
  const title = view === 'month' || range === 'month' ? monthLabel(month, lang) : t('calendar.rg.' + range);

  return (
    <>
      <PageHeader title={t('nav.calendar')} sub={t(withAppts ? 'calendar.subAppts' : 'calendar.sub')} actions={<>
        <Seg label={t('calendar.view')} value={view} onChange={show} options={[
          { value: 'month', label: <><LuCalendarDays aria-hidden="true" />{t('calendar.view.month')}</> }, { value: 'agenda', label: <><LuList aria-hidden="true" />{t('calendar.view.agenda')}</> }]} />
        <CanWrite><Button variant="primary" icon={<LuPlus />} onClick={() => setTaskDue(view === 'month' ? day : td)} data-testid="calendar-new-task">{t('calendar.newTask')}</Button></CanWrite>
      </>} />

      <div className="cal-bar">
        <div className="row tight nowrap">
          <IconButton label={t('calendar.prev')} className="cal-nav" onClick={() => move(shiftMonth(month, -1))} data-testid="calendar-prev"><LuChevronLeft /></IconButton>
          <Button size="sm" onClick={() => move(thisMonth)} data-testid="calendar-today">{t('calendar.today')}</Button>
          <IconButton label={t('calendar.next')} className="cal-nav" onClick={() => move(shiftMonth(month, 1))} data-testid="calendar-next"><LuChevronRight /></IconButton>
        </div>
        <h2 className="cal-title" aria-live="polite" data-testid="calendar-title">{title}</h2>
      </div>

      <div className="filters cal-filters">
        <div className="cal-legend" role="group" aria-label={t('calendar.show')} data-testid="calendar-legend">
          {kinds.map((k) => (
            <button key={k} type="button" className={cx('cal-tog', 'k-' + k)} aria-pressed={!off.includes(k)} onClick={() => toggle(k)} data-kind={k}><i className="cal-k" aria-hidden="true" />{kindLabel(t, k)}</button>
          ))}
        </div>
        <select value={pri} onChange={(e) => setPri(e.target.value as Priority | '')} aria-label={t('common.priority')} data-testid="calendar-filter-priority">
          <option value="">{t('calendar.allPri')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}
        </select>
        {view === 'agenda' && (
          <select value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label={t('calendar.range')} data-testid="calendar-range">
            {RANGES.map((r) => <option key={r} value={r}>{t('calendar.rg.' + r)}</option>)}
          </select>
        )}
        {view === 'agenda' && range === 'custom' && (
          <span className="row tight">
            <label className="small muted row tight nowrap">{t('calendar.from')} <input type="date" className="input cal-date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="small muted row tight nowrap">{t('calendar.to')} <input type="date" className="input cal-date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </span>
        )}
        {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
      </div>

      <div className="cal-layout">
        <div className="stack">
          {view === 'month'
            ? <MonthGrid month={month} events={shown} day={day} onPick={pick} />
            : <Agenda events={shown} range={range} month={month} from={from} to={to} filtered={filtered} onClear={clear} onNewTask={() => setTaskDue(td)} />}
        </div>

        <aside className="stack">
          {view === 'month' && (
            <div ref={dayRef}>
              <Card className="raised" title={<span className="cal-cap">{fmtDate(day, lang, { weekday: 'long', month: 'long', day: 'numeric' })}</span>} actions={day === td ? <Badge tone="accent">{t('calendar.today')}</Badge> : undefined}>
                <div data-testid="calendar-day">
                  <EventList events={shown.filter((e) => e.date === day)} empty={t('calendar.none')} compact />
                  <div className="row cal-dayacts">
                    <CanWrite><Button size="sm" icon={<LuPlus />} onClick={() => setTaskDue(day)} data-testid="calendar-day-task">{t('calendar.newTaskDay')}</Button></CanWrite>
                    {withAppts
                      ? day >= td && <CanWrite need="appointments"><Button size="sm" variant="ghost" icon={<LuCalendarClock />} onClick={() => go(`/appointments?new=1&date=${day}`)} data-testid="calendar-day-book">{t('calendar.bookDay')}</Button></CanWrite>
                      : openLeads.length > 0 && <CanWrite><Button size="sm" variant="ghost" icon={<LuCalendarClock />} onClick={() => setVisitDay(day)} data-testid="calendar-day-visit">{t('calendar.newVisit')}</Button></CanWrite>}
                  </div>
                </div>
              </Card>
            </div>
          )}

          <Card title={t('calendar.comingUp')} className="cal-coming">
            <div data-testid="calendar-coming">
              <EventList events={coming.slice(0, 6)} empty={t('calendar.comingNone')} showDate compact />
              {coming.length > 6 && <button type="button" className="linkbtn small cal-gap" onClick={() => { setRange('next30'); navigate(appPath(pathFor('agenda', thisMonth))); }}>+{t('calendar.more', { n: coming.length - 6 })}</button>}
            </div>
          </Card>

          <Card title={<><LuSend aria-hidden="true" className="cal-ico" />{t('calendar.g.send')}</>} actions={<PlanBadge feature="calendarSend" />}>
            <p className="small muted">{t('calendar.g.sendBody')}</p>
            {send.state === 'upgrade' && send.plan && <p className="xs dim cal-gap">{t('ent.upgradeHint', { plan: planName(send.plan, lang) })}</p>}
          </Card>

          {moduleOn(data, pack, 'integrations') ? <Connections /> : (
            <Card title={<><LuRefreshCw aria-hidden="true" className="cal-ico" />{t('calendar.g.sync')}</>} className="cal-sync">
              <div className="row tight" data-testid="calendar-sync"><PlanBadge feature="calendarSync" detail /><DemoTag kind="connect" /></div>
              <p className="small muted cal-gap">{t('calendar.g.syncBody')}</p>
              {sync.state === 'upgrade' && sync.plan && <p className="xs dim cal-gap">{t('ent.upgradeHint', { plan: planName(sync.plan, lang) })}</p>}
            </Card>
          )}
        </aside>
      </div>

      {taskDue && <TaskFormModal defaults={{ due: taskDue }} onClose={() => setTaskDue(null)} />}
      {visitDay && openLeads.length > 0 && (
        <FormModal title={`${t('calendar.visit.title')} · ${fmtDate(visitDay, lang, { weekday: 'short', month: 'short', day: 'numeric' })}`} initial={{ leadId: openLeads[0].id, time: '10:00' }} onClose={() => setVisitDay(null)}
          saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')}
          fields={[
            { k: 'leadId', label: t('calendar.visit.lead'), type: 'select', req: true, full: true, options: openLeads.map((l) => [l.id, `${l.name} · ${l.ticket}`]) },
            { k: 'time', label: t('calendar.visit.time'), type: 'time' },
          ]}
          onSave={(v) => { act(updateLead, v.leadId, { apptDate: visitDay, apptTime: v.time || undefined }); toast(t('calendar.visit.saved')); }} />
      )}
    </>
  );
}

/** An appointment that is not firm yet: a date on the lead that nobody booked, a request, or one still waiting for payment. */
const unsettled = (e: CalItem) => !e.appt || e.appt.status === 'requested' || e.appt.status === 'awaiting_payment';

/* ---------- Google Calendar and Meet: what is connected, as the server reports it ---------- */
function Connections() {
  const { t, can } = useApp();
  const [states, setStates] = useState<Partial<Record<'gcal' | 'gmeet', ConnState>>>({});
  useEffect(() => {
    let on = true;
    // in a sample workspace nothing is ever connected, and this says so
    gateway().integrations.list().then((list) => { if (on) setStates(Object.fromEntries(list.filter((c) => c.id === 'gcal' || c.id === 'gmeet').map((c) => [c.id, c.state]))); }, () => undefined);
    return () => { on = false; };
  }, []);
  const line = (id: 'gcal' | 'gmeet', name: string) => {
    const state = states[id] ?? 'not_connected';
    return <div className="row between nowrap cal-conn" data-testid={`calendar-conn-${id}`} data-state={state}><span className="small">{name}</span><Badge tone={state === 'connected' ? 'ok' : state === 'not_connected' ? 'neutral' : 'warn'} outline={state === 'not_connected'}>{t('calendar.conn.' + state)}</Badge></div>;
  };
  return (
    <Card title={<><LuRefreshCw aria-hidden="true" className="cal-ico" />{t('calendar.g.sync')}</>} className="cal-sync">
      <div data-testid="calendar-sync">
        {line('gcal', 'Google Calendar')}
        {line('gmeet', 'Google Meet')}
        <p className="small muted cal-gap">{t(states.gcal === 'connected' ? 'calendar.conn.onBody' : 'calendar.conn.offBody')}</p>
        <p className="xs dim cal-gap">{t('calendar.conn.meetBody')}</p>
        {can('integrations') && <p className="cal-gap"><A to="/integrations" className="linkbtn small">{t('calendar.conn.open')}</A></p>}
      </div>
    </Card>
  );
}

/* ---------- month grid ---------- */
function MonthGrid({ month, events, day, onPick }: { month: string; events: CalItem[]; day: string; onPick: (d: string) => void }) {
  const { t, data, lang, time, date } = useApp();
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7));
  const startDow = new Date(y, m - 1, 1).getDay(); const days = new Date(y, m, 0).getDate();
  const td = today();
  const byDay = new Map<string, CalItem[]>();
  for (const e of events) { const l = byDay.get(e.date); if (l) l.push(e); else byDay.set(e.date, [e]); }
  const dows = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short' }));
  const trailing = (7 - ((startDow + days) % 7)) % 7;
  const path = (e: CalItem) => refPath(e.ref, e.ref.type === 'task' ? byId(data.tasks, e.ref.id)?.jobId : undefined);
  return (
    <Card flush className="cal-card">
      <div className="cal-grid" data-testid="calendar-grid">
        {dows.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {[...Array(startDow)].map((_, i) => <div key={'a' + i} className="cal-day pad" aria-hidden="true" />)}
        {[...Array(days)].map((_, i) => {
          const ds = `${month}-${pad(i + 1)}`; const list = byDay.get(ds) || [];
          return (
            <div key={ds} className={cx('cal-day', ds === td && 'today', ds === day && 'sel', ds < td && 'past')} data-date={ds}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) onPick(ds); }}>
              <button type="button" className="cal-dn" aria-pressed={ds === day} aria-label={t(list.length ? 'calendar.dayItems' : 'calendar.dayEmpty', { date: date(ds), n: list.length })} onClick={() => onPick(ds)}>{i + 1}</button>
              <div className="cal-chips">
                {list.slice(0, 3).map((e) => (
                  <A key={e.id} to={path(e)} className={cx('cal-chip', 'k-' + e.kind, e.done && 'done', e.pri === 'high' && !e.done && 'hot', e.kind === 'meet' && unsettled(e) && 'loose')} title={`${kindLabel(t, e.kind)}: ${e.title}`}>
                    {e.time && <span className="cal-time">{time(e.time)} </span>}{e.title}
                  </A>
                ))}
                {list.length > 3 && <span className="cal-more">+{t('calendar.more', { n: list.length - 3 })}</span>}
              </div>
              <div className="cal-dots" aria-hidden="true">{list.slice(0, 4).map((e) => <i key={e.id} className={cx('cal-k', 'k-' + e.kind)} />)}</div>
            </div>
          );
        })}
        {[...Array(trailing)].map((_, i) => <div key={'z' + i} className="cal-day pad" aria-hidden="true" />)}
      </div>
    </Card>
  );
}

/* ---------- one item, used by the agenda, the day panel and "coming up" ---------- */
function EventList({ events, empty, showDate, compact }: { events: CalItem[]; empty: string; showDate?: boolean; compact?: boolean }) {
  const { t, data, time, day, lang } = useApp();
  if (!events.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="list">
      {events.map((e) => {
        const task = e.ref.type === 'task' ? byId(data.tasks, e.ref.id) : undefined;
        // an appointment says where it stands when that is not simply "on": waiting for payment, only asked for, or a date nobody booked yet
        const state = e.kind !== 'meet' ? '' : !e.appt ? t('calendar.meet.loose') : e.appt.status === 'awaiting_payment' || e.appt.status === 'requested' || e.appt.status === 'no_show' ? t('appointments.st.' + e.appt.status) : '';
        const meta = [showDate ? day(e.date) : '', e.time ? time(e.time) : '', kindLabel(t, e.kind), e.sub, state].filter(Boolean).join(' · ');
        return (
          <div key={e.id} className={cx('item cal-ev', 'k-' + e.kind, e.done && (e.kind === 'task' ? 'done' : 'cal-past'), e.kind === 'meet' && unsettled(e) && 'loose')} data-kind={e.kind}>
            <i className="cal-k" aria-hidden="true" />
            <div className="grow">
              <div className="t"><A to={refPath(e.ref, task?.jobId)} className="cal-link">{e.title}</A>{!e.done && e.pri && <> <PriorityBadge pri={e.pri} /></>}</div>
              <div className="small muted cal-meta">{meta}</div>
            </div>
            {/* a video link exists only when a meeting provider made one; the office address opens a plain maps search */}
            {e.appt?.meetUrl && <a className="iconbtn sm cal-g" href={e.appt.meetUrl} target="_blank" rel="noopener noreferrer" aria-label={t('calendar.meet.join', { title: e.title })} title={t('calendar.meet.join', { title: e.title })} data-testid="calendar-meet"><LuVideo aria-hidden="true" /></a>}
            {e.appt?.mode === 'office' && e.appt.location && <a className="iconbtn sm cal-g" href={mapsUrl(e.appt.location)} target="_blank" rel="noopener noreferrer" aria-label={t('calendar.meet.map', { title: e.title })} title={t('calendar.meet.map', { title: e.title })} data-testid="calendar-map"><LuMapPin aria-hidden="true" /></a>}
            <a className={cx(compact ? 'iconbtn sm' : 'btn sm ghost', 'cal-g')} href={gcalUrl(googleItem(data, t, e, lang))} target="_blank" rel="noopener noreferrer" data-testid="calendar-add-google"
              aria-label={t('calendar.addGoogleFor', { title: e.title })} title={t('calendar.addGoogleFor', { title: e.title })}>
              <LuCalendarPlus aria-hidden="true" />{!compact && <span className="cal-gl">{t('calendar.addGoogle')}</span>}
            </a>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- agenda ---------- */
function Agenda({ events, range, month, from, to, filtered, onClear, onNewTask }: { events: CalItem[]; range: Range; month: string; from: string; to: string; filtered: boolean; onClear: () => void; onNewTask: () => void }) {
  const { t, lang } = useApp();
  const td = today();
  const dow = new Date().getDay();
  const [a, b] = range === 'month' ? [`${month}-01`, monthEnd(month)] : range === 'next30' ? [td, addDays(30)] : range === 'week' ? [addDays(-dow), addDays(6 - dow)]
    : range === 'today' ? [td, td] : range === 'overdue' ? ['0000-01-01', addDays(-1)] : [from || td, to || from || td];
  // past due means something still waiting on someone: a visit, a follow-up or a task, not a job that simply started earlier
  const list = events.filter((e) => e.date >= a && e.date <= b && (range !== 'overdue' || (!e.done && (e.kind === 'appt' || e.kind === 'meet' || e.kind === 'follow' || e.kind === 'task'))));
  const groups = new Map<string, CalItem[]>();
  for (const e of list) { const l = groups.get(e.date); if (l) l.push(e); else groups.set(e.date, [e]); }
  const dates = [...groups.keys()].sort();
  // in the current month, what already happened folds away so the list opens on today
  const fold = range === 'month' && month === td.slice(0, 7);
  const earlier = fold ? dates.filter((d) => d < td) : [];
  const main = fold ? dates.filter((d) => d >= td) : dates;
  const block = (d: string) => (
    <section key={d} className="cal-block" data-date={d}>
      <h3 className={cx('cal-dayh', d < td && 'past')}><span className="cal-cap">{fmtDate(d, lang, { weekday: 'long', month: 'long', day: 'numeric' })}</span>{d === td && <Badge tone="accent">{t('calendar.today')}</Badge>}</h3>
      <EventList events={groups.get(d) || []} empty="" />
    </section>
  );
  return (
    <Card className="cal-agenda">
      <div data-testid="calendar-agenda">
        {!dates.length ? (
          <div className="empty">
            <LuCalendarCheck2 aria-hidden="true" />
            <b>{t(filtered ? 'calendar.noneFiltered' : 'calendar.noneRange')}</b>
            <div style={{ marginTop: 10 }}>{filtered ? <Button onClick={onClear}>{t('calendar.showAll')}</Button> : <CanWrite><Button icon={<LuPlus />} onClick={onNewTask}>{t('calendar.newTask')}</Button></CanWrite>}</div>
          </div>
        ) : (
          <>
            {earlier.length > 0 && (
              <details className="cal-earlier">
                <summary>{t('calendar.earlier', { n: earlier.reduce((n, d) => n + (groups.get(d)?.length || 0), 0) })}</summary>
                {earlier.map(block)}
              </details>
            )}
            {main.map(block)}
            {fold && !main.length && <p className="muted small">{t('calendar.none')}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
