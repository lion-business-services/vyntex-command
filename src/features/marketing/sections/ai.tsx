// VYNTEX AI: a short conversation that plays once when the section scrolls into view.
// Nothing in it is scripted: the questions are handed to the built-in interpreter (features/assistant/engine.ts) with the
// sample business of the selected edition, exactly as the Assistant page does, and the blocks it returns are what is drawn.
// The second request produces a proposal, shown as a card that is waiting for confirmation. It is never executed here.
import { useEffect, useMemo, useState } from 'react';
import { LuRotateCcw, LuSparkles } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, appPath } from '@/app/router';
import { Arrow, Reveal, useInView, usePrefersReducedMotion } from '@/brand';
import { can as roleCan } from '@/domain/config';
import { isOpenLead } from '@/domain/selectors';
import { describe, interpret, suggestions, type Block, type Card, type Env, type Item, type Reply } from '@/features/assistant/engine';
import { today } from '@/lib/dates';
import { cx } from '@/ui';
import { Head } from './shared';
import './ai.css';

/** How many records of each list the panel shows; the rest is counted, with a link to the demo. */
const ROWS = 3;
type Line = { kind: 'text'; text: string; soft?: boolean } | { kind: 'row'; item: Item; first: boolean; last: boolean } | { kind: 'more'; /** Null when the assistant itself had more than it listed. */ n: number | null };

/** An answer as the lines that appear one after the other. Links and example chips of the full assistant are left to the demo. */
function toLines(blocks: Block[]): Line[] {
  const out: Line[] = [];
  for (const b of blocks) {
    if (b.type === 'text') out.push({ kind: 'text', text: b.text, soft: b.soft });
    else if (b.type === 'facts') for (const [k, v] of b.rows) out.push({ kind: 'text', text: `${k}: ${v}` });
    else if (b.type === 'list') {
      const shown = b.items.slice(0, ROWS);
      shown.forEach((item, i) => out.push({ kind: 'row', item, first: i === 0, last: i === shown.length - 1 && b.items.length <= ROWS && !b.more }));
      if (b.items.length > ROWS || b.more) out.push({ kind: 'more', n: b.more ? null : b.items.length - ROWS });
    }
  }
  return out;
}
/** The first wording the interpreter really understands, so the panel can never show a question it would not answer. */
function firstUnderstood(candidates: string[], env: Env, want: 'answer' | 'proposal'): { q: string; reply: Reply } | null {
  for (const q of candidates) {
    const reply = interpret(q, env);
    if (want === 'proposal' ? reply.proposal : !reply.unknown && !reply.proposal && !reply.choices) return { q, reply };
  }
  return null;
}

export function AiSection() {
  const app = useApp();
  const { t, data } = app;
  const reduced = usePrefersReducedMotion();
  const { ref, seen, visible } = useInView<HTMLDivElement>('0px 0px -18% 0px');

  // the same environment the Assistant page builds, always as the owner of the sample company
  const env: Env = useMemo(() => {
    const owner = app.data.users.find((u) => u.role === 'owner') ?? app.data.users[0];
    return { data: app.data, pack: app.pack, lang: app.lang, t: app.t, can: (p) => roleCan(app.data, app.pack, 'owner', p), date: app.date, day: app.day, time: app.time, actor: owner?.id ?? '' };
  }, [app]);
  const talk = useMemo(() => {
    const ask = firstUnderstood([t('mk.s.ai.q1'), t('mk.s.ai.q1b'), t('asst.chip.due')], env, 'answer');
    const td = today();
    const lead = data.leads.find((l) => isOpenLead(l, data) && !!l.followUp && l.followUp <= td) ?? data.leads.find((l) => isOpenLead(l, data));
    const act = firstUnderstood([t('mk.s.ai.q2'), ...(lead ? [t('mk.s.ai.q2b', { name: lead.name })] : []), t('asst.chip.task')], env, 'proposal');
    const card: Card | null = act?.reply.proposal ? describe(act.reply.proposal, env) : null;
    return { ask, act, card, lines: ask ? toLines(ask.reply.blocks) : [], more: suggestions(env).filter((q) => q !== ask?.q && q !== act?.q).slice(0, 3) };
  }, [env, data, t]);

  // one timeline: type the question, think, reveal the answer line by line, type the request, think, show the card
  const len1 = talk.ask?.q.length ?? 0; const n1 = talk.lines.length; const len2 = talk.act?.q.length ?? 0; const n2 = talk.act ? 2 : 0;
  const a = len1, b = a + 1, c = b + n1, d = c + 1, e = d + len2, f = e + 1, end = f + n2;
  const [pos, setPos] = useState(0);
  // the finished height, kept by the wrapper while the conversation plays again
  const [hold, setHold] = useState(0);
  const at = reduced ? end : seen ? pos : 0;
  useEffect(() => {
    if (reduced || !seen || !visible || pos >= end) return;
    const delay = pos < a ? 22 : pos < b ? 420 : pos < c ? 95 : pos < d ? 620 : pos < e ? 16 : pos < f ? 380 : 220;
    const id = window.setTimeout(() => setPos((p) => p + 1), delay);
    return () => window.clearTimeout(id);
  }, [pos, seen, visible, reduced, a, b, c, d, e, f, end]);
  // a new industry or language is a new conversation
  useEffect(() => { setPos(0); setHold(0); }, [talk]);

  const typed1 = Math.min(at, a), shown1 = Math.max(0, Math.min(at - b, n1)), typed2 = Math.max(0, Math.min(at - d, len2)), shown2 = Math.max(0, Math.min(at - f, n2));
  const demoAsk = (q: string) => `${appPath('/assistant')}?q=${encodeURIComponent(q)}`;

  return (
    <section className="mks mks-ai" aria-labelledby="mks-ai-h">
      <div className="mks-ai-grid">
        <div className="mks-ai-copy">
          <Head id="mks-ai-h" title={t('mk.s.ai.h')} sub={t('mk.s.ai.sub')} />
          <ul className="mks-ai-truths">
            {(['records', 'confirm', 'model'] as const).map((k, i) => (
              <Reveal as="li" key={k} delay={120 + i * 70}><b>{t(`mk.s.ai.${k}.h`)}</b><span>{t(`mk.s.ai.${k}.p`)}</span></Reveal>
            ))}
          </ul>
          <Reveal className="mks-ai-cta" delay={340}>
            <Link to={appPath('/assistant')} className="btn" data-testid="mk-ai-demo">{t('mk.s.ai.try')}<Arrow /></Link>
          </Reveal>
          {talk.more.length > 0 && (
            <Reveal as="p" className="mks-ai-more" delay={400}>
              <span>{t('mk.s.ai.also')}</span>
              {talk.more.map((q) => <Link key={q} to={demoAsk(q)} className="mks-ai-chip">{q}</Link>)}
            </Reveal>
          )}
        </div>

        <Reveal kind="panel" className="mks-ai-stage">
          <div className="mks-ai-hold" style={hold ? { minHeight: hold } : undefined}>
          <div className="card premium mks-ai-panel" ref={ref} data-state={at >= end ? 'done' : 'playing'} data-live={visible ? '' : undefined} data-testid="mk-ai-panel">
            <div className="mks-ai-top">
              <span className="mks-ai-mark" aria-hidden="true"><LuSparkles /></span>
              <span className="grow"><b>{t('mk.s.ai.name')}</b><small>{t('mk.s.ai.source', { company: data.company.name })}</small></span>
              {!reduced && <button type="button" className="btn ghost sm" onClick={() => { setHold(ref.current?.offsetHeight ?? 0); setPos(0); }} disabled={at < end} data-testid="mk-ai-replay"><LuRotateCcw aria-hidden="true" />{t('mk.s.ai.replay')}</button>}
            </div>
            {talk.ask ? (
              <div className="mks-ai-log">
                <div className={cx('mks-ai-msg user', (at > 0 || seen) && 'in')}><p><Typed text={talk.ask.q} n={typed1} /></p></div>
                <div className="mks-ai-msg bot">
                  <Dots on={at >= a && at < b} />
                  {talk.lines.map((l, i) => <AnswerLine key={i} line={l} on={i < shown1} />)}
                </div>
                {talk.act && talk.card && (
                  <>
                    <div className={cx('mks-ai-msg user', at >= d && 'in')}><p><Typed text={talk.act.q} n={typed2} /></p></div>
                    <div className="mks-ai-msg bot">
                      <Dots on={at >= e && at < f} />
                      {talk.act.reply.blocks.filter((x) => x.type === 'text').slice(0, 1).map((x, i) => <p key={i} className={cx('mks-ai-line', shown2 > 0 && 'in')}>{x.type === 'text' ? x.text : ''}</p>)}
                      <div className={cx('mks-ai-card mks-ai-line', shown2 > 1 && 'in')} data-testid="mk-ai-card">
                        <h3>{talk.card.title}</h3>
                        <dl className="kv">{talk.card.rows.map(([k, v], i) => <Row key={i} k={k} v={v} />)}</dl>
                        <p className="mks-ai-wait"><i aria-hidden="true" />{t('mk.s.ai.waiting')}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : <p className="muted">{t('mk.s.ai.none')}</p>}
            <p className="mks-ai-foot">{t('mk.s.ai.foot')}</p>
          </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) { return <><dt>{k}</dt><dd>{v}</dd></>; }

/** A sentence being typed. The untyped rest keeps its place, so the bubble never changes size. */
function Typed({ text, n }: { text: string; n: number }) {
  const done = n >= text.length;
  return (
    <>
      <span className="sr">{text}</span>
      <span aria-hidden="true">{text.slice(0, n)}{!done && n > 0 && <i className="mks-ai-caret" />}<span className="mks-ai-ghost">{text.slice(n)}</span></span>
    </>
  );
}
function Dots({ on }: { on: boolean }) { return <span className={cx('mks-ai-dots', on && 'on')} aria-hidden="true"><i /><i /><i /></span>; }

function AnswerLine({ line, on }: { line: Line; on: boolean }) {
  const { t } = useApp();
  if (line.kind === 'text') return <p className={cx('mks-ai-line', line.soft && 'soft', on && 'in')}>{line.text}</p>;
  if (line.kind === 'more') return <p className={cx('mks-ai-line mks-ai-rest', on && 'in')}>{line.n === null ? t('mk.s.ai.moreAny') : t('mk.s.ai.more', { n: line.n })}</p>;
  const it = line.item;
  const inner = (
    <>
      <span className="grow"><span className="t">{it.title}</span>{it.sub && <small>{it.sub}</small>}</span>
      {it.right && <span className={cx('mks-ai-right', it.tone)}>{it.right}</span>}
    </>
  );
  const cls = cx('mks-ai-line mks-ai-row', line.first && 'first', line.last && 'last', on && 'in');
  return it.to ? <Link to={appPath(it.to)} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
