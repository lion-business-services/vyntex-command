// Settings: the company. Its name as people see it and its legal name, logo, address, phone, email, website, time zone and
// opening hours, and (where the deployment lets a company choose one) its accent colour. A small copy of the workspace
// shows the result before anything is saved. Registered as the first section in ./panels.ts.
import { useEffect, useState } from 'react';
import { LuBriefcase, LuImage, LuLayoutDashboard, LuTrash2, LuUpload, LuUserPlus } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { DEPLOY } from '@/config/deployment';
import { act } from '@/store/store';
import { Button, Card, Field, Note, cx, toast } from '@/ui';
import type { Company } from '@/domain/types';
import { ACCENT_PRESETS, MAX_LOGO_BYTES, accentVars, hardToRead, isHex, readLogo, rootToken, suggestInitials, timeZones, zoneLabel, type LogoProblem } from './helpers';
import { isInline, storeImage, useStoredImage } from './image';
import { saveCompany, type Hours } from './actions';
import { SuccessCheck } from '@/features/documents/success';

const FIELDS = ['name', 'initials', 'license', 'phone', 'email', 'logo', 'accent', 'legalName', 'address', 'website', 'timezone'] as const;
/** A brand whose colours are fixed has no accent to choose: under LBS Command the gold stays the gold. */
const ACCENT_ALLOWED = DEPLOY.theme !== 'lbs';
const NO_HOURS: Hours = { days: [], open: '09:00', close: '17:00' };
const sameHours = (a: Hours, b: Hours) => a.open === b.open && a.close === b.close && a.days.join() === b.days.join();
const webAddress = (v: string) => { const s = v.trim(); if (!s) return ''; try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); return u.hostname.includes('.') ? u.toString().replace(/\/$/, '') : null; } catch { return null; } };

export default function BusinessSection() {
  const { t, data, pack, prefs, lang, can, live } = useApp();
  const saved = data.company;
  const savedHours = data.config.hours ?? NO_HOURS;
  const [f, setF] = useState<Company>({ ...saved });
  const [hours, setHours] = useState<Hours>(savedHours);
  const [ownInitials, setOwnInitials] = useState(false);
  const [logoErr, setLogoErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // a reset or another tab replaces the company record: start again from what is saved
  useEffect(() => { setF({ ...saved }); setHours(data.config.hours ?? NO_HOURS); setOwnInitials(false); setLogoErr(''); setErr(''); }, [saved, data.config.hours]);

  const mayHours = can('config');
  const dirty = FIELDS.some((k) => (f[k] ?? '') !== (saved[k] ?? '')) || !sameHours(hours, savedHours);
  const set = (patch: Partial<Company>) => { setErr(''); setJustSaved(false); setF((cur) => ({ ...cur, ...patch })); };
  const setName = (name: string) => set(ownInitials ? { name } : { name, initials: suggestInitials(name) || f.initials });
  const pickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { const logo = await readLogo(file); setLogoErr(''); set({ logo }); }
    catch (why) { setLogoErr(t('settings.biz.logoErr.' + ((why as LogoProblem) || 'read'), { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) })); }
  };
  const toggleDay = (n: number) => { setJustSaved(false); setErr(''); setHours((h) => ({ ...h, days: h.days.includes(n) ? h.days.filter((x) => x !== n) : [...h.days, n].sort() })); };
  const save = async () => {
    const name = f.name.trim();
    if (!name) { setErr(t('settings.biz.needName')); return; }
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) { setErr(t('settings.biz.badEmail')); return; }
    const website = webAddress(f.website ?? '');
    if (website === null) { setErr(t('settings.biz.badWebsite')); return; }
    if (hours.days.length && hours.open >= hours.close) { setErr(t('settings.biz.badHours')); return; }
    const next: Company = { name, initials: (f.initials.trim() || suggestInitials(name)).slice(0, 3).toUpperCase(), license: f.license.trim(), phone: f.phone.trim(), email: f.email.trim() };
    if (f.legalName?.trim()) next.legalName = f.legalName.trim();
    if (f.address?.trim()) next.address = f.address.trim();
    if (website) next.website = website;
    if (f.timezone) next.timezone = f.timezone;
    if (ACCENT_ALLOWED && isHex(f.accent)) next.accent = f.accent;
    if (f.logo) {
      // a newly chosen logo is a small picture: a live workspace stores it privately first and keeps its path
      setBusy(true);
      const stored = isInline(f.logo) && f.logo !== saved.logo ? await storeImage(f.logo, live, 'branding') : f.logo;
      setBusy(false);
      if (!stored) { setLogoErr(t('settings.biz.logoErr.store')); return; }
      next.logo = stored;
    }
    act(saveCompany, next, mayHours ? (hours.days.length ? hours : null) : undefined);
    setJustSaved(true);
    toast(t('settings.biz.saved'));
  };
  const discard = () => { setF({ ...saved }); setHours(savedHours); setOwnInitials(false); setLogoErr(''); setErr(''); };

  // the preview shows the draft; without a custom colour it shows the brand's own, not the accent currently saved
  const readBrand = () => ({ accent: rootToken('--accent'), soft: rootToken('--accent-soft'), line: rootToken('--accent-line') });
  const [brand, setBrand] = useState(readBrand);
  // the appearance is applied to the page just after this renders, so the brand colours are read again on the next frame
  useEffect(() => { const id = requestAnimationFrame(() => setBrand(readBrand())); return () => cancelAnimationFrame(id); }, [prefs.theme]);
  const custom = ACCENT_ALLOWED && isHex(f.accent) ? f.accent : '';
  const previewStyle = (custom ? accentVars(custom) : { '--accent': brand.accent, '--accent-soft': brand.soft, '--accent-line': brand.line }) as React.CSSProperties;
  const brandHex = isHex(brand.accent) ? brand.accent : '#000000';
  const shownName = f.name.trim() || t('settings.biz.name');
  const shownInitials = f.initials || suggestInitials(f.name) || '?';
  const logoSrc = useStoredImage(f.logo);
  // Monday first, named in the viewer's language
  const days = [1, 2, 3, 4, 5, 6, 0].map((n) => ({ n, label: new Date(2024, 0, 7 + n).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short' }) }));

  return (
    <>
      <Card title={t('settings.biz.title')}>
        <p className="muted settings-lead">{t(ACCENT_ALLOWED ? 'settings.biz.intro' : 'settings.biz.introFixed')}</p>
        <div className="settings-preview-col">
          <div className="label">{t('settings.biz.preview')}</div>
          {/* a small copy of the real workspace, built with the same classes: sidebar, a primary button and the top of a document */}
          <div className="settings-preview" style={previewStyle} data-custom={custom ? '' : undefined} data-testid="settings-preview">
            <div className="settings-pv-side">
              <div className="side-brand">
                <div className="logo settings-pv-swap" key={logoSrc ? 'logo' : shownInitials}>{logoSrc ? <img src={logoSrc} alt="" /> : shownInitials}</div>
                <div className="grow"><b className="settings-pv-swap" key={shownName}>{shownName}</b><small>{DEPLOY.lockedEdition ? DEPLOY.productName : pack.product}</small></div>
              </div>
              <div className="nav settings-pv-nav" aria-hidden="true">
                <a aria-current="page"><LuLayoutDashboard />{t('nav.dashboard')}</a>
                <a><LuUserPlus />{t('nav.leads')}</a>
                <a><LuBriefcase />{t('nav.jobs')}</a>
              </div>
            </div>
            <div className="settings-pv-main">
              <div className="settings-pv-top"><b>{t('nav.jobs')}</b><span className="count">{data.jobs.length}</span><span className="grow" /><span className="btn primary sm" aria-hidden="true">{t('newProject')}</span></div>
              <div className="settings-pv-doc">
                <div className="settings-pv-co">
                  {logoSrc && <img src={logoSrc} alt="" />}
                  <div>
                    <b className="settings-pv-swap" key={shownName}>{f.legalName?.trim() || shownName}</b>
                    {f.license.trim() && <span>{f.license}</span>}
                    {f.address?.trim() && <span>{f.address}</span>}
                    <span>{[f.phone.trim(), f.email.trim()].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
                <i className="settings-pv-kind">{t('doc.kind.estimate')}</i>
              </div>
            </div>
          </div>
          <p className="xs dim settings-hint">{t('settings.biz.previewHint')}</p>
        </div>

        <div className="settings-biz">
          <div className="fgrid">
            <Field label={t('settings.biz.name')} htmlFor="set-name" full>
              <input id="set-name" value={f.name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="organization" data-testid="settings-company-name" />
            </Field>
            <Field label={`${t('settings.biz.legalName')} (${t('common.optional')})`} htmlFor="set-legal" hint={t('settings.biz.legalHint')} full>
              <input id="set-legal" value={f.legalName ?? ''} onChange={(e) => set({ legalName: e.target.value })} maxLength={120} data-testid="settings-legal-name" />
            </Field>
            <Field label={t('settings.biz.initials')} htmlFor="set-initials" hint={t('settings.biz.initialsHint')}>
              <input id="set-initials" value={f.initials} onChange={(e) => { setOwnInitials(true); set({ initials: e.target.value.toUpperCase().slice(0, 3) }); }} maxLength={3} data-testid="settings-initials" />
            </Field>
            <Field label={t('common.phone')} htmlFor="set-phone"><input id="set-phone" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} autoComplete="tel" /></Field>
            <Field label={t('common.email')} htmlFor="set-email"><input id="set-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} autoComplete="email" /></Field>
            <Field label={t('settings.biz.website')} htmlFor="set-website"><input id="set-website" type="url" inputMode="url" value={f.website ?? ''} onChange={(e) => set({ website: e.target.value })} maxLength={160} autoComplete="url" data-testid="settings-website" /></Field>
            <Field label={t('common.address')} htmlFor="set-address" full><input id="set-address" value={f.address ?? ''} onChange={(e) => set({ address: e.target.value })} maxLength={200} autoComplete="street-address" data-testid="settings-address" /></Field>
            <Field label={t('settings.biz.zone')} htmlFor="set-zone" hint={t('settings.biz.zoneHint')} full>
              <select id="set-zone" value={f.timezone ?? ''} onChange={(e) => set({ timezone: e.target.value || undefined })} data-testid="settings-timezone">
                <option value="">{t('settings.biz.zoneNone')}</option>
                {timeZones(f.timezone).map((z) => <option key={z} value={z}>{zoneLabel(z, lang)}</option>)}
              </select>
            </Field>
            <Field label={t('settings.biz.license')} htmlFor="set-license" hint={t('settings.biz.licenseHint')} full><input id="set-license" value={f.license} onChange={(e) => set({ license: e.target.value })} maxLength={120} /></Field>
          </div>
          <div className="stack">
            <div>
              <div className="label">{t('settings.biz.logo')}</div>
              <div className="settings-logo-row">
                <span className="settings-logo-box" aria-hidden="true">{logoSrc ? <img src={logoSrc} alt="" /> : <LuImage />}</span>
                <label className="btn settings-file"><LuUpload aria-hidden="true" />{t(f.logo ? 'settings.biz.logoChange' : 'settings.biz.logoUpload')}
                  <input type="file" accept="image/*" className="sr" onChange={pickLogo} data-testid="settings-logo" />
                </label>
                {f.logo && <Button variant="ghost" icon={<LuTrash2 aria-hidden="true" />} onClick={() => { setLogoErr(''); set({ logo: undefined }); }} data-testid="settings-logo-remove">{t('settings.biz.logoRemove')}</Button>}
              </div>
              <p className="xs dim settings-hint">{t(live ? 'settings.biz.logoHintLive' : 'settings.biz.logoHint', { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) })}</p>
              {logoErr && <p className="small neg" role="alert" data-testid="settings-logo-error">{logoErr}</p>}
            </div>

            {ACCENT_ALLOWED && (
              <div>
                <div className="label" id="set-accent-label">{t('settings.biz.accent')}</div>
                <div className="settings-swatches" role="group" aria-labelledby="set-accent-label">
                  <button type="button" className="settings-swatch brand" style={{ background: brand.accent }} aria-pressed={!custom} onClick={() => set({ accent: undefined })} title={t('settings.biz.accentBrand')} aria-label={t('settings.biz.accentBrand')} data-testid="settings-accent-reset-swatch" />
                  {ACCENT_PRESETS.map((c) => (
                    <button key={c} type="button" className="settings-swatch" style={{ background: c }} aria-pressed={custom.toLowerCase() === c.toLowerCase()} onClick={() => set({ accent: c })} title={c} aria-label={`${t('settings.biz.accent')} ${c}`} data-testid="settings-accent-preset" />
                  ))}
                  <label className="settings-custom"><span>{t('settings.biz.accentCustom')}</span>
                    <input type="color" value={custom || brandHex} onChange={(e) => set({ accent: e.target.value })} data-testid="settings-accent" />
                  </label>
                </div>
                {custom ? <button type="button" className="linkbtn small settings-hint" onClick={() => set({ accent: undefined })} data-testid="settings-accent-reset">{t('settings.biz.accentBack')}</button> : <p className="xs dim settings-hint">{t('settings.biz.accentIsBrand')}</p>}
                {custom && hardToRead(custom) && <Note tone="warn">{t('settings.biz.accentHard', { theme: t(prefs.theme === 'dark' ? 'demo.dark' : 'demo.light').toLowerCase() })}</Note>}
              </div>
            )}

            {mayHours && (
              <fieldset className="settings-hours" data-testid="settings-hours">
                <legend className="label">{t('settings.biz.hours')}</legend>
                <div className="settings-days" role="group" aria-label={t('settings.biz.days')}>
                  {days.map((d) => <button key={d.n} type="button" aria-pressed={hours.days.includes(d.n)} onClick={() => toggleDay(d.n)} data-testid={`settings-day-${d.n}`}>{d.label}</button>)}
                </div>
                <div className="settings-times">
                  <label className="small muted">{t('settings.biz.open')} <input className="input" type="time" value={hours.open} onChange={(e) => { setJustSaved(false); setErr(''); setHours({ ...hours, open: e.target.value }); }} disabled={!hours.days.length} /></label>
                  <label className="small muted">{t('settings.biz.close')} <input className="input" type="time" value={hours.close} onChange={(e) => { setJustSaved(false); setErr(''); setHours({ ...hours, close: e.target.value }); }} disabled={!hours.days.length} /></label>
                </div>
                <p className="xs dim settings-hint">{t(hours.days.length ? 'settings.biz.hoursHint' : 'settings.biz.hoursNone')}</p>
              </fieldset>
            )}
          </div>
        </div>

        {err && <p className="small neg" role="alert" style={{ marginTop: 12 }} data-testid="settings-error">{err}</p>}
        <div className="card-foot">
          <span className={cx('small settings-state', dirty ? 'strong' : 'muted')} data-testid="settings-dirty">{!dirty && justSaved && <SuccessCheck draw />}{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
          <div className="row">
            {dirty && <Button variant="ghost" onClick={discard}>{t('settings.biz.discard')}</Button>}
            <Button variant="primary" onClick={save} disabled={!dirty || busy} data-testid="settings-save">{t('settings.biz.save')}</Button>
          </div>
        </div>
      </Card>
      {!live && <Note>{t('settings.biz.local')}</Note>}
    </>
  );
}
