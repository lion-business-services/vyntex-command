// Pipeline board: one column per stage of the company's pipeline. Drag a card, or use the Move menu on it.
import { useState } from 'react';
import { LuArrowRightLeft, LuChevronDown } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Avatar, cx } from '@/ui';
import { PriorityBadge, stageTone } from '@/app/shared';
import { byId } from '@/domain/selectors';
import { stagesOf } from '@/domain/config';
import type { Lead, LeadStage } from '@/domain/types';
import { money, sum } from '@/lib/money';
import type { LeadSignals } from './model';
import { ContactAge, HotMark, NextStepLine } from './parts';

/** A column shows this many cards at first. A pipeline with hundreds of leads in one stage stays quick to draw. */
const COLUMN_CARDS = 40;

export function Board({ leads, signals, onMove }: { leads: Lead[]; signals: (l: Lead) => LeadSignals; onMove: (l: Lead, to: LeadStage) => void }) {
  const { t, data, pack, can } = useApp();
  const stages = stagesOf(data, pack); const canWrite = can('write');
  const full = pack.family === 'practice';
  const [over, setOver] = useState<LeadStage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The card that was just moved and where to, so it can settle once in its new column. */
  const [landed, setLanded] = useState<{ id: string; to: LeadStage } | null>(null);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const moveTo = (l: Lead, to: LeadStage) => { if (l.status !== to) setLanded({ id: l.id, to }); onMove(l, to); };
  return (
    <div className="kanban leads-board" data-testid="leads-board">
      {stages.map((stage) => {
        const s = stage.id;
        const col = leads.filter((l) => l.status === s);
        const shown = more[s] ? col : col.slice(0, COLUMN_CARDS);
        return (
          <section key={s} className={cx('kcol', over === s && 'over')} aria-label={t('ls_' + s)} data-stage={s} data-tone={stageTone(stage)}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); const l = leads.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragging)); if (l) moveTo(l, s); setDragging(null); }}>
            <div className="kcol-h"><span>{t('ls_' + s)} <span className="count">{col.length}</span></span><span className="small muted">{money(sum(col, (l) => l.value))}</span></div>
            <div className="kcol-b">
              {shown.map((l) => {
                const sig = signals(l); const owner = full ? byId(data.users, l.ownerId) : undefined;
                return (
                  <article key={l.id} className={cx('kcard', dragging === l.id && 'drag', landed?.id === l.id && landed.to === l.status && 'landed')} draggable={canWrite} onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDragging(l.id); }} onDragEnd={() => { setDragging(null); setOver(null); }} data-lead={l.id}>
                    <div className="row between nowrap top"><A to={`/leads/${l.id}`} className="t leads-name">{l.name}</A><PriorityBadge pri={l.pri} /></div>
                    <div className="small muted">{t('ty_' + l.type)}{l.value ? ` · ${money(l.value)}` : ''}</div>
                    {sig.open && <div><NextStepLine lead={l} signals={sig} plain={!full} compact /></div>}
                    {full && sig.open && <div className="leads-kfoot">{owner ? <span className="row tight nowrap xs dim"><Avatar name={owner.name} size="sm" />{owner.name.split(' ')[0]}</span> : <span className="xs dim">{t('common.unassigned')}</span>}<span className="row tight nowrap"><HotMark signals={sig} /><ContactAge signals={sig} compact /></span></div>}
                    {canWrite && <label className="leads-move"><span><LuArrowRightLeft aria-hidden="true" />{t('leads.moveTo')}<LuChevronDown aria-hidden="true" /></span>
                      <select value={l.status} onChange={(e) => moveTo(l, e.target.value as LeadStage)} aria-label={`${t('leads.moveTo')}: ${l.name}`}>
                        {stages.map((x) => <option key={x.id} value={x.id}>{t('ls_' + x.id)}</option>)}
                      </select>
                    </label>}
                  </article>
                );
              })}
              {col.length > shown.length && <button type="button" className="linkbtn small leads-more" onClick={() => setMore((m) => ({ ...m, [s]: true }))}>{t('leads.showMore', { n: col.length - shown.length })}</button>}
              {!col.length && <p className="xs dim leads-drop">{t('leads.drop')}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
