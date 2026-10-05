// The communications center: one inbox across email, text, WhatsApp, Facebook, Instagram, calls and system notices.
// On the left, one conversation per person; on the right, everything said to and by them in time order, and the place to
// answer. In a sample workspace every conversation is a sample record and nothing that is "sent" leaves the browser.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { LuBell, LuCheckCheck, LuMailPlus, LuZap } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, appPath, go, navigate, refPath, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { Avatar, Button, Card, Empty, Modal, PageHeader, SearchBox, cx } from '@/ui';
import { CanWrite } from '@/app/shared';
import { byId } from '@/domain/selectors';
import { moduleOn } from '@/domain/config';
import { visibleClients, visibleLeads } from '@/domain/access';
import { commsSettings, markRead } from '@/domain/actions/messages';
import { ctx, mutateQuiet } from '@/store/store';
import type { MessageChannel } from '@/domain/types';
import { fmtDate, fmtTime, toISODate, today } from '@/lib/dates';
import { ORDER, conversationFor, conversations, keyOfMessage, lineOf, notices, type Conversation, type Notice } from './model';
import { ChannelIcon, ReviewModal } from './parts';
import { Thread } from './Thread';

// 'notices' is not a set of conversations: it lists what the platform wrote for people in the office (see model.ts)
type View = 'open' | 'unread' | 'reply' | 'drafts' | 'done' | 'all' | 'notices';
const VIEWS: View[] = ['open', 'unread', 'reply', 'drafts', 'done', 'all'];
const PAGE = 30;
const WIDE = '(min-width: 981px)';

/** True on a screen wide enough for the list and the conversation side by side. */
function useWide(): boolean {
  return useSyncExternalStore(
    (l) => { const m = window.matchMedia(WIDE); m.addEventListener('change', l); return () => m.removeEventListener('change', l); },
    () => window.matchMedia(WIDE).matches, () => true);
}
const inView = (c: Conversation, v: View): boolean =>
  (v === 'open' ? !c.done : v === 'unread' ? c.unread > 0 : v === 'reply' ? c.needsReply : v === 'drafts' ? c.drafts > 0 : v === 'done' ? c.done : v !== 'notices');

export default function Inbox({ id }: PageProps) {
  const { t, data, pack, lang, can, user, perms, live } = useApp();
  const route = useRoute();
  const wide = useWide();
  const settings = commsSettings(data, pack);
  const all = useMemo(() => conversations(data, { user, perms }), [data, user, perms]);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState<'' | MessageChannel>('');
  const [who, setWho] = useState('');
  const [view, setView] = useState<View>('open');
  const [limit, setLimit] = useState(PAGE);
  const [picker, setPicker] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  // a message another page started: its subject and text, and the conversation they are for once that is known
  const [prefill, setPrefill] = useState<{ key: string | null; subject: string; body: string } | null>(null);

  // links from other pages: /messages?open=<message id> (the conversation, and the message itself when it waits for review)
  // and /messages?compose=1&to=<client id>&subject=..&body=.. (that client's conversation, ready to write, with the text
  // already in it; without a client the person is asked who it is for first). The older /messages?compose=<client id> still works.
  useEffect(() => {
    const o = route.query.get('open'); const c = route.query.get('compose');
    if (o === null && c === null) return;
    const m = o ? byId(data.messages, o) : undefined;
    if (m) { if (m.status === 'draft') setReview(m.id); navigate(appPath(`/messages?c=${encodeURIComponent(keyOfMessage(data, m))}`), { replace: true }); return; }
    const to = route.query.get('to') || (c && c !== '1' ? c : '');
    const text = { subject: route.query.get('subject') ?? '', body: route.query.get('body') ?? '' };
    const client = to ? visibleClients(data, user, perms).find((x) => x.id === to) : undefined;
    if (c !== null && (text.subject || text.body)) setPrefill({ key: client ? 'c_' + client.id : null, ...text });
    if (client) { navigate(appPath(`/messages?c=c_${client.id}`), { replace: true }); return; }
    if (c !== null) setPicker(true);
    navigate(appPath('/messages'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const channelsOn = ORDER.filter((c) => c !== 'system' && settings.channels[c as keyof typeof settings.channels]);
  const base = useMemo(() => {
    const s = q.trim().toLowerCase();
    const mine = who === 'me' ? user?.id : who;
    // someone with nothing but system notices is not a conversation: those are read in the Notices view
    return all.filter((c) => c.total > 0 && (!channel || c.channels.includes(channel)) && (!mine || c.assignee === mine)
      && (!s || [c.name, c.sub, c.address, c.client?.email, c.client?.phone, c.lead?.email, c.lead?.phone, lineOf(c.last)].some((v) => v && v.toLowerCase().includes(s))));
  }, [all, q, channel, who, user]);
  const rows = base.filter((c) => inView(c, view));
  const counts = Object.fromEntries(VIEWS.map((v) => [v, base.filter((c) => inView(c, v)).length])) as Record<View, number>;
  // notices: the search reads their text; "assigned to" reads who the notice was written for
  const allNotices = useMemo(() => notices(data, { user, perms }, refPath), [data, user, perms]);
  const noticeRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const name = who ? (who === 'me' ? user?.name : byId(data.users, who)?.name) ?? '' : '';
    return allNotices.filter((n) => (!name || n.message.to === name) && (!s || [n.message.body, n.about, n.message.to].some((v) => v && v.toLowerCase().includes(s))));
  }, [allNotices, q, who, user, data.users]);
  const unreadNotices = noticeRows.filter((n) => n.unread).length;
  const openNotice = (n: Notice) => { if (n.unread && can('write')) mutateQuiet((d) => markRead(d, ctx(), [n.message.id])); if (n.path) go(n.path); };
  const readNotices = () => mutateQuiet((d) => markRead(d, ctx(), noticeRows.filter((n) => n.unread).map((n) => n.message.id)));
  const filtered = !!(q || channel || who || view !== 'open');
  const clear = () => { setQ(''); setChannel(''); setWho(''); setView('open'); };

  const picked = route.query.get('c') ?? id ?? null;
  // going to another conversation leaves a started message behind; picking who it is for keeps it
  const open = (key: string, keep = false) => { setPrefill((p) => (p && keep ? { ...p, key } : null)); go(`/messages?c=${encodeURIComponent(key)}`); };
  // on a wide screen the first conversation is shown before anyone picks one; it is only looked at, not opened
  const glance = !picked && wide && view !== 'notices' ? rows[0] ?? null : null;
  // the list was already worked out above; only someone with nothing said yet needs a conversation made for them
  const conv = useMemo(() => (picked ? all.find((c) => c.key === picked) ?? conversationFor(data, { user, perms }, picked) : glance), [all, picked, glance, data, user, perms]);
  const reviewing = byId(data.messages, review ?? undefined);
  // the started message belongs to one conversation; its arrival remounts that conversation so the composer opens with it
  const started = prefill && conv && prefill.key === conv.key && picked ? prefill : undefined;
  // today: the time. This year: the day. Earlier: the day with its year.
  const time = (iso: string) => { const d = new Date(iso); const day = toISODate(d); return day === today() ? fmtTime(`${d.getHours()}:${d.getMinutes()}`, lang) : fmtDate(day, lang, day.slice(0, 4) === today().slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); };

  return (
    <>
      <PageHeader title={t('messages.title')} sub={t('messages.inboxSub')} actions={<CanWrite><Button variant="primary" icon={<LuMailPlus />} onClick={() => setPicker(true)} data-testid="messages-compose">{t('messages.newMessage')}</Button></CanWrite>} />

      {!live && (
        <p className="note small messages-sample" data-testid="messages-frame">
          <b>{t('messages.sample.title')}</b> {t('messages.sample.body')} {can('integrations') && moduleOn(data, pack, 'integrations') && <A to="/integrations">{t('messages.sample.link')}</A>}
        </p>
      )}

      <div className={cx('messages-inbox', picked && 'picked')}>
        <div className="messages-pane">
          <div className="filters messages-filters">
            <SearchBox value={q} onChange={setQ} placeholder={t('messages.search')} />
            {channelsOn.length > 1 && (
              <select value={channel} onChange={(e) => setChannel(e.target.value as '' | MessageChannel)} aria-label={t('messages.channel')} data-testid="messages-filter-channel">
                <option value="">{t('messages.allChannels')}</option>{channelsOn.map((c) => <option key={c} value={c}>{t('messages.ch.' + c)}</option>)}
              </select>
            )}
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('messages.assign')} data-testid="messages-filter-assigned">
              <option value="">{t('messages.anyone')}</option>{user && <option value="me">{t('messages.mine')}</option>}
              {data.users.filter((u) => u.active !== false && u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="seg messages-views" role="group" aria-label={t('messages.views')} data-testid="messages-filter-state">
            {VIEWS.map((v) => <button key={v} type="button" aria-pressed={view === v} data-view={v} onClick={() => { setView(v); setLimit(PAGE); }}>{t('messages.v.' + v)}{v !== 'all' && v !== 'done' && counts[v] > 0 && <span className="count">{counts[v]}</span>}</button>)}
            {(allNotices.length > 0 || view === 'notices') && <button type="button" aria-pressed={view === 'notices'} data-view="notices" onClick={() => { setView('notices'); setLimit(PAGE); }}>{t('messages.v.notices')}{unreadNotices > 0 && <span className="count">{unreadNotices}</span>}</button>}
          </div>

          {view === 'notices' ? (
            !noticeRows.length ? (
              <Card className="messages-none"><Empty title={t(allNotices.length ? 'messages.notice.noMatch' : 'messages.notice.none')} action={q || who ? <Button onClick={() => { setQ(''); setWho(''); }}>{t('common.clearFilters')}</Button> : undefined}>{t(allNotices.length ? 'messages.noMatchHint.all' : 'messages.notice.hint')}</Empty></Card>
            ) : (
              <>
                <div className="row between messages-nhead">
                  <span className="small muted">{t('messages.notice.hint')}</span>
                  {unreadNotices > 0 && <CanWrite><button type="button" className="linkbtn small nowrap" onClick={readNotices} data-testid="messages-notices-read"><LuCheckCheck aria-hidden="true" />{t('messages.notice.readAll')}</button></CanWrite>}
                </div>
                <ul className="messages-list" data-testid="messages-notices">
                  {noticeRows.slice(0, limit).map((n) => {
                    const m = n.message; const forWho = m.to.split(' ')[0];
                    return (
                      <li key={m.id}>
                        <button type="button" className={cx('messages-conv messages-notice', n.unread && 'unread')} onClick={() => openNotice(n)} data-testid="messages-notice" data-read={n.unread ? 'no' : 'yes'}>
                          <span className="messages-nico" aria-hidden="true"><LuBell /></span>
                          <span className="messages-cmain">
                            <span className="messages-ctop"><span className="messages-cname clip">{n.about || t(n.kind === 'task' ? 'messages.notice.task' : 'messages.notice.office')}</span><time className="xs dim nowrap">{time(m.at)}</time></span>
                            <span className="messages-nline">{m.body}</span>
                            <span className="messages-cmeta">
                              {n.unread && <span className="badge accent messages-tiny">{t('messages.notice.unread')}</span>}
                              {m.auto && <span className="badge violet messages-tiny messages-auto"><LuZap aria-hidden="true" />{t('messages.auto')}</span>}
                              {forWho && <span className="xs dim clip messages-cwho">{t('messages.notice.for', { name: forWho })}</span>}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {noticeRows.length > limit && <button type="button" className="linkbtn small messages-moreconv" onClick={() => setLimit((x) => x + PAGE)}>{t('messages.moreConv', { n: noticeRows.length - limit })}</button>}
              </>
            )
          ) : !all.some((c) => c.total > 0) ? (
            <Card className="messages-none"><Empty title={t('messages.empty')} action={<CanWrite><Button variant="primary" onClick={() => setPicker(true)}>{t('messages.newMessage')}</Button></CanWrite>}>{t('messages.inboxEmpty')}</Empty></Card>
          ) : !rows.length ? (
            <Card className="messages-none"><Empty title={t('messages.noMatch')} action={filtered ? <Button onClick={clear}>{t('common.clearFilters')}</Button> : undefined}>{t('messages.noMatchHint.' + view)}</Empty></Card>
          ) : (
            <ul className="messages-list" data-testid="messages-list">
              {rows.slice(0, limit).map((c) => {
                const draft = !!c.last && !('kind' in c.last) && c.last.status === 'draft';
                const mineOut = !!c.last && !('kind' in c.last) && c.last.dir !== 'in' && c.last.channel !== 'system';
                return (
                  <li key={c.key}>
                    <button type="button" className={cx('messages-conv', conv?.key === c.key && 'on', c.unread > 0 && 'unread')} onClick={() => open(c.key)} aria-current={conv?.key === c.key ? 'true' : undefined} data-testid="messages-conv" data-key={c.key}>
                      <Avatar name={c.name} size="sm" accent={c.unread > 0} />
                      <span className="messages-cmain">
                        <span className="messages-ctop"><span className="messages-cname clip">{c.name}</span><time className="xs dim nowrap">{time(c.lastAt)}</time></span>
                        <span className="messages-cline clip">{draft ? <b>{t('messages.list.draft')} </b> : mineOut ? <span className="dim">{t('messages.list.you')} </span> : null}{lineOf(c.last)}</span>
                        <span className="messages-cmeta">
                          <span className="messages-cicons">{c.channels.map((ch) => <ChannelIcon key={ch} channel={ch} />)}</span>
                          {c.unread > 0 && <span className="count" aria-label={t('messages.unreadN', { n: c.unread })}>{c.unread}</span>}
                          {c.needsReply && !c.unread && <span className="badge warn messages-tiny">{t('messages.needsReply')}</span>}
                          {c.done && <span className="badge messages-tiny">{t('messages.v.done')}</span>}
                          {!c.ref && <span className="badge outline messages-tiny">{t('messages.notOnFile')}</span>}
                          {c.assignee && <span className="xs dim clip messages-cwho">{byId(data.users, c.assignee)?.name.split(' ')[0]}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {view !== 'notices' && rows.length > limit && <button type="button" className="linkbtn small messages-moreconv" onClick={() => setLimit((n) => n + PAGE)} data-testid="messages-more">{t('messages.moreConv', { n: rows.length - limit })}</button>}
        </div>

        <div className="messages-main">
          {conv ? <Thread key={conv.key + (started ? '+' : '')} conv={conv} glance={!picked} onBack={picked ? () => go('/messages') : undefined} prefill={started} />
            : picked ? <Card><Empty title={t('messages.gone')} action={<Button onClick={() => go('/messages')}>{t('messages.backToList')}</Button>} /></Card>
              : view === 'notices' ? <Card className="messages-pick"><Empty title={t('messages.notice.title')}>{t('messages.notice.pickHint')}</Empty></Card>
                : <Card className="messages-pick"><Empty title={t('messages.pick')}>{t('messages.pickHint')}</Empty></Card>}
        </div>
      </div>

      {picker && <Picker onClose={() => setPicker(false)} onPick={(key) => { setPicker(false); open(key, true); }} />}
      {reviewing && <ReviewModal key={reviewing.id} message={reviewing} onClose={() => setReview(null)} />}
    </>
  );
}

/* ---------- who to write to ---------- */
function Picker({ onClose, onPick }: { onClose: () => void; onPick: (key: string) => void }) {
  const { t, data, user, perms } = useApp();
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const has = (...v: (string | undefined)[]) => !s || v.some((x) => x && x.toLowerCase().includes(s));
  const clients = visibleClients(data, user, perms).filter((c) => has(c.name, c.company, c.email, c.phone)).slice(0, 8);
  const leads = visibleLeads(data, user, perms).filter((l) => !l.clientId && has(l.name, l.company, l.email, l.phone)).slice(0, 6);
  return (
    <Modal title={t('messages.newMessage')} onClose={onClose} size="narrow" labelClose={t('common.close')}>
      <SearchBox value={q} onChange={setQ} placeholder={t('messages.picker.search')} />
      {!clients.length && !leads.length ? <p className="small muted" style={{ marginTop: 14 }}>{t('messages.picker.none')}</p> : (
        <div className="messages-picker">
          {clients.length > 0 && <div className="xs dim strong">{t('nav.clients')}</div>}
          {clients.map((c) => <button key={c.id} type="button" className="item click" onClick={() => onPick('c_' + c.id)} data-testid="messages-pick"><Avatar name={c.name} size="sm" /><span className="grow"><span className="t">{c.name}</span><span className="xs dim messages-pline">{c.company || c.email || c.phone}</span></span></button>)}
          {leads.length > 0 && <div className="xs dim strong">{t('nav.leads')}</div>}
          {leads.map((l) => <button key={l.id} type="button" className="item click" onClick={() => onPick('l_' + l.id)} data-testid="messages-pick"><Avatar name={l.name} size="sm" /><span className="grow"><span className="t">{l.name}</span><span className="xs dim messages-pline">{l.company || l.email || l.phone}</span></span></button>)}
        </div>
      )}
    </Modal>
  );
}
