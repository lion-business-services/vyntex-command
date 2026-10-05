// "Everything connected": the product lockup in the centre and the eleven parts of the business around it, joined by
// circuit lines that draw in toward the centre once. Pointing at a part, or moving to it with the keyboard, brightens its
// line and says in one sentence what it is and what it connects to. Narrow screens get the same sentences as a list.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/hooks';
import { Lockup, Reveal, useInView } from '@/brand';
import { BRAND } from '@/config/brand';
import { pick } from '@/i18n';
import { cx } from '@/ui';
import { Head, useMedia } from './shared';
import './connected.css';

type NodeId = 'crm' | 'clients' | 'jobs' | 'tasks' | 'team' | 'calendar' | 'documents' | 'payments' | 'comms' | 'reports' | 'ai';
interface PartDef {
  id: NodeId;
  /** Wording key of the name: the workspace's own menu label where there is one. */
  label: string;
  /** Position in the 1000 by 560 drawing, and the circuit line from the part into the centre. */
  x: number; y: number; d: string;
  links: NodeId[];
}
/** In reading order: the path of a job first, the assistant last. Positions run clockwise from the top right; the assistant sits at the top. */
const PARTS: PartDef[] = [
  { id: 'crm', label: 'mk.s.co.crm', x: 727, y: 85, d: 'M727 85H680L590 175', links: ['clients', 'jobs', 'calendar'] },
  { id: 'clients', label: 'nav.clients', x: 882, y: 184, d: 'M882 184H755L704 235H680', links: ['crm', 'jobs', 'payments'] },
  { id: 'jobs', label: 'nav.jobs', x: 916, y: 313, d: 'M916 313H737L704 280H680', links: ['clients', 'team', 'documents', 'payments'] },
  { id: 'tasks', label: 'nav.tasks', x: 817, y: 432, d: 'M817 432H811L704 325H680', links: ['jobs', 'team', 'calendar'] },
  { id: 'team', label: 'nav.team', x: 618, y: 503, d: 'M618 503V457L570 409V385', links: ['jobs', 'tasks', 'payments'] },
  { id: 'calendar', label: 'nav.calendar', x: 382, y: 503, d: 'M382 503V457L430 409V385', links: ['crm', 'jobs', 'tasks'] },
  { id: 'documents', label: 'nav.documents', x: 183, y: 432, d: 'M183 432H189L296 325H320', links: ['clients', 'jobs', 'payments'] },
  { id: 'payments', label: 'nav.money', x: 84, y: 313, d: 'M84 313H263L296 280H320', links: ['clients', 'jobs', 'reports'] },
  { id: 'comms', label: 'mk.s.co.comms', x: 118, y: 184, d: 'M118 184H245L296 235H320', links: ['clients', 'jobs', 'documents'] },
  { id: 'reports', label: 'nav.reports', x: 273, y: 85, d: 'M273 85H320L410 175', links: ['jobs', 'payments', 'team'] },
  { id: 'ai', label: 'mk.s.ai.name', x: 500, y: 48, d: 'M500 48V175', links: ['tasks', 'crm', 'payments'] },
];
const W = 1000, H = 560;
/** Where a line meets the centre: the last point of its path. */
function endOf(d: string): [number, number] {
  let x = 0, y = 0;
  for (const m of d.matchAll(/([MLHV])(-?\d+)(?: (-?\d+))?/g)) {
    if (m[1] === 'H') x = Number(m[2]); else if (m[1] === 'V') y = Number(m[2]); else { x = Number(m[2]); y = Number(m[3]); }
  }
  return [x, y];
}

export function ConnectedSection() {
  const { t, lang } = useApp();
  const diagram = useMedia('(min-width: 1024px)');
  const { ref, seen } = useInView<HTMLDivElement>('0px 0px -15% 0px');
  const [active, setActive] = useState<NodeId | null>(null);
  // once the lines are drawn, the centre of the business (the job) is shown as the example, unless the visitor chose first
  const touched = useRef(false);
  useEffect(() => {
    if (!seen || !diagram) return;
    const id = window.setTimeout(() => { if (!touched.current) setActive('jobs'); }, 1500);
    return () => window.clearTimeout(id);
  }, [seen, diagram]);
  const choose = (id: NodeId) => { touched.current = true; setActive(id); };
  const name = (id: NodeId) => t(PARTS.find((p) => p.id === id)!.label);
  const joins = (p: PartDef) => t('mk.s.co.joins', { list: p.links.map(name).join(', ') });
  const cur = PARTS.find((p) => p.id === active);

  return (
    <section className="mks mks-co" aria-labelledby="mks-co-h">
      <Head id="mks-co-h" className="center" title={t('mk.s.co.h')} sub={t('mk.s.co.sub')} />
      {diagram ? (
        <Reveal kind="panel">
          <div className={cx('mks-co-map', seen && 'in')} ref={ref} data-active={active ?? undefined} data-testid="mk-co-map">
            <svg className="mks-co-lines" viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true">
              {PARTS.map((p, i) => (
                <g key={p.id} className={cx(active === p.id && 'on', !!cur && cur.links.includes(p.id) && 'near')} style={{ ['--i' as string]: i }}>
                  <path className="base" d={p.d} pathLength={100} />
                  <path className="hot" d={p.d} pathLength={100} />
                  <path className="run" d={p.d} pathLength={100} />
                  <circle className="port" cx={endOf(p.d)[0]} cy={endOf(p.d)[1]} r="3.5" />
                </g>
              ))}
            </svg>
            <div className="mks-co-hub">
              <Lockup size="md" />
              <div className="mks-co-say" data-testid="mk-co-say">
                {cur ? <><p><b>{name(cur.id)}.</b> {t(`mk.s.co.${cur.id}.p`)}</p><p className="mks-co-joins">{joins(cur)}</p></> : <p className="mks-co-tag">{pick(BRAND.descriptor, lang)}</p>}
              </div>
            </div>
            <ul className="mks-co-nodes">
              {PARTS.map((p) => (
                <li key={p.id} style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}>
                  <button type="button" className={cx('mks-co-node', p.id === 'ai' && 'ai', active === p.id && 'on', !!cur && cur.links.includes(p.id) && 'near')}
                    aria-describedby={`mks-co-d-${p.id}`}
                    onMouseEnter={() => choose(p.id)} onFocus={() => choose(p.id)} onClick={() => choose(p.id)} data-testid={`mk-co-node-${p.id}`}>
                    {name(p.id)}
                  </button>
                  <span id={`mks-co-d-${p.id}`} hidden>{t(`mk.s.co.${p.id}.p`)} {joins(p)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mks-co-hint">{t('mk.s.co.hint')}</p>
        </Reveal>
      ) : (
        <div className="mks-co-stack">
          <Reveal className="mks-co-top"><Lockup size="md" tagline={pick(BRAND.descriptor, lang)} /></Reveal>
          <ul className="mks-co-list" data-testid="mk-co-list">
            {PARTS.map((p, i) => (
              <Reveal as="li" key={p.id} delay={Math.min(i, 6) * 40} className={p.id === 'ai' ? 'ai' : undefined}>
                <b>{name(p.id)}</b>
                <span>{t(`mk.s.co.${p.id}.p`)}</span>
                <small>{joins(p)}</small>
              </Reveal>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
