// The sign-in frame: the brand on one side, a slot for the form on the other. Presentation only, no logic and no wording
// of its own: the sign-in screens pass their form, title and footer in, already translated.
// For Lion Business Services this is the first screen of every working day, so the brand panel carries the official
// lion and wordmark, large, and the product name. Nothing else: no slogan and no claim.
import type { ReactNode } from 'react';
import { asset } from '@/app/router';
import { DEPLOY } from '@/config/deployment';
import { Lockup, VMark } from './index';
import { LbsWordmark } from './lbs';

// The same build constant brand/index.tsx tests, written out at the branch so each bundle keeps only its own brand panel
// (see the note there).
declare const __VX_DEPLOY__: string | undefined;

/** The lion above the wordmark and the product name. Two sizes of the lion file: the small one is enough on a phone. */
function LbsPanel() {
  return (
    <div className="auth-id">
      <img className="auth-lion" src={asset('brand-lbs/lion-768.png')} srcSet={`${asset('brand-lbs/lion-256.png')} 145w, ${asset('brand-lbs/lion-768.png')} 435w`} sizes="(max-width: 900px) 60px, 230px" alt="" width={435} height={768} decoding="async" />
      <div className="auth-id-t">
        <LbsWordmark height={125} className="auth-word" />
        <span className="auth-rule" aria-hidden="true" />
        <p className="auth-product">{DEPLOY.productName}</p>
      </div>
    </div>
  );
}
/** The V mark above the VYNTEX Command lockup. */
function VyntexPanel() {
  return (
    <div className="auth-id">
      <VMark size={280} className="auth-v" />
      <div className="auth-id-t"><Lockup size="lg" mark={false} /></div>
    </div>
  );
}

/**
 * Wrap a sign-in, reset or invitation form in the brand frame.
 *   children  the form
 *   title     the heading of the form ("Sign in"); drawn as the page's h1
 *   sub       one line under the heading
 *   tools     small controls for the top corner of the form side (language switch)
 *   footer    a line under the form (support contact, legal links)
 * Wide screens: brand panel on the left, form on the right. Under 900px the panel becomes a band above the form.
 */
export function AuthFrame(props: AuthFrameProps) {
  return typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs'
    ? <Layout brand="auth-lbs" panel={<LbsPanel />} {...props} />
    : <Layout brand="auth-vx" panel={<VyntexPanel />} {...props} />;
}
export interface AuthFrameProps { children: ReactNode; title?: ReactNode; sub?: ReactNode; tools?: ReactNode; footer?: ReactNode }

function Layout({ brand, panel, children, title, sub, tools, footer }: AuthFrameProps & { brand: string; panel: ReactNode }) {
  return (
    <div className={`auth ${brand}`}>
      <div className="auth-brand">{panel}</div>
      <div className="auth-main">
        {tools && <div className="auth-tools">{tools}</div>}
        <main className="auth-form" id="main">
          {title && <h1>{title}</h1>}
          {sub && <p className="auth-sub">{sub}</p>}
          {children}
        </main>
        {footer && <footer className="auth-foot">{footer}</footer>}
      </div>
    </div>
  );
}
