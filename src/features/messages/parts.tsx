// Pieces the list of prepared emails, the inbox and the client tab share: the icon and name of a channel, the honest state
// of a message, the mark of an automation, and the dialog where a prepared message is reviewed, sent or discarded.
import { useState } from 'react';
import { LuFacebook, LuInfo, LuInstagram, LuMail, LuMessageCircle, LuMessageSquareText, LuPaperclip, LuPhone, LuSend, LuStickyNote, LuTrash2, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, refPath } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Field, Modal, confirmDialog, toast } from '@/ui';
import { CanWrite, DemoTag } from '@/app/shared';
import { byId } from '@/domain/selectors';
import { discardDraft, sendDraft, updateDraft } from '@/domain/actions';
import { quietNow, type HeldMessage, type Refusal } from '@/domain/actions/messages';
import type { Client, DemoState, Message, MessageChannel } from '@/domain/types';
import type { Attachment } from './model';

export const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());

const ICON: Record<MessageChannel | 'note', typeof LuMail> = { email: LuMail, text: LuMessageSquareText, whatsapp: LuMessageCircle, facebook: LuFacebook, instagram: LuInstagram, call: LuPhone, system: LuInfo, note: LuStickyNote };
export function ChannelIcon({ channel, label }: { channel: MessageChannel | 'note'; label?: boolean }) {
  const { t } = useApp();
  const Icon = ICON[channel];
  return label ? <span className="messages-ch"><Icon aria-hidden="true" />{t('messages.ch.' + channel)}</span> : <Icon aria-label={t('messages.ch.' + channel)} role="img" className="messages-chi" />;
}

/**
 * The state of a message, in words that never claim more than happened. `demo` reads "Sample: nothing was sent" in the
 * inbox; the list of prepared emails keeps the words it has always used. The other states only ever come from the server.
 */
export function StatusBadge({ message, classic }: { message: Message; classic?: boolean }) {
  const { t } = useApp();
  const s = message.status;
  if (s === 'draft') return <Badge tone="warn">{t((message as HeldMessage).held ? 'messages.status.held' : 'messages.status.draft')}</Badge>;
  if (s === 'demo') return <Badge tone="accent" outline>{t(classic ? 'messages.status.demo' : 'messages.status.sample')}</Badge>;
  const tone = s === 'failed' ? 'bad' : s === 'queued' ? 'info' : s === 'received' ? 'neutral' : 'ok';
  return <Badge tone={tone}>{t('messages.status.' + s)}</Badge>;
}
export function AutoMark({ link }: { link: boolean }) {
  const { t } = useApp();
  const inner = <><LuZap aria-hidden="true" />{t('messages.auto')}</>;
  return link ? <A to="/automations" className="badge violet messages-auto" title={t('messages.autoHint')}>{inner}</A> : <span className="badge violet messages-auto" title={t('messages.autoHint')}>{inner}</span>;
}
/** Marks something that only happened for show in a sample workspace. The inbox's own words for it: nothing was sent. */
export function SampleTag({ incoming }: { incoming?: boolean }) {
  const { t } = useApp();
  return <Badge tone="accent" outline title={t('messages.sampleHint')}>{t(incoming ? 'messages.sampleRecord' : 'messages.sampleTag')}</Badge>;
}
/** Files named on a message. A generated document links to its page; a stored file is named with its size. */
export function Attachments({ files }: { files?: Attachment[] }) {
  if (!files?.length) return null;
  return (
    <ul className="messages-files">
      {files.map((f, i) => <li key={i}><LuPaperclip aria-hidden="true" />{f.docId ? <A to={`/documents/${f.docId}`}>{f.name}</A> : <span>{f.name}</span>}</li>)}
    </ul>
  );
}

/** Who an email is for and which record it is about. */
export function about(data: DemoState, m: Message): { name: string; label: string; path: string | null } {
  const r = m.ref;
  const job = r?.type === 'job' ? byId(data.jobs, r.id) : undefined;
  const lead = r?.type === 'lead' ? byId(data.leads, r.id) : undefined;
  const client: Client | undefined = byId(data.clients, m.clientId) ?? (r?.type === 'client' ? byId(data.clients, r.id) : job ? byId(data.clients, job.clientId)
    : data.clients.find((c) => !!c.email && c.email.toLowerCase() === m.to.toLowerCase()));
  const label = job?.name ?? lead?.name ?? (r?.type === 'client' ? client?.name : undefined) ?? '';
  return { name: client?.name ?? lead?.name ?? '', label, path: label && r ? refPath(r) : null };
}
/** Why a message cannot be written, in the viewer's words. */
export const refusalKey = (reason: Refusal | 'not_connected' | 'not_found', channel: MessageChannel): string =>
  (reason === 'no_consent' && (channel === 'facebook' || channel === 'instagram') ? 'messages.no.replyOnly' : 'messages.no.' + reason);

/* ---------- review, send or discard one prepared message ---------- */
export function ReviewModal({ message, onClose, onSent, classic }: { message: Message; onClose: () => void; onSent?: (id: string) => void; /** The list of prepared emails keeps its own wording. */ classic?: boolean }) {
  const { t, data, pack, can, dateTime, live } = useApp();
  const [to, setTo] = useState(message.to);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [err, setErr] = useState(false);
  const email = message.channel === 'email';
  const sent = message.status !== 'draft';
  const a = about(data, message);
  const ok = () => (email ? isEmail(to) && !!subject.trim() : !!to.trim()) && !!body.trim();
  const save = () => { act(updateDraft, message.id, { to, subject, body }); toast(t('messages.savedToast')); onClose(); };
  const send = async () => {
    if (!ok()) { setErr(true); return; }
    // a text during quiet hours is the sender's call: the hours are stated and they decide
    if (!email && (message.channel === 'text' || message.channel === 'whatsapp') && quietNow(data, pack) && !(await confirmDialog(t('messages.quiet.confirm'), t('messages.send'), t('common.cancel'), false))) return;
    act(updateDraft, message.id, { to, subject, body });
    const out = act(sendDraft, message.id);
    if (!out.ok) { toast(t(refusalKey(out.reason, message.channel)), true); return; }
    onSent?.(message.id); toast(t(live ? 'messages.queuedToast' : classic ? 'messages.sentToast' : 'messages.sampleToast')); onClose();
  };
  const discard = async () => { if (await confirmDialog(t(classic ? 'messages.discardConfirm' : 'messages.discardConfirmAny'), t('messages.discard'), t('common.cancel'))) { act(discardDraft, message.id); toast(t(classic ? 'messages.discarded' : 'messages.discardedAny')); onClose(); } };
  const meta = (
    <p className="small muted messages-meta">
      {a.path && <span>{t('messages.f.about')}: <A to={a.path}>{a.label}</A></span>}
      {message.auto && <AutoMark link={can('automations')} />}
    </p>
  );
  const tag = live ? null : classic ? <DemoTag /> : <SampleTag />;
  if (sent) {
    return (
      <Modal title={<>{t(classic ? 'messages.view.title' : 'messages.view.titleAny')} {tag}</>} onClose={onClose} labelClose={t('common.close')}
        footer={<>{can('delete') && message.status === 'demo' && <CanWrite><Button variant="ghost" icon={<LuTrash2 />} onClick={discard}>{t('common.delete')}</Button></CanWrite>}<Button variant="primary" onClick={onClose}>{t('common.close')}</Button></>}>
        <dl className="kv"><dt>{t('messages.f.to')}</dt><dd>{a.name ? `${a.name} · ${message.to}` : message.to}</dd>{message.subject && <><dt>{t('messages.f.subject')}</dt><dd>{message.subject}</dd></>}</dl>
        {meta}
        <div className="messages-body" data-testid="messages-body">{message.body}</div>
        <Attachments files={message.attachments} />
        {message.status === 'demo' && <p className="small muted" style={{ marginTop: 12 }}>{t(classic ? 'messages.sentAt' : 'messages.sampleAt', { date: dateTime(message.at) })}</p>}
      </Modal>
    );
  }
  return (
    <Modal title={<>{t(classic || email ? 'messages.review.title' : 'messages.review.titleAny')} {tag}</>} onClose={onClose} labelClose={t('common.close')}
      footer={<><CanWrite><Button variant="ghost" className="messages-side" icon={<LuTrash2 />} onClick={discard} data-testid="messages-discard">{t('messages.discard')}</Button></CanWrite><span className="grow messages-sp" /><CanWrite><Button onClick={save} data-testid="messages-save">{t('messages.saveDraft')}</Button></CanWrite><CanWrite><Button variant="primary" icon={<LuSend />} onClick={send} data-testid="messages-send">{t('messages.send')}</Button></CanWrite></>}>
      <div className="stack tight">
        <Field label={a.name ? `${t('messages.f.to')}: ${a.name}` : t('messages.f.to')} error={err && (email ? !isEmail(to) : !to.trim())}><input type={email ? 'email' : 'text'} value={to} onChange={(e) => setTo(e.target.value)} data-testid="messages-to" /></Field>
        {email && <Field label={t('messages.f.subject')} error={err && !subject.trim()}><input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="messages-subject" /></Field>}
        <Field label={t('messages.f.body')} error={err && !body.trim()}><textarea rows={email ? 10 : 5} value={body} onChange={(e) => setBody(e.target.value)} data-testid="messages-body" /></Field>
        <Attachments files={message.attachments} />
        {meta}
        {(message as HeldMessage).held && <p className="small" role="note">{t('messages.heldNote')}</p>}
        {err && <p className="small neg" role="alert">{t(email ? 'messages.needFields' : 'messages.needFieldsAny')}</p>}
        <p className="xs dim">{t(live ? 'messages.sendHintLive' : classic ? 'messages.sendHint' : 'messages.sendHintSample')}</p>
      </div>
    </Modal>
  );
}
