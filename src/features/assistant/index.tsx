// Assistant: ask about the business or give an instruction, in English or Spanish.
// Built-in mode (always available) reads the request with the rules in engine.ts and answers from the records.
// Connected mode (when an AI model is set up for the workspace) asks the server function instead.
// In both modes nothing changes until the person presses Confirm on the card that states exactly what will change.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LuArrowRight, LuCheck, LuEraser, LuSend, LuShieldCheck, LuSparkles, LuTriangleAlert, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, useRoute } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { DemoTag, PlanBadge, CanWrite } from '@/app/shared';
import { Badge, Button, Card, Dot, PageHeader, cx } from '@/ui';
import { describe, examples, interpret, isNo, isYes, suggestions, type Block, type Card as ProposalCard, type Choice, type Env, type Proposal } from './engine';
import { execute, type Outcome } from './run';
import { askModel, checkConfigured, type Turn } from './remote';
import { SuccessCheck } from '@/features/documents/success';
import { mutate } from '@/store/store';
import { Empty, toast } from '@/ui';
import { assistantOn, setAssistant } from './deploy';
import { maskTaxIds } from './records';
import { scopedData } from './scope';
import './assistant.css';

type CardState = 'asking' | 'pending' | 'done' | 'cancelled' | 'replaced' | 'failed';
interface UserMsg { id: number; from: 'user'; text: string }
interface BotMsg {
  id: number; from: 'bot'; blocks: Block[];
  choices?: Choice[]; proposal?: Proposal; card?: ProposalCard; state?: CardState; outcome?: Outcome;
  /** True when the words came from the AI model rather than the built-in rules. */
  model?: boolean;
  /** The request was not recognised. */
  unknown?: boolean;
  /** A plain remark under the answer (the model did not answer, or asked for something that cannot be done). */
  remark?: string;
}
type Msg = UserMsg | BotMsg;

/**
 * The assistant can be switched off for a company (and starts off in a deployment that says so). While it is off this
 * page reads nothing: it says so, and someone who may change the company's setup can switch it on.
 */
export default function AssistantPage(props: PageProps) {
  const { t, data, pack, can } = useApp();
  if (assistantOn(data, pack)) return <Conversation {...props} />;
  const may = can('config') && can('write');
  return (
    <>
      <PageHeader title={t('asst.title')} />
      <Card><div data-testid="asst-off"><Empty title={t('asst.off.title')} action={may ? <Button variant="primary" onClick={() => { mutate((d) => setAssistant(d, true), 'config'); toast(t('asst.off.done')); }} data-testid="asst-turn-on">{t('asst.off.on')}</Button> : undefined}>{t('asst.off.text')} {may ? '' : t('asst.off.how')}</Empty></div></Card>
    </>
  );
}

function Conversation(_: PageProps) {
  const app = useApp();
  const { t, data, prefs } = app;
  const env: Env = useMemo(() => ({
    // only what the person asking may see on the screens: a client of another office is not there for the assistant either
    data: scopedData(app.data, app.user, app.perms), pack: app.pack, lang: app.lang, t: app.t, can: app.can, date: app.date, day: app.day, time: app.time,
    actor: app.user?.id ?? app.data.users.find((u) => u.role === app.prefs.viewAs)?.id ?? app.data.users[0]?.id ?? '',
  }), [app]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'builtin' | 'connected'>('builtin');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // one light check on load: is an AI model set up for this workspace?
  useEffect(() => { let live = true; checkConfigured().then((ok) => { if (live && ok) setMode('connected'); }); return () => { live = false; }; }, []);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);

  const chips = useMemo(() => suggestions(env), [env]);
  const can = useMemo(() => examples(env), [env]);
  const focus = () => inputRef.current?.focus({ preventScroll: true });
  const push = (...m: Msg[]) => setMsgs((list) => [...list, ...m]);
  const settle = (id: number, patch: Partial<BotMsg>) => setMsgs((list) => list.map((m) => (m.id === id && m.from === 'bot' ? { ...m, ...patch } : m)));
  const open = msgs.find((m): m is BotMsg => m.from === 'bot' && (m.state === 'pending' || m.state === 'asking'));

  const confirm = (m: BotMsg) => {
    if (!m.proposal || m.state !== 'pending') return;
    const outcome = execute(m.proposal, env);
    settle(m.id, { state: outcome.ok ? 'done' : 'failed', outcome });
    focus();
  };
  const cancel = (m: BotMsg) => { settle(m.id, { state: 'cancelled' }); focus(); };
  const choose = (m: BotMsg, c: Choice) => { settle(m.id, { proposal: c.proposal, card: describe(c.proposal, env), state: 'pending' }); focus(); };
  const bot = (blocks: Block[], extra: Partial<BotMsg> = {}): BotMsg => ({ id: ++seq.current, from: 'bot', blocks, ...extra });
  const fromRules = (q: string, remark?: string): BotMsg => {
    const r = interpret(q, env);
    return bot(r.blocks, { choices: r.choices, proposal: r.proposal, card: r.proposal ? describe(r.proposal, env) : undefined, state: r.proposal ? 'pending' : r.choices ? 'asking' : undefined, unknown: r.unknown, remark });
  };

  const send = async (raw: string) => {
    const q = raw.trim(); if (!q || busy) return;
    setDraft(''); focus();
    // what the person typed is shown back with anything shaped like a tax ID masked, and is never kept otherwise
    const user: UserMsg = { id: ++seq.current, from: 'user', text: maskTaxIds(q) };
    // "yes" and "no" answer the card that is waiting
    if (open?.state === 'pending' && isYes(q)) { push(user); confirm(open); return; }
    if (open?.state === 'pending' && isNo(q)) { push(user); cancel(open); return; }
    if (open) settle(open.id, { state: 'replaced' });
    if (mode !== 'connected') { push(user, fromRules(q)); return; }
    push(user); setBusy(true);
    const turns: Turn[] = [...msgs.map((m): Turn => (m.from === 'user' ? { role: 'user', content: m.text } : { role: 'assistant', content: [...m.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')), m.outcome?.text ?? ''].filter(Boolean).join('\n') || '…' })), { role: 'user', content: q }];
    const reply = await askModel(turns, env);
    setBusy(false);
    if (!reply) { push(fromRules(q, t('asst.fallback'))); return; }
    push(bot([{ type: 'text', text: reply.text || t('asst.confirmAsk') }], { model: true, proposal: reply.proposal, card: reply.proposal ? describe(reply.proposal, env) : undefined, state: reply.proposal ? 'pending' : undefined, remark: reply.problem }));
  };

  // a question handed over from the command palette (/assistant?q=...) is asked once on arrival
  const route = useRoute(); const asked = useRef('');
  useEffect(() => { const q = route.query.get('q'); if (q && asked.current !== q) { asked.current = q; void send(q); } }, [route.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const actorName = data.users.find((u) => u.role === prefs.viewAs)?.name ?? t('asst.you');
  return (
    <>
      <PageHeader title={t('asst.title')} sub={t('asst.sub')} />
      <div className="asst-mode" data-testid="asst-mode" data-mode={mode}>
        <div className="row tight">
          <Dot tone={mode === 'connected' ? 'ok' : 'accent'} />
          <b>{t(mode === 'connected' ? 'asst.mode.connected' : 'asst.mode.builtin')}</b>
          {app.priced && <PlanBadge feature="assistant" />}
        </div>
        <p className="small muted">{t('asst.mode.note')}</p>
      </div>

      <div className="asst-layout">
        <section className="card flush premium asst-chat" aria-label={t('asst.conversation')}>
          <div className="asst-head">
            <h2>{t('asst.conversation')}</h2>
            <Button size="sm" variant="ghost" icon={<LuEraser aria-hidden="true" />} onClick={() => { setMsgs([]); focus(); }} disabled={!msgs.length} data-testid="asst-clear">{t('asst.clear')}</Button>
          </div>
          <div className="asst-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-label={t('asst.conversation')} tabIndex={0} data-testid="asst-log">
            {!msgs.length && (
              <div className="asst-empty">
                <span className="asst-mark cut" aria-hidden="true"><LuSparkles /></span>
                <b>{t('asst.empty.title')}</b>
                <span className="small muted">{t('asst.empty.text')}</span>
              </div>
            )}
            {msgs.map((m) => m.from === 'user' ? (
              <div key={m.id} className="asst-msg user" data-from="user"><span className="sr">{actorName}: </span><p>{m.text}</p></div>
            ) : (
              <div key={m.id} className="asst-msg bot" data-from="bot" data-state={m.state} data-unknown={m.unknown || undefined} data-source={m.model ? 'model' : 'builtin'}>
                <span className="asst-mark cut" aria-hidden="true"><LuSparkles /></span>
                <div className="asst-body">
                  <span className="sr">{t('asst.name')}: </span>
                  {m.model && <Badge tone="accent" outline>{t('asst.model.tag')}</Badge>}
                  <Blocks blocks={m.blocks} onExample={send} />
                  {m.choices && (
                    <div className="asst-choices" role="group" aria-label={m.blocks[0]?.type === 'text' ? m.blocks[0].text : undefined}>
                      {m.choices.map((c, i) => (
                        <button key={i} type="button" className="asst-choice" onClick={() => choose(m, c)} disabled={m.state !== 'asking'} aria-pressed={!!m.proposal && m.proposal === c.proposal} data-testid="asst-choice">
                          <b>{c.label}</b>{c.sub && <span className="xs dim">{c.sub}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.card && m.state && m.state !== 'asking' && (
                    <div className={cx('asst-card', m.state)} data-testid="asst-card">
                      <div className="asst-card-h">
                        <span className="asst-card-ic" aria-hidden="true"><LuShieldCheck /></span>
                        <h3>{m.card.title}</h3>
                        {m.state === 'pending' && <Badge tone="accent">{t('asst.card.waiting')}</Badge>}
                      </div>
                      <dl className="kv">{m.card.rows.map(([k, v], i) => <FactRow key={i} k={k} v={v} />)}</dl>
                      {m.card.note && m.state === 'pending' && <p className="xs muted asst-card-note">{m.card.note}</p>}
                      {m.state === 'pending' && (
                        <div className="asst-card-f">
                          <CanWrite><Button variant="primary" icon={<LuCheck aria-hidden="true" />} onClick={() => confirm(m)} data-testid="asst-confirm">{t('common.confirm')}</Button></CanWrite>
                          <Button variant="ghost" icon={<LuX aria-hidden="true" />} onClick={() => cancel(m)} data-testid="asst-cancel">{t('common.cancel')}</Button>
                        </div>
                      )}
                      {m.state === 'done' && m.outcome && (
                        <div className="asst-result ok" data-testid="asst-result">
                          <SuccessCheck draw size={20} />
                          <div>
                            <p>{m.outcome.text}</p>
                            {m.outcome.rules && <p className="xs muted">{t('asst.done.rules', { list: m.outcome.rules.join(', ') })}</p>}
                            {m.outcome.link && <A to={m.outcome.link.to} className="btn sm" data-testid="asst-open">{m.outcome.link.label}<LuArrowRight aria-hidden="true" /></A>}
                          </div>
                        </div>
                      )}
                      {m.state === 'failed' && m.outcome && <div className="asst-result bad" data-testid="asst-result"><LuTriangleAlert aria-hidden="true" /><p>{m.outcome.text}</p></div>}
                      {(m.state === 'cancelled' || m.state === 'replaced') && <p className="small muted asst-card-note" data-testid="asst-result">{t(m.state === 'cancelled' ? 'asst.state.cancelled' : 'asst.state.replaced')}</p>}
                    </div>
                  )}
                  {m.remark && <p className="xs muted asst-remark">{m.remark}</p>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="asst-msg bot" data-testid="asst-thinking">
                <span className="asst-mark cut" aria-hidden="true"><LuSparkles /></span>
                <div className="asst-body"><p className="muted asst-think"><span className="asst-pulse" aria-hidden="true"><i /><i /><i /></span>{t('asst.waiting')}…</p></div>
              </div>
            )}
          </div>

          <div className="asst-chips" role="group" aria-label={t('asst.suggest')}>
            {chips.map((c) => <button key={c} type="button" className="asst-chip" onClick={() => send(c)} disabled={busy} data-testid="asst-chip">{c}</button>)}
          </div>
          <form className="asst-form" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <input ref={inputRef} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('asst.input.ph')} aria-label={t('asst.input.label')} autoComplete="off" enterKeyHint="send" maxLength={500} data-testid="asst-input" />
            <Button variant={open?.state === 'pending' ? 'default' : 'primary'} type="submit" icon={<LuSend aria-hidden="true" />} disabled={!draft.trim() || busy} data-testid="asst-send">{t('asst.send')}</Button>
          </form>
        </section>

        <Card title={t('asst.can.title')} className="asst-can">
          <h3>{t('asst.can.questions')}</h3>
          <ul>{can.questions.map((q) => <li key={q}><button type="button" className="asst-ex" onClick={() => send(q)} disabled={busy}>{q}</button></li>)}</ul>
          <h3>{t('asst.can.actions')}</h3>
          <ul>{can.actions.map((q) => <li key={q}><button type="button" className="asst-ex" onClick={() => send(q)} disabled={busy}>{q}</button></li>)}</ul>
          <p className="small muted">{t('asst.can.honest')}</p>
          <p className="xs dim">{mode === 'connected' ? t('asst.mode.note') : t('asst.mode.builtinHint')} {t('asst.mode.plan')}</p>
        </Card>
      </div>
    </>
  );
}

function FactRow({ k, v }: { k: string; v: string }) { return <><dt>{k}</dt><dd>{v}</dd></>; }

/** An answer is a few simple pieces: sentences, a list of records with links, a table of facts, example requests. */
function Blocks({ blocks, onExample }: { blocks: Block[]; onExample: (q: string) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text') return <p key={i} className={b.soft ? 'small muted' : undefined}>{b.text}</p>;
        if (b.type === 'facts') return <dl key={i} className="kv asst-facts">{b.rows.map(([k, v], n) => <FactRow key={n} k={k} v={v} />)}</dl>;
        if (b.type === 'link') return <p key={i}><A to={b.to} className="btn sm">{b.label}<LuArrowRight aria-hidden="true" /></A></p>;
        if (b.type === 'examples') return <div key={i} className="asst-examples">{b.items.map((q) => <button key={q} type="button" className="asst-chip" onClick={() => onExample(q)} data-testid="asst-example">{q}</button>)}</div>;
        return (
          <div key={i} className="asst-list">
            {b.items.map((it, n) => {
              const inner = <><span className="grow"><span className="t">{it.title}</span>{it.sub && <span className="xs dim asst-sub">{it.sub}</span>}</span>{it.right && <span className={cx('small nowrap', it.tone === 'bad' ? 'neg strong' : it.tone === 'warn' ? 'asst-warn strong' : 'muted')}>{it.right}</span>}</>;
              return it.to ? <A key={n} to={it.to} className="asst-row">{inner}</A> : <div key={n} className="asst-row">{inner}</div>;
            })}
            {b.more && <A to={b.more.to} className="asst-row asst-more">{b.more.label}<LuArrowRight aria-hidden="true" /></A>}
          </div>
        );
      })}
    </>
  );
}
