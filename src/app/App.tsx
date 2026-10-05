// Top level: which page an address shows. The layout of addresses depends on the deployment (src/platform/mode.ts):
//   VYNTEX   /, /pricing, /request-demo (sales pages), /demo/* (sample workspace), /<company-slug>/* (live workspace)
//   LBS      / (sign-in), /app/* (live workspace), /preview/* (sample workspace, review builds only)
//   both     /signin, /invite/<token>, /reset-password, /mfa, /sign/<token>, /review/<token>
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react';
import { useRoute, A, workspaceOf } from './router';
import { useApp } from './hooks';
import { Shell } from './Shell';
import { PAGES } from './routes';
import { moduleExists } from './modules';
import { NoAccess } from './shared';
import { Empty, Overlays, Button } from '@/ui';
import { hasSample, loadSample, setPrefs, useStore } from '@/store/store';
import { DEPLOY } from '@/config/deployment';
import { isLive, onSession, session } from '@/platform/session';

// Read straight from the build constant (not through DEPLOY) so the bundler leaves the sales pages and the tour out of a
// deployment that does not have them: the code is not in that bundle at all, so no address can reach it.
declare const __VX_DEPLOY__: string | undefined;

const PortalPage = lazy(() => import('@/features/portal'));
const LandingPage = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? null : lazy(() => import('@/features/marketing').then((m) => ({ default: m.LandingPage })));
const PricingPage = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? null : lazy(() => import('@/features/marketing').then((m) => ({ default: m.PricingPage })));
const RequestDemoPage = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? null : lazy(() => import('@/features/marketing').then((m) => ({ default: m.RequestDemoPage })));
const Tour = (typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') ? null : lazy(() => import('@/features/tour').then((m) => ({ default: m.Tour })));
const SignIn = lazy(() => import('@/features/auth').then((m) => ({ default: m.SignIn })));
const LiveGate = lazy(() => import('@/features/auth').then((m) => ({ default: m.LiveGate })));
const LiveChrome = lazy(() => import('@/features/auth').then((m) => ({ default: m.LiveChrome })));
const Invite = lazy(() => import('@/features/auth').then((m) => ({ default: m.Invite })));
const ResetPassword = lazy(() => import('@/features/auth').then((m) => ({ default: m.ResetPassword })));
const Mfa = lazy(() => import('@/features/auth').then((m) => ({ default: m.Mfa })));
const SignPage = lazy(() => import('@/features/public').then((m) => ({ default: m.SignPage })));
const ReviewPage = lazy(() => import('@/features/public').then((m) => ({ default: m.ReviewPage })));
const NotFound = lazy(() => import('@/features/public').then((m) => ({ default: m.NotFound })));

/** Shown for the instant a page is being fetched. Quiet on purpose. */
function Loading() { return <div className="page-loading" role="status" aria-live="polite"><span className="sr">Loading</span></div>; }

/** Makes sure the sample business is in memory before a page that shows it is drawn (someone can arrive from the sign-in page). */
function useSample(): boolean {
  const [, bump] = useState(0);
  const ready = hasSample();
  useEffect(() => { if (!ready) void loadSample().then(() => bump((n) => n + 1), () => undefined); }, [ready]);
  return ready;
}

function Workspace() {
  const app = useApp();
  const { t, can, isWorker, prefs, pack } = app;
  const route = useRoute();
  const [tour, setTour] = useState(false);
  const [, section = '', id, ...rest] = route.parts;
  const tourParam = !!Tour && route.query.get('tour') === '1';
  useEffect(() => { if (tourParam) setTour(true); }, [tourParam]);
  // an edition without field workers has no worker portal: a leftover worker view goes back to the owner
  const noPortal = isWorker && !pack.usesWorkers;
  useEffect(() => { if (noPortal) setPrefs({ viewAs: 'owner' }); }, [noPortal]);
  const closeTour = () => { setTour(false); if (!prefs.tourSeen) setPrefs({ tourSeen: true }); };

  let body;
  if (noPortal) body = <Loading />;
  else if (isWorker) body = <PortalPage />;
  else {
    const def = PAGES[section];
    // a screen the company's edition does not have is not there at all, whatever the address says
    if (!def || !moduleExists(def.module, app)) body = <Empty title={t('app.notFound')} action={<A to=""><Button variant="primary">{t('app.goHome')}</Button></A>} />;
    else if (def.perm && !can(def.perm)) body = <NoAccess />;
    else { const Page = def.page; body = <Page key={section + '/' + (id || '')} id={id} sub={rest.join('/') || undefined} />; }
  }
  return (
    <Shell onTour={() => setTour(true)}>
      <Suspense fallback={<Loading />}>{body}</Suspense>
      {tour && Tour && <Suspense fallback={null}><Tour onClose={closeTour} /></Suspense>}
    </Shell>
  );
}

/** A workspace with sample records: the public demo, or the review preview. */
function SampleWorkspace() { return useSample() ? <Workspace /> : <Loading />; }
/** A sales page. They are drawn from the sample business of the selected edition, so it has to be in memory first. */
function Sales({ children }: { children: React.ReactNode }) { return useSample() ? <>{children}</> : <Loading />; }

/** Who is signed in, redrawn when someone signs in or out or the session ends. */
const useSession = () => useSyncExternalStore(onSession, session, session);

export function App() {
  const route = useRoute();
  const { prefs } = useStore();
  const who = useSession();
  const top = route.parts[0] || '';
  const ws = workspaceOf(route.path);
  // the sales pages are always dark (the brand); everything else follows the visitor's choice
  const theme = ws.mode || !DEPLOY.marketing ? prefs.theme : 'dark';
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = prefs.lang; }, [theme, prefs.lang]);

  let page;
  if (ws.mode === 'demo') page = <SampleWorkspace />;
  // A live workspace address. The workspace is drawn only when the one that is open is the company of this address; anything
  // else (nobody signed in, another company, an address that is no company at all) is the same sign-in page. The address
  // stays as it is, so signing in leads back to the page that was asked for. The sample controls never appear here.
  else if (ws.mode === 'workspace') page = isLive() && who?.slug === ws.slug ? <><Workspace /><Suspense fallback={null}><LiveChrome /></Suspense></> : <LiveGate slug={ws.slug} />;
  else if (top === 'signin') page = <SignIn />;
  else if (top === 'invite') page = <Invite token={route.parts[1]} />;
  else if (top === 'reset-password') page = <ResetPassword />;
  else if (top === 'mfa') page = <Mfa />;
  else if (top === 'sign') page = <SignPage token={route.parts[1]} />;
  else if (top === 'review') page = <ReviewPage token={route.parts[1]} />;
  else if (LandingPage && PricingPage && RequestDemoPage) {
    if (top === '') page = <Sales><LandingPage /></Sales>;
    else if (top === 'pricing') page = <Sales><PricingPage /></Sales>;
    else if (top === 'request-demo') page = <Sales><RequestDemoPage /></Sales>;
    else page = <Sales><LandingPage notFound /></Sales>;
  }
  // a deployment without sales pages: its home page is the sign-in page
  else page = top === '' ? <SignIn /> : <NotFound />;
  return <><Suspense fallback={<Loading />}>{page}</Suspense><Overlays /></>;
}
