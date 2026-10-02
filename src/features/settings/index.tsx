// Settings (owner only). Each section has its own address: /settings/<section>.
// "Your business" is the personalization of the demo: a prospect puts their own name, logo and colour on the workspace.
import { useEffect, useState, type ReactNode } from 'react';
import { LuBuilding2, LuDatabase, LuImage, LuLayers, LuMailCheck, LuPalette, LuPlug, LuTrash2, LuUpload, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import type { PageProps } from '@/app/routes';
import { mutate } from '@/store/store';
import { Badge, Button, Card, Field, Note, PageHeader, cx, toast } from '@/ui';
import type { Company } from '@/domain/types';
import { ACCENT_PRESETS, MAX_LOGO_BYTES, accentVars, hardToRead, isHex, readLogo, rootToken, suggestInitials, type LogoProblem } from './helpers';
import { TeamSection } from './team';
import { ConnectionsSection, PlanSection } from './plan';
import { AppearanceSection, DataSection, EmailsSection } from './more';
import './settings.css';

const SECTIONS = ['business', 'team', 'plan', 'connections', 'emails', 'appearance', 'data'] as const;
type Section = (typeof SECTIONS)[number];
const ICON: Record<Section, ReactNode> = {
  business: <LuBuilding2 aria-hidden="true" />, team: <LuUsers aria-hidden="true" />, plan: <LuLayers aria-hidden="true" />, connections: <LuPlug aria-hidden="true" />,
  emails: <LuMailCheck aria-hidden="true" />, appearance: <LuPalette aria-hidden="true" />, data: <LuDatabase aria-hidden="true" />,
};

export default function SettingsPage({ id }: PageProps) {
  const { t } = useApp();
  const section: Section = SECTIONS.includes(id as Section) ? (id as Section) : 'business';
  return (
    <>
      <PageHeader title={t('nav.settings')} sub={t('settings.sub')} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.sections')}>
          {SECTIONS.map((s) => (
            <A key={s} to={`/settings/${s}`} aria-current={s === section ? 'page' : undefined} data-testid={`settings-tab-${s}`}>{ICON[s]}<span>{t('settings.tab.' + s)}</span></A>
          ))}
        </nav>
        <div className="stack settings-body" data-section={section}>
          {section === 'business' && <BusinessSection />}
          {section === 'team' && <TeamSection />}
          {section === 'plan' && <PlanSection />}
          {section === 'connections' && <ConnectionsSection />}
          {section === 'emails' && <EmailsSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'data' && <DataSection />}
        </div>
      </div>
    </>
  );
}

const FIELDS = ['name', 'initials', 'license', 'phone', 'email', 'logo', 'accent'] as const;

/* ---------- your business: name, logo and colour, with a live preview ---------- */
function BusinessSection() {
  const { t, data, pack, prefs } = useApp();
  const saved = data.company;
  const [f, setF] = useState<Company>({ ...saved });
  const [ownInitials, setOwnInitials] = useState(false);
  const [logoErr, setLogoErr] = useState('');
  const [err, setErr] = useState('');
  // a reset or another tab replaces the company record: start again from what is saved
  useEffect(() => { setF({ ...saved }); setOwnInitials(false); setLogoErr(''); setErr(''); }, [saved]);

  const dirty = FIELDS.some((k) => (f[k] ?? '') !== (saved[k] ?? ''));
  const set = (patch: Partial<Company>) => { setErr(''); setF((cur) => ({ ...cur, ...patch })); };
  const setName = (name: string) => set(ownInitials ? { name } : { name, initials: suggestInitials(name) || f.initials });
  const pickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { const logo = await readLogo(file); setLogoErr(''); set({ logo }); }
    catch (why) { setLogoErr(t('settings.biz.logoErr.' + ((why as LogoProblem) || 'read'), { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) })); }
  };
  const save = () => {
    const name = f.name.trim();
    if (!name) { setErr(t('settings.biz.needName')); return; }
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) { setErr(t('settings.biz.badEmail')); return; }
    const next: Company = { name, initials: (f.initials.trim() || suggestInitials(name)).slice(0, 3).toUpperCase(), license: f.license.trim(), phone: f.phone.trim(), email: f.email.trim() };
    if (f.logo) next.logo = f.logo;
    if (isHex(f.accent)) next.accent = f.accent;
    mutate((d) => { d.company = next; });
    toast(t('settings.biz.saved'));
  };

  // the preview shows the draft; without a custom colour it shows the VYNTEX colours, not the accent currently saved
  const readBrand = () => ({ accent: rootToken('--accent'), soft: rootToken('--accent-soft'), line: rootToken('--accent-line') });
  const [brand, setBrand] = useState(readBrand);
  // the appearance is applied to the page just after this renders, so the brand colours are read again on the next frame
  useEffect(() => { const id = requestAnimationFrame(() => setBrand(readBrand())); return () => cancelAnimationFrame(id); }, [prefs.theme]);
  const previewStyle = (isHex(f.accent) ? accentVars(f.accent) : { '--accent': brand.accent, '--accent-soft': brand.soft, '--accent-line': brand.line }) as React.CSSProperties;
  const custom = isHex(f.accent) ? f.accent : '';
  const brandHex = isHex(brand.accent) ? brand.accent : '#000000';

  return (
    <>
      <Card title={t('settings.biz.title')}>
        <p className="muted settings-lead">{t('settings.biz.intro')}</p>
        <div className="settings-biz">
          <div className="stack">
            <div className="fgrid">
              <Field label={t('settings.biz.name')} htmlFor="set-name" full>
                <input id="set-name" value={f.name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="organization" data-testid="settings-company-name" />
              </Field>
              <Field label={t('settings.biz.initials')} htmlFor="set-initials" hint={t('settings.biz.initialsHint')}>
                <input id="set-initials" value={f.initials} onChange={(e) => { setOwnInitials(true); set({ initials: e.target.value.toUpperCase().slice(0, 3) }); }} maxLength={3} data-testid="settings-initials" />
              </Field>
              <Field label={t('common.phone')} htmlFor="set-phone"><input id="set-phone" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} autoComplete="tel" /></Field>
              <Field label={t('common.email')} htmlFor="set-email" full><input id="set-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} autoComplete="email" /></Field>
              <Field label={t('settings.biz.license')} htmlFor="set-license" hint={t('settings.biz.licenseHint')} full><input id="set-license" value={f.license} onChange={(e) => set({ license: e.target.value })} maxLength={120} /></Field>
            </div>

            <div>
              <div className="label">{t('settings.biz.logo')}</div>
              <div className="settings-logo-row">
                <span className="settings-logo-box" aria-hidden="true">{f.logo ? <img src={f.logo} alt="" /> : <LuImage />}</span>
                <label className="btn settings-file"><LuUpload aria-hidden="true" />{t(f.logo ? 'settings.biz.logoChange' : 'settings.biz.logoUpload')}
                  <input type="file" accept="image/*" className="sr" onChange={pickLogo} data-testid="settings-logo" />
                </label>
                {f.logo && <Button variant="ghost" icon={<LuTrash2 aria-hidden="true" />} onClick={() => { setLogoErr(''); set({ logo: undefined }); }} data-testid="settings-logo-remove">{t('settings.biz.logoRemove')}</Button>}
              </div>
              <p className="xs dim settings-hint">{t('settings.biz.logoHint', { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) })}</p>
              {logoErr && <p className="small neg" role="alert" data-testid="settings-logo-error">{logoErr}</p>}
            </div>

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
          </div>

          <div className="settings-preview-col">
            <div className="label">{t('settings.biz.preview')}</div>
            <div className="settings-preview" style={previewStyle} data-testid="settings-preview">
              <div className="settings-pv-side">
                <div className="side-brand">
                  <div className="logo">{f.logo ? <img src={f.logo} alt="" /> : (f.initials || suggestInitials(f.name) || '?')}</div>
                  <div className="grow"><b>{f.name.trim() || t('settings.biz.name')}</b><small>{pack.product}</small></div>
                </div>
                <div className="settings-pv-nav" aria-hidden="true"><span className="on">{t('nav.dashboard')}</span><span>{t('nav.leads')}</span><span>{t('nav.jobs')}</span></div>
              </div>
              <div className="settings-pv-main">
                <div className="row"><span className="btn primary sm" aria-hidden="true">{t('newProject')}</span><Badge tone="accent">{t('settings.biz.sampleBadge')}</Badge></div>
                <div className="settings-pv-doc">
                  <b>{f.name.trim() || t('settings.biz.name')}</b>
                  {f.license.trim() && <span>{f.license}</span>}
                  <span>{[f.phone.trim(), f.email.trim()].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
            </div>
            <p className="xs dim settings-hint">{t('settings.biz.previewHint')}</p>
          </div>
        </div>

        {err && <p className="small neg" role="alert" style={{ marginTop: 12 }}>{err}</p>}
        <div className="card-foot">
          <span className={cx('small', dirty ? 'strong' : 'muted')} data-testid="settings-dirty">{t(dirty ? 'settings.biz.unsaved' : 'settings.biz.upToDate')}</span>
          <div className="row">
            {dirty && <Button variant="ghost" onClick={() => { setF({ ...saved }); setOwnInitials(false); setLogoErr(''); setErr(''); }}>{t('settings.biz.discard')}</Button>}
            <Button variant="primary" onClick={save} disabled={!dirty} data-testid="settings-save">{t('settings.biz.save')}</Button>
          </div>
        </div>
      </Card>
      <Note>{t('settings.biz.local')}</Note>
    </>
  );
}
