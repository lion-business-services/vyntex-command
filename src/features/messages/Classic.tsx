// The list of prepared emails: what Messages has always been in the field editions, where the two-way inbox is not part of
// any plan. The emails the automations prepare and the ones the office writes, to review and send. In a sample workspace
// nothing leaves the browser: "Send" only marks the email as sent. Same records and same actions as the inbox (./Inbox.tsx);
// a company whose communications settings switch the inbox on gets that screen instead.
import { useEffect, useMemo, useState } from 'react';
import { LuMailPlus, LuSend } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, navigate, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Button, Card, Empty, Field, Modal, PageHeader, toast } from '@/ui';
import { DemoTag, PlanBadge, CanWrite } from '@/app/shared';
import { byId, jobMoney, jobsOfClient } from '@/domain/selectors';
import type { Lang, Message, Ref } from '@/domain/types';
import { makeT } from '@/i18n';
import { planName } from '@/lib/pricing';
import { addOnViews, publicRules } from '@/lib/pricing-view';
import { money2 } from '@/lib/money';
import { fmtDate, today } from '@/lib/dates';
import { composeMessage, sendMessageDemo } from './actions';
import { TEMPLATES, fillTemplate, type TemplateId } from './templates';
import { AutoMark, ReviewModal, StatusBadge, about, isEmail, refusalKey } from './parts';
import { SuccessCheck } from '@/features/documents/success';

type Tab = 'review' | 'sent' | 'all';
const TABS: Tab[] = ['review', 'sent', 'all'];
const LANGS: Lang[] = ['en', 'es'];
type EmailTemplate = (typeof TEMPLATES)[number];

export default function Classic(_: PageProps) {
  const { t, data, pack, lang, can, dateTime, standing } = useApp();
  const route = useRoute();
  const [tab, setTab] = useState<Tab>('review');
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ clientId?: string; subject?: string; body?: string } | null>(null);
  // the email that was just marked as sent: confirmed once above the list, with a way to open it
  const [sentId, setSentId] = useState<string | null>(null);

  // links from other pages: /messages?open=<message id> and /messages?compose=1&to=<client id>&subject=..&body=..
  // (the older /messages?compose=<client id> still works)
  useEffect(() => {
    const o = route.query.get('open'); const c = route.query.get('compose');
    if (o) { const m = byId(data.messages, o); if (m) { setOpenId(o); if (m.status === 'demo') setTab('all'); } }
    else if (c !== null) setCompose({ clientId: route.query.get('to') || (c !== '1' ? c : '') || undefined, subject: route.query.get('subject') ?? undefined, body: route.query.get('body') ?? undefined });
    if (o || c !== null) navigate(appPath('/messages'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // this list is about what the office writes; anything a client sent in belongs to the inbox
  const all = useMemo(() => data.messages.filter((m) => m.dir !== 'in'), [data]);
  const counts = { review: all.filter((m) => m.status === 'draft').length, sent: all.filter((m) => m.status === 'demo').length, all: all.length };
  const rows = useMemo(() => all
    .filter((m) => (tab === 'review' ? m.status === 'draft' : tab === 'sent' ? m.status === 'demo' : true))
    .sort((a, b) => b.at.localeCompare(a.at)), [all, tab]);
  const open = byId(data.messages, openId ?? undefined);
  const justSent = byId(data.messages, sentId ?? undefined);
  const pick = (x: Tab) => { setTab(x); setSentId(null); };
  const emails = standing('clientEmails');
  const rule = publicRules(pack.id, lang, t).find((r) => r === t('price.r.emails'));
  const sms = addOnViews(pack.id, lang, t).find((a) => a.id === 'sms');
  const write = <CanWrite><Button variant="primary" icon={<LuMailPlus />} onClick={() => setCompose({})} data-testid="messages-compose">{t('messages.compose')}</Button></CanWrite>;

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

      {!all.length ? (
        <Card className="messages-none"><Empty title={t('messages.empty')} action={<CanWrite><Button variant="primary" onClick={() => setCompose({})}>{t('messages.compose')}</Button></CanWrite>}>{t('messages.emptyHint')}</Empty></Card>
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
                      <td data-label={t('messages.col.subject')}><div className="messages-subj">{m.subject || m.body.slice(0, 80)}</div>{m.auto && <AutoMark link={can('automations')} />}</td>
                      <td data-label={t('messages.col.about')}>{a.path ? <A to={a.path}>{a.label}</A> : null}</td>
                      <td data-label={t('messages.col.when')} className="small muted nowrap">{dateTime(m.at)}</td>
                      {tab === 'all' && <td data-label={t('messages.col.status')}><StatusBadge message={m} classic /></td>}
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

      {open && <ReviewModal key={open.id} message={open} onClose={() => setOpenId(null)} onSent={setSentId} classic />}
      {compose && <ComposeModal clientId={compose.clientId} subject={compose.subject} body={compose.body} onClose={() => setCompose(null)} onSent={setSentId} />}
    </>
  );
}

/* ---------- write a new email to a client, optionally from a starter template ---------- */
function ComposeModal({ clientId, subject: subject0, body: body0, onClose, onSent }: { clientId?: string; /** Text another page started the email with. */ subject?: string; body?: string; onClose: () => void; onSent: (id: string) => void }) {
  const { t, data, pack, lang, can } = useApp();
  const first = byId(data.clients, clientId) ?? data.clients[0];
  const [who, setWho] = useState(first?.id ?? '');
  const [jobId, setJobId] = useState('');
  const [tpl, setTpl] = useState<'' | EmailTemplate>('');
  const [mailLang, setMailLang] = useState<Lang>(lang === 'es' ? 'es' : 'en');
  const [to, setTo] = useState(first?.email ?? '');
  const [subject, setSubject] = useState(subject0 ?? '');
  const [body, setBody] = useState(body0 ?? '');
  // text that came with the link counts as typed: picking another client must not replace it with a starter
  const [typed, setTyped] = useState(!!(subject0 || body0));
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
  const pickTpl = (id: '' | EmailTemplate) => { setTpl(id); fill({ ...now, tpl: id }); };

  const ok = () => !!client && isEmail(to) && !!subject.trim() && !!body.trim();
  const create = (): Message | null => {
    if (!ok() || !client) { setErr(true); return null; }
    const ref: Ref = jobId ? { type: 'job', id: jobId } : { type: 'client', id: client.id };
    return act(composeMessage, { to, subject, body, ref });
  };
  const save = () => { if (create()) { toast(t('messages.savedToast')); onClose(); } };
  const send = () => {
    const m = create(); if (!m) return;
    const out = act(sendMessageDemo, m.id);
    if (!out.ok) { toast(t(refusalKey(out.reason, 'email')), true); onClose(); return; }
    onSent(m.id); toast(t('messages.sentToast')); onClose();
  };

  return (
    <Modal title={<>{t('messages.new.title')} <DemoTag /></>} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" className="messages-side" onClick={onClose}>{t('common.cancel')}</Button><span className="grow messages-sp" /><CanWrite><Button onClick={save} data-testid="messages-save">{t('messages.saveDraft')}</Button></CanWrite><Button variant="primary" icon={<LuSend />} onClick={send} data-testid="messages-send">{t('messages.send')}</Button></>}>
      <div className="fgrid">
        <Field label={t('messages.f.client')}><select value={who} onChange={(e) => pickClient(e.target.value)} data-testid="messages-client">{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label={`${t('messages.f.job')} (${t('common.optional')})`}><select value={jobId} onChange={(e) => pickJob(e.target.value)} data-testid="messages-job"><option value="">{t('messages.f.noJob')}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></Field>
        <Field label={t('messages.f.template')}><select value={tpl} onChange={(e) => pickTpl(e.target.value as '' | EmailTemplate)} data-testid="messages-template"><option value="">{t('messages.f.blank')}</option>{TEMPLATES.map((x) => <option key={x} value={x}>{t('messages.tpl.' + x)}</option>)}</select></Field>
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
