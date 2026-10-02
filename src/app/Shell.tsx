// Workspace frame: sidebar, top bar, demo controls, global search and notifications.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LuLayoutDashboard, LuUserPlus, LuUsers, LuBriefcase, LuCalendarDays, LuListChecks, LuHardHat, LuFileText, LuWallet, LuChartColumn,
  LuZap, LuSparkles, LuSettings, LuShieldCheck, LuSearch, LuBell, LuMenu, LuX, LuSun, LuMoon, LuRotateCcw, LuTag, LuCalendarCheck, LuCompass, LuFlaskConical, LuArrowLeft, LuChevronDown, LuPaintbrush, LuMail,
} from 'react-icons/lu';
import { useApp } from './hooks';
import { A, Link, appPath, asset, go, navigate, refPath, useRoute } from './router';
import { Avatar, Button, IconButton, Modal, cx, confirmDialog, toast } from '@/ui';
import { mutateQuiet as mutate, resetDemo, setLanguage, setPrefs, switchPack } from '@/store/store';
import { PACK_LIST } from '@/packs';
import { plansFor, planName, type PlanTier } from '@/lib/pricing';
import type { IndustryId, ViewAs } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { assigneeName, byId, notices, isOverdue } from '@/domain/selectors';
import { BRAND } from '@/config/brand';
import { money } from '@/lib/money';

/** Black or white, whichever reads better on the given #rrggbb colour (WCAG relative luminance). */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return '#00161C';
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#00161C' : '#FFFFFF';
}

interface NavItem { to: string; label: string; icon: ReactNode; perm?: Permission; count?: number; countBad?: boolean; group: 'work' | 'business' | 'system' }

export function Shell({ children, onTour }: { children: ReactNode; onTour: () => void }) {
  const app = useApp();
  const { t, data, prefs, pack, can, isWorker } = app;
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [bell, setBell] = useState(false);
  const section = route.parts[1] || '';

  useEffect(() => { setMenu(false); setBell(false); }, [route.path]);
  useEffect(() => {
    document.title = `${data.company.name} · ${pack.product}`;
  }, [prefs.theme, prefs.lang, data.company.name, pack.product]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);

  const list = useMemo(() => notices(data, { compliance: pack.compliance }), [data, pack.compliance]);
  const unread = list.filter((n) => !data.readNotifications.includes(n.id));
  const newLeads = data.leads.filter((l) => l.status === 'new').length;
  const late = data.tasks.filter(isOverdue).length;

  const nav: NavItem[] = isWorker ? [{ to: '', label: t('nav.portal'), icon: <LuHardHat />, group: 'work' }] : [
    { to: '', label: t('nav.dashboard'), icon: <LuLayoutDashboard />, group: 'work' },
    { to: '/leads', label: t('nav.leads'), icon: <LuUserPlus />, perm: 'leads', count: newLeads, group: 'work' },
    { to: '/clients', label: t('nav.clients'), icon: <LuUsers />, perm: 'clients', group: 'work' },
    { to: '/jobs', label: t('nav.jobs'), icon: <LuBriefcase />, perm: 'jobs', group: 'work' },
    { to: '/calendar', label: t('nav.calendar'), icon: <LuCalendarDays />, perm: 'calendar', group: 'work' },
    { to: '/tasks', label: t('nav.tasks'), icon: <LuListChecks />, perm: 'tasks', count: late, countBad: true, group: 'work' },
    { to: '/team', label: t('nav.team'), icon: <LuHardHat />, perm: 'team', group: 'business' },
    { to: '/documents', label: t('nav.documents'), icon: <LuFileText />, perm: 'documents', group: 'business' },
    { to: '/messages', label: t('nav.messages'), icon: <LuMail />, perm: 'documents', count: data.messages.filter((m) => m.status === 'draft').length, group: 'business' },
    { to: '/payments', label: t('nav.money'), icon: <LuWallet />, perm: 'money', group: 'business' },
    { to: '/reports', label: t('nav.reports'), icon: <LuChartColumn />, perm: 'reports', group: 'business' },
    ...(pack.compliance ? [{ to: '/compliance', label: t('nav.compliance'), icon: <LuShieldCheck />, perm: 'compliance' as Permission, group: 'business' as const }] : []),
    { to: '/automations', label: t('nav.automations'), icon: <LuZap />, perm: 'automations', group: 'system' },
    { to: '/assistant', label: t('nav.assistant'), icon: <LuSparkles />, perm: 'assistant', group: 'system' },
    { to: '/settings', label: t('nav.settings'), icon: <LuSettings />, perm: 'settings', group: 'system' },
  ];
  const visible = nav.filter((n) => !n.perm || can(n.perm));
  const groups: NavItem['group'][] = ['work', 'business', 'system'];
  const accent = data.company.accent;
  const style = accent ? ({ '--accent': accent, '--accent-soft': accent + '22', '--accent-line': accent + '66', '--accent-ink': inkOn(accent) } as React.CSSProperties) : undefined;
  const actor = isWorker ? byId(data.workers, prefs.viewAs.slice(7))?.name : data.users.find((u) => u.role === prefs.viewAs)?.name;

  return (
    <div className="shell" style={style}>
      <a href="#main" className="skip">{t('app.skip')}</a>
      <div className={cx('scrim', menu && 'open')} onClick={() => setMenu(false)} />
      <aside className={cx('side', menu && 'open')} aria-label={t('nav.menu')}>
        <div className="side-brand">
          <div className="logo">{data.company.logo ? <img src={data.company.logo} alt="" /> : data.company.initials}</div>
          <div className="grow"><b>{data.company.name}</b><small>{pack.product}</small></div>
          <IconButton label={t('nav.closeMenu')} className="hamb" onClick={() => setMenu(false)}><LuX /></IconButton>
        </div>
        <nav className="nav">
          {groups.map((g) => {
            const items = visible.filter((n) => n.group === g); if (!items.length) return null;
            return (
              <div key={g}>
                {!isWorker && g !== 'work' && <div className="nav-cap">{t('nav.group.' + g)}</div>}
                {items.map((n) => (
                  <A key={n.to} to={n.to} aria-current={(n.to.slice(1) || '') === section ? 'page' : undefined} data-nav={n.to.slice(1) || 'dashboard'}>
                    {n.icon}<span>{n.label}</span>{!!n.count && <span className={cx('count', n.countBad && 'bad')}>{n.count}</span>}
                  </A>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <img src={asset('brand/vyntex-wordmark.jpg')} alt={BRAND.platformName} />
          <span>{BRAND.promise[prefs.lang]}</span>
        </div>
      </aside>

      <div className="main">
        <DemoBar onTour={onTour} />
        <div className="topbar">
          <IconButton label={t('nav.menu')} className="hamb" onClick={() => setMenu(true)}><LuMenu /></IconButton>
          {!isWorker ? (
            <button type="button" className="gs" onClick={() => setSearch(true)} aria-label={t('search.open')} data-testid="global-search">
              <LuSearch aria-hidden="true" /><span className="clip">{t('search.placeholder')}</span><kbd>/</kbd>
            </button>
          ) : <span className="sp" />}
          <span className="sp" />
          <IconButton label={t(prefs.theme === 'dark' ? 'demo.light' : 'demo.dark')} onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>{prefs.theme === 'dark' ? <LuSun /> : <LuMoon />}</IconButton>
          {!isWorker && (
            <div style={{ position: 'relative' }}>
              <IconButton label={t('notif.open')} onClick={() => setBell((b) => !b)} aria-expanded={bell} data-testid="bell">
                <LuBell />{unread.length > 0 && <span className="count bad" style={{ position: 'absolute', top: -4, right: -6 }}>{unread.length}</span>}
              </IconButton>
              {bell && <NotificationsPanel onClose={() => setBell(false)} />}
            </div>
          )}
          {actor && <span className="row tight nowrap" title={t(isWorker ? 'role.worker' : 'role.' + prefs.viewAs)}><Avatar name={actor} size="sm" accent /><span className="small strong hide-s">{actor}</span></span>}
        </div>
        <main className="content" id="main" tabIndex={-1}>{children}</main>
      </div>
      {search && <GlobalSearch onClose={() => setSearch(false)} />}
    </div>
  );
}

/* ---------- demo controls: one quiet strip, not a wall of disclaimers ---------- */
function useNarrow(query = '(max-width: 1180px)') {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query); const on = () => setNarrow(m.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
function DemoBar({ onTour }: { onTour: () => void }) {
  const { t, prefs, pack, data, lang, isWorker } = useApp();
  const plans = plansFor(pack.id);
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const route = useRoute();
  useEffect(() => setOpen(false), [route.path]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const reset = async () => { setOpen(false); if (await confirmDialog(t('demo.resetConfirm'), t('demo.reset'), t('common.cancel'), false)) { resetDemo(); go(''); toast(t('demo.resetDone')); } };
  const viewAs = (
    <label><span>{t('demo.viewAs')}</span>
      <select value={prefs.viewAs} onChange={(e) => { setPrefs({ viewAs: e.target.value as ViewAs }); go(''); }} aria-label={t('demo.viewAs')} data-testid="viewas">
        <option value="owner">{t('role.owner')}</option><option value="manager">{t('role.manager')}</option><option value="staff">{t('role.staff')}</option>
        <optgroup label={t('role.worker')}>{data.workers.slice(0, 6).map((w) => <option key={w.id} value={`worker:${w.id}`}>{w.name}</option>)}</optgroup>
      </select>
    </label>
  );
  const plan = !isWorker && (
    <label><span>{t('demo.plan')}</span>
      <select value={prefs.planTier} onChange={(e) => setPrefs({ planTier: Number(e.target.value) as PlanTier })} aria-label={t('demo.planHint')} data-testid="plan" title={t('demo.planHint')}>
        {plans.map((p) => <option key={p.id} value={p.tier}>{planName(p, lang)}</option>)}
      </select>
    </label>
  );
  const pricing = <Link to="/pricing" className="btn sm" data-testid="see-pricing"><LuTag aria-hidden="true" />{t('demo.pricing')}</Link>;
  const request = <Link to="/request-demo" className="btn sm primary" data-testid="request-demo"><LuCalendarCheck aria-hidden="true" />{t('demo.request')}</Link>;
  return (
    <div className="demobar no-print" role="region" aria-label={t('demo.controls')}>
      <div className="dm" ref={ref}>
        <button type="button" className="tag" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" title={t('demo.sample')} data-testid="demo-controls">
          <LuFlaskConical aria-hidden="true" /><span className="dm-long">{t('demo.badge')}</span><span className="dm-short">{t('demo.badgeShort')}</span><LuChevronDown aria-hidden="true" />
        </button>
        {open && (
          <div className="dm-pop" role="dialog" aria-label={t('demo.controls')}>
            <p className="small muted">{t('demo.controlsHint')}</p>
            {narrow && <div className="dm-fields">{viewAs}{plan}</div>}
            <div className="dm-actions">
              <button type="button" onClick={() => { setOpen(false); onTour(); }} data-testid="tour-start"><LuCompass aria-hidden="true" />{t('demo.tour')}</button>
              {!isWorker && <button type="button" onClick={() => { setOpen(false); go('/settings'); }} data-testid="personalize"><LuPaintbrush aria-hidden="true" />{t('demo.personalize')}</button>}
              <button type="button" onClick={reset} data-testid="reset-demo"><LuRotateCcw aria-hidden="true" />{t('demo.reset')}</button>
            </div>
            {narrow && <div className="row">{pricing}{request}</div>}
          </div>
        )}
      </div>
      <label className="dm-ind"><span>{t('demo.industry')}</span>
        <select value={pack.id} onChange={(e) => { switchPack(e.target.value as IndustryId); go(''); }} aria-label={t('demo.industry')} data-testid="industry">
          {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.label[lang]}</option>)}
        </select>
      </label>
      {!narrow && viewAs}
      {!narrow && plan}
      <div className="seg" role="group" aria-label={t('demo.language')}>
        <button type="button" aria-pressed={lang === 'en'} onClick={() => setLanguage('en')} data-testid="lang-en">EN</button>
        <button type="button" aria-pressed={lang === 'es'} onClick={() => setLanguage('es')} data-testid="lang-es">ES</button>
      </div>
      <span className="sp" />
      {!narrow && pricing}
      {!narrow && request}
    </div>
  );
}

/* ---------- notifications ---------- */
function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { t, data, pack, date } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const list = notices(data, { compliance: pack.compliance });
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const open = (n: (typeof list)[number]) => {
    mutate((d) => { if (!d.readNotifications.includes(n.id)) d.readNotifications.push(n.id); });
    const task = n.ref.type === 'task' ? byId(data.tasks, n.ref.id) : undefined;
    go(refPath(n.ref, task?.jobId)); onClose();
  };
  return (
    <div className="pop" ref={ref} role="dialog" aria-label={t('notif.title')}>
      <div className="pop-h"><h3>{t('notif.title')}</h3>{list.length > 0 && <button type="button" className="linkbtn small" onClick={() => mutate((d) => { d.readNotifications = list.map((n) => n.id); })}>{t('notif.markAll')}</button>}</div>
      <div className="pop-b">
        {list.length ? list.map((n) => {
          const read = data.readNotifications.includes(n.id);
          return (
            <button type="button" key={n.id} className="nrow" onClick={() => open(n)} style={read ? { opacity: 0.6 } : undefined}>
              <span className={cx('dot', n.tone)} />
              <span className="grow"><span className="strong">{t('notif.' + n.kind)}</span><br /><span className="small muted">{n.title}{n.amount ? ` · ${money(n.amount)}` : ''}{n.date ? ` · ${date(n.date)}` : ''}</span></span>
            </button>
          );
        }) : <p className="muted small" style={{ padding: 16 }}>{t('notif.empty')}</p>}
      </div>
    </div>
  );
}

/* ---------- global search ---------- */
function GlobalSearch({ onClose }: { onClose: () => void }) {
  const { t, data, can } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2) return [];
    const has = (...v: (string | undefined)[]) => v.some((x) => x && x.toLowerCase().includes(s));
    const g: { key: string; hits: { id: string; title: string; sub: string; to: string }[] }[] = [];
    const push = (key: string, hits: { id: string; title: string; sub: string; to: string }[]) => { if (hits.length) g.push({ key, hits: hits.slice(0, 6) }); };
    if (can('leads')) push('leads', data.leads.filter((l) => has(l.name, l.phone, l.email, l.address, l.ticket, l.company)).map((l) => ({ id: l.id, title: l.name, sub: `${l.ticket} · ${t('ls_' + l.status)}`, to: `/leads/${l.id}` })));
    if (can('clients')) push('clients', data.clients.filter((c) => has(c.name, c.phone, c.email, c.company, ...c.addresses)).map((c) => ({ id: c.id, title: c.name, sub: c.phone || c.email, to: `/clients/${c.id}` })));
    if (can('jobs')) push('jobs', data.jobs.filter((j) => has(j.name, j.address, j.number, byId(data.clients, j.clientId)?.name)).map((j) => ({ id: j.id, title: j.name, sub: `${byId(data.clients, j.clientId)?.name ?? ''} · ${t('st_' + j.status)}`, to: `/jobs/${j.id}` })));
    if (can('tasks')) push('tasks', data.tasks.filter((x) => has(x.title, x.description)).map((x) => ({ id: x.id, title: x.title, sub: `${assigneeName(data, x.assignee)} · ${t('ts.' + x.status)}`, to: `/tasks?task=${x.id}` })));
    if (can('team')) push('workers', data.workers.filter((w) => has(w.name, w.trade, w.phone, w.email)).map((w) => ({ id: w.id, title: w.name, sub: w.trade, to: `/team/${w.id}` })));
    if (can('documents')) push('docs', data.docs.filter((d) => has(d.title, d.number, byId(data.clients, d.clientId)?.name)).map((d) => ({ id: d.id, title: `${t('doc.kind.' + d.kind)} ${d.number}`, sub: `${d.title} · ${t('doc.status.' + d.status)}`, to: `/documents/${d.id}` })));
    return g;
  }, [q, data, t, can]);
  const flat = groups.flatMap((g) => g.hits);
  useEffect(() => setSel(0), [q]);
  const pick = (to: string) => { navigate(appPath(to)); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); pick(flat[sel].to); }
  };
  let i = -1;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label={t('search.open')}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} data-testid="search-input" />
        <div className="res" role="listbox">
          {q.trim().length < 2 ? <p className="muted small" style={{ padding: 14 }}>{t('search.empty')}</p>
            : !flat.length ? <p className="muted small" style={{ padding: 14 }}>{t('search.none', { q })}</p>
            : groups.map((g) => (
              <div key={g.key}>
                <div className="grp">{t('search.' + g.key)}</div>
                {g.hits.map((h) => { i++; const idx = i; return <button type="button" key={g.key + h.id} role="option" aria-selected={idx === sel} className="hit" onMouseEnter={() => setSel(idx)} onClick={() => pick(h.to)}><span className="grow clip strong">{h.title}</span><small className="clip" style={{ maxWidth: '45%' }}>{h.sub}</small></button>; })}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) { return <A to={to} className="crumb"><LuArrowLeft aria-hidden="true" />{children}</A>; }
export { Modal };
