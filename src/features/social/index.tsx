// Social media: write a post once for the networks the company uses, have it approved, put it on the calendar or publish
// it, and see what went out and what failed. The networks are a list with their own rules (src/domain/actions/social.ts),
// so another one is an entry there, not another screen.
// Honest states: a sample workspace has no connected account, so "publish" marks the post as a sample and nothing is
// posted anywhere; in a live workspace a network can only be picked once its account is connected, and "published" or
// "not published" is what the server recorded from the network's answer.
import { useMemo, useState } from 'react';
import { LuCalendarClock, LuCalendarDays, LuCheck, LuChevronLeft, LuChevronRight, LuHistory, LuList, LuPencil, LuPlus, LuRotateCcw, LuSend, LuStar, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, IconButton, PageHeader, Seg, confirmDialog, cx, toast } from '@/ui';
import { CanWrite } from '@/app/shared';
import { actorName } from '@/domain/selectors';
import { moduleOn } from '@/domain/config';
import { approvePost, deletePost, publishPost, retryPost, submitPost, unschedulePost } from '@/domain/actions';
import { SOCIAL_CHANNELS, canApprovePosts, type PostResult } from '@/domain/actions/social';
import type { SocialPost } from '@/domain/types';
import { fmtDate, toISODate, today } from '@/lib/dates';
import { Composer, toLocalInput } from './Composer';
import { ChannelMark, PostStatus, isConnected, problemText, useFileUrl } from './parts';
import './social.css';

type View = 'queue' | 'calendar' | 'history' | 'reviews';
const QUEUE: SocialPost['status'][] = ['failed', 'needs_approval', 'draft', 'scheduled'];

export default function SocialPage(_props: PageProps) {
  const { t, data, pack, can, live, user } = useApp();
  const [view, setView] = useState<View>('queue');
  const [editing, setEditing] = useState<{ post?: SocialPost; when?: string } | null>(null);
  const write = can('write');
  const approver = !!user && canApprovePosts(data, { pack }, user.id);
  const integrations = can('integrations') && moduleOn(data, pack, 'integrations');
  const queue = data.posts.filter((p) => QUEUE.includes(p.status));
  const history = data.posts.filter((p) => p.status === 'demo' || p.status === 'published').sort((a, b) => (b.publishedAt ?? b.created).localeCompare(a.publishedAt ?? a.created));
  const waiting = queue.filter((p) => p.status === 'needs_approval').length;

  const roles = { owner: t('role.owner'), manager: t('role.manager') };
  const done = (out: PostResult, said: string) => toast(out.ok ? t(said) : out.reason === 'invalid' && out.problems?.length ? problemText(t, out.problems[0]) : t('social.err.' + out.reason, roles), !out.ok);
  const actions = {
    edit: (p: SocialPost) => setEditing({ post: p }),
    submit: (p: SocialPost) => done(act(submitPost, p.id), 'social.submitted'),
    approve: (p: SocialPost) => done(act(approvePost, p.id), 'social.approvedToast'),
    publish: async (p: SocialPost) => { if (await confirmDialog(t(live ? 'social.publishAsk' : 'social.publishAskSample'), t('social.publishNow'), t('common.cancel'), false)) done(act(publishPost, p.id), live ? 'social.queued' : 'social.sampleDone'); },
    unschedule: (p: SocialPost) => done(act(unschedulePost, p.id), 'social.unscheduled'),
    retry: (p: SocialPost) => done(act(retryPost, p.id), live ? 'social.queued' : 'social.sampleDone'),
    remove: async (p: SocialPost) => { if (await confirmDialog(t('social.deleteAsk'), t('common.delete'), t('common.cancel'))) { act(deletePost, p.id); toast(t('common.deleted')); } },
  };

  return (
    <>
      <PageHeader title={t('nav.social')} sub={t('social.sub')} actions={<CanWrite><Button variant="primary" icon={<LuPlus />} onClick={() => setEditing({})} data-testid="social-new">{t('social.new')}</Button></CanWrite>} />

      <div className="social-accounts" data-testid="social-accounts">
        {SOCIAL_CHANNELS.map((c) => {
          const on = isConnected(data, c.id); const account = data.connections.find((x) => x.id === c.provider && x.state === 'connected')?.account;
          return (
            <div key={c.id} className="social-account" data-channel={c.id}>
              <ChannelMark id={c.id} />
              {on ? <Badge tone="ok">{account || t('social.connected')}</Badge> : <Badge outline>{t('social.connectFirst')}</Badge>}
            </div>
          );
        })}
        <p className="small muted grow">{t(live ? 'social.accountsLive' : 'social.accountsSample')} {integrations && <A to="/integrations">{t('nav.integrations')}</A>}</p>
      </div>

      <div className="social-bar">
        <Seg label={t('social.views')} value={view} onChange={setView} options={[
          { value: 'queue', label: <><LuList aria-hidden="true" />{t('social.view.queue')}</>, count: waiting || undefined },
          { value: 'calendar', label: <><LuCalendarDays aria-hidden="true" />{t('social.view.calendar')}</> },
          { value: 'history', label: <><LuHistory aria-hidden="true" />{t('social.view.history')}</> },
          { value: 'reviews', label: <><LuStar aria-hidden="true" />{t('social.view.reviews')}</> },
        ]} />
      </div>

      {view === 'queue' && (!data.posts.length ? (
        <Card><Empty title={t('social.empty')} action={<CanWrite><Button variant="primary" icon={<LuPlus />} onClick={() => setEditing({})}>{t('social.new')}</Button></CanWrite>}>{t('social.emptyHint')}</Empty></Card>
      ) : !queue.length ? (
        <Card><Empty title={t('social.queueEmpty')} action={<Button onClick={() => setView('history')}>{t('social.view.history')}</Button>}>{t('social.queueEmptyHint')}</Empty></Card>
      ) : (
        <div className="social-queue" data-testid="social-queue">
          {QUEUE.map((status) => {
            const list = queue.filter((p) => p.status === status).sort((a, b) => (status === 'scheduled' ? (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? '') : b.created.localeCompare(a.created)));
            if (!list.length) return null;
            return (
              <section key={status} aria-label={t('social.group.' + status)} className="social-col">
                <h2 className="social-gh">{t('social.group.' + status)} <span className="count">{list.length}</span></h2>
                <div className="social-stack">{list.map((p) => <PostCard key={p.id} post={p} approver={approver} write={write} on={actions} />)}</div>
              </section>
            );
          })}
        </div>
      ))}

      {view === 'calendar' && <Calendar posts={data.posts} onOpen={(p) => (write ? setEditing({ post: p }) : undefined)} onDay={write ? (when) => setEditing({ when }) : undefined} />}

      {view === 'history' && (!history.length ? (
        <Card><Empty title={t('social.historyEmpty')}>{t(live ? 'social.historyEmptyHint' : 'social.historyEmptySample')}</Empty></Card>
      ) : (
        <div className="social-posts" data-testid="social-history">{history.map((p) => <PostCard key={p.id} post={p} approver={approver} write={write} on={actions} />)}</div>
      ))}

      {view === 'reviews' && (
        // Reviews people leave on the Business Profile reach this screen only through the connected account. This build has
        // no such records to show, in either kind of workspace, so it says what is missing instead of listing made-up ones.
        <Card><Empty title={t('social.reviews.empty')}>{t(isConnected(data, 'gbp') ? 'social.reviews.none' : live ? 'social.reviews.connect' : 'social.reviews.sample')}</Empty></Card>
      )}

      {editing && <Composer key={editing.post?.id ?? 'new'} post={editing.post} when={editing.when} onClose={() => setEditing(null)} />}
    </>
  );
}

type Actions = Record<'edit' | 'submit' | 'approve' | 'publish' | 'unschedule' | 'retry' | 'remove', (p: SocialPost) => void>;

function PostCard({ post: p, approver, write, on }: { post: SocialPost; approver: boolean; write: boolean; on: Actions }) {
  const { t, data, dateTime, can } = useApp();
  const img = useFileUrl(p.media?.[0]);
  const open = p.status !== 'demo' && p.status !== 'published';
  return (
    <article className="card social-post" data-status={p.status} data-testid="social-post">
      <header className="row between">
        <span className="row tight"><PostStatus post={p} /></span>
        <span className="row tight nowrap">
          {write && open && <IconButton size="sm" label={t('common.edit')} onClick={() => on.edit(p)} data-testid="social-edit"><LuPencil /></IconButton>}
          {write && open && can('delete') && <IconButton size="sm" label={t('common.delete')} onClick={() => on.remove(p)}><LuTrash2 /></IconButton>}
        </span>
      </header>
      <div className="social-pmain">
        {img && <img className="social-thumb lg" src={img} alt="" />}
        <p className="social-text">{p.text}</p>
      </div>
      {p.status === 'failed' && p.error && <p className="small neg" data-testid="social-failed">{p.error}</p>}
      <p className="xs dim social-meta">
        <span className="social-chs">{p.channels.map((c) => <ChannelMark key={c} id={c} short />)}</span>
        {p.status === 'scheduled' && p.scheduledFor ? `${t('social.goesOut', { date: dateTime(p.scheduledFor) })} · ` : ''}
        {(p.status === 'demo' || p.status === 'published') && p.publishedAt ? `${t(p.status === 'demo' ? 'social.sampleAt' : 'social.publishedAt', { date: dateTime(p.publishedAt) })} · ` : ''}
        {t('social.by', { name: actorName(data, p.by) ?? '' })}{p.approvedBy && p.approvedBy !== p.by ? ` · ${t('social.approvedBy', { name: actorName(data, p.approvedBy) ?? '' })}` : ''}
      </p>
      {write && open && (
        <div className="social-actions">
          {p.status === 'failed' && approver && <Button size="sm" variant="primary" icon={<LuRotateCcw />} onClick={() => on.retry(p)} data-testid="social-retry">{t('social.retry')}</Button>}
          {p.status === 'needs_approval' && approver && <Button size="sm" variant="primary" icon={<LuCheck />} onClick={() => on.approve(p)} data-testid="social-approve">{t('social.approve')}</Button>}
          {p.status === 'draft' && !approver && <Button size="sm" variant="primary" onClick={() => on.submit(p)} data-testid="social-submit-row">{t('social.submit')}</Button>}
          {p.status === 'draft' && approver && <Button size="sm" icon={<LuCalendarClock />} onClick={() => on.edit(p)}>{t('social.schedule')}</Button>}
          {(p.status === 'draft' || p.status === 'scheduled') && approver && <Button size="sm" icon={<LuSend />} onClick={() => on.publish(p)} data-testid="social-publish-row">{t('social.publishNow')}</Button>}
          {p.status === 'scheduled' && approver && <Button size="sm" variant="ghost" onClick={() => on.unschedule(p)}>{t('social.unschedule')}</Button>}
          {p.status === 'needs_approval' && !approver && <span className="small muted">{t('social.waitingFor', { owner: t('role.owner'), manager: t('role.manager') })}</span>}
        </div>
      )}
    </article>
  );
}

/* ---------- the content calendar: a month, with what is scheduled and what went out on each day ---------- */
function Calendar({ posts, onOpen, onDay }: { posts: SocialPost[]; onOpen: (p: SocialPost) => void; onDay?: (when: string) => void }) {
  const { t, lang, time } = useApp();
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const byDay = useMemo(() => {
    const m = new Map<string, SocialPost[]>();
    for (const p of posts) {
      const at = p.status === 'scheduled' || p.status === 'failed' ? p.scheduledFor : p.status === 'demo' || p.status === 'published' ? p.publishedAt : undefined;
      if (!at) continue;
      const k = toISODate(new Date(at)); m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1); const count = new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [...Array.from({ length: first.getDay() }, () => null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const move = (n: number) => { const d = new Date(y, mo - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const hhmm = (iso: string | undefined) => { if (!iso) return ''; const d = new Date(iso); return time(`${d.getHours()}:${d.getMinutes()}`); };
  const month1 = first.toLocaleDateString(lang === 'es' ? 'es-US' : lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', year: 'numeric' });
  const title = month1.charAt(0).toUpperCase() + month1.slice(1);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(lang === 'es' ? 'es-US' : lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' }));
  const inMonth = [...byDay.entries()].filter(([k]) => k.startsWith(month)).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Card className="social-cal" >
      <div className="row between social-calh">
        <h2 className="social-month">{title}</h2>
        <div className="row tight">
          <IconButton label={t('common.previous')} onClick={() => move(-1)} data-testid="social-cal-prev"><LuChevronLeft /></IconButton>
          <Button size="sm" onClick={() => setMonth(today().slice(0, 7))}>{t('common.today')}</Button>
          <IconButton label={t('common.next')} onClick={() => move(1)} data-testid="social-cal-next"><LuChevronRight /></IconButton>
        </div>
      </div>
      <div className="social-grid" role="grid" aria-label={title} data-testid="social-calendar">
        {weekdays.map((w) => <div key={w} className="social-wd" role="columnheader">{w}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={'x' + i} className="social-cell blank" />;
          const list = byDay.get(day) ?? []; const past = day < today();
          return (
            <div key={day} className={cx('social-cell', day === today() && 'today', past && 'past')} role="gridcell" data-day={day}>
              <div className="social-dn">
                <span>{Number(day.slice(8))}</span>
                {onDay && !past && <button type="button" className="social-add" onClick={() => onDay(`${day}T09:00`)} aria-label={t('social.newOn', { date: fmtDate(day, lang) })}><LuPlus aria-hidden="true" /></button>}
              </div>
              {list.map((p) => (
                <button key={p.id} type="button" className="social-chip" data-status={p.status} onClick={() => onOpen(p)} title={p.text}>
                  <span className="xs nowrap">{hhmm(p.scheduledFor ?? p.publishedAt)}</span><span className="clip">{p.text}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {/* phones: the same month as a list, since seven columns do not fit */}
      <div className="social-agenda" data-testid="social-agenda">
        {!inMonth.length ? <p className="small muted">{t('social.calEmpty')}</p> : inMonth.map(([day, list]) => (
          <div key={day} className="social-aday">
            <div className="xs strong dim">{fmtDate(day, lang, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            {list.map((p) => <button key={p.id} type="button" className="social-chip" data-status={p.status} onClick={() => onOpen(p)}><span className="xs nowrap">{hhmm(p.scheduledFor ?? p.publishedAt)}</span><span className="clip">{p.text}</span></button>)}
          </div>
        ))}
        {onDay && <Button size="sm" icon={<LuPlus />} onClick={() => onDay(toLocalInput(new Date(Date.now() + 86400000).toISOString()))}>{t('social.new')}</Button>}
      </div>
      <p className="xs dim social-legend"><span className="social-dot" data-status="scheduled" />{t('social.status.scheduled')}<span className="social-dot" data-status="demo" />{t('social.legend.out')}<span className="social-dot" data-status="failed" />{t('social.status.failed')}</p>
    </Card>
  );
}
