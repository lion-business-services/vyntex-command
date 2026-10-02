// Request a demo. The form posts to /api/demo-request and the page only ever says what really happened:
// delivered, not delivered (with email, phone and WhatsApp that work right now), or failed.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuCircleCheck, LuMail, LuMessageCircle, LuPhone, LuTriangleAlert } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, useRoute, PREVIEW } from '@/app/router';
import { PACKS, PACK_LIST, isIndustry } from '@/packs';
import type { Lang } from '@/domain/types';
import { planName, plansFor } from '@/lib/pricing';
import { BRAND } from '@/config/brand';
import { cx } from '@/ui';
import { ContactList, Frame, MkPage, mailHref, usePageTitle, whatsappHref } from './parts';

type Method = 'phone' | 'whatsapp' | 'email';
type Field = 'name' | 'business' | 'industry' | 'phone' | 'email' | 'language' | 'method' | 'team' | 'message' | 'consent';
interface FormState { name: string; business: string; industry: string; phone: string; email: string; language: Lang; method: Method; team: string; message: string; consent: boolean; website: string }
type Outcome = 'delivered' | 'unsent' | 'failed' | 'limited';

const METHODS: Method[] = ['phone', 'whatsapp', 'email'];
const TEAM_SIZES = ['1', '2-5', '6-15', '16+'];
const ORDER: Field[] = ['name', 'business', 'industry', 'phone', 'email', 'language', 'method', 'team', 'message', 'consent'];
/** Names the server uses for the fields that are called differently here. */
const SERVER_FIELD: Record<string, Field> = { contactMethod: 'method', teamSize: 'team' };
const MESSAGE_MAX = 1000;

function problems(f: FormState): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (f.name.trim().length < 2) e.name = 'mk.rd.err.name';
  if (f.business.trim().length < 2) e.business = 'mk.rd.err.business';
  const digits = f.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) e.phone = 'mk.rd.err.phone';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'mk.rd.err.email';
  if (f.message.trim().length > MESSAGE_MAX) e.message = 'mk.rd.err.message';
  if (!f.consent) e.consent = 'mk.rd.err.consent';
  return e;
}

export function RequestDemo() {
  const { t, pack, lang } = useApp();
  usePageTitle(t('mk.title.request'));
  const route = useRoute();
  const blank = (): FormState => {
    // Coming from the pricing page: carry the plan the visitor was looking at into the message.
    const tier = Number(route.query.get('plan')); const plan = plansFor(pack.id).find((p) => p.tier === tier && route.query.has('plan'));
    const billing = route.query.get('billing') === 'yearly' ? 'yearly' : 'monthly';
    const message = plan ? t('mk.pr.planMsg', { plan: planName(plan, lang), billing: t(`mk.pr.${billing}.lc`), name: pack.product }) : '';
    return { name: '', business: '', industry: pack.id, phone: '', email: '', language: lang, method: 'phone', team: TEAM_SIZES[1], message, consent: false, website: '' };
  };
  const [f, setF] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (outcome) resultRef.current?.focus(); }, [outcome]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((s) => ({ ...s, [k]: v })); if (errors[k as Field]) setErrors((e) => { const n = { ...e }; delete n[k as Field]; return n; }); };
  const focusFirst = (e: Partial<Record<Field, string>>) => { const first = ORDER.find((k) => e[k]); if (first) document.getElementById('rd-f-' + first)?.focus(); };

  const industryName = isIndustry(f.industry) ? `${PACKS[f.industry].product} (${PACKS[f.industry].label[lang]})` : t('mk.rd.other');
  const consentText = t('mk.rd.consent', { company: BRAND.company });
  /** The visitor's answers as plain text, for the email and WhatsApp links that work without the server. */
  const summary = [
    t('mk.rd.mail.intro', { name: isIndustry(f.industry) ? PACKS[f.industry].product : BRAND.platformName }), '',
    `${t('mk.rd.name')}: ${f.name.trim()}`, `${t('mk.rd.business')}: ${f.business.trim()}`, `${t('mk.rd.industry')}: ${industryName}`,
    `${t('mk.rd.phone')}: ${f.phone.trim()}`, `${t('mk.rd.email')}: ${f.email.trim()}`, `${t('mk.rd.language')}: ${t('mk.rd.lang.' + f.language)}`,
    `${t('mk.rd.method')}: ${t('mk.rd.method.' + f.method)}`, `${t('mk.rd.team')}: ${t('mk.rd.team.' + f.team)}`,
    ...(f.message.trim() ? ['', f.message.trim()] : []),
  ].join('\n');

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const found = problems(f);
    setErrors(found);
    if (Object.keys(found).length) { setOutcome(null); focusFirst(found); return; }
    setBusy(true); setOutcome(null);
    // an embedded preview has no server behind it: say so instead of failing
    if (PREVIEW) { setOutcome('unsent'); setBusy(false); return; }
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: f.name, business: f.business, industry: f.industry, phone: f.phone, email: f.email, language: f.language, contactMethod: f.method, teamSize: f.team, message: f.message, consent: f.consent, consentText, website: f.website }),
      });
      let body: any = null;
      try { body = await res.json(); } catch { /* not the answer we expect: handled as a failure below */ }
      if (res.ok && body?.ok === true && body.delivered === true) setOutcome('delivered');
      else if (res.ok && body?.ok === true) setOutcome(body.reason === 'not_configured' ? 'unsent' : 'failed');
      else if (res.status === 400 && body?.error === 'invalid' && body.fields && typeof body.fields === 'object') {
        const fromServer: Partial<Record<Field, string>> = {};
        for (const key of Object.keys(body.fields)) { const k = (SERVER_FIELD[key] ?? key) as Field; if (ORDER.includes(k)) fromServer[k] = t(`mk.rd.err.${k}`) !== `mk.rd.err.${k}` ? `mk.rd.err.${k}` : 'mk.rd.err.generic'; }
        if (Object.keys(fromServer).length) { setErrors(fromServer); focusFirst(fromServer); } else setOutcome('failed');
      }
      else setOutcome(res.status === 429 ? 'limited' : 'failed');
    } catch { setOutcome('failed'); }
    setBusy(false);
  };

  const err = (k: Field) => (errors[k] ? <span className="mk-err" id={`rd-e-${k}`} data-testid={`rd-error-${k}`}>{t(errors[k]!)}</span> : null);
  const aria = (k: Field) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `rd-e-${k}` : undefined });
  const field = (k: Field, label: ReactNode, control: ReactNode, full?: boolean) => (
    <div className={cx('field', errors[k] && 'err', full && 'full')}><label htmlFor={`rd-f-${k}`}>{label}</label>{control}{err(k)}</div>
  );
  const alternatives = (
    <ul className="mk-alt">
      <li><a className="mk-btn" href={mailHref(t('mk.rd.mail.subject', { business: f.business.trim() || f.name.trim() }), summary)} data-testid="rd-alt-email"><LuMail aria-hidden="true" />{t('mk.rd.alt.email', { email: BRAND.email })}</a></li>
      <li><a className="mk-btn" href={whatsappHref(summary)} target="_blank" rel="noopener noreferrer" data-testid="rd-alt-whatsapp"><LuMessageCircle aria-hidden="true" />{t('mk.rd.alt.whatsapp')}</a></li>
      <li><a className="mk-btn" href={BRAND.phoneHref} data-testid="rd-alt-call"><LuPhone aria-hidden="true" />{t('mk.rd.alt.call', { phone: BRAND.phone })}</a></li>
    </ul>
  );
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <MkPage current="request">
      <section className="mk-wrap mk-page-h">
        <h1>{t('mk.rd.h')}</h1>
        <p className="mk-page-sub">{t('mk.rd.sub')}</p>
      </section>
      <section className="mk-wrap mk-rd">
        <Frame className="mk-rd-form">
          {outcome === 'delivered' ? (
            <div className="mk-result ok" role="status" tabIndex={-1} ref={resultRef} data-testid="rd-result" data-state="delivered">
              <LuCircleCheck aria-hidden="true" />
              <div><h2>{t('mk.rd.ok')}</h2>
                <button type="button" className="linkbtn" onClick={() => { setF(blank()); setErrors({}); setOutcome(null); }} data-testid="rd-again">{t('mk.rd.ok.again')}</button></div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate data-testid="rd-form" aria-label={t('mk.rd.h')}>
              <div className="fgrid">
                {field('name', t('mk.rd.name'), <input id="rd-f-name" type="text" autoComplete="name" maxLength={100} value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="rd-name" {...aria('name')} />)}
                {field('business', t('mk.rd.business'), <input id="rd-f-business" type="text" autoComplete="organization" maxLength={120} value={f.business} onChange={(e) => set('business', e.target.value)} data-testid="rd-business" {...aria('business')} />)}
                {field('phone', t('mk.rd.phone'), <input id="rd-f-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={f.phone} onChange={(e) => set('phone', e.target.value)} data-testid="rd-phone" {...aria('phone')} />)}
                {field('email', t('mk.rd.email'), <input id="rd-f-email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={f.email} onChange={(e) => set('email', e.target.value)} data-testid="rd-email" {...aria('email')} />)}
                {field('industry', t('mk.rd.industry'),
                  <select id="rd-f-industry" value={f.industry} onChange={(e) => set('industry', e.target.value)} data-testid="rd-industry" {...aria('industry')}>
                    {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.label[lang]}</option>)}
                    <option value="other">{t('mk.rd.other')}</option>
                  </select>)}
                {field('team', t('mk.rd.team'),
                  <select id="rd-f-team" value={f.team} onChange={(e) => set('team', e.target.value)} data-testid="rd-team" {...aria('team')}>
                    {TEAM_SIZES.map((s) => <option key={s} value={s}>{t('mk.rd.team.' + s)}</option>)}
                  </select>)}
                <fieldset className="mk-choice" data-testid="rd-language">
                  <legend>{t('mk.rd.language')}</legend>
                  <div>{(['en', 'es'] as Lang[]).map((l, i) => (
                    <label key={l}><input type="radio" name="language" id={i === 0 ? 'rd-f-language' : undefined} value={l} checked={f.language === l} onChange={() => set('language', l)} data-testid={`rd-language-${l}`} /><span>{t('mk.rd.lang.' + l)}</span></label>
                  ))}</div>
                </fieldset>
                <fieldset className="mk-choice" data-testid="rd-method">
                  <legend>{t('mk.rd.method')}</legend>
                  <div>{METHODS.map((m, i) => (
                    <label key={m}><input type="radio" name="method" id={i === 0 ? 'rd-f-method' : undefined} value={m} checked={f.method === m} onChange={() => set('method', m)} data-testid={`rd-method-${m}`} /><span>{t('mk.rd.method.' + m)}</span></label>
                  ))}</div>
                </fieldset>
                {field('message', <>{t('mk.rd.message')} <span className="mk-opt">({t('common.optional')})</span></>,
                  <textarea id="rd-f-message" rows={3} maxLength={MESSAGE_MAX} value={f.message} onChange={(e) => set('message', e.target.value)} data-testid="rd-message" {...aria('message')} />, true)}
                <div className={cx('mk-consent full', errors.consent && 'err')}>
                  <label className="check"><input id="rd-f-consent" type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} data-testid="rd-consent" aria-required="true" {...aria('consent')} /><span>{consentText}</span></label>
                  {err('consent')}
                </div>
                <div className="mk-hp" aria-hidden="true">
                  <label htmlFor="rd-f-website">{t('mk.rd.hp')}</label>
                  <input id="rd-f-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} data-testid="rd-website" />
                </div>
              </div>

              {hasErrors && <p className="mk-err mk-err-sum" role="alert" data-testid="rd-errors">{t('mk.rd.err.summary')}</p>}
              {outcome && (
                <div className="mk-result warn" role="alert" tabIndex={-1} ref={resultRef} data-testid="rd-result" data-state={outcome}>
                  <LuTriangleAlert aria-hidden="true" />
                  <div>
                    <h2>{t(outcome === 'unsent' ? 'mk.rd.unsent.h' : outcome === 'limited' ? 'mk.rd.limit.h' : 'mk.rd.fail.h')}</h2>
                    <p>{t(outcome === 'unsent' ? 'mk.rd.unsent.p' : outcome === 'limited' ? 'mk.rd.limit.p' : 'mk.rd.fail.p')}</p>
                    {alternatives}
                  </div>
                </div>
              )}
              <div className="mk-rd-send">
                <button type="submit" className="mk-btn primary" disabled={busy} aria-busy={busy || undefined} data-testid="rd-submit">{t(busy ? 'mk.rd.sending' : 'mk.rd.submit')}</button>
              </div>
            </form>
          )}
        </Frame>

        <aside className="mk-rd-aside">
          <h2>{t('mk.rd.aside.h')}</h2>
          <p>{t('mk.rd.aside.p')}</p>
          <ContactList />
          <h2>{t('mk.rd.aside.look')}</h2>
          <p>{t('mk.rd.aside.lookP')}</p>
          <Link to="/demo" className="mk-btn" data-testid="rd-open-demo">{t('mk.cta.demo')}</Link>
        </aside>
      </section>
    </MkPage>
  );
}
