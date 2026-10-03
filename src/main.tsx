import '@/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { installPreviewGuards } from '@/app/preview';
import { PREVIEW, asset } from '@/app/router';
import { ready } from '@/store/store';
import { loadAllSeeds } from '@/packs/seeds';

installPreviewGuards();

// Start fetching the first page's code now, alongside the sample data, instead of after it. The page asks for the same
// file again when it is drawn and gets the copy already on its way.
const first = location.pathname.replace(/\/+$/, '');
if (first === '/demo') void import('@/features/dashboard').catch(() => undefined);
else if (!first.startsWith('/demo/')) {
  void import('@/features/marketing').catch(() => undefined);
  // the overview page's largest picture is the V mark: ask for it now so it is there when the hero is drawn
  if (first === '' || PREVIEW) new Image().src = asset('brand/vyntex-v.webp');
}

const root = document.getElementById('root')!;
ready.then(
  () => {
    createRoot(root).render(<App />);
    // The other editions' sample businesses arrive once the page is idle, so switching industry is instant by the time
    // someone reaches for it. Skipped when the visitor asked the browser to save data; a switch then loads on demand.
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!saveData) {
      const later = () => { void loadAllSeeds().catch(() => undefined); };
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      // not before the first screen has had a few seconds to itself
      setTimeout(() => { if (idle) idle(later, { timeout: 4000 }); else later(); }, 3500);
    }
  },
  () => {
    // the sample data could not be downloaded (connection lost while loading): say so instead of leaving a blank page
    const es = (navigator.language || '').toLowerCase().startsWith('es');
    const box = document.createElement('p');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'font:16px/1.5 system-ui,sans-serif;color:#C9D2DE;max-width:36ch;margin:22vh auto 0;padding:0 16px;text-align:center';
    box.textContent = es ? 'No se pudo cargar la página. Revise su conexión y vuelva a cargarla.' : 'The page could not load. Check your connection and reload.';
    root.replaceChildren(box);
  },
);
