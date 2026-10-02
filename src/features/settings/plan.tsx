// Plan and add-ons, and Connections. Every price, plan name, allowance and rule on these screens comes from the pricing library.
import { useState, type ReactNode } from 'react';
import { LuCalendarCheck, LuCalendarPlus, LuCalendarSync, LuCheck, LuGlobe, LuInfo, LuMail, LuMailCheck, LuMessageSquareText, LuTag } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, navigate } from '@/app/router';
import { DemoTag, PlanBadge } from '@/app/shared';
import { setPrefs } from '@/store/store';
import { Badge, Button, Card, Modal, Note, cx } from '@/ui';
import type { EntitlementId } from '@/domain/entitlements';
import { planName, plansFor } from '@/lib/pricing';
import { addOnViews, planFeatures, planSupport, type AddOnView } from '@/lib/pricing-view';
import { money } from '@/lib/money';
import { emailSendingRule } from './helpers';

/* ---------- plan and add-ons ---------- */
export function PlanSection() {
  const { t, pack, plan, planLabel, lang } = useApp();
  const plans = plansFor(pack.id);
  const addOns = addOnViews(pack.id, lang, t);
  const users = plan.users === 'unlimited' ? t('settings.team.unlimited') : String(plan.users);
  const standing = (a: AddOnView) => (
    <>
      {a.notBuilt && <Badge tone="warn" outline>{t('settings.plan.notBuilt')}</Badge>}
      {a.kind === 'usage' ? <Badge tone="info">{t('ent.usage')}</Badge> : a.kind === 'custom' ? <Badge tone="violet" outline>{t('ent.custom')}</Badge> : <Badge tone="violet">{t('ent.addon')}</Badge>}
    </>
  );
  return (
    <>
      <Card title={t('settings.plan.title')}>
        <p className="muted settings-lead">{t('settings.plan.intro', { product: pack.product })}</p>
        <div className="settings-plans" role="group" aria-label={t('settings.plan.pick')}>
          {plans.map((p) => (
            <button key={p.id} type="button" className="settings-plan" aria-pressed={p.tier === plan.tier} onClick={() => setPrefs({ planTier: p.tier })} data-testid={`settings-plan-${p.tier}`}>
              <span className="row between nowrap"><b>{planName(p, lang)}</b>{p.mostPopular && <Badge tone="accent">{t('settings.plan.popular')}</Badge>}</span>
              <span className="settings-price">{money(p.monthly)}<small> {t('settings.plan.perMonth')}</small></span>
              <span className="xs dim">{p.tier === plan.tier ? t('settings.plan.previewing') : t('settings.plan.preview')}</span>
            </button>
          ))}
        </div>

        <div className="settings-plan-detail" data-testid="settings-plan-detail">
          <div>
            <h3>{t('settings.plan.includes', { plan: planLabel })}</h3>
            <ul className="settings-checks">
              {planFeatures(plan, pack.id, lang, t).map((f) => <li key={f}><LuCheck aria-hidden="true" /><span>{f}</span></li>)}
              <li><LuCheck aria-hidden="true" /><span>{planSupport(plan, pack.id, lang, t)}</span></li>
            </ul>
          </div>
          <dl className="kv settings-plan-kv">
            <dt>{t('settings.plan.monthly')}</dt><dd>{money(plan.monthly)} {t('settings.plan.perMonth')}</dd>
            <dt>{t('settings.plan.yearly')}</dt><dd>{money(plan.yearly)} {t('settings.plan.perYear')}</dd>
            {plan.yearlyFreeMonths > 0 && <><dt>{t('settings.plan.freeMonths')}</dt><dd>{plan.yearlyFreeMonths}</dd></>}
            <dt>{t('settings.plan.setup')}</dt><dd>{money(plan.setup)} {t('settings.plan.once')}</dd>
            <dt>{t('settings.plan.users')}</dt><dd>{users}</dd>
          </dl>
        </div>
        <div className="card-foot">
          <span className="small muted">{t('settings.plan.demoOnly')}</span>
          <div className="row">
            <Button icon={<LuTag aria-hidden="true" />} onClick={() => navigate('/pricing')} data-testid="settings-pricing">{t('settings.plan.seePricing')}</Button>
            <Button variant="primary" icon={<LuCalendarCheck aria-hidden="true" />} onClick={() => navigate('/request-demo')} data-testid="settings-request-demo">{t('demo.request')}</Button>
          </div>
        </div>
      </Card>

      <Card title={t('settings.plan.addOns')}>
        <p className="muted settings-lead">{t('settings.plan.addOnsIntro')}</p>
        <div className="list" data-testid="settings-addons">
          {addOns.map((a) => (
            <div className="item settings-addon" key={a.id} data-addon={a.id}>
              <div className="grow">
                <div className="t">{a.name}</div>
                {a.note && <div className="small muted">{a.note}</div>}
                {!a.price && a.billing && <div className="xs dim">{a.billing}</div>}
              </div>
              <div className="settings-addon-r">
                {standing(a)}
                {a.price && <span className="small"><b>{a.price}</b>{a.billing ? ` ${a.billing}` : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ---------- connections: what gets connected during setup, and what already works ---------- */
interface Connection { id: string; icon: ReactNode; feature: EntitlementId; works?: boolean; extra?: 'emailRule' | 'smsNote' }
const CONNECTIONS: Connection[] = [
  { id: 'calSend', icon: <LuCalendarPlus aria-hidden="true" />, feature: 'calendarSend', works: true },
  { id: 'calSync', icon: <LuCalendarSync aria-hidden="true" />, feature: 'calendarSync' },
  { id: 'emailDocs', icon: <LuMail aria-hidden="true" />, feature: 'emailDocs', extra: 'emailRule' },
  { id: 'clientEmails', icon: <LuMailCheck aria-hidden="true" />, feature: 'clientEmails', extra: 'emailRule' },
  { id: 'webLeads', icon: <LuGlobe aria-hidden="true" />, feature: 'websiteLeads' },
  { id: 'sms', icon: <LuMessageSquareText aria-hidden="true" />, feature: 'sms', extra: 'smsNote' },
];

export function ConnectionsSection() {
  const { t, pack, lang, standing } = useApp();
  const [open, setOpen] = useState<Connection | null>(null);
  const rule = emailSendingRule(pack.id, lang, t);
  const smsNote = addOnViews(pack.id, lang, t).find((a) => a.id === 'sms')?.note ?? null;
  const upgradeHint = (feature: EntitlementId) => { const s = standing(feature); return s.state === 'upgrade' && s.plan ? t('ent.upgradeHint', { plan: planName(s.plan, lang) }) : null; };
  return (
    <>
      <Card title={t('settings.conn.title')}>
        <p className="muted settings-lead">{t('settings.conn.intro')}</p>
        <div className="list" data-testid="settings-connections">
          {CONNECTIONS.map((c) => {
            const hint = upgradeHint(c.feature);
            return (
              <div className="item settings-conn" key={c.id} data-conn={c.id}>
                <span className={cx('settings-conn-ic', c.works && 'on')}>{c.icon}</span>
                <div className="grow">
                  <div className="t">{t(`settings.conn.${c.id}.name`)}</div>
                  <div className="small muted">{t(`settings.conn.${c.id}.text`)}</div>
                  <div className="row tight settings-conn-tags">
                    <PlanBadge feature={c.feature} detail />
                    {c.works ? <Badge tone="ok">{t('settings.conn.worksNow')}</Badge> : <DemoTag kind="connect" />}
                    {hint && <span className="xs muted">{hint}</span>}
                  </div>
                </div>
                {c.works
                  ? <A to="/calendar" className="btn sm settings-conn-btn">{t('settings.conn.openCalendar')}</A>
                  : <Button size="sm" icon={<LuInfo aria-hidden="true" />} className="settings-conn-btn" onClick={() => setOpen(c)} data-testid="settings-conn-how">{t('settings.conn.how')}</Button>}
              </div>
            );
          })}
        </div>
      </Card>
      <Note>{t('settings.conn.honest')}</Note>

      {open && (
        <Modal title={t(`settings.conn.${open.id}.name`)} onClose={() => setOpen(null)} labelClose={t('common.close')}
          footer={<><Button variant="ghost" onClick={() => setOpen(null)}>{t('common.close')}</Button><Button variant="primary" icon={<LuCalendarCheck aria-hidden="true" />} onClick={() => navigate('/request-demo')}>{t('demo.request')}</Button></>}>
          <div className="stack tight" data-testid="settings-conn-modal">
            <div className="row tight"><PlanBadge feature={open.feature} detail /><DemoTag kind="connect" /></div>
            <h3>{t('settings.conn.setupTitle')}</h3>
            <p>{t(`settings.conn.${open.id}.setup`)}</p>
            {open.extra === 'emailRule' && rule && <p className="small muted">{rule}</p>}
            {open.extra === 'smsNote' && smsNote && <p className="small muted">{smsNote}</p>}
            {upgradeHint(open.feature) && <p className="small muted">{upgradeHint(open.feature)}</p>}
            <Note>{t('settings.conn.notNow')}</Note>
          </div>
        </Modal>
      )}
    </>
  );
}
