// Deadlines: the dates a firm must not miss, for itself and for its clients. Filings, licenses, renewals, insurance.
// The calendar holds only what the business enters or imports: the product ships no filing dates, rates or agency rules.
// A list and a month view over the same filtered set. Completing a repeating item rolls it forward to its next date.
import { useEffect, useMemo, useState } from 'react';
import { LuCalendarDays, LuChevronLeft, LuChevronRight, LuFileUp, LuList, LuPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appPath, navigate, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Button, Card, Empty, Modal, Note, PageHeader, SearchBox, Seg, cx, toast } from '@/ui';
import { importDeadlines } from '@/domain/actions';
import { DEADLINE_KINDS, REPEATS, type DeadlineInput } from '@/domain/actions/ops';
import { byId, deadlineState, type DeadlineState } from '@/domain/selectors';
import { visibleClientIds, visibleClients } from '@/domain/access';
import type { ComplianceItem, Repeat } from '@/domain/types';
import { fmtDate, monthLabel, toISODate, today } from '@/lib/dates';
import { downloadCsv, parseCsvRecords, readCsvFile } from '@/features/data/csv';
import { ExportCsv } from '@/features/cash/parts';
import { DeadlineFormModal, DeadlineRow, STATE_TONE } from './parts';
import './deadlines.css';

type Scope = 'open' | 'closed' | 'all';
const GROUPS: DeadlineState[] = ['overdue', 'soon', 'upcoming', 'done', 'waived'];

export default function DeadlinesPage({ id }: PageProps) {
  const { t, data, lang, can, user, perms, date } = useApp();
  const route = useRoute();
  const view = route.query.get('view') === 'calendar' ? 'calendar' : 'list';
  const [scope, setScope] = useState<Scope>('open');
  const [q, setQ] = useState(''); const [kind, setKind] = useState(route.query.get('kind') ?? ''); const [client, setClient] = useState(route.query.get('client') ?? ''); const [who, setWho] = useState(route.query.get('who') === 'me' && user ? user.id : '');
  const [state, setState] = useState<'' | DeadlineState>('');
  const [form, setForm] = useState<{ item?: ComplianceItem } | null>(null);
  const [importing, setImporting] = useState(false);
  const write = can('write');

  // a link to one deadline (a notification, a search result) opens it
  useEffect(() => {
    if (!id) return;
    const hit = byId(data.complianceItems, id);
    if (hit) { setForm({ item: hit }); setScope('all'); } else toast(t('deadlines.gone'), true);
    navigate(appPath('/deadlines'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // a deadline of a client this person may not open is not shown
  const mine = useMemo(() => visibleClientIds(data, user, perms), [data, user, perms]);
  const all = useMemo(() => data.complianceItems.filter((i) => !i.clientId || mine.has(i.clientId)), [data, mine]);
  const clients = visibleClients(data, user, perms).filter((c) => all.some((i) => i.clientId === c.id));
  const base = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((i) => {
      if (kind && i.kind !== kind) return false;
      if (client === 'firm' ? !!i.clientId : client && i.clientId !== client) return false;
      if (who && i.assignee !== who) return false;
      if (!s) return true;
      const c = byId(data.clients, i.clientId);
      return [i.title, i.authority, i.note, c?.name, c?.company].some((v) => v && v.toLowerCase().includes(s));
    });
  }, [all, data, q, kind, client, who]);
  const openItems = base.filter((i) => i.status === 'open');
  const count = (st: DeadlineState) => openItems.filter((i) => deadlineState(i) === st).length;
  const rows = base.filter((i) => (scope === 'open' ? i.status === 'open' : scope === 'closed' ? i.status !== 'open' : true) && (!state || deadlineState(i) === state))
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.status === 'open' ? a.due.localeCompare(b.due) : b.due.localeCompare(a.due)));
  const filtered = !!(q || kind || client || who || state);
  const clear = () => { setQ(''); setKind(''); setClient(''); setWho(''); setState(''); };
  const pick = (st: DeadlineState) => { setState(state === st ? '' : st); setScope('open'); };
  const csvRows = () => [
    [t('deadlines.f.title'), t('common.type'), t('deadlines.f.due'), t('deadlines.f.repeat'), t('common.status'), t('deadlines.f.client'), t('common.assignedTo'), t('deadlines.f.authority'), t('deadlines.f.remind'), t('common.notes')],
    ...rows.map((i) => { const c = byId(data.clients, i.clientId); return [i.title, t('deadlines.kind.' + i.kind), i.due, t('deadlines.rp.' + (i.repeat ?? 'once')), t('deadlines.st.' + (i.status === 'open' ? deadlineState(i) : i.status)), c ? c.company || c.name : t('deadlines.firm'), byId(data.users, i.assignee)?.name ?? '', i.authority ?? '', (i.remind ?? []).join(' '), i.note ?? '']; }),
  ];

  return (
    <div className="deadlines">
      <PageHeader title={t('nav.deadlines')} sub={t('deadlines.sub')} actions={<>
        <span data-testid="deadlines-view">
          <Seg label={t('deadlines.view')} value={view} onChange={(v) => navigate(appPath(v === 'calendar' ? '/deadlines?view=calendar' : '/deadlines'))} options={[
            { value: 'list', label: <><LuList aria-hidden="true" />{t('deadlines.view.list')}</> }, { value: 'calendar', label: <><LuCalendarDays aria-hidden="true" />{t('deadlines.view.calendar')}</> }]} />
        </span>
        {write && can('import') && <Button icon={<LuFileUp aria-hidden="true" />} onClick={() => setImporting(true)} data-testid="deadlines-import">{t('deadlines.import')}</Button>}
        {write && <Button variant={all.length ? 'primary' : 'default'} icon={<LuPlus aria-hidden="true" />} onClick={() => setForm({})} data-testid="deadlines-new">{t('deadlines.new')}</Button>}
      </>} />

      {!all.length ? (
        <Card>
          <Empty title={t('deadlines.empty')} action={write ? <span className="row tight" style={{ justifyContent: 'center' }}><Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm({})}>{t('deadlines.new')}</Button>{can('import') && <Button icon={<LuFileUp aria-hidden="true" />} onClick={() => setImporting(true)}>{t('deadlines.import')}</Button>}</span> : undefined}>{t('deadlines.emptyHint')}</Empty>
          <Note>{t('deadlines.ownDates')}</Note>
        </Card>
      ) : (
        <>
          <div className="filters deadlines-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('deadlines.search')} />
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('common.type')} data-testid="deadlines-filter-kind">
              <option value="">{t('deadlines.kind.all')}</option>{DEADLINE_KINDS.map((k) => <option key={k} value={k}>{t('deadlines.kind.' + k)}</option>)}
            </select>
            <select value={client} onChange={(e) => setClient(e.target.value)} aria-label={t('deadlines.f.client')} data-testid="deadlines-filter-client">
              <option value="">{t('deadlines.client.all')}</option><option value="firm">{t('deadlines.firm')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
            </select>
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('common.assignedTo')} data-testid="deadlines-filter-assignee">
              <option value="">{t('deadlines.who.all')}</option>{data.users.filter((u) => all.some((i) => i.assignee === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {view === 'list' && <Seg label={t('common.status')} value={scope} onChange={(v) => { setScope(v); setState(''); }} options={[{ value: 'open', label: t('deadlines.scope.open') }, { value: 'closed', label: t('deadlines.scope.closed') }, { value: 'all', label: t('common.all') }]} />}
            {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="deadlines-clear">{t('common.clearFilters')}</button>}
            <span className="grow" />
            <ExportCsv size="sm" name={t('deadlines.file')} rows={csvRows} testId="deadlines-csv" />
          </div>

          <p className="small muted deadlines-sum" data-testid="deadlines-summary">
            <b>{t('deadlines.sum.open', { n: openItems.length })}</b>
            {(['overdue', 'soon', 'upcoming'] as DeadlineState[]).map((st) => (
              <span key={st}>{' · '}<button type="button" className={cx('deadlines-sumbtn', st === 'overdue' && count(st) > 0 && 'neg', st === 'soon' && count(st) > 0 && 'warn')} onClick={() => pick(st)} aria-pressed={state === st}>{t('deadlines.sum.' + st, { n: count(st) })}</button></span>
            ))}
          </p>

          {view === 'calendar' ? <Month items={base} onEdit={(item) => setForm({ item })} lang={lang} dateFmt={date} />
            : !rows.length ? (
              <Card><Empty title={filtered ? t('common.noResults') : t(scope === 'open' ? 'deadlines.noneOpen' : 'deadlines.noneClosed')} action={filtered ? <Button onClick={clear}>{t('common.clearFilters')}</Button> : undefined} /></Card>
            ) : (
              <div className="stack" data-testid="deadlines-list">
                {GROUPS.map((g) => {
                  const list = rows.filter((i) => deadlineState(i) === g); if (!list.length) return null;
                  return (
                    <Card key={g} className={cx('deadlines-group', g === 'overdue' && 'raised')} title={<><span className={cx(g === 'overdue' && 'neg')}>{t('deadlines.st.' + g)}</span> <span className="count">{list.length}</span></>}>
                      <div className="list" data-group={g}>{list.map((i) => <DeadlineRow key={i.id} item={i} onEdit={(item) => setForm({ item })} />)}</div>
                    </Card>
                  );
                })}
              </div>
            )}
          <p className="xs dim deadlines-foot">{t('deadlines.ownDates')}</p>
        </>
      )}

      {form && <DeadlineFormModal key={form.item?.id ?? 'new'} item={form.item} onClose={() => setForm(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );

}

/** A month of deadlines: every day that has one shows it; picking a day lists that day underneath. */
function Month({ items, onEdit, lang, dateFmt }: { items: ComplianceItem[]; onEdit: (i: ComplianceItem) => void; lang: 'en' | 'es' | 'zh'; dateFmt: (d: string | undefined) => string }) {
  const { t } = useApp();
  const [ym, setYm] = useState(today().slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1); const days = new Date(y, m, 0).getDate();
  const move = (n: number) => { setYm(toISODate(new Date(y, m - 1 + n, 1)).slice(0, 7)); setDay(null); };
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const of = (d: string) => items.filter((i) => i.due === d);
  const inMonth = items.filter((i) => i.due.startsWith(ym)).sort((a, b) => a.due.localeCompare(b.due));
  const listed = day ? of(day) : inMonth;
  const dow = Array.from({ length: 7 }, (_, i) => fmtDate(toISODate(new Date(2023, 0, 1 + i)), lang, { weekday: 'short' }));
  const title = monthLabel(ym, lang);
  return (
    <div className="stack" data-testid="deadlines-calendar">
      <Card flush className="deadlines-cal">
        <div className="deadlines-cal-h">
          <button type="button" className="iconbtn sm" onClick={() => move(-1)} aria-label={t('common.previous')}><LuChevronLeft /></button>
          <h2 aria-live="polite">{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
          <button type="button" className="iconbtn sm" onClick={() => move(1)} aria-label={t('common.next')}><LuChevronRight /></button>
          {ym !== today().slice(0, 7) && <button type="button" className="btn sm ghost" onClick={() => { setYm(today().slice(0, 7)); setDay(null); }}>{t('common.today')}</button>}
        </div>
        <div className="deadlines-grid" role="grid" aria-label={title}>
          {dow.map((d) => <div key={d} className="deadlines-dow" role="columnheader">{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={'x' + i} className="deadlines-cell off" role="gridcell" />;
            const list = of(d);
            return (
              <button type="button" key={d} role="gridcell" className={cx('deadlines-cell', d === today() && 'now', day === d && 'on', list.length > 0 && 'has')} onClick={() => setDay(day === d ? null : d)} aria-pressed={day === d} aria-label={`${dateFmt(d)}: ${list.length}`}>
                <span className="deadlines-daynum">{Number(d.slice(8))}</span>
                {list.slice(0, 2).map((it) => <span key={it.id} className={cx('deadlines-chip', STATE_TONE[deadlineState(it)])}>{it.title}</span>)}
                {list.length > 2 && <span className="deadlines-chipmore">+{list.length - 2}</span>}
                {list.length > 0 && <span className="deadlines-dots" aria-hidden="true">{list.slice(0, 4).map((it) => <i key={it.id} className={STATE_TONE[deadlineState(it)]} />)}</span>}
              </button>
            );
          })}
        </div>
      </Card>
      <Card title={<>{day ? dateFmt(day) : title.charAt(0).toUpperCase() + title.slice(1)} <span className="count">{listed.length}</span></>}>
        {listed.length ? <div className="list">{listed.map((i) => <DeadlineRow key={i.id} item={i} onEdit={onEdit} />)}</div> : <p className="muted small">{t(day ? 'deadlines.cal.noneDay' : 'deadlines.cal.noneMonth')}</p>}
      </Card>
    </div>
  );
}

/* ---------- import a file the business prepared ---------- */
const COLS: Record<string, string[]> = {
  title: ['title', 'titulo', 'título', 'name', 'nombre'], due: ['due', 'due date', 'date', 'fecha', 'vence', 'vencimiento', 'fecha limite', 'fecha límite'], kind: ['kind', 'type', 'tipo'],
  repeat: ['repeat', 'repeats', 'repite', 'se repite', 'frecuencia'], client: ['client', 'cliente'], assignee: ['assignee', 'assigned to', 'asignado', 'asignado a', 'responsable'],
  authority: ['authority', 'agency', 'autoridad', 'agencia'], remind: ['remind', 'reminder', 'reminders', 'recordatorio', 'recordatorios'], note: ['note', 'notes', 'nota', 'notas'],
};
const HEAD = ['title', 'due', 'kind', 'repeat', 'client', 'assignee', 'authority', 'remind', 'note'];
/** YYYY-MM-DD, or month/day/year as written in the United States. Anything else is not a date. */
function readDate(v: string): string {
  const s = v.trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) { const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (us) m = [s, us[3], us[1], us[2]] as unknown as RegExpExecArray; }
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]); const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? toISODate(dt) : '';
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { t, data, user, perms } = useApp();
  const [found, setFound] = useState<{ rows: DeadlineInput[]; skipped: { line: number; why: string }[]; name: string } | null>(null);
  const [err, setErr] = useState('');
  const norm = (s: string) => s.trim().toLowerCase();
  const read = async (file: File | undefined) => {
    if (!file) return;
    setErr(''); setFound(null);
    try {
      const { header, rows } = parseCsvRecords(await readCsvFile(file));
      const at = (k: string) => header.findIndex((h) => COLS[k].includes(norm(h)));
      if (at('title') < 0 || at('due') < 0) { setErr(t('deadlines.imp.noCols')); return; }
      const cell = (r: string[], k: string) => (at(k) >= 0 ? (r[at(k)] ?? '').trim() : '');
      const clients = visibleClients(data, user, perms);
      const ok: DeadlineInput[] = []; const skipped: { line: number; why: string }[] = [];
      rows.forEach((r, i) => {
        const line = i + 2; const title = cell(r, 'title'); const due = readDate(cell(r, 'due'));
        if (!title) { skipped.push({ line, why: t('deadlines.imp.noTitle') }); return; }
        if (!due) { skipped.push({ line, why: t('deadlines.imp.badDate') }); return; }
        const k = norm(cell(r, 'kind')); const kind = DEADLINE_KINDS.find((x) => x === k || norm(t('deadlines.kind.' + x)) === k) ?? 'deadline';
        const rp = norm(cell(r, 'repeat')); const repeat = (REPEATS.find((x) => x === rp || norm(t('deadlines.rp.' + x)) === rp) ?? 'once') as Repeat;
        const cn = norm(cell(r, 'client')); const c = cn ? clients.find((x) => norm(x.name) === cn || norm(x.company ?? '') === cn) : undefined;
        if (cn && !c) { skipped.push({ line, why: t('deadlines.imp.noClient', { name: cell(r, 'client') }) }); return; }
        const an = norm(cell(r, 'assignee')); const person = an ? data.users.find((u) => norm(u.name) === an || norm(u.email) === an) : undefined;
        ok.push({ title, due, kind, repeat, clientId: c?.id, assignee: person?.id, authority: cell(r, 'authority'), note: cell(r, 'note'), remind: cell(r, 'remind').split(/[^0-9]+/).filter(Boolean).map(Number) });
      });
      setFound({ rows: ok, skipped, name: file.name });
    } catch { setErr(t('deadlines.imp.unreadable')); }
  };
  const run = () => { if (!found) return; const n = act(importDeadlines, found.rows); toast(t('deadlines.imp.done', { n })); onClose(); };
  return (
    <Modal title={t('deadlines.import')} onClose={onClose} labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={run} disabled={!found || !found.rows.length} data-testid="deadlines-import-run">{found?.rows.length ? t('deadlines.imp.run', { n: found.rows.length }) : t('deadlines.import')}</Button></>}>
      <p className="small">{t('deadlines.imp.how')}</p>
      <p className="small muted" style={{ margin: '8px 0' }}><code className="deadlines-cols">{HEAD.join(', ')}</code></p>
      <p className="small muted">{t('deadlines.imp.rules')}</p>
      <div className="row" style={{ margin: '14px 0' }}>
        <span className="team-file"><input type="file" accept=".csv,text/csv" aria-label={t('deadlines.imp.pick')} onChange={(e) => { void read(e.target.files?.[0]); }} data-testid="deadlines-import-file" /></span>
        <button type="button" className="linkbtn small" onClick={() => downloadCsv('deadlines-columns.csv', [HEAD])}>{t('deadlines.imp.blank')}</button>
      </div>
      {err && <p className="small neg" role="alert">{err}</p>}
      {found && (
        <div data-testid="deadlines-import-result">
          <p><b>{t('deadlines.imp.ready', { n: found.rows.length })}</b>{found.skipped.length > 0 && <> · <span className="neg">{t('deadlines.imp.skipped', { n: found.skipped.length })}</span></>}</p>
          {found.skipped.length > 0 && <ul className="small muted deadlines-skips">{found.skipped.slice(0, 8).map((s) => <li key={s.line}>{t('deadlines.imp.line', { line: s.line })}: {s.why}</li>)}{found.skipped.length > 8 && <li>{t('deadlines.imp.more', { n: found.skipped.length - 8 })}</li>}</ul>}
        </div>
      )}
      <Note>{t('deadlines.ownDates')}</Note>
    </Modal>
  );
}
