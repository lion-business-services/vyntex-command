// Forms of the catalog: a service with its price tiers, a playbook with its steps, and bringing a catalog in from a file.
import { useId, useRef, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuDownload, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act, ctx as currentCtx, getSnapshot } from '@/store/store';
import { Button, Field, IconButton, Modal, cx, toast } from '@/ui';
import { DEPLOY } from '@/config/deployment';
import { importCatalog, savePlaybook, saveService } from '@/domain/actions';
import { type ImportPlan, type PlaybookFull, type Service, TIER_UNITS } from '@/domain/actions/catalog';
import { taskTypesOf } from '@/domain/config';
import type { CatalogTier, DocKind, PlaybookStep, Priority, Repeat } from '@/domain/types';
import { downloadCsv, readCsvFile } from '@/features/data/csv';
import { repeatsOf } from '@/features/jobs/parts';
import { parseMoney } from '@/lib/money';
import { IMPORT_COLUMNS, type ParsedCatalog, readCatalogCsv } from './csv';
import { ExternalChips, categoriesOf, categoryLabel, whoLabel } from './parts';

const OTHER = '__other';
/** Documents that are not prepared when a service is sold: a proposal comes before the sale, an invoice when the work is done, and an upload is not prepared by anyone. */
const NOT_AT_SALE: DocKind[] = ['estimate', 'invoice', 'upload', 'custom'];
let seq = 0;
const rowKey = () => 'r' + ++seq;

/* ---------- a service ---------- */
interface TierRow { key: string; id?: string; name: string; price: string; unit: CatalogTier['unit']; note: string; ids?: Record<string, string> }

export function ServiceForm({ service, onClose, onSaved }: { service?: Service; onClose: () => void; onSaved?: (s: Service) => void }) {
  const { t, data, pack, lang } = useApp();
  const uid = useId(); const id = (k: string) => uid + k;
  const showZh = DEPLOY.languages.includes('zh') || !!service?.i18n?.zh;
  const cats = categoriesOf(pack, data.catalog).filter(Boolean);
  const lines = pack.serviceTypes.map((x) => x.id);
  const [v, setV] = useState(() => {
    // a service written before it had names per language shows its name in the language being used
    const en = service?.i18n?.en?.name ?? (service && !service.i18n?.es?.name && lang !== 'es' ? service.name : '');
    const es = service?.i18n?.es?.name ?? (service && !service.i18n?.en?.name && lang === 'es' ? service.name : '');
    const category = service?.category ?? lines[0] ?? '';
    return {
      en, es, zh: service?.i18n?.zh?.name ?? '',
      aboutEn: service?.i18n?.en?.description ?? (lang !== 'es' ? service?.description ?? '' : ''), aboutEs: service?.i18n?.es?.description ?? (lang === 'es' ? service?.description ?? '' : ''), aboutZh: service?.i18n?.zh?.description ?? '',
      category, newCategory: '', repeat: (service?.repeat ?? 'once') as Repeat, playbookId: service?.playbookId ?? '', appointmentTypeId: service?.appointmentTypeId ?? '',
      docKinds: service?.docKinds ?? [], code: service?.code ?? '', internalNote: service?.internalNote ?? '', active: service?.active ?? true,
    };
  });
  const [tiers, setTiers] = useState<TierRow[]>(() => (service?.tiers.length ? service.tiers.map((x) => ({ key: rowKey(), id: x.id, name: x.name, price: String(x.price), unit: x.unit, note: x.note ?? '', ids: x.externalIds }))
    : [{ key: rowKey(), name: t('catalog.tier.standard'), price: '', unit: 'flat', note: '' }]));
  const [err, setErr] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const setTier = (key: string, patch: Partial<TierRow>) => setTiers((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (at: number, by: -1 | 1) => setTiers((list) => { const to = at + by; if (to < 0 || to >= list.length) return list; const next = [...list]; [next[at], next[to]] = [next[to], next[at]]; return next; });
  const linked = (x: TierRow) => !!x.ids && Object.keys(x.ids).length > 0;
  // an edition that has the engagement letter as a document of its own does not offer the plain agreement next to it: it is the same paper
  const kinds = pack.docKinds.filter((k) => v.docKinds.includes(k) || (!NOT_AT_SALE.includes(k) && !(k === 'contract' && pack.docKinds.includes('engagement_letter'))));
  const apptTypes = (data.apptTypes ?? []).filter((a) => a.active || a.id === v.appointmentTypeId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad: string[] = [];
    if (!v.en.trim() && !v.es.trim()) bad.push('name');
    if (v.category === OTHER && !v.newCategory.trim()) bad.push('category');
    const named = tiers.filter((x) => x.name.trim());
    if (!named.length) bad.push('tiers');
    for (const x of named) { const p = x.price.trim() ? parseMoney(x.price) : 0; if (p === null || p < 0) bad.push('price:' + x.key); }
    if (bad.length) { setErr(bad); setMsg(t(bad.some((b) => b.startsWith('price:')) ? 'catalog.f.priceErr' : bad.includes('tiers') ? 'catalog.f.tierErr' : bad.includes('name') ? 'catalog.f.nameErr' : 'common.required')); return; }
    const saved = act(saveService, {
      name: v.en.trim() || v.es.trim(), description: v.aboutEn.trim() || v.aboutEs.trim() || undefined,
      i18n: { en: { name: v.en, description: v.aboutEn }, es: { name: v.es, description: v.aboutEs }, zh: { name: v.zh, description: v.aboutZh } },
      category: v.category === OTHER ? v.newCategory.trim() : v.category, active: v.active, repeat: v.repeat, playbookId: v.playbookId || undefined, appointmentTypeId: v.appointmentTypeId || undefined,
      docKinds: v.docKinds, code: v.code, internalNote: v.internalNote,
      tiers: named.map((x) => ({ id: x.id, name: x.name, price: x.price.trim() ? parseMoney(x.price) ?? 0 : 0, unit: x.unit, note: x.note })),
    }, service?.id);
    if (!saved) { setMsg(t('common.required')); return; }
    toast(t(service ? 'catalog.saved' : 'catalog.created', { name: saved.name }));
    onClose(); onSaved?.(saved);
  };

  return (
    <Modal title={service ? t('catalog.edit') : t('catalog.new')} onClose={onClose} size="wide" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form={id('form')} data-testid="catalog-save">{t('common.save')}</Button></>}>
      <form id={id('form')} onSubmit={submit} noValidate>
        <div className="fgrid">
          <Field label={<>{t('catalog.f.nameEn')}<span aria-hidden="true"> *</span></>} htmlFor={id('en')} error={err.includes('name')}>
            <input id={id('en')} value={v.en} onChange={(e) => set('en', e.target.value)} lang="en" aria-invalid={err.includes('name') || undefined} data-testid="catalog-f-name" />
          </Field>
          <Field label={t('catalog.f.nameEs')} htmlFor={id('es')} error={err.includes('name')}>
            <input id={id('es')} value={v.es} onChange={(e) => set('es', e.target.value)} lang="es" data-testid="catalog-f-name-es" />
          </Field>
          {showZh && <Field label={`${t('catalog.f.nameZh')} (${t('common.optional')})`} htmlFor={id('zh')} full><input id={id('zh')} value={v.zh} onChange={(e) => set('zh', e.target.value)} lang="zh" /></Field>}
          <Field label={t('catalog.f.category')} htmlFor={id('cat')} error={err.includes('category')}>
            <select id={id('cat')} value={v.category} onChange={(e) => set('category', e.target.value)} data-testid="catalog-f-category">
              {[...new Set([...lines, ...cats, ...(v.category && v.category !== OTHER ? [v.category] : [])])].map((c) => <option key={c} value={c}>{categoryLabel(t, pack, c)}</option>)}
              <option value={OTHER}>{t('catalog.f.newCategory')}</option>
            </select>
          </Field>
          {v.category === OTHER
            ? <Field label={t('catalog.f.categoryName')} htmlFor={id('newcat')} error={err.includes('category')}><input id={id('newcat')} value={v.newCategory} onChange={(e) => set('newCategory', e.target.value)} data-testid="catalog-f-newcategory" /></Field>
            : <Field label={`${t('catalog.f.code')} (${t('common.optional')})`} htmlFor={id('code')} hint={t('catalog.f.codeHint')}><input id={id('code')} value={v.code} onChange={(e) => set('code', e.target.value)} data-testid="catalog-f-code" /></Field>}
          {v.category === OTHER && <Field label={`${t('catalog.f.code')} (${t('common.optional')})`} htmlFor={id('code')} hint={t('catalog.f.codeHint')} full><input id={id('code')} value={v.code} onChange={(e) => set('code', e.target.value)} /></Field>}
        </div>

        <fieldset className={cx('catalog-tiers', err.includes('tiers') && 'err')}>
          <legend>{t('catalog.tiers')}</legend>
          <p className="xs muted">{t('catalog.f.tiersHint')}</p>
          <div className="catalog-tierrows" data-testid="catalog-f-tiers">
            {tiers.map((x, i) => (
              <div className="catalog-tierrow" key={x.key}>
                <label className="catalog-tr-name"><span className="xs muted">{t('catalog.f.tierName')}</span>
                  <input value={x.name} onChange={(e) => setTier(x.key, { name: e.target.value })} data-testid="catalog-f-tier-name" /></label>
                <label className="catalog-tr-price"><span className="xs muted">{t('common.price')}</span>
                  <input value={x.price} onChange={(e) => setTier(x.key, { price: e.target.value })} inputMode="decimal" placeholder="0.00" aria-invalid={err.includes('price:' + x.key) || undefined} className={cx(err.includes('price:' + x.key) && 'catalog-bad')} data-testid="catalog-f-tier-price" /></label>
                <label className="catalog-tr-unit"><span className="xs muted">{t('catalog.f.unit')}</span>
                  <select value={x.unit} onChange={(e) => setTier(x.key, { unit: e.target.value as CatalogTier['unit'] })} data-testid="catalog-f-tier-unit">{TIER_UNITS.map((u) => <option key={u} value={u}>{t('catalog.unit.' + u)}</option>)}</select></label>
                <label className="catalog-tr-note"><span className="xs muted">{t('catalog.f.tierNote')}</span>
                  <input value={x.note} onChange={(e) => setTier(x.key, { note: e.target.value })} /></label>
                <span className="catalog-tr-acts">
                  <IconButton size="sm" label={t('catalog.f.up')} disabled={i === 0} onClick={() => move(i, -1)} data-testid="catalog-f-tier-up"><LuArrowUp /></IconButton>
                  <IconButton size="sm" label={t('catalog.f.down')} disabled={i === tiers.length - 1} onClick={() => move(i, 1)} data-testid="catalog-f-tier-down"><LuArrowDown /></IconButton>
                  <IconButton size="sm" label={linked(x) ? t('catalog.f.linkedTier') : t('catalog.f.removeTier')} disabled={tiers.length === 1 || linked(x)} onClick={() => setTiers((list) => list.filter((y) => y.key !== x.key))} data-testid="catalog-f-tier-remove"><LuTrash2 /></IconButton>
                </span>
                {linked(x) && <span className="catalog-tr-ext"><ExternalChips ids={x.ids} /></span>}
              </div>
            ))}
          </div>
          <button type="button" className="linkbtn small" onClick={() => setTiers((list) => [...list, { key: rowKey(), name: '', price: '', unit: list[list.length - 1]?.unit ?? 'flat', note: '' }])} data-testid="catalog-f-tier-add"><LuPlus aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {t('catalog.f.addTier')}</button>
        </fieldset>

        <div className="fgrid">
          <Field label={t('catalog.f.repeat')} htmlFor={id('repeat')}>
            <select id={id('repeat')} value={v.repeat} onChange={(e) => set('repeat', e.target.value as Repeat)} data-testid="catalog-f-repeat">{[...new Set([...repeatsOf(pack), v.repeat])].map((r) => <option key={r} value={r}>{t('jobs.rp.' + r)}</option>)}</select>
          </Field>
          <Field label={t('catalog.f.playbook')} htmlFor={id('pb')} hint={t('catalog.f.playbookHint')}>
            <select id={id('pb')} value={v.playbookId} onChange={(e) => set('playbookId', e.target.value)} data-testid="catalog-f-playbook">
              <option value="">{t('catalog.none')}</option>{(data.playbooks ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ` (${t('catalog.pb.off')})`}</option>)}
            </select>
          </Field>
          {apptTypes.length > 0 && (
            <Field label={t('catalog.f.appt')} htmlFor={id('appt')} hint={t('catalog.f.apptHint')} full={!kinds.length}>
              <select id={id('appt')} value={v.appointmentTypeId} onChange={(e) => set('appointmentTypeId', e.target.value)} data-testid="catalog-f-appt">
                <option value="">{t('catalog.none')}</option>{apptTypes.map((a) => <option key={a.id} value={a.id}>{a.name[lang] ?? a.name.en}</option>)}
              </select>
            </Field>
          )}
          {kinds.length > 0 && (
            <div className={cx('field', !apptTypes.length && 'full')}>
              <span className="label" id={id('docs')}>{t('catalog.f.docs')}</span>
              <div className="catalog-checks" role="group" aria-labelledby={id('docs')}>
                {kinds.map((k) => <label key={k} className="check"><input type="checkbox" checked={v.docKinds.includes(k)} onChange={(e) => set('docKinds', e.target.checked ? [...v.docKinds, k] : v.docKinds.filter((x) => x !== k))} /><span>{t('doc.kind.' + k)}</span></label>)}
              </div>
            </div>
          )}
          <Field label={t('catalog.f.aboutEn')} htmlFor={id('aen')}><textarea id={id('aen')} rows={3} value={v.aboutEn} onChange={(e) => set('aboutEn', e.target.value)} lang="en" /></Field>
          <Field label={t('catalog.f.aboutEs')} htmlFor={id('aes')}><textarea id={id('aes')} rows={3} value={v.aboutEs} onChange={(e) => set('aboutEs', e.target.value)} lang="es" /></Field>
          {showZh && <Field label={`${t('catalog.f.aboutZh')} (${t('common.optional')})`} htmlFor={id('azh')} full><textarea id={id('azh')} rows={2} value={v.aboutZh} onChange={(e) => set('aboutZh', e.target.value)} lang="zh" /></Field>}
          <Field label={t('catalog.f.internal')} htmlFor={id('note')} hint={t('catalog.f.internalHint')} full><textarea id={id('note')} rows={2} value={v.internalNote} onChange={(e) => set('internalNote', e.target.value)} /></Field>
          <label className="check full"><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} data-testid="catalog-f-active" /><span>{t('catalog.f.active')}</span></label>
        </div>
        {msg && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{msg}</p>}
      </form>
    </Modal>
  );
}

/* ---------- a playbook ---------- */
interface StepRow { key: string; id?: string; en: string; es: string; zh?: string; dueIn: string; who: PlaybookStep['for']; type: string; pri: Priority }
const WHO: PlaybookStep['for'][] = ['assignee', 'manager', 'owner'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

export function PlaybookForm({ playbook, onClose }: { playbook?: PlaybookFull; onClose: () => void }) {
  const { t, data, pack } = useApp();
  const uid = useId(); const id = (k: string) => uid + k;
  const types = taskTypesOf(data, pack);
  const [name, setName] = useState(playbook?.name ?? '');
  const [on, setOn] = useState(playbook?.active ?? true);
  const [welcomeEn, setWelcomeEn] = useState(playbook?.welcomeI18n?.en ?? playbook?.welcome ?? '');
  const [welcomeEs, setWelcomeEs] = useState(playbook?.welcomeI18n?.es ?? '');
  const [steps, setSteps] = useState<StepRow[]>(() => (playbook?.steps.length ? playbook.steps.map((s) => ({ key: rowKey(), id: s.id, en: s.title.en, es: s.title.es, zh: s.title.zh, dueIn: String(s.dueIn), who: s.for, type: s.type ?? '', pri: s.pri ?? 'medium' }))
    : [{ key: rowKey(), en: '', es: '', dueIn: '0', who: 'assignee', type: '', pri: 'medium' }]));
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const setStep = (key: string, patch: Partial<StepRow>) => setSteps((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (at: number, by: -1 | 1) => setSteps((list) => { const to = at + by; if (to < 0 || to >= list.length) return list; const next = [...list]; [next[at], next[to]] = [next[to], next[at]]; return next; });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const filled = steps.filter((s) => s.en.trim() || s.es.trim());
    if (!name.trim()) { setBad(true); setMsg(t('common.required')); return; }
    if (!filled.length) { setMsg(t('catalog.pb.stepErr')); return; }
    const saved = act(savePlaybook, {
      name, active: on, welcome: welcomeEn.trim() || welcomeEs.trim() || undefined, welcomeI18n: { en: welcomeEn, es: welcomeEs },
      steps: filled.map((s) => ({ id: s.id, title: { en: s.en, es: s.es, ...(s.zh ? { zh: s.zh } : {}) }, dueIn: Number(s.dueIn) || 0, for: s.who, type: s.type || undefined, pri: s.pri })),
    }, playbook?.id);
    if (!saved) { setMsg(t('common.required')); return; }
    toast(t('catalog.pb.saved', { name: saved.name })); onClose();
  };
  return (
    <Modal title={playbook ? t('catalog.pb.edit') : t('catalog.pb.new')} onClose={onClose} size="wide" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form={id('form')} data-testid="catalog-pb-save">{t('common.save')}</Button></>}>
      <form id={id('form')} onSubmit={submit} noValidate>
        <div className="fgrid">
          <Field label={<>{t('common.name')}<span aria-hidden="true"> *</span></>} htmlFor={id('name')} error={bad && !name.trim()} full>
            <input id={id('name')} value={name} onChange={(e) => setName(e.target.value)} aria-required="true" data-testid="catalog-pb-name" />
          </Field>
        </div>
        <fieldset className="catalog-tiers">
          <legend>{t('catalog.pb.steps')}</legend>
          <p className="xs muted">{t('catalog.pb.stepsHint')}</p>
          <ol className="catalog-steprows" data-testid="catalog-pb-steps">
            {steps.map((s, i) => (
              <li className="catalog-steprow" key={s.key}>
                <label className="catalog-st-en"><span className="xs muted">{t('catalog.pb.titleEn')}</span><input value={s.en} onChange={(e) => setStep(s.key, { en: e.target.value })} lang="en" data-testid="catalog-pb-step-en" /></label>
                <label className="catalog-st-es"><span className="xs muted">{t('catalog.pb.titleEs')}</span><input value={s.es} onChange={(e) => setStep(s.key, { es: e.target.value })} lang="es" data-testid="catalog-pb-step-es" /></label>
                <label className="catalog-st-due"><span className="xs muted">{t('catalog.pb.dueIn')}</span><input type="number" min={0} step={1} inputMode="numeric" value={s.dueIn} onChange={(e) => setStep(s.key, { dueIn: e.target.value })} data-testid="catalog-pb-step-due" /></label>
                <label className="catalog-st-who"><span className="xs muted">{t('catalog.pb.for')}</span>
                  <select value={s.who} onChange={(e) => setStep(s.key, { who: e.target.value as PlaybookStep['for'] })}>{WHO.map((w) => <option key={w} value={w}>{whoLabel(t, w)}</option>)}</select></label>
                <label className="catalog-st-type"><span className="xs muted">{t('catalog.pb.type')}</span>
                  <select value={s.type} onChange={(e) => setStep(s.key, { type: e.target.value })}><option value="">{t('catalog.pb.anyType')}</option>{types.map((x) => <option key={x.id} value={x.id}>{t('tt_' + x.id)}</option>)}</select></label>
                <label className="catalog-st-pri"><span className="xs muted">{t('common.priority')}</span>
                  <select value={s.pri} onChange={(e) => setStep(s.key, { pri: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{t('pr.' + p)}</option>)}</select></label>
                <span className="catalog-tr-acts">
                  <IconButton size="sm" label={t('catalog.f.up')} disabled={i === 0} onClick={() => move(i, -1)}><LuArrowUp /></IconButton>
                  <IconButton size="sm" label={t('catalog.f.down')} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><LuArrowDown /></IconButton>
                  <IconButton size="sm" label={t('catalog.pb.removeStep')} disabled={steps.length === 1} onClick={() => setSteps((list) => list.filter((y) => y.key !== s.key))}><LuTrash2 /></IconButton>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="linkbtn small" onClick={() => setSteps((list) => [...list, { key: rowKey(), en: '', es: '', dueIn: list[list.length - 1]?.dueIn ?? '0', who: 'assignee', type: '', pri: 'medium' }])} data-testid="catalog-pb-step-add"><LuPlus aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {t('catalog.pb.addStep')}</button>
        </fieldset>
        <div className="fgrid">
          <Field label={`${t('catalog.pb.welcomeEn')} (${t('common.optional')})`} htmlFor={id('wen')}><textarea id={id('wen')} rows={5} value={welcomeEn} onChange={(e) => setWelcomeEn(e.target.value)} lang="en" data-testid="catalog-pb-welcome" /></Field>
          <Field label={`${t('catalog.pb.welcomeEs')} (${t('common.optional')})`} htmlFor={id('wes')}><textarea id={id('wes')} rows={5} value={welcomeEs} onChange={(e) => setWelcomeEs(e.target.value)} lang="es" /></Field>
          <p className="xs muted full">{t('catalog.pb.welcomeHint')}</p>
          <label className="check full"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /><span>{t('catalog.pb.active')}</span></label>
        </div>
        {msg && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{msg}</p>}
      </form>
    </Modal>
  );
}

/* ---------- bringing a catalog in from a file ---------- */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t, pack } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedCatalog | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const read = async (f: File | undefined) => {
    setMsg(''); setParsed(null); setPlan(null);
    if (!f) return;
    setName(f.name);
    if (f.size > 2_000_000) { setMsg(t('catalog.imp.tooBig')); return; }
    let text = '';
    try { text = await readCsvFile(f); } catch { setMsg(t('catalog.imp.unreadable')); return; }
    const p = readCatalogCsv(text, pack);
    if (p.missing.length || !p.rows.length) { setMsg(t(p.missing.length ? 'catalog.imp.noColumn' : 'catalog.imp.empty')); return; }
    setParsed(p);
    // a look at what would happen: nothing is changed until the person confirms
    setPlan(importCatalog(getSnapshot().data, currentCtx(), p.rows, false));
  };
  const apply = () => {
    if (!parsed) return;
    const done = act(importCatalog, parsed.rows, true);
    toast(t('catalog.imp.done', { services: done.newServices, tiers: done.newTiers + done.changedTiers })); onClose();
  };
  const changes = plan ? plan.newServices + plan.newTiers + plan.changedTiers : 0;
  return (
    <Modal title={t('catalog.imp.title')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!plan || !changes} onClick={apply} data-testid="catalog-import-apply">{t('catalog.imp.apply')}</Button></>}>
      <div className="stack">
        <p className="small muted">{t('catalog.imp.how')}</p>
        <div className="row">
          <label className="team-file catalog-file"><span className="sr">{t('catalog.imp.pick')}</span>
            <input ref={file} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => read(e.target.files?.[0])} data-testid="catalog-import-file" /></label>
          <button type="button" className="linkbtn small" onClick={() => downloadCsv('catalog-template.csv', [[...IMPORT_COLUMNS]])} data-testid="catalog-import-template"><LuDownload aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {t('catalog.imp.template')}</button>
        </div>
        {msg && <p className="small neg" role="alert">{msg}</p>}
        {plan && parsed && (
          <div className="catalog-plan" data-testid="catalog-import-plan">
            <b>{t('catalog.imp.plan', { file: name, n: parsed.rows.length })}</b>
            <dl className="kv">
              <dt>{t('catalog.imp.newServices')}</dt><dd>{plan.newServices}</dd>
              <dt>{t('catalog.imp.newTiers')}</dt><dd>{plan.newTiers}</dd>
              <dt>{t('catalog.imp.changed')}</dt><dd>{plan.changedTiers}</dd>
              <dt>{t('catalog.imp.same')}</dt><dd>{plan.unchanged}</dd>
              {plan.skipped.length > 0 && <><dt>{t('catalog.imp.skipped')}</dt><dd className="neg">{plan.skipped.length}</dd></>}
            </dl>
            {plan.skipped.length > 0 && <p className="xs muted">{plan.skipped.slice(0, 8).map((s) => t('catalog.imp.line', { line: s.line, why: t('catalog.imp.why.' + s.reason) })).join(' ')}{plan.skipped.length > 8 ? ' ' + t('catalog.imp.more', { n: plan.skipped.length - 8 }) : ''}</p>}
            {parsed.unknown.length > 0 && <p className="xs muted">{t('catalog.imp.ignored', { cols: parsed.unknown.join(', ') })}</p>}
            {!changes && <p className="small">{t('catalog.imp.nothing')}</p>}
            <p className="xs muted">{t('catalog.imp.safe')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
