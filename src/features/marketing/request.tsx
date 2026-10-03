// Request a demo. The form posts to /api/demo-request and the page only ever says what really happened:
// delivered, not delivered (with email, phone and WhatsApp that work right now), or failed.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuCircleAlert, LuLayers, LuMail, LuMessageCircle, LuPalette, LuPhone, LuSlidersHorizontal, LuTriangleAlert, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, useRoute, PREVIEW } from '@/app/router';
import { PACKS, PACK_LIST, isIndustry } from '@/packs';
import type { Lang } from '@/domain/types';
import { planName, plansFor } from '@/lib/pricing';
import { BRAND } from '@/config/brand';
import { Arrow, Reveal } from '@/brand';
import { Badge, cx } from '@/ui';
import { ContactList, MkPage, usePageTitle } from './parts';
import './pages.css';

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

/** Links that work without the server, built from the official contact details in config/brand.ts. */
const whatsappHref = (text?: string) => `https://wa.me/${BRAND.phoneHref.replace(/\D/g, '')}${text ? '?text=' + encodeURIComponent(text) : ''}`;
const mailHref = (subject?: string, body?: string) => {
  const q = [subject && 'subject=' + encodeURIComponent(subject), body && 'body=' + encodeURIComponent(body)].filter(Boolean).join('&');
  return `mailto:${BRAND.email}${q ? '?' + q : ''}`;
};

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

/** The platform name set like the lockup, inside a sentence. */
function PlatformName() {
  const [first, ...rest] = BRAND.platformName.split(' ');
  return <span className="mkp-product"><span className="chrome-text">{first}</span>{rest.length > 0 && <> <span className="brand-text">{rest.join(' ')}</span></>}</span>;
}

/** Shown once, only for a request that was really delivered: a circuit line completes toward a check node, then stays still. */
function DeliveredMark() {
  return (
    <svg className="mkp-done-fig" viewBox="0 0 272 64" width="272" height="64" fill="none" aria-hidden="true">
      <path className="ln" pathLength={100} d="M5 32 H78 L98 12 H158 L178 32 H216" />
      <circle className="nd" cx="5" cy="32" r="3.5" />
      <circle className="ring" cx="240" cy="32" r="23" />
      <path className="ck" pathLength={100} d="M229.5 32.5 l7.5 7.5 l14 -15.5" />
    </svg>
  );
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

  const err = (k: Field) => (errors[k] ? <span className="mkp-err" id={`rd-e-${k}`} data-testid={`rd-error-${k}`}><LuCircleAlert aria-hidden="true" />{t(errors[k]!)}</span> : null);
  const aria = (k: Field) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `rd-e-${k}` : undefined });
  const field = (k: Field, label: ReactNode, control: ReactNode, full?: boolean) => (
    <div className={cx('mkp-field', errors[k] && 'err', full && 'full')}><label htmlFor={`rd-f-${k}`}>{label}</label>{control}{err(k)}</div>
  );
  const alternatives = (
    <ul className="mkp-alt">
      <li><a className="btn" href={mailHref(t('mk.rd.mail.subject', { business: f.business.trim() || f.name.trim() }), summary)} data-testid="rd-alt-email"><LuMail aria-hidden="true" />{t('mk.rd.alt.email', { email: BRAND.email })}</a></li>
      <li><a className="btn" href={whatsappHref(summary)} target="_blank" rel="noopener noreferrer" data-testid="rd-alt-whatsapp"><LuMessageCircle aria-hidden="true" />{t('mk.rd.alt.whatsapp')}</a></li>
      <li><a className="btn" href={BRAND.phoneHref} data-testid="rd-alt-call"><LuPhone aria-hidden="true" />{t('mk.rd.alt.call', { phone: BRAND.phone })}</a></li>
    </ul>
  );
  const hasErrors = Object.keys(errors).length > 0;
  const delivered = outcome === 'delivered';

  // the headline names the platform; the name is set like the lockup
  const mark = '\u0001';
  const head = t('mk.p2.rd.h', { name: mark }).split(mark);
  const brandWord = BRAND.platformName.split(' ')[0];
  const editions = PACK_LIST.map((p) => (p.product.startsWith(brandWord + ' ') ? p.product.slice(brandWord.length + 1) : p.product));
  const benefits: { icon: ReactNode; h: string; p: string; extra?: ReactNode }[] = [
    { icon: <LuLayers aria-hidden="true" />, h: t('mk.p2.rd.b1.h'), p: t('mk.p2.rd.b1.p', { n: PACK_LIST.length }), extra: <span className="mkp-editions">{editions.map((e) => <span key={e}>{e}</span>)}</span> },
    { icon: <LuSlidersHorizontal aria-hidden="true" />, h: t('mk.p2.rd.b2.h'), p: t('mk.p2.rd.b2.p') },
    { icon: <LuPalette aria-hidden="true" />, h: t('mk.p2.rd.b3.h'), p: t('mk.p2.rd.b3.p') },
    { icon: <LuUsers aria-hidden="true" />, h: t('mk.p2.rd.b4.h'), p: t('mk.p2.rd.b4.p'), extra: <Link to="/pricing" className="mkp-quiet" data-testid="rd-see-pricing">{t('mk.p2.rd.b4.link')}<Arrow /></Link> },
  ];
  const methodDetail = f.method === 'email' ? f.email.trim() : f.phone.trim();

  return (
    <MkPage current="request">
      <div className="mkp">
        <div className="mkp-rd-bg" aria-hidden="true" />
        <div className="mkp-wrap mkp-rd">
          {/* the first heading is drawn at once: it is the largest thing on the first screen */}
          <header className="mkp-rd-intro">
            <h1>{head.length === 2 ? <>{head[0]}<PlatformName />{head[1]}</> : t('mk.p2.rd.h', { name: BRAND.platformName })}</h1>
            <p className="mkp-lede">{t('mk.p2.rd.lede')}</p>
          </header>

          <div className="mkp-rd-form">
            <Reveal kind="panel" delay={80}>
              <div className="mkp-premium mkp-form">
                {delivered ? (
                  <div className="mkp-done" role="status" tabIndex={-1} ref={resultRef} data-testid="rd-result" data-state="delivered">
                    <DeliveredMark />
                    <h2>{t('mk.rd.ok')}</h2>
                    <h3>{t('mk.p2.rd.done.sent')}</h3>
                    <dl className="mkp-done-sent">
                      <div><dt>{t('mk.rd.business')}</dt><dd>{f.business.trim()}</dd></div>
                      <div><dt>{t('mk.rd.method')}</dt><dd>{t('mk.rd.method.' + f.method)}{methodDetail && <span>{methodDetail}</span>}</dd></div>
                      <div><dt>{t('mk.rd.language')}</dt><dd>{t('mk.rd.lang.' + f.language)}</dd></div>
                    </dl>
                    <h3>{t('mk.p2.rd.next.h')}</h3>
                    <ol className="mkp-steps">
                      <li>{t('mk.p2.rd.n2')}</li>
                      <li>{t('mk.p2.rd.n3')}</li>
                    </ol>
                    <div className="mkp-done-act">
                      <Link to="/demo" className="btn primary lg" data-testid="rd-open-demo">{t('mk.p2.rd.done.demo')}<Arrow /></Link>
                      <button type="button" className="linkbtn" onClick={() => { setF(blank()); setErrors({}); setOutcome(null); }} data-testid="rd-again">{t('mk.rd.ok.again')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <header className="mkp-form-h">
                      <h2 id="rd-form-h">{t('mk.p2.rd.form.h')}</h2>
                      <p>{t('mk.p2.rd.form.p')}</p>
                    </header>
                    <form onSubmit={submit} noValidate data-testid="rd-form" aria-labelledby="rd-form-h">
                      <div className="mkp-fgrid">
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
                        <fieldset className="mkp-choice lang" data-testid="rd-language">
                          <legend>{t('mk.rd.language')}</legend>
                          <div>{(['en', 'es'] as Lang[]).map((l, i) => (
                            <label key={l}><input type="radio" name="language" id={i === 0 ? 'rd-f-language' : undefined} value={l} checked={f.language === l} onChange={() => set('language', l)} data-testid={`rd-language-${l}`} /><span>{t('mk.rd.lang.' + l)}</span></label>
                          ))}</div>
                        </fieldset>
                        <fieldset className="mkp-choice method" data-testid="rd-method">
                          <legend>{t('mk.rd.method')}</legend>
                          <div>{METHODS.map((m, i) => (
                            <label key={m}><input type="radio" name="method" id={i === 0 ? 'rd-f-method' : undefined} value={m} checked={f.method === m} onChange={() => set('method', m)} data-testid={`rd-method-${m}`} /><span>{t('mk.rd.method.' + m)}</span></label>
                          ))}</div>
                        </fieldset>
                        {field('message', <>{t('mk.rd.message')} <span className="mkp-opt">({t('common.optional')})</span></>,
                          <textarea id="rd-f-message" rows={3} maxLength={MESSAGE_MAX} value={f.message} onChange={(e) => set('message', e.target.value)} data-testid="rd-message" {...aria('message')} />, true)}
                        <div className={cx('mkp-consent full', errors.consent && 'err')}>
                          <label><input id="rd-f-consent" type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} data-testid="rd-consent" aria-required="true" {...aria('consent')} /><span>{consentText}</span></label>
                          {err('consent')}
                        </div>
                        <div className="mkp-hp" aria-hidden="true">
                          <label htmlFor="rd-f-website">{t('mk.rd.hp')}</label>
                          <input id="rd-f-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} data-testid="rd-website" />
                        </div>
                      </div>

                      {hasErrors && <p className="mkp-err mkp-err-sum" role="alert" data-testid="rd-errors"><LuCircleAlert aria-hidden="true" />{t('mk.rd.err.summary')}</p>}
                      {outcome && (
                        <div className="mkp-result" role="alert" tabIndex={-1} ref={resultRef} data-testid="rd-result" data-state={outcome}>
                          <p className="mkp-result-tag"><Badge tone="warn" outline><LuTriangleAlert aria-hidden="true" />{t('mk.p2.rd.notSent')}</Badge></p>
                          <h2>{t(outcome === 'unsent' ? 'mk.rd.unsent.h' : outcome === 'limited' ? 'mk.rd.limit.h' : 'mk.rd.fail.h')}</h2>
                          <p>{t(outcome === 'unsent' ? 'mk.rd.unsent.p' : outcome === 'limited' ? 'mk.rd.limit.p' : 'mk.rd.fail.p')}</p>
                          {alternatives}
                        </div>
                      )}
                      <div className="mkp-send">
                        <button type="submit" className="btn primary lg block" disabled={busy} aria-busy={busy || undefined} data-testid="rd-submit">{t(busy ? 'mk.rd.sending' : 'mk.rd.submit')}{!busy && <Arrow />}</button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </Reveal>
            <Reveal as="section" aria-labelledby="rd-talk-h" className="mkp-talk">
              <div>
                <h2 id="rd-talk-h">{t('mk.rd.aside.h')}</h2>
                <p>{t('mk.rd.aside.p')}</p>
                <ContactList className="mkp-contact" />
              </div>
              {/* once the request is delivered, the confirmation above carries the link to the demo */}
              {!delivered && (
                <div className="mkp-look">
                  <h2>{t('mk.rd.aside.look')}</h2>
                  <p>{t('mk.rd.aside.lookP')}</p>
                  <Link to="/demo" className="btn" data-testid="rd-open-demo">{t('mk.p2.rd.demo')}<Arrow /></Link>
                </div>
              )}
            </Reveal>
          </div>

          <aside className="mkp-rd-aside">
            <Reveal as="section" aria-labelledby="rd-why-h">
              <h2 id="rd-why-h">{t('mk.p2.rd.why.h')}</h2>
              <ul className="mkp-benefits">
                {benefits.map((b, i) => (
                  <li key={i}>{b.icon}<div><h3>{b.h}</h3><p>{b.p}</p>{b.extra}</div></li>
                ))}
              </ul>
            </Reveal>
            {!delivered && (
              <Reveal as="section" aria-labelledby="rd-next-h">
                <h2 id="rd-next-h">{t('mk.p2.rd.next.h')}</h2>
                <ol className="mkp-steps">
                  <li>{t('mk.p2.rd.n1')}</li>
                  <li>{t('mk.p2.rd.n2')}</li>
                  <li>{t('mk.p2.rd.n3')}</li>
                </ol>
              </Reveal>
            )}
          </aside>
        </div>
      </div>
    </MkPage>
  );
}
