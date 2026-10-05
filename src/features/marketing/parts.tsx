// Pieces shared by the three public pages: the page frame (header, footer), the product name set like the wordmark,
// section headings, contact links and the links that scroll to a section of the overview.
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { LuMail, LuMapPin, LuMenu, LuMessageCircle, LuPhone, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, PREVIEW, navigate } from '@/app/router';
import { setLanguage } from '@/store/store';
import { BRAND } from '@/config/brand';
import { Lockup, ScrollProgress } from '@/brand';
import type { IndustryPack } from '@/packs/types';
import { pick, type TFn } from '@/i18n';
import { cx } from '@/ui';

export type MkPageId = 'home' | 'pricing' | 'request';
/** Sections of the overview that the header links to. */
export type MkSectionId = 'product' | 'industries' | 'how-it-works';

/** Digits of the business phone with country code, for WhatsApp links. */
export const WHATSAPP_NUMBER = BRAND.phoneHref.replace(/\D/g, '');
export const whatsappHref = (text?: string) => `https://wa.me/${WHATSAPP_NUMBER}${text ? '?text=' + encodeURIComponent(text) : ''}`;
export const mailHref = (subject?: string, body?: string) => {
  const q = [subject && 'subject=' + encodeURIComponent(subject), body && 'body=' + encodeURIComponent(body)].filter(Boolean).join('&');
  return `mailto:${BRAND.email}${q ? '?' + q : ''}`;
};

/** The edition word of a product name: "BUILD" in "VYNTEX BUILD". Falls back to the whole name. */
export function editionWord(pack: IndustryPack): string {
  const first = BRAND.platformName.split(' ')[0];
  for (const prefix of [BRAND.platformName + ' ', first + ' ']) if (pack.product.startsWith(prefix)) return pack.product.slice(prefix.length);
  return pack.product;
}

/** Product name set like the wordmark: the VYNTEX name in chrome, the edition word in the blue spectrum. */
export function ProductName({ pack, className }: { pack: IndustryPack; className?: string }) {
  const word = editionWord(pack);
  const split = word !== pack.product;
  return (
    <span className={cx('mk-product', className)}>
      <span className="mk-chrome">{split ? pack.product.slice(0, pack.product.length - word.length).trim() : pack.product}</span>
      {split && <> <span className="mk-blue">{word}</span></>}
    </span>
  );
}

/** A sentence with one industry word set apart, so the visitor sees what the industry picker changes. */
export function Swap({ t, k, token }: { t: TFn; k: string; token: 'job' | 'worker' }) {
  const mark = '\u0001';
  const [before, after = ''] = t(k, { [token]: mark }).split(mark);
  const term = t('mk.tok.' + token);
  return after === '' && before === t(k) ? <>{before}</> : <>{before}<span className="mk-swap">{term}</span>{after}</>;
}

export function usePageTitle(title: string) {
  useEffect(() => { document.title = `${BRAND.platformName} | ${title}`; }, [title]);
}

/** Chamfered panel with a hairline edge. `tone="accent"` lights the edge in the circuit colour. */
export function Frame({ children, className, tone, ...rest }: { children: ReactNode; className?: string; tone?: 'accent' } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('mk-frame', tone, className)} {...rest}><div className="mk-frame-in">{children}</div></div>;
}

/** Section heading: one title, one supporting sentence. */
export function SecHead({ id, title, sub }: { id: string; title: ReactNode; sub?: ReactNode }) {
  return <div className="mk-sec-h"><h2 id={id}>{title}</h2>{sub && <p>{sub}</p>}</div>;
}

/* ---------- links to a section of the overview ---------- */
let pendingSection: string | null = null;
const HEADER_OFFSET = 76;
/** Scrolls the overview to a section. Smooth unless the visitor asked for reduced motion; `jump` goes there at once. */
export function scrollToSection(id: string, jump = false) {
  const el = document.getElementById(id); if (!el) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET), behavior: (jump || reduced ? 'instant' : 'smooth') as ScrollBehavior });
}
/** How far a section is from where `scrollToSection` puts it, in pixels. Null when the section is not on the page. */
export function sectionOffBy(id: string): number | null {
  const el = document.getElementById(id);
  return el ? Math.abs(el.getBoundingClientRect().top - HEADER_OFFSET) : null;
}
/** Called by the overview when it mounts: the section asked for from another page, or the one named in the address. */
export function takePendingSection(): string | null {
  const id = pendingSection ?? (PREVIEW || typeof location === 'undefined' ? '' : decodeURIComponent(location.hash.slice(1)));
  pendingSection = null;
  return id || null;
}
function SectionLink({ id, onHome, children, onDone, tid }: { id: MkSectionId; onHome: boolean; children: ReactNode; onDone?: () => void; /** Test id, for the header copy only. */ tid?: boolean }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); onDone?.();
    if (onHome) scrollToSection(id);
    else { pendingSection = id; navigate('/'); }
  };
  return <a href={PREVIEW ? '#' : '/#' + id} onClick={click} data-testid={tid ? `mk-nav-${id}` : undefined}>{children}</a>;
}

/** True while the viewport is narrower than the given width. */
function useNarrow(maxWidth: number): boolean {
  const q = `(max-width:${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const on = () => setNarrow(m.matches); on(); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, [q]);
  return narrow;
}

export function MkHeader({ current }: { current: MkPageId }) {
  const { t, lang } = useApp();
  const compact = useNarrow(1099);
  const phone = useNarrow(700);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => { if (!compact) setOpen(false); }, [compact]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); document.getElementById('mk-menu-btn')?.focus(); } };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [open]);
  const onHome = current === 'home';

  const nav = (
    <nav className="mk-nav" aria-label={t('mk.nav.label')}>
      <SectionLink id="product" onHome={onHome} onDone={close} tid>{t('mk.nav.product')}</SectionLink>
      <SectionLink id="industries" onHome={onHome} onDone={close} tid>{t('mk.nav.industries')}</SectionLink>
      <Link to="/pricing" aria-current={current === 'pricing' ? 'page' : undefined} onClick={close} data-testid="mk-nav-pricing">{t('mk.nav.pricing')}</Link>
      <SectionLink id="how-it-works" onHome={onHome} onDone={close} tid>{t('mk.nav.how')}</SectionLink>
    </nav>
  );
  const language = (
    <div className="mk-lang" role="group" aria-label={t('demo.language')}>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLanguage('en')} data-testid="mk-lang-en" lang="en" aria-label="English">EN</button>
      <button type="button" aria-pressed={lang === 'es'} onClick={() => setLanguage('es')} data-testid="mk-lang-es" lang="es" aria-label="Español">ES</button>
    </div>
  );
  const demo = <Link to="/demo" className="mk-top-demo" onClick={close} data-testid="mk-nav-demo">{t('mk.nav.demo')}</Link>;
  const request = (
    <Link to="/request-demo" className="btn primary mk-top-cta" aria-current={current === 'request' ? 'page' : undefined} onClick={close} data-testid="mk-nav-request">{t('mk.nav.request')}</Link>
  );

  return (
    <header className={cx('mk-top', compact && 'compact', open && 'open')}>
      <div className="mk-wrap mk-top-in">
        <Link to="/" className="mk-logo" aria-label={`${BRAND.platformName}, ${t('mk.nav.home')}`} aria-current={onHome ? 'page' : undefined} onClick={close}><Lockup size="sm" /></Link>
        {compact ? (
          <>
            {!phone && request}
            <button type="button" id="mk-menu-btn" className="mk-menu-btn" aria-expanded={open} aria-controls="mk-menu" aria-label={t(open ? 'mk.nav.close' : 'mk.nav.menu')} onClick={() => setOpen(!open)} data-testid="mk-menu">
              {open ? <LuX aria-hidden="true" /> : <LuMenu aria-hidden="true" />}
            </button>
          </>
        ) : (
          <>{nav}{language}{demo}{request}</>
        )}
      </div>
      {compact && (
        <div id="mk-menu" className="mk-menu" hidden={!open}>
          <div className="mk-wrap mk-menu-in">{nav}<div className="mk-menu-end">{demo}{language}</div>{phone && request}</div>
        </div>
      )}
    </header>
  );
}

/** Phone, WhatsApp, email and office address, exactly as in config/brand.ts. */
export function ContactList({ className }: { className?: string }) {
  const { t } = useApp();
  return (
    <ul className={cx('mk-contact', className)}>
      <li><a href={BRAND.phoneHref}><LuPhone aria-hidden="true" />{t('mk.contact.call', { phone: BRAND.phone })}</a></li>
      <li><a href={whatsappHref()} target="_blank" rel="noopener noreferrer"><LuMessageCircle aria-hidden="true" />{t('mk.contact.whatsapp', { phone: BRAND.phone })}</a></li>
      <li><a href={mailHref()}><LuMail aria-hidden="true" />{BRAND.email}</a></li>
      <li><span><LuMapPin aria-hidden="true" /><span><span className="sr">{t('mk.contact.visit')}: </span>{BRAND.address}</span></span></li>
    </ul>
  );
}

export function MkFooter({ current }: { current?: MkPageId }) {
  const { t, lang } = useApp();
  const onHome = current === 'home';
  return (
    <footer className="mk-foot">
      <div className="mk-wrap mk-foot-in">
        <div className="mk-foot-brand">
          <Lockup size="md" tagline={pick(BRAND.descriptor, lang)} />
          <p className="mk-foot-legal">{t('mk.foot.legal', { legal: BRAND.legalName, company: BRAND.company })}</p>
          <p className="mk-foot-tag">{pick(BRAND.tagline, lang)}</p>
        </div>
        <div className="mk-foot-co">
          <h2>{t('mk.foot.contact')}</h2>
          <ContactList />
        </div>
        <nav className="mk-foot-nav" aria-label={t('mk.foot.pages')}>
          <h2>{t('mk.foot.pages')}</h2>
          <SectionLink id="product" onHome={onHome}>{t('mk.nav.product')}</SectionLink>
          <SectionLink id="industries" onHome={onHome}>{t('mk.nav.industries')}</SectionLink>
          <SectionLink id="how-it-works" onHome={onHome}>{t('mk.nav.how')}</SectionLink>
          <Link to="/pricing">{t('mk.nav.pricing')}</Link>
          <Link to="/request-demo">{t('mk.nav.request')}</Link>
          <Link to="/demo">{t('mk.nav.demo')}</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Page frame for the public pages. They are always dark: the brand lives on graphite. */
export function MkPage({ current, children }: { current: MkPageId; children: ReactNode }) {
  const { t } = useApp();
  return (
    <div className="mk">
      <a href="#mk-main" className="skip">{t('app.skip')}</a>
      <ScrollProgress />
      <MkHeader current={current} />
      <main id="mk-main" className="mk-main" tabIndex={-1}>{children}</main>
      <MkFooter current={current} />
    </div>
  );
}
