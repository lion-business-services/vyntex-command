import '@/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { installPreviewGuards } from '@/app/preview';
import { PREVIEW, asset, currentUrl, workspaceOf } from '@/app/router';
import { boot } from '@/store/store';
import { loadAllSeeds } from '@/packs/seeds';
import { DEPLOY } from '@/config/deployment';

// Read straight from the build constants so the bundler drops what the other deployment needs.
declare const __VX_DEPLOY__: string | undefined;
declare const __VX_SAMPLE_PREVIEW__: boolean | undefined;
// The conditions below are written out in full, on the build constants themselves, on purpose: the bundler can only drop a
// branch (and the files it imports) when it sees the constant in the condition, not through a variable.

// The brand of this deployment, set before anything is painted so the first frame already has its colours.
document.documentElement.dataset.brand = DEPLOY.theme;

installPreviewGuards();

const first = currentUrl().split('?')[0].replace(/\/+$/, '');
const ws = workspaceOf(first || '/');
const top = first.split('/')[1] || '';
/** Addresses that show no sample records: sign-in and the pages opened from a private link. */
const PLAIN = ['signin', 'invite', 'reset-password', 'mfa', 'sign', 'review'];
// the sales pages are drawn from the sample business too
const wantsSample = (!(typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') || (typeof __VX_SAMPLE_PREVIEW__ !== 'undefined' && __VX_SAMPLE_PREVIEW__ === true)) && (ws.mode === 'demo' || (!(typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') && ws.mode === null && !PLAIN.includes(top)));

// Start fetching the first page's code now, alongside the sample data, instead of after it. The page asks for the same
// file again when it is drawn and gets the copy already on its way.
if (ws.mode === 'demo' && ws.rest === '/') void import('@/features/dashboard').catch(() => undefined);
else if (!(typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') && wantsSample && ws.mode === null) {
  void import('@/features/marketing').catch(() => undefined);
  // the overview page's largest picture is the V mark: ask for it now so it is there when the hero is drawn
  if (first === '' || PREVIEW) new Image().src = asset('brand/vyntex-v.webp');
}

// The two ways of reaching the records behind a workspace (src/platform/gateway.ts). The sample one exists only in a build
// that can show a sample workspace.
const gateways: Promise<unknown>[] = [import('@/platform/live')];
if ((!(typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') || (typeof __VX_SAMPLE_PREVIEW__ !== 'undefined' && __VX_SAMPLE_PREVIEW__ === true))) gateways.push(import('@/platform/sample'));

const root = document.getElementById('root')!;
Promise.all([boot(wantsSample), ...gateways]).then(
  () => {
    createRoot(root).render(<App />);
    // The other editions' sample businesses arrive once the page is idle, so switching industry is instant by the time
    // someone reaches for it. Skipped when the visitor asked the browser to save data; a switch then loads on demand.
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!(typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs') && wantsSample && !saveData) {
      const later = () => { void loadAllSeeds().catch(() => undefined); };
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      // not before the first screen has had a few seconds to itself
      setTimeout(() => { if (idle) idle(later, { timeout: 4000 }); else later(); }, 3500);
    }
  },
  () => {
    // the page's code or the sample data could not be downloaded (connection lost while loading): say so instead of leaving a blank page
    const es = (navigator.language || '').toLowerCase().startsWith('es');
    const box = document.createElement('p');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'font:16px/1.5 system-ui,sans-serif;color:#C9D2DE;max-width:36ch;margin:22vh auto 0;padding:0 16px;text-align:center';
    box.textContent = es ? 'No se pudo cargar la página. Revise su conexión y vuelva a cargarla.' : 'The page could not load. Check your connection and reload.';
    root.replaceChildren(box);
  },
);
