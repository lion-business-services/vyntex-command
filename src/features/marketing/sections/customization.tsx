// Customization made tangible: one small product window whose identity changes with the chosen example brand.
// The three brands are illustrations (and say so). Their accent colours are the presets the Settings page offers, applied
// through the same CSS variables the workspace uses, and every word in the window comes from a real industry pack.
import { useEffect, useState } from 'react';
import { LuBriefcase, LuCalendarDays, LuChevronRight, LuHardHat, LuPlus, LuUserPlus, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Frame, Lockup, Reveal, useInView, usePrefersReducedMotion } from '@/brand';
import type { IndustryId } from '@/domain/types';
import { ACCENT_PRESETS, accentVars, suggestInitials } from '@/features/settings/helpers';
import { makeT } from '@/i18n';
import { PACKS } from '@/packs';
import { cx } from '@/ui';
import { DemoLink, Head } from './shared';
import './customization.css';

/** Example brands: a wording key for the made-up name, the edition whose vocabulary it uses, and one of the Settings accent presets. */
const BRANDS: { id: string; pack: IndustryId; accent: string }[] = [
  { id: 'b1', pack: 'landscape', accent: ACCENT_PRESETS[5] },
  { id: 'b2', pack: 'haul', accent: ACCENT_PRESETS[0] },
  { id: 'b3', pack: 'events', accent: ACCENT_PRESETS[2] },
];
const YOURS = ['brand', 'services', 'workflows', 'team', 'industry'] as const;
/** Time each brand stays up while the window cycles by itself, once. */
const HOLD = 1900;

export function CustomizationSection() {
  const { t, lang } = useApp();
  const reduced = usePrefersReducedMotion();
  const { ref, seen, visible } = useInView<HTMLDivElement>('0px 0px -25% 0px');
  const [at, setAt] = useState(0);
  // the tour: b1, b2, b3 and back to b1, started once the window is on screen and dropped the moment the visitor picks
  const [tour, setTour] = useState({ over: false, hops: 0 });
  useEffect(() => {
    if (reduced || !seen || !visible || tour.over) return;
    const id = window.setTimeout(() => {
      setAt((tour.hops + 1) % BRANDS.length);
      setTour({ over: tour.hops + 1 >= BRANDS.length, hops: tour.hops + 1 });
    }, HOLD);
    return () => window.clearTimeout(id);
  }, [reduced, seen, visible, tour]);
  const choose = (i: number) => { setTour((x) => ({ ...x, over: true })); setAt(i); };

  return (
    <section className="mks mks-cu" aria-labelledby="mks-cu-h">
      <Head id="mks-cu-h" title={t('mk.s.cu.h')} sub={t('mk.s.cu.sub')} />
      <div className="mks-cu-grid">
        <Reveal kind="panel" className="mks-cu-stage">
          <div className="mks-cu-windows" ref={ref} data-testid="mk-cu-window" data-brand={BRANDS[at].id}>
            {BRANDS.map((b, i) => <BrandWindow key={b.id} brand={b} on={i === at} />)}
          </div>
        </Reveal>
        <div className="mks-cu-side">
          <Reveal className="mks-cu-pick">
            <p id="mks-cu-pick-l">{t('mk.s.cu.pick')}</p>
            <div className="mks-cu-brands" role="group" aria-labelledby="mks-cu-pick-l">
              {BRANDS.map((b, i) => {
                const name = t(`mk.s.cu.${b.id}`);
                return (
                  <button key={b.id} type="button" aria-pressed={i === at} onClick={() => choose(i)} style={accentVars(b.accent) as React.CSSProperties} data-testid={`mk-cu-brand-${b.id}`}>
                    <i aria-hidden="true">{suggestInitials(name)}</i>
                    <span><b>{name}</b><small>{PACKS[b.pack].label[lang]}</small></span>
                  </button>
                );
              })}
            </div>
          </Reveal>
          <Reveal className="mks-cu-end" delay={120}>
            <p className="mks-cu-changes">{t('mk.s.cu.changes')}</p>
            <DemoLink to="/settings" testId="mk-cu-demo">{t('mk.s.cu.link')}</DemoLink>
          </Reveal>
        </div>
      </div>
      <dl className="mks-cu-yours">
        {YOURS.map((k, i) => (
          <Reveal key={k} delay={i * 60}><dt>{t(`mk.s.cu.${k}.h`)}</dt><dd>{t(`mk.s.cu.${k}.p`)}</dd></Reveal>
        ))}
      </dl>
      <Reveal as="p" className="mks-cu-powered" delay={120}><span>{t('mk.s.cu.powered')}</span><Lockup size="sm" /></Reveal>
    </section>
  );
}

/** One brand applied to the product window: name, initials, accent colour and the vocabulary of its edition. */
function BrandWindow({ brand, on }: { brand: (typeof BRANDS)[number]; on: boolean }) {
  const { t, lang } = useApp();
  const pack = PACKS[brand.pack];
  const bt = makeT(lang, pack);
  const name = t(`mk.s.cu.${brand.id}`);
  const nav = [
    { k: 'nav.leads', icon: <LuUserPlus aria-hidden="true" /> }, { k: 'nav.clients', icon: <LuUsers aria-hidden="true" /> }, { k: 'nav.jobs', icon: <LuBriefcase aria-hidden="true" />, on: true },
    { k: 'nav.team', icon: <LuHardHat aria-hidden="true" /> }, { k: 'nav.calendar', icon: <LuCalendarDays aria-hidden="true" /> },
  ];
  return (
    <div className={cx('mks-cu-win', on && 'on')} style={accentVars(brand.accent) as React.CSSProperties} aria-hidden={!on} data-pack={pack.id}>
      <Frame className="mks-frame" title={name} sub={pack.label[lang]} badge={suggestInitials(name)} note={t('mk.s.cu.example')}>
        <div className="mks-cu-app">
          <ul className="mks-cu-nav">
            {nav.map((n) => <li key={n.k} className={n.on ? 'on' : undefined}>{n.icon}<span>{bt(n.k)}</span></li>)}
          </ul>
          <div className="mks-cu-main">
            <div className="mks-cu-row">
              <h3>{bt('nav.jobs')}</h3>
              <span className="mks-cu-new"><LuPlus aria-hidden="true" />{bt('mk.s.cu.new')}</span>
            </div>
            <p className="mks-cu-k">{t('mk.s.cu.services')}</p>
            <ul className="mks-cu-types">{pack.serviceTypes.filter((s) => s.id !== 'other').slice(0, 4).map((s, i) => <li key={s.id} className={i === 0 ? 'on' : undefined}>{s[lang]}</li>)}</ul>
            <p className="mks-cu-k">{t('mk.s.cu.statuses')}</p>
            <ol className="mks-cu-flow">{pack.jobStatuses.map((s, i) => <li key={s}>{i > 0 && <LuChevronRight aria-hidden="true" />}{bt('st_' + s)}</li>)}</ol>
            {pack.kickoffTasks.length > 0 && (
              <>
                <p className="mks-cu-k">{t('mk.s.cu.kickoff')}</p>
                <ul className="mks-cu-tasks">{pack.kickoffTasks.slice(0, 3).map((k, i) => <li key={i}><i aria-hidden="true" />{k[lang]}</li>)}</ul>
              </>
            )}
          </div>
        </div>
      </Frame>
    </div>
  );
}
