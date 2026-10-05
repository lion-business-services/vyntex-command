// Workspace frame: sidebar, top bar, sample-workspace controls, global search and notifications.
// The menu comes from the module registry (./modules.ts) and the search from the search registry (./search.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LuUserPlus, LuBriefcase, LuHardHat, LuSparkles, LuSearch, LuBell, LuMenu, LuX, LuSun, LuMoon, LuRotateCcw, LuTag, LuCalendarCheck, LuCompass, LuArrowLeft, LuChevronDown, LuPaintbrush,
  LuPlus, LuCornerDownLeft, LuFilePlus2, LuCalendarPlus, LuCircleDollarSign, LuRadio, LuEye, LuLayers, LuShapes,
} from 'react-icons/lu';
import { useApp } from './hooks';
import { A, Link, appPath, go, navigate, refPath, useRoute } from './router';
import { BrandLockup } from '@/brand';
import { ClientPaymentModal, TaskFormModal } from './forms';
import { Avatar, IconButton, Modal, cx, confirmDialog, toast } from '@/ui';
import { mutateQuiet as mutate, resetDemo, setLanguage, setPrefs, switchPack } from '@/store/store';
import { PACK_LIST } from '@/packs';
import { plansFor, planName, type PlanTier } from '@/lib/pricing';
import type { IndustryId, Lang, ViewAs } from '@/domain/types';
import { OFFICE_ROLES } from '@/domain/permissions';
import { byId, notices } from '@/domain/selectors';
import { pick } from '@/i18n';
import { BRAND } from '@/config/brand';
import { DEPLOY } from '@/config/deployment';
import { money } from '@/lib/money';
import { GROUPS, TEAM_ICON_OFFICE, modulesFor, type ModuleDef } from './modules';
import { searchAll } from './search';
import { assistantOn } from '@/features/assistant/deploy';
import './shell-ext.css';

// Read straight from the build constant where a branch must leave the other product's wording out of the bundle.
declare const __VX_DEPLOY__: string | undefined;

/** How each language names itself in the language switch. */
const LANG_LABEL: Record<Lang, string> = { en: 'EN', es: 'ES', zh: '中文' };

/** Black or white, whichever reads better on the given #rrggbb colour (WCAG relative luminance). */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return '#00161C';
  const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#00161C' : '#FFFFFF';
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

interface NavItem { to: string; label: string; icon: ReactNode; count?: number; countBad?: boolean; group: ModuleDef['group'] }

export function Shell({ children, onTour }: { children: ReactNode; onTour: () => void }) {
  const app = useApp();
  const { t, data, prefs, pack, can, isWorker } = app;
  // the assistant can be switched off per company (and is off by default in the LBS deployment)
  const ai = !isWorker && can('assistant') && assistantOn(data, pack);
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [bell, setBell] = useState(false);
  const [quick, setQuick] = useState<'task' | 'payment' | null>(null);
  const section = route.parts[1] || '';

  useEffect(() => { setMenu(false); setBell(false); }, [route.path]);
  // a deployment with one edition is known by its own name; elsewhere the edition's product name is shown
  const product = DEPLOY.lockedEdition ? DEPLOY.productName : pack.product;
  useEffect(() => {
    document.title = `${data.company.name} · ${product}`;
  }, [prefs.theme, prefs.lang, data.company.name, product]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);

  const viewer = useMemo(() => (app.user ? { id: app.user.id, perms: app.perms } : undefined), [app.user, app.perms]);
  const list = useMemo(() => notices(data, { compliance: pack.compliance, viewer }), [data, pack.compliance, viewer]);
  const unread = list.filter((n) => !data.readNotifications.includes(n.id));

  const modules = useMemo(() => modulesFor(app), [app]);
  const nav: NavItem[] = isWorker ? [{ to: '', label: t('nav.portal'), icon: <LuHardHat />, group: 'work' }] : modules.map((m) => {
    // the team page of an edition without field workers is the office team
    const Icon = m.id === 'team' && !pack.usesWorkers ? TEAM_ICON_OFFICE : m.icon;
    return { to: m.path ? '/' + m.path : '', label: t(m.labelKey), icon: <Icon />, count: m.count?.(app), countBad: m.countBad, group: m.group };
  });
  const visible = nav;
  const groups = GROUPS;
  const accent = data.company.accent;
  const style = accent ? ({ '--accent': accent, '--accent-soft': accent + '22', '--accent-line': accent + '66', '--accent-ink': inkOn(accent) } as React.CSSProperties) : undefined;
  const actor = isWorker ? byId(data.workers, prefs.viewAs.slice(7))?.name : app.user?.name;
  const sample = !app.live;

  return (
    <div className="shell" style={style}>
      <a href="#main" className="skip">{t('app.skip')}</a>
      <div className={cx('scrim', menu && 'open')} onClick={() => setMenu(false)} />
      <aside className={cx('side', menu && 'open')} aria-label={t('nav.menu')}>
        <div className="side-top">
          <A to="" className="side-lock" aria-label={DEPLOY.productName}><BrandLockup size="sm" /></A>
          <IconButton label={t('nav.closeMenu')} className="hamb" onClick={() => setMenu(false)}><LuX /></IconButton>
        </div>
        <div className="side-brand">
          <div className="logo">{data.company.logo ? <img src={data.company.logo} alt="" /> : data.company.initials}</div>
          <div className="grow"><b>{data.company.name}</b><small>{product}</small></div>
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
          {sample && <span className="side-demo" title={t(DEPLOY.publicDemo ? 'demo.sample' : 'demo.previewNote')}><i aria-hidden="true" />{t(DEPLOY.publicDemo ? 'demo.badge' : 'demo.previewBadge')} · {t('demo.sampleShort')}</span>}
          <span>{(typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? DEPLOY.productName : pick(BRAND.descriptor, prefs.lang)}</span>
        </div>
      </aside>

      <div className="main">
        {sample && <DemoBar onTour={onTour} />}
        <div className="topbar">
          <IconButton label={t('nav.menu')} className="hamb" onClick={() => setMenu(true)}><LuMenu /></IconButton>
          {!isWorker ? (
            <button type="button" className="gs" onClick={() => setSearch(true)} aria-label={t(ai ? 'cmd.placeholder' : 'cmd.placeholderPlain')} data-testid="global-search">
              <LuSearch aria-hidden="true" /><span className="clip">{t(ai ? 'cmd.placeholder' : 'cmd.placeholderPlain')}</span><kbd>{MAC ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
          ) : <span className="sp" />}
          <span className="sp" />
          {ai && <IconButton label={t('cmd.ask')} className="ai" onClick={() => go('/assistant')} data-testid="topbar-ai"><LuSparkles /></IconButton>}
          <IconButton label={t(prefs.theme === 'dark' ? 'demo.light' : 'demo.dark')} onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>{prefs.theme === 'dark' ? <LuSun /> : <LuMoon />}</IconButton>
          {!isWorker && (
            <div style={{ position: 'relative' }}>
              <IconButton label={t('notif.open')} onClick={() => setBell((b) => !b)} aria-expanded={bell} data-testid="bell">
                <LuBell />{unread.length > 0 && <span className="count bad" style={{ position: 'absolute', top: -4, right: -6 }}>{unread.length}</span>}
              </IconButton>
              {bell && <NotificationsPanel onClose={() => setBell(false)} />}
            </div>
          )}
          {actor && <span className="row tight nowrap" title={t(isWorker ? 'role.worker' : 'role.' + prefs.viewAs)} data-testid="actor"><Avatar name={actor} size="sm" accent /><span className="small strong hide-s">{actor}</span></span>}
        </div>
        <main className="content" id="main" tabIndex={-1}>{children}</main>
      </div>
      {search && <CommandPalette onClose={() => setSearch(false)} modules={visible} onQuick={setQuick} />}
      {quick === 'task' && <TaskFormModal onClose={() => setQuick(null)} />}
      {quick === 'payment' && <ClientPaymentModal onClose={() => setQuick(null)} />}
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
  const { t, prefs, pack, data, lang, isWorker, priced } = useApp();
  // what the strip offers depends on the deployment: the public demo has the edition and plan pickers, the tour and the
  // way to the sales pages; a review preview of a single-company deployment has none of those
  const demo = DEPLOY.publicDemo;
  const plans = priced ? plansFor(pack.id) : [];
  const narrow = useNarrow();
  const roomy = !useNarrow('(max-width: 1319px)');
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
  const k = (key: string) => t(demo ? 'demo.' + key : 'demo.preview.' + key);
  const reset = async () => { setOpen(false); if (await confirmDialog(k('resetConfirm'), k('reset'), t('common.cancel'), false)) { resetDemo(); go(''); toast(k('resetDone')); } };
  const workers = pack.usesWorkers ? data.workers.slice(0, 6) : [];
  const viewAs = (
    <label title={t('demo.viewAs')}><LuEye className="dm-i" aria-hidden="true" /><span className="dm-w">{t('demo.viewAs')}</span>
      <select value={prefs.viewAs} onChange={(e) => { setPrefs({ viewAs: e.target.value as ViewAs }); go(''); }} aria-label={t('demo.viewAs')} data-testid="viewas">
        {OFFICE_ROLES.map((r) => <option key={r} value={r}>{t('role.' + r)}</option>)}
        {workers.length > 0 && <optgroup label={t('role.worker')}>{workers.map((w) => <option key={w.id} value={`worker:${w.id}`}>{w.name}</option>)}</optgroup>}
      </select>
    </label>
  );
  const plan = !isWorker && plans.length > 0 && (
    <label title={t('demo.planHint')}><LuLayers className="dm-i" aria-hidden="true" /><span className="dm-w">{t('demo.plan')}</span>
      <select value={prefs.planTier} onChange={(e) => setPrefs({ planTier: Number(e.target.value) as PlanTier })} aria-label={t('demo.planHint')} data-testid="plan" title={t('demo.planHint')}>
        {plans.map((p) => <option key={p.id} value={p.tier}>{planName(p, lang)}</option>)}
      </select>
    </label>
  );
  const pricing = demo && DEPLOY.showPlans && DEPLOY.marketing ? <Link to="/pricing" className="btn sm" data-testid="see-pricing"><LuTag aria-hidden="true" />{t('demo.pricing')}</Link> : null;
  const request = demo && DEPLOY.marketing ? <Link to="/request-demo" className="btn sm primary" data-testid="request-demo"><LuCalendarCheck aria-hidden="true" />{t('demo.request')}</Link> : null;
  return (
    <div className="demobar no-print" role="region" aria-label={k('controls')} data-kind={demo ? 'demo' : 'preview'}>
      <div className="dm" ref={ref}>
        <button type="button" className="tag" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" title={k('sample')} data-testid="demo-controls">
          <LuRadio aria-hidden="true" /><span className="dm-long">{k('badge')}</span><span className="dm-short">{k('badgeShort')}</span><LuChevronDown aria-hidden="true" />
        </button>
        {open && (
          <div className="dm-pop" role="dialog" aria-label={k('controls')}>
            <p className="small muted">{k('controlsHint')}</p>
            {narrow && <div className="dm-fields">{viewAs}{plan}</div>}
            <div className="dm-actions">
              {demo && !roomy && <button type="button" onClick={() => { setOpen(false); onTour(); }} data-testid="tour-start"><LuCompass aria-hidden="true" />{t('demo.tour')}</button>}
              {demo && !isWorker && <button type="button" onClick={() => { setOpen(false); go('/settings'); }} data-testid="personalize"><LuPaintbrush aria-hidden="true" />{t('demo.personalize')}</button>}
              {(demo ? !roomy : narrow) && <button type="button" onClick={reset} data-testid="reset-demo"><LuRotateCcw aria-hidden="true" />{k('reset')}</button>}
            </div>
            {narrow && (pricing || request) && <div className="row">{pricing}{request}</div>}
          </div>
        )}
      </div>
      {demo ? <span className="dm-sample">{t('demo.sampleShort')}</span> : <span className="dm-note" data-testid="preview-note">{t('demo.preview.note')}</span>}
      {!DEPLOY.lockedEdition && (
        <label className="dm-ind" title={t('demo.industry')}><LuShapes className="dm-i" aria-hidden="true" /><span className="dm-w">{t('demo.industry')}</span>
          <select value={pack.id} onChange={(e) => { switchPack(e.target.value as IndustryId); go(''); }} aria-label={t('demo.industry')} data-testid="industry">
            {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{pick(p.label, lang)}</option>)}
          </select>
        </label>
      )}
      {!narrow && viewAs}
      {!narrow && plan}
      <div className="seg" role="group" aria-label={t('demo.language')}>
        {DEPLOY.languages.map((code) => <button type="button" key={code} aria-pressed={lang === code} onClick={() => setLanguage(code)} data-testid={`lang-${code}`} lang={code}>{LANG_LABEL[code]}</button>)}
      </div>
      <span className="sp" />
      {demo && roomy && <button type="button" className="btn sm ghost dm-act" onClick={onTour} data-testid="tour-start" title={t('demo.tour')} aria-label={t('demo.tour')}><LuCompass aria-hidden="true" /><span>{t('demo.tour')}</span></button>}
      {demo && roomy && <button type="button" className="btn sm ghost dm-act" onClick={reset} data-testid="reset-demo" title={t('demo.reset')} aria-label={t('demo.reset')}><LuRotateCcw aria-hidden="true" /><span>{t('demo.reset')}</span></button>}
      {!demo && !narrow && <button type="button" className="btn sm ghost dm-act" onClick={reset} data-testid="reset-demo" title={k('reset')} aria-label={k('reset')}><LuRotateCcw aria-hidden="true" /><span>{k('reset')}</span></button>}
      {!narrow && pricing}
      {!narrow && request}
    </div>
  );
}

/* ---------- notifications ---------- */
function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { t, data, pack, date, user, perms } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const list = notices(data, { compliance: pack.compliance, viewer: user ? { id: user.id, perms } : undefined });
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

/* ---------- command palette: search every record, jump to any page, start the common actions, or ask the assistant ---------- */
interface Hit { id: string; title: string; sub?: string; icon?: ReactNode; run: () => void }
function CommandPalette({ onClose, modules, onQuick }: { onClose: () => void; modules: NavItem[]; onQuick: (k: 'task' | 'payment') => void }) {
  const app = useApp();
  const { t, can } = app;
  const ai = can('assistant') && modules.some((n) => n.to === '/assistant');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const open = (to: string) => () => { navigate(appPath(to)); onClose(); };
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const g: { key: string; hits: Hit[] }[] = [];
    const push = (key: string, hits: Hit[], max = 6) => { if (hits.length) g.push({ key, hits: hits.slice(0, max) }); };
    const has = (...v: (string | undefined)[]) => v.some((x) => x && x.toLowerCase().includes(s));
    const goto = (id: string) => modules.some((n) => n.to === '/' + id);
    // starting something new takes `write`; a read-only person still searches and moves around
    const write = can('write');
    const actions: Hit[] = [
      ...(write && can('tasks') ? [{ id: 'a-task', title: t('form.task.new'), icon: <LuPlus />, run: () => { onClose(); onQuick('task'); } }] : []),
      ...(write && goto('leads') ? [{ id: 'a-lead', title: t('cmd.newLead'), icon: <LuUserPlus />, run: open('/leads?new=1') }] : []),
      ...(write && goto('jobs') ? [{ id: 'a-job', title: t('newProject'), icon: <LuBriefcase />, run: open('/jobs?new=1') }] : []),
      ...(write && goto('documents') ? [{ id: 'a-doc', title: t('cmd.document'), icon: <LuFilePlus2 />, run: open('/documents?new=1') }] : []),
      ...(write && can('money') ? [{ id: 'a-pay', title: t('cmd.payment'), icon: <LuCircleDollarSign />, run: () => { onClose(); onQuick('payment'); } }] : []),
      ...(goto('calendar') ? [{ id: 'a-cal', title: t('cmd.schedule'), icon: <LuCalendarPlus />, run: open('/calendar') }] : []),
    ];
    const pages: Hit[] = modules.map((n) => ({ id: 'p-' + n.to, title: n.label, icon: n.icon, run: open(n.to) }));
    if (s.length < 2) {
      push('cmd.actions', actions, 8);
      if (ai) push('cmd.ai', [{ id: 'ai', title: t('cmd.ask'), sub: t('cmd.askHint'), icon: <LuSparkles />, run: open('/assistant') }]);
      push('cmd.goto', pages, 40);
      return g;
    }
    // records: every provider of the search registry the viewer may use
    for (const found of searchAll(app, q)) g.push({ key: found.key, hits: found.hits.map((h) => ({ id: h.id, title: h.title, sub: h.sub, run: open(h.to) })) });
    push('cmd.goto', pages.filter((x) => has(x.title)));
    push('cmd.actions', actions.filter((x) => has(x.title)));
    if (ai) push('cmd.ai', [{ id: 'ai', title: t('cmd.askQ', { q: q.trim() }), icon: <LuSparkles />, run: open(`/assistant?q=${encodeURIComponent(q.trim())}`) }]);
    return g;
  }, [q, app, modules]); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = groups.flatMap((g) => g.hits);
  useEffect(() => setSel(0), [q]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((n) => Math.min(flat.length - 1, n + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((n) => Math.max(0, n - 1)); }
    if (e.key === 'Enter' && flat[sel]) { e.preventDefault(); flat[sel].run(); }
  };
  const isRecords = (key: string) => !key.startsWith('cmd.');
  const records = groups.some((g) => isRecords(g.key));
  let i = -1;
  return (
    <div className="overlay cmd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label={t('cmd.title')}>
        <div className="palette-in"><LuSearch aria-hidden="true" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t(ai ? 'cmd.placeholder' : 'cmd.placeholderPlain')} aria-label={t(ai ? 'cmd.placeholder' : 'cmd.placeholderPlain')} data-testid="search-input" /><kbd>Esc</kbd></div>
        <div className="res" role="listbox" ref={listRef}>
          {q.trim().length >= 2 && !records && <p className="muted small" style={{ padding: '10px 14px 2px' }}>{t('search.none', { q })}</p>}
          {groups.map((g) => (
            <div key={g.key}>
              <div className="grp">{t(g.key)}</div>
              {g.hits.map((h) => { i++; const idx = i; return (
                <button type="button" key={g.key + h.id} role="option" aria-selected={idx === sel} className={cx('hit', !isRecords(g.key) && 'cmd')} onMouseEnter={() => setSel(idx)} onClick={h.run}>
                  {h.icon && <span className="ic" aria-hidden="true">{h.icon}</span>}<span className="grow clip strong">{h.title}</span>{h.sub && <small className="clip" style={{ maxWidth: '45%' }}>{h.sub}</small>}
                </button>
              ); })}
            </div>
          ))}
        </div>
        <div className="palette-f" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> {t('cmd.move')}</span><span><kbd><LuCornerDownLeft /></kbd> {t('cmd.open')}</span><span className="sp" /><span className="brand-text strong">{DEPLOY.productName}</span></div>
      </div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) { return <A to={to} className="crumb"><LuArrowLeft aria-hidden="true" />{children}</A>; }
export { Modal };
