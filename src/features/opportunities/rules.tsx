// The cross-sell rules: when a client has one of these services, suggest that one, unless they already have it.
// A rule is read out as a sentence, with the number of clients it applies to today, so a rule that can never fire is seen at once.
import { useId, useState } from 'react';
import { LuPencil, LuPlus, LuTrash2, LuTriangleAlert, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, confirmDialog, cx, toast } from '@/ui';
import { deleteCrossSellRule, saveCrossSellRule, setCrossSellRuleActive } from '@/domain/actions';
import { serviceName, serviceOf } from '@/domain/actions/catalog';
import { clientsMatching } from '@/domain/actions/opportunities';
import type { CatalogService, CrossSellRule } from '@/domain/types';
import { categoriesOf, categoryLabel } from '@/features/catalog/parts';

export function Rules({ canEdit }: { canEdit: boolean }) {
  const { t, data, lang } = useApp();
  const [form, setForm] = useState<CrossSellRule | 'new' | null>(null);
  const rules = data.crossSell ?? [];
  const name = (id: string) => { const s = serviceOf(data, id); return s ? serviceName(s, lang) : t('catalog.gone'); };
  const names = (ids: string[]) => ids.map(name).join(t('opportunities.rule.or'));
  const remove = async (r: CrossSellRule) => { if (await confirmDialog(t('opportunities.rule.deleteConfirm', { name: r.name }), t('common.delete'), t('common.cancel'))) { act(deleteCrossSellRule, r.id); toast(t('common.deleted')); } };
  const add = canEdit ? <Button variant={rules.length ? 'primary' : 'default'} icon={<LuPlus aria-hidden="true" />} onClick={() => setForm('new')} data-testid="opp-rule-new">{t('opportunities.rule.new')}</Button> : null;
  const hasCatalog = (data.catalog ?? []).some((s) => s.active);

  return (
    <>
      <div className="opportunities-bar">
        <p className="small muted opportunities-lead">{t('opportunities.rule.about')}</p>
        <div className="row tight opportunities-top">{hasCatalog && add}</div>
      </div>
      {!rules.length ? (
        <Card className="work-none"><Empty title={t('opportunities.rule.empty')} action={hasCatalog ? add ?? undefined : <A to="/catalog" className="btn">{t('nav.catalog')}</A>}>{t(hasCatalog ? 'opportunities.rule.emptyHint' : 'opportunities.rule.needCatalog')}</Empty></Card>
      ) : (
        <div className="stack opportunities-rules" data-testid="opp-rules">
          {rules.map((r) => {
            const suggest = serviceOf(data, r.suggestServiceId);
            const broken = !suggest ? 'gone' : !suggest.active ? 'retired' : null;
            const match = clientsMatching(data, r).length;
            const made = (data.opportunities ?? []).filter((o) => o.ruleId === r.id).length;
            return (
              <Card key={r.id} className={cx('opportunities-rule', !r.active && 'off')}>
                <div className="opportunities-rule-h">
                  <h2>{r.name}</h2>
                  <span className="row tight">
                    {canEdit
                      ? <label className="opportunities-switch"><input type="checkbox" checked={r.active} onChange={(e) => act(setCrossSellRuleActive, r.id, e.target.checked)} data-testid="opp-rule-active" /><span>{t(r.active ? 'opportunities.rule.on' : 'opportunities.rule.off')}</span></label>
                      : <Badge tone={r.active ? 'ok' : 'neutral'}>{t(r.active ? 'opportunities.rule.on' : 'opportunities.rule.off')}</Badge>}
                    {canEdit && <IconButton size="sm" label={`${t('common.edit')}: ${r.name}`} onClick={() => setForm(r)} data-testid="opp-rule-edit"><LuPencil /></IconButton>}
                    {canEdit && <IconButton size="sm" label={`${t('common.delete')}: ${r.name}`} onClick={() => remove(r)} data-testid="opp-rule-delete"><LuTrash2 /></IconButton>}
                  </span>
                </div>
                <p className="opportunities-sentence">
                  {r.whenServiceIds.length ? t('opportunities.rule.when', { kind: t('opportunities.rule.kind.' + (r.clientKind ?? 'any')), services: names(r.whenServiceIds) }) : t('opportunities.rule.whenAny', { kind: t('opportunities.rule.kind.' + (r.clientKind ?? 'any')) })}
                  {' '}<b>{t('opportunities.rule.suggest', { service: name(r.suggestServiceId) })}</b>
                  {r.unlessServiceIds?.length ? ' ' + t('opportunities.rule.unless', { services: names(r.unlessServiceIds) }) : ''}
                  {r.delayDays ? ' ' + t('opportunities.rule.delay', { n: r.delayDays }) : ''}
                </p>
                {r.note && <p className="small opportunities-note"><span className="muted">{t('opportunities.rule.note')}: </span>{r.note}</p>}
                {broken
                  ? <p className="small opportunities-broken" role="status"><LuTriangleAlert aria-hidden="true" />{t('opportunities.rule.broken.' + broken)}</p>
                  : <p className="xs muted opportunities-match" data-testid="opp-rule-match">{t('opportunities.rule.match', { n: match })} · {t('opportunities.rule.made', { n: made })}</p>}
              </Card>
            );
          })}
        </div>
      )}
      {form && <RuleForm rule={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}

/** Pick several services: the ones chosen are shown as chips, and a list adds another. Stays usable with a long catalog. */
function ServicePicker({ label, value, onChange, services, exclude, hint, testId }: { label: string; value: string[]; onChange: (ids: string[]) => void; services: CatalogService[]; exclude: string[]; hint?: string; testId: string }) {
  const { t, pack, lang } = useApp();
  const uid = useId();
  const free = services.filter((s) => !value.includes(s.id) && !exclude.includes(s.id));
  return (
    <Field label={label} htmlFor={uid} hint={hint} full>
      {value.length > 0 && (
        <div className="row tight opportunities-chips">
          {value.map((id) => { const s = services.find((x) => x.id === id); const n = s ? serviceName(s, lang) : t('catalog.gone'); return <span key={id} className="opportunities-chip">{n}<button type="button" aria-label={`${t('opportunities.rule.remove')}: ${n}`} onClick={() => onChange(value.filter((x) => x !== id))}><LuX aria-hidden="true" /></button></span>; })}
        </div>
      )}
      <select id={uid} value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }} data-testid={testId}>
        <option value="">{t(value.length ? 'opportunities.rule.addAnother' : 'opportunities.rule.addService')}</option>
        {categoriesOf(pack, free).map((g) => <optgroup key={g} label={categoryLabel(t, pack, g)}>{free.filter((s) => s.category === g).map((s) => <option key={s.id} value={s.id}>{serviceName(s, lang)}</option>)}</optgroup>)}
      </select>
    </Field>
  );
}

function RuleForm({ rule, onClose }: { rule?: CrossSellRule; onClose: () => void }) {
  const { t, data, pack, lang } = useApp();
  const uid = useId(); const id = (k: string) => uid + k;
  const all = data.catalog ?? [];
  const sellable = all.filter((s) => s.active || s.id === rule?.suggestServiceId);
  const [v, setV] = useState(() => ({
    name: rule?.name ?? '', when: rule?.whenServiceIds ?? [], suggest: rule?.suggestServiceId ?? '', unless: rule?.unlessServiceIds ?? [],
    kind: (rule?.clientKind ?? '') as '' | 'individual' | 'business', delay: rule?.delayDays ? String(rule.delayDays) : '', note: rule?.note ?? '', active: rule?.active ?? true,
  }));
  const [err, setErr] = useState<string[]>([]);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = [...(!v.name.trim() ? ['name'] : []), ...(!v.suggest ? ['suggest'] : [])];
    if (bad.length) { setErr(bad); return; }
    const saved = act(saveCrossSellRule, { name: v.name, whenServiceIds: v.when, suggestServiceId: v.suggest, unlessServiceIds: v.unless, clientKind: v.kind || undefined, delayDays: Number(v.delay) || undefined, note: v.note, active: v.active }, rule?.id);
    if (!saved) { setErr(['suggest']); return; }
    toast(t('opportunities.rule.saved')); onClose();
  };
  return (
    <Modal title={rule ? t('opportunities.rule.edit') : t('opportunities.rule.new')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form={id('form')} data-testid="opp-rule-save">{t('common.save')}</Button></>}>
      <form id={id('form')} onSubmit={submit} noValidate>
        <div className="fgrid">
          <Field label={<>{t('common.name')}<span aria-hidden="true"> *</span></>} htmlFor={id('name')} error={err.includes('name')} full>
            <input id={id('name')} value={v.name} onChange={(e) => set('name', e.target.value)} aria-required="true" data-testid="opp-rule-name" />
          </Field>
          <ServicePicker label={t('opportunities.rule.f.when')} hint={t('opportunities.rule.f.whenHint')} value={v.when} onChange={(x) => set('when', x)} services={all} exclude={[v.suggest, ...v.unless]} testId="opp-rule-when" />
          <Field label={<>{t('opportunities.rule.f.suggest')}<span aria-hidden="true"> *</span></>} htmlFor={id('suggest')} error={err.includes('suggest')} full>
            <select id={id('suggest')} value={v.suggest} onChange={(e) => setV((s) => ({ ...s, suggest: e.target.value, when: s.when.filter((x) => x !== e.target.value), unless: s.unless.filter((x) => x !== e.target.value) }))} aria-required="true" data-testid="opp-rule-suggest">
              <option value="">{t('opportunities.rule.pick')}</option>
              {categoriesOf(pack, sellable).map((g) => <optgroup key={g} label={categoryLabel(t, pack, g)}>{sellable.filter((s) => s.category === g).map((s) => <option key={s.id} value={s.id}>{serviceName(s, lang)}{s.active ? '' : ` (${t('catalog.retired').toLowerCase()})`}</option>)}</optgroup>)}
            </select>
          </Field>
          <ServicePicker label={`${t('opportunities.rule.f.unless')} (${t('common.optional')})`} hint={t('opportunities.rule.f.unlessHint')} value={v.unless} onChange={(x) => set('unless', x)} services={all} exclude={[v.suggest, ...v.when]} testId="opp-rule-unless" />
          <Field label={t('opportunities.rule.f.kind')} htmlFor={id('kind')}>
            <select id={id('kind')} value={v.kind} onChange={(e) => set('kind', e.target.value as typeof v.kind)} data-testid="opp-rule-kind">
              <option value="">{t('opportunities.rule.f.kindAny')}</option><option value="individual">{t('opportunities.rule.f.kindIndividual')}</option><option value="business">{t('opportunities.rule.f.kindBusiness')}</option>
            </select>
          </Field>
          <Field label={`${t('opportunities.rule.f.delay')} (${t('common.optional')})`} htmlFor={id('delay')} hint={t('opportunities.rule.f.delayHint')}>
            <input id={id('delay')} type="number" min={0} step={1} inputMode="numeric" value={v.delay} onChange={(e) => set('delay', e.target.value)} data-testid="opp-rule-delay" />
          </Field>
          <Field label={`${t('opportunities.rule.note')} (${t('common.optional')})`} htmlFor={id('note')} hint={t('opportunities.rule.f.noteHint')} full>
            <textarea id={id('note')} rows={3} value={v.note} onChange={(e) => set('note', e.target.value)} data-testid="opp-rule-note" />
          </Field>
          <label className="check full"><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /><span>{t('opportunities.rule.f.active')}</span></label>
        </div>
        {err.length > 0 && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{t(err.includes('suggest') && !err.includes('name') ? 'opportunities.rule.f.suggestErr' : 'common.required')}</p>}
      </form>
    </Modal>
  );
}
