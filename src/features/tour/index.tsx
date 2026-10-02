// Guided tour: a short walk through the workspace. Each step opens a page and points at the real control.
// Optional, skippable at any time (Esc), and it never blocks the page behind it from being used afterwards.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { appPath, currentUrl, navigate, useRoute } from '@/app/router';
import { Button, IconButton } from '@/ui';
import type { Permission } from '@/domain/permissions';
import './tour.css';

interface Step { id: string; to: string; target?: string; perm?: Permission; body?: string }
const STEPS: Step[] = [
  { id: 'welcome', to: '', target: '[data-testid="industry"]' },
  { id: 'dash', to: '', target: '[data-testid="dash-attention"]' },
  { id: 'leads', to: '/leads?view=board', target: '[data-testid="leads-board"]', perm: 'leads' },
  { id: 'jobs', to: '/jobs', target: '[data-testid="jobs-table"]', perm: 'jobs' },
  { id: 'tasks', to: '/tasks', target: '[data-testid="tasks-board"]', perm: 'tasks' },
  { id: 'docs', to: '/documents', target: '[data-testid="docs-table"]', perm: 'documents' },
  { id: 'pay', to: '/payments', target: '.kpis', perm: 'money' },
  { id: 'auto', to: '/automations', target: '[data-testid="auto-try"]', perm: 'automations' },
  { id: 'plan', to: '', target: '[data-testid="plan"]' },
  { id: 'end', to: '' },
];
interface Box { top: number; left: number; width: number; height: number }

export function Tour({ onClose }: { onClose: () => void }) {
  const { t, data, can, isWorker } = useApp();
  const route = useRoute();
  const steps = useMemo(() => (isWorker ? [] : STEPS.filter((s) => !s.perm || can(s.perm))), [isWorker, can]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  // open the page of the step
  useEffect(() => {
    if (!step) return;
    const want = appPath(step.to);
    if (currentUrl() !== want) navigate(want);
  }, [step]);

  // find the control the step points at (pages load on demand, so look for a moment) and keep the highlight on its visible part
  const measure = useCallback(() => {
    const el = step?.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (!el || el.offsetParent === null) { setBox(null); return false; }
    const r = el.getBoundingClientRect();
    const pad = 6; const vh = window.innerHeight;
    const top = Math.max(r.top - pad, 8); const bottom = Math.min(r.bottom + pad, vh * 0.62);
    if (bottom - top < 24) { setBox(null); return true; }
    setBox({ top, left: Math.max(4, r.left - pad), width: Math.min(window.innerWidth - 8, r.width + pad * 2), height: bottom - top });
    return true;
  }, [step]);
  useEffect(() => {
    let tries = 0; let stop = false; const timers: number[] = [];
    setBox(null);
    const place = () => {
      const el = step?.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
      if (!el || el.offsetParent === null) return false;
      // bring the top of the control just under the top bars; tall tables and boards are highlighted from their top
      const r = el.getBoundingClientRect();
      if (r.top < 120 || r.top > window.innerHeight * 0.45) window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 150) });
      measure();
      return true;
    };
    const look = () => {
      if (stop) return;
      if (place()) { for (const ms of [200, 500, 1000, 1800]) timers.push(window.setTimeout(() => { if (!stop) measure(); }, ms)); return; }
      if (step?.target && tries++ < 25) timers.push(window.setTimeout(look, 80));
    };
    look();
    const again = () => measure();
    window.addEventListener('resize', again); window.addEventListener('scroll', again, true);
    return () => { stop = true; timers.forEach((x) => window.clearTimeout(x)); window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); };
  }, [step, route.path, measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'ArrowRight') setI((n) => Math.min(steps.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [onClose, steps.length]);
  useLayoutEffect(() => { card.current?.focus(); }, [i]);

  if (isWorker || !step) {
    return (
      <div className="tour-card center" role="dialog" aria-label={t('tour.label')} ref={card} tabIndex={-1}>
        <h2>{t('tour.worker.title')}</h2><p>{t('tour.worker.body')}</p>
        <div className="tour-f"><span /><Button variant="primary" onClick={onClose}>{t('common.close')}</Button></div>
      </div>
    );
  }

  // place the card under the highlighted control when there is room, above it otherwise; on phones and when nothing fits it docks at the bottom
  const narrow = window.innerWidth < 720;
  let style: Record<string, string | number> | undefined;
  let dock = narrow ? ' bottom' : ' center';
  if (box && !narrow) {
    const w = 380; const cardH = 250; const vh = window.innerHeight;
    const left = Math.min(Math.max(12, box.left), window.innerWidth - w - 12);
    const below = box.top + box.height + 12;
    if (below + cardH < vh) style = { top: below, left, width: w };
    else if (box.top - cardH - 12 > 8) style = { top: box.top - cardH - 12, left, width: w };
    else dock = ' corner';
  }
  const bodyKey = step.id === 'plan' && window.innerWidth <= 1180 ? 'tour.planNarrow.body' : `tour.${step.id}.body`;
  return (
    <>
      {box && <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" />}
      {!box && <div className="tour-dim" aria-hidden="true" />}
      <div className={'tour-card' + (style ? '' : dock)} style={style} role="dialog" aria-label={t('tour.label')} ref={card} tabIndex={-1} data-testid="tour-card" data-step={step.id}>
        <div className="tour-h"><span className="xs dim">{t('tour.step', { n: i + 1, total: steps.length })}</span><IconButton size="sm" label={t('tour.skip')} onClick={onClose}><LuX /></IconButton></div>
        <h2>{t(`tour.${step.id}.title`, { company: data.company.name })}</h2>
        <p>{t(bodyKey)}</p>
        <div className="tour-bar" aria-hidden="true"><span style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
        <div className="tour-f">
          {i > 0 ? <Button variant="ghost" size="sm" onClick={() => setI(i - 1)} data-testid="tour-back">{t('tour.back')}</Button> : <Button variant="ghost" size="sm" onClick={onClose}>{t('tour.skip')}</Button>}
          {last ? (
            <span className="row">
              <Button size="sm" onClick={() => { onClose(); navigate('/pricing'); }}>{t('tour.end.pricing')}</Button>
              <Button size="sm" variant="primary" onClick={() => { onClose(); navigate('/request-demo'); }} data-testid="tour-request">{t('tour.end.request')}</Button>
            </span>
          ) : <Button variant="primary" size="sm" onClick={() => setI(i + 1)} data-testid="tour-next">{t('tour.next')}</Button>}
        </div>
      </div>
    </>
  );
}
