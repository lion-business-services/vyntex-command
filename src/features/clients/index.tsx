// Clients: everyone the business works for. A list with search, filters and pages, and one page per client that gathers
// their work, documents, payments, notes and history under the tabs registered in ./tabs.ts.
// Who may see which client is decided in src/domain/access.ts (office scope); this screen only asks.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { LuPlus, LuPencil, LuTrash2, LuUpload, LuMerge, LuEllipsis, LuCalendarClock } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute } from '@/app/router';
import { BackLink } from '@/app/Shell';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, IconButton, Menu, PageHeader, SearchBox, cx, confirmDialog, toast } from '@/ui';
import { byId, clientMoney, jobsOfClient } from '@/domain/selectors';
import { canSeeClient, hiddenClients, visibleClients } from '@/domain/access';
import { clientTypesOf, moduleOn } from '@/domain/config';
import type { Client } from '@/domain/types';
import { money, sum } from '@/lib/money';
import { ExportButton } from '@/features/data/Export';
import { ImportDialog } from '@/features/data/ImportDialog';
import { Pager, pageOf, useDebounced } from '@/features/data/list';
import { deleteClient } from './actions';
import { clientTabsFor, type ClientTabDef } from './tabs';
import { LifecycleBadge, OptOutMarks, newJobPath } from './parts';
import { ClientForm } from './Form';
import { MergeDialog } from './Merge';
import { ClosedClient, OtherOffices } from './Access';
import { kindOf, moneyByClient, nextAppointment, optOuts } from './model';
import '@/features/leads/work.css';
import './clients.css';

type Sort = 'name' | 'newest' | 'balance';
type Life = '' | 'active' | 'inactive' | 'former';

export default function ClientsPage({ id, sub }: PageProps) {
  return id ? <ClientDetail id={id} tab={sub} /> : <ClientList />;
}

/* ---------- list ---------- */
function ClientList() {
  const { t, data, pack, can, user, perms } = useApp();
  const showMoney = can('money'); const canAdd = can('write');
  // an edition that keeps client types has more to filter by: type, office, who looks after the client, lifecycle
  const full = pack.family === 'practice';
  const types = clientTypesOf(data, pack);
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed);
  const [sort, setSort] = useState<Sort>('name');
  const [type, setType] = useState(''); const [office, setOffice] = useState(''); const [who, setWho] = useState(''); const [life, setLife] = useState<Life>('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(false);
  const [importing, setImporting] = useState(false);

  // a client that belongs to another office is not listed; its name appears below so the person can ask for access
  const mine = useMemo(() => visibleClients(data, user, perms), [data, user, perms]);
  const others = useMemo(() => hiddenClients(data, user, perms), [data, user, perms]);
  const totals = useMemo(() => moneyByClient(data), [data]);
  // what the search looks through, lowercased once per client instead of once per letter typed. It follows `data`, not only
  // the list: records are changed in place, so the list can be the same array with a client added or renamed inside it
  const haystack = useMemo(() => new Map(mine.map((c) => [c.id, [c.name, c.company, c.phone, c.email, ...c.addresses, ...(c.tags ?? [])].filter(Boolean).join('\n').toLowerCase()])), [mine, data]);
  const myOffices = useMemo(() => data.offices.filter((o) => mine.some((c) => c.officeId === o.id)), [data, mine]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = mine.filter((c) => (!s || (haystack.get(c.id) ?? '').includes(s)) && (!type || c.clientType === type) && (!office || (office === 'none' ? !c.officeId : c.officeId === office)) && (!who || c.assignedTo === who) && (!life || (c.lifecycle ?? 'active') === life));
    const by = showMoney ? sort : sort === 'balance' ? 'name' : sort;
    return hit.sort((a, b) => (by === 'newest' ? b.since.localeCompare(a.since) : by === 'balance' ? totals(b.id).owes - totals(a.id).owes : 0) || a.name.localeCompare(b.name));
  }, [mine, data, haystack, q, sort, showMoney, type, office, who, life, totals]);
  useEffect(() => { setPage(0); }, [q, sort, type, office, who, life]);
  const shown = useMemo(() => pageOf(rows, page), [rows, page]);
  // the rows on screen are rebuilt when the page of results changes, not on every letter typed in the search box
  const body = useMemo(() => shown.rows.map((c) => {
                      const m = totals(c.id); const owner = full ? byId(data.users, c.assignedTo) : undefined; const off = full ? byId(data.offices, c.officeId) : undefined;
                      return (
                        <tr key={c.id} className={cx('click', (c.lifecycle ?? 'active') !== 'active' && 'clients-past')} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/clients/${c.id}`); }}>
                          <td className="t1">
                            <span className="clients-who">
                              <Avatar name={c.name} size="sm" />
                              <span className="grow"><A to={`/clients/${c.id}`} className="clients-name">{c.name}</A> <LifecycleBadge client={c} />{optOuts(c).length > 0 && <OptOutMarks client={c} />}{c.company && <span className="xs dim clients-co">{c.company}</span>}</span>
                            </span>
                          </td>
                          {full && <td data-label={t('clients.p.type')}><span className="clients-contact">{c.clientType ? t('ct_' + c.clientType) : t('clients.kind.' + kindOf(c))}{off && <span className="xs dim">{off.name}</span>}</span></td>}
                          <td data-label={t('clients.col.contact')}>
                            {c.phone || c.email ? <span className="clients-contact">{c.phone && <span className="nowrap">{c.phone}</span>}{c.email && <span className="xs dim clients-mail">{c.email}</span>}</span> : <span className="dim small">{t('clients.noContact')}</span>}
                          </td>
                          {full && <td className="clients-c-who" data-label={t('clients.p.assigned')}>{owner ? <span className="row tight nowrap"><Avatar name={owner.name} size="sm" />{owner.name.split(' ')[0]}</span> : <span className="dim small">{t('common.unassigned')}</span>}</td>}
                          <td data-label={t('nav.jobs')} className="num">{m.jobs}</td>
                          {showMoney && !full && <>
                            <td data-label={t('clients.col.billed')} className="num">{money(m.billed)}</td>
                            <td data-label={t('clients.col.received')} className="num">{money(m.received)}</td>
                          </>}
                          {showMoney && <td data-label={t('clients.col.balance')} className={cx('num', m.owes > 0.005 ? 'strong' : 'dim')}>{money(m.owes)}</td>}
                        </tr>
                      );
                    }), [shown, totals, full, showMoney, data, t]);
  const owed = useMemo(() => sum(mine, (c) => Math.max(0, totals(c.id).owes)), [mine, totals]);
  const owing = useMemo(() => mine.filter((c) => totals(c.id).owes > 0.005).length, [mine, totals]);
  const filtered = !!(typed || type || office || who || life);
  const clear = () => { setTyped(''); setType(''); setOffice(''); setWho(''); setLife(''); };
  const cols = (full ? 5 : 3) + (showMoney ? (full ? 1 : 3) : 0);

  /** The list as filtered, for the export. Tax IDs are never a column, not even the type or the last four digits. */
  const exportRows = (): unknown[][] => [
    ['data.f.name', 'data.f.company', 'data.f.kind', 'data.f.clientType', 'data.f.phone', 'data.f.email', 'data.f.addresses', 'data.f.office', 'data.f.assignedTo', 'data.f.lang', 'data.f.lifecycle', 'data.f.tags', 'data.f.referredBy',
      'data.f.since', 'data.f.birthday', 'data.f.emailOptOut', 'data.f.smsOptIn', 'data.f.whatsappOptIn', 'data.f.whatsapp'].map((k) => t(k)),
    ...rows.map((c) => [c.name, c.company, t('clients.kind.' + kindOf(c)), c.clientType ? t('ct_' + c.clientType) : '', c.phone, c.email, c.addresses.join(' | '), byId(data.offices, c.officeId)?.name, byId(data.users, c.assignedTo)?.name, c.lang,
      t('clients.life.' + (c.lifecycle ?? 'active')), (c.tags ?? []).join(', '), c.referredBy, c.since, c.birthday, c.emailOptOut ?? false, c.smsOptIn, c.whatsappOptIn, c.whatsapp]),
  ];

  return (
    <>
      <PageHeader title={t('nav.clients')} sub={t('clients.sub')} actions={<>
        {mine.length > 0 && <ExportButton kind="clients" rows={exportRows} />}
        {canAdd && can('import') && <Button icon={<LuUpload />} onClick={() => setImporting(true)} data-testid="clients-import">{t('data.import')}</Button>}
        {canAdd && <Button variant={mine.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="clients-new">{t('clients.new')}</Button>}
      </>} />

      {!mine.length ? (
        <Card className="work-none"><Empty title={t('clients.empty')} action={canAdd ? <Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('clients.new')}</Button> : undefined}>{t('clients.emptyHint')}</Empty></Card>
      ) : (
        <>
          <div className={cx('filters clients-filters', full && 'full')}>
            <SearchBox value={typed} onChange={setTyped} placeholder={t('clients.search')} />
            {full && types.length > 0 && <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('clients.p.type')} data-testid="clients-filter-type"><option value="">{t('clients.allTypes')}</option>{types.map((x) => <option key={x.id} value={x.id}>{t('ct_' + x.id)}</option>)}</select>}
            {full && myOffices.length > 1 && <select value={office} onChange={(e) => setOffice(e.target.value)} aria-label={t('clients.p.office')} data-testid="clients-filter-office"><option value="">{t('clients.allOffices')}</option>{myOffices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}<option value="none">{t('clients.noOfficeShort')}</option></select>}
            {full && <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('clients.p.assigned')} data-testid="clients-filter-who"><option value="">{t('clients.allPeople')}</option>{data.users.filter((u) => mine.some((c) => c.assignedTo === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
            {full && <select value={life} onChange={(e) => setLife(e.target.value as Life)} aria-label={t('clients.p.lifecycle')} data-testid="clients-filter-life"><option value="">{t('clients.allLife')}</option>{(['active', 'inactive', 'former'] as const).map((x) => <option key={x} value={x}>{t('clients.life.' + x)}</option>)}</select>}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('clients.sort')} data-testid="clients-sort">
              <option value="name">{t('clients.sort.name')}</option>
              <option value="newest">{t('clients.sort.newest')}</option>
              {showMoney && <option value="balance">{t('clients.sort.balance')}</option>}
            </select>
            {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
          </div>
          <p className="small muted clients-sum">
            {t('clients.count', { n: mine.length })}
            {showMoney && <> · {t('clients.owed')}: <b>{money(owed)}</b> · {t('clients.withBalance', { n: owing })}</>}
            {filtered && <> · {t('clients.matching', { n: rows.length })}</>}
          </p>

          {!rows.length ? (
            <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
          ) : (
            <Card flush>
              <div className="table-wrap">
                <table className="tbl stackable" data-testid="clients-table">
                  <thead>
                    <tr>
                      <th>{t('client')}</th>{full && <th>{t('clients.p.type')}</th>}<th>{t('clients.col.contact')}</th>{full && <th className="clients-c-who">{t('clients.p.assigned')}</th>}<th className="num">{t('nav.jobs')}</th>
                      {showMoney && !full && <><th className="num">{t('clients.col.billed')}</th><th className="num">{t('clients.col.received')}</th></>}
                      {showMoney && <th className="num">{t('clients.col.balance')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {body}
                  </tbody>
                  {showMoney && !full && (
                    <tfoot><tr>
                      <td colSpan={2}>{t('common.total')} ({rows.length})</td><td className="num">{sum(rows, (c) => totals(c.id).jobs)}</td>
                      <td className="num">{money(sum(rows, (c) => totals(c.id).billed))}</td><td className="num">{money(sum(rows, (c) => totals(c.id).received))}</td><td className="num">{money(sum(rows, (c) => totals(c.id).owes))}</td>
                    </tr></tfoot>
                  )}
                  {showMoney && full && <tfoot><tr><td colSpan={3}>{t('common.total')} ({rows.length})</td><td className="clients-c-who" /><td className="num">{sum(rows, (c) => totals(c.id).jobs)}</td><td className="num">{money(sum(rows, (c) => totals(c.id).owes))}</td></tr></tfoot>}
                  {!showMoney && <tfoot><tr><td colSpan={full ? 3 : cols - 1}>{t('common.total')} ({rows.length})</td>{full && <td className="clients-c-who" />}<td className="num">{sum(rows, (c) => totals(c.id).jobs)}</td></tr></tfoot>}
                </table>
              </div>
              <Pager total={rows.length} page={shown.page} onPage={setPage} testId="clients-pager" />
            </Card>
          )}
        </>
      )}

      {others.length > 0 && <OtherOffices list={others} />}
      {form && <ClientForm onClose={() => setForm(false)} />}
      {importing && <ImportDialog kind="clients" onClose={() => setImporting(false)} />}
    </>
  );
}

/* ---------- the tabs of a client page: a strip that scrolls on a phone and keeps the open tab in view ---------- */
function TabStrip({ tabs, current, count, onPick }: { tabs: ClientTabDef[]; current: string; count: (tab: ClientTabDef) => number; onPick: (id: string) => void }) {
  const { t } = useApp();
  const strip = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = () => { const el = strip.current; if (el) setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 }); };
  // bring the open tab into view without moving the page: only the strip scrolls
  useEffect(() => {
    const el = strip.current; const on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && on) el.scrollLeft = Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2);
    measure();
  }, [current, tabs.length]);
  useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, []);
  // arrow keys move along the tabs, as in any tab list
  const onKey = (e: React.KeyboardEvent) => {
    const at = tabs.findIndex((x) => x.id === current);
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0 || to >= tabs.length || to === at) return;
    e.preventDefault(); onPick(tabs[to].id);
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div className={cx('clients-tabs', edge.left && 'more-left', edge.right && 'more-right')} data-testid="clients-tabs">
      <div className="tabs" role="tablist" aria-label={t('clients.tabs')} ref={strip} onScroll={measure} onKeyDown={onKey}>
        {tabs.map((x) => { const n = count(x); return <button key={x.id} role="tab" type="button" id={`client-tab-${x.id}`} aria-selected={x.id === current} aria-controls="client-tabpanel" tabIndex={x.id === current ? 0 : -1} onClick={() => onPick(x.id)} data-tab={x.id}>{t(x.labelKey)}{n > 0 && <span className="count">{n}</span>}</button>; })}
      </div>
    </div>
  );
}

/* ---------- one client: the header, what a person needs at a glance, then the tabs registered in ./tabs.ts ---------- */
function ClientDetail({ id, tab }: { id: string; tab?: string }) {
  const app = useApp();
  const { t, data, pack, can, date, day, time, user, perms } = app;
  const route = useRoute();
  const client = byId(data.clients, id);
  const [edit, setEdit] = useState(false);
  const [merge, setMerge] = useState(false);
  if (!client) return <Empty title={t('clients.notFound')} action={<A to="/clients" className="btn">{t('clients.back')}</A>} />;
  // a client of another office: the address may be typed by hand, the record stays closed and the person can ask for access
  if (!canSeeClient(data, user, perms, client)) return <><BackLink to="/clients">{t('clients.back')}</BackLink><ClosedClient client={client} /></>;

  const full = pack.family === 'practice';
  const tabs = clientTabsFor(app);
  const current = tabs.find((x) => x.id === (tab ?? route.query.get('tab'))) ?? tabs[0];
  const View = current.view;
  const jobs = jobsOfClient(data, client.id);
  const canWrite = can('write');
  const office = byId(data.offices, client.officeId); const who = byId(data.users, client.assignedTo);
  const appt = full && can('appointments') && moduleOn(data, pack, 'appointments') ? nextAppointment(data, client.id) : undefined;
  const balance = can('money') ? clientMoney(data, client.id).owes : null;
  const pick = (next: string) => go(next === tabs[0].id ? `/clients/${client.id}` : `/clients/${client.id}/${next}`);

  const remove = async () => {
    if (jobs.length) { toast(t('clients.deleteBlocked'), true); return; }
    if (await confirmDialog(t('common.confirmDelete'), t('common.delete'), t('common.cancel'))) { if (act(deleteClient, client.id)) { toast(t('clients.deleted')); go('/clients'); } }
  };

  return (
    <>
      <BackLink to="/clients">{t('clients.back')}</BackLink>
      <PageHeader title={<>{client.name} {full && <span className="clients-head-marks">{client.clientType && <Badge outline>{t('ct_' + client.clientType)}</Badge>}<LifecycleBadge client={client} /></span>}</>}
        sub={`${client.company ? client.company + ' · ' : ''}${t('clients.since', { date: date(client.since) })}`} actions={canWrite ? <>
          {can('jobs') && <A to={newJobPath(client)} className="btn primary" data-testid="clients-new-job"><LuPlus aria-hidden="true" />{t('clients.newJob')}</A>}
          <Button icon={<LuPencil />} onClick={() => setEdit(true)} data-testid="clients-edit">{t('common.edit')}</Button>
          {can('delete') && (full
            ? <Menu label={t('common.more')} button={<IconButton label={t('common.more')} data-testid="clients-more"><LuEllipsis /></IconButton>}>
              {(close: () => void) => <>
                <button type="button" role="menuitem" onClick={() => { close(); setMerge(true); }} data-testid="clients-merge"><LuMerge aria-hidden="true" />{t('clients.merge.open')}</button>
                <button type="button" role="menuitem" onClick={() => { close(); void remove(); }} data-testid="clients-delete"><LuTrash2 aria-hidden="true" />{t('common.delete')}</button>
              </>}
            </Menu>
            : <IconButton label={t('common.delete')} onClick={remove} data-testid="clients-delete"><LuTrash2 /></IconButton>)}
        </> : undefined} />

      {full && (
        <dl className="clients-glance" data-testid="clients-glance">
          {data.offices.length > 0 && <div><dt>{t('clients.p.office')}</dt><dd>{office ? office.name : <span className="muted">{t('clients.noOfficeShort')}</span>}</dd></div>}
          <div><dt>{t('clients.p.assigned')}</dt><dd>{who ? <span className="row tight nowrap"><Avatar name={who.name} size="sm" />{who.name}</span> : <span className="muted">{t('common.unassigned')}</span>}</dd></div>
          {balance !== null && <div><dt>{t('clients.glance.balance')}</dt><dd className={cx('clients-figure', balance > 0.005 && 'owes')} data-testid="clients-balance">{money(Math.max(0, balance))}</dd></div>}
          {can('appointments') && moduleOn(data, pack, 'appointments') && <div><dt>{t('clients.glance.next')}</dt><dd>{appt ? <A to={`/clients/${client.id}/appointments`}><LuCalendarClock aria-hidden="true" className="clients-inl" />{day(appt.date)}, {time(appt.time)}</A> : <span className="muted">{t('clients.glance.noAppt')}</span>}</dd></div>}
          {optOuts(client).length > 0 && <div className="wide"><dt>{t('clients.glance.asked')}</dt><dd><OptOutMarks client={client} /></dd></div>}
        </dl>
      )}

      {tabs.length > 1 && <TabStrip tabs={tabs} current={current.id} count={(x) => x.count?.(app, client) ?? 0} onPick={pick} />}
      <div id="client-tabpanel" role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `client-tab-${current.id}` : undefined}>
        <Suspense fallback={<div className="page-loading" role="status" aria-live="polite"><span className="sr">{t('common.loading')}</span></div>}>
          <View key={current.id} client={client} tabbed={tabs.length > 1} />
        </Suspense>
      </div>

      {edit && <ClientForm client={client} onClose={() => setEdit(false)} />}
      {merge && <MergeDialog client={client} onClose={() => setMerge(false)} />}
    </>
  );
}
