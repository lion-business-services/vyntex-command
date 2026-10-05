// Appointments: who is coming, when, with whom, and what is still to be paid.
// One address per view: /appointments (list), /appointments?view=agenda (day and week per person),
// /appointments/credits (the credit ledger) and /appointments/<id> (one appointment).
// Other screens open it with ?client=<id> or ?lead=<id> (that person's appointments) and &new=1 (start a booking).
import { useEffect, useMemo, useState } from 'react';
import { LuCalendarPlus, LuList, LuColumns3, LuTicket, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { ctx, getSnapshot, mutateQuiet } from '@/store/store';
import { Avatar, Button, Card, Empty, PageHeader, SearchBox, Seg, Stat, cx, toast } from '@/ui';
import { CanWrite } from '@/app/shared';
import { byId } from '@/domain/selectors';
import { creditState, endOf, holdsSlot, isOpenAppt, personOf, sumMoney, sweepAppointments, sweepDue, wasMoved } from '@/domain/actions/appointments';
import type { Appointment, ApptStatus } from '@/domain/types';
import { money2 } from '@/lib/money';
import { today } from '@/lib/dates';
import { ApptStatusBadge, BookModal, FeeLine, ModeIcon, PersonLink, byWhen, useAppointments, useStaff, useTypeName, type BookDefaults } from './parts';
import { Agenda } from './Agenda';
import { ApptDetail } from './Detail';
import { CreditsView } from './Credits';
import '@/features/leads/work.css';
import './appointments.css';

const STATUSES: ApptStatus[] = ['requested', 'scheduled', 'awaiting_payment', 'confirmed', 'completed', 'no_show', 'cancelled_unpaid', 'cancelled_client', 'cancelled_staff'];
type Tab = 'today' | 'upcoming' | 'awaiting' | 'past';
const TABS: Tab[] = ['today', 'upcoming', 'awaiting', 'past'];

export default function AppointmentsPage({ id }: PageProps) {
  useSweep();
  if (id === 'credits') return <CreditsView />;
  return id ? <ApptDetail id={id} /> : <ApptList />;
}

/**
 * Releases prepaid appointments whose pay-by moment has passed, when the screen opens and once a minute while it stays
 * open. The daily job does the same on the server; this keeps the list true between its runs. A person who cannot change
 * records does not trigger it.
 */
function useSweep() {
  const { t, can } = useApp();
  const may = can('write') && can('appointments');
  useEffect(() => {
    if (!may) return;
    const run = () => {
      if (!sweepDue(getSnapshot().data)) return;
      const did = { n: 0 };
      mutateQuiet((d) => { did.n = sweepAppointments(d, ctx()).released.length; });
      if (did.n) toast(t('appointments.released', { n: did.n }));
    };
    run();
    const timer = setInterval(run, 60000);
    return () => clearInterval(timer);
  }, [may, t]);
}

function ApptList() {
  const { t, data, can, day, time } = useApp();
  const route = useRoute();
  const all = useAppointments();
  const staff = useStaff(); const typeName = useTypeName();
  const view = route.query.get('view') === 'agenda' ? 'agenda' : 'list';
  const onlyClient = route.query.get('client') ?? ''; const onlyLead = route.query.get('lead') ?? '';
  const scoped = byId(data.clients, onlyClient) ?? byId(data.leads, onlyLead);
  const tabParam = route.query.get('tab') as Tab | null;
  const td = today();
  // opens on today when something is on today, otherwise on what is coming
  const [tab, setTab] = useState<Tab>(() => (tabParam && TABS.includes(tabParam) ? tabParam : !scoped && all.some((a) => a.date === td && !wasMoved(data, a)) ? 'today' : 'upcoming'));
  const [q, setQ] = useState('');
  const [who, setWho] = useState(''); const [office, setOffice] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState<'' | ApptStatus>('');
  const canBook = can('write') && can('appointments');
  const [book, setBook] = useState<BookDefaults | null>(() => (canBook && route.query.get('new') === '1'
    ? { clientId: onlyClient || undefined, leadId: onlyLead || undefined, date: route.query.get('date') ?? undefined, staffId: route.query.get('staff') ?? undefined } : null));

  // the records of earlier slots are history of the appointment that moved: they show on its page, not in the lists
  const mine = useMemo(() => all.filter((a) => !wasMoved(data, a) && (!scoped || a.clientId === onlyClient || a.leadId === onlyLead)), [all, data, scoped, onlyClient, onlyLead]);
  const inTab: Record<Tab, (a: Appointment) => boolean> = {
    today: (a) => a.date === td,
    upcoming: (a) => a.date > td && isOpenAppt(a),
    awaiting: (a) => a.status === 'awaiting_payment',
    past: (a) => a.date < td || (a.date > td && !isOpenAppt(a)),
  };
  const s = q.trim().toLowerCase();
  const match = (a: Appointment) => {
    const p = personOf(data, a);
    return (!who || a.staffId === who) && (!office || a.officeId === office) && (!type || a.typeId === type) && (!status || a.status === status)
      && (!s || [p?.name, p?.company, typeName(a), a.notes].some((v) => v && v.toLowerCase().includes(s)));
  };
  const rows = mine.filter((a) => inTab[tab](a) && match(a)).sort((a, b) => (tab === 'past' ? byWhen(b, a) : byWhen(a, b)));
  const filtered = !!(s || who || office || type || status);
  const clear = () => { setQ(''); setWho(''); setOffice(''); setType(''); setStatus(''); };
  const count = (k: Tab) => mine.filter(inTab[k]).length;

  const now = Date.now();
  const unresolved = mine.filter((a) => holdsSlot(a) && endOf(a).getTime() < now);
  const awaiting = mine.filter((a) => a.status === 'awaiting_payment');
  const usable = sumMoney(data.credits.filter((c) => creditState(c) === 'active' && (!onlyClient || c.clientId === onlyClient)), (c) => c.amount);
  const show = (v: 'list' | 'agenda') => go('/appointments' + (v === 'agenda' ? '?view=agenda' : ''));

  return (
    <>
      <PageHeader title={t('nav.appointments')} sub={t('appointments.sub')} actions={<>
        <Seg label={t('appointments.view')} value={view} onChange={show} options={[
          { value: 'list', label: <><LuList aria-hidden="true" />{t('appointments.view.list')}</> }, { value: 'agenda', label: <><LuColumns3 aria-hidden="true" />{t('appointments.view.agenda')}</> }]} />
        <A to="/appointments/credits" className="btn" data-testid="appointments-credits-link"><LuTicket aria-hidden="true" />{t('appointments.credits')}</A>
        <CanWrite need="appointments"><Button variant="primary" icon={<LuCalendarPlus />} onClick={() => setBook({ clientId: onlyClient || undefined, leadId: onlyLead || undefined })} data-testid="appointments-new">{t('appointments.book')}</Button></CanWrite>
      </>} />

      {view === 'agenda' ? <Agenda appointments={mine} onBook={canBook ? (d) => setBook(d) : undefined} /> : (
        <>
          {scoped && (
            <p className="appointments-scope" data-testid="appointments-scope">
              {t('appointments.scope', { name: scoped.name })}
              <A to="/appointments" className="linkbtn small"><LuX aria-hidden="true" />{t('appointments.scope.all')}</A>
            </p>
          )}
          <div className="kpis appointments-kpis">
            <Stat label={t('appointments.tab.today')} value={count('today')} hint={t('appointments.kpi.todayHint')} onClick={() => setTab('today')} testId="appointments-kpi-today" />
            <Stat label={t('appointments.tab.awaiting')} value={awaiting.length} attention={awaiting.length > 0}
              hint={can('money') && awaiting.length ? t('appointments.kpi.awaitingHint', { amount: money2(sumMoney(awaiting, (a) => a.fee)) }) : t('appointments.kpi.awaitingNone')} onClick={() => setTab('awaiting')} testId="appointments-kpi-awaiting" />
            <Stat label={t('appointments.kpi.outcome')} value={unresolved.length} attention={unresolved.length > 0} hint={t('appointments.kpi.outcomeHint')} onClick={() => { setTab(unresolved.some((a) => a.date === td) && !unresolved.some((a) => a.date < td) ? 'today' : 'past'); setStatus(''); }} testId="appointments-kpi-outcome" />
            {can('money') && <Stat label={t('appointments.kpi.credits')} value={money2(usable)} hint={t('appointments.kpi.creditsHint')} onClick={() => go('/appointments/credits' + (onlyClient ? `?client=${onlyClient}` : ''))} testId="appointments-kpi-credits" />}
          </div>

          <div className="appointments-tabs">
            <Seg label={t('appointments.show')} value={tab} onChange={setTab} options={TABS.map((k) => ({ value: k, label: t('appointments.tab.' + k), count: count(k) }))} />
          </div>
          <div className="filters appointments-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('appointments.search')} />
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('common.assignedTo')} data-testid="appointments-filter-staff">
              <option value="">{t('appointments.all.staff')}</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {data.offices.length > 1 && (
              <select value={office} onChange={(e) => setOffice(e.target.value)} aria-label={t('appointments.f.office')} data-testid="appointments-filter-office">
                <option value="">{t('appointments.all.offices')}</option>{data.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('common.type')} data-testid="appointments-filter-type">
              <option value="">{t('appointments.all.types')}</option>{data.apptTypes.map((x) => <option key={x.id} value={x.id}>{typeName(x)}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as ApptStatus | '')} aria-label={t('common.status')} data-testid="appointments-filter-status">
              <option value="">{t('appointments.all.statuses')}</option>{STATUSES.map((x) => <option key={x} value={x}>{t('appointments.st.' + x)}</option>)}
            </select>
            {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
          </div>

          {!mine.length ? (
            <Card className="work-none"><Empty title={t('appointments.empty')} action={canBook ? <Button variant="primary" icon={<LuCalendarPlus />} onClick={() => setBook({})}>{t('appointments.book')}</Button> : undefined}>{t('appointments.emptyHint')}</Empty></Card>
          ) : !rows.length ? (
            <Card className="work-none"><Empty title={t(filtered ? 'common.noResults' : 'appointments.none.' + tab)} action={filtered ? <Button onClick={clear}>{t('common.clearFilters')}</Button> : undefined} /></Card>
          ) : (
            <Card flush>
              <div className="table-wrap">
                <table className="tbl stackable" data-testid="appointments-table">
                  <thead><tr><th>{t('appointments.col.when')}</th><th>{t('appointments.col.with')}</th><th>{t('common.type')}</th><th>{t('common.assignedTo')}</th><th>{t('common.status')}</th>{can('money') && <th className="num">{t('appointments.col.fee')}</th>}</tr></thead>
                  <tbody>
                    {rows.map((a) => {
                      const u = byId(data.users, a.staffId); const p = personOf(data, a);
                      const late = holdsSlot(a) && endOf(a).getTime() < now;
                      return (
                        <tr key={a.id} className="click" data-appt={a.id} data-status={a.status} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/appointments/${a.id}`); }}>
                          <td className="t1"><A to={`/appointments/${a.id}`} className="appointments-when">{a.date === td ? t('common.today') : day(a.date)}, {time(a.time)}</A>
                            <div className={cx('xs', late ? 'neg strong' : 'dim')}>{late ? t('appointments.needsOutcome') : t('appointments.minutes', { n: a.minutes })}</div></td>
                          <td data-label={t('appointments.col.with')}><span><PersonLink appt={a} className="appointments-name" />{(p?.kind === 'lead' || p?.company) && <span className="xs dim appointments-block">{[p.kind === 'lead' ? t('appointments.lead') : '', p.company].filter(Boolean).join(' · ')}</span>}</span></td>
                          <td data-label={t('common.type')}><span className="appointments-type"><ModeIcon mode={a.mode} />{typeName(a)}</span></td>
                          <td data-label={t('common.assignedTo')}>{u ? <span className="row tight nowrap"><Avatar name={u.name} size="sm" />{u.name.split(' ')[0]}</span> : <span className="dim">{t('common.unassigned')}</span>}</td>
                          <td data-label={t('common.status')}><ApptStatusBadge appt={a} /></td>
                          {can('money') && <td data-label={t('appointments.col.fee')} className="num"><FeeLine appt={a} /></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {book && <BookModal defaults={book} onClose={() => setBook(null)} onBooked={(a) => go(`/appointments/${a.id}`)} />}
    </>
  );
}
