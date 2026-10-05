// Settings: the company's own words. A business that calls its work "matters" or "cases" instead of the edition's word
// types its word once, per language, and every screen, document and message uses it. Clearing a word, or Reset, goes back
// to the edition's wording. The words are kept in the company's configuration (`config.terms`).
import { useEffect, useMemo, useState } from 'react';
import { LuRotateCcw } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { Button, Card, cx, toast } from '@/ui';
import { makeT } from '@/i18n';
import type { Lang } from '@/domain/types';
import { DEPLOY } from '@/config/deployment';
import { setTerms, type TermKey } from './actions';

type Draft = Partial<Record<Lang, Partial<Record<TermKey, string>>>>;
/** The nouns a company can rename: one of something and several, as they are written at the start of a sentence. */
const ROWS: { one: TermKey; many: TermKey; label: string; workers?: boolean }[] = [
  { one: 'project', many: 'projects', label: 'settings.words.job' },
  { one: 'client', many: 'clients', label: 'settings.words.client' },
  { one: 'sub', many: 'workersPlural', label: 'settings.words.worker', workers: true },
];

export default function WordingSection() {
  const { t, data, pack } = useApp();
  // the two languages every screen has, and Chinese where this deployment offers it
  const langs = DEPLOY.languages.filter((l): l is Lang => l === 'en' || l === 'es' || l === 'zh');
  const saved = useMemo<Draft>(() => Object.fromEntries(langs.map((l) => [l, { ...(data.config.terms?.[l] ?? {}) }])) as Draft, [data.config.terms]);
  const [draft, setDraft] = useState<Draft>(saved);
  useEffect(() => { setDraft(saved); }, [saved]);
  const rows = ROWS.filter((r) => !r.workers || pack.usesWorkers);
  const keys = rows.flatMap((r) => [r.one, r.many]);
  const val = (d: Draft, l: Lang, k: TermKey) => (d[l]?.[k] ?? '').trim();
  const dirty = langs.some((l) => keys.some((k) => val(draft, l, k) !== val(saved, l, k)));
  const any = langs.some((l) => keys.some((k) => val(saved, l, k)));
  // the edition's own word, read without the company's wording on top
  const shipped = (l: Lang, k: TermKey) => { const base = makeT(l, pack); const word = base(k); return word === k ? (k === 'workersPlural' ? base('subs') : '') : word; };
  // what a few real lines would read like with the draft
  const preview = (l: Lang) => { const tt = makeT(l, pack, { ...data.config, terms: draft as Record<Lang, Record<string, string>> }); return [tt('nav.jobs'), tt('newProject'), tt('nav.clients'), tt('common.since')]; };
  const set = (l: Lang, k: TermKey, v: string) => setDraft((d) => ({ ...d, [l]: { ...(d[l] ?? {}), [k]: v } }));
  const save = () => { act(setTerms, draft); toast(t('settings.words.saved')); };
  const reset = () => { act(setTerms, null); toast(t('settings.words.resetDone')); };

  return (
    <Card title={t('settings.words.title')} actions={any ? <Button size="sm" variant="ghost" icon={<LuRotateCcw aria-hidden="true" />} onClick={reset} data-testid="settings-words-reset">{t('settings.words.reset')}</Button> : undefined}>
      <p className="muted settings-lead">{t('settings.words.intro')}</p>
      <div className="settings-words" data-testid="settings-words">
        {langs.map((l) => (
          <fieldset key={l} className="settings-wordset" data-lang={l}>
            <legend>{t('lang.' + l)}</legend>
            {rows.map((r) => (
              <div className="settings-wordrow" key={r.one}>
                <span className="label">{t(r.label)}</span>
                <label><span className="xs dim">{t('settings.words.one')}</span><input className="input" lang={l} value={draft[l]?.[r.one] ?? ''} onChange={(e) => set(l, r.one, e.target.value)} placeholder={shipped(l, r.one)} maxLength={40} data-testid={`settings-word-${l}-${r.one}`} /></label>
                <label><span className="xs dim">{t('settings.words.many')}</span><input className="input" lang={l} value={draft[l]?.[r.many] ?? ''} onChange={(e) => set(l, r.many, e.target.value)} placeholder={shipped(l, r.many)} maxLength={40} data-testid={`settings-word-${l}-${r.many}`} /></label>
              </div>
            ))}
            <p className="xs dim settings-wordpv" lang={l} data-testid={`settings-words-preview-${l}`}>{t('settings.words.reads')}: {preview(l).join(' · ')}</p>
          </fieldset>
        ))}
      </div>
      <p className="xs dim" style={{ marginTop: 12 }}>{t('settings.words.note')}</p>
      <div className="card-foot">
        <span className={cx('small', dirty ? 'strong' : 'muted')}>{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
        <div className="row">
          {dirty && <Button variant="ghost" onClick={() => setDraft(saved)}>{t('settings.biz.discard')}</Button>}
          <Button variant="primary" onClick={save} disabled={!dirty} data-testid="settings-words-save">{t('settings.biz.save')}</Button>
        </div>
      </div>
    </Card>
  );
}
