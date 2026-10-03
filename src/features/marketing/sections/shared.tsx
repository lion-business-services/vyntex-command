// Pieces shared by the story sections of the overview page: the section heading, the framed sample-company window,
// the link into the live demo and a media-query hook. Layout and spacing live in sections.css.
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '@/app/hooks';
import { Link, appPath } from '@/app/router';
import { Arrow, Frame, Reveal } from '@/brand';
import type { IndustryPack } from '@/packs/types';
import { cx } from '@/ui';
import './sections.css';

/** True while the media query matches. Read once on mount, then kept in step with the viewport. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query); const change = () => setOn(m.matches);
    change(); m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, [query]);
  return on;
}

/** Section heading: one title and one supporting sentence, revealed together. */
export function Head({ id, title, sub, className }: { id: string; title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <header className={cx('mks-head', className)}>
      <Reveal as="h2" id={id} className="mks-h2">{title}</Reveal>
      {sub && <Reveal as="p" className="mks-sub" delay={90}>{sub}</Reveal>}
    </header>
  );
}

/** A quiet link into the live demo, with the arrow that shifts on hover. `to` is a path inside the workspace. */
export function DemoLink({ to, children, testId, className }: { to: string; children: ReactNode; testId?: string; className?: string }) {
  return <Link to={to.startsWith('/demo') ? to : appPath(to)} className={cx('mks-link', className)} data-testid={testId}>{children}<Arrow /></Link>;
}

/** The product window around real UI built from the sample company. Always says that the company is a sample. */
export function SampleFrame({ page, children, className }: { page: ReactNode; children: ReactNode; className?: string }) {
  const { data, t } = useApp();
  return (
    <Frame className={cx('mks-frame', className)} title={page} sub={data.company.name} badge={data.company.initials} note={t('mk.s.sample')}>
      {children}
    </Frame>
  );
}

/** Product name of an edition set like the lockup: the first word in chrome, the edition word in the blue spectrum. */
export function EditionName({ pack }: { pack: IndustryPack }) {
  const at = pack.product.indexOf(' ');
  if (at < 0) return <span className="mks-edition"><span className="chrome-text">{pack.product}</span></span>;
  return <span className="mks-edition"><span className="chrome-text">{pack.product.slice(0, at)}</span> <span className="brand-text">{pack.product.slice(at + 1)}</span></span>;
}
