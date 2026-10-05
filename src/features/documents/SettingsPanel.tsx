// Settings section: document templates and the wording a signer agrees to.
// The product ships no legal or tax wording. A starter is a structure with bracketed placeholders; the company writes or
// pastes its own approved text, and someone with the right to configure the company marks the template approved. Until
// then a document made from it says so and cannot be sent for signature. Registered in src/features/settings/panels.ts.
import { useMemo, useRef, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuBadgeCheck, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { Badge, Button, Card, Field, Modal, Note, confirmDialog, toast } from '@/ui';
import { approveConsent, approveTemplate, deleteTemplate, saveEsignSettings, saveTemplate, setTemplateActive } from '@/domain/actions';
import { consentOf, esignSettings } from '@/domain/actions/esign';
import { actorName } from '@/domain/selectors';
import { pick } from '@/i18n';
import type { DocKind, DocTemplate, Lang } from '@/domain/types';
import { MERGE_FIELDS, hasPlaceholder } from '@/domain/esign/merge';
import { TEMPLATE_KINDS, canApprove, fromStarter, isConsentTemplate, signRoles, starterTemplates, templateIssues } from '@/domain/esign/templates';
import { SIGNER_ROLES, type SignerRole } from '@/domain/esign/types';
import { DEFAULT_EXPIRY_DAYS, DEFAULT_REMIND_EVERY } from '@/domain/esign/envelope';
import { roleLabel } from '@/domain/esign/certificate';
import { uid } from '@/lib/id';
import './documents.css';

type Block = DocTemplate['blocks'][number];
const BLOCK_TYPES: Block['type'][] = ['h', 'p', 'list', 'sign'];
const TPL_LANGS: Lang[] = ['en', 'es'];
const GROUPS = ['client', 'service', 'firm', 'dates'] as const;

function Approval({ tpl }: { tpl: Pick<DocTemplate, 'approved' | 'approvedBy' | 'approvedAt'> }) {
  const { t, data, dateTime } = useApp();
  return tpl.approved
    ? <Badge tone="ok" title={tpl.approvedAt ? t('docs.tpl.approvedBy', { name: actorName(data, tpl.approvedBy ?? '') ?? '', at: dateTime(tpl.approvedAt) }) : undefined}><LuBadgeCheck aria-hidden="true" />{t('docs.tpl.approved')}</Badge>
    : <Badge tone="warn" outline>{t('docs.tpl.notApproved')}</Badge>;
}

export default function DocumentsSettingsPanel() {
  const { t, data, pack, lang, can, dateTime } = useApp();
  const [editing, setEditing] = useState<DocTemplate | 'new' | null>(null);
  const mayEdit = can('config') && can('write');
  const kinds = useMemo(() => TEMPLATE_KINDS.filter((k) => pack.docKinds.includes(k)), [pack]);
  // the company's templates, then the starters it has not touched yet
  const all = useMemo(() => {
    const own = data.templates.filter((x) => kinds.includes(x.kind) && !isConsentTemplate(x));
    return [...own, ...starterTemplates(kinds).filter((s) => !own.some((x) => fromStarter(x, s.id)))];
  }, [data.templates, kinds]);
  const inList = (tpl: DocTemplate) => data.templates.some((x) => x.id === tpl.id);
  const used = (tpl: DocTemplate) => data.docs.filter((d) => d.templateId === tpl.id).length;

  const approve = (tpl: DocTemplate, on: boolean) => {
    const r = act(approveTemplate, tpl.id, on);
    toast(r.ok ? t(on ? 'docs.tpl.approvedDone' : 'docs.tpl.unapprovedDone') : t('docs.tpl.err.' + (r.reason ?? 'not_allowed')), !r.ok);
  };
  const remove = async (tpl: DocTemplate) => {
    if (!(await confirmDialog(t(used(tpl) ? 'docs.tpl.offConfirm' : 'docs.tpl.deleteConfirm'), t(used(tpl) ? 'docs.tpl.switchOff' : 'common.delete'), t('common.cancel')))) return;
    const r = act(deleteTemplate, tpl.id);
    toast(t(r === 'deleted' ? 'docs.tpl.deleted' : r === 'switched_off' ? 'docs.tpl.switchedOff' : 'docs.tpl.err.not_allowed'), r === 'refused');
  };

  return (
    <div className="stack" data-testid="docs-settings">
      <Note>{t('docs.tpl.rule')}</Note>
      <Card title={t('docs.tpl.title')} actions={mayEdit ? <Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setEditing('new')} data-testid="docs-tpl-new">{t('docs.tpl.new')}</Button> : undefined}>
        <p className="small muted">{t('docs.tpl.intro')}</p>
        {kinds.map((k) => {
          const list = all.filter((x) => x.kind === k);
          if (!list.length) return null;
          return (
            <section key={k} className="docs-tplgroup">
              <h3>{t('doc.kind.' + k)}</h3>
              <ul className="docs-tpls" data-testid={`docs-tpls-${k}`}>
                {list.map((tpl) => {
                  const issues = templateIssues(tpl);
                  return (
                    <li key={tpl.id} data-tpl={tpl.id} data-approved={tpl.approved ? 'yes' : 'no'} className={tpl.active ? undefined : 'off'}>
                      <div className="grow">
                        <div className="row tight"><b>{tpl.name}</b><Badge outline>{t('docs.lang.' + (tpl.lang === 'es' ? 'es' : 'en'))}</Badge><Badge tone={tpl.source === 'starter' ? 'neutral' : 'info'} outline>{t('docs.tpl.source.' + tpl.source)}</Badge><Approval tpl={tpl} />{!tpl.active && <Badge outline>{t('docs.tpl.off')}</Badge>}</div>
                        <div className="xs dim">
                          {tpl.approved && tpl.approvedAt ? t('docs.tpl.approvedBy', { name: actorName(data, tpl.approvedBy ?? '') ?? '', at: dateTime(tpl.approvedAt) })
                            : issues.placeholders ? t('docs.tpl.placeholders', { n: issues.placeholders }) : t('docs.tpl.readyToApprove')}
                          {used(tpl) > 0 && <> · {t('docs.tpl.used', { n: used(tpl) })}</>}
                        </div>
                      </div>
                      {mayEdit && <div className="row tight">
                        <Button size="sm" icon={<LuPencil aria-hidden="true" />} onClick={() => setEditing(tpl)} data-testid="docs-tpl-edit">{t('common.edit')}</Button>
                        {inList(tpl) && (tpl.approved
                          ? <Button size="sm" variant="ghost" onClick={() => approve(tpl, false)} data-testid="docs-tpl-unapprove">{t('docs.tpl.unapprove')}</Button>
                          : <Button size="sm" disabled={!canApprove(tpl)} title={canApprove(tpl) ? undefined : t('docs.tpl.err.placeholders')} onClick={() => approve(tpl, true)} data-testid="docs-tpl-approve">{t('docs.tpl.approve')}</Button>)}
                        {inList(tpl) && <Button size="sm" variant="ghost" onClick={() => act(setTemplateActive, tpl.id, !tpl.active)}>{t(tpl.active ? 'docs.tpl.switchOff' : 'docs.tpl.switchOn')}</Button>}
                        {inList(tpl) && <button type="button" className="iconbtn sm" aria-label={`${t('common.delete')}: ${tpl.name}`} title={t('common.delete')} onClick={() => void remove(tpl)}><LuTrash2 aria-hidden="true" /></button>}
                      </div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!mayEdit && <p className="small muted">{t('docs.tpl.readOnly')}</p>}
      </Card>

      <ConsentCard mayEdit={mayEdit} />
      <Card title={t('docs.tpl.fields')}>
        <p className="small muted">{t('docs.tpl.fieldsHint')}</p>
        <div className="docs-fieldlist">
          {GROUPS.map((g) => <div key={g}><h4>{t('docs.tpl.group.' + g)}</h4><ul>{MERGE_FIELDS.filter((f) => f.group === g).map((f) => <li key={f.id}><code>{`{{${f.id}}}`}</code><span>{pick(f.label, lang)}</span></li>)}</ul></div>)}
        </div>
      </Card>
      {editing && <TemplateEditor tpl={editing === 'new' ? null : editing} kinds={kinds} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The sentence a signer agrees to, and the usual expiry and reminder of a request. */
function ConsentCard({ mayEdit }: { mayEdit: boolean }) {
  const { t, data, dateTime } = useApp();
  const s = esignSettings(data);
  const [en, setEn] = useState(s.consent?.en ?? ''); const [es, setEs] = useState(s.consent?.es ?? '');
  const [expiry, setExpiry] = useState(String(s.expiryDays ?? DEFAULT_EXPIRY_DAYS)); const [every, setEvery] = useState(String(s.remindEvery ?? DEFAULT_REMIND_EVERY));
  const dirty = en.trim() !== (s.consent?.en ?? '') || es.trim() !== (s.consent?.es ?? '') || Number(expiry) !== (s.expiryDays ?? DEFAULT_EXPIRY_DAYS) || Number(every) !== (s.remindEvery ?? DEFAULT_REMIND_EVERY);
  const ok = consentOf(data, 'en').approved;
  const save = () => { if (act(saveEsignSettings, { consent: { en, es }, expiryDays: Number(expiry), remindEvery: Number(every) })) toast(t('docs.consent.saved')); };
  const approve = (on: boolean) => { const r = act(approveConsent, on); toast(r.ok ? t(on ? 'docs.consent.approvedDone' : 'docs.tpl.unapprovedDone') : t('docs.consent.err.' + (r.reason ?? 'not_allowed')), !r.ok); };
  const blank = !(s.consent?.en ?? '').trim() || hasPlaceholder(s.consent?.en ?? '') || hasPlaceholder(s.consent?.es ?? '');
  return (
    <Card title={t('docs.consent.title')} actions={<Approval tpl={{ approved: ok, approvedBy: s.approvedBy, approvedAt: s.approvedAt }} />}>
      <p className="small muted">{t('docs.consent.intro')}</p>
      <div className="fgrid docs-consent" data-testid="docs-consent">
        <Field label={t('docs.consent.en')} full><textarea rows={2} value={en} disabled={!mayEdit} placeholder={t('docs.consent.placeholder')} onChange={(e) => setEn(e.target.value)} data-testid="docs-consent-en" /></Field>
        <Field label={t('docs.consent.es')} full hint={t('docs.consent.esHint')}><textarea rows={2} value={es} disabled={!mayEdit} placeholder={t('docs.consent.placeholder')} onChange={(e) => setEs(e.target.value)} data-testid="docs-consent-es" /></Field>
        <Field label={t('docs.consent.expiry')}><input type="number" min={1} max={120} value={expiry} disabled={!mayEdit} onChange={(e) => setExpiry(e.target.value)} data-testid="docs-consent-expiry" /></Field>
        <Field label={t('docs.consent.remind')} hint={t('esign.prep.remindHint')}><input type="number" min={0} max={30} value={every} disabled={!mayEdit} onChange={(e) => setEvery(e.target.value)} data-testid="docs-consent-remind" /></Field>
      </div>
      {ok && s.approvedAt && <p className="xs dim" style={{ marginTop: 8 }}>{t('docs.tpl.approvedBy', { name: actorName(data, s.approvedBy ?? '') ?? '', at: dateTime(s.approvedAt) })}</p>}
      {!ok && <p className="small" style={{ marginTop: 8 }}>{t('docs.consent.blocked')}</p>}
      {mayEdit && <div className="row" style={{ marginTop: 12 }}>
        <Button variant={dirty ? 'primary' : 'default'} disabled={!dirty} onClick={save} data-testid="docs-consent-save">{t('common.save')}</Button>
        {ok ? <Button variant="ghost" onClick={() => approve(false)}>{t('docs.tpl.unapprove')}</Button>
          : <Button disabled={dirty || blank} title={blank ? t('docs.consent.err.placeholders') : undefined} onClick={() => approve(true)} data-testid="docs-consent-approve">{t('docs.tpl.approve')}</Button>}
      </div>}
    </Card>
  );
}

function TemplateEditor({ tpl, kinds, onClose }: { tpl: DocTemplate | null; kinds: DocKind[]; onClose: () => void }) {
  const { t, lang } = useApp();
  const [name, setName] = useState(tpl?.name ?? '');
  const [kind, setKind] = useState<DocKind>(tpl?.kind ?? kinds[0]);
  const [tLang, setTLang] = useState<Lang>(tpl?.lang ?? (lang === 'es' ? 'es' : 'en'));
  const [source, setSource] = useState<'company' | 'supplied'>(tpl?.source === 'supplied' ? 'supplied' : 'company');
  const [blocks, setBlocks] = useState<Block[]>(() => (tpl ? tpl.blocks.map((b) => ({ ...b })) : [{ id: uid('b'), type: 'p', text: '' }, { id: uid('b'), type: 'sign', text: 'client' }]));
  const [err, setErr] = useState('');
  const focus = useRef<{ i: number; el: HTMLTextAreaElement | null }>({ i: -1, el: null });
  const issues = templateIssues({ name, blocks });

  const set = (i: number, p: Partial<Block>) => setBlocks((list) => list.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const move = (i: number, by: number) => setBlocks((list) => { const next = [...list]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); return next; });
  const insert = (id: string) => {
    const { i, el } = focus.current;
    if (i < 0 || !blocks[i] || blocks[i].type === 'sign') { setErr(t('docs.tpl.pickBlock')); return; }
    const at = el ? el.selectionStart ?? blocks[i].text.length : blocks[i].text.length;
    set(i, { text: blocks[i].text.slice(0, at) + `{{${id}}}` + blocks[i].text.slice(at) }); setErr('');
    requestAnimationFrame(() => { el?.focus(); });
  };
  const toggleRole = (i: number, role: SignerRole) => { const cur = signRoles(blocks[i].text); const has = cur.includes(role); const next = has ? cur.filter((r) => r !== role) : SIGNER_ROLES.filter((r) => r === role || cur.includes(r)); set(i, { text: (next.length ? next : ['client']).join(', ') }); };
  const save = () => {
    if (!name.trim()) { setErr(t('docs.tpl.needName')); return; }
    const out = act(saveTemplate, { id: tpl?.id, kind, name, lang: tLang, blocks, source });
    if (!out) { setErr(t('docs.tpl.err.not_allowed')); return; }
    toast(t(tpl?.approved ? 'docs.tpl.savedUnapproved' : 'docs.tpl.saved')); onClose();
  };

  return (
    <Modal title={t(tpl ? 'docs.tpl.editTitle' : 'docs.tpl.new')} onClose={onClose} size="wide" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="docs-tpl-save">{t('docs.tpl.save')}</Button></>}>
      <div className="docs-tpled" data-testid="docs-tpl-editor">
        <div className="stack tight">
          {tpl?.approved && <Note tone="warn">{t('docs.tpl.editApproved')}</Note>}
          <div className="fgrid">
            <Field label={t('docs.tpl.name')} full><input value={name} onChange={(e) => setName(e.target.value)} data-testid="docs-tpl-name" /></Field>
            <Field label={t('docs.f.kind')}><select value={kind} onChange={(e) => setKind(e.target.value as DocKind)} disabled={!!tpl} data-testid="docs-tpl-kind">{kinds.map((k) => <option key={k} value={k}>{t('doc.kind.' + k)}</option>)}</select></Field>
            <Field label={t('docs.lang')}><select value={tLang} onChange={(e) => setTLang(e.target.value as Lang)} data-testid="docs-tpl-lang">{TPL_LANGS.map((l) => <option key={l} value={l}>{t('docs.lang.' + l)}</option>)}</select></Field>
            <Field label={t('docs.tpl.sourceLabel')} full hint={t('docs.tpl.sourceHint')}><select value={source} onChange={(e) => setSource(e.target.value as 'company' | 'supplied')} data-testid="docs-tpl-source"><option value="company">{t('docs.tpl.source.company')}</option><option value="supplied">{t('docs.tpl.source.supplied')}</option></select></Field>
          </div>
          <ol className="docs-blocks" data-testid="docs-tpl-blocks">
            {blocks.map((b, i) => (
              <li key={b.id} data-type={b.type}>
                <div className="row tight between">
                  <select className="input docs-btype" value={b.type} aria-label={t('docs.tpl.blockType')} onChange={(e) => set(i, { type: e.target.value as Block['type'], text: e.target.value === 'sign' ? 'client' : b.type === 'sign' ? '' : b.text })}>{BLOCK_TYPES.map((x) => <option key={x} value={x}>{t('docs.tpl.block.' + x)}</option>)}</select>
                  <span className="row tight">
                    {b.type !== 'sign' && hasPlaceholder(b.text) && <Badge tone="warn" outline>{t('docs.tpl.placeholder')}</Badge>}
                    <button type="button" className="iconbtn sm" aria-label={t('esign.prep.up')} disabled={i === 0} onClick={() => move(i, -1)}><LuArrowUp aria-hidden="true" /></button>
                    <button type="button" className="iconbtn sm" aria-label={t('esign.prep.down')} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}><LuArrowDown aria-hidden="true" /></button>
                    <button type="button" className="iconbtn sm" aria-label={t('docs.tpl.removeBlock')} onClick={() => setBlocks((list) => list.filter((_, k) => k !== i))}><LuTrash2 aria-hidden="true" /></button>
                  </span>
                </div>
                {b.type === 'sign' ? (
                  <div className="row docs-roles" role="group" aria-label={t('docs.tpl.block.sign')}>
                    {SIGNER_ROLES.map((r) => <label key={r} className="check"><input type="checkbox" checked={signRoles(b.text).includes(r)} onChange={() => toggleRole(i, r)} /><span>{roleLabel(r, lang)}</span></label>)}
                  </div>
                ) : (
                  <textarea className="input" rows={b.type === 'h' ? 1 : b.type === 'list' ? 3 : 4} value={b.text} aria-label={t('docs.tpl.block.' + b.type)} placeholder={t(b.type === 'list' ? 'docs.tpl.listHint' : 'docs.tpl.textHint')}
                    onFocus={(e) => { focus.current = { i, el: e.target as HTMLTextAreaElement }; }} onChange={(e) => set(i, { text: e.target.value })} data-testid="docs-tpl-text" />
                )}
              </li>
            ))}
          </ol>
          <div className="row">
            {BLOCK_TYPES.map((x) => <Button key={x} size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setBlocks((list) => [...list, { id: uid('b'), type: x, text: x === 'sign' ? 'client' : '' }])} data-testid={`docs-tpl-add-${x}`}>{t('docs.tpl.block.' + x)}</Button>)}
          </div>
          {issues.unknown.length > 0 && <Note tone="warn">{t('docs.tpl.unknown', { fields: issues.unknown.map((x) => `{{${x}}}`).join(', ') })}</Note>}
          {issues.placeholders > 0 && <p className="small muted" data-testid="docs-tpl-issues">{t('docs.tpl.placeholders', { n: issues.placeholders })}</p>}
          {err && <p className="small neg" role="alert">{err}</p>}
        </div>
        <aside className="docs-merge" aria-label={t('docs.tpl.fields')}>
          <h4>{t('docs.tpl.fields')}</h4>
          <p className="xs dim">{t('docs.tpl.insertHint')}</p>
          {GROUPS.map((g) => <div key={g} className="docs-mergeg"><span className="label">{t('docs.tpl.group.' + g)}</span><div className="row tight">{MERGE_FIELDS.filter((f) => f.group === g).map((f) => <button key={f.id} type="button" className="docs-chip" onClick={() => insert(f.id)} title={`{{${f.id}}}`}>{pick(f.label, lang)}</button>)}</div></div>)}
          <p className="xs dim">{t('docs.tpl.optionalHint')}</p>
        </aside>
      </div>
    </Modal>
  );
}
