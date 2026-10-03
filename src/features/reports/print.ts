// Printing uses the light colours whatever theme is on screen, then puts the theme back.
// Shared by Reports and by the 1099 report, so a printed page never depends on colours typed for paper.
import { useEffect } from 'react';

export function usePrintInLight(): void {
  useEffect(() => {
    let prev: string | undefined;
    const before = () => { prev = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'light'; };
    const after = () => { if (prev) document.documentElement.dataset.theme = prev; prev = undefined; };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); };
  }, []);
}
