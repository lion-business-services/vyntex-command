// Settings section "Lead pipeline": the company's own stages, lead sources and lost reasons, and how new leads are
// assigned (by hand or in turn). Registered in src/features/settings/panels.ts; needs the `config` capability.
// Stages, sources and reasons are edited as a draft and saved together, so a half-typed list never reaches the pipeline.
// Routing changes are saved as they are made, and the "who is next" line answers at once.
import { useEffect, useMemo, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuFlame, LuPlus, LuRotateCcw, LuTrash2, LuUserMinus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { NoAccess } from '@/app/shared';
import { ctx, mutate } from '@/store/store';
import { Avatar, Badge, Button, Card, IconButton, Note, Seg, cx, confirmDialog, toast } from '@/ui';
import { lostReasonsOf, routingOf, sourcesOf, stagesOf } from '@/domain/config';
import { leadsPerStage, resetLeadStages, saveLeadSources, saveLeadStages, saveLostReasons, saveRouting, skipReason, stageProblem, upcomingTurns } from '@/domain/actions/leads';
import { byId } from '@/domain/selectors';
import type { LeadRouting, OptionDef, StageDef } from '@/domain/types';
import { uid } from '@/lib/id';
import './leads.css';

const KINDS: StageDef['kind'][] = ['open', 'won', 'lost'];
const ROLES: NonNullable<StageDef['role']>[] = ['new', 'contacted', 'visit', 'proposal', 'negotiation'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const swap = <T,>(list: T[], i: number, j: number): T[] => { const out = [...list]; [out[i], out[j]] = [out[j], out[i]]; return out; };

export default function PipelineSettingsPanel() {
  const { can } = useApp();
  if (!can('config')) return <NoAccess />;
  return (
    <div className="stack">
      <StagesCard />
      <OptionsCard which="sources" />
      <OptionsCard which="reasons" />
      <RoutingCard />
    </div>
  );
}

/* ---------- stages ---------- */
function StagesCard() {
  const { t, data, pack } = useApp();
  const saved = stagesOf(data, pack);
  const [draft, setDraft] = useState<StageDef[]>(() => saved.map((s) => ({ ...s, label: { ...s.label } })));
  /** Where the leads of a removed stage go: removed stage id to a stage that stays. */
  const [moves, setMoves] = useState<Record<string, string>>({});
  /** The stage being removed while it still holds leads: the person is choosing where they go. */
  const [removing, setRemoving] = useState<{ id: string; to: string } | null>(null);
  const used = useMemo(() => leadsPerStage(data), [data]);
  const own = !!data.config.leadStages?.length;
  // when the saved stages change under the draft (saved here, or reset), start again from them
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setDraft(saved.map((s) => ({ ...s, label: { ...s.label } }))); setMoves({}); setRemoving(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);

  const dirty = !same(draft, saved);
  const problem = stageProblem(draft);
  const existed = (id: string) => saved.some((s) => s.id === id);
  const patch = (id: string, p: Partial<StageDef>) => setDraft((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const label = (id: string, lang: 'en' | 'es', v: string) => setDraft((list) => list.map((s) => (s.id === id ? { ...s, label: { ...s.label, [lang]: v } } : s)));
  const add = () => setDraft((list) => {
    // a new stage goes in front of the won and lost ones, where open stages are
    const at = list.findIndex((s) => s.kind !== 'open');
    const fresh: StageDef = { id: uid('st'), label: { en: '', es: '' }, kind: 'open' };
    return at < 0 ? [...list, fresh] : [...list.slice(0, at), fresh, ...list.slice(at)];
  });
  const remove = (s: StageDef) => {
    const n = existed(s.id) ? used[s.id] ?? 0 : 0;
    // offered first: the stage just before it that counts the same way, which is where such leads usually belong
    if (n > 0) { const at = draft.findIndex((x) => x.id === s.id); const alike = (x: StageDef) => x.id !== s.id && x.kind === s.kind; const to = [...draft.slice(0, at)].reverse().find(alike) ?? draft.slice(at + 1).find(alike) ?? draft.find((x) => x.id !== s.id); setRemoving({ id: s.id, to: to?.id ?? '' }); return; }
    setDraft((list) => list.filter((x) => x.id !== s.id));
  };
  const confirmRemove = () => { if (!removing?.to) return; setMoves((m) => ({ ...m, [removing.id]: removing.to })); setDraft((list) => list.filter((x) => x.id !== removing.id)); setRemoving(null); };
  const save = () => {
    // leads sent to a stage that was itself removed later follow it to where that one went
    const final: Record<string, string> = {};
    for (const from of Object.keys(moves)) { let to = moves[from]; const seen = new Set([from]); while (moves[to] && !seen.has(to)) { seen.add(to); to = moves[to]; } final[from] = to; }
    let refused: ReturnType<typeof stageProblem> = null;
    mutate((d) => { refused = saveLeadStages(d, ctx(), draft, final); }, 'config');
    toast(refused ? t('leads.set.problem.' + refused) : t('leads.set.saved'), !!refused);
  };
  const reset = async () => {
    if (!(await confirmDialog(t('leads.set.resetConfirm'), t('leads.set.reset'), t('common.cancel')))) return;
    let refused: ReturnType<typeof stageProblem> = null;
    mutate((d) => { refused = resetLeadStages(d, ctx()); }, 'config');
    toast(refused ? t('leads.set.resetBlocked') : t('leads.set.saved'), !!refused);
  };

  return (
    <Card title={t('leads.set.stages')} actions={own ? <Button size="sm" variant="ghost" icon={<LuRotateCcw />} onClick={reset} data-testid="pipeline-reset">{t('leads.set.reset')}</Button> : undefined}>
      <p className="muted small leads-set-lead">{t('leads.set.stagesHint')}</p>
      <div className="leads-set-rows" role="list" data-testid="pipeline-stages">
        <div className="leads-set-head" aria-hidden="true"><span /><span>{t('leads.set.en')}</span><span>{t('leads.set.es')}</span><span>{t('leads.set.kind')}</span><span>{t('leads.set.role')}</span><span>{t('leads.set.inUse')}</span><span /></div>
        {draft.map((s, i) => {
          const n = existed(s.id) ? used[s.id] ?? 0 : 0;
          const name = s.label.en || t('leads.set.newStage');
          return (
            <div className="leads-set-row" role="listitem" key={s.id} data-stage={s.id}>
              <span className="leads-set-order">
                <IconButton size="sm" label={t('leads.set.up', { name })} disabled={i === 0} onClick={() => setDraft((list) => swap(list, i, i - 1))}><LuArrowUp /></IconButton>
                <IconButton size="sm" label={t('leads.set.down', { name })} disabled={i === draft.length - 1} onClick={() => setDraft((list) => swap(list, i, i + 1))}><LuArrowDown /></IconButton>
              </span>
              <label><span className="leads-set-cap">{t('leads.set.en')}</span><input className="input" value={s.label.en} onChange={(e) => label(s.id, 'en', e.target.value)} aria-label={`${t('leads.set.en')}: ${name}`} aria-invalid={!s.label.en.trim() || undefined} /></label>
              <label><span className="leads-set-cap">{t('leads.set.es')}</span><input className="input" value={s.label.es} onChange={(e) => label(s.id, 'es', e.target.value)} aria-label={`${t('leads.set.es')}: ${name}`} aria-invalid={!s.label.es.trim() || undefined} lang="es" /></label>
              <label><span className="leads-set-cap">{t('leads.set.kind')}</span>
                {/* a stage that holds leads keeps what it counts as: turning it into "won" would count them as won without anything being created */}
                <select className="input" value={s.kind} disabled={n > 0} title={n > 0 ? t('leads.set.kindLocked') : undefined} onChange={(e) => patch(s.id, { kind: e.target.value as StageDef['kind'] })} aria-label={`${t('leads.set.kind')}: ${name}`}>
                  {KINDS.map((k) => <option key={k} value={k}>{t('leads.set.kind.' + k)}</option>)}
                </select>
              </label>
              <span className="leads-set-role">
                {s.kind === 'open' ? (
                  <>
                    <label className="grow"><span className="leads-set-cap">{t('leads.set.role')}</span>
                      <select className="input" value={s.role ?? ''} onChange={(e) => patch(s.id, { role: (e.target.value || undefined) as StageDef['role'] })} aria-label={`${t('leads.set.role')}: ${name}`}>
                        <option value="">{t('leads.set.role.none')}</option>{ROLES.map((r) => <option key={r} value={r}>{t('leads.set.role.' + r)}</option>)}
                      </select>
                    </label>
                    <button type="button" className={cx('iconbtn sm leads-set-hot', s.hot && 'on')} aria-pressed={!!s.hot} aria-label={`${t('leads.set.hot')}: ${name}`} title={t('leads.set.hot')} onClick={() => patch(s.id, { hot: !s.hot })}><LuFlame aria-hidden="true" /></button>
                  </>
                ) : <span className="xs dim">{t(s.kind === 'won' ? 'leads.set.wonNote' : 'leads.set.lostNote')}</span>}
              </span>
              <span className="leads-set-use"><span className="leads-set-cap">{t('leads.set.inUse')}</span>{n > 0 ? <Badge>{n}</Badge> : <span className="xs dim">0</span>}</span>
              <IconButton size="sm" label={t('leads.set.remove', { name })} onClick={() => remove(s)} data-testid="pipeline-stage-remove"><LuTrash2 /></IconButton>
              {removing?.id === s.id && (
                <div className="note warn leads-set-move" role="group" aria-label={t('leads.set.moveTitle')}>
                  <span>{t('leads.set.moveAsk', { n, name })}</span>
                  <select className="input" value={removing.to} onChange={(e) => setRemoving({ id: s.id, to: e.target.value })} aria-label={t('leads.set.moveTitle')} data-testid="pipeline-move-to">
                    {draft.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.label.en || t('leads.set.newStage')}</option>)}
                  </select>
                  <Button size="sm" onClick={confirmRemove} data-testid="pipeline-move-ok">{t('leads.set.moveOk')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="row between leads-set-foot">
        <Button size="sm" icon={<LuPlus />} onClick={add} data-testid="pipeline-stage-add">{t('leads.set.addStage')}</Button>
        <span className="row">
          {dirty && <Button size="sm" variant="ghost" onClick={() => { setDraft(saved.map((s) => ({ ...s, label: { ...s.label } }))); setMoves({}); setRemoving(null); }}>{t('leads.set.discard')}</Button>}
          <Button size="sm" variant="primary" disabled={!dirty || !!problem} onClick={save} data-testid="pipeline-stages-save">{t('leads.set.saveStages')}</Button>
        </span>
      </div>
      {dirty && problem && <p className="small neg" role="alert" data-testid="pipeline-problem">{t('leads.set.problem.' + problem)}</p>}
      {Object.keys(moves).length > 0 && <p className="xs dim">{t('leads.set.movesNote')}</p>}
    </Card>
  );
}

/* ---------- sources and lost reasons: two lists edited the same way ---------- */
function OptionsCard({ which }: { which: 'sources' | 'reasons' }) {
  const { t, data, pack } = useApp();
  const saved = which === 'sources' ? sourcesOf(data, pack) : lostReasonsOf(data, pack);
  const own = !!(which === 'sources' ? data.config.leadSources : data.config.lostReasons)?.length;
  const [draft, setDraft] = useState<OptionDef[]>(() => saved.map((o) => ({ id: o.id, label: { ...o.label } })));
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setDraft(saved.map((o) => ({ id: o.id, label: { ...o.label } }))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);
  // an option some lead still uses stays, so that lead never shows a blank where its source or reason was
  const used = useMemo(() => { const out: Record<string, number> = {}; for (const l of data.leads) { const k = which === 'sources' ? l.source : l.lostReason; if (k) out[k] = (out[k] ?? 0) + 1; } return out; }, [data, which]);
  const dirty = !same(draft, saved);
  const blank = draft.some((o) => !o.label.en.trim() || !o.label.es.trim());
  const label = (id: string, lang: 'en' | 'es', v: string) => setDraft((list) => list.map((o) => (o.id === id ? { ...o, label: { ...o.label, [lang]: v } } : o)));
  const save = () => { mutate((d) => { (which === 'sources' ? saveLeadSources : saveLostReasons)(d, ctx(), draft); }, 'config'); toast(t('leads.set.saved')); };
  const reset = async () => {
    if (!(await confirmDialog(t('leads.set.resetListConfirm'), t('leads.set.reset'), t('common.cancel')))) return;
    const shipped = new Set((which === 'sources' ? pack.leadSources : pack.lostReasons).map((o) => o.id));
    if (Object.keys(used).some((k) => !shipped.has(k) && saved.some((o) => o.id === k))) { toast(t('leads.set.resetBlocked'), true); return; }
    mutate((d) => { (which === 'sources' ? saveLeadSources : saveLostReasons)(d, ctx(), []); }, 'config'); toast(t('leads.set.saved'));
  };
  return (
    <Card title={t(which === 'sources' ? 'leads.set.sources' : 'leads.set.reasons')} actions={own ? <Button size="sm" variant="ghost" icon={<LuRotateCcw />} onClick={reset}>{t('leads.set.reset')}</Button> : undefined}>
      <p className="muted small leads-set-lead">{t(which === 'sources' ? 'leads.set.sourcesHint' : 'leads.set.reasonsHint')}</p>
      <div className="leads-set-rows opts" role="list" data-testid={`pipeline-${which}`}>
        <div className="leads-set-head" aria-hidden="true"><span /><span>{t('leads.set.en')}</span><span>{t('leads.set.es')}</span><span>{t('leads.set.inUse')}</span><span /></div>
        {draft.map((o, i) => {
          const n = used[o.id] ?? 0; const name = o.label.en || t('leads.set.newOption');
          return (
            <div className="leads-set-row" role="listitem" key={o.id}>
              <span className="leads-set-order">
                <IconButton size="sm" label={t('leads.set.up', { name })} disabled={i === 0} onClick={() => setDraft((list) => swap(list, i, i - 1))}><LuArrowUp /></IconButton>
                <IconButton size="sm" label={t('leads.set.down', { name })} disabled={i === draft.length - 1} onClick={() => setDraft((list) => swap(list, i, i + 1))}><LuArrowDown /></IconButton>
              </span>
              <label><span className="leads-set-cap">{t('leads.set.en')}</span><input className="input" value={o.label.en} onChange={(e) => label(o.id, 'en', e.target.value)} aria-label={`${t('leads.set.en')}: ${name}`} aria-invalid={!o.label.en.trim() || undefined} /></label>
              <label><span className="leads-set-cap">{t('leads.set.es')}</span><input className="input" value={o.label.es} onChange={(e) => label(o.id, 'es', e.target.value)} aria-label={`${t('leads.set.es')}: ${name}`} aria-invalid={!o.label.es.trim() || undefined} lang="es" /></label>
              <span className="leads-set-use"><span className="leads-set-cap">{t('leads.set.inUse')}</span>{n > 0 ? <Badge>{n}</Badge> : <span className="xs dim">0</span>}</span>
              <IconButton size="sm" label={t('leads.set.remove', { name })} disabled={n > 0 || draft.length <= 1} title={n > 0 ? t('leads.set.keepUsed') : undefined} onClick={() => setDraft((list) => list.filter((x) => x.id !== o.id))}><LuTrash2 /></IconButton>
            </div>
          );
        })}
      </div>
      <div className="row between leads-set-foot">
        <Button size="sm" icon={<LuPlus />} onClick={() => setDraft((list) => [...list, { id: uid(which === 'sources' ? 'src' : 'lr'), label: { en: '', es: '' } }])} data-testid={`pipeline-${which}-add`}>{t(which === 'sources' ? 'leads.set.addSource' : 'leads.set.addReason')}</Button>
        <span className="row">
          {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(saved.map((o) => ({ id: o.id, label: { ...o.label } })))}>{t('leads.set.discard')}</Button>}
          <Button size="sm" variant="primary" disabled={!dirty || blank} onClick={save} data-testid={`pipeline-${which}-save`}>{t('common.save')}</Button>
        </span>
      </div>
      {dirty && blank && <p className="small neg" role="alert">{t('leads.set.problem.no_label')}</p>}
    </Card>
  );
}

/* ---------- who gets a new lead ---------- */
function RoutingCard() {
  const { t, data, pack, date } = useApp();
  const r = routingOf(data);
  const set = (patch: Partial<Omit<LeadRouting, 'cursor'>>) => mutate((d) => { saveRouting(d, ctx(), patch); }, 'config');
  const turns = upcomingTurns(data, pack, Math.max(3, Math.min(5, r.pool.length)));
  const outside = data.users.filter((u) => u.active !== false && !r.pool.includes(u.id) && skipReason(data, pack, u.id, { ...r, exclude: [] }) !== 'role');
  const fallbackChoices = data.users.filter((u) => u.active !== false && skipReason(data, pack, u.id, { ...r, exclude: [], skipAway: false }) !== 'role');
  const name = (id: string) => byId(data.users, id)?.name ?? '';
  const first = turns[0];
  const why = (id: string): string | null => {
    const u = byId(data.users, id); const k = skipReason(data, pack, id, r);
    if (!k) return null;
    if (k === 'away') return t('leads.set.skip.away', { date: date(u?.away?.to) });
    return t('leads.set.skip.' + k);
  };
  return (
    <Card title={t('leads.set.routing')}>
      <p className="muted small leads-set-lead">{t('leads.set.routingHint')}</p>
      <Seg label={t('leads.set.mode')} value={r.mode} onChange={(mode) => { set({ mode }); toast(t('leads.set.saved')); }} options={[{ value: 'manual', label: t('leads.set.mode.manual') }, { value: 'round_robin', label: t('leads.set.mode.round_robin') }]} />

      <div className={cx('leads-turn', r.mode === 'round_robin' && first && 'on')} data-testid="pipeline-next" aria-live="polite">
        <div className="xs dim">{t('leads.set.next')}</div>
        {r.mode === 'manual'
          ? <div>{first ? t('leads.set.next.manualFallback', { name: name(first.userId) }) : t('leads.set.next.manual')}</div>
          : first?.how === 'round_robin'
            ? <div className="leads-turn-line"><b>{name(first.userId)}</b>{turns.slice(1).map((x, i) => <span key={i} className="muted">{t('leads.set.next.then', { name: name(x.userId) })}</span>)}</div>
            : <div>{first ? t('leads.set.next.fallback', { name: name(first.userId) }) : t('leads.set.next.nobody')}</div>}
      </div>

      <h3 className="leads-set-h">{t('leads.set.pool')}</h3>
      {r.pool.length ? (
        <ol className="leads-pool" data-testid="pipeline-pool">
          {r.pool.map((id, i) => {
            const u = byId(data.users, id); const reason = why(id); const excluded = r.exclude.includes(id); const person = u?.name ?? t('leads.set.skip.gone');
            return (
              <li key={id} className={cx(reason && 'skipped')} data-user={id}>
                <span className="leads-pool-n" aria-hidden="true">{i + 1}</span>
                <Avatar name={person} size="sm" />
                <span className="grow"><span className="t">{person}</span><span className="xs dim leads-sub">{u ? t('role.' + u.role) : ''}{reason ? ` · ${reason}` : first?.userId === id && r.mode === 'round_robin' ? ` · ${t('leads.set.isNext')}` : ''}</span></span>
                <label className="check leads-pool-skip"><input type="checkbox" checked={excluded} onChange={(e) => set({ exclude: e.target.checked ? [...r.exclude, id] : r.exclude.filter((x) => x !== id) })} /><span>{t('leads.set.exclude')}</span></label>
                <span className="leads-set-order">
                  <IconButton size="sm" label={t('leads.set.up', { name: person })} disabled={i === 0} onClick={() => set({ pool: swap(r.pool, i, i - 1) })}><LuArrowUp /></IconButton>
                  <IconButton size="sm" label={t('leads.set.down', { name: person })} disabled={i === r.pool.length - 1} onClick={() => set({ pool: swap(r.pool, i, i + 1) })}><LuArrowDown /></IconButton>
                  <IconButton size="sm" label={t('leads.set.poolRemove', { name: person })} onClick={() => set({ pool: r.pool.filter((x) => x !== id) })}><LuUserMinus /></IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      ) : <p className="small muted">{t('leads.set.poolEmpty')}</p>}

      <div className="fgrid leads-set-grid">
        <label className="field"><span>{t('leads.set.poolAdd')}</span>
          <select className="input" value="" onChange={(e) => { if (e.target.value) set({ pool: [...r.pool, e.target.value] }); }} disabled={!outside.length} data-testid="pipeline-pool-add">
            <option value="">{outside.length ? t('leads.set.poolPick') : t('leads.set.poolAll')}</option>{outside.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{t('leads.set.fallback')}</span>
          <select className="input" value={r.fallbackId ?? ''} onChange={(e) => set({ fallbackId: e.target.value || undefined })} data-testid="pipeline-fallback">
            <option value="">{t('leads.set.fallbackNone')}</option>{fallbackChoices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <span className="hint">{t('leads.set.fallbackHint')}</span>
        </label>
        <label className="check full"><input type="checkbox" checked={r.skipAway} onChange={(e) => set({ skipAway: e.target.checked })} data-testid="pipeline-skip-away" /><span>{t('leads.set.skipAway')}</span></label>
      </div>
      {r.mode === 'round_robin' && !r.pool.length && <Note tone="warn">{t('leads.set.poolWarn')}</Note>}
    </Card>
  );
}
