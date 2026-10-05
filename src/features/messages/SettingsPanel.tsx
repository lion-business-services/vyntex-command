// Settings section: how the company communicates. Which channels it uses, the hours when automatic texts wait for a
// person, the closing lines of its emails, and the messages it wrote once to reuse. Registered in
// src/features/settings/panels.ts (needs the `config` capability). Connecting a channel to an account is done on the
// Integrations screen; this section only says whether the company wants to use it.
import { useState } from 'react';
import { LuCopy, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { ctx, mutate } from '@/store/store';
import { Badge, Button, Card, Field, FormModal, IconButton, Note, confirmDialog, toast, type FieldDef } from '@/ui';
import { moduleOn } from '@/domain/config';
import { CHANNEL_PROVIDER, SEND_CHANNELS, commsSettings, saveCommsSettings, type CommsSettings, type MessageTemplate, type SendChannel } from '@/domain/actions/messages';
import type { ConnState } from '@/domain/types';
import { makeT } from '@/i18n';
import { uid } from '@/lib/id';
import { MERGE_FIELDS, connected } from './model';
import { ChannelIcon } from './parts';
import { TEMPLATES, TEXT_TEMPLATES, starterAsTemplate, type TemplateId } from './templates';
import './messages.css';

const CHANNELS: (SendChannel | 'call')[] = [...SEND_CHANNELS, 'call'];
const TPL_CHANNELS: MessageTemplate['channel'][] = ['email', 'text', 'whatsapp'];

function Switch({ on, onChange, label, testId, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="settings-switch" disabled={disabled} onClick={() => onChange(!on)} data-testid={testId}><span aria-hidden="true" /></button>;
}

export default function CommunicationsSettingsPanel() {
  const { t, data, pack, can, live } = useApp();
  const mayEdit = can('write') && can('config');
  const s = commsSettings(data, pack);
  const [editing, setEditing] = useState<MessageTemplate | 'new' | null>(null);
  const [sig, setSig] = useState({ en: s.signature.en ?? '', es: s.signature.es ?? '' });
  const save = (patch: Partial<CommsSettings>, said = 'common.saved') => { mutate((d) => saveCommsSettings(d, ctx(), patch), 'config'); toast(t(said)); };
  const stateOf = (ch: SendChannel | 'call'): ConnState => (connected(data, ch) ? 'connected' : data.connections.find((x) => x.id === CHANNEL_PROVIDER[ch])?.state ?? 'not_connected');
  const integrations = can('integrations') && moduleOn(data, pack, 'integrations');

  const copyStarter = (id: TemplateId) => {
    const channel: MessageTemplate['channel'] = (TEXT_TEMPLATES as readonly string[]).includes(id) ? 'text' : 'email';
    const made = { ...starterAsTemplate(id, makeT('en', pack, data.config), makeT('es', pack, data.config), uid('mt'), channel), name: t('messages.tpl.' + id) };
    save({ templates: [...s.templates, made] }, 'messages.set.copied');
    setEditing(made);
  };
  const remove = async (x: MessageTemplate) => {
    if (!(await confirmDialog(t('messages.set.deleteAsk', { name: x.name }), t('common.delete'), t('common.cancel')))) return;
    save({ templates: s.templates.filter((y) => y.id !== x.id) }, 'common.deleted');
  };
  const fields: FieldDef[] = [
    { k: 'name', label: t('common.name'), req: true, full: true },
    { k: 'channel', label: t('messages.channel'), type: 'select', options: TPL_CHANNELS.map((c) => [c, t('messages.ch.' + c)]) },
    { k: 'purpose', label: t('messages.set.purpose'), type: 'select', options: [['service', t('messages.set.purpose.service')], ['marketing', t('messages.set.purpose.marketing')]], hint: t('messages.set.purposeHint') },
    { k: 'subjectEn', label: t('messages.set.subjectEn'), full: true, hint: t('messages.set.subjectHint') }, { k: 'bodyEn', label: t('messages.set.bodyEn'), type: 'textarea', req: true },
    { k: 'subjectEs', label: t('messages.set.subjectEs'), full: true }, { k: 'bodyEs', label: t('messages.set.bodyEs'), type: 'textarea', req: true },
    { k: 'active', label: t('messages.set.active'), type: 'checkbox', full: true },
  ];
  const fieldsNote = <p className="xs dim messages-fields">{t('messages.set.fields')} {MERGE_FIELDS.map((f) => <code key={f}>{`{{${f}}}`}</code>)}</p>;

  return (
    <>
      <Card title={t('messages.set.channels')}>
        <p className="muted settings-lead">{t('messages.set.channelsIntro')}</p>
        <div className="list" data-testid="messages-set-channels">
          {CHANNELS.map((ch) => {
            const on = s.channels[ch]; const st = stateOf(ch);
            return (
              <div className="item" key={ch} data-channel={ch}>
                <div className="grow">
                  <div className="t"><ChannelIcon channel={ch} label /></div>
                  <div className="small muted">{t('messages.set.ch.' + ch)}</div>
                  <div className="xs dim">{t('messages.set.conn')}: <Badge tone={st === 'connected' ? 'ok' : st === 'pending_approval' ? 'warn' : 'neutral'}>{t('messages.conn.' + st)}</Badge>{!live && <> {t('messages.set.connSample')}</>}</div>
                </div>
                <Switch on={on} disabled={!mayEdit} label={`${t(on ? 'messages.set.turnOff' : 'messages.set.turnOn')}: ${t('messages.ch.' + ch)}`} testId={`messages-set-${ch}`} onChange={(next) => save({ channels: { ...s.channels, [ch]: next } })} />
              </div>
            );
          })}
        </div>
        {integrations && <div className="card-foot"><span className="small muted">{t('messages.set.connectHint')}</span><A to="/integrations" className="btn sm">{t('nav.integrations')}</A></div>}
      </Card>

      <Card title={t('messages.set.quiet')} actions={<Switch on={s.quiet.on} disabled={!mayEdit} label={t('messages.set.quiet')} testId="messages-set-quiet" onChange={(next) => save({ quiet: { ...s.quiet, on: next } })} />}>
        <p className="muted settings-lead">{t('messages.set.quietIntro')}</p>
        <div className="messages-quiet">
          <Field label={t('common.from')}><input type="time" value={s.quiet.from} disabled={!mayEdit || !s.quiet.on} onChange={(e) => e.target.value && save({ quiet: { ...s.quiet, from: e.target.value } })} data-testid="messages-set-quiet-from" /></Field>
          <Field label={t('common.to')}><input type="time" value={s.quiet.to} disabled={!mayEdit || !s.quiet.on} onChange={(e) => e.target.value && save({ quiet: { ...s.quiet, to: e.target.value } })} data-testid="messages-set-quiet-to" /></Field>
        </div>
        <p className="xs dim" style={{ marginTop: 10 }}>{t('messages.set.quietNote')}</p>
      </Card>

      <Card title={t('messages.set.signature')}>
        <p className="muted settings-lead">{t('messages.set.signatureIntro')}</p>
        <div className="grid2">
          <Field label={t('messages.lang.en')}><textarea rows={4} value={sig.en} disabled={!mayEdit} onChange={(e) => setSig({ ...sig, en: e.target.value })} data-testid="messages-set-sig-en" /></Field>
          <Field label={t('messages.lang.es')}><textarea rows={4} value={sig.es} disabled={!mayEdit} onChange={(e) => setSig({ ...sig, es: e.target.value })} data-testid="messages-set-sig-es" /></Field>
        </div>
        {fieldsNote}
        {mayEdit && <div className="row" style={{ marginTop: 12 }}><span className="grow" /><Button variant="primary" size="sm" onClick={() => save({ signature: sig })} disabled={sig.en === (s.signature.en ?? '') && sig.es === (s.signature.es ?? '')} data-testid="messages-set-sig-save">{t('common.save')}</Button></div>}
      </Card>

      <Card title={t('messages.set.templates')} actions={mayEdit ? <Button size="sm" icon={<LuPlus />} onClick={() => setEditing('new')} data-testid="messages-set-add">{t('messages.set.add')}</Button> : undefined}>
        <p className="muted settings-lead">{t('messages.set.templatesIntro')}</p>
        <div className="list" data-testid="messages-set-templates">
          {s.templates.map((x) => {
            const provider = x.channel === 'whatsapp' ? 'whatsapp' : 'sms';
            const approval = x.channel !== 'email' && x.purpose === 'marketing';
            return (
              <div className="item" key={x.id} data-template={x.id}>
                <div className="grow">
                  <div className="t">{x.name} {!x.active && <Badge>{t('messages.set.off')}</Badge>}</div>
                  <div className="small muted row tight"><ChannelIcon channel={x.channel} label /><span>· {t('messages.set.purpose.' + x.purpose)}</span>
                    {approval && <Badge tone="warn">{t(data.connections.find((c) => c.id === provider)?.state === 'connected' ? 'messages.approval.check' : 'messages.approval.pending')}</Badge>}</div>
                  <div className="xs dim clip">{x.body.en.replace(/\s+/g, ' ').slice(0, 120)}</div>
                </div>
                {mayEdit && <><IconButton size="sm" label={`${t('common.edit')}: ${x.name}`} onClick={() => setEditing(x)}><LuPencil /></IconButton><IconButton size="sm" label={`${t('common.delete')}: ${x.name}`} onClick={() => remove(x)}><LuTrash2 /></IconButton></>}
              </div>
            );
          })}
          {[...TEMPLATES, ...TEXT_TEMPLATES].map((id) => (
            <div className="item" key={id} data-starter={id}>
              <div className="grow">
                <div className="t">{t('messages.tpl.' + id)} <Badge tone="info" outline>{t('messages.set.starter')}</Badge></div>
                <div className="small muted"><ChannelIcon channel={(TEXT_TEMPLATES as readonly string[]).includes(id) ? 'text' : 'email'} label /></div>
              </div>
              {mayEdit && <Button size="sm" icon={<LuCopy />} onClick={() => copyStarter(id)} data-testid={`messages-set-copy-${id}`}>{t('messages.set.copy')}</Button>}
            </div>
          ))}
        </div>
        {fieldsNote}
      </Card>
      <Note>{t('messages.set.approvalNote')}</Note>

      {editing && (
        <FormModal title={t(editing === 'new' ? 'messages.set.add' : 'messages.set.edit')} fields={fields} saveLabel={t('common.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')} onClose={() => setEditing(null)}
          initial={editing === 'new' ? { channel: 'email', purpose: 'service', active: true } : { name: editing.name, channel: editing.channel, purpose: editing.purpose, subjectEn: editing.subject.en, subjectEs: editing.subject.es, bodyEn: editing.body.en, bodyEs: editing.body.es, active: editing.active }}
          validate={(v) => (v.channel === 'email' && (!v.subjectEn || !v.subjectEs) ? t('messages.set.needSubject') : null)}
          extra={fieldsNote}
          onSave={(v) => {
            const next: MessageTemplate = { id: editing === 'new' ? uid('mt') : editing.id, name: v.name, channel: v.channel, purpose: v.purpose, subject: { en: v.channel === 'email' ? v.subjectEn : '', es: v.channel === 'email' ? v.subjectEs : '' }, body: { en: v.bodyEn, es: v.bodyEs }, active: !!v.active };
            save({ templates: editing === 'new' ? [...s.templates, next] : s.templates.map((y) => (y.id === next.id ? next : y)) });
          }} />
      )}
    </>
  );
}
