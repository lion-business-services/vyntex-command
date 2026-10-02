// Which workspace an address belongs to. One deployment serves everything from one subdomain:
//
//   /demo/...             the public demo. Sample data, kept in the visitor's browser only. Never touches the database.
//   /<company-slug>/...   a customer company. Sign-in required. Data comes from that company's rows in the database.
//   anything else         the sales pages (/, /pricing, /request-demo) and addresses the site keeps for itself.
//
// Framework free on purpose: no React, no DOM, no imports. The router and the server can both use it.

export type WorkspaceMode = 'demo' | 'workspace';

/** The demo's place in the address. */
export const DEMO_SEGMENT = 'demo';

/**
 * First path segments that can never be a company address, because the site uses or may use them itself.
 * Must stay identical to app.reserved_slugs() in supabase/migrations/0001_platform.sql
 * (supabase/tests/parity.mjs compares the two lists and fails when they differ).
 */
export const RESERVED_SLUGS: readonly string[] = [
  'demo', 'pricing', 'request-demo', 'api', 'assets', 'brand', 'login', 'logout', 'signup', 'signin', 'register',
  'auth', 'callback', 'invite', 'reset-password', 'admin', 'app', 'www', 'static', 'public', 'settings', 'account',
  'billing', 'checkout', 'pay', 'webhooks', 'support', 'help', 'docs', 'legal', 'privacy', 'terms', 'about',
  'contact', 'blog', 'status', 'health', 'new', 'onboarding', 'portal', 'worker', 'client', 'dashboard', 'sign',
  'vyntex', 'null', 'undefined',
];

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;
/** Lowercase letters and digits, with single hyphens between them. Same pattern as app.is_valid_slug() in the database. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isReservedSlug = (value: string): boolean => RESERVED_SLUGS.includes(value);

/**
 * True when `value` may be a company address. The rule is the same one the database enforces on tenants.slug:
 * 3 to 40 characters, lowercase letters and digits, single hyphens between them, and not a reserved word.
 */
export function isValidSlug(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value) &&
    !isReservedSlug(value)
  );
}

export type PathResolution =
  /** The public demo. `base` is '/demo'. */
  | { mode: 'demo'; slug: null; base: string; rest: string }
  /** A customer company. `base` is '/<slug>'. Whether that company exists, and whether the visitor may enter, is decided after sign-in. */
  | { mode: 'workspace'; slug: string; base: string; rest: string }
  /** Not a workspace: the home page, another site page, or a first segment that is not a valid company address. */
  | { mode: null; slug: null; base: ''; rest: string };

/**
 * Resolves the mode and the company slug from a path such as `location.pathname`.
 *
 *   resolvePath('/demo/jobs/j1')        -> { mode: 'demo', slug: null, base: '/demo', rest: '/jobs/j1' }
 *   resolvePath('/acme-builders/leads') -> { mode: 'workspace', slug: 'acme-builders', base: '/acme-builders', rest: '/leads' }
 *   resolvePath('/pricing')             -> { mode: null, slug: null, base: '', rest: '/pricing' }
 *
 * `rest` always starts with '/' and never ends with one (except when it is just '/').
 * Matching is exact: '/Acme-Builders' is not a workspace, because company addresses are lowercase.
 */
export function resolvePath(pathname: string): PathResolution {
  const clean = '/' + String(pathname ?? '').split(/[?#]/)[0].split('/').filter(Boolean).join('/');
  const parts = clean.split('/').filter(Boolean);
  const first = parts[0] ?? '';
  const rest = '/' + parts.slice(1).join('/');
  if (first === DEMO_SEGMENT) return { mode: 'demo', slug: null, base: '/' + DEMO_SEGMENT, rest };
  if (isValidSlug(first)) return { mode: 'workspace', slug: first, base: '/' + first, rest };
  return { mode: null, slug: null, base: '', rest: clean };
}

/** Address of a page inside a workspace: workspacePath('acme-builders', '/jobs') -> '/acme-builders/jobs'. */
export function workspacePath(slug: string, sub = ''): string {
  return '/' + slug + (sub === '/' ? '' : sub);
}
