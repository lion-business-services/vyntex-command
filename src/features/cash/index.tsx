// Petty cash: the cash drawer of each office. Money in and money out with a category, a note and a receipt; the running
// balance; and the daily close, where the drawer is counted, compared with what the records say it should hold, and
// locked. All arithmetic is in whole cents (src/domain/selectors.ts). Closing a day is a protected operation.
import { useMemo, useState } from 'react';
import { LuArrowDownLeft, LuArrowLeftRight, LuArrowUpRight, LuCheck, LuLock, LuPencil, LuPlus, LuScale, LuTags, LuTrash2, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { PageProps } from '@/app/routes';
import { act, mutate } from '@/store/store';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, Note, PageHeader, SearchBox, Seg, Stat, Tabs, confirmDialog, cx, toast } from '@/ui';
import { ActivityList, CanWrite, DemoTag } from '@/app/shared';
import { gateway } from '@/platform/gateway';
import { addCashEntry, approveCashClose, deleteCashEntry, transferCash, updateCashEntry } from '@/domain/actions';
import { DEFAULT_CASH_CATEGORIES, canApproveClose, cashCategories, saveCashCategories, type OpsRefusal } from '@/domain/actions/ops';
import { actorName, byId, cashBalance, cashExpected, cashLedger, cashLockedThrough, cents, dollars, isCashLocked, sameDrawer, total } from '@/domain/selectors';
import type { CashClose, CashEntry, FileRef } from '@/domain/types';
import { addDaysFrom, today } from '@/lib/dates';
import { money2, parseMoney } from '@/lib/money';
import { ExportCsv, FileLink, FilePick, MoneyInput } from './parts';
import './cash.css';

type Tab = 'ledger' | 'closes' | 'history';
/** The drawer of a firm without offices, and of entries that name no office. */
const GENERAL = '';
const refusal = (r: OpsRefusal | string) => 'cash.err.' + (['locked', 'invalid', 'not_found', 'not_allowed', 'needs_other_person'].includes(r) ? r : 'failed');

export default function CashPage(_: PageProps) {
  const { t, data, can, user, date, dateTime, live } = useApp();
  const offices = data.offices;
  // one drawer per office; a firm without offices has one drawer, and so do entries that name no office
  const drawers = useMemo(() => {
    const loose = !offices.length || data.cash.some((e) => !e.officeId) || data.cashCloses.some((c) => !c.officeId);
    return [...offices.map((o) => ({ id: o.id, name: o.name })), ...(loose ? [{ id: GENERAL, name: t('cash.drawer.general') }] : [])];
  }, [data, offices, t]);
  const mine = user?.officeIds?.find((id) => drawers.some((d) => d.id === id)) ?? offices.find((o) => o.main)?.id ?? drawers[0]?.id ?? GENERAL;
  const [drawerId, setDrawerId] = useState(mine);
  const drawer = drawers.find((d) => d.id === drawerId) ?? drawers[0];
  const officeId = drawer.id || undefined;

  const [tab, setTab] = useState<Tab>('ledger');
  const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [dir, setDir] = useState<'' | 'in' | 'out'>(''); const [cat, setCat] = useState(''); const [who, setWho] = useState('');
  const [form, setForm] = useState<{ entry?: CashEntry } | null>(null);
  const [closing, setClosing] = useState(false); const [cats, setCats] = useState(false); const [moving, setMoving] = useState(false);

  const mayChange = can('write') && can('cash');
  const categories = cashCategories(data);
  const catLabel = (c: string) => (DEFAULT_CASH_CATEGORIES.includes(c) ? t('cash.cat.' + c) : c);
  const ledger = useMemo(() => cashLedger(data, officeId), [data, officeId]);
  const entries = data.cash.filter((e) => sameDrawer(e.officeId, officeId));
  const closes = data.cashCloses.filter((c) => sameDrawer(c.officeId, officeId)).sort((a, b) => b.date.localeCompare(a.date));
  const lockedThrough = cashLockedThrough(data, officeId);
  const balance = cashBalance(data, officeId);
  const month = today().slice(0, 7);
  const inMonth = entries.filter((e) => e.date.startsWith(month));
  const waiting = closes.filter((c) => !c.approvedBy);

  const filtered = !!(q || from || to || dir || cat || who);
  const narrowed = !!(q || dir || cat || who);
  const s = q.trim().toLowerCase();
  const lines = [...ledger].reverse().filter((l) => {
    if ((from && l.date < from) || (to && l.date > to)) return false;
    if (l.kind === 'close') return !narrowed;
    const e = l.entry!;
    return (!dir || e.dir === dir) && (!cat || e.category === cat) && (!who || e.by === who) && (!s || [e.memo, catLabel(e.category), actorName(data, e.by) ?? ''].some((v) => v.toLowerCase().includes(s)));
  });
  const shown = lines.filter((l) => l.kind === 'entry').map((l) => l.entry!);
  const totalIn = total(shown.filter((e) => e.dir === 'in'), (e) => e.amount), totalOut = total(shown.filter((e) => e.dir === 'out'), (e) => e.amount);
  const clear = () => { setQ(''); setFrom(''); setTo(''); setDir(''); setCat(''); setWho(''); };
  const people = data.users.filter((u) => entries.some((e) => e.by === u.id));
  const usedCats = [...new Set([...categories, ...entries.map((e) => e.category)])];

  const remove = async (e: CashEntry) => {
    if (!(await confirmDialog(t('cash.deleteConfirm', { amount: money2(e.amount) }), t('common.delete'), t('common.cancel')))) return;
    const out = act(deleteCashEntry, e.id);
    toast(out.ok ? t('common.deleted') : t(refusal(out.reason)), !out.ok);
  };
  const approve = (c: CashClose) => { const out = act(approveCashClose, c.id); toast(out.ok ? t('cash.approved') : t(refusal(out.reason)), !out.ok); };
  const csvRows = () => [
    [t('common.date'), t('cash.col.dir'), t('cash.col.category'), t('cash.col.memo'), t('cash.col.by'), t('cash.col.in'), t('cash.col.out'), t('cash.col.balance'), t('cash.col.state')],
    ...lines.map((l) => (l.kind === 'close'
      ? [l.date, t('cash.close.row'), '', l.close!.note ?? '', actorName(data, l.close!.by) ?? '', '', '', l.balance.toFixed(2), l.close!.approvedBy ? t('cash.close.approved') : t('cash.close.waiting')]
      : [l.date, t('cash.dir.' + l.entry!.dir), catLabel(l.entry!.category), l.entry!.memo, actorName(data, l.entry!.by) ?? '', l.entry!.dir === 'in' ? l.entry!.amount.toFixed(2) : '', l.entry!.dir === 'out' ? l.entry!.amount.toFixed(2) : '', l.balance.toFixed(2), isCashLocked(data, l.entry!) ? t('cash.locked') : ''])),
  ];
  const history = data.activity.filter((a) => a.ref.type === 'cash');

  return (
    <div className="cash">
      <PageHeader title={t('nav.cash')} sub={t('cash.sub')} actions={<>
        {can('config') && can('write') && <Button icon={<LuTags aria-hidden="true" />} onClick={() => setCats(true)} data-testid="cash-categories">{t('cash.categories')}</Button>}
        {mayChange && offices.length > 1 && <Button icon={<LuArrowLeftRight aria-hidden="true" />} onClick={() => setMoving(true)} data-testid="cash-transfer">{t('cash.transfer')}</Button>}
        {mayChange && <Button icon={<LuScale aria-hidden="true" />} onClick={() => setClosing(true)} data-testid="cash-close">{t('cash.close')}</Button>}
        {mayChange && <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm({})} data-testid="cash-new">{t('cash.new')}</Button>}
      </>} />

      {drawers.length > 1 && (
        <div className="cash-drawers" data-testid="cash-drawer">
          <Seg label={t('cash.drawer')} value={drawer.id} onChange={(v) => { setDrawerId(v); clear(); }} options={drawers.map((d) => ({ value: d.id, label: d.name }))} />
        </div>
      )}

      <div className="kpis cash-kpis">
        <Stat label={t('cash.k.balance')} value={money2(balance)} hint={lockedThrough ? t('cash.k.lastCount', { date: date(lockedThrough) }) : t('cash.k.neverCounted')} testId="cash-kpi-balance" />
        <Stat label={t('cash.k.in')} value={money2(total(inMonth.filter((e) => e.dir === 'in'), (e) => e.amount))} hint={t('cash.k.month')} testId="cash-kpi-in" />
        <Stat label={t('cash.k.out')} value={money2(total(inMonth.filter((e) => e.dir === 'out'), (e) => e.amount))} hint={t('cash.k.month')} testId="cash-kpi-out" />
        <Stat label={t('cash.k.waiting')} value={String(waiting.length)} hint={waiting.length ? t('cash.k.waitingHint') : t('cash.k.waitingNone')} attention={waiting.length > 0} onClick={() => setTab('closes')} testId="cash-kpi-waiting" />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'ledger', label: t('cash.tab.ledger'), count: entries.length }, { id: 'closes', label: t('cash.tab.closes'), count: closes.length }, { id: 'history', label: t('cash.tab.history') }]} />

      {tab === 'ledger' && (
        <>
          <div className="filters cash-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('cash.search')} />
            <label className="cash-date"><span>{t('common.from')}</span><input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="cash-from" /></label>
            <label className="cash-date"><span>{t('common.to')}</span><input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="cash-to" /></label>
            <select value={dir} onChange={(e) => setDir(e.target.value as '' | 'in' | 'out')} aria-label={t('cash.col.dir')} data-testid="cash-filter-dir">
              <option value="">{t('cash.dir.all')}</option><option value="in">{t('cash.dir.in')}</option><option value="out">{t('cash.dir.out')}</option>
            </select>
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('cash.col.category')} data-testid="cash-filter-category">
              <option value="">{t('cash.cat.all')}</option>{usedCats.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('cash.col.by')} data-testid="cash-filter-person">
              <option value="">{t('cash.by.all')}</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="cash-clear">{t('common.clearFilters')}</button>}
            <span className="grow" />
            <ExportCsv size="sm" name={t('cash.file')} rows={csvRows} testId="cash-csv" />
          </div>

          <Card flush>
            {!entries.length ? (
              <Empty title={t('cash.empty')} action={mayChange ? <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm({})}>{t('cash.new')}</Button> : undefined}>{t('cash.emptyHint')}</Empty>
            ) : !lines.length ? (
              <Empty title={t('common.noResults')} action={<Button onClick={clear}>{t('common.clearFilters')}</Button>} />
            ) : (
              <div className="table-wrap">
                <table className="tbl stackable cash-tbl" data-testid="cash-ledger">
                  <thead><tr><th>{t('common.date')}</th><th>{t('cash.col.what')}</th><th>{t('cash.col.by')}</th><th className="num">{t('cash.col.in')}</th><th className="num">{t('cash.col.out')}</th><th className="num">{t('cash.col.balance')}</th><th aria-label={t('common.actions')} /></tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      if (l.kind === 'close') {
                        const c = l.close!;
                        return (
                          <tr key={c.id} className="cash-closeline" data-close={c.id}>
                            <td className="t1 nowrap">{date(c.date)}</td>
                            <td colSpan={2}><span className="cash-closetag"><LuScale aria-hidden="true" />{t('cash.close.row')}</span> <span className="small muted">{t('cash.close.line', { counted: money2(c.counted), expected: money2(c.expected) })}</span></td>
                            <td colSpan={2} data-label={t('cash.col.diff')} className={cx('num', cents(c.diff) < 0 && 'neg', cents(c.diff) > 0 && 'pos')}>{cents(c.diff) === 0 ? t('cash.diff.none') : t(cents(c.diff) < 0 ? 'cash.diff.short' : 'cash.diff.over', { amount: money2(Math.abs(c.diff)) })}</td>
                            <td data-label={t('cash.col.balance')} className="num strong">{money2(l.balance)}</td>
                            <td className="num">{c.approvedBy ? <Badge tone="ok">{t('cash.close.approved')}</Badge> : <Badge tone="warn">{t('cash.close.waiting')}</Badge>}</td>
                          </tr>
                        );
                      }
                      const e = l.entry!; const lock = isCashLocked(data, e);
                      return (
                        <tr key={e.id} data-entry={e.id}>
                          <td className="t1 nowrap">{date(e.date)}</td>
                          <td data-label={t('cash.col.what')}>
                            <span className="cash-what"><span className={cx('cash-dir', e.dir)} aria-hidden="true">{e.dir === 'in' ? <LuArrowDownLeft /> : <LuArrowUpRight />}</span><span><b>{catLabel(e.category)}</b>{e.memo && <span className="small muted cash-memo">{e.memo}</span>}{e.receipt && <span className="cash-receipt"><FileLink file={e.receipt} title={t('cash.receipt')}>{t('cash.receipt')}</FileLink></span>}</span></span>
                          </td>
                          <td data-label={t('cash.col.by')} className="small">{actorName(data, e.by) ?? ''}</td>
                          <td data-label={t('cash.col.in')} className="num pos">{e.dir === 'in' ? money2(e.amount) : null}</td>
                          <td data-label={t('cash.col.out')} className="num">{e.dir === 'out' ? money2(e.amount) : null}</td>
                          <td data-label={t('cash.col.balance')} className="num strong">{money2(l.balance)}</td>
                          <td className="num cash-act">
                            {lock ? <span className="cash-lock" title={t('cash.lockedHint')}><LuLock aria-hidden="true" /><span className="xs">{t('cash.locked')}</span></span>
                              : mayChange ? <span className="row tight nowrap"><IconButton size="sm" label={`${t('common.edit')}: ${catLabel(e.category)} ${money2(e.amount)}`} onClick={() => setForm({ entry: e })}><LuPencil /></IconButton>{can('delete') && <IconButton size="sm" label={`${t('common.delete')}: ${catLabel(e.category)} ${money2(e.amount)}`} onClick={() => { void remove(e); }}><LuTrash2 /></IconButton>}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>{t(filtered ? 'cash.totalShown' : 'common.total')} ({shown.length})</td><td className="num" data-label={t('cash.col.in')}>{money2(totalIn)}</td><td className="num" data-label={t('cash.col.out')}>{money2(totalOut)}</td><td colSpan={2} /></tr></tfoot>
                </table>
              </div>
            )}
          </Card>
          <p className="xs dim cash-foot">{t('cash.balanceNote')}</p>
        </>
      )}

      {tab === 'closes' && (
        <Card flush>
          {!closes.length ? (
            <Empty title={t('cash.closes.empty')} action={mayChange ? <Button icon={<LuScale aria-hidden="true" />} onClick={() => setClosing(true)}>{t('cash.close')}</Button> : undefined}>{t('cash.closes.emptyHint')}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="tbl stackable cash-tbl" data-testid="cash-closes">
                <thead><tr><th>{t('common.date')}</th><th className="num">{t('cash.col.expected')}</th><th className="num">{t('cash.col.counted')}</th><th className="num">{t('cash.col.diff')}</th><th>{t('cash.col.countedBy')}</th><th>{t('cash.col.approval')}</th></tr></thead>
                <tbody>
                  {closes.map((c) => (
                    <tr key={c.id} data-close={c.id}>
                      <td className="t1"><span className="nowrap">{date(c.date)}</span>{c.note && <div className="small muted cash-memo">{c.note}</div>}</td>
                      <td data-label={t('cash.col.expected')} className="num">{money2(c.expected)}</td>
                      <td data-label={t('cash.col.counted')} className="num strong">{money2(c.counted)}</td>
                      <td data-label={t('cash.col.diff')} className={cx('num', cents(c.diff) < 0 && 'neg', cents(c.diff) > 0 && 'pos')}>{cents(c.diff) === 0 ? money2(0) : (cents(c.diff) > 0 ? '+' : '−') + money2(Math.abs(c.diff))}</td>
                      <td data-label={t('cash.col.countedBy')} className="small">{actorName(data, c.by) ?? ''}<div className="xs dim">{dateTime(c.at)}</div></td>
                      <td data-label={t('cash.col.approval')}>
                        {c.approvedBy ? <span className="cash-ok"><LuCheck aria-hidden="true" />{t('cash.close.approvedBy', { name: actorName(data, c.approvedBy) ?? '' })}</span>
                          : can('write') && canApproveClose(data, user?.id, c) ? <Button size="sm" variant="primary" icon={<LuCheck aria-hidden="true" />} onClick={() => approve(c)} data-testid="cash-approve">{t('cash.close.approve')}</Button>
                          : <span><Badge tone="warn">{t('cash.close.waiting')}</Badge>{c.by === user?.id && <div className="xs dim cash-memo">{t('cash.close.other')}</div>}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && <Card title={t('cash.tab.history')}><p className="small muted cash-histnote">{t('cash.history.note')}</p><ActivityList items={history} limit={20} /></Card>}

      {form && <EntryForm entry={form.entry} officeId={officeId} drawerName={drawers.length > 1 ? drawer.name : undefined} categories={usedCats} catLabel={catLabel} lockedThrough={lockedThrough} onClose={() => setForm(null)} />}
      {closing && <CloseForm officeId={officeId} drawerName={drawers.length > 1 ? drawer.name : undefined} live={live} onClose={() => setClosing(false)} onDone={() => { setClosing(false); setTab('closes'); }} />}
      {cats && <CategoriesForm catLabel={catLabel} onClose={() => setCats(false)} />}
      {moving && <TransferForm from={officeId ?? offices[0]?.id ?? ''} onClose={() => setMoving(false)} />}
    </div>
  );
}

/* ---------- add or change an entry ---------- */
function EntryForm({ entry, officeId: office, drawerName, categories: list, catLabel: label, lockedThrough: locked, onClose }: { entry?: CashEntry; officeId?: string; drawerName?: string; categories: string[]; catLabel: (c: string) => string; lockedThrough: string; onClose: () => void }) {
  const { t, date, live } = useApp();
  const [way, setWay] = useState<'in' | 'out'>(entry?.dir ?? 'out');
  const [amount, setAmount] = useState(entry ? entry.amount.toFixed(2) : '');
  const [day, setDay] = useState(entry?.date ?? (locked && locked >= today() ? '' : today()));
  const [category, setCategory] = useState(entry?.category ?? list[0] ?? 'other');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const [receipt, setReceipt] = useState<FileRef | undefined>(entry?.receipt);
  const [err, setErr] = useState('');
  const first = locked ? addDaysFrom(locked, 1) : undefined;
  const save = () => {
    const n = parseMoney(amount);
    if (n === null || n <= 0) { setErr(t('cash.err.amount')); return; }
    if (!day) { setErr(t('common.required')); return; }
    const input = { date: day, officeId: office, dir: way, amount: n, category, memo, receipt };
    const out = entry ? act(updateCashEntry, entry.id, input) : act(addCashEntry, input);
    if (!out.ok) { setErr(t(refusal(out.reason))); return; }
    toast(t(entry ? 'common.saved' : way === 'in' ? 'cash.addedIn' : 'cash.addedOut', { amount: money2(n) })); onClose();
  };
  return (
    <Modal title={t(entry ? 'cash.edit' : 'cash.new')} onClose={onClose} labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="cash-save">{t('common.save')}</Button></>}>
      {drawerName && <p className="small muted cash-formnote">{t('cash.form.drawer', { name: drawerName })}</p>}
      {locked && locked >= today() && !entry && <Note tone="warn">{t('cash.form.closedToday')}</Note>}
      <div className="fgrid">
        <div className="field full"><span className="label">{t('cash.col.dir')}</span><Seg label={t('cash.col.dir')} value={way} onChange={setWay} options={[{ value: 'out', label: <><LuArrowUpRight aria-hidden="true" />{t('cash.dir.out')}</> }, { value: 'in', label: <><LuArrowDownLeft aria-hidden="true" />{t('cash.dir.in')}</> }]} /></div>
        <Field label={t('common.amount')} htmlFor="cash-amount" error={!!err && (parseMoney(amount) ?? 0) <= 0}><MoneyInput id="cash-amount" value={amount} onChange={(v) => { setAmount(v); setErr(''); }} testId="cash-amount" autoFocus /></Field>
        <Field label={t('common.date')} htmlFor="cash-date" hint={locked ? t('cash.form.after', { date: date(locked) }) : undefined}><input id="cash-date" type="date" value={day} min={first} max={today()} onChange={(e) => { setDay(e.target.value); setErr(''); }} data-testid="cash-date" /></Field>
        <Field label={t('cash.col.category')} htmlFor="cash-cat"><select id="cash-cat" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="cash-category">{list.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
        <Field label={t('cash.col.memo')} htmlFor="cash-memo"><input id="cash-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t('cash.form.memoPh')} data-testid="cash-memo" /></Field>
        <div className="field full"><span className="label">{t('cash.receipt')} ({t('common.optional')})</span><FilePick file={receipt} onChange={setReceipt} where={{ folder: 'cash' }} label={t('cash.receipt')} testId="cash-receipt" />{!live && <span className="hint">{t('cash.form.receiptSample')}</span>}</div>
      </div>
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

/* ---------- close the day: count, compare, lock ---------- */
function CloseForm({ officeId, drawerName, live, onClose, onDone }: { officeId?: string; drawerName?: string; live: boolean; onClose: () => void; onDone: () => void }) {
  const { t, data, date } = useApp();
  const locked = cashLockedThrough(data, officeId);
  const [day, setDay] = useState(locked && locked >= today() ? '' : today());
  const [counted, setCounted] = useState(''); const [note, setNote] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const expected = day ? cashExpected(data, day, officeId) : 0;
  const n = parseMoney(counted);
  const diff = n === null ? null : dollars(cents(n) - cents(expected));
  const open = data.cash.filter((e) => sameDrawer(e.officeId, officeId) && !e.closeId && !!day && e.date <= day && (!locked || e.date > locked));
  const save = async () => {
    if (!day) { setErr(t('cash.err.locked')); return; }
    if (n === null || n < 0) { setErr(t('cash.err.count')); return; }
    if (diff !== null && cents(diff) !== 0 && !note.trim()) { setErr(t('cash.err.note')); return; }
    setBusy(true);
    try {
      const out = await gateway().protected.cashClose({ date: day, officeId, counted: n, note });
      if (!out.ok) { setErr(t(refusal(out.reason))); return; }
      toast(t('cash.closed', { date: date(out.data.date) })); onDone();
    } catch { setErr(t('cash.err.failed')); } finally { setBusy(false); }
  };
  return (
    <Modal title={<>{t('cash.close')} {!live && <DemoTag />}</>} onClose={onClose} labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { void save(); }} disabled={busy} data-testid="cash-close-save">{t('cash.close.save')}</Button></>}>
      <p className="small muted cash-formnote">{drawerName ? t('cash.form.drawer', { name: drawerName }) + ' ' : ''}{t('cash.close.how')}</p>
      <div className="fgrid">
        <Field label={t('cash.close.day')} htmlFor="cash-close-date" hint={locked ? t('cash.form.after', { date: date(locked) }) : undefined}><input id="cash-close-date" type="date" value={day} min={locked ? addDaysFrom(locked, 1) : undefined} max={today()} onChange={(e) => { setDay(e.target.value); setErr(''); }} data-testid="cash-close-date" /></Field>
        <div className="field"><span className="label">{t('cash.col.expected')}</span><output className="cash-expected" data-testid="cash-close-expected">{money2(expected)}</output><span className="hint">{t('cash.close.entries', { n: open.length })}</span></div>
        <Field label={t('cash.col.counted')} htmlFor="cash-counted"><MoneyInput id="cash-counted" value={counted} onChange={(v) => { setCounted(v); setErr(''); }} testId="cash-counted" autoFocus /></Field>
        <div className="field"><span className="label">{t('cash.col.diff')}</span><output className={cx('cash-expected', diff !== null && cents(diff) < 0 && 'neg', diff !== null && cents(diff) > 0 && 'pos')} data-testid="cash-close-diff">{diff === null ? ' ' : cents(diff) === 0 ? t('cash.diff.none') : t(cents(diff) < 0 ? 'cash.diff.short' : 'cash.diff.over', { amount: money2(Math.abs(diff)) })}</output></div>
        <Field label={t('cash.close.note')} htmlFor="cash-close-note" full hint={t('cash.close.noteHint')}><textarea id="cash-close-note" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setErr(''); }} data-testid="cash-close-note" /></Field>
      </div>
      <Note tone="warn">{t('cash.close.warn')}</Note>
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

/* ---------- the company's list of categories ---------- */
function CategoriesForm({ catLabel, onClose }: { catLabel: (c: string) => string; onClose: () => void }) {
  const { t, data } = useApp();
  const [list, setList] = useState<string[]>(() => cashCategories(data));
  const [name, setName] = useState('');
  const add = () => { const v = name.trim(); if (!v || list.some((c) => catLabel(c).toLowerCase() === v.toLowerCase())) return; setList([...list, v]); setName(''); };
  const save = () => { mutate((d) => saveCashCategories(d, list), 'config'); toast(t('common.saved')); onClose(); };
  return (
    <Modal title={t('cash.categories')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="cash-categories-save">{t('common.save')}</Button></>}>
      <p className="small muted cash-formnote">{t('cash.categories.hint')}</p>
      <ul className="cash-cats">
        {list.map((c) => <li key={c}><span className="grow">{catLabel(c)}</span><IconButton size="sm" label={`${t('common.delete')}: ${catLabel(c)}`} onClick={() => setList(list.filter((x) => x !== c))} disabled={list.length <= 1}><LuX /></IconButton></li>)}
      </ul>
      <form className="row nowrap cash-catadd" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cash.categories.ph')} aria-label={t('cash.categories.ph')} data-testid="cash-categories-name" />
        <Button type="submit" icon={<LuPlus aria-hidden="true" />} disabled={!name.trim()}>{t('common.add')}</Button>
      </form>
      <button type="button" className="linkbtn small" style={{ marginTop: 10 }} onClick={() => setList([...DEFAULT_CASH_CATEGORIES])}>{t('cash.categories.reset')}</button>
    </Modal>
  );
}

/* ---------- move cash between two offices ---------- */
function TransferForm({ from: start, onClose }: { from: string; onClose: () => void }) {
  const { t, data } = useApp();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(data.offices.find((o) => o.id !== start)?.id ?? '');
  const [amount, setAmount] = useState(''); const [memo, setMemo] = useState(''); const [err, setErr] = useState('');
  const save = () => {
    const n = parseMoney(amount);
    if (n === null || n <= 0) { setErr(t('cash.err.amount')); return; }
    const out = act(transferCash, { date: today(), from, to, amount: n, memo });
    if (!out.ok) { setErr(t(out.reason === 'invalid' ? 'cash.err.transfer' : refusal(out.reason))); return; }
    toast(t('cash.transferred', { amount: money2(n), office: byId(data.offices, to)?.name ?? '' })); onClose();
  };
  return (
    <Modal title={t('cash.transfer')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="cash-transfer-save">{t('cash.transfer.save')}</Button></>}>
      <p className="small muted cash-formnote">{t('cash.transfer.hint')}</p>
      <div className="fgrid">
        <Field label={t('cash.transfer.from')} htmlFor="cash-tr-from"><select id="cash-tr-from" value={from} onChange={(e) => { setFrom(e.target.value); setErr(''); }}>{data.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label={t('cash.transfer.to')} htmlFor="cash-tr-to"><select id="cash-tr-to" value={to} onChange={(e) => { setTo(e.target.value); setErr(''); }}>{data.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label={t('common.amount')} htmlFor="cash-tr-amount"><MoneyInput id="cash-tr-amount" value={amount} onChange={(v) => { setAmount(v); setErr(''); }} testId="cash-transfer-amount" autoFocus /></Field>
        <Field label={t('cash.col.memo')} htmlFor="cash-tr-memo"><input id="cash-tr-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      </div>
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}
