// Draws a page of a generated document on a canvas, from the same list of drawing steps the PDF writer uses (layout.ts).
// This is how the signature screens show a document without a PDF viewer: every line sits where it sits in the file.
// The paper is white with dark ink in either theme, like the printed document, so the colours come from the page itself.
import type { DrawOp, PageView, RGB } from '@/domain/esign/types';

const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
// Helvetica first; Arial and Liberation Sans have the same widths, so lines end where the PDF's lines end
const FACE = 'Helvetica, Arial, "Liberation Sans", sans-serif';
const font = (o: Extract<DrawOp, { t: 'text' }>, k: number) => `${o.f === 'italic' ? 'italic ' : ''}${o.f === 'bold' ? '700 ' : '400 '}${o.size * k}px ${FACE}`;

/** Loads the pictures a page refers to. One that cannot be read is left out. */
export function loadImages(sources: Record<string, string> | undefined): Promise<Record<string, HTMLImageElement>> {
  const entries = Object.entries(sources || {});
  return Promise.all(entries.map(([key, src]) => new Promise<[string, HTMLImageElement | null]>((resolve) => {
    const img = new Image();
    img.onload = () => resolve([key, img]); img.onerror = () => resolve([key, null]);
    img.src = src;
  }))).then((list) => Object.fromEntries(list.filter((x): x is [string, HTMLImageElement] => !!x[1])));
}

/** Paints one page at the width the canvas is shown at. Sharp on dense screens, capped so a phone does not run out of memory. */
export function paintPage(canvas: HTMLCanvasElement, page: PageView, images: Record<string, HTMLImageElement> = {}, cssWidth = canvas.clientWidth || page.w): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pxW = Math.max(1, Math.round(cssWidth * ratio)), pxH = Math.max(1, Math.round((cssWidth * page.h / page.w) * ratio));
  if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
  const g = canvas.getContext('2d'); if (!g) return;
  const k = pxW / page.w;
  // a PDF counts from the bottom of the page, a canvas from the top
  const Y = (y: number) => (page.h - y) * k;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = 'rgb(255,255,255)'; g.fillRect(0, 0, pxW, pxH);
  g.textBaseline = 'alphabetic';
  for (const o of page.ops) {
    if (o.t === 'text') { g.font = font(o, k); g.fillStyle = css(o.c); g.fillText(o.s, o.x * k, Y(o.y)); }
    else if (o.t === 'line') { g.strokeStyle = css(o.c); g.lineWidth = Math.max(0.6, o.w * k); g.beginPath(); g.moveTo(o.x1 * k, Y(o.y1)); g.lineTo(o.x2 * k, Y(o.y2)); g.stroke(); }
    else if (o.t === 'rect') {
      if (o.fill) { g.fillStyle = css(o.fill); g.fillRect(o.x * k, Y(o.y + o.h), o.w * k, o.h * k); }
      if (o.stroke) { g.strokeStyle = css(o.stroke); g.lineWidth = Math.max(0.6, (o.sw ?? 1) * k); g.strokeRect(o.x * k, Y(o.y + o.h), o.w * k, o.h * k); }
    } else if (images[o.key]) g.drawImage(images[o.key], o.x * k, Y(o.y + o.h), o.w * k, o.h * k);
  }
}
