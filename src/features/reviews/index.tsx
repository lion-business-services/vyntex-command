// Review requests: who was asked, what state each request is in, what clients answered, and how requests work for this
// company (the delay and the public review link). Every figure is computed from the requests on record; with none, the
// screen says so instead of showing a number. The rules about who may be asked live in src/domain/actions/reviews.ts.
import { useMemo, useState } from 'react';
import { LuCopy, LuExternalLink, LuListChecks, LuMail, LuSend, LuStar, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, Link, SAMPLE_BASE } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, Note, PageHeader, Seg, Stat, confirmDialog, cx, toast, type Tone } from '@/ui';
import { CanWrite, DemoTag } from '@/app/shared';
import type { MessageChannel } from '@/domain/types';
import { moduleOn } from '@/domain/config';
import { visibleClients } from '@/domain/access';
import { effectiveRules, isRuleOn, shippedRule } from '@/domain/rules/engine';
import { ruleTitle } from '@/features/automations/format';
import {
  LOW_RATING, askProblem, askableJobs, deleteReview, requestReview, reviewLink, reviewSettings, reviewState, reviewStats, saveReviewSettings, sendReview, validPublicUrl,
  type ReviewRecord, type ReviewState,
} from '@/domain/actions/reviews';
import './reviews.css';

const TONE: Record<ReviewState, Tone> = { draft: 'neutral', queued: 'info', demo: 'accent', sent: 'info', opened: 'violet', rated: 'ok', declined: 'neutral', expired: 'warn' };
const CHANNELS: MessageChannel[] = ['email', 'text', 'whatsapp'];
type Filter = 'all' | 'open' | 'rated';

/** Five stars, as many filled as the rating. Read aloud as "4 of 5". */
export function Stars({ rating, label }: { rating: number; label: string }) {
  return <span className="reviews-stars" role="img" aria-label={label}>{[1, 2, 3, 4, 5].map((n) => <LuStar key={n} aria-hidden="true" className={n <= rating ? 'on' : undefined} />)}</span>;
}

export default function ReviewsPage(_props: PageProps) {
  const app = useApp();
  const { t, data, pack, can, user, perms, live, date, dateTime } = app;
  const [asking, setAsking] = useState(false);
  const [reading, setReading] = useState<ReviewRecord | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const write = can('write');

  const all = (data.reviews ?? []) as ReviewRecord[];
  // a request about a client the viewer may not see is not shown, the same as everywhere else
  const mine = useMemo(() => { const ids = new Set(visibleClients(data, user, perms).map((c) => c.id)); return all.filter((r) => ids.has(r.clientId)); }, [all, data, user, perms]);
  const stats = useMemo(() => reviewStats({ reviews: mine, messages: data.messages }), [mine, data.messages]);
  const settings = reviewSettings(data);
  const rows = mine.map((r) => ({ r, state: reviewState(data, r), client: data.clients.find((c) => c.id === r.clientId), job: r.jobId ? data.jobs.find((j) => j.id === r.jobId) : undefined }))
    .sort((a, b) => b.r.at.localeCompare(a.r.at));
  const shown = rows.filter((x) => filter === 'all' || (filter === 'rated' ? x.state === 'rated' : x.state !== 'rated' && x.state !== 'declined' && x.state !== 'expired'));
  const send = (r: ReviewRecord, name: string) => {
    const out = act(sendReview, r.id);
    if (!out.ok) { toast(t('reviews.problem.' + out.reason), true); return; }
    toast(t(out.review.status === 'demo' ? 'reviews.sentSample' : 'reviews.sent', { name }));
  };
  const remove = async (r: ReviewRecord) => {
    if (!(await confirmDialog(t('reviews.deleteAsk'), t('common.delete'), t('common.cancel')))) return;
    if (act(deleteReview, r.id)) toast(t('reviews.deleted'));
  };
  const copy = async (r: ReviewRecord) => { try { await navigator.clipboard.writeText(reviewLink(r)); toast(t('reviews.linkCopied')); } catch { toast(reviewLink(r)); } };
  const message = (r: ReviewRecord) => (r.messageId ? data.messages.find((m) => m.id === r.messageId) : undefined);

  return (
    <div className="reviews">
      <PageHeader title={t('nav.reviews')} sub={t('reviews.sub')} actions={<CanWrite><Button variant="primary" icon={<LuStar aria-hidden="true" />} onClick={() => setAsking(true)} data-testid="reviews-ask">{t('reviews.ask')}</Button></CanWrite>} />

      {!mine.length ? (
        <Card><Empty title={t('reviews.empty.title')} action={write ? <Button onClick={() => setAsking(true)}>{t('reviews.ask')}</Button> : undefined}>{t('reviews.empty.text')}</Empty></Card>
      ) : (
        <>
          <div className="kpis reviews-kpis" data-testid="reviews-kpis">
            <Stat label={t('reviews.kpi.total')} value={stats.total} testId="reviews-kpi-total" />
            <Stat label={t('reviews.kpi.waiting')} value={stats.waiting} testId="reviews-kpi-waiting" />
            <Stat label={t('reviews.kpi.rated')} value={stats.rated} testId="reviews-kpi-rated" />
            {stats.average === null
              ? <Stat label={t('reviews.kpi.average')} value={<span className="reviews-none">{t('reviews.noRatings')}</span>} hint={t('reviews.noRatingsHint')} testId="reviews-kpi-average" />
              : <Stat label={t('reviews.kpi.average')} value={<>{stats.average.toFixed(1)} <Stars rating={Math.round(stats.average)} label={t('reviews.of5', { n: stats.average.toFixed(1) })} /></>} hint={t(stats.rated === 1 ? 'reviews.kpi.averageHint.one' : 'reviews.kpi.averageHint', { n: stats.rated })} testId="reviews-kpi-average" />}
          </div>

          <div className="reviews-grid">
            <Card flush className="reviews-list">
              <div className="filters reviews-filters">
                <Seg label={t('reviews.filter.label')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('reviews.filter.all'), count: rows.length }, { value: 'open', label: t('reviews.filter.open') }, { value: 'rated', label: t('reviews.filter.rated'), count: stats.rated }]} />
                {!live && <DemoTag />}
              </div>
              {!shown.length ? <Empty title={t('reviews.none')} action={<button type="button" className="btn" onClick={() => setFilter('all')}>{t('common.clearFilters')}</button>} /> : (
                <div className="table-wrap">
                  <table className="tbl stackable reviews-tbl" data-testid="reviews-table">
                    <thead><tr><th>{t('reviews.col.client')}</th><th>{t('reviews.col.job')}</th><th>{t('reviews.col.when')}</th><th>{t('reviews.col.state')}</th><th>{t('reviews.col.rating')}</th><th><span className="sr">{t('common.actions')}</span></th></tr></thead>
                    <tbody>
                      {shown.map(({ r, state, client, job }) => {
                        const name = client?.name ?? t('reviews.gone');
                        const by = r.by === 'automation' ? t('reviews.by.auto') : data.users.find((u) => u.id === r.by)?.name;
                        const task = r.taskId ? data.tasks.find((x) => x.id === r.taskId) : undefined;
                        return (
                          <tr key={r.id} data-state={state} data-testid={`reviews-row-${r.id}`}>
                            <td className="t1">{client ? <A to={`/clients/${client.id}`}>{name}</A> : <span className="muted">{name}</span>}{client?.company && <span className="xs dim reviews-sub">{client.company}</span>}</td>
                            <td data-label={t('reviews.col.job')}><div className="reviews-cell">{job ? <A to={`/jobs/${job.id}`}>{job.name}</A> : <span className="muted">{r.jobId ? t('reviews.gone') : t('reviews.noJob')}</span>}{job?.period && <span className="xs dim reviews-sub">{job.period}</span>}</div></td>
                            <td data-label={t('reviews.col.when')} className="small"><div className="reviews-cell">{dateTime(r.at)}<span className="xs dim reviews-sub">{t('auto.ch.' + r.channel)}{by ? ` · ${r.by === 'automation' ? by : t('reviews.by.person', { name: by })}` : ''}</span></div></td>
                            <td data-label={t('reviews.col.state')}><div className="reviews-cell">
                              <Badge tone={TONE[state]} title={state === 'demo' ? t('reviews.state.demoHint') : state === 'draft' ? t('reviews.state.draftHint') : undefined}>{t('reviews.state.' + state)}</Badge>
                              {state === 'demo' && <span className="xs dim reviews-sub">{t('reviews.state.demoHint')}</span>}
                            </div></td>
                            <td data-label={typeof r.rating === 'number' || state === 'draft' ? t('reviews.col.rating') : undefined} className="reviews-answer">
                              {typeof r.rating === 'number' ? (
                                <div className="reviews-cell">
                                  <span className={cx('reviews-rate', r.rating <= LOW_RATING && 'low')}><Stars rating={r.rating} label={t('reviews.of5', { n: r.rating })} /><b>{t('reviews.of5', { n: r.rating })}</b></span>
                                  <p className="small">{r.comment ? `“${r.comment}”` : <span className="muted">{t('reviews.noComment')}</span>}</p>
                                  {task && can('tasks') && <A to={`/tasks?task=${task.id}`} className="small reviews-link"><LuListChecks aria-hidden="true" />{t('reviews.followUp')}</A>}
                                </div>
                              ) : state === 'draft' ? <span className="muted small">{t('reviews.state.draftHint')}</span> : null}
                            </td>
                            <td className="reviews-actions">
                              {state === 'draft' && write && <Button size="sm" variant="primary" icon={<LuSend aria-hidden="true" />} onClick={() => send(r, name)} data-testid={`reviews-send-${r.id}`}>{t(live ? 'reviews.send' : 'reviews.sendSample')}</Button>}
                              {message(r) && <IconButton size="sm" label={`${t('reviews.message')}: ${name}`} onClick={() => setReading(r)} data-testid={`reviews-read-${r.id}`}><LuMail /></IconButton>}
                              {!live && SAMPLE_BASE && r.token && <Link to={`/review/${r.token}`} className="iconbtn sm" aria-label={`${t('reviews.clientView')}: ${name}`} title={t('reviews.clientView')} data-testid={`reviews-view-${r.id}`}><LuExternalLink aria-hidden="true" /></Link>}
                              {live && r.token && state !== 'rated' && state !== 'declined' && <IconButton size="sm" label={`${t('reviews.copyLink')}: ${name}`} onClick={() => void copy(r)}><LuCopy /></IconButton>}
                              {state === 'draft' && write && <IconButton size="sm" label={`${t('reviews.delete')}: ${name}`} onClick={() => void remove(r)} data-testid={`reviews-delete-${r.id}`}><LuTrash2 /></IconButton>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <aside className="reviews-side">
              {stats.rated > 0 && (
                <Card title={t('reviews.breakdown')}>
                  <ul className="reviews-bars" data-testid="reviews-breakdown">
                    {[5, 4, 3, 2, 1].map((n) => { const c = stats.counts[n - 1]; return (
                      <li key={n} aria-label={t('reviews.breakdown.row', { n, count: c })}><span className="small">{n}</span><LuStar aria-hidden="true" /><span className="reviews-bar"><i style={{ transform: `scaleX(${stats.rated ? c / stats.rated : 0})` }} /></span><span className="small num">{c}</span></li>
                    ); })}
                  </ul>
                </Card>
              )}
              <Settings key={`${settings.delayDays}|${settings.publicUrl}`} />
            </aside>
          </div>
        </>
      )}
      {!mine.length && <div className="reviews-solo"><Settings key={`${settings.delayDays}|${settings.publicUrl}`} /></div>}

      {asking && <AskModal onClose={() => setAsking(false)} />}
      {reading && message(reading) && (
        <Modal title={message(reading)!.subject || t('reviews.message')} onClose={() => setReading(null)} labelClose={t('common.close')}
          footer={<>{can('comms') && moduleOn(data, pack, 'messages') && <A to="/messages" className="btn ghost">{t('auto.messages')}</A>}<Button onClick={() => setReading(null)}>{t('common.close')}</Button></>}>
          <p className="xs muted">{t('auto.ch.' + message(reading)!.channel)} · {message(reading)!.to} · {date(message(reading)!.at.slice(0, 10))}</p>
          <p className="reviews-msg">{message(reading)!.body}</p>
        </Modal>
      )}
    </div>
  );
}

/** The delay, the public review link, the state of the automatic rule, and the rules that are never switched off. */
function Settings() {
  const { t, data, pack, lang, can } = useApp();
  const settings = reviewSettings(data);
  const write = can('write');
  const rule = effectiveRules(data, pack).find((x) => x.when.event === 'review.due' && x.then.some((s) => s.do === 'review'));
  const [delay, setDelay] = useState(String(settings.delayDays));
  const [url, setUrl] = useState(settings.publicUrl);
  const [bad, setBad] = useState(false);
  const editable = write && can('config');
  const save = () => {
    const clean = url.trim();
    if (clean && !validPublicUrl(clean)) { setBad(true); return; }
    act(saveReviewSettings, { delayDays: Math.max(0, Math.min(90, Math.round(Number(delay) || 0))), publicUrl: clean });
    toast(t('reviews.set.saved'));
  };
  return (
    <Card title={t('reviews.settings')} className="reviews-settings">
      {editable ? (
        <div className="stack">
          <Field label={t('reviews.set.delay')} htmlFor="reviews-delay" hint={t('reviews.set.delayHint')}><input id="reviews-delay" type="number" min={0} max={90} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} data-testid="reviews-delay" /></Field>
          <Field label={t('reviews.set.public')} htmlFor="reviews-url" hint={bad ? t('reviews.set.publicBad') : t('reviews.set.publicHint')} error={bad}><input id="reviews-url" type="url" inputMode="url" value={url} placeholder={t('reviews.set.publicPh')} onChange={(e) => { setUrl(e.target.value); setBad(false); }} data-testid="reviews-url" /></Field>
          <div className="row"><Button onClick={save} data-testid="reviews-save">{t('reviews.set.save')}</Button></div>
        </div>
      ) : (
        <div className="stack reviews-read">
          <p><span className="label">{t('reviews.set.delay')}</span><b>{settings.delayDays}</b></p>
          <p><span className="label">{t('reviews.set.public')}</span><span className="reviews-url">{settings.publicUrl || <span className="muted">{t('reviews.set.notSet')}</span>}</span></p>
        </div>
      )}
      {rule && (
        <p className="small reviews-rule" data-testid="reviews-rule" data-on={isRuleOn(data, rule)}>
          {t(isRuleOn(data, rule) ? 'reviews.set.rule.on' : 'reviews.set.rule.off', { name: ruleTitle(rule, shippedRule(pack, rule.id), t, lang) })}
          {can('automations') && <> <A to={`/automations/rule/${rule.id}`} className="reviews-link">{t('reviews.set.rule.open')}</A></>}
        </p>
      )}
      <Note>
        <b className="small">{t('reviews.rules.title')}</b>
        <ul className="reviews-rules">{[1, 2, 3, 4].map((n) => <li key={n}>{t('reviews.rules.' + n)}</li>)}</ul>
      </Note>
    </Card>
  );
}

/** Pick the client, the work and the channel. The reason someone cannot be asked is said before the button, not after. */
function AskModal({ onClose }: { onClose: () => void }) {
  const { t, data, user, perms } = useApp();
  const clients = useMemo(() => visibleClients(data, user, perms).filter((c) => askableJobs(data, c.id).length > 0).sort((a, b) => a.name.localeCompare(b.name)), []);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const jobs = clientId ? askableJobs(data, clientId) : [];
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '');
  const [channel, setChannel] = useState<MessageChannel>('email');
  const job = jobs.find((j) => j.id === jobId) ?? jobs[0];
  const problem = clientId && job ? askProblem(data, { clientId, jobId: job.id, channel }) : null;
  const prepare = () => {
    if (!clientId || !job || problem) return;
    const out = act(requestReview, { clientId, jobId: job.id, channel });
    const name = data.clients.find((c) => c.id === clientId)?.name ?? '';
    if (!out.ok) { toast(t('reviews.problem.' + out.reason), true); return; }
    toast(out.noMessage ? t('reviews.preparedNoMsg', { name, why: t('reviews.problem.' + out.noMessage) }) : t('reviews.prepared', { name }));
    onClose();
  };
  return (
    <Modal title={t('reviews.form.title')} onClose={onClose} labelClose={t('common.close')} size="narrow"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={prepare} disabled={!clientId || !job || !!problem} data-testid="reviews-prepare">{t('reviews.form.prepare')}</Button></>}>
      {!clients.length ? <p className="muted">{t('reviews.form.noClients')}</p> : (
        <div className="stack">
          <Field label={t('reviews.form.client')} htmlFor="reviews-f-client">
            <select id="reviews-f-client" value={clientId} onChange={(e) => { setClientId(e.target.value); setJobId(askableJobs(data, e.target.value)[0]?.id ?? ''); }} data-testid="reviews-f-client">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company ? `${c.name} · ${c.company}` : c.name}</option>)}
            </select>
          </Field>
          <Field label={t('reviews.form.job')} htmlFor="reviews-f-job">
            <select id="reviews-f-job" value={job?.id ?? ''} onChange={(e) => setJobId(e.target.value)} data-testid="reviews-f-job">
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.period ? `${j.name} · ${j.period}` : j.name}</option>)}
            </select>
          </Field>
          <Field label={t('reviews.form.channel')} htmlFor="reviews-f-channel">
            <select id="reviews-f-channel" value={channel} onChange={(e) => setChannel(e.target.value as MessageChannel)} data-testid="reviews-f-channel">
              {CHANNELS.map((c) => <option key={c} value={c}>{t('auto.ch.' + c)}</option>)}
            </select>
          </Field>
          {problem ? <p className="small neg" role="alert" data-testid="reviews-f-problem">{t('reviews.problem.' + problem)}</p> : <p className="small muted">{t('reviews.form.note')}</p>}
        </div>
      )}
    </Modal>
  );
}
