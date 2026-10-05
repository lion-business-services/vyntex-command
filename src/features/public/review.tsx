// Where a client answers a review request (no sign-in): `/review/<token>`.
//
// The client picks a rating and may write a comment. The answer goes to the company. Afterwards the page thanks them and
// offers the company's public review link, whatever the rating was: a high rating is invited to share it, a low rating is
// told someone will be in touch (and a follow-up task is created) and is still shown the same link. Nothing here says or
// implies that the answer is published, and nothing is posted anywhere by this code.
//
// Two ways of reaching the request behind a token:
//   sample   a token that starts with `sample-`, in a build that has a sample workspace: the request is read from the
//            sample business kept in this browser, the page says it is a sample, and the answer is written there.
//   live     any other token: the server's public address answers for it (`/api/public/review/<token>`).
import { useEffect, useState, type FormEvent } from 'react';
import { LuExternalLink, LuStar } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, SAMPLE_BASE } from '@/app/router';
import { AuthFrame } from '@/features/auth/frame';
import { Button, Note, cx } from '@/ui';
import { ctx, hasSample, loadSample, mutateQuiet } from '@/store/store';
import { LOW_RATING, answerReview, declineReview, openReview, reviewByToken, reviewOpen, reviewSettings, validPublicUrl } from '@/domain/actions/reviews';
import type { Lang } from '@/domain/types';
import { today } from '@/lib/dates';
import { useTitle } from './title';
import '@/features/reviews/reviews.css';

/** What the page needs to know about a request, from either source. */
interface Request { company: string; firstName: string; job?: string; state: 'open' | 'answered' | 'declined' | 'expired'; publicUrl: string; lang?: Lang }
type Load = { at: 'loading' } | { at: 'missing' } | { at: 'unavailable' } | { at: 'ready'; request: Request };
type Done = { rating: number; low: boolean } | 'declined' | null;

const isSample = (token: string | undefined): token is string => !!token && token.startsWith('sample-') && SAMPLE_BASE !== null;
const ADDRESS = (token: string) => `/api/public/review/${encodeURIComponent(token)}`;

/** A live request, from the server. Anything but a well-formed answer reads as "cannot be opened right now". */
async function fetchRequest(token: string): Promise<Load> {
  try {
    const res = await fetch(ADDRESS(token), { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404) return { at: 'missing' };
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return { at: 'unavailable' };
    const b = await res.json();
    if (!b || b.ok !== true || typeof b.company !== 'string') return { at: 'unavailable' };
    const state = b.state === 'answered' || b.state === 'declined' || b.state === 'expired' ? b.state : 'open';
    return { at: 'ready', request: { company: b.company, firstName: typeof b.firstName === 'string' ? b.firstName : '', job: typeof b.job === 'string' ? b.job : undefined, state, publicUrl: typeof b.publicUrl === 'string' && validPublicUrl(b.publicUrl) ? b.publicUrl : '' } };
  } catch { return { at: 'unavailable' }; }
}
async function postAnswer(token: string, body: { rating: number; comment: string } | { decline: true }): Promise<boolean> {
  try {
    const res = await fetch(ADDRESS(token), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return false;
    const b = await res.json();
    return !!b && b.ok === true;
  } catch { return false; }
}

/** `/review/<token>`: where a client answers a review request. */
export function ReviewPage({ token }: { token?: string }) {
  const { t, data } = useApp();
  const sample = isSample(token);
  const [live, setLive] = useState<Load>({ at: 'loading' });
  const [ready, setReady] = useState(hasSample());
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [need, setNeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Done>(null);

  // the sample business is not in memory on this address until it is asked for
  useEffect(() => {
    if (!token) { setLive({ at: 'missing' }); return; }
    let on = true;
    if (sample) void loadSample().then(() => { if (!on) return; setReady(true); mutateQuiet((d) => { openReview(d, ctx(), token); }); }, () => { if (on) setLive({ at: 'unavailable' }); });
    else void fetchRequest(token).then((r) => { if (on) setLive(r); });
    return () => { on = false; };
  }, [token, sample]);

  let load: Load = live;
  if (sample) {
    const r = ready ? reviewByToken(data, token) : undefined;
    const client = r ? data.clients.find((c) => c.id === r.clientId) : undefined;
    if (!ready) load = live.at === 'unavailable' ? live : { at: 'loading' };
    else if (!r || !client) load = { at: 'missing' };
    else {
      const state = r.status === 'rated' ? 'answered' : r.status === 'declined' ? 'declined' : r.expires && r.expires < today() ? 'expired' : 'open';
      load = { at: 'ready', request: { company: data.company.name, firstName: client.name.trim().split(/\s+/)[0] ?? '', job: r.jobId ? data.jobs.find((j) => j.id === r.jobId)?.name : undefined, state, publicUrl: reviewSettings(data).publicUrl } };
    }
  }
  const request = load.at === 'ready' ? load.request : undefined;
  useTitle(request ? t('reviews.pub.titleFor', { company: request.company }) : t('reviews.pub.title'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    if (!rating) { setNeed(true); return; }
    setBusy(true); setFailed(false);
    let ok = false;
    if (sample) {
      // the answer is written to the sample business in this browser, the same way the server writes a real one
      mutateQuiet((d) => { const r = reviewByToken(d, token); const out = r && reviewOpen(r) ? answerReview(d, ctx(), token, { rating, comment }) : null; ok = !!out && out.ok; if (ok) d.touched = true; });
    } else ok = await postAnswer(token, { rating, comment: comment.trim() });
    setBusy(false);
    if (ok) setDone({ rating, low: rating <= LOW_RATING }); else setFailed(true);
  };
  const decline = async () => {
    if (!token || busy) return;
    setBusy(true); setFailed(false);
    let ok = false;
    if (sample) mutateQuiet((d) => { ok = !!declineReview(d, ctx(), token); if (ok) d.touched = true; });
    else ok = await postAnswer(token, { decline: true });
    setBusy(false);
    if (ok) setDone('declined'); else setFailed(true);
  };

  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
  /** The public review link, offered after every answer. A high rating is invited; a low one is simply shown it. */
  const publicLink = (low: boolean) => request?.publicUrl ? (
    <div className="stack reviews-pub-public" data-testid="review-public" data-low={low}>
      <p>{t(low ? 'reviews.pub.public.also' : 'reviews.pub.public.ask', { company: request.company })}</p>
      <div className="row"><a className={cx('btn', !low && 'primary')} href={request.publicUrl} target="_blank" rel="noopener noreferrer" data-testid="review-public-link">{t('reviews.pub.public.go')}<LuExternalLink aria-hidden="true" /></a></div>
      <p className="xs muted">{t('reviews.pub.public.where', { host: host(request.publicUrl) })}</p>
    </div>
  ) : null;
  const sampleNote = sample && ready ? <Note tone="warn"><span data-testid="review-sample">{t('reviews.pub.sample')}</span></Note> : null;
  const back = sample ? <div className="row"><Link to={`${SAMPLE_BASE}/reviews`} className="btn ghost" data-testid="review-back">{t('reviews.pub.back')}</Link></div> : null;

  return (
    <AuthFrame title={request ? t('reviews.pub.titleFor', { company: request.company }) : t('reviews.pub.title')} testId="public-review">
      <div className="stack reviews-pub" data-state={done ? 'done' : load.at === 'ready' ? load.request.state : load.at}>
        {sampleNote}
        {load.at === 'loading' && <p className="muted" role="status">{t('reviews.pub.loading')}…</p>}
        {load.at === 'missing' && <p>{t('reviews.pub.notFound')}</p>}
        {load.at === 'unavailable' && <p>{t('reviews.pub.unavailable')}</p>}
        {request && done === 'declined' && <p role="status" data-testid="review-done">{t('reviews.pub.declined')}</p>}
        {request && done && done !== 'declined' && (
          <>
            <p role="status" data-testid="review-done">{t(done.low ? 'reviews.pub.thanksLow' : 'reviews.pub.thanks', { company: request.company })}</p>
            {publicLink(done.low)}
          </>
        )}
        {request && !done && request.state === 'answered' && <><p>{t('reviews.pub.closed')}</p>{publicLink(true)}</>}
        {request && !done && request.state === 'declined' && <p>{t('reviews.pub.declined')}</p>}
        {request && !done && request.state === 'expired' && <p>{t('reviews.pub.expired')}</p>}
        {request && !done && request.state === 'open' && (
          <form className="stack" onSubmit={submit} noValidate>
            {request.firstName && <p className="muted">{t('reviews.pub.hello', { name: request.firstName })}</p>}
            <p>{request.job ? t('reviews.pub.askJob', { job: request.job, company: request.company }) : t('reviews.pub.ask', { company: request.company })}</p>
            <fieldset className="reviews-pub-scale">
              <legend>{t('reviews.pub.rating')}</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={cx('reviews-pub-star', rating >= n && 'on')}>
                  <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => { setRating(n); setNeed(false); }} aria-label={t('reviews.pub.star', { n })} data-testid={`review-star-${n}`} />
                  <LuStar aria-hidden="true" /><span aria-hidden="true">{n}</span>
                </label>
              ))}
            </fieldset>
            <p className="xs muted">{t('reviews.pub.scale')}</p>
            {need && <p className="small neg" role="alert">{t('reviews.pub.needRating')}</p>}
            <div className="field">
              <label htmlFor="review-comment">{t('reviews.pub.comment')}</label>
              <textarea id="review-comment" rows={4} maxLength={2000} value={comment} placeholder={t('reviews.pub.commentPh')} onChange={(e) => setComment(e.target.value)} data-testid="review-comment" />
            </div>
            <p className="xs muted">{t('reviews.pub.private', { company: request.company })}</p>
            {failed && <p className="small neg" role="alert">{t('reviews.pub.unavailable')}</p>}
            <div className="row">
              <Button variant="primary" type="submit" disabled={busy} data-testid="review-submit">{t('reviews.pub.submit')}</Button>
              <Button variant="ghost" onClick={decline} disabled={busy} data-testid="review-decline">{t('reviews.pub.decline')}</Button>
            </div>
          </form>
        )}
        {(done || (request && request.state !== 'open') || load.at === 'missing') && back}
      </div>
    </AuthFrame>
  );
}
