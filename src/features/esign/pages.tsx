// The pages of a document on screen, with room on top of each for the signature boxes.
// A generated document is drawn on a canvas from its own layout, so every page is exact. An uploaded PDF cannot be drawn
// that way (there is no PDF reader in this app): where the browser can show it, its own PDF viewer sits behind the
// boxes; where it cannot, each page is an empty sheet of the right size, read from the file. The screen says which.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadImages, paintPage } from '@/features/documents/paint';
import type { PageSize, PageView } from '@/domain/esign/types';

/** The parts of a pointer event the signature screens read. Written out because both type setups of this project must accept it. */
export interface PEvent { clientX: number; clientY: number; pointerId: number; button: number; shiftKey: boolean; pointerType?: string; preventDefault(): void; stopPropagation(): void; target: EventTarget | null; currentTarget: EventTarget | null }

/** How the pages of a document can be shown here. */
export type PageMode = 'drawn' | 'viewer' | 'blank';

const blockedListeners = new Set<() => void>();
const notify = () => blockedListeners.forEach((f) => f());

/** Whether a content security policy lets a page frame a file it made itself (a `blob:` address). No policy allows it. */
export function allowsBlobFrames(policy: string | null | undefined): boolean {
  if (!policy) return true;
  const rules = new Map(policy.split(';').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).map((x) => [x[0].toLowerCase(), x.slice(1)] as const));
  const src = rules.get('frame-src') ?? rules.get('child-src') ?? rules.get('default-src');
  return !src || src.includes('blob:');
}
/**
 * Whether this site allows the framed viewer: null until it is known. The policy travels in the response headers of
 * the page, which a script cannot see, so the page asks for its own headers once. Asking first matters: trying a frame
 * the policy forbids would make the browser log an error on every file. Anything unclear counts as "not allowed".
 */
let framesAllowed: boolean | null = null;
let asked = false;
function askPolicy(): void {
  if (asked || typeof fetch === 'undefined' || typeof location === 'undefined') return;
  asked = true;
  fetch(location.pathname, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' })
    .then((r) => { framesAllowed = r.ok && allowsBlobFrames(r.headers.get('content-security-policy')); })
    .catch(() => { framesAllowed = false; })
    .finally(notify);
}
if (typeof document !== 'undefined') {
  // the safety net: a policy that came another way (a tag in the page) still says so with this event, and the pages fall back
  document.addEventListener('securitypolicyviolation', (e) => {
    if (!/frame-src|child-src|default-src|object-src/.test(e.effectiveDirective || e.violatedDirective || '') || !/^(blob|data)/.test(e.blockedURI || '')) return;
    framesAllowed = false; notify();
  });
}
let viewerOff = false;
/** Lets a person switch the browser's PDF viewer off for this visit, when what it shows is not right, and back on. */
export function setViewerOff(off: boolean): void { viewerOff = off; notify(); }
/** Whether this browser could show a PDF inside the page at all, whatever the person chose. */
export const viewerPossible = (): boolean => framesAllowed === true && typeof navigator !== 'undefined' && (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled === true
  // phones and small tablets either have no viewer for a framed file or show only its first page
  && typeof matchMedia !== 'undefined' && !matchMedia('(max-width: 700px)').matches;
/**
 * Whether the browser's own PDF viewer is shown inside the page: it has one, the site allows framing the file, the
 * screen is wide enough, and the person did not switch it off.
 */
export function useViewer(): boolean {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); blockedListeners.add(f); askPolicy(); return () => { blockedListeners.delete(f); }; }, []);
  return !viewerOff && viewerPossible();
}
/** A viewer is started for every page shown, each with the whole file: fine for a form, too heavy for a long file, which gets empty sheets instead. */
export const VIEWER_MAX_PAGES = 12;
export const pageMode = (view: PageView[] | undefined, pdfUrl: string | null | undefined, viewer: boolean, pages = 1): PageMode => (view?.length ? 'drawn' : pdfUrl && viewer && pages <= VIEWER_MAX_PAGES ? 'viewer' : 'blank');

function Canvas({ page, images }: { page: PageView; images?: Record<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    let pics: Record<string, HTMLImageElement> = {}; let live = true; let frame = 0;
    const draw = () => { if (live && c.clientWidth) paintPage(c, page, pics, c.clientWidth); };
    void loadImages(images).then((p) => { pics = p; draw(); });
    draw();
    // repainted when the page changes size, so the text stays sharp at any width
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }) : null;
    ro?.observe(c);
    return () => { live = false; ro?.disconnect(); cancelAnimationFrame(frame); };
  }, [page, images]);
  return <canvas ref={ref} className="es-canvas" aria-hidden="true" />;
}

/**
 * One page. `children` is laid over it (the boxes). `label` names the page for a screen reader, `blankNote` is what an
 * empty sheet says in its middle.
 */
export function PageSheet({ index, size, view, images, pdfUrl, mode, label, blankNote, children, sheetRef, onPointerDown, className }: {
  index: number; size: PageSize; view?: PageView; images?: Record<string, string>; pdfUrl?: string | null; mode: PageMode; label: string; blankNote?: string;
  children?: ReactNode; sheetRef?: (el: HTMLDivElement | null) => void; onPointerDown?: (e: PEvent) => void; className?: string;
}) {
  return (
    <div className={'es-page' + (className ? ' ' + className : '')} style={{ aspectRatio: `${size.w} / ${size.h}` }} data-page={index} data-mode={mode} role="group" aria-label={label} ref={sheetRef} onPointerDown={onPointerDown}>
      {mode === 'drawn' && view ? <Canvas page={view} images={images} />
        : mode === 'viewer' && pdfUrl ? <iframe className="es-pdf" src={`${pdfUrl}#page=${index + 1}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`} title={label} tabIndex={-1} aria-hidden="true" />
        : <div className="es-blank" aria-hidden="true"><b>{index + 1}</b>{blankNote && <span>{blankNote}</span>}</div>}
      <div className="es-overlay">{children}</div>
    </div>
  );
}

/** Sizes of the pages to show: what the envelope recorded, else the size of each drawn page. */
export const pageSizes = (pages: PageSize[] | undefined, view: PageView[] | undefined): PageSize[] => (pages?.length ? pages : (view ?? []).map((p) => ({ w: p.w, h: p.h })));
