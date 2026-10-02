// Public sales pages: overview, pricing and request a demo. They render outside the workspace shell (see app/App.tsx).
import { Landing } from './landing';
import { Pricing } from './pricing';
import { RequestDemo } from './request';
import './marketing.css';

/** Overview. `notFound` is set for an address that does not exist, and shows a short notice above the page. */
export function LandingPage({ notFound }: { notFound?: boolean }) { return <Landing notFound={notFound} />; }
export function PricingPage() { return <Pricing />; }
export function RequestDemoPage() { return <RequestDemo />; }
