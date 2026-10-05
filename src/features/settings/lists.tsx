// Settings: the company's own lists (kinds of task, kinds of client) and the prefix of its numbers.
// A list starts as the edition ships it. A company renames, adds and removes entries; an entry that records still use
// cannot be removed, and "To do" always stays. Reset goes back to the edition's list.
import { useEffect, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuPlus, LuRotateCcw, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { act, ctx } from '@/store/store';
import { Badge, Button, Card, IconButton, cx, toast } from '@/ui';
import type { OptionDef } from '@/domain/types';
import { clientTypesOf, taskTypesOf } from '@/domain/config';
import { nextJobNumber, nextTicket } from '@/domain/actions';
import { cleanPrefix, optionId, optionUse, ownPrefix, setNumberPrefix, setOptionList, type ListKey } from './actions';

export default function ListsSection() {
  return (
    <>
      <ListCard list="taskTypes" />
      <ListCard list="clientTypes" />
      <NumberingCard />
    </>
  );
}

function ListCard({ list }: { list: ListKey }) {
  const { t, data, pack } = useApp();
  const saved = list === 'taskTypes' ? taskTypesOf(data, pack) : clientTypesOf(data, pack);
  const own = !!data.config[list]?.length;
  const [rows, setRows] = useState<OptionDef[]>(saved);
  const [err, setErr] = useState('');
  useEffect(() => { setRows(saved); setErr(''); }, [JSON.stringify(saved)]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const patch = (i: number, lang: 'en' | 'es', v: string) => { setErr(''); setRows((r) => r.map((o, at) => (at === i ? { ...o, label: { ...o.label, [lang]: v } } : o))); };
  const move = (i: number, by: number) => setRows((r) => { const next = [...r]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); return next; });
  // a new entry gets its id when it is saved, from its English name
  const add = () => setRows((r) => [...r, { id: '', label: { en: '', es: '' } }]);
  const remove = (i: number) => { const o = rows[i]; const n = o.id ? optionUse(data, list, o.id) : 0; if (n) { setErr(t('settings.lists.inUse', { name: o.label.en, n })); return; } setErr(''); setRows((r) => r.filter((_, at) => at !== i)); };
  const save = () => {
    if (rows.some((o) => !o.label.en.trim())) { setErr(t('settings.lists.needName')); return; }
    const taken = rows.map((o) => o.id).filter(Boolean);
    const next = rows.map((o) => { if (o.id) return o; const id = optionId(o.label.en, taken); taken.push(id); return { ...o, id }; });
    if (!act(setOptionList, list, next)) { setErr(t('settings.lists.invalid')); return; }
    toast(t('settings.lists.saved'));
  };
  const reset = () => { act(setOptionList, list, null); toast(t('settings.lists.resetDone')); };
  return (
    <Card title={t('settings.lists.' + list)} actions={own ? <Button size="sm" variant="ghost" icon={<LuRotateCcw aria-hidden="true" />} onClick={reset} data-testid={`settings-list-reset-${list}`}>{t('settings.lists.reset')}</Button> : undefined}>
      <p className="muted settings-lead">{t('settings.lists.' + list + '.d')}</p>
      <div className="settings-list" data-testid={`settings-list-${list}`}>
        <div className="settings-listrow head" aria-hidden="true"><span>{t('lang.en')}</span><span>{t('lang.es')}</span><span /></div>
        {rows.map((o, i) => {
          const fixed = list === 'taskTypes' && o.id === 'todo'; const n = o.id ? optionUse(data, list, o.id) : 0;
          return (
            <div className="settings-listrow" key={o.id || 'new' + i}>
              <input className="input" value={o.label.en} onChange={(e) => patch(i, 'en', e.target.value)} maxLength={40} lang="en" aria-label={`${t('lang.en')}: ${o.label.en || t('settings.lists.new')}`} placeholder={t('settings.lists.namePh')} data-testid={`settings-list-en-${list}`} />
              <input className="input" value={o.label.es} onChange={(e) => patch(i, 'es', e.target.value)} maxLength={40} lang="es" aria-label={`${t('lang.es')}: ${o.label.en || t('settings.lists.new')}`} placeholder={o.label.en} />
              <span className="row tight nowrap settings-listact">
                {n > 0 && <Badge title={t('settings.lists.used', { n })}>{n}</Badge>}
                <IconButton size="sm" label={`${t('settings.lists.up')}: ${o.label.en}`} onClick={() => move(i, -1)} disabled={i === 0}><LuArrowUp /></IconButton>
                <IconButton size="sm" label={`${t('settings.lists.down')}: ${o.label.en}`} onClick={() => move(i, 1)} disabled={i === rows.length - 1}><LuArrowDown /></IconButton>
                <IconButton size="sm" label={`${t('common.delete')}: ${o.label.en}`} onClick={() => remove(i)} disabled={fixed || rows.length === 1} title={fixed ? t('settings.lists.fixed') : undefined} data-testid={`settings-list-remove-${list}`}><LuTrash2 /></IconButton>
              </span>
            </div>
          );
        })}
      </div>
      <Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={add} style={{ marginTop: 10 }} data-testid={`settings-list-add-${list}`}>{t('settings.lists.add')}</Button>
      {err && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{err}</p>}
      <div className="card-foot">
        <span className={cx('small', dirty ? 'strong' : 'muted')}>{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
        <div className="row">
          {dirty && <Button variant="ghost" onClick={() => { setRows(saved); setErr(''); }}>{t('settings.biz.discard')}</Button>}
          <Button variant="primary" onClick={save} disabled={!dirty} data-testid={`settings-list-save-${list}`}>{t('settings.biz.save')}</Button>
        </div>
      </div>
    </Card>
  );
}

/* ---------- numbering ---------- */
/**
 * The prefix in front of lead tickets and the numbers of jobs and documents. The company's own prefix is kept in the
 * workspace settings; the parts of the app that hand out numbers read it from there. Whether they do is checked here against
 * the real numbering function, so the field to change it appears only once a changed prefix would actually be used.
 */
function NumberingCard() {
  const { t, data, pack } = useApp();
  const saved = ownPrefix(data) || pack.ticketPrefix;
  const [v, setV] = useState(saved);
  useEffect(() => { setV(saved); }, [saved]);
  const c = ctx();
  const probe = 'QZ-';
  const honoured = nextTicket({ ...data, settings: { ...data.settings, numbering: { prefix: probe } } }, c).startsWith(probe);
  const shown = (prefix: string) => { const d = honoured ? { ...data, settings: { ...data.settings, numbering: { prefix } } } : data; return [nextTicket(d, c), nextJobNumber(d, c)]; };
  const [ticket, job] = shown(cleanPrefix(v) || pack.ticketPrefix);
  const dirty = (cleanPrefix(v) || pack.ticketPrefix) !== saved;
  return (
    <Card title={t('settings.num.title')}>
      <p className="muted settings-lead">{t('settings.num.intro')}</p>
      <dl className="kv settings-num" data-testid="settings-numbering">
        <dt>{t('settings.num.prefix')}</dt>
        <dd>{honoured ? <input className="input settings-prefix" value={v} onChange={(e) => setV(cleanPrefix(e.target.value))} maxLength={6} aria-label={t('settings.num.prefix')} data-testid="settings-prefix" /> : <b className="settings-mono">{saved}</b>}</dd>
        <dt>{t('settings.num.nextLead')}</dt><dd className="settings-mono">{ticket}</dd>
        <dt>{t('settings.num.nextJob')}</dt><dd className="settings-mono">{job}</dd>
      </dl>
      {honoured ? (
        <div className="card-foot">
          <span className={cx('small', dirty ? 'strong' : 'muted')}>{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
          <div className="row">
            {saved !== pack.ticketPrefix && <Button variant="ghost" onClick={() => { act(setNumberPrefix, ''); toast(t('settings.num.resetDone')); }}>{t('settings.num.reset')}</Button>}
            <Button variant="primary" disabled={!dirty} onClick={() => { act(setNumberPrefix, v); toast(t('settings.num.saved')); }} data-testid="settings-prefix-save">{t('settings.biz.save')}</Button>
          </div>
        </div>
      ) : <p className="xs dim" style={{ marginTop: 10 }}>{t('settings.num.fixed')}</p>}
    </Card>
  );
}
