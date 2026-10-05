// Pricing page. Every number, plan name, allowance, add-on and rule is read from lib/pricing.ts and lib/pricing-view.ts.
import { useEffect, useRef, useState } from 'react';
import { LuArrowLeft, LuCheck, LuHeadset } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { switchPack } from '@/store/store';
import { PACK_LIST } from '@/packs';
import type { IndustryId } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import { PRICING_VERSION, planName, plansFor, yearlySavings, type Plan, type PlanTier, type WelcomeCredit } from '@/lib/pricing';
import { addOnViews, planFeatures, planSupport, planUsers, publicRules, type AddOnView } from '@/lib/pricing-view';
import { money } from '@/lib/money';
import type { TFn } from '@/i18n';
import { pick } from '@/i18n';
import { Arrow, CircuitTrace, Reveal } from '@/brand';
import { Badge, cx, type Tone } from '@/ui';
import { MkPage, editionWord, usePageTitle } from './parts';
import './pages.css';

export type Billing = 'monthly' | 'yearly';

/** Wording for the free-text conditions of a welcome credit. Each entry quotes the exact line of the pricing file;
 *  a line that is not listed here is shown as written there, so a change in the file can never be hidden by old wording. */
const CREDIT_COPY: Record<string, string> = {
  'Setup fee of another VYNTEX service (website, branding, social media, etc.)': 'mk.pr.credit.other',
  'Setup fee of Social Media Management (or another VYNTEX service (website, branding, social media, etc.))': 'mk.pr.credit.social',
  'Not valid on VYNTEX BUILD / VYNTEX CLEAN: not on their setup, monthly fees or add-ons (including the Client Portal)': 'mk.pr.credit.excludes',
  'On yearly billing, the credit requires a 12-month Social Media Management plan': 'mk.pr.credit.yearly',
};
const creditLine = (t: TFn, source: string | undefined) => (!source ? null : CREDIT_COPY[source] ? t(CREDIT_COPY[source]) : source);

function creditLines(t: TFn, c: WelcomeCredit, billing: Billing): string[] {
  return [creditLine(t, c.applies_to), t('mk.pr.creditDays', { days: c.expires_days }), billing === 'yearly' ? creditLine(t, c.yearly_plan_condition) : null, creditLine(t, c.excludes)]
    .filter((x): x is string => !!x);
}
function usersValue(t: TFn, plan: Plan): string {
  const u = planUsers(plan);
  return u === 'unlimited' ? t('mk.p2.pr.usersU') : u === 1 ? String(u) : t('mk.p2.pr.usersN', { n: u });
}
const freeLabel = (t: TFn, n: number) => (n === 1 ? t('mk.pr.free1') : t('mk.pr.freeN', { n }));

/** The four words every capability is labelled with across the product, in the tones the workspace badges use. */
const LEGEND: { key: 'included' | AddOnView['kind']; tone: Tone; outline?: boolean }[] = [
  { key: 'included', tone: 'ok' }, { key: 'addon', tone: 'violet' }, { key: 'usage', tone: 'info' }, { key: 'custom', tone: 'violet', outline: true },
];
const GROUPS = LEGEND.filter((g): g is { key: AddOnView['kind']; tone: Tone; outline?: boolean } => g.key !== 'included');

/** Edition name set like the wordmark: brand word in chrome, edition word in the blue spectrum. */
function EditionName({ pack }: { pack: IndustryPack }) {
  const word = editionWord(pack);
  const at = pack.product.indexOf(' ');
  const [brand, edition] = word !== pack.product ? [pack.product.slice(0, pack.product.length - word.length).trim(), word]
    : at > 0 ? [pack.product.slice(0, at), pack.product.slice(at + 1)] : [pack.product, ''];
  return <span className="mkp-product"><span className="chrome-text">{brand}</span>{edition && <> <span className="brand-text">{edition}</span></>}</span>;
}

/** Height of the page header when it stays on screen, so the edition and billing controls can stay right under it. */
function useHeaderOffset(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.mk header');
    const measure = () => {
      if (!header) { setTop(0); return; }
      const pos = getComputedStyle(header).position;
      setTop(pos === 'sticky' || pos === 'fixed' ? Math.round(header.getBoundingClientRect().height) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = header && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro && header) ro.observe(header);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);
  return top;
}

/** The pricing page. An edition that is not in the pricing file has no plan and no price to show: it is quoted. */
export function Pricing() {
  const { pack } = useApp();
  return pack.priced ? <PlanPricing /> : <QuotedPricing />;
}

/** Pricing of an edition that is quoted for each business: the edition picker, one honest paragraph and how to ask. */
function QuotedPricing() {
  const { t, pack, lang } = useApp();
  usePageTitle(t('mk.title.pricing'));
  return (
    <MkPage current="pricing">
      <div className="mkp">
        <section className="mkp-head">
          <div className="mkp-wrap">
            <Link to="/demo" className="mkp-back" data-testid="pr-back-demo"><LuArrowLeft aria-hidden="true" />{t('mk.pr.back')}</Link>
            <header>
              <h1>{t('mk.pr.h')} <EditionName pack={pack} /></h1>
              <p className="mkp-lede">{t('mk.p2.pr.quoted.lede')}</p>
            </header>
          </div>
        </section>
        <section className="mkp-plans-sec" aria-label={t('mk.p2.pr.plans')}>
          <div className="mkp-bar">
            <div className="mkp-wrap mkp-bar-in">
              <label className="mkp-select"><span>{t('mk.pr.edition')}</span>
                <select value={pack.id} onChange={(e) => switchPack(e.target.value as IndustryId)} data-testid="pr-industry">
                  {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.product}: {pick(p.label, lang)}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>
        <section className="mkp-close" aria-labelledby="pr-quoted-h">
          <div className="mkp-wrap">
            <div className="mkp-close-in" data-testid="pr-quoted">
              <div className="mkp-close-t">
                <h2 id="pr-quoted-h">{t('mk.p2.pr.quoted.h')}</h2>
                <p>{t('mk.p2.pr.quoted.p', { product: pack.product })}</p>
              </div>
              <div className="mkp-close-act">
                <Link to="/request-demo" className="btn primary lg" data-testid="pr-request-end">{t('mk.p2.pr.quoted.cta')}<Arrow /></Link>
                <Link to="/demo" className="mkp-quiet" data-testid="pr-back-demo-end"><LuArrowLeft aria-hidden="true" />{t('mk.pr.back')}</Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </MkPage>
  );
}

function PlanPricing() {
  const { t, pack, lang } = useApp();
  usePageTitle(t('mk.title.pricing'));
  const plans = plansFor(pack.id);
  const [billing, setBilling] = useState<Billing>('monthly');
  const [tier, setTier] = useState<PlanTier>(() => (plans.find((p) => p.mostPopular) ?? plans[0]).tier);
  const chosen = plans.find((p) => p.tier === tier) ?? plans[0];
  const period = billing === 'yearly' ? chosen.yearly : chosen.monthly;
  const views = addOnViews(pack.id, lang, t);
  const bestSaving = Math.max(0, ...plans.map(yearlySavings));

  // the edition and billing controls stay within reach while the plans are on screen
  const top = useHeaderOffset();
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    let raf = 0;
    const read = () => { raf = 0; setStuck(el.getBoundingClientRect().top < top + 1); };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [top]);

  return (
    <MkPage current="pricing">
      <div className="mkp">
        <section className="mkp-head">
          <div className="mkp-wrap">
            <Link to="/demo" className="mkp-back" data-testid="pr-back-demo"><LuArrowLeft aria-hidden="true" />{t('mk.pr.back')}</Link>
            <header>
              <h1>{t('mk.pr.h')} <EditionName pack={pack} /></h1>
              <p className="mkp-lede">{t('mk.pr.sub')}</p>
            </header>
          </div>
        </section>

        <section className="mkp-plans-sec" aria-label={t('mk.p2.pr.plans')}>
          <div ref={sentinel} aria-hidden="true" />
          <div className="mkp-bar" data-stuck={stuck ? '' : undefined} style={{ top }}>
            <div className="mkp-wrap mkp-bar-in">
              <label className="mkp-select"><span>{t('mk.pr.edition')}</span>
                <select value={pack.id} onChange={(e) => switchPack(e.target.value as IndustryId)} data-testid="pr-industry">
                  {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.product}: {pick(p.label, lang)}</option>)}
                </select>
              </label>
              <div className="mkp-switch" role="group" aria-label={t('mk.pr.billing')} data-billing={billing}>
                <button type="button" aria-pressed={billing === 'monthly'} onClick={() => setBilling('monthly')} data-testid="pr-billing-monthly">{t('mk.pr.monthly')}</button>
                <button type="button" aria-pressed={billing === 'yearly'} onClick={() => setBilling('yearly')} data-testid="pr-billing-yearly">{t('mk.pr.yearly')}</button>
              </div>
              {bestSaving > 0 && <p className="mkp-save">{t('mk.p2.pr.saveUpTo', { amount: money(bestSaving) })}</p>}
            </div>
          </div>

          <div className="mkp-wrap">
            <div className="mkp-plans" data-billing={billing}>
              {plans.map((p) => {
                const name = planName(p, lang); const saves = yearlySavings(p); const on = p.tier === tier;
                return (
                  <article key={p.id} className={cx('mkp-plan', p.mostPopular && 'popular', on && 'on')} aria-labelledby={`pr-name-${p.id}`} data-testid={`pr-card-${p.id}`}>
                    <div className="mkp-plan-a">
                      <header className="mkp-plan-h">
                        <h2 id={`pr-name-${p.id}`} data-testid={`pr-name-${p.id}`}>{name}</h2>
                        {p.mostPopular && <span className="mkp-popular" data-testid={`pr-popular-${p.id}`}>{t('mk.pr.popular')}</span>}
                      </header>
                      <div className="mkp-plan-price">
                        <p className="mkp-price">
                          <b key={billing} data-testid={`pr-price-${p.id}`}>{money(billing === 'yearly' ? p.yearly : p.monthly)}</b>
                          <span>{t(billing === 'yearly' ? 'mk.pr.perYear' : 'mk.pr.perMonth')}</span>
                        </p>
                        <p className="mkp-price-alt" data-testid={`pr-alt-${p.id}`}>
                          {billing === 'yearly' ? t('mk.pr.orMonthly', { amount: money(p.monthly) }) : t('mk.pr.orYearly', { amount: money(p.yearly) })}
                        </p>
                        <p className={cx('mkp-saving', saves <= 0 && 'none')} data-testid={`pr-saving-${p.id}`}>
                          {saves > 0 ? <>{t('mk.pr.saves', { amount: money(saves) })}{p.yearlyFreeMonths > 0 && <> ({freeLabel(t, p.yearlyFreeMonths)})</>}</> : t('mk.pr.noSaving')}
                        </p>
                      </div>
                      <dl className="mkp-facts">
                        <div><dt>{t('mk.pr.setup')}</dt><dd data-testid={`pr-setup-${p.id}`}>{money(p.setup)}</dd></div>
                        <div><dt>{t('mk.p2.pr.users')}</dt><dd data-testid={`pr-users-${p.id}`}>{usersValue(t, p)}</dd></div>
                        <div><dt>{t('mk.p2.pr.credit')}</dt>{p.welcomeCredit ? <dd>{money(p.welcomeCredit.amount_usd)}</dd> : <dd className="none">{t('mk.p2.pr.creditNone')}</dd>}</div>
                      </dl>
                      <button type="button" className={cx('btn lg block mkp-pick', on && 'on')} aria-pressed={on} onClick={() => setTier(p.tier)} data-testid={`pr-plan-${p.id}`}>
                        {on ? <span><LuCheck aria-hidden="true" />{t('mk.pr.selected', { plan: name })}</span> : t('mk.pr.select', { plan: name })}
                      </button>
                    </div>
                    <div className="mkp-plan-b">
                      <div className="mkp-plan-feats">
                        <h3>{t('mk.pr.includes')}</h3>
                        <ul className="mkp-feats">
                          {planFeatures(p, pack.id, lang, t).map((f, i) => <li key={i}><LuCheck aria-hidden="true" /><span>{f}</span></li>)}
                        </ul>
                        <p className="mkp-support"><LuHeadset aria-hidden="true" /><span>{planSupport(p, pack.id, lang, t)}</span></p>
                      </div>
                      {p.welcomeCredit ? (
                        <div className="mkp-credit" data-testid={`pr-credit-${p.id}`}>
                          <b>{t('mk.pr.credit', { amount: money(p.welcomeCredit.amount_usd) })}</b>
                          {creditLines(t, p.welcomeCredit, billing).map((l, i) => <p key={i}>{l}</p>)}
                        </div>
                      ) : <div className="mkp-credit-none" aria-hidden="true" />}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mkp-wrap mkp-first-sec" aria-labelledby="pr-first-h">
          {/* the selected plan feeds the estimate below it */}
          <div className="mkp-link" style={{ '--col': tier } as React.CSSProperties} aria-hidden="true">
            <i><CircuitTrace d="M10 0 V46" viewBox="0 0 20 52" nodes={[[10, 48]]} /></i>
          </div>
          <Reveal kind="panel">
            <div className="mkp-premium mkp-first">
              <div className="mkp-first-a">
                <h2 id="pr-first-h">{t('mk.pr.first.h')}</h2>
                <p className="mkp-first-for" key={`${chosen.id}-${billing}`}>{t('mk.p2.pr.first.for', { plan: planName(chosen, lang), billing: t(`mk.pr.${billing}.lc`) })}</p>
                <p className="mkp-fine">{t('mk.pr.first.sub')}</p>
              </div>
              <dl className="mkp-sum" data-testid="pr-first">
                <div><dt>{t('mk.pr.first.setup')}</dt><dd data-testid="pr-first-setup">{money(chosen.setup)}</dd></div>
                <div><dt>{t(billing === 'yearly' ? 'mk.pr.first.year' : 'mk.pr.first.month', { plan: planName(chosen, lang) })}</dt><dd data-testid="pr-first-period">{money(period)}</dd></div>
                <div className="total"><dt>{t('mk.pr.first.total')}</dt><dd key={`${chosen.id}-${billing}`} data-testid="pr-first-total">{money(chosen.setup + period)}</dd></div>
              </dl>
              <div className="mkp-first-foot">
                <p>{t(billing === 'yearly' ? 'mk.pr.first.thenY' : 'mk.pr.first.thenM', { amount: money(period) })} {t('price.r.lines')} {t('mk.pr.first.extra')}</p>
                <Link to={`/request-demo?plan=${chosen.tier}&billing=${billing}`} className="btn primary lg" data-testid="pr-request">{t('mk.pr.first.cta')}<Arrow /></Link>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="mkp-sec" aria-labelledby="pr-addons-h">
          <div className="mkp-wrap">
            <Reveal as="header" className="mkp-sec-h">
              <h2 id="pr-addons-h">{t('mk.pr.addons.h')}</h2>
              <p>{t('mk.p2.pr.addons.sub')}</p>
            </Reveal>
            <Reveal delay={80}>
              <p className="mkp-legend-h" id="pr-legend-h">{t('mk.p2.leg.h')}</p>
              <dl className="mkp-legend" aria-labelledby="pr-legend-h">
                {LEGEND.map((g) => (
                  <div key={g.key}><dt><Badge tone={g.tone} outline={g.outline}>{t('ent.' + g.key)}</Badge></dt><dd>{t('mk.p2.leg.' + g.key)}</dd></div>
                ))}
              </dl>
            </Reveal>
            <div className="mkp-addons">
              {GROUPS.map((g, gi) => {
                const rows = views.filter((a) => a.kind === g.key); if (!rows.length) return null;
                return (
                  <Reveal className="mkp-addon-g" key={g.key} delay={gi * 70} data-kind={g.key} data-testid={`pr-addons-${g.key}`}>
                    <h3>{t('ent.' + g.key)}</h3>
                    <ul>
                      {rows.map((a) => (
                        <li key={a.id} data-testid={`pr-addon-${a.id}`}>
                          <div className="mkp-addon-top">
                            <b className="mkp-addon-name">{a.name}</b>
                            {a.price ? <b className="mkp-addon-price">{a.price}</b> : <span className="mkp-addon-price none">{t(a.kind === 'usage' ? 'mk.p2.pr.varies' : 'mk.p2.pr.quoted')}</span>}
                          </div>
                          {a.notBuilt && <p className="mkp-addon-flag"><Badge tone="warn" outline>{t('mk.p2.pr.notBuilt')}</Badge></p>}
                          {a.billing && <p className="mkp-addon-bill">{a.billing}</p>}
                          {a.note && <p className="mkp-addon-note">{a.note}</p>}
                        </li>
                      ))}
                    </ul>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mkp-sec mkp-rules-sec" aria-labelledby="pr-rules-h">
          <div className="mkp-wrap">
            <Reveal as="header" className="mkp-sec-h">
              <h2 id="pr-rules-h">{t('mk.pr.rules.h')}</h2>
              <p>{t('mk.p2.pr.rules.sub')}</p>
            </Reveal>
            <Reveal delay={80}>
              <ul className="mkp-rules" data-testid="pr-rules">{publicRules(pack.id, lang, t).map((r, i) => <li key={i}>{r}</li>)}</ul>
            </Reveal>
          </div>
        </section>

        <section className="mkp-close" aria-labelledby="pr-close-h">
          <div className="mkp-wrap">
            <Reveal className="mkp-close-in">
              <div className="mkp-close-t">
                <h2 id="pr-close-h">{t('mk.p2.pr.close.h')}</h2>
                <p>{t('mk.p2.pr.close.p')}</p>
              </div>
              <div className="mkp-close-act">
                <Link to="/request-demo" className="btn primary lg" data-testid="pr-request-end">{t('mk.p2.cta.request')}<Arrow /></Link>
                <Link to="/demo" className="mkp-quiet" data-testid="pr-back-demo-end"><LuArrowLeft aria-hidden="true" />{t('mk.pr.back')}</Link>
              </div>
            </Reveal>
            <p className="mkp-version" data-testid="pr-version">{t('mk.pr.version', { v: PRICING_VERSION })}</p>
          </div>
        </section>
      </div>
    </MkPage>
  );
}
