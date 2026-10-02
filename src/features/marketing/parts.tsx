// Pieces shared by the three public pages: frame of the page (header, footer), the chamfered brand shapes and contact links.
import { useEffect, type ReactNode } from 'react';
import { LuMail, LuMapPin, LuMessageCircle, LuPhone } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, asset } from '@/app/router';
import { setLanguage } from '@/store/store';
import { BRAND } from '@/config/brand';
import type { IndustryPack } from '@/packs/types';
import type { TFn } from '@/i18n';
import { cx } from '@/ui';

export type MkPageId = 'home' | 'pricing' | 'request';

/** Digits of the business phone with country code, for WhatsApp links. */
export const WHATSAPP_NUMBER = BRAND.phoneHref.replace(/\D/g, '');
export const whatsappHref = (text?: string) => `https://wa.me/${WHATSAPP_NUMBER}${text ? '?text=' + encodeURIComponent(text) : ''}`;
export const mailHref = (subject?: string, body?: string) => {
  const q = [subject && 'subject=' + encodeURIComponent(subject), body && 'body=' + encodeURIComponent(body)].filter(Boolean).join('&');
  return `mailto:${BRAND.email}${q ? '?' + q : ''}`;
};

/** The edition word of a product name: "BUILD" in "VYNTEX BUILD". Falls back to the whole name. */
export function editionWord(pack: IndustryPack): string {
  const prefix = BRAND.platformName + ' ';
  return pack.product.startsWith(prefix) ? pack.product.slice(prefix.length) : pack.product;
}

/** Product name set like the wordmark: platform name in chrome, edition word in the circuit blue. */
export function ProductName({ pack, className }: { pack: IndustryPack; className?: string }) {
  const word = editionWord(pack);
  const split = word !== pack.product;
  return (
    <span className={cx('mk-product', className)}>
      <span className="mk-chrome">{split ? BRAND.platformName : pack.product}</span>
      {split && <> <span className="mk-blue">{word}</span></>}
    </span>
  );
}

/** A sentence with the industry words set apart, so the visitor sees what the industry picker changes. */
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

export function MkHeader({ current }: { current: MkPageId }) {
  const { t, lang } = useApp();
  return (
    <header className="mk-top">
      <div className="mk-wrap mk-top-in">
        <Link to="/" className="mk-logo" aria-label={`${BRAND.platformName}, ${t('mk.nav.home')}`} aria-current={current === 'home' ? 'page' : undefined}>
          <img src={asset('brand/vyntex-wordmark.jpg')} alt="" width={640} height={86} />
        </Link>
        <nav className="mk-nav" aria-label={t('mk.nav.label')}>
          <Link to="/pricing" aria-current={current === 'pricing' ? 'page' : undefined} data-testid="mk-nav-pricing">{t('mk.nav.pricing')}</Link>
          <Link to="/request-demo" aria-current={current === 'request' ? 'page' : undefined} data-testid="mk-nav-request">{t('mk.nav.request')}</Link>
        </nav>
        <div className="mk-lang" role="group" aria-label={t('demo.language')}>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLanguage('en')} data-testid="mk-lang-en" lang="en" aria-label="English">EN</button>
          <button type="button" aria-pressed={lang === 'es'} onClick={() => setLanguage('es')} data-testid="mk-lang-es" lang="es" aria-label="Español">ES</button>
        </div>
        <Link to="/demo" className="mk-btn primary sm mk-top-demo" data-testid="mk-nav-demo">{t('mk.nav.demo')}</Link>
      </div>
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

export function MkFooter() {
  const { t } = useApp();
  return (
    <footer className="mk-foot">
      <div className="mk-wrap mk-foot-in">
        <div className="mk-foot-brand">
          <img src={asset('brand/vyntex-wordmark.jpg')} alt={BRAND.company} width={640} height={86} loading="lazy" />
        </div>
        <div className="mk-foot-co">
          <p className="mk-foot-legal">{t('mk.foot.legal', { legal: BRAND.legalName, company: BRAND.company })}</p>
          <p className="mk-foot-tag">{BRAND.tagline}</p>
          <ContactList />
        </div>
        <nav className="mk-foot-nav" aria-label={t('mk.foot.pages')}>
          <Link to="/">{t('mk.nav.home')}</Link>
          <Link to="/pricing">{t('mk.nav.pricing')}</Link>
          <Link to="/request-demo">{t('mk.nav.request')}</Link>
          <Link to="/demo">{t('mk.nav.demo')}</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Page frame for the public pages. They are always dark: the logo artwork only exists on black. */
export function MkPage({ current, children }: { current: MkPageId; children: ReactNode }) {
  const { t } = useApp();
  return (
    <div className="mk">
      <a href="#mk-main" className="skip">{t('app.skip')}</a>
      <MkHeader current={current} />
      <main id="mk-main" tabIndex={-1}>{children}</main>
      <MkFooter />
    </div>
  );
}
