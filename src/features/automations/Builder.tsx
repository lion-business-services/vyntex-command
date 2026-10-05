// The rule builder: pick the event, add conditions from the field catalogue, add steps with their settings, and see in
// plain words what the rule says and which records on file it would catch. Saving goes through the same check the engine
// relies on, so a half-written rule is never stored.
import { useMemo, useRef, useState } from 'react';
import { LuArrowDown, LuArrowLeft, LuArrowUp, LuCopy, LuPlus, LuRotateCcw, LuTrash2, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go, refPath } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, IconButton, Note, PageHeader, confirmDialog, cx, toast } from '@/ui';
import { NoAccess } from '@/app/shared';
import type { RuleCond, RuleDef, RuleStep } from '@/domain/types';
import { taskTypesOf, stagesOf } from '@/domain/config';
import { cloneRule, effectiveRules, previewRule, ruleChanged, shippedRule } from '@/domain/rules/engine';
import { NO_VALUE, OPERATORS, eventDef, eventsFor, fieldsFor, type EventDef, type EventGroup, type FieldDef, type SubjectKind } from '@/domain/rules/fields';
import { STEPS, stepDef, stepsFor, type ParamDef, type StepKind } from '@/domain/rules/steps';
import { deleteRule, duplicateRule, resetRule, saveRule, type RuleProblem } from '@/domain/rules/manage';
import { ruleTitle } from './format';
import { capFirst, eventText, ruleText, whoText, type Reader } from './sentence';
import './automations.css';

const GROUP_ORDER: EventGroup[] = ['lead', 'appointment', 'job', 'money', 'document', 'task', 'client', 'message', 'time'];
const blank = (): RuleDef => ({ id: '', name: { en: '', es: '' }, active: true, when: { event: 'lead.created' }, if: [], then: [] });

/** Merge fields a text may use, given the records the event comes with. */
function mergeFields(event: EventDef | undefined): string[] {
  const has = (k: SubjectKind) => !!event?.subjects.includes(k);
  const person = has('client') || has('lead');
  return [
    ...(person ? ['first_name', 'name'] : []), ...(has('client') ? ['client.name'] : []), ...(has('lead') ? ['lead.name'] : []), ...(has('job') ? ['job.name'] : []),
    ...(has('appointment') ? ['appointment.date', 'appointment.time'] : []), ...(has('task') ? ['task.title'] : []), ...(has('doc') || has('envelope') ? ['doc.title'] : []),
    ...(event?.days ? ['days'] : []), ...(has('payment') || event?.id === 'credit.expiring' ? ['amount'] : []), ...(event?.id === 'deadline.near' ? ['title'] : []),
    ...(event?.id === 'opportunity.created' ? ['service'] : []), 'owner', 'company',
  ];
}
/** A fresh step of a kind, with the settings that have an obvious starting value. */
function newStep(kind: StepKind): RuleStep {
  const base: Record<StepKind, RuleStep['params']> = {
    task: { title: '', for: 'record_owner', dueIn: 1, pri: 'medium' }, message: { channel: 'email', mode: 'draft', subject: '', body: '' }, notify: { who: 'manager', text: '' },
    assign: { to: 'owner' }, stage: {}, document: { kind: '' }, playbook: {}, opportunity: { serviceId: '' }, review: { channel: 'email' }, tag: { tag: '' }, builtin: {},
  };
  return { do: kind, params: { ...base[kind] } };
}

export function Builder({ ruleId }: { ruleId?: string }) {
  const app = useApp();
  const { t, data, pack, lang, can } = app;
  const reader: Reader = app;
  const existing = ruleId ? effectiveRules(data, pack).find((r) => r.id === ruleId) : undefined;
  const [draft, setDraft] = useState<RuleDef>(() => (existing ? cloneRule(existing) : blank()));
  const [problem, setProblem] = useState<RuleProblem | null>(null);
  // the box the person last typed in, so a merge field is added where they are writing
  const focus = useRef<{ at: number; k: string } | null>(null);
  const write = can('write');
  // the name is written in the language on screen; Chinese, which a rule's name does not keep, writes the English one
  const nameLang: 'en' | 'es' = lang === 'es' ? 'es' : 'en';

  const event = eventDef(draft.when.event);
  const events = useMemo(() => eventsFor(pack), [pack]);
  const fields = useMemo(() => fieldsFor(draft.when.event), [draft.when.event]);
  const kinds = useMemo(() => stepsFor(event?.subjects ?? []), [event]);
  const preview = useMemo(() => previewRule(data, draft), [data, draft]);
  const text = useMemo(() => ruleText(draft, reader), [draft, reader]);
  const merge = mergeFields(event);

  if (ruleId && !existing) return <><PageHeader title={t('auto.b.titleEdit')} /><Card><Empty title={t('auto.b.gone')} action={<A to="/automations" className="btn">{t('auto.back')}</A>} /></Card></>;
  if (!write) return ruleId ? <><PageHeader title={t('auto.b.titleEdit')} back={<A to="/automations" className="auto-back"><LuArrowLeft aria-hidden="true" />{t('auto.back')}</A>} /><Note>{t('auto.b.readOnly')}</Note></> : <NoAccess />;

  const shipped = existing ? shippedRule(pack, existing.id) : undefined;
  const coded = draft.then.some((s) => s.do === 'builtin');
  const set = (patch: Partial<RuleDef>) => { setDraft((d) => ({ ...d, ...patch })); setProblem(null); };
  const setCond = (i: number, patch: Partial<RuleCond>) => set({ if: draft.if.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
  const setParam = (i: number, k: string, v: string | number) => set({ then: draft.then.map((s, n) => (n === i ? { ...s, params: { ...s.params, [k]: v } } : s)) });
  const move = (i: number, by: -1 | 1) => { const to = i + by; if (to < 0 || to >= draft.then.length) return; const next = [...draft.then]; [next[i], next[to]] = [next[to], next[i]]; set({ then: next }); };

  /** A new event keeps the conditions and steps that still make sense for it and drops the rest. */
  const changeEvent = (id: string) => {
    const def = eventDef(id); if (!def) return;
    const okFields = new Set(fieldsFor(id).map((f) => f.path)); const okSteps = new Set(stepsFor(def.subjects).map((s) => s.do as string));
    set({ when: { event: def.id as RuleDef['when']['event'], ...(def.days ? { days: def.days.default } : {}) }, if: draft.if.filter((c) => okFields.has(c.field)), then: draft.then.filter((s) => s.do === 'builtin' || okSteps.has(s.do)) });
  };
  const addCond = () => { const f = fields[0]; if (f) set({ if: [...draft.if, { field: f.path, op: OPERATORS[f.type][0], ...(f.type === 'bool' ? { value: true } : {}) }] }); };
  const changeField = (i: number, path: string) => { const f = fields.find((x) => x.path === path); if (f) setCond(i, { field: path, op: OPERATORS[f.type][0], value: f.type === 'bool' ? true : undefined }); };
  const changeOp = (i: number, op: RuleCond['op']) => {
    const was = draft.if[i]; const many = op === 'in';
    const value = NO_VALUE.includes(op) ? undefined : many ? (Array.isArray(was.value) ? was.value : was.value !== undefined && was.value !== '' ? [String(was.value)] : []) : Array.isArray(was.value) ? was.value[0] : was.value;
    setCond(i, { op, value });
  };
  const insert = (field: string) => {
    const at = focus.current; if (!at || !draft.then[at.at]) return;
    const cur = String(draft.then[at.at].params[at.k] ?? '');
    setParam(at.at, at.k, `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}{{${field}}}`);
  };

  const save = () => {
    const input: RuleDef = { ...draft, name: { ...draft.name, [nameLang]: (draft.name[nameLang] ?? '').trim() } };
    // a rule named in one language carries that name in the other until someone writes it
    if (!existing) { const typed = input.name[nameLang]; input.name = { en: typed, es: typed }; }
    const out = act(saveRule, input);
    if (!out.ok) { setProblem(out.problem); return; }
    toast(t('auto.b.saved', { name: ruleTitle(out.rule, shippedRule(pack, out.rule.id), t, lang) }));
    go('/automations');
  };
  const problemText = (p: RuleProblem): string =>
    (p.what === 'name' ? t('auto.b.need.name') : p.what === 'step' || p.what === 'event' ? t('auto.b.need.step') : p.what === 'cond' ? t('auto.b.need.cond', { n: p.at + 1 })
      : t('auto.b.need.param', { n: p.at + 1, what: t(p.param === 'pri' ? 'common.priority' : 'auto.p.' + p.param) }));
  const copy = () => { if (!existing) return; const name = t('auto.copyOf', { name: ruleTitle(existing, shipped, t, lang) }); const made = act(duplicateRule, existing.id, { en: name, es: name }); if (made) { toast(t('auto.duplicated', { name })); go(`/automations/rule/${made.id}`); } };
  const reset = async () => {
    if (!existing || !(await confirmDialog(t('auto.resetAsk', { name: ruleTitle(existing, shipped, t, lang) }), t('auto.reset'), t('common.cancel'), false))) return;
    const fresh = act(resetRule, existing.id); if (fresh) { setDraft(cloneRule(fresh)); toast(t('auto.resetDone', { name: ruleTitle(fresh, shipped, t, lang) })); }
  };
  const remove = async () => {
    if (!existing) return; const name = ruleTitle(existing, shipped, t, lang);
    if (!(await confirmDialog(t('auto.deleteAsk', { name }), t('common.delete'), t('common.cancel')))) return;
    if (act(deleteRule, existing.id)) { toast(t('auto.deleted', { name })); go('/automations'); }
  };

  const whoOptions = (assign: boolean): [string, string][] => [
    ...(assign && event?.subjects[0] === 'lead' ? [['next', capFirst(t('auto.who.next'))] as [string, string]] : []),
    ['record_owner', capFirst(t('auto.who.record_owner'))], ['manager', capFirst(whoText('manager', reader))], ['owner', capFirst(t('auto.who.owner'))],
    ...data.users.filter((u) => u.active !== false).map((u): [string, string] => ['user:' + u.id, u.name]),
  ];
  const optionsFor = (p: ParamDef): [string, string][] => {
    switch (p.type) {
      case 'who': return whoOptions(false);
      case 'assignTo': return whoOptions(true);
      case 'pri': return (['high', 'medium', 'low'] as const).map((x) => [x, t('pr.' + x)]);
      case 'taskType': return [['', t('common.none')], ...taskTypesOf(data, pack).map((x): [string, string] => [x.id, t('tt_' + x.id)])];
      case 'channel': return (['email', 'text', 'whatsapp'] as const).map((x) => [x, t('auto.ch.' + x)]);
      case 'mode': return [['draft', t('auto.p.mode.draft')], ['send', t('auto.p.mode.send')]];
      case 'stage': return [['', t('auto.b.pick')], ...stagesOf(data, pack).map((x): [string, string] => [x.id, t('ls_' + x.id)])];
      case 'status': return [['', t('auto.b.pick')], ...pack.jobStatuses.map((x): [string, string] => [x, t('st_' + x)])];
      case 'docKind': return [['', t('auto.b.pick')], ...pack.docKinds.filter((k) => k !== 'upload').map((k): [string, string] => [k, t('doc.kind.' + k)])];
      case 'service': return [['', t('auto.b.pick')], ...(data.catalog ?? []).filter((x) => x.active).map((x): [string, string] => [x.id, x.i18n?.[lang]?.name ?? x.name])];
      default: return [];
    }
  };
  /** Which settings of a step apply to this event: a lead is moved to a stage, a job to a status. */
  const paramsOf = (step: RuleStep): ParamDef[] => {
    const def = stepDef(step.do); if (!def) return [];
    if (step.do === 'stage') return def.params.filter((p) => (event?.subjects.includes('lead') && !event.subjects.includes('job') ? p.k === 'stage' : p.k === 'status'));
    if (step.do === 'message' && step.params.channel !== 'email') return def.params.filter((p) => p.k !== 'subject');
    return def.params;
  };
  const paramLabel = (p: ParamDef) => t(p.type === 'pri' ? 'common.priority' : 'auto.p.' + p.k);
  const bad = (i: number, k: string) => problem?.what === 'param' && problem.at === i && problem.param === k;

  const input = (i: number, step: RuleStep, p: ParamDef, k: string, label: string, hint?: string) => {
    const idp = `auto-s${i}-${k}`; const v = step.params[k];
    const onFocus = () => { if (p.type === 'text' || p.type === 'long') focus.current = { at: i, k }; };
    return (
      <div key={k} className={cx('field', (p.type === 'long' || p.type === 'text') && 'full', bad(i, k) && 'err')}>
        <label htmlFor={idp}>{label}{p.req && k === p.k && <span aria-hidden="true"> *</span>}</label>
        {p.type === 'long' ? <textarea id={idp} rows={5} value={String(v ?? '')} onFocus={onFocus} onChange={(e) => setParam(i, k, e.target.value)} data-testid={idp} />
          : p.type === 'text' || p.type === 'tag' ? <input id={idp} type="text" value={String(v ?? '')} maxLength={200} onFocus={onFocus} onChange={(e) => setParam(i, k, e.target.value)} data-testid={idp} />
          : p.type === 'days' ? <input id={idp} type="number" min={0} max={365} inputMode="numeric" value={String(v ?? 0)} onChange={(e) => setParam(i, k, Math.max(0, Math.round(Number(e.target.value) || 0)))} data-testid={idp} />
          : <select id={idp} value={String(v ?? '')} onChange={(e) => setParam(i, k, e.target.value)} data-testid={idp}>{optionsFor(p).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}</select>}
        {hint && <span className="hint">{hint}</span>}
      </div>
    );
  };

  return (
    <div className="auto auto-b">
      <PageHeader
        title={existing ? t('auto.b.titleEdit') : t('auto.b.titleNew')} back={<A to="/automations" className="auto-back"><LuArrowLeft aria-hidden="true" />{t('auto.back')}</A>}
        actions={existing && (
          <>
            {!coded && <Button icon={<LuCopy aria-hidden="true" />} onClick={copy} data-testid="auto-b-copy">{t('auto.duplicate')}</Button>}
            {shipped && ruleChanged(pack, existing) && <Button icon={<LuRotateCcw aria-hidden="true" />} onClick={reset} data-testid="auto-b-reset">{t('auto.reset')}</Button>}
            {!shipped && <Button variant="danger" icon={<LuTrash2 aria-hidden="true" />} onClick={remove} data-testid="auto-b-delete">{t('auto.delete')}</Button>}
          </>
        )}
      />
      <div className="auto-b-grid">
        <div className="auto-b-main">
          <Card>
            <div className="fgrid">
              <div className={cx('field full', problem?.what === 'name' && 'err')}>
                <label htmlFor="auto-b-name">{t('auto.b.name')}<span aria-hidden="true"> *</span></label>
                <input id="auto-b-name" type="text" maxLength={80} value={draft.name[nameLang] ?? ''} placeholder={t('auto.b.namePh')} onChange={(e) => set({ name: { ...draft.name, [nameLang]: e.target.value } })} data-testid="auto-b-name" />
              </div>
              <div className="field full">
                <label htmlFor="auto-b-about">{t('auto.b.about')} <span className="muted">({t('common.optional')})</span></label>
                <input id="auto-b-about" type="text" maxLength={160} value={draft.about?.[nameLang] ?? ''} placeholder={t('auto.b.aboutPh')} onChange={(e) => set({ about: { en: draft.about?.en ?? '', es: draft.about?.es ?? '', ...draft.about, [nameLang]: e.target.value } })} data-testid="auto-b-about" />
              </div>
            </div>
          </Card>

          <Card title={t('auto.b.when')}>
            <div className="fgrid">
              <div className="field">
                <label htmlFor="auto-b-event">{t('auto.b.event')}</label>
                <select id="auto-b-event" value={draft.when.event} onChange={(e) => changeEvent(e.target.value)} disabled={coded} data-testid="auto-b-event">
                  {GROUP_ORDER.filter((g) => events.some((e) => e.group === g)).map((g) => (
                    <optgroup key={g} label={t('auto.group.' + g)}>
                      {events.filter((e) => e.group === g && e.id !== 'worker.document').map((e) => <option key={e.id} value={e.id}>{capFirst(eventText(e.id, e.days?.default, reader))}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              {event?.days && (
                <div className="field">
                  <label htmlFor="auto-b-days">{t('auto.b.days')}</label>
                  <input id="auto-b-days" type="number" min={0} max={365} inputMode="numeric" value={String(draft.when.days ?? event.days.default)} onChange={(e) => set({ when: { ...draft.when, days: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} data-testid="auto-b-days" />
                  <span className="hint">{t('auto.b.daysHint.' + event.days.dir)}</span>
                </div>
              )}
            </div>
          </Card>

          <Card title={t('auto.b.if')}>
            <p className="small muted auto-b-hint">{t('auto.b.ifHint')}</p>
            {draft.if.map((c, i) => {
              const f: FieldDef | undefined = fields.find((x) => x.path === c.field);
              const ops = f ? OPERATORS[f.type] : [];
              const options = f?.options?.(data, pack, t, lang);
              const wrong = problem?.what === 'cond' && problem.at === i;
              const picked = Array.isArray(c.value) ? c.value.map(String) : [];
              return (
                <fieldset key={i} className={cx('auto-b-row', wrong && 'err')} data-testid={`auto-b-cond-${i}`}>
                  <legend className="sr">{t('auto.b.cond', { n: i + 1 })}</legend>
                  <select className="input" value={c.field} onChange={(e) => changeField(i, e.target.value)} aria-label={t('auto.b.field')} data-testid={`auto-b-cond-${i}-field`}>
                    {fields.map((x) => <option key={x.path} value={x.path}>{capFirst(t('auto.f.' + x.path)).replace(/,$/, '')}</option>)}
                  </select>
                  {f?.type !== 'bool' && (
                    <select className="input" value={c.op} onChange={(e) => changeOp(i, e.target.value as RuleCond['op'])} aria-label={t('auto.b.op')} data-testid={`auto-b-cond-${i}-op`}>
                      {ops.map((op) => <option key={op} value={op}>{t('auto.op.' + op)}</option>)}
                    </select>
                  )}
                  {NO_VALUE.includes(c.op) ? null
                    : f?.type === 'bool' ? (
                      <select className="input" value={c.value === false || c.value === 'false' ? 'false' : 'true'} onChange={(e) => setCond(i, { value: e.target.value === 'true' })} aria-label={t('auto.b.value')} data-testid={`auto-b-cond-${i}-value`}>
                        <option value="true">{capFirst(t('auto.val.yes'))}</option><option value="false">{capFirst(t('auto.val.no'))}</option>
                      </select>
                    ) : options && c.op === 'in' ? (
                      <div className="auto-b-many" role="group" aria-label={t('auto.b.value')} data-testid={`auto-b-cond-${i}-value`}>
                        {options.map((o) => <label key={o.id} className="check"><input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setCond(i, { value: e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id) })} /><span>{o.label}</span></label>)}
                      </div>
                    ) : options ? (
                      <select className="input" value={String(c.value ?? '')} onChange={(e) => setCond(i, { value: e.target.value })} aria-label={t('auto.b.value')} data-testid={`auto-b-cond-${i}-value`}>
                        <option value="">{t('auto.b.pick')}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    ) : f?.type === 'number' ? (
                      <input className="input" type="number" inputMode="decimal" value={c.value === undefined ? '' : String(c.value)} onChange={(e) => setCond(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={t('auto.b.value')} data-testid={`auto-b-cond-${i}-value`} />
                    ) : (
                      <input className="input" type="text" value={String(c.value ?? '')} onChange={(e) => setCond(i, { value: e.target.value })} aria-label={t('auto.b.value')} data-testid={`auto-b-cond-${i}-value`} />
                    )}
                  <IconButton size="sm" label={`${t('auto.b.remove')}: ${t('auto.b.cond', { n: i + 1 })}`} onClick={() => set({ if: draft.if.filter((_x, n) => n !== i) })}><LuX /></IconButton>
                </fieldset>
              );
            })}
            {fields.length ? <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={addCond} data-testid="auto-b-add-cond">{t('auto.b.addCond')}</Button> : <p className="small muted">{t('auto.b.noFields')}</p>}
          </Card>

          <Card title={t('auto.b.then')}>
            <p className="small muted auto-b-hint">{t('auto.b.thenHint')}</p>
            <ol className="auto-b-steps">
              {draft.then.map((step, i) => {
                const def = stepDef(step.do);
                const head = (
                  <div className="auto-b-step-h">
                    <span className="auto-num" data-n={i + 1} aria-hidden="true">{i + 1}</span>
                    <b>{step.do === 'builtin' ? t('auto.tag.builtin') : def ? t('auto.stepName.' + step.do) : t('auto.do.other')}</b>
                    <span className="sp" />
                    <IconButton size="sm" label={`${t('auto.b.up')}: ${t('auto.b.step', { n: i + 1 })}`} onClick={() => move(i, -1)} disabled={i === 0}><LuArrowUp /></IconButton>
                    <IconButton size="sm" label={`${t('auto.b.down')}: ${t('auto.b.step', { n: i + 1 })}`} onClick={() => move(i, 1)} disabled={i === draft.then.length - 1}><LuArrowDown /></IconButton>
                    {step.do !== 'builtin' && <IconButton size="sm" label={`${t('auto.b.remove')}: ${t('auto.b.step', { n: i + 1 })}`} onClick={() => set({ then: draft.then.filter((_x, n) => n !== i) })} data-testid={`auto-b-step-${i}-remove`}><LuX /></IconButton>}
                  </div>
                );
                if (step.do === 'builtin') return <li key={i} className="auto-b-step fixed" data-testid={`auto-b-step-${i}`}>{head}<p className="small muted">{t('auto.b.builtin')}</p><ul className="auto-b-fixed">{ruleText({ ...draft, if: [], then: [step] }, reader).thens.map((line, n) => <li key={n}>{line}</li>)}</ul></li>;
                if (!def) return <li key={i} className="auto-b-step fixed" data-testid={`auto-b-step-${i}`}>{head}<p className="small muted">{t('auto.b.unknownStep')}</p></li>;
                const texts = paramsOf(step).some((p) => p.type === 'text' || p.type === 'long');
                return (
                  <li key={i} className="auto-b-step" data-testid={`auto-b-step-${i}`}>
                    {head}
                    <div className="fgrid">
                      {paramsOf(step).flatMap((p) => [
                        input(i, step, p, p.k, paramLabel(p)),
                        ...(p.es ? [input(i, step, p, p.k + 'Es', t('auto.b.es', { label: paramLabel(p) }), t('auto.b.esHint'))] : []),
                      ])}
                    </div>
                    {texts && step.do !== 'tag' && step.do !== 'opportunity' && (
                      <div className="auto-b-merge"><span className="xs muted">{t('auto.b.merge')}</span>{merge.map((m) => <button key={m} type="button" className="auto-b-chip" onClick={() => { if (!focus.current || focus.current.at !== i) focus.current = { at: i, k: step.do === 'task' ? 'title' : step.do === 'notify' ? 'text' : 'body' }; insert(m); }} title={t('auto.m.insert', { field: t('auto.m.' + m) })}>{t('auto.m.' + m)}</button>)}</div>
                    )}
                    {step.do === 'message' && step.params.mode === 'send' && <Note tone="warn">{t('auto.b.sendWarn')}</Note>}
                  </li>
                );
              })}
            </ol>
            {problem?.what === 'step' && <p className="small neg" role="alert">{t('auto.b.need.step')}</p>}
            <div className="auto-b-add" role="group" aria-label={t('auto.b.addStep')}>
              <span className="small muted">{t('auto.b.addStep')}</span>
              {kinds.filter((k) => STEPS.includes(k)).map((k) => <button key={k.do} type="button" className="btn sm" onClick={() => set({ then: [...draft.then, newStep(k.do)] })} data-testid={`auto-b-add-${k.do}`}><LuPlus aria-hidden="true" />{t('auto.stepName.' + k.do)}</button>)}
            </div>
          </Card>
        </div>

        <aside className="auto-b-side">
          <Card className="premium" title={t('auto.b.reads')}>
            <p className="auto-b-sentence" data-testid="auto-b-sentence">{draft.then.length ? text.sentence : `${t('auto.sentence.when')} ${eventText(draft.when.event, draft.when.days, reader)}${text.conds.length ? `, ${t('auto.sentence.if')} ${text.conds.join(` ${t('auto.and')} `)}` : ''}…`}</p>
            <label className="check auto-b-on"><input type="checkbox" checked={draft.active !== false} onChange={(e) => set({ active: e.target.checked })} data-testid="auto-b-active" /><span>{t('auto.b.active')}</span></label>
            <p className="xs muted">{t('auto.b.activeHint')}</p>
            {problem && <p className="small neg" role="alert" data-testid="auto-b-problem">{problemText(problem)}</p>}
            <div className="row auto-b-save">
              <Button variant="primary" onClick={save} data-testid="auto-b-save">{t('auto.b.save')}</Button>
              <A to="/automations" className="btn ghost">{t('common.cancel')}</A>
            </div>
          </Card>
          <Card title={t('auto.b.preview')}>
            <div data-testid="auto-b-preview" data-hits={preview.hits.length} data-total={preview.total}>
              {!preview.possible ? <p className="small muted">{t('auto.b.previewNone')}</p> : !preview.total ? <p className="small muted">{t('auto.b.previewEmpty')}</p> : (
                <>
                  <p className="small">{preview.windowDays ? t('auto.b.previewWindow', { total: preview.total, days: preview.windowDays, n: preview.hits.length }) : t('auto.b.previewAll', { total: preview.total, n: preview.hits.length })}</p>
                  {preview.hits.length > 0 && (
                    <ul className="auto-b-hits">
                      {preview.hits.slice(0, 4).map((h, i) => <li key={i}><A to={refPath(h.ref)} className="auto-link small">{h.name}</A></li>)}
                      {preview.hits.length > 4 && <li className="xs muted">{t('auto.b.previewMore', { n: preview.hits.length - 4 })}</li>}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Card>
          {existing && shipped && <p className="xs muted auto-b-tag"><Badge tone="neutral" outline>{t('auto.tag.shipped')}</Badge></p>}
        </aside>
      </div>
    </div>
  );
}
