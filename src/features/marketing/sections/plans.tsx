// What is included and what costs extra, then the three plans of the selected edition at a glance.
// Every plan name, price, allowance and add-on is read from lib/pricing.ts and lib/pricing-view.ts; nothing is typed here.
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { Arrow, Reveal } from '@/brand';
import { ENTITLEMENTS, standing, type EntitlementId } from '@/domain/entitlements';
import { planName, plansFor, type Plan } from '@/lib/pricing';
import { addOnViews, planFeatures, planUsers, type AddOnView } from '@/lib/pricing-view';
import { money } from '@/lib/money';
import { Badge, cx, type Tone } from '@/ui';
import { EditionName, Head } from './shared';
import './plans.css';

/** Capabilities used as examples of "included": one from each step of the plan ladder. */
const INCLUDED_EXAMPLES: EntitlementId[] = ['core', 'workerPortal', 'profitReports'];
interface Row { id: string; text: string; note: string; notBuilt?: boolean }

export function PlansOverview() {
  const { t, pack, lang } = useApp();
  const plans = plansFor(pack.id);

  // included: the customer wording of the exact pricing-file line each capability points at, and the plan it starts in
  const included: Row[] = INCLUDED_EXAMPLES.flatMap((id) => {
    const e = ENTITLEMENTS[id]; const s = standing(id, pack.id, 0);
    if (e.kind !== 'plan' || !s.plan) return [];
    const at = s.plan.features.indexOf(e.source);
    return at < 0 ? [] : [{ id, text: planFeatures(s.plan, pack.id, lang, t)[at], note: s.state === 'included' ? t('mk.s.pl.every') : t('ent.fromPlan', { plan: planName(s.plan, lang) }) }];
  });
  const views = addOnViews(pack.id, lang, t);
  const priced = (a: AddOnView) => (a.price ? `${a.price}${a.billing ? ' ' + a.billing : ''}` : a.notBuilt ? t('mk.s.pl.quoted') : a.note || t('mk.s.pl.quoted'));
  const rows = (kind: AddOnView['kind']): Row[] => views.filter((a) => a.kind === kind).slice(0, 3).map((a) => ({ id: a.id, text: a.name, note: priced(a), notBuilt: a.notBuilt }));
  const cats: { key: 'included' | 'addon' | 'usage' | 'custom'; tone: Tone; outline?: boolean; rows: Row[] }[] = [
    { key: 'included', tone: 'ok', rows: included },
    { key: 'addon', tone: 'violet', rows: rows('addon') },
    { key: 'usage', tone: 'info', rows: rows('usage') },
    { key: 'custom', tone: 'violet', outline: true, rows: rows('custom') },
  ];
  const users = (p: Plan) => { const u = planUsers(p); return u === 'unlimited' ? t('mk.s.pl.usersU') : u === 1 ? t('mk.s.pl.users1') : t('mk.s.pl.usersN', { n: u }); };

  return (
    <section className="mks mks-pl" aria-labelledby="mks-pl-h">
      <Head id="mks-pl-h" title={t('mk.s.pl.h')} sub={t('mk.s.pl.sub')} />
      <div className="mks-pl-cats">
        {cats.map((c, i) => (
          <Reveal key={c.key} delay={i * 60} className="mks-pl-cat" data-testid={`mk-pl-cat-${c.key}`}>
            <h3><Badge tone={c.tone} outline={c.outline}>{t('ent.' + c.key)}</Badge></h3>
            <p>{t(`mk.s.pl.${c.key}`)}</p>
            <ul>
              {c.rows.map((r) => (
                <li key={r.id}><span>{r.text}{r.notBuilt && <> <Badge tone="warn" outline>{t('mk.s.pl.notBuilt')}</Badge></>}</span><small>{r.note}</small></li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>

      <Reveal kind="panel" className="mks-pl-preview">
        <div className="mks-pl-preview-h">
          <h3 id="mks-pl-plans">{t('mk.s.pl.plansFor')} <EditionName pack={pack} /></h3>
          <p>{t('mk.s.pl.monthly')}</p>
        </div>
        <ul className="mks-pl-plans" aria-labelledby="mks-pl-plans">
          {plans.map((p) => (
            <li key={p.id} className={cx('mks-pl-plan', p.mostPopular && 'popular')} data-testid={`mk-pl-plan-${p.id}`}>
              <div className="mks-pl-plan-h"><h4>{planName(p, lang)}</h4>{p.mostPopular && <span className="mks-pl-pop">{t('mk.s.pl.popular')}</span>}</div>
              <p className="mks-pl-price"><b>{money(p.monthly)}</b><span>{t('mk.s.pl.perMonth')}</span></p>
              <dl>
                <div><dt>{t('mk.s.pl.setup')}</dt><dd>{money(p.setup)}</dd></div>
                <div><dt>{t('mk.s.pl.users')}</dt><dd>{users(p)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mks-pl-foot">
          <p className="mks-fine">{t('mk.s.pl.note')}</p>
          <Link to="/pricing" className="btn primary" data-testid="mk-cat-pricing">{t('mk.s.pl.link')}<Arrow /></Link>
        </div>
      </Reveal>
    </section>
  );
}
