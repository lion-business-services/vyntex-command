// One conversation: everything said to and by one person on every channel, the notes the office kept (never sent), and the
// place to answer, write a note or log a call. Used by the inbox and by the client page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LuArrowLeft, LuCheck, LuListPlus, LuLock, LuPaperclip, LuPhone, LuPhoneIncoming, LuPhoneOutgoing, LuRotateCcw, LuSend, LuUserPlus, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, refPath } from '@/app/router';
import { act, ctx, mutateQuiet } from '@/store/store';
import { Avatar, Badge, Button, Empty, Field, FormModal, IconButton, Seg, confirmDialog, cx, toast } from '@/ui';
import { TaskFormModal } from '@/app/forms';
import { CanWrite } from '@/app/shared';
import { actorName, byId, jobsOfClient } from '@/domain/selectors';
import { moduleOn, sourcesOf, taskTypesOf } from '@/domain/config';
import { addNote, createLead, logCall, queueMessage, recordConsent, setConversation } from '@/domain/actions';
import { NO_RECORD, commsSettings, markRead, quietNow, type CallNote, type HeldMessage, type SendChannel } from '@/domain/actions/messages';
import type { Lang, Message, Task } from '@/domain/types';
import { makeT } from '@/i18n';
import { toISODate } from '@/lib/dates';
import { attachable, channelStates, duration, fillLines, fillMerge, hasOpenFields, mergeValues, timeline, type Attachment, type ChannelState, type Conversation, type Entry } from './model';
import { Attachments, AutoMark, ChannelIcon, ReviewModal, SampleTag, StatusBadge, isEmail, refusalKey } from './parts';
import { fillTemplate, startersFor, type TemplateId } from './templates';

const PAGE = 30;
const LANGS: Lang[] = ['en', 'es'];
const clock = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function Thread({ conv, embedded, onBack, glance, prefill }: {
  conv: Conversation; /** On the client page: no header of its own. */ embedded?: boolean; onBack?: () => void;
  /** Shown without having been opened by the person (the first conversation on a wide screen): it is not marked as read. */ glance?: boolean;
  /** A message another page started for this person (a link to send): the composer opens with it written in. */ prefill?: { subject: string; body: string };
}) {
  const { t, data, pack, can, live, date, user } = useApp();
  const write = can('write');
  const entries = useMemo(() => timeline(conv), [conv]);
  const [limit, setLimit] = useState(PAGE);
  const [review, setReview] = useState<string | null>(null);
  const [task, setTask] = useState<Partial<Task> | null>(null);
  const [lead, setLead] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = entries.slice(Math.max(0, entries.length - limit));
  const reviewing = byId(data.messages, review ?? undefined);

  // the newest entry is at the bottom, where the answer is written
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [conv.key, entries.length]);
  // opening a conversation is reading it. Housekeeping, not a change to the records: it does not count as editing the sample.
  useEffect(() => {
    const unread = entries.filter((e) => e.message && e.message.dir === 'in' && e.message.read === false).map((e) => e.id);
    if (unread.length && write && !glance) mutateQuiet((d) => markRead(d, ctx(), unread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.key, entries.length, glance]);

  const phone = conv.client?.phone || conv.lead?.phone || (conv.address && !conv.address.includes('@') ? conv.address : '');
  const people = data.users.filter((u) => u.active !== false);
  const taskFrom = (m?: Message) => setTask({
    title: t('messages.task.title', { name: conv.name }), description: m ? (m.subject ? m.subject + '\n\n' : '') + m.body : undefined,
    clientId: conv.client?.id, leadId: conv.lead?.id, assignee: 'u:' + (conv.assignee ?? user?.id ?? data.users[0]?.id ?? ''),
    ...(taskTypesOf(data, pack).some((x) => x.id === 'client_request') ? { type: 'client_request', requestedBy: conv.name, channel: m?.channel } : {}),
  });
  const days = new Set<string>();

  return (
    <section className={cx('messages-thread', embedded && 'embedded')} aria-label={t('messages.thread.label', { name: conv.name })}>
      {!embedded && (
        <header className="messages-th">
          {onBack && <IconButton label={t('messages.backToList')} className="messages-back" onClick={onBack}><LuArrowLeft /></IconButton>}
          <Avatar name={conv.name} />
          <div className="grow messages-who">
            {conv.ref ? <A to={refPath(conv.ref)} className="messages-name">{conv.name}</A> : <span className="messages-name">{conv.name}</span>}
            <div className="small muted clip">{conv.ref ? [conv.sub, t(conv.client ? 'messages.kind.client' : 'messages.kind.lead')].filter(Boolean).join(' · ') : t('messages.unknown')}</div>
          </div>
          <div className="row tight messages-tha">
            {phone && <a className="btn sm" href={`tel:${phone.replace(/[^0-9+]/g, '')}`} data-testid="messages-tel"><LuPhone aria-hidden="true" />{t('common.call')}</a>}
            {conv.ref && write && (
              <select className="messages-assign" value={conv.assignee ?? ''} aria-label={t('messages.assign')} data-testid="messages-assign"
                onChange={(e) => { act(setConversation, conv.ref!, { assignee: e.target.value || null }); toast(t('messages.assigned')); }}>
                <option value="">{t('common.unassigned')}</option>
                {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {conv.ref && !write && conv.assignee && <span className="small muted">{actorName(data, conv.assignee)}</span>}
            {conv.ref && <CanWrite>{conv.done
              ? <Button size="sm" icon={<LuRotateCcw />} onClick={() => act(setConversation, conv.ref!, { done: false })} data-testid="messages-reopen">{t('messages.reopen')}</Button>
              : <Button size="sm" icon={<LuCheck />} onClick={() => { act(setConversation, conv.ref!, { done: true }); toast(t('messages.doneToast')); }} data-testid="messages-done-btn">{t('messages.markDone')}</Button>}</CanWrite>}
            {can('tasks') && <CanWrite><IconButton label={t('messages.newTask')} onClick={() => taskFrom()} data-testid="messages-task"><LuListPlus /></IconButton></CanWrite>}
            {!conv.lead && can('leads') && moduleOn(data, pack, 'leads') && <CanWrite><IconButton label={t('messages.newLead')} onClick={() => setLead(true)} data-testid="messages-lead"><LuUserPlus /></IconButton></CanWrite>}
          </div>
        </header>
      )}

      <div className="messages-tl" ref={box} data-testid="messages-thread">
        {entries.length > shown.length && <button type="button" className="linkbtn small messages-earlier" onClick={() => setLimit((n) => n + PAGE)} data-testid="messages-earlier">{t('messages.earlier', { n: entries.length - shown.length })}</button>}
        {!entries.length && <Empty title={t('messages.thread.empty')}>{t('messages.thread.emptyHint')}</Empty>}
        {shown.map((e) => {
          const dayKey = toISODate(new Date(e.at)); const first = !days.has(dayKey); days.add(dayKey);
          return (
            <div key={e.id} className="messages-e">
              {first && <div className="messages-day"><span>{date(dayKey)}</span></div>}
              <EntryView entry={e} onReview={setReview} onTask={can('tasks') && write ? taskFrom : undefined} live={live} />
            </div>
          );
        })}
      </div>

      <Composer conv={conv} entries={entries} prefill={prefill} />

      {reviewing && <ReviewModal key={reviewing.id} message={reviewing} onClose={() => setReview(null)} />}
      {task && <TaskFormModal defaults={task} onClose={() => setTask(null)} />}
      {lead && <LeadFromConversation conv={conv} onClose={() => setLead(false)} />}
    </section>
  );
}

/* ---------- one entry of the conversation ---------- */
function EntryView({ entry, onReview, onTask, live }: { entry: Entry; onReview: (id: string) => void; onTask?: (m: Message) => void; live: boolean }) {
  const { t, data, time, can } = useApp();
  const at = time(clock(entry.at));
  if (entry.note) {
    const n = entry.note as CallNote; const by = n.by ? actorName(data, n.by) : null;
    if (n.kind === 'call') {
      return (
        <div className="messages-call" data-kind="call">
          {n.dir === 'in' ? <LuPhoneIncoming aria-hidden="true" /> : <LuPhoneOutgoing aria-hidden="true" />}
          <div className="grow"><b>{t(n.dir === 'in' ? 'messages.call.in' : n.dir === 'out' ? 'messages.call.out' : 'messages.call.any')}</b>{n.seconds ? ` · ${duration(n.seconds)}` : ''}<div className="messages-text">{n.text}</div></div>
          <span className="xs dim nowrap">{at}{by ? ` · ${t('messages.call.loggedBy', { name: by })}` : ''}</span>
        </div>
      );
    }
    return (
      <div className="messages-note" data-kind="note">
        <LuLock aria-hidden="true" />
        <div className="grow"><span className="xs strong messages-notel">{t('messages.note.label')}</span><div className="messages-text">{n.text}</div></div>
        <span className="xs dim nowrap">{at}{by ? ` · ${by}` : ''}</span>
      </div>
    );
  }
  const m = entry.message!;
  if (m.channel === 'system') return <div className="messages-sys" data-kind="system"><span>{m.body}</span><span className="xs dim nowrap">{at}</span></div>;
  if (m.channel === 'call') {
    const inc = m.dir === 'in';
    return (
      <div className="messages-call" data-kind="call">
        {inc ? <LuPhoneIncoming aria-hidden="true" /> : <LuPhoneOutgoing aria-hidden="true" />}
        <div className="grow"><b>{t(inc ? 'messages.call.in' : 'messages.call.out')}</b>{m.seconds ? ` · ${duration(m.seconds)}` : ''}{m.body && <div className="messages-text">{m.body}</div>}</div>
        <span className="row tight">{!live && <SampleTag incoming />}<span className="xs dim nowrap">{at}</span></span>
      </div>
    );
  }
  const inc = m.dir === 'in'; const draft = m.status === 'draft';
  const who = inc ? m.from : m.auto ? t('common.automation') : m.by ? actorName(data, m.by) : null;
  // a message written about one piece of work links to it, so the conversation can be read by engagement or job as well
  const job = m.ref?.type === 'job' ? byId(data.jobs, m.ref.id) : undefined;
  return (
    <div className={cx('messages-msg', inc ? 'in' : 'out', draft && 'draft', m.status === 'failed' && 'failed')} data-kind="message" data-status={m.status} data-channel={m.channel}>
      <div className="messages-mh"><ChannelIcon channel={m.channel} label /><span className="xs dim">{[who, at].filter(Boolean).join(' · ')}</span></div>
      {m.subject && <div className="messages-subject">{m.subject}</div>}
      <div className="messages-text">{m.body}</div>
      <Attachments files={m.attachments} />
      <div className="messages-mf">
        {inc ? (!live && <SampleTag incoming />) : <StatusBadge message={m} />}
        {m.auto && <AutoMark link={can('automations')} />}
        {(m as HeldMessage).held && <span className="xs muted">{t('messages.heldShort')}</span>}
        {m.status === 'failed' && m.error && <span className="xs neg">{m.error}</span>}
        {job && <A to={`/jobs/${job.id}`} className="xs messages-about">{job.name}</A>}
        <span className="grow" />
        {draft && <CanWrite><Button size="sm" onClick={() => onReview(m.id)} data-testid="messages-review">{t('messages.reviewBtn')}</Button></CanWrite>}
        {inc && onTask && <button type="button" className="linkbtn xs" onClick={() => onTask(m)}>{t('messages.newTask')}</button>}
      </div>
    </div>
  );
}

/* ---------- answer, note or call ---------- */
type Mode = 'reply' | 'note' | 'call';

function Composer({ conv, entries, prefill }: { conv: Conversation; entries: Entry[]; prefill?: { subject: string; body: string } }) {
  const { t, data, pack, lang, can, live, user } = useApp();
  const write = can('write');
  const settings = commsSettings(data, pack);
  const states = useMemo(() => channelStates(data, pack, conv, live), [data, pack, conv, live]);
  // the last thing they wrote on a channel that can be answered: the reply starts there and joins that conversation
  const lastIn = useMemo(() => [...entries].reverse().find((e) => e.message?.dir === 'in' && states.some((s) => s.channel === e.message!.channel))?.message, [entries, states]);
  const [mode, setMode] = useState<Mode>('reply');
  const [channel, setChannel] = useState<SendChannel | ''>(() => (lastIn && states.find((s) => s.channel === lastIn.channel && !s.blocked)?.channel) || states.find((s) => !s.blocked)?.channel || states[0]?.channel || '');
  const [tpl, setTpl] = useState('');
  const person = conv.client ?? conv.lead;
  const [mailLang, setMailLang] = useState<Lang>(person?.lang === 'es' || (!person?.lang && lang === 'es') ? 'es' : 'en');
  const [jobId, setJobId] = useState('');
  // null until the person types: the address on the record shows, and can be cleared and replaced
  const [to, setTo] = useState<string | null>(null);
  const [subject, setSubject] = useState(prefill?.subject ?? '');
  const [body, setBody] = useState(prefill?.body ?? '');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sign, setSign] = useState(true);
  const [err, setErr] = useState('');
  // note and call
  const [note, setNote] = useState('');
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [minutes, setMinutes] = useState('');
  const [callText, setCallText] = useState('');

  const cur: ChannelState | undefined = states.find((s) => s.channel === channel);
  const email = channel === 'email';
  const address = email ? to ?? cur?.address ?? '' : cur?.address ?? '';
  // an email address typed by hand lifts "no address": the person is writing to where they were told to write
  const blocked = cur ? (cur.blocked === 'no_address' && email && isEmail(address) ? null : cur.blocked) : 'channel_off';
  const jobs = conv.client ? jobsOfClient(data, conv.client.id) : [];
  const docs = useMemo(() => attachable(data, conv), [data, conv]);
  const values = (l: Lang) => mergeValues(data, l, conv, user, jobId);
  const signature = email && sign ? fillLines(settings.signature[mailLang] ?? '', values(mailLang)).trim() : '';
  const own = settings.templates.filter((x) => x.active && x.channel === channel);
  const starters = channel ? startersFor(channel) : [];

  const fill = (id: string, l: Lang, job: string) => {
    if (!id) return;
    if (id.startsWith('s:')) {
      const v = mergeValues(data, l, conv, user, job);
      const out = fillTemplate(id.slice(2) as TemplateId, makeT(l, pack), { client: person ? { name: person.name, addresses: conv.client?.addresses ?? [] } : undefined, job: byId(data.jobs, job), company: data.company, when: v['appointment.date'] ? [v['appointment.date'], v['appointment.time']].filter(Boolean).join(', ') : undefined });
      setSubject(out.subject); setBody(out.body);
    } else {
      const x = settings.templates.find((y) => y.id === id.slice(2)); if (!x) return;
      const v = mergeValues(data, l, conv, user, job);
      setSubject(fillMerge(x.subject[l === 'es' ? 'es' : 'en'], v)); setBody(fillMerge(x.body[l === 'es' ? 'es' : 'en'], v));
    }
    setErr('');
  };
  const pickChannel = (c: SendChannel) => { setChannel(c); setTpl(''); setTo(null); setErr(''); };
  const marketing = tpl.startsWith('t:') && settings.templates.find((y) => y.id === tpl.slice(2))?.purpose === 'marketing' && (channel === 'text' || channel === 'whatsapp');
  const approval = data.connections.find((x) => x.id === (channel === 'whatsapp' ? 'whatsapp' : 'sms'))?.state;

  const submit = async (how: 'draft' | 'send') => {
    if (!cur || !channel) return;
    if (!body.trim() || (email && how === 'send' && (!subject.trim() || !isEmail(address)))) { setErr(t(email ? 'messages.needFields' : 'messages.needBody')); return; }
    if (how === 'send' && blocked) { setErr(t(refusalKey(blocked, channel))); return; }
    if (how === 'send' && hasOpenFields(subject + body)) { setErr(t('messages.openFields')); return; }
    if (how === 'send' && (channel === 'text' || channel === 'whatsapp') && quietNow(data, pack) && !(await confirmDialog(t('messages.quiet.confirm'), t('messages.send'), t('common.cancel'), false))) return;
    const text = signature ? body.trim() + '\n\n' + signature : body;
    const out = act(queueMessage, {
      channel, to: address, subject: email ? subject : undefined, body: text, mode: how, personal: true, clientId: conv.client?.id,
      ref: jobId ? { type: 'job', id: jobId } : conv.ref ?? NO_RECORD, replyTo: lastIn && lastIn.channel === channel ? lastIn.id : undefined, attachments: files.length ? files : undefined,
    });
    if (!out.ok) { setErr(t(refusalKey(out.reason, channel))); return; }
    toast(t(how === 'draft' ? 'messages.savedDraftToast' : live ? 'messages.queuedToast' : 'messages.sampleToast'));
    setSubject(''); setBody(''); setFiles([]); setTpl(''); setErr('');
  };
  const consent = async (ch: 'text' | 'whatsapp' | 'email', agreed: boolean) => {
    if (!conv.ref) return;
    const key = ch === 'email' ? (agreed ? 'messages.consent.askEmailOn' : 'messages.consent.askEmailOff') : agreed ? 'messages.consent.askOn' : 'messages.consent.askOff';
    if (!(await confirmDialog(t(key, { name: conv.name, channel: t('messages.ch.' + ch), company: data.company.name }), t(agreed ? 'messages.consent.record' : 'messages.consent.recordOff'), t('common.cancel'), !agreed))) return;
    act(recordConsent, conv.ref, ch, agreed); toast(t('messages.consent.saved'));
  };
  const saveNote = () => { if (!conv.ref || !note.trim()) return; act(addNote, conv.ref, 'note', note); setNote(''); toast(t('messages.note.saved')); };
  const saveCall = () => {
    if (!conv.ref) return;
    const mins = Number(minutes); if (minutes && !(mins >= 0 && mins < 1440)) { setErr(t('messages.call.badMinutes')); return; }
    act(logCall, conv.ref, { dir, seconds: Math.round((mins || 0) * 60), text: callText }); setMinutes(''); setCallText(''); setErr(''); toast(t('messages.call.saved'));
  };
  const phone = person?.phone || (conv.address && !conv.address.includes('@') ? conv.address : '');

  if (!write) return <p className="small muted messages-ro">{t('messages.readOnly')}</p>;
  const modes: { value: Mode; label: string }[] = [{ value: 'reply', label: t('messages.mode.reply') }, { value: 'note', label: t('messages.mode.note') }, ...(settings.channels.call ? [{ value: 'call' as Mode, label: t('messages.mode.call') }] : [])];

  return (
    <div className="messages-composer" data-testid="messages-composer">
      <div className="row between messages-cmodes">
        <Seg label={t('messages.mode.label')} value={mode} onChange={(m) => { setMode(m); setErr(''); }} options={modes} />
        {!live && mode === 'reply' && <SampleTag />}
      </div>

      {mode === 'reply' && (!states.length ? <p className="small muted">{t('messages.noChannels')}</p> : (
        <div className="stack tight">
          <div className="messages-chs" role="group" aria-label={t('messages.channel')}>
            {states.map((s) => (
              <button key={s.channel} type="button" aria-pressed={s.channel === channel} className={cx('messages-chb', s.blocked && 'off')} onClick={() => pickChannel(s.channel)} data-testid={`messages-channel-${s.channel}`} title={s.blocked ? t(refusalKey(s.blocked, s.channel)) : s.address}>
                <ChannelIcon channel={s.channel} label />
              </button>
            ))}
          </div>
          {cur && <ChannelNote conv={conv} state={cur} blocked={blocked} onConsent={consent} />}
          {cur && (
            <>
              <div className="messages-cgrid">
                {email
                  ? <div className="messages-to"><Field label={t('messages.f.to')}><input type="email" value={address} onChange={(e) => setTo(e.target.value)} data-testid="messages-reply-to" /></Field></div>
                  : <div className="field"><span className="label">{t('messages.f.to')}</span><span className="messages-addr2">{cur.address || t('messages.noAddress')}</span></div>}
                {(starters.length > 0 || own.length > 0) && (
                  <Field label={t('messages.f.template')}>
                    <select value={tpl} onChange={(e) => { setTpl(e.target.value); fill(e.target.value, mailLang, jobId); }} data-testid="messages-reply-template">
                      <option value="">{t('messages.f.blankAny')}</option>
                      {starters.map((x) => <option key={x} value={'s:' + x}>{t('messages.tpl.' + x)}</option>)}
                      {own.map((x) => <option key={x.id} value={'t:' + x.id}>{x.name}</option>)}
                    </select>
                  </Field>
                )}
                <div className="field">
                  <span className="label">{t('messages.f.langAny')}</span>
                  <div className="seg" role="group" aria-label={t('messages.f.langAny')}>{LANGS.map((l) => <button key={l} type="button" aria-pressed={mailLang === l} onClick={() => { setMailLang(l); if (tpl) fill(tpl, l, jobId); }}>{t('messages.lang.' + l)}</button>)}</div>
                </div>
                {jobs.length > 0 && (
                  <Field label={`${t('messages.f.job')} (${t('common.optional')})`}>
                    <select value={jobId} onChange={(e) => { setJobId(e.target.value); if (tpl) fill(tpl, mailLang, e.target.value); }}><option value="">{t('messages.f.noJob')}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
                  </Field>
                )}
              </div>
              {email && <Field label={t('messages.f.subject')}><input value={subject} onChange={(e) => { setSubject(e.target.value); setErr(''); }} data-testid="messages-reply-subject" /></Field>}
              <Field label={t('messages.f.body')}>
                <textarea rows={email ? 6 : 3} value={body} onChange={(e) => { setBody(e.target.value); setErr(''); }} placeholder={t('messages.bodyPh', { name: conv.name })} data-testid="messages-reply-body" />
              </Field>
              {signature && <pre className="messages-sig" aria-label={t('messages.signature')}>{signature}</pre>}
              {files.length > 0 && <ul className="messages-files">{files.map((f, i) => <li key={i}><LuPaperclip aria-hidden="true" /><span>{f.name}</span><IconButton size="sm" label={t('messages.removeFile', { name: f.name })} onClick={() => setFiles(files.filter((_, k) => k !== i))}><LuX /></IconButton></li>)}</ul>}
              {marketing && <p className="small messages-approval"><Badge tone={approval === 'connected' ? 'info' : 'warn'}>{t(approval === 'connected' ? 'messages.approval.check' : 'messages.approval.pending')}</Badge> {t('messages.approval.note')}</p>}
              {err && <p className="small neg" role="alert" data-testid="messages-reply-error">{err}</p>}
              <div className="messages-cfoot">
                {email && docs.length > 0 && (
                  <select className="messages-attach" value="" aria-label={t('messages.attach')} onChange={(e) => { const f = docs[Number(e.target.value)]; if (f && !files.some((x) => x.docId === f.docId)) setFiles([...files, f]); }} data-testid="messages-attach">
                    <option value="">{t('messages.attach')}</option>
                    {docs.map((f, i) => <option key={f.docId} value={i}>{f.name}</option>)}
                  </select>
                )}
                {email && <label className="check small"><input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} /><span>{t('messages.addSignature')}</span></label>}
                <span className="grow" />
                <Button onClick={() => submit('draft')} data-testid="messages-reply-save">{t('messages.saveDraft')}</Button>
                <Button variant="primary" icon={<LuSend />} onClick={() => submit('send')} disabled={!!blocked} data-testid="messages-reply-send">{t('messages.send')}</Button>
              </div>
              <p className="xs dim">{t(live ? 'messages.sendHintLive' : 'messages.sendHintSample')}</p>
            </>
          )}
        </div>
      ))}

      {mode === 'note' && (conv.ref ? (
        <div className="stack tight">
          <Field label={t('messages.note.field')} hint={t('messages.note.hint')}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="messages-note-text" /></Field>
          <div className="row"><span className="grow" /><Button variant="primary" onClick={saveNote} disabled={!note.trim()} data-testid="messages-note-save">{t('messages.note.save')}</Button></div>
        </div>
      ) : <p className="small muted">{t('messages.needRecord')}</p>)}

      {mode === 'call' && (conv.ref ? (
        <div className="stack tight">
          <p className="small muted messages-callhint">
            {phone && <a className="btn sm" href={`tel:${phone.replace(/[^0-9+]/g, '')}`}><LuPhone aria-hidden="true" />{phone}</a>}
            <span>{t('messages.call.hint')}</span>
          </p>
          <div className="messages-cgrid">
            <div className="field"><span className="label">{t('messages.call.dir')}</span><Seg label={t('messages.call.dir')} value={dir} onChange={setDir} options={[{ value: 'out', label: t('messages.call.out') }, { value: 'in', label: t('messages.call.in') }]} /></div>
            <Field label={t('messages.call.minutes')}><input type="number" min={0} step={1} inputMode="numeric" value={minutes} onChange={(e) => { setMinutes(e.target.value); setErr(''); }} data-testid="messages-call-minutes" /></Field>
          </div>
          <Field label={t('messages.call.notes')}><textarea rows={3} value={callText} onChange={(e) => setCallText(e.target.value)} data-testid="messages-call-text" /></Field>
          {err && <p className="small neg" role="alert">{err}</p>}
          <div className="row"><span className="grow" /><Button variant="primary" onClick={saveCall} data-testid="messages-call-save">{t('messages.call.save')}</Button></div>
        </div>
      ) : <p className="small muted">{t('messages.needRecord')}</p>)}
    </div>
  );
}

/** Says, for the channel picked, where it reaches the person, what they agreed to, and why it cannot be used when it cannot. */
function ChannelNote({ conv, state, blocked, onConsent }: { conv: Conversation; state: ChannelState; blocked: ChannelState['blocked']; onConsent: (ch: 'text' | 'whatsapp' | 'email', agreed: boolean) => void }) {
  const { t, can, data, pack } = useApp();
  const ch = state.channel;
  const asks = ch === 'text' || ch === 'whatsapp';
  const label = t('messages.ch.' + ch);
  if (blocked === 'no_address') return <p className="note warn small" data-testid="messages-blocked">{t('messages.no.no_address')} {conv.ref && <A to={refPath(conv.ref)}>{t('messages.openRecord')}</A>}</p>;
  if (blocked === 'not_connected') return <p className="note warn small" data-testid="messages-blocked">{t('messages.no.not_connected', { channel: label })} {can('integrations') && moduleOn(data, pack, 'integrations') && <A to="/integrations">{t('nav.integrations')}</A>}</p>;
  if (asks) {
    const c = state.consent;
    return (
      <p className={cx('note small', c !== 'yes' && 'warn')} data-testid={c === 'yes' ? 'messages-consent' : 'messages-blocked'}>
        {t(c === 'yes' ? 'messages.consent.yes' : c === 'no' ? 'messages.consent.no' : 'messages.consent.unknown', { channel: label })}{' '}
        {conv.ref ? <button type="button" className="linkbtn" onClick={() => onConsent(ch, c !== 'yes')} data-testid="messages-consent-btn">{t(c === 'yes' ? 'messages.consent.recordOff' : 'messages.consent.record')}</button> : t('messages.needRecordShort')}
      </p>
    );
  }
  if (ch === 'email' && conv.client?.emailOptOut) return <p className="note small" data-testid="messages-optout">{t('messages.optOut')} <button type="button" className="linkbtn" onClick={() => onConsent('email', true)}>{t('messages.consent.emailBack')}</button></p>;
  if (blocked) return <p className="note warn small" data-testid="messages-blocked">{t(refusalKey(blocked, ch))}</p>;
  return null;
}

/* ---------- a lead from someone who wrote in ---------- */
function LeadFromConversation({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const { t, data, pack } = useApp();
  const sources = sourcesOf(data, pack);
  const last = conv.channels[0];
  const guess = sources.find((s) => s.id === (last === 'text' || last === 'call' ? 'phone' : last))?.id ?? sources.find((s) => s.id === 'other')?.id ?? sources[0]?.id ?? '';
  const loose = conv.address ?? '';
  const c = conv.client;
  return (
    <FormModal title={t('messages.lead.title')} saveLabel={t('messages.lead.save')} cancelLabel={t('common.cancel')} requiredMsg={t('common.required')} onClose={onClose}
      fields={[
        { k: 'name', label: t('common.name'), req: true },
        { k: 'phone', label: t('common.phone'), type: 'tel' },
        { k: 'email', label: t('common.email'), type: 'email' },
        { k: 'type', label: t('messages.lead.service'), type: 'select', options: pack.serviceTypes.map((s) => [s.id, t('ty_' + s.id)] as [string, string]) },
        { k: 'source', label: t('common.source'), type: 'select', options: sources.map((s) => [s.id, t('src_' + s.id)] as [string, string]) },
        { k: 'firstNote', label: `${t('common.notes')} (${t('common.optional')})`, type: 'textarea' },
      ]}
      initial={{ name: c?.name ?? '', phone: c?.phone ?? (loose.includes('@') ? '' : loose), email: c?.email ?? (loose.includes('@') ? loose : ''), type: pack.serviceTypes[0]?.id, source: guess }}
      validate={(v) => (!v.phone && !v.email ? t('messages.lead.needContact') : null)}
      onSave={(v) => {
        const lead = act(createLead, { name: v.name, phone: v.phone, email: v.email, address: c?.addresses[0] ?? '', type: v.type, source: v.source, pri: 'medium', value: null, firstNote: v.firstNote || undefined, ...(c?.company ? { company: c.company } : {}) });
        toast(t('messages.lead.created'));
        // someone who was not on file is now this lead, and the conversation with it
        if (!conv.ref) go(`/messages?c=l_${lead.id}`);
      }} />
  );
}
