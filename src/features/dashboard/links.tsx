// The links a team sends to clients often (the bookkeeping and payroll links of LBS Command, plus any the company adds).
// One row per link: copy it, or start a message to a client with the link in it. A link without an address says so and
// offers the way to set it to people who may configure the company. An address is never made up.
// Used on the home screen and on the service-line screens.
import { useState } from 'react';
import { LuCopy, LuExternalLink, LuLink2, LuPencil, LuPlus, LuSend, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { go } from '@/app/router';
import { mutate } from '@/store/store';
import { Badge, Button, Field, IconButton, Modal, cx, toast } from '@/ui';
import { DEPLOY } from '@/config/deployment';
import { pick } from '@/i18n';
import { quickLinksOf, removeQuickLink, safeUrl, saveQuickLink, type QuickLink } from '@/domain/actions/ops';
import type { DemoState, Lang } from '@/domain/types';

/** The links of this deployment and this company, in the order they are shown. */
export const quickLinks = (data: Pick<DemoState, 'config'>): QuickLink[] => quickLinksOf(data, DEPLOY.quickLinks);
export const linkLabel = (l: QuickLink, lang: Lang) => pick(l.label, lang) || l.label.en;

/** Puts text on the clipboard. Returns false when the browser does not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* older browsers and embedded previews: fall through */ }
  try {
    const el = document.createElement('textarea'); el.value = text; el.setAttribute('readonly', ''); el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select(); const ok = document.execCommand('copy'); el.remove(); return ok;
  } catch { return false; }
}
/** Starts a message to a client with the link already written in it. The communications screen takes it from there. */
export function sendLink(label: string, url: string) { go(`/messages?compose=1&subject=${encodeURIComponent(label)}&body=${encodeURIComponent(url)}`); }

/**
 * One link. `kind` decides the second action: a client link is sent to a client, the firm's own application is opened.
 * `onSet` is given to people who may change the address.
 */
export function LinkRow({ label, url, kind = 'client', onSet, onRemove, testId }: { label: string; url: string; kind?: 'client' | 'staff'; onSet?: () => void; onRemove?: () => void; testId?: string }) {
  const { t, can } = useApp();
  const copy = async () => { toast((await copyText(url)) ? t('dash.links.copied') : t('dash.links.copyFailed', { url }), false); };
  // the link is also put on the clipboard, so it can be pasted wherever the message ends up being written
  const send = async () => { const copied = await copyText(url); sendLink(label, url); if (copied) toast(t('dash.links.sendHint')); };
  return (
    <div className={cx('dash-link', !url && 'unset')} data-testid={testId} data-set={url ? 'yes' : 'no'}>
      <span className="dash-link-ico" aria-hidden="true"><LuLink2 /></span>
      <div className="grow dash-link-t">
        <b>{label}</b>
        {url ? <span className="small muted dash-link-url" title={url}>{url.replace(/^https?:\/\//, '')}</span> : <span className="small dash-link-none"><Badge tone="warn">{t('dash.links.notSet')}</Badge> {onSet ? null : <span className="muted">{t('dash.links.askOwner')}</span>}</span>}
      </div>
      <div className="row tight dash-link-a">
        {url && <Button size="sm" icon={<LuCopy aria-hidden="true" />} onClick={() => { void copy(); }} data-testid={testId ? testId + '-copy' : undefined}>{t('dash.links.copy')}</Button>}
        {url && kind === 'client' && can('comms') && can('write') && <Button size="sm" icon={<LuSend aria-hidden="true" />} onClick={() => { void send(); }} data-testid={testId ? testId + '-send' : undefined}>{t('dash.links.send')}</Button>}
        {url && kind === 'staff' && <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer"><LuExternalLink aria-hidden="true" />{t('common.open')}</a>}
        {!url && onSet && <Button size="sm" icon={<LuPencil aria-hidden="true" />} onClick={onSet} data-testid={testId ? testId + '-set' : undefined}>{t('dash.links.set')}</Button>}
        {url && onSet && <IconButton size="sm" label={`${t('dash.links.change')}: ${label}`} onClick={onSet}><LuPencil /></IconButton>}
        {onRemove && <IconButton size="sm" label={`${t('common.delete')}: ${label}`} onClick={onRemove}><LuTrash2 /></IconButton>}
      </div>
    </div>
  );
}

/** Asks for a web address (and a name, for a link the company adds). Refuses anything that is not a web address. */
export function AddressModal({ title, label, url, askLabel, hint, onSave, onClose }: { title: string; label?: string; url: string; askLabel?: boolean; hint?: string; onSave: (url: string, label: string) => boolean; onClose: () => void }) {
  const { t } = useApp();
  const [value, setValue] = useState(url); const [name, setName] = useState(label ?? ''); const [err, setErr] = useState('');
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (askLabel && !name.trim()) { setErr(t('common.required')); return; }
    if (value.trim() && !safeUrl(value)) { setErr(t('dash.links.badUrl')); return; }
    if (!onSave(value.trim(), name.trim())) { setErr(t('dash.links.badUrl')); return; }
    toast(t('common.saved')); onClose();
  };
  return (
    <Modal title={title} onClose={onClose} size="narrow" labelClose={t('common.close')}>
      <form onSubmit={save} noValidate>
        <div className="stack tight">
          {askLabel && <Field label={t('dash.links.name')} htmlFor="dash-link-name"><input id="dash-link-name" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder={t('dash.links.namePh')} data-testid="dash-link-name" /></Field>}
          <Field label={t('dash.links.address')} htmlFor="dash-link-url" hint={hint ?? t('dash.links.addressHint')} error={!!err}><input id="dash-link-url" type="url" inputMode="url" value={value} onChange={(e) => { setValue(e.target.value); setErr(''); }} placeholder="https://" data-testid="dash-link-url" data-autofocus /></Field>
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" data-testid="dash-link-save">{t('common.save')}</Button></div>
      </form>
    </Modal>
  );
}

/** The whole block: every link, and for people who may configure the company, the way to set an address or add a link. */
export function QuickLinks({ only, compact }: { /** Show just these link ids (a service-line screen shows its own). */ only?: string[]; compact?: boolean }) {
  const { t, data, lang, can } = useApp();
  const [edit, setEdit] = useState<{ link?: QuickLink } | null>(null);
  const may = can('config') && can('write');
  const links = quickLinks(data).filter((l) => !only || only.includes(l.id));
  const remove = (l: QuickLink) => { mutate((d) => removeQuickLink(d, l.id), 'config'); toast(t('common.deleted')); };
  if (!links.length && !(may && !only)) return null;
  return (
    <>
      <div className={cx('dash-links', compact && 'compact')} data-testid="dash-links">
        {links.map((l) => <LinkRow key={l.id} label={linkLabel(l, lang)} url={l.url} onSet={may ? () => setEdit({ link: l }) : undefined} onRemove={may && !l.fixed ? () => remove(l) : undefined} testId={`dash-link-${l.id}`} />)}
        {may && !only && <button type="button" className="linkbtn small dash-links-add" onClick={() => setEdit({})} data-testid="dash-link-add"><LuPlus aria-hidden="true" />{t('dash.links.add')}</button>}
      </div>
      {edit && <AddressModal title={edit.link ? linkLabel(edit.link, lang) : t('dash.links.add')} url={edit.link?.url ?? ''} askLabel={!edit.link} onClose={() => setEdit(null)}
        onSave={(url, label) => { let ok = false; mutate((d) => { ok = saveQuickLink(d, { id: edit.link?.id, label: edit.link ? undefined : label, url }); }, 'config'); return ok; }} />}
    </>
  );
}
