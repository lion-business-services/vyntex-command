// Messages: the emails the automations prepare and the ones the office writes. In demo mode nothing leaves the browser:
// "Send" only marks the email as sent in this demo. There is no inbox and no texting screen, because neither exists yet.
import { useEffect, useMemo, useState } from 'react';
import { LuMailPlus, LuSend, LuTrash2, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, navigate, refPath, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, confirmDialog, toast } from '@/ui';
import { DemoTag, PlanBadge } from '@/app/shared';
import { byId, jobMoney, jobsOfClient } from '@/domain/selectors';
import type { Client, DemoState, Lang, Message, Ref } from '@/domain/types';
import { makeT } from '@/i18n';
import { planName } from '@/lib/pricing';
import { addOnViews, publicRules } from '@/lib/pricing-view';
import { money2 } from '@/lib/money';
import { fmtDate, today } from '@/lib/dates';
import { composeMessage, discardMessage, sendMessageDemo, updateMessage } from './actions';
import { TEMPLATES, fillTemplate, type TemplateId } from './templates';
import { SuccessCheck } from '@/features/documents/success';
import './messages.css';

type Tab = 'review' | 'sent' | 'all';
const TABS: Tab[] = ['review', 'sent', 'all'];
const LANGS: Lang[] = ['en', 'es'];
const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());

/** Who an email is for and which record it is about. */
function about(data: DemoState, m: Message): { name: string; label: string; path: string | null } {
  const r = m.ref;
  const job = r.type === 'job' ? byId(data.jobs, r.id) : undefined;
  const lead = r.type === 'lead' ? byId(data.leads, r.id) : undefined;
  const client: Client | undefined = r.type === 'client' ? byId(data.clients, r.id) : job ? byId(data.clients, job.clientId)
    : data.clients.find((c) => !!c.email && c.email.toLowerCase() === m.to.toLowerCase());
  const label = job?.name ?? lead?.name ?? (r.type === 'client' ? client?.name : undefined) ?? '';
  return { name: client?.name ?? lead?.name ?? '', label, path: label ? refPath(r) : null };
}

export default function MessagesPage(_: PageProps) {
  const { t, data, pack, lang, can, dateTime, standing } = useApp();
  const route = useRoute();
  const [tab, setTab] = useState<Tab>('review');
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ clientId?: string } | null>(null);
  // the email that was just marked as sent: confirmed once above the list, with a way to open it
  const [sentId, setSentId] = useState<string | null>(null);

  // links from other pages: /messages?open=<message id> and /messages?compose=<client id>
  useEffect(() => {
    const o = route.query.get('open'); const c = route.query.get('compose');
    if (o) { const m = byId(data.messages, o); if (m) { setOpenId(o); if (m.status === 'demo') setTab('all'); } }
    else if (c !== null) setCompose({ clientId: c || undefined });
    if (o || c !== null) navigate(appPath('/messages'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const counts = { review: data.messages.filter((m) => m.status === 'draft').length, sent: data.messages.filter((m) => m.status === 'demo').length, all: data.messages.length };
  const rows = useMemo(() => data.messages
    .filter((m) => (tab === 'review' ? m.status === 'draft' : tab === 'sent' ? m.status === 'demo' : true))
    // keyed on the whole data object: sending marks the message in place, so the list itself keeps its identity
    .sort((a, b) => b.at.localeCompare(a.at)), [data, tab]);
  const open = byId(data.messages, openId ?? undefined);
  const justSent = byId(data.messages, sentId ?? undefined);
  const pick = (x: Tab) => { setTab(x); setSentId(null); };
  const emails = standing('clientEmails');
  const rule = publicRules(pack.id, lang, t).find((r) => r === t('price.r.emails'));
  const sms = addOnViews(pack.id, lang, t).find((a) => a.id === 'sms');
  const write = <Button variant="primary" icon={<LuMailPlus />} onClick={() => setCompose({})} data-testid="messages-compose">{t('messages.compose')}</Button>;

  return (
    <>
      <PageHeader title={t('messages.title')} sub={t('messages.sub')} actions={write} />

      <div className="note messages-frame" data-testid="messages-frame">
        <p className="strong">{t('messages.frame.demo')}</p>
        <p><span>{t('messages.frame.connect')}</span> <DemoTag kind="connect" /></p>
        <p><span>{t('messages.frame.auto')}</span> <PlanBadge feature="clientEmails" detail />{emails.state === 'upgrade' && emails.plan && <span className="muted"> {t('ent.upgradeHint', { plan: planName(emails.plan, lang) })}</span>}</p>
        {rule && <p className="small muted">{rule}</p>}
      </div>

      <div className="tabs" role="tablist" aria-label={t('messages.tabs')}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => pick(x)} data-testid={`messages-tab-${x}`}>
            {t('messages.tab.' + x)}{counts[x] > 0 && <span className="count">{counts[x]}</span>}
          </button>
        ))}
      </div>

      {justSent?.status === 'demo' && (
        <p className="messages-done small" role="status" data-testid="messages-done">
          <SuccessCheck draw /><span>{t('messages.done', { subject: justSent.subject })}</span>
          <button type="button" className="linkbtn" onClick={() => setOpenId(justSent.id)}>{t('messages.doneSee')}</button>
        </p>
      )}

      {!data.messages.length ? (
        <Card className="messages-none"><Empty title={t('messages.empty')} action={<Button variant="primary" onClick={() => setCompose({})}>{t('messages.compose')}</Button>}>{t('messages.emptyHint')}</Empty></Card>
      ) : !rows.length ? (
        <Card className="messages-none"><Empty title={t(tab === 'review' ? 'messages.emptyReview' : 'messages.emptySent')} action={<Button onClick={() => pick('all')}>{t('messages.showAll')}</Button>}>{t(tab === 'review' ? 'messages.emptyReviewHint' : 'messages.emptySentHint')}</Empty></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="tbl stackable messages-tbl" data-testid="messages-table">
              <thead><tr><th>{t('messages.col.to')}</th><th>{t('messages.col.subject')}</th><th>{t('messages.col.about')}</th><th>{t('messages.col.when')}</th>{tab === 'all' && <th>{t('messages.col.status')}</th>}</tr></thead>
              <tbody>
                {rows.map((m) => {
                  const a = about(data, m);
                  return (
                    <tr key={m.id} className="click" data-status={m.status} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) setOpenId(m.id); }}>
                      <td className="t1"><button type="button" className="messages-open" onClick={() => setOpenId(m.id)}>{a.name || m.to || t('messages.noRecipient')}</button>{a.name && <div className="xs dim messages-addr">{m.to || t('messages.noRecipient')}</div>}</td>
                      <td data-label={t('messages.col.subject')}><div className="messages-subj">{m.subject}</div>{m.auto && <AutoMark link={can('automations')} />}</td>
                      <td data-label={t('messages.col.about')}>{a.path ? <A to={a.path}>{a.label}</A> : null}</td>
                      <td data-label={t('messages.col.when')} className="small muted nowrap">{dateTime(m.at)}</td>
                      {tab === 'all' && <td data-label={t('messages.col.status')}><StatusBadge status={m.status} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="messages-more">
        <Card title={t('messages.inbox.title')} actions={<PlanBadge feature="inbox" />}>
          <p className="small muted">{t('messages.inbox.body')}</p>
        </Card>
        {sms && <p className="small muted messages-sms" data-testid="messages-sms"><b>{t('messages.sms.title')}:</b> {sms.name}.{sms.note ? ` ${sms.note}` : ''} <PlanBadge feature="sms" detail /></p>}
      </div>

      {open && <MessageModal key={open.id} message={open} onClose={() => setOpenId(null)} onSent={setSentId} />}
      {compose && <ComposeModal clientId={compose.clientId} onClose={() => setCompose(null)} onSent={setSentId} />}
    </>
  );
}

function StatusBadge({ status }: { status: Message['status'] }) {
  const { t } = useApp();
  return status === 'draft' ? <Badge tone="warn">{t('messages.status.draft')}</Badge> : <Badge tone="accent" outline>{t('messages.status.demo')}</Badge>;
}
function AutoMark({ link }: { link: boolean }) {
  const { t } = useApp();
  const inner = <><LuZap aria-hidden="true" />{t('messages.auto')}</>;
  return link ? <A to="/automations" className="badge violet messages-auto" title={t('messages.autoHint')}>{inner}</A> : <span className="badge violet messages-auto" title={t('messages.autoHint')}>{inner}</span>;
}

/* ---------- review, send or discard one email ---------- */
function MessageModal({ message, onClose, onSent }: { message: Message; onClose: () => void; onSent: (id: string) => void }) {
  const { t, data, can, dateTime } = useApp();
  const [to, setTo] = useState(message.to);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [err, setErr] = useState(false);
  const sent = message.status === 'demo';
  const a = about(data, message);
  const ok = () => isEmail(to) && !!subject.trim() && !!body.trim();
  const save = () => { act(updateMessage, message.id, { to, subject, body }); toast(t('messages.savedToast')); onClose(); };
  const send = () => {
    if (!ok()) { setErr(true); return; }
    act(updateMessage, message.id, { to, subject, body }); act(sendMessageDemo, message.id);
    onSent(message.id); toast(t('messages.sentToast')); onClose();
  };
  const discard = async () => { if (await confirmDialog(t('messages.discardConfirm'), t('messages.discard'), t('common.cancel'))) { act(discardMessage, message.id); toast(t('messages.discarded')); onClose(); } };
  const meta = (
    <p className="small muted messages-meta">
      {a.path && <span>{t('messages.f.about')}: <A to={a.path}>{a.label}</A></span>}
      {message.auto && <AutoMark link={can('automations')} />}
    </p>
  );
  if (sent) {
    return (
      <Modal title={<>{t('messages.view.title')} <DemoTag /></>} onClose={onClose} labelClose={t('common.close')}
        footer={<>{can('delete') && <Button variant="ghost" icon={<LuTrash2 />} onClick={discard}>{t('common.delete')}</Button>}<Button variant="primary" onClick={onClose}>{t('common.close')}</Button></>}>
        <dl className="kv"><dt>{t('messages.f.to')}</dt><dd>{a.name ? `${a.name} · ${message.to}` : message.to}</dd><dt>{t('messages.f.subject')}</dt><dd>{message.subject}</dd></dl>
        {meta}
        <div className="messages-body" data-testid="messages-body">{message.body}</div>
        <p className="small muted" style={{ marginTop: 12 }}>{t('messages.sentAt', { date: dateTime(message.at) })}</p>
      </Modal>
    );
  }
  return (
    <Modal title={<>{t('messages.review.title')} <DemoTag /></>} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" className="messages-side" icon={<LuTrash2 />} onClick={discard} data-testid="messages-discard">{t('messages.discard')}</Button><span className="grow messages-sp" /><Button onClick={save} data-testid="messages-save">{t('messages.saveDraft')}</Button><Button variant="primary" icon={<LuSend />} onClick={send} data-testid="messages-send">{t('messages.send')}</Button></>}>
      <div className="stack tight">
        <Field label={a.name ? `${t('messages.f.to')}: ${a.name}` : t('messages.f.to')} error={err && !isEmail(to)}><input type="email" value={to} onChange={(e) => setTo(e.target.value)} data-testid="messages-to" /></Field>
        <Field label={t('messages.f.subject')} error={err && !subject.trim()}><input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="messages-subject" /></Field>
        <Field label={t('messages.f.body')} error={err && !body.trim()}><textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} data-testid="messages-body" /></Field>
        {meta}
        {err && <p className="small neg" role="alert">{t('messages.needFields')}</p>}
        <p className="xs dim">{t('messages.sendHint')}</p>
      </div>
    </Modal>
  );
}

/* ---------- write a new email to a client, optionally from a starter template ---------- */
function ComposeModal({ clientId, onClose, onSent }: { clientId?: string; onClose: () => void; onSent: (id: string) => void }) {
  const { t, data, pack, lang, can } = useApp();
  const first = byId(data.clients, clientId) ?? data.clients[0];
  const [who, setWho] = useState(first?.id ?? '');
  const [jobId, setJobId] = useState('');
  const [tpl, setTpl] = useState<'' | TemplateId>('');
  const [mailLang, setMailLang] = useState<Lang>(lang);
  const [to, setTo] = useState(first?.email ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [typed, setTyped] = useState(false);
  const [err, setErr] = useState(false);

  if (!data.clients.length) {
    return <Modal title={t('messages.new.title')} onClose={onClose} size="narrow" labelClose={t('common.close')} footer={<A to="/clients" className="btn primary">{t('messages.goClients')}</A>}><p className="muted">{t('messages.noClients')}</p></Modal>;
  }
  const client = byId(data.clients, who);
  const jobs = client ? jobsOfClient(data, client.id) : [];

  /** Writes the starter text for the current choices. */
  const fill = (next: { tpl: '' | TemplateId; who: string; jobId: string; mailLang: Lang }) => {
    if (!next.tpl) return;
    const c = byId(data.clients, next.who); const j = byId(data.jobs, next.jobId);
    const owes = j ? jobMoney(data, j).clientOwes : 0;
    const out = fillTemplate(next.tpl, makeT(next.mailLang, pack), { client: c, job: j, company: data.company, when: j?.start && j.start >= today() ? fmtDate(j.start, next.mailLang) : undefined, amount: can('money') && owes > 0.005 ? money2(owes) : undefined });
    setSubject(out.subject); setBody(out.body); setTyped(false); setErr(false);
  };
  const now = { tpl, who, jobId, mailLang };
  const pickClient = (id: string) => { setWho(id); setJobId(''); setTo(byId(data.clients, id)?.email ?? ''); setErr(false); if (!typed) fill({ ...now, who: id, jobId: '' }); };
  const pickJob = (id: string) => { setJobId(id); if (!typed) fill({ ...now, jobId: id }); };
  const pickLang = (l: Lang) => { setMailLang(l); if (!typed) fill({ ...now, mailLang: l }); };
  const pickTpl = (id: '' | TemplateId) => { setTpl(id); fill({ ...now, tpl: id }); };

  const ok = () => !!client && isEmail(to) && !!subject.trim() && !!body.trim();
  const create = (): Message | null => {
    if (!ok() || !client) { setErr(true); return null; }
    const ref: Ref = jobId ? { type: 'job', id: jobId } : { type: 'client', id: client.id };
    return act(composeMessage, { to, subject, body, ref });
  };
  const save = () => { if (create()) { toast(t('messages.savedToast')); onClose(); } };
  const send = () => { const m = create(); if (!m) return; act(sendMessageDemo, m.id); onSent(m.id); toast(t('messages.sentToast')); onClose(); };

  return (
    <Modal title={<>{t('messages.new.title')} <DemoTag /></>} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" className="messages-side" onClick={onClose}>{t('common.cancel')}</Button><span className="grow messages-sp" /><Button onClick={save} data-testid="messages-save">{t('messages.saveDraft')}</Button><Button variant="primary" icon={<LuSend />} onClick={send} data-testid="messages-send">{t('messages.send')}</Button></>}>
      <div className="fgrid">
        <Field label={t('messages.f.client')}><select value={who} onChange={(e) => pickClient(e.target.value)} data-testid="messages-client">{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label={`${t('messages.f.job')} (${t('common.optional')})`}><select value={jobId} onChange={(e) => pickJob(e.target.value)} data-testid="messages-job"><option value="">{t('messages.f.noJob')}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></Field>
        <Field label={t('messages.f.template')}><select value={tpl} onChange={(e) => pickTpl(e.target.value as '' | TemplateId)} data-testid="messages-template"><option value="">{t('messages.f.blank')}</option>{TEMPLATES.map((x) => <option key={x} value={x}>{t('messages.tpl.' + x)}</option>)}</select></Field>
        <div className="field">
          <span className="label">{t('messages.f.lang')}</span>
          <div className="seg" role="group" aria-label={t('messages.f.lang')} data-testid="messages-lang">{LANGS.map((l) => <button key={l} type="button" aria-pressed={mailLang === l} data-lang={l} onClick={() => pickLang(l)}>{t('messages.lang.' + l)}</button>)}</div>
        </div>
        <Field full label={t('messages.f.to')} error={err && !isEmail(to)} hint={client && !client.email ? t('messages.noEmail') : client?.emailOptOut ? t('messages.optOut') : undefined}><input type="email" value={to} onChange={(e) => { setTo(e.target.value); setErr(false); }} data-testid="messages-to" /></Field>
        <Field full label={t('messages.f.subject')} error={err && !subject.trim()}><input value={subject} onChange={(e) => { setSubject(e.target.value); setTyped(true); setErr(false); }} data-testid="messages-subject" /></Field>
        <Field full label={t('messages.f.body')} error={err && !body.trim()}><textarea rows={9} value={body} onChange={(e) => { setBody(e.target.value); setTyped(true); setErr(false); }} data-testid="messages-body" /></Field>
      </div>
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{t('messages.needFields')}</p>}
      <p className="xs dim" style={{ marginTop: 10 }}>{t('messages.sendHint')}</p>
    </Modal>
  );
}
