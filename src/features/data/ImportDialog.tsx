// Import clients or leads from a CSV file, one step at a time: choose the file, match its columns, check what would
// happen (a dry run: new rows, people already on file, rows with a problem), then import and get a report.
// Nothing is written before the last step, and the rows that were left out can be downloaded with the reason next to each.
// The logic is in ./importer.ts; this file is the screen.
import { useMemo, useRef, useState } from 'react';
import { LuCircleAlert, LuCircleCheck, LuCopy, LuDownload, LuFileSpreadsheet, LuLock, LuUpload } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appPath } from '@/app/router';
import { act } from '@/store/store';
import { Button, Modal, Note, Seg, cx, toast } from '@/ui';
import { canSeeClient } from '@/domain/access';
import type { Client } from '@/domain/types';
import { downloadCsv, parseCsvRecords, readCsvFile } from './csv';
import { applyImport, autoMap, errorRows, importFields, isSecureColumn, planImport, templateRows, type ImportIssue, type ImportKind, type ImportPlan, type ImportResult, type PlanRow } from './importer';
import './data.css';

const MAX_BYTES = 5_000_000;
const PREVIEW_ROWS = 50;
type Step = 'file' | 'columns' | 'check' | 'done';
type Group = 'all' | 'new' | 'duplicate' | 'invalid';

export function ImportDialog({ kind, onClose }: { kind: ImportKind; onClose: () => void }) {
  const { t, data, pack, user, perms, can, live } = useApp();
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const [also, setAlso] = useState<number[]>([]);
  const [result, setResult] = useState<{ plan: ImportPlan; out: ImportResult; also: number[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fields = importFields(kind);
  const allClients = can('allClients');
  const world = useMemo(() => ({ data, pack, user, allClients, canSee: (c: Client) => canSeeClient(data, user, perms, c) }), [data, pack, user, allClients, perms]);

  const label = (key: string) => { const f = fields.find((x) => x.key === key); return f ? t(f.labelKey) : key; };
  const issueText = (i: ImportIssue) => t('data.issue.' + i.code, { field: label(i.field), value: i.value ?? '' });
  const dupText = (r: PlanRow) => { const x = r.duplicate; if (!x) return ''; const by = t('data.by.' + x.by); return x.where === 'file' ? t('data.dup.file', { by, line: x.line ?? 0 }) : x.restricted ? t('data.dup.restricted', { by, name: x.name }) : t(x.where === 'lead' ? 'data.dup.lead' : 'data.dup.client', { by, name: x.name }); };
  const reason = (r: PlanRow) => (r.status === 'invalid' ? r.issues.map(issueText).join('; ') : dupText(r));

  const pick = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (f.size > MAX_BYTES) { setError(t('data.file.tooBig')); return; }
    try {
      const { header, rows } = parseCsvRecords(await readCsvFile(f));
      if (!header.length || header.every((h) => !h)) { setError(t('data.file.unreadable')); return; }
      if (!rows.length) { setError(t('data.file.empty')); return; }
      setFile({ name: f.name, header, rows }); setMapping(autoMap(header, kind)); setStep('columns');
    } catch { setError(t('data.file.unreadable')); }
  };
  const template = () => downloadCsv(`${kind}-template.csv`, templateRows(kind, (f) => t(f.labelKey), t('data.tpl.example')));

  // the dry run: worked out again whenever the mapping changes, and only once the person reaches that step
  const plan = useMemo(() => (file && step === 'check' ? planImport(world, kind, file.header, file.rows, mapping) : null), [file, step, world, kind, mapping]);
  const hasName = mapping.some((m) => m === 'name' || m === 'firstName' || m === 'lastName' || m === 'company');
  const hasContact = mapping.includes('email') || mapping.includes('phone');
  const setCol = (col: number, key: string) => setMapping((m) => m.map((x, i) => (i === col ? key : key && x === key ? '' : x)));

  const willAdd = plan ? plan.counts.fresh + also.filter((line) => plan.rows.some((r) => r.line === line && r.status === 'duplicate')).length : 0;
  const run = () => {
    if (!plan || !willAdd) return;
    const out = act(applyImport, { user, allClients }, plan, also);
    setResult({ plan, out, also }); setStep('done');
    toast(t('data.done.created', { n: out.created }));
  };
  const errorsFile = (p: ImportPlan, lines: number[]) => downloadCsv(`${kind}-${t('data.errors.file')}.csv`, errorRows(p, reason, t('data.errors.reason'), lines));

  const steps: Step[] = ['file', 'columns', 'check', 'done'];
  const shown = plan ? plan.rows.filter((r) => group === 'all' || r.status === group) : [];
  const footer = step === 'file' ? <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
    : step === 'columns' ? <><Button variant="ghost" onClick={() => { setStep('file'); setFile(null); }}>{t('data.back')}</Button><Button variant="primary" disabled={!hasName} onClick={() => { setAlso([]); setGroup('all'); setStep('check'); }} data-testid="data-import-next">{t('data.next')}</Button></>
      : step === 'check' ? <><Button variant="ghost" onClick={() => setStep('columns')}>{t('data.back')}</Button><Button variant="primary" disabled={!willAdd} onClick={run} data-testid="data-import-run">{willAdd ? t('data.check.go', { n: willAdd }) : t('data.check.nothing')}</Button></>
        : <Button variant="primary" onClick={onClose} data-testid="data-import-close">{t('data.done.close')}</Button>;

  return (
    <Modal title={t(kind === 'clients' ? 'data.importClients' : 'data.importLeads')} onClose={onClose} size="wide" labelClose={t('common.close')} footer={footer}>
      <ol className="data-steps" aria-label={t('data.steps')}>
        {steps.map((s, i) => <li key={s} className={cx(s === step && 'on', steps.indexOf(step) > i && 'past')} aria-current={s === step ? 'step' : undefined}><span aria-hidden="true">{i + 1}</span>{t('data.step.' + (s === 'done' ? 'done' : s))}</li>)}
      </ol>

      {step === 'file' && (
        <div className="stack" data-testid="data-import-file">
          <div>
            <h3>{t('data.file.title')}</h3>
            <p className="small muted data-gap">{t('data.file.hint')}</p>
          </div>
          <div className="data-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
            <LuFileSpreadsheet aria-hidden="true" />
            <input ref={input} type="file" accept=".csv,text/csv,text/plain" className="sr" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} aria-label={t('data.file.pick')} data-testid="data-import-input" />
            <Button variant="primary" icon={<LuUpload />} onClick={() => input.current?.click()} data-autofocus>{t('data.file.pick')}</Button>
            <button type="button" className="linkbtn small" onClick={template} data-testid="data-import-template">{t('data.file.template')}</button>
            <span className="xs dim">{t('data.file.templateHint')}</span>
          </div>
          {error && <p className="small neg" role="alert">{error}</p>}
          <p className="small muted data-secure"><LuLock aria-hidden="true" />{t('data.file.secure')}</p>
          {!live && <p className="xs dim">{t('data.file.sample')}</p>}
        </div>
      )}

      {step === 'columns' && file && (
        <div className="stack" data-testid="data-import-columns">
          <div>
            <h3>{t('data.cols.title')}</h3>
            <p className="small muted data-gap">{t('data.cols.hint')}</p>
            <p className="xs dim data-gap">{t('data.file.read', { name: file.name, n: file.rows.length, cols: file.header.length })} · {t('data.cols.matched', { n: mapping.filter(Boolean).length, total: file.header.length })}</p>
          </div>
          <div className="table-wrap data-map">
            <table className="tbl stackable">
              <thead><tr><th>{t('data.cols.column')}</th><th>{t('data.cols.example')}</th><th>{t('data.cols.goes')}</th></tr></thead>
              <tbody>
                {file.header.map((h, col) => {
                  const secure = isSecureColumn(h);
                  // the example of a tax ID column is not shown either: it never needs to be on this screen
                  const example = secure ? '' : file.rows.find((r) => (r[col] ?? '').trim())?.[col] ?? '';
                  return (
                    <tr key={col}>
                      <td className="t1">{h || <span className="dim">{col + 1}</span>}</td>
                      <td data-label={t('data.cols.example')}><span className="small muted data-clip">{example}</span></td>
                      <td data-label={t('data.cols.goes')}>
                        {secure ? <span className="small data-never"><LuLock aria-hidden="true" />{t('data.cols.secure')}</span> : (
                          <select className="input" value={mapping[col] ?? ''} onChange={(e) => setCol(col, e.target.value)} aria-label={`${t('data.cols.goes')}: ${h}`}>
                            <option value="">{t('data.cols.skip')}</option>
                            {fields.map((f) => <option key={f.key} value={f.key}>{t(f.labelKey)}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!hasName && <Note tone="bad">{t('data.cols.needName')}</Note>}
          {hasName && !hasContact && <Note tone="warn">{t('data.cols.needContact')}</Note>}
        </div>
      )}

      {step === 'check' && plan && (
        <div className="stack" data-testid="data-import-check">
          <div>
            <h3>{t('data.check.title')}</h3>
            <p className="small muted data-gap">{t('data.check.hint')}</p>
          </div>
          <div className="data-counts">
            <Count n={plan.counts.total} label={t('data.check.total')} />
            <Count n={plan.counts.fresh} label={t('data.check.fresh')} tone="ok" testId="data-count-new" />
            <Count n={plan.counts.duplicate} label={t('data.check.dup')} tone="warn" testId="data-count-dup" />
            <Count n={plan.counts.invalid} label={t('data.check.bad')} tone="bad" testId="data-count-bad" />
          </div>
          {plan.counts.examples > 0 && <p className="xs dim">{t('data.check.examples', { n: plan.counts.examples })}</p>}
          {kind === 'leads' && <p className="small muted">{t('data.check.leadsQuiet')}</p>}
          {!allClients && data.offices.length > 0 && <p className="small muted">{t('data.check.office')}</p>}
          <div className="row between data-bar">
            <Seg label={t('data.check.show')} value={group} onChange={setGroup} options={[
              { value: 'all', label: t('data.check.all'), count: plan.counts.total }, { value: 'new', label: t('data.check.fresh'), count: plan.counts.fresh },
              { value: 'duplicate', label: t('data.check.dup'), count: plan.counts.duplicate }, { value: 'invalid', label: t('data.check.bad'), count: plan.counts.invalid }]} />
            {plan.counts.invalid + plan.counts.duplicate > 0 && <Button size="sm" icon={<LuDownload />} onClick={() => errorsFile(plan, also)} data-testid="data-import-errors">{t('data.check.errors')}</Button>}
          </div>
          {shown.length ? (
            <div className="table-wrap data-preview">
              <table className="tbl stackable" data-testid="data-import-preview">
                <thead><tr><th>{t('data.check.line')}</th><th>{t('data.check.who')}</th><th>{t('data.check.contact')}</th><th>{t('data.check.result')}</th></tr></thead>
                <tbody>
                  {shown.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.line} data-status={r.status}>
                      <td className="num data-line" data-label={t('data.check.line')}>{r.line}</td>
                      <td className="t1">{String(r.values.name ?? '') || <span className="dim">{t('data.issue.no_name')}</span>}{r.values.company && r.values.company !== r.values.name ? <div className="xs dim">{String(r.values.company)}</div> : null}</td>
                      <td data-label={t('data.check.contact')}><span className="small">{[r.values.email, r.values.phone].filter(Boolean).join(' · ')}</span></td>
                      <td data-label={t('data.check.result')}>
                        {r.status === 'new' && <span className="data-res ok"><LuCircleCheck aria-hidden="true" />{t('data.check.willAdd')}</span>}
                        {r.status === 'invalid' && <span className="data-res bad"><LuCircleAlert aria-hidden="true" /><span>{r.issues.map(issueText).join('; ')}</span></span>}
                        {r.status === 'duplicate' && (
                          <span className="data-res warn"><LuCopy aria-hidden="true" />
                            <span>{dupText(r)}{r.duplicate?.id && <> · <a href={appPath(`/${r.duplicate.where === 'lead' ? 'leads' : 'clients'}/${r.duplicate.id}`)} target="_blank" rel="noopener noreferrer">{t('data.dup.open')}</a></>}
                              <label className="check data-anyway"><input type="checkbox" checked={also.includes(r.line)} onChange={(e) => setAlso((a) => (e.target.checked ? [...a, r.line] : a.filter((x) => x !== r.line)))} /><span>{t('data.check.addAnyway')}</span></label>
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="small muted">{t('data.check.noneInGroup')}</p>}
          {shown.length > PREVIEW_ROWS && <p className="xs dim">{t('data.check.first', { n: PREVIEW_ROWS, total: shown.length })}</p>}
        </div>
      )}

      {step === 'done' && result && (
        <div className="stack" data-testid="data-import-done">
          <h3>{t('data.done.title')}</h3>
          <ul className="data-result">
            <li>{t('data.done.created', { n: result.out.created })}</li>
            {result.out.skippedDuplicates > 0 && <li>{t('data.done.dup', { n: result.out.skippedDuplicates })}</li>}
            {result.out.invalid > 0 && <li>{t('data.done.bad', { n: result.out.invalid })}</li>}
          </ul>
          {result.out.skippedDuplicates + result.out.invalid > 0 && (
            <div>
              <Button icon={<LuDownload />} onClick={() => errorsFile(result.plan, result.also)} data-testid="data-import-errors">{t('data.done.errors')}</Button>
              <p className="xs dim data-gap">{t('data.done.errorsHint')}</p>
            </div>
          )}
          {!live && <p className="xs dim">{t('data.file.sample')}</p>}
        </div>
      )}
    </Modal>
  );
}

function Count({ n, label, tone, testId }: { n: number; label: string; tone?: 'ok' | 'warn' | 'bad'; testId?: string }) {
  return <div className={cx('data-count', n > 0 && tone)} data-testid={testId}><b>{n}</b><span>{label}</span></div>;
}
