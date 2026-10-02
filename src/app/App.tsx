// Top level: the public pages (overview, pricing, request a demo) and the workspace under /demo.
import { Suspense, lazy, useEffect, useState } from 'react';
import { useRoute, A } from './router';
import { useApp } from './hooks';
import { Shell } from './Shell';
import { PAGES } from './routes';
import { NoAccess } from './shared';
import { Empty, Overlays, Button } from '@/ui';
import { setPrefs } from '@/store/store';
const PortalPage = lazy(() => import('@/features/portal'));
const LandingPage = lazy(() => import('@/features/marketing').then((m) => ({ default: m.LandingPage })));
const PricingPage = lazy(() => import('@/features/marketing').then((m) => ({ default: m.PricingPage })));
const RequestDemoPage = lazy(() => import('@/features/marketing').then((m) => ({ default: m.RequestDemoPage })));
const Tour = lazy(() => import('@/features/tour').then((m) => ({ default: m.Tour })));

/** Shown for the instant a page is being fetched. Quiet on purpose. */
function Loading() { return <div className="page-loading" role="status" aria-live="polite"><span className="sr">Loading</span></div>; }

function Workspace() {
  const { t, can, isWorker, prefs } = useApp();
  const route = useRoute();
  const [tour, setTour] = useState(false);
  const [, section = '', id, ...rest] = route.parts;
  const tourParam = route.query.get('tour') === '1';
  useEffect(() => { if (tourParam) setTour(true); }, [tourParam]);
  const closeTour = () => { setTour(false); if (!prefs.tourSeen) setPrefs({ tourSeen: true }); };

  let body;
  if (isWorker) body = <PortalPage />;
  else {
    const def = PAGES[section];
    if (!def) body = <Empty title={t('app.notFound')} action={<A to=""><Button variant="primary">{t('app.goHome')}</Button></A>} />;
    else if (def.perm && !can(def.perm)) body = <NoAccess />;
    else { const Page = def.page; body = <Page key={section + '/' + (id || '')} id={id} sub={rest.join('/') || undefined} />; }
  }
  return (
    <Shell onTour={() => setTour(true)}>
      <Suspense fallback={<Loading />}>{body}</Suspense>
      {tour && <Suspense fallback={null}><Tour onClose={closeTour} /></Suspense>}
    </Shell>
  );
}

export function App() {
  const route = useRoute();
  const { prefs } = useApp();
  const top = route.parts[0] || '';
  // the sales pages are always dark (the brand); the workspace follows the visitor's choice
  const theme = top === 'demo' ? prefs.theme : 'dark';
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = prefs.lang; }, [theme, prefs.lang]);
  let page;
  if (top === 'demo') page = <Workspace />;
  else if (top === '') page = <LandingPage />;
  else if (top === 'pricing') page = <PricingPage />;
  else if (top === 'request-demo') page = <RequestDemoPage />;
  else page = <LandingPage notFound />;
  return <><Suspense fallback={<Loading />}>{page}</Suspense><Overlays /></>;
}
