// Pricing page. Every number, plan name, allowance, add-on and rule is read from lib/pricing.ts and lib/pricing-view.ts.
import { useState } from 'react';
import { LuArrowLeft, LuCheck } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { switchPack } from '@/store/store';
import { PACK_LIST } from '@/packs';
import type { IndustryId } from '@/domain/types';
import { PRICING_VERSION, planName, plansFor, yearlySavings, type Plan, type PlanTier, type WelcomeCredit } from '@/lib/pricing';
import { addOnViews, planFeatures, planSupport, planUsers, publicRules, type AddOnView } from '@/lib/pricing-view';
import { money } from '@/lib/money';
import type { TFn } from '@/i18n';
import { Badge, cx, type Tone } from '@/ui';
import { Frame, MkPage, ProductName, SecHead, usePageTitle } from './parts';

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
function usersLabel(t: TFn, plan: Plan): string {
  const u = planUsers(plan);
  return u === 'unlimited' ? t('mk.pr.usersU') : u === 1 ? t('mk.pr.users1') : t('mk.pr.usersN', { n: u });
}
const freeLabel = (t: TFn, n: number) => (n === 1 ? t('mk.pr.free1') : t('mk.pr.freeN', { n }));

export function Pricing() {
  const { t, pack, lang } = useApp();
  usePageTitle(t('mk.title.pricing'));
  const plans = plansFor(pack.id);
  const [billing, setBilling] = useState<Billing>('monthly');
  const [tier, setTier] = useState<PlanTier>(() => (plans.find((p) => p.mostPopular) ?? plans[0]).tier);
  const chosen = plans.find((p) => p.tier === tier) ?? plans[0];
  const period = billing === 'yearly' ? chosen.yearly : chosen.monthly;
  const views = addOnViews(pack.id, lang, t);
  const groups: { key: AddOnView['kind']; tone: Tone; outline?: boolean }[] = [{ key: 'addon', tone: 'violet' }, { key: 'usage', tone: 'info' }, { key: 'custom', tone: 'violet', outline: true }];

  return (
    <MkPage current="pricing">
      <section className="mk-wrap mk-page-h">
        <Link to="/demo" className="mk-back" data-testid="pr-back-demo"><LuArrowLeft aria-hidden="true" />{t('mk.pr.back')}</Link>
        <h1>{t('mk.pr.h')} <ProductName pack={pack} /></h1>
        <p className="mk-page-sub">{t('mk.pr.sub')}</p>
        <div className="mk-pr-controls">
          <label className="mk-select"><span>{t('mk.pr.edition')}</span>
            <select value={pack.id} onChange={(e) => switchPack(e.target.value as IndustryId)} data-testid="pr-industry">
              {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.product}: {p.label[lang]}</option>)}
            </select>
          </label>
          <div className="mk-toggle" role="group" aria-label={t('mk.pr.billing')}>
            <button type="button" aria-pressed={billing === 'monthly'} onClick={() => setBilling('monthly')} data-testid="pr-billing-monthly">{t('mk.pr.monthly')}</button>
            <button type="button" aria-pressed={billing === 'yearly'} onClick={() => setBilling('yearly')} data-testid="pr-billing-yearly">{t('mk.pr.yearly')}</button>
          </div>
        </div>
      </section>

      <section className="mk-wrap" aria-label={t('mk.title.pricing')}>
        <Frame className="mk-plans-frame">
          <div className="mk-plans" data-billing={billing}>
            {plans.map((p) => {
              const name = planName(p, lang); const saves = yearlySavings(p); const on = p.tier === tier;
              return (
                <article key={p.id} className={cx('mk-plan', p.mostPopular && 'popular', on && 'on')} aria-labelledby={`pr-name-${p.id}`} data-testid={`pr-card-${p.id}`}>
                  <header>
                    <h2 id={`pr-name-${p.id}`} data-testid={`pr-name-${p.id}`}>{name}</h2>
                    {p.mostPopular && <span className="mk-popular" data-testid={`pr-popular-${p.id}`}>{t('mk.pr.popular')}</span>}
                  </header>
                  <p className="mk-price">
                    <b data-testid={`pr-price-${p.id}`}>{money(billing === 'yearly' ? p.yearly : p.monthly)}</b>
                    <span>{t(billing === 'yearly' ? 'mk.pr.perYear' : 'mk.pr.perMonth')}</span>
                  </p>
                  <p className="mk-price-alt" data-testid={`pr-alt-${p.id}`}>
                    {billing === 'yearly' ? t('mk.pr.orMonthly', { amount: money(p.monthly) }) : t('mk.pr.orYearly', { amount: money(p.yearly) })}
                  </p>
                  <p className={cx('mk-saving', saves <= 0 && 'none')} data-testid={`pr-saving-${p.id}`}>
                    {saves > 0 ? <>{t('mk.pr.saves', { amount: money(saves) })}{p.yearlyFreeMonths > 0 && <> ({freeLabel(t, p.yearlyFreeMonths)})</>}</> : t('mk.pr.noSaving')}
                  </p>
                  <ul className="mk-plan-facts">
                    <li><span>{t('mk.pr.setup')}</span><b data-testid={`pr-setup-${p.id}`}>{money(p.setup)}</b></li>
                    <li><span data-testid={`pr-users-${p.id}`}>{usersLabel(t, p)}</span></li>
                  </ul>
                  <button type="button" className={cx('mk-btn', p.mostPopular && !on && 'primary', 'block')} aria-pressed={on} onClick={() => setTier(p.tier)} data-testid={`pr-plan-${p.id}`}>
                    {on ? <><LuCheck aria-hidden="true" />{t('mk.pr.selected', { plan: name })}</> : t('mk.pr.select', { plan: name })}
                  </button>
                  <h3>{t('mk.pr.includes')}</h3>
                  <ul className="mk-feats">
                    {planFeatures(p, pack.id, lang, t).map((f, i) => <li key={i}><LuCheck aria-hidden="true" /><span>{f}</span></li>)}
                    <li><LuCheck aria-hidden="true" /><span>{planSupport(p, pack.id, lang, t)}</span></li>
                  </ul>
                  {p.welcomeCredit && (
                    <div className="mk-credit" data-testid={`pr-credit-${p.id}`}>
                      <b>{t('mk.pr.credit', { amount: money(p.welcomeCredit.amount_usd) })}</b>
                      {creditLines(t, p.welcomeCredit, billing).map((l, i) => <p key={i}>{l}</p>)}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </Frame>
      </section>

      <section className="mk-wrap mk-first" aria-labelledby="pr-first-h">
        <Frame tone="accent">
          <div className="mk-first-in">
            <div>
              <h2 id="pr-first-h">{t('mk.pr.first.h')}</h2>
              <p className="mk-fine">{t('mk.pr.first.sub')}</p>
            </div>
            <dl className="mk-sum" data-testid="pr-first">
              <div><dt>{t('mk.pr.first.setup')}</dt><dd data-testid="pr-first-setup">{money(chosen.setup)}</dd></div>
              <div><dt>{t(billing === 'yearly' ? 'mk.pr.first.year' : 'mk.pr.first.month', { plan: planName(chosen, lang) })}</dt><dd data-testid="pr-first-period">{money(period)}</dd></div>
              <div className="total"><dt>{t('mk.pr.first.total')}</dt><dd data-testid="pr-first-total">{money(chosen.setup + period)}</dd></div>
            </dl>
            <div className="mk-first-foot">
              <p>{t(billing === 'yearly' ? 'mk.pr.first.thenY' : 'mk.pr.first.thenM', { amount: money(period) })} {t('price.r.lines')} {t('mk.pr.first.extra')}</p>
              <Link to={`/request-demo?plan=${chosen.tier}&billing=${billing}`} className="mk-btn primary" data-testid="pr-request">{t('mk.pr.first.cta')}</Link>
            </div>
          </div>
        </Frame>
      </section>

      <section className="mk-sec" aria-labelledby="pr-addons-h">
        <div className="mk-wrap">
          <SecHead id="pr-addons-h" title={t('mk.pr.addons.h')} />
          <div className="mk-addons">
            {groups.map((g) => {
              const rows = views.filter((a) => a.kind === g.key); if (!rows.length) return null;
              return (
                <div className="mk-addon-g" key={g.key} data-testid={`pr-addons-${g.key}`}>
                  <h3><Badge tone={g.tone} outline={g.outline}>{t('ent.' + g.key)}</Badge></h3>
                  <ul>
                    {rows.map((a) => (
                      <li key={a.id} data-testid={`pr-addon-${a.id}`}>
                        <div><b>{a.name}</b>{a.notBuilt && <> <Badge tone="warn" outline>{t('mk.notBuilt')}</Badge></>}{a.note && <p>{a.note}</p>}{a.billing && <p>{a.billing}</p>}</div>
                        {a.price && <b className="mk-addon-price">{a.price}</b>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mk-sec" aria-labelledby="pr-rules-h">
        <div className="mk-wrap">
          <SecHead id="pr-rules-h" title={t('mk.pr.rules.h')} />
          <ul className="mk-rules-list" data-testid="pr-rules">{publicRules(pack.id, lang, t).map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="mk-cta mk-pr-end">
            <Link to="/request-demo" className="mk-btn primary" data-testid="pr-request-end">{t('mk.cta.request')}</Link>
            <Link to="/demo" className="mk-btn" data-testid="pr-back-demo-end">{t('mk.pr.back')}</Link>
          </div>
          <p className="mk-version" data-testid="pr-version">{t('mk.pr.version', { v: PRICING_VERSION })}</p>
        </div>
      </section>
    </MkPage>
  );
}
