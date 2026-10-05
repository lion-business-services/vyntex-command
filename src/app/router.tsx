// Small path router. A workspace lives under a base that depends on the address and the deployment:
// the sample one under /demo (VYNTEX) or /preview (LBS review builds), a live one under /<company-slug> (VYNTEX) or /app (LBS).
// The same pages are shown under every base.
import { type ReactNode, type MouseEvent, useSyncExternalStore } from 'react';
import { DEPLOY } from '@/config/deployment';
import { resolvePath, type PathResolution } from '@/platform/mode';

// Read straight from the build constant (not through DEPLOY) so the bundler can drop the other deployment's addresses.
declare const __VX_DEPLOY__: string | undefined;
declare const __VX_SAMPLE_PREVIEW__: boolean | undefined;

export interface Route { path: string; parts: string[]; query: URLSearchParams }
/**
 * Preview mode: when the app is embedded somewhere it does not own the address bar (a shared preview inside another page),
 * the current page is kept in memory instead. Everything else behaves the same. The hosted site never uses this.
 */
export const PREVIEW = typeof window !== 'undefined' && (window as unknown as { __VX_PREVIEW__?: boolean }).__VX_PREVIEW__ === true;
// an embedded preview of the single-company deployment opens straight on its sample workspace
let memory = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') && (typeof __VX_SAMPLE_PREVIEW__ !== 'undefined' && __VX_SAMPLE_PREVIEW__ === true) ? '/preview' : '/';
/** Address of the page being shown: path plus query. */
export const currentUrl = (): string => (PREVIEW ? memory : location.pathname + location.search);
/** Address of a file in public/ (logo, icons). Relative in preview mode, where the app is not served from the site root. */
export const asset = (file: string): string => (PREVIEW ? '' : '/') + file.replace(/^\//, '');

const listeners = new Set<() => void>();
let current: Route = read();
function read(): Route {
  const u = new URL(currentUrl(), 'http://local');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(u.search) };
}
function changed() { current = read(); listeners.forEach((l) => l()); }
if (!PREVIEW) window.addEventListener('popstate', changed);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === currentUrl()) return;
  if (PREVIEW) memory = to;
  else if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  changed();
  window.scrollTo(0, 0);
}
export function useRoute(): Route { return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current, () => current); }

/** Which workspace the address on screen belongs to, read with this deployment's layout of addresses. */
export const workspaceOf = (path: string = current.path): PathResolution => resolvePath(path, DEPLOY.id, DEPLOY.samplePreview);
/** Where the sample workspace of this deployment lives, or null when the build has none. */
export const SAMPLE_BASE: string | null = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? ((typeof __VX_SAMPLE_PREVIEW__ !== 'undefined' && __VX_SAMPLE_PREVIEW__ === true) ? '/preview' : null) : '/demo';
/**
 * Base path of the workspace being viewed: `/demo` or `/preview` (sample), `/<company-slug>` or `/app` (live).
 * On a page outside any workspace it is where a workspace link should lead: the sample one, or `/app`.
 */
export function appBase(): string {
  const w = workspaceOf();
  return w.mode ? w.base : SAMPLE_BASE ?? '/app';
}
/** Path inside the workspace: appPath('/jobs/j1') -> '/demo/jobs/j1'. */
export const appPath = (sub = '') => appBase() + (sub === '/' ? '' : sub);
/** Navigate inside the workspace. */
export const go = (sub: string) => navigate(appPath(sub));

export function Link({ to, children, className, onClick, ...rest }: { to: string; children: ReactNode; className?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a href={PREVIEW ? '#' : to} className={className} {...rest} onClick={(e) => {
      onClick?.(e);
      if (PREVIEW) { if (!e.defaultPrevented) { e.preventDefault(); navigate(to); } return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault(); navigate(to);
    }}>{children}</a>
  );
}
/** Link to a page inside the workspace. */
export function A({ to, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) { return <Link to={appPath(to)} {...rest} />; }

/** Where a record lives, so search results, notifications and activity can all link the same way. */
export function refPath(ref: { type: string; id: string }, _jobIdOfTask?: string): string {
  switch (ref.type) {
    case 'lead': return `/leads/${ref.id}`;
    case 'client': return `/clients/${ref.id}`;
    case 'job': return `/jobs/${ref.id}`;
    case 'worker': return `/team/${ref.id}`;
    case 'doc': return `/documents/${ref.id}`;
    case 'task': return `/tasks?task=${ref.id}`;
    case 'appointment': return `/appointments/${ref.id}`;
    case 'service': return `/catalog/${ref.id}`;
    case 'opportunity': return `/opportunities/${ref.id}`;
    case 'envelope': return `/esign/${ref.id}`;
    case 'review': return '/reviews';
    case 'post': return '/social';
    case 'cash': return '/cash';
    case 'compliance': return `/deadlines/${ref.id}`;
    case 'payment': return '/payments';
    case 'user': return '/team';
    default: return '/';
  }
}
