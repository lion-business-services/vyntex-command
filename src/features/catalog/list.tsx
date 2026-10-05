// The catalog: every service the company sells, grouped by category, with its price tiers at a glance.
// Built to stay readable with a large catalog (150 services and more): search and filters narrow it, categories fold.
import { useMemo, useState } from 'react';
import { LuCalendarClock, LuChevronDown, LuDownload, LuFileText, LuListChecks, LuPlus, LuRepeat, LuUpload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { Badge, Button, Card, Empty, SearchBox, Seg, cx, toast } from '@/ui';
import { type Service, serviceDescription, serviceName } from '@/domain/actions/catalog';
import type { Repeat } from '@/domain/types';
import { downloadCsv } from '@/features/data/csv';
import { catalogCsvRows } from './csv';
import { ImportDialog, ServiceForm } from './forms';
import { REPEAT_OPTIONS, categoriesOf, categoryLabel, serviceText, tierPrice } from './parts';

type Show = 'active' | 'retired' | 'all';
/** Tiers shown on a row before the rest is summed up as "+2". */
const TIERS_SHOWN = 3;
/** Above this many services the list opens as an index: the categories folded, each with its count, the first one open. */
const FOLD_ABOVE = 60;

export function ServiceList({ canEdit }: { canEdit: boolean }) {
  const { t, data, pack, lang, can } = useApp();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('*');
  const [show, setShow] = useState<Show>('active');
  const [repeat, setRepeat] = useState<'' | 'any' | Repeat>('');
  /** Categories a person opened or folded by hand. The rest follow the size of the list. */
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState(false);
  const [imp, setImp] = useState(false);

  const all = (data.catalog ?? []) as Service[];
  const retired = all.filter((s) => !s.active).length;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((x) =>
      (show === 'all' || (show === 'active') === x.active)
      && (category === '*' || x.category === category)
      && (!repeat || (repeat === 'any' ? !!x.repeat && x.repeat !== 'once' : (x.repeat ?? 'once') === repeat))
      && (!s || serviceText(t, pack, x).includes(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, category, show, repeat, pack, t]);
  const groups = categoriesOf(pack, rows).map((c) => ({ id: c, list: rows.filter((x) => x.category === c).sort((a, b) => serviceName(a, lang).localeCompare(serviceName(b, lang), lang)) }));
  const filtered = !!(q || category !== '*' || repeat || show !== 'active');
  const clear = () => { setQ(''); setCategory('*'); setRepeat(''); setShow('active'); setChosen({}); };
  // a short list, or one somebody searched or filtered, shows everything; a long one starts folded so the page stays an overview
  const big = rows.length > FOLD_ABOVE && !q.trim() && category === '*';
  const isOpen = (c: string, i: number) => chosen[c] ?? (!big || i === 0);
  const toggle = (c: string, i: number) => setChosen((m) => ({ ...m, [c]: !isOpen(c, i) }));
  const setAll = (open: boolean) => setChosen(Object.fromEntries(groups.map((g) => [g.id, open])));
  const firstOpen = groups.find((g, i) => isOpen(g.id, i))?.id;
  const exportCsv = () => { downloadCsv('services.csv', catalogCsvRows(data, rows, t, pack)); toast(t('catalog.exported', { n: rows.length })); };
  const usedRepeats = REPEAT_OPTIONS.filter((r) => all.some((x) => (x.repeat ?? 'once') === r));

  return (
    <>
      <div className="catalog-bar">
        <div className="filters catalog-filters">
          <SearchBox value={q} onChange={setQ} placeholder={t('catalog.search')} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('catalog.f.category')} data-testid="catalog-filter-category">
            <option value="*">{t('catalog.cat.all')}</option>{categoriesOf(pack, all).map((c) => <option key={c} value={c}>{categoryLabel(t, pack, c)}</option>)}
          </select>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} aria-label={t('catalog.f.repeat')} data-testid="catalog-filter-repeat">
            <option value="">{t('catalog.rep.all')}</option><option value="any">{t('catalog.rep.any')}</option>{usedRepeats.map((r) => <option key={r} value={r}>{t('jobs.rp.' + r)}</option>)}
          </select>
          <Seg label={t('catalog.show')} value={show} onChange={setShow} options={[{ value: 'active', label: t('catalog.show.active') }, { value: 'retired', label: t('catalog.show.retired'), count: retired || undefined }, { value: 'all', label: t('common.all') }]} />
          {filtered && <button type="button" className="linkbtn small" onClick={clear} data-testid="catalog-clear">{t('common.clearFilters')}</button>}
        </div>
        <div className="row tight catalog-acts">
          {canEdit && can('import') && <Button icon={<LuUpload aria-hidden="true" />} onClick={() => setImp(true)} data-testid="catalog-import">{t('catalog.import')}</Button>}
          {can('export') && all.length > 0 && <Button icon={<LuDownload aria-hidden="true" />} onClick={exportCsv} data-testid="catalog-export">{t('catalog.export')}</Button>}
          {canEdit && <Button variant={all.length ? 'primary' : 'default'} icon={<LuPlus aria-hidden="true" />} onClick={() => setForm(true)} data-testid="catalog-new">{t('catalog.new')}</Button>}
        </div>
      </div>
      {all.length > 0 && (
        <p className="small muted catalog-sum" data-testid="catalog-sum">
          {t(rows.length === all.length ? 'catalog.sum' : 'catalog.sumOf', { n: rows.length, total: all.length })} · {t('catalog.sum.tiers', { n: rows.reduce((a, s) => a + s.tiers.length, 0) })}
          {retired > 0 && show !== 'retired' ? <> · {t('catalog.sum.retired', { n: retired })}</> : null}
          {groups.length > 1 && <> · <button type="button" className="linkbtn" onClick={() => setAll(!groups.every((g, i) => isOpen(g.id, i)))} data-testid="catalog-fold-all">{t(groups.every((g, i) => isOpen(g.id, i)) ? 'catalog.foldAll' : 'catalog.openAll')}</button></>}
        </p>
      )}

      {!all.length ? (
        <Card className="work-none"><Empty title={t('catalog.empty')} action={canEdit ? <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm(true)}>{t('catalog.new')}</Button> : undefined}>{t(canEdit ? 'catalog.emptyHint' : 'catalog.emptyRead')}</Empty></Card>
      ) : !rows.length ? (
        <Card className="work-none"><Empty title={t('common.noResults')} action={<Button onClick={clear} data-testid="catalog-clear-empty">{t('common.clearFilters')}</Button>} /></Card>
      ) : (
        <div className="stack catalog-groups" data-testid="catalog-list">
          {groups.map((g, i) => {
            const open = isOpen(g.id, i);
            // the column names are shown once, on the first category that is open; the others keep them for screen readers
            const quiet = g.id !== firstOpen;
            return (
              <Card flush key={g.id} className="catalog-group">
                <button type="button" className="catalog-group-h" aria-expanded={open} onClick={() => toggle(g.id, i)} data-testid="catalog-group">
                  <span><b>{categoryLabel(t, pack, g.id)}</b> <span className="count">{g.list.length}</span></span>
                  <LuChevronDown aria-hidden="true" className={cx('catalog-chev', open && 'open')} />
                </button>
                {open && (
                  <div className="table-wrap">
                    <table className={cx('tbl stackable catalog-table', quiet && 'catalog-quiet')}>
                      <colgroup><col className="catalog-col-1" /><col className="catalog-col-2" /><col className="catalog-col-3" /></colgroup>
                      <thead><tr><th>{t('catalog.col.service')}</th><th>{t('catalog.tiers')}</th><th>{t('catalog.col.starts')}</th></tr></thead>
                      <tbody>
                        {g.list.map((s) => <Row key={s.id} s={s} />)}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {form && <ServiceForm onClose={() => setForm(false)} onSaved={(s) => go(`/catalog/${s.id}`)} />}
      {imp && <ImportDialog onClose={() => setImp(false)} />}
    </>
  );
}

function Row({ s }: { s: Service }) {
  const { t, data, lang } = useApp();
  const about = serviceDescription(s, lang);
  const pb = (data.playbooks ?? []).find((p) => p.id === s.playbookId);
  const appt = (data.apptTypes ?? []).find((a) => a.id === s.appointmentTypeId);
  const repeats = !!s.repeat && s.repeat !== 'once';
  return (
    <tr className="click" data-service={s.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) go(`/catalog/${s.id}`); }}>
      <td className="t1 catalog-c-name">
        <A to={`/catalog/${s.id}`} className="catalog-name">{serviceName(s, lang)}</A>{!s.active && <> <Badge>{t('catalog.retired')}</Badge></>}
        {(about || s.code) && <div className="xs dim catalog-about">{[s.code, about].filter(Boolean).join(' · ')}</div>}
      </td>
      <td data-label={t('catalog.tiers')} className="catalog-c-tiers">
        <span className="catalog-prices">
          {s.tiers.slice(0, TIERS_SHOWN).map((x) => <span key={x.id} className="catalog-price"><span className="muted">{s.tiers.length > 1 ? x.name : ''}</span> <b>{tierPrice(t, x)}</b></span>)}
          {s.tiers.length > TIERS_SHOWN && <span className="xs muted">{t('catalog.moreTiers', { n: s.tiers.length - TIERS_SHOWN })}</span>}
        </span>
      </td>
      <td data-label={t('catalog.col.starts')} className="catalog-c-starts">
        <span className="catalog-marks">
          {repeats && <span className="catalog-mark rep"><LuRepeat aria-hidden="true" />{t('jobs.rp.' + s.repeat)}</span>}
          {pb && <span className="catalog-mark" title={t('catalog.f.playbook')}><LuListChecks aria-hidden="true" />{pb.name}</span>}
          {!!s.docKinds?.length && <span className="catalog-mark" title={s.docKinds.map((k) => t('doc.kind.' + k)).join(', ')}><LuFileText aria-hidden="true" />{t(s.docKinds.length === 1 ? 'catalog.docs1' : 'catalog.docsN', { n: s.docKinds.length })}</span>}
          {appt && <span className="catalog-mark" title={t('catalog.f.appt')}><LuCalendarClock aria-hidden="true" />{appt.name[lang] ?? appt.name.en}</span>}
          {!repeats && !pb && !s.docKinds?.length && !appt && <span className="dim small">{t('catalog.nothingStarts')}</span>}
        </span>
      </td>
    </tr>
  );
}
