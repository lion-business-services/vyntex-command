// Leads: every request from first contact to a won job. Table and pipeline views over the same data.
// The lead page is in ./Detail.tsx, the dialogs in ./forms.tsx, the board in ./Board.tsx, and what a lead needs right now
// (next step, last contact, waiting time) is worked out in ./model.ts.
import { useEffect, useMemo, useState } from 'react';
import { LuPlus, LuTable, LuKanban, LuUpload, LuLock } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Avatar, Button, Card, Empty, PageHeader, SearchBox, Seg, cx, confirmDialog, toast } from '@/ui';
import { LeadStageBadge, PriorityBadge } from '@/app/shared';
import { convertLead, setLeadStage } from '@/domain/actions';
import { byId } from '@/domain/selectors';
import { hiddenLeadCount, visibleLeads } from '@/domain/access';
import { isLost, isOpen, isWon, sourcesOf, stagesOf } from '@/domain/config';
import type { Lead, LeadSource, LeadStage, Priority } from '@/domain/types';
import { money, sum } from '@/lib/money';
import { ExportButton } from '@/features/data/Export';
import { ImportDialog } from '@/features/data/ImportDialog';
import { Pager, pageOf, useDebounced } from '@/features/data/list';
import { leadSignals, messageContacts, type LeadSignals } from './model';
import { ContactAge, HotMark, NextStepLine, serviceName, useNextText, useReasonLabel } from './parts';
import { LeadForm, LostModal, PRIORITIES } from './forms';
import { Board } from './Board';
import { LeadDetail } from './Detail';
import './work.css';
import './board.css';
import './leads.css';

// Stages, sources and lost reasons come from the company's configuration (src/domain/config.ts), never from a fixed list.
type Flag = '' | 'attention' | 'stale' | 'hot';

export default function LeadsPage({ id }: PageProps) {
  return id ? <LeadDetail id={id} /> : <LeadList />;
}

/* ---------- list: table or pipeline ---------- */
function LeadList() {
  const { t, data, pack, lang, date, can, user, perms, dateTime } = useApp();
  const canWrite = can('write');
  // an office that keeps a full pipeline sees who was last contacted and what needs attention; the field editions keep their columns
  const full = pack.family === 'practice';
  const stages = stagesOf(data, pack); const sources = sourcesOf(data, pack);
  const route = useRoute();
  const view = route.query.get('view') === 'board' ? 'board' : 'table';
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed);
  const [stage, setStage] = useState<'open' | 'all' | LeadStage>('open');
  const [source, setSource] = useState<'' | LeadSource>('');
  const [owner, setOwner] = useState('');
  const [pri, setPri] = useState<'' | Priority>('');
  const [flag, setFlag] = useState<Flag>('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(() => canWrite && route.query.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const [lost, setLost] = useState<{ lead: Lead; to: LeadStage } | null>(null);
  const nextText = useNextText(); const reasonLabel = useReasonLabel();

  // a lead of another office is not listed: the same rule as for clients
  const mine = useMemo(() => visibleLeads(data, user, perms), [data, user, perms]);
  const hidden = useMemo(() => hiddenLeadCount(data, user, perms), [data, user, perms]);
  const signals = useMemo(() => {
    const messages = messageContacts(data); const cache = new Map<string, LeadSignals>();
    return (l: Lead): LeadSignals => { let s = cache.get(l.id); if (!s) { s = leadSignals(data, pack, l, messages); cache.set(l.id, s); } return s; };
  }, [data, pack]);

  const base = useMemo(() => {
    const s = q.trim().toLowerCase();
    return mine.filter((l) =>
      (!s || [l.name, l.company, l.phone, l.email, l.address, l.ticket].some((v) => v && v.toLowerCase().includes(s)))
      && (!source || l.source === source) && (!owner || l.ownerId === owner) && (!pri || l.pri === pri)
      && (!flag || (flag === 'attention' ? signals(l).attention : flag === 'stale' ? signals(l).stale : signals(l).hot)));
  }, [mine, q, source, owner, pri, flag, signals]);
  const rows = useMemo(() => base.filter((l) => (stage === 'open' ? isOpen(data, pack, l.status) : stage === 'all' ? true : l.status === stage)), [base, stage, data, pack]);
  const open = useMemo(() => mine.filter((l) => isOpen(data, pack, l.status)), [mine, data, pack]);
  const attention = useMemo(() => open.filter((l) => signals(l).attention).length, [open, signals]);
  const filtered = !!(typed || source || owner || pri || flag || stage !== 'open');
  const clear = () => { setTyped(''); setSource(''); setOwner(''); setPri(''); setFlag(''); setStage('open'); };
  useEffect(() => { setPage(0); }, [q, stage, source, owner, pri, flag]);
  const shown = useMemo(() => pageOf(rows, page), [rows, page]);
  // the rows on screen are rebuilt when the page of results changes, not on every letter typed in the search box
  const body = useMemo(() => shown.rows.map((l) => {
                  const s = signals(l); const u = byId(data.users, l.ownerId);
                  return (
                    <tr key={l.id} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/leads/${l.id}`); }}>
                      <td className="t1"><span className="leads-who"><A to={`/leads/${l.id}`} className="leads-name">{l.name}</A>{full && <HotMark signals={s} />} <PriorityBadge pri={l.pri} /></span><div className="xs dim">{l.ticket}{l.company ? ` · ${l.company}` : ''}</div></td>
                      <td data-label={t('leads.col.service')}>{t('ty_' + l.type)}<div className="xs dim">{t('src_' + l.source)}{full && l.sourceDetail ? ` · ${l.sourceDetail}` : ''}</div></td>
                      <td data-label={t('leads.col.stage')}><LeadStageBadge stage={l.status} /></td>
                      <td data-label={t('leads.col.next')}>{s.open ? <><NextStepLine lead={l} signals={s} plain={!full} />{full && <span className="leads-c-inline"><ContactAge signals={s} compact /></span>}</> : full && l.lostReason ? <span className="small muted">{reasonLabel(l.lostReason)}</span> : null}</td>
                      {full && <td className="leads-c-contact" data-label={t('leads.col.contact')}>{s.open ? <ContactAge signals={s} /> : <span className="small muted">{date(l.lostAt ?? l.created)}</span>}</td>}
                      <td data-label={t('leads.col.value')} className="num">{l.value ? money(l.value) : <span className="dim">{'—'}</span>}</td>
                      <td data-label={t('leads.col.owner')}>{u ? <span className="row tight nowrap" title={u.name}><Avatar name={u.name} size="sm" /><span className="leads-own">{u.name.split(' ')[0]}</span></span> : <span className="dim">{t('common.unassigned')}</span>}</td>
                      {!full && <td data-label={t('leads.col.age')} className="small muted">{date(l.created)}</td>}
                    </tr>
                  );
                }), [shown, signals, full, data, t, date, reasonLabel]);

  /** Moving a card to Won converts it; moving to Lost asks why. */
  const move = async (l: Lead, to: LeadStage) => {
    if (l.status === to || !canWrite) return;
    if (isWon(data, pack, to)) { if (await confirmDialog(t('leads.convertHint'), t('leads.convert'), t('common.cancel'), false)) { act(convertLead, l.id, to); toast(t('leads.converted')); } return; }
    if (isLost(data, pack, to)) { setLost({ lead: l, to }); return; }
    act(setLeadStage, l.id, to); toast(t('leads.moved', { stage: t('ls_' + to) }));
  };

  /** The list as filtered, for the export. What the person cannot see is not in it, and neither is anything protected. */
  const exportRows = (): unknown[][] => [
    ['data.f.ticket', 'data.f.name', 'data.f.company', 'data.f.phone', 'data.f.email', 'data.f.address', 'data.f.stage', 'data.f.source', 'data.f.sourceDetail', 'data.f.service', 'data.f.services', 'data.f.value', 'data.f.priority',
      'data.f.owner', 'data.f.office', 'data.f.nextAction', 'data.f.nextDue', 'data.f.lastContact', 'data.f.created', 'data.f.lostReason', 'data.f.lang'].map((k) => t(k)),
    ...(view === 'board' ? base : rows).map((l) => {
      const s = signals(l);
      return [l.ticket, l.name, l.company, l.phone, l.email, l.address, t('ls_' + l.status), t('src_' + l.source), l.sourceDetail, t('ty_' + l.type),
        (l.serviceIds ?? []).map((id) => { const x = byId(data.catalog, id); return x ? serviceName(x, lang) : ''; }).filter(Boolean).join('; '), l.value, t('pr.' + l.pri),
        byId(data.users, l.ownerId)?.name, byId(data.offices, l.officeId)?.name, s.next.kind === 'none' ? '' : nextText(s.next), s.next.due, s.lastContact ? dateTime(s.lastContact) : '', l.created, reasonLabel(l.lostReason), l.lang];
    }),
  ];

  return (
    <>
      <PageHeader title={t('leads.title')} sub={t('leads.sub')} actions={<>
        <Seg label={t('leads.view')} value={view} onChange={(v) => go(v === 'board' ? '/leads?view=board' : '/leads')} options={[
          { value: 'table', label: <><LuTable aria-hidden="true" />{t('leads.view.table')}</> }, { value: 'board', label: <><LuKanban aria-hidden="true" />{t('leads.view.board')}</> }]} />
        {mine.length > 0 && <ExportButton kind="leads" rows={exportRows} />}
        {canWrite && can('import') && <Button icon={<LuUpload />} onClick={() => setImporting(true)} data-testid="leads-import">{t('data.import')}</Button>}
        {canWrite && <Button variant={mine.length ? 'primary' : 'default'} icon={<LuPlus />} onClick={() => setForm(true)} data-testid="leads-new">{t('leads.new')}</Button>}
      </>} />

      <div className={cx('filters leads-filters', full && 'full')}>
        <SearchBox value={typed} onChange={setTyped} placeholder={t('leads.search')} />
        {view === 'table' && (
          <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label={t('leads.col.stage')} data-testid="leads-filter-stage">
            <option value="open">{t('leads.allStages')}</option><option value="all">{t('leads.everything')}</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{t('ls_' + s.id)}</option>)}
          </select>
        )}
        <select value={source} onChange={(e) => setSource(e.target.value as LeadSource | '')} aria-label={t('common.source')} data-testid="leads-filter-source">
          <option value="">{t('leads.allSources')}</option>{sources.map((s) => <option key={s.id} value={s.id}>{t('src_' + s.id)}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t('leads.col.owner')} data-testid="leads-filter-owner">
          <option value="">{t('leads.allOwners')}</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={pri} onChange={(e) => setPri(e.target.value as Priority | '')} aria-label={t('common.priority')}>
          <option value="">{t('leads.allPriorities')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}
        </select>
        {full && (
          <select value={flag} onChange={(e) => setFlag(e.target.value as Flag)} aria-label={t('leads.flag.label')} data-testid="leads-filter-flag">
            <option value="">{t('leads.flag.any')}</option><option value="attention">{t('leads.flag.attention')}</option><option value="stale">{t('leads.flag.stale')}</option><option value="hot">{t('leads.flag.hot')}</option>
          </select>
        )}
        {filtered && <button type="button" className="linkbtn small" onClick={clear}>{t('common.clearFilters')}</button>}
      </div>
      {mine.length > 0 && (
        <p className="small muted leads-sum">
          {t('leads.open', { n: open.length })} · {t('leads.pipeline')}: <b>{money(sum(open, (l) => l.value))}</b>
          {full && attention > 0 && <> · <button type="button" className="linkbtn leads-attn" onClick={() => { setFlag('attention'); setStage('open'); }} data-testid="leads-attention">{t('leads.attention', { n: attention })}</button></>}
        </p>
      )}

      {!mine.length ? (
        <Card className="work-none"><Empty title={t('leads.empty')} action={canWrite ? <Button variant="primary" icon={<LuPlus />} onClick={() => setForm(true)}>{t('leads.new')}</Button> : undefined}>{t('leads.emptyHint')}</Empty></Card>
      ) : view === 'board' ? (
        <Board leads={base} signals={signals} onMove={move} />
      ) : !rows.length ? (
        <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} /></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className={cx('tbl stackable', full && 'leads-full')} data-testid="leads-table">
              <thead><tr><th>{t('leads.col.lead')}</th><th>{t('leads.col.service')}</th><th>{t('leads.col.stage')}</th><th>{t('leads.col.next')}</th>{full && <th className="leads-c-contact">{t('leads.col.contact')}</th>}<th className="num">{t('leads.col.value')}</th><th>{t('leads.col.owner')}</th>{!full && <th>{t('leads.col.age')}</th>}</tr></thead>
              <tbody>
                {body}
              </tbody>
              <tfoot><tr><td colSpan={4}>{t('leads.total')} ({rows.length})</td>{full && <td className="leads-c-contact" />}<td className="num">{money(sum(rows, (l) => l.value))}</td><td colSpan={full ? 1 : 2} /></tr></tfoot>
            </table>
          </div>
          <Pager total={rows.length} page={shown.page} onPage={setPage} testId="leads-pager" />
        </Card>
      )}
      {hidden > 0 && <p className="small muted leads-hidden" data-testid="leads-hidden"><LuLock aria-hidden="true" />{t('leads.hidden', { n: hidden })}</p>}

      {form && <LeadForm onClose={() => setForm(false)} />}
      {importing && <ImportDialog kind="leads" onClose={() => setImporting(false)} />}
      {lost && <LostModal lead={lost.lead} to={lost.to} onClose={() => setLost(null)} />}
    </>
  );
}
