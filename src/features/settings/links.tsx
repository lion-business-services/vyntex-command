// Settings: the links the team sends to clients often, shown on the home screen. A deployment can ship some (LBS Command
// ships a bookkeeping client link and a payroll client link): those are always listed, an owner gives each one its address,
// and they cannot be removed. A company can add its own. An address is only ever what someone typed here or what the
// deployment was built with: none is made up, and a link without one is shown as not set.
import { useState } from 'react';
import { LuLink2, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { mutate } from '@/store/store';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, confirmDialog, toast } from '@/ui';
import { pick } from '@/i18n';
import { quickLinksOf, removeQuickLink, safeUrl, saveQuickLink, type QuickLink } from '@/domain/actions/ops';
import { auditSample } from '@/domain/actions/security';
import { DEPLOY } from '@/config/deployment';

export default function LinksSection() {
  const { t, data, lang, can, user } = useApp();
  const [editing, setEditing] = useState<QuickLink | 'new' | null>(null);
  const links = quickLinksOf(data, DEPLOY.quickLinks);
  const mayEdit = can('config') && can('write');
  const remove = async (l: QuickLink) => {
    if (!(await confirmDialog(t('settings.links.removeConfirm', { name: pick(l.label, lang) }), t('common.delete'), t('common.cancel')))) return;
    mutate((d) => { removeQuickLink(d, l.id); auditSample(d, user?.id ?? 'system', 'config.links', 'company'); });
    toast(t('common.deleted'));
  };
  return (
    <>
      <Card title={t('settings.links.title')} actions={mayEdit ? <Button size="sm" variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setEditing('new')} data-testid="settings-link-add">{t('settings.links.add')}</Button> : undefined}>
        <p className="muted settings-lead">{t('settings.links.intro')}</p>
        {!links.length ? <Empty title={t('settings.links.none')}>{t('settings.links.noneHint')}</Empty> : (
          <div className="list" data-testid="settings-links">
            {links.map((l) => (
              <div className="item settings-rule" key={l.id} data-link={l.id} data-set={l.url ? 'yes' : 'no'}>
                <span className="settings-conn-ic"><LuLink2 aria-hidden="true" /></span>
                <div className="grow">
                  <div className="t">{pick(l.label, lang)} {l.fixed && <Badge outline>{t('settings.links.shipped')}</Badge>}</div>
                  {l.url ? <div className="small muted settings-wrap">{l.url}</div> : <div className="small"><Badge tone="warn">{t('settings.links.notSet')}</Badge> <span className="muted">{t('settings.links.notSetHint')}</span></div>}
                </div>
                {mayEdit && (
                  <span className="row tight nowrap">
                    <Button size="sm" variant={l.url ? 'default' : 'primary'} icon={<LuPencil aria-hidden="true" />} onClick={() => setEditing(l)} data-testid={`settings-link-set-${l.id}`}>{t(l.url ? 'settings.links.change' : 'settings.links.set')}</Button>
                    {!l.fixed && <IconButton size="sm" label={`${t('common.delete')}: ${pick(l.label, lang)}`} onClick={() => remove(l)}><LuTrash2 /></IconButton>}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {editing && <LinkModal link={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function LinkModal({ link, onClose }: { link: QuickLink | null; onClose: () => void }) {
  const { t, lang, user } = useApp();
  const [name, setName] = useState(link ? pick(link.label, lang) : '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [err, setErr] = useState('');
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!link && !name.trim()) { setErr(t('settings.links.needName')); return; }
    if (url.trim() && !safeUrl(url)) { setErr(t('settings.links.badUrl')); return; }
    let done = false;
    // a shipped link keeps its name; the company only gives it an address
    mutate((d) => { done = saveQuickLink(d, { id: link?.id, label: link?.fixed ? undefined : name, url }); if (done) auditSample(d, user?.id ?? 'system', 'config.links', 'company'); });
    if (!done) { setErr(t('settings.links.badUrl')); return; }
    toast(t('common.saved')); onClose();
  };
  return (
    <Modal title={link ? pick(link.label, lang) : t('settings.links.add')} onClose={onClose} size="narrow" labelClose={t('common.cancel')}>
      <form onSubmit={save} noValidate data-testid="settings-link-form">
        <div className="stack tight">
          {!link?.fixed && <Field label={t('settings.links.name')} htmlFor="set-link-name"><input id="set-link-name" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} maxLength={60} data-autofocus data-testid="settings-link-name" /></Field>}
          <Field label={t('settings.links.address')} htmlFor="set-link-url" hint={t('settings.links.addressHint')} error={!!err}><input id="set-link-url" type="url" inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} maxLength={300} placeholder="https://" data-testid="settings-link-url" /></Field>
        </div>
        {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" data-testid="settings-link-save">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
