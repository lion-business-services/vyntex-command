// Team and roles: who can sign in and what each role may do, the same two cards as the security center (people are invited,
// never added directly, and every change goes through the protected operations), plus how many users the previewed plan
// includes in the editions that have plans.
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { PlanBadge } from '@/app/shared';
import { Card, Note } from '@/ui';
import { moduleOn } from '@/domain/config';
import { memberState } from '@/domain/actions/security';
import { planByTier, planName, type Plan, type PlanTier } from '@/lib/pricing';
import { addOnViews } from '@/lib/pricing-view';
import { PeopleCard } from '@/features/security/people';
import { RolesCard } from '@/features/security/roles';
import { StepUpHost } from '@/features/security/stepup';
import '@/features/security/security.css';

export function TeamSection() {
  const { t, data, pack, plan, planLabel, lang, can } = useApp();
  // people who can sign in or are about to: someone who was switched off no longer takes a place
  const seats = data.users.filter((u) => memberState(u) !== 'disabled').length;
  // the user allowance belongs to a plan; an edition without plans has none to show
  const limit = plan ? plan.users : 'unlimited';
  const over = !!plan && limit !== 'unlimited' && seats > limit;
  // the first plan above this one whose allowance covers the team
  const roomier: Plan | undefined = !plan ? undefined : ([0, 1, 2] as PlanTier[]).map((tier) => planByTier(pack.id, tier)).find((p): p is Plan => !!p && p.tier > plan.tier && (p.users === 'unlimited' || p.users >= seats));
  // price and billing of the extra-user add-on, worded in the viewer's language by the pricing library
  const extra = addOnViews(pack.id, lang, t).find((a) => a.id === 'extra_user_foundation');
  const allowance = (p: Plan) => (p.users === 'unlimited' ? t('settings.team.unlimited') : String(p.users));
  const center = moduleOn(data, pack, 'security') && can('users');

  return (
    <>
      <PeopleCard ids="settings" note />
      {plan && (
        <Card>
          <div className="settings-allow settings-allow-own" data-testid="settings-allowance">
            <span>{t('settings.team.allowance', { plan: planLabel, allowance: allowance(plan), n: seats })}</span>
          </div>
          {over && (
            <Note tone="warn">
              <div className="row" data-testid="settings-over">
                <span>{plan.tier === 0 ? t('settings.team.overEntry', { n: seats - Number(limit) }) : roomier ? t('settings.team.overUp', { plan: planName(roomier, lang), allowance: allowance(roomier) }) : t('settings.team.overPlain')}</span>
                {plan.tier === 0 && <PlanBadge feature="extraUser" />}
                {plan.tier === 0 && extra?.price && <b className="small nowrap">{extra.price}{extra.billing ? ` ${extra.billing}` : ''}</b>}
              </div>
              <div className="xs muted" style={{ marginTop: 4 }}>{t('settings.team.overDemo')}</div>
            </Note>
          )}
        </Card>
      )}
      <RolesCard ids="settings" />
      {center && <p className="small muted">{t('settings.team.more')} <A to="/security">{t('nav.security')}</A></p>}
      <StepUpHost />
    </>
  );
}
