// The full run history: every time a rule acted, what it did, how it went and the record it was about.
// Filters by rule, by result and by the name of the record; `?rule=<id>` and `?ref=<type>:<id>` open it already filtered.
import { useMemo, useState } from 'react';
import { LuArrowLeft, LuCheck, LuTriangleAlert } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, refPath, useRoute } from '@/app/router';
import { Badge, Card, Empty, PageHeader, SearchBox, cx } from '@/ui';
import type { AutomationRun, DemoState, Ref } from '@/domain/types';
import { RUN_CAP, effectiveRules, shippedRules } from '@/domain/rules/engine';
import { runRuleName, stepText } from './format';
import './automations.css';

/** Name of the record a run worked on, when it still exists. */
export function recordOf(d: DemoState, ref?: Ref): string | null {
  if (!ref) return null;
  const by = <T extends { id: string }>(list: T[] | undefined) => (list ?? []).find((x) => x.id === ref.id);
  switch (ref.type) {
    case 'lead': return by(d.leads)?.name ?? null;
    case 'client': return by(d.clients)?.name ?? null;
    case 'job': return by(d.jobs)?.name ?? null;
    case 'task': return by(d.tasks)?.title ?? null;
    case 'doc': { const x = by(d.docs); return x ? x.title || x.number : null; }
    case 'envelope': return by(d.envelopes)?.title ?? null;
    case 'compliance': return by(d.complianceItems)?.title ?? null;
    case 'appointment': { const a = by(d.appointments); return a ? d.clients.find((c) => c.id === a.clientId)?.name ?? d.leads.find((l) => l.id === a.leadId)?.name ?? a.date : null; }
    case 'opportunity': { const o = by(d.opportunities); return o ? d.clients.find((c) => c.id === o.clientId)?.name ?? null : null; }
    default: return null;
  }
}
const REF_KINDS = ['lead', 'client', 'job', 'task', 'appointment', 'doc', 'envelope', 'opportunity', 'compliance', 'review'];
type Status = NonNullable<AutomationRun['status']>;
const statusOf = (r: AutomationRun): Status => r.status ?? 'ok';

export function History() {
  const { t, data, pack, lang, date, dateTime, live } = useApp();
  const route = useRoute();
  const [rule, setRule] = useState(route.query.get('rule') ?? '');
  const [status, setStatus] = useState<Status | ''>('');
  const [q, setQ] = useState('');
  const pinned = route.query.get('ref') ?? '';

  const rules = effectiveRules(data, pack); const shipped = shippedRules(pack);
  const runs = data.automation.runs;
  const nameOf = (id: string) => runRuleName(id, rules, shipped, t, lang);
  // the rules that have run at least once, by name
  const ruleIds = useMemo(() => [...new Set(runs.map((r) => r.ruleId))], [runs]);
  const s = q.trim().toLowerCase();
  const shown = runs.filter((r) => (!rule || r.ruleId === rule) && (!status || statusOf(r) === status) && (!pinned || (r.ref && `${r.ref.type}:${r.ref.id}` === pinned)) && (!s || (recordOf(data, r.ref) ?? '').toLowerCase().includes(s)));
  const clear = () => { setRule(''); setStatus(''); setQ(''); };
  const filtered = !!rule || !!status || !!s;

  return (
    <div className="auto">
      <PageHeader title={t('auto.hist.title')} back={<A to="/automations" className="auto-back"><LuArrowLeft aria-hidden="true" />{t('auto.back')}</A>} />
      <Card flush>
        <div className="filters auto-hist-f">
          <SearchBox value={q} onChange={setQ} placeholder={t('auto.hist.search')} />
          <select className="input" value={rule} onChange={(e) => setRule(e.target.value)} aria-label={t('auto.hist.rule')} data-testid="auto-hist-rule">
            <option value="">{t('auto.hist.allRules')}</option>
            {ruleIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status | '')} aria-label={t('auto.hist.status')} data-testid="auto-hist-status">
            <option value="">{t('auto.hist.any')}</option>
            {(['ok', 'skipped', 'failed'] as Status[]).map((x) => <option key={x} value={x}>{t('auto.status.' + x)}</option>)}
          </select>
          <span className="small muted auto-hist-n" data-testid="auto-hist-count">{t(shown.length === 1 ? 'auto.hist.count.one' : 'auto.hist.count', { n: shown.length })}</span>
        </div>
        {!runs.length ? <Empty title={t('auto.hist.empty')} /> : !shown.length ? (
          <Empty title={t('auto.hist.none')} action={filtered ? <button type="button" className="btn" onClick={clear}>{t('common.clearFilters')}</button> : pinned ? <A to="/automations/history" className="btn">{t('common.clearFilters')}</A> : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="tbl stackable auto-hist" data-testid="auto-hist-table">
              <thead><tr><th>{t('auto.hist.when')}</th><th>{t('auto.hist.rule')}</th><th>{t('auto.hist.record')}</th><th>{t('auto.hist.status')}</th><th>{t('auto.hist.what')}</th></tr></thead>
              <tbody>
                {shown.map((run) => {
                  const st = statusOf(run); const rec = recordOf(data, run.ref);
                  const kind = run.ref ? t('auto.ref.' + (REF_KINDS.includes(run.ref.type) ? run.ref.type : 'other')) : '';
                  return (
                    <tr key={run.id} data-status={st} data-run={run.ruleId}>
                      <td data-label={t('auto.hist.when')} className="nowrap small">{dateTime(run.at)}</td>
                      <td className="t1">{nameOf(run.ruleId)}</td>
                      <td data-label={t('auto.hist.record')}><div className="auto-hist-cell">
                        {!run.ref ? <span className="muted">{t('common.none')}</span> : rec ? <A to={refPath(run.ref)} className="auto-link">{rec}</A> : <span className="muted">{t('auto.hist.gone')}</span>}
                        {run.ref && <span className="xs dim auto-hist-kind">{kind}</span>}
                      </div></td>
                      <td data-label={t('auto.hist.status')}><Badge tone={st === 'ok' ? 'ok' : st === 'failed' ? 'bad' : 'neutral'}>{t('auto.status.' + st)}</Badge></td>
                      <td className="auto-hist-what">
                        <ul className="auto-hist-steps">
                          {run.steps.map((x, i) => { const bad = st === 'failed' && i === run.steps.length - 1; return <li key={i} className={cx(bad && 'bad')}>{bad ? <LuTriangleAlert aria-hidden="true" /> : <LuCheck aria-hidden="true" />}<span>{stepText(x, t, date)}</span></li>; })}
                        </ul>
                        {run.error && <p className="xs auto-why">{t('auto.hist.why', { why: t(run.error) })}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {!live && runs.length >= RUN_CAP && <p className="xs muted auto-hist-kept">{t('auto.hist.kept', { n: RUN_CAP })}</p>}
    </div>
  );
}
