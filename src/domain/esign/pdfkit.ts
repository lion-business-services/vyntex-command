// The few things every PDF job here needs from pdf-lib: the standard fonts with their widths, drawing a page from its
// list of drawing steps, a SHA-256 fingerprint, and reading the page sizes of a file someone uploaded.
// pdf-lib is loaded only when a PDF is actually made, so it stays out of the first screen. Works in the browser and in Node.
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import type { DrawOp, FontId, PageSize, RGB } from './types';
import type { Measure } from './text';

export const pdfLib = () => import('pdf-lib');
export type PdfLib = Awaited<ReturnType<typeof pdfLib>>;
export type Fonts = Record<FontId, PDFFont>;

/** Helvetica in its three cuts, and the measuring stick the layout code uses. */
export async function openFonts(lib: PdfLib, pdf: PDFDocument): Promise<{ fonts: Fonts; measure: Measure }> {
  const fonts: Fonts = { regular: await pdf.embedFont(lib.StandardFonts.Helvetica), bold: await pdf.embedFont(lib.StandardFonts.HelveticaBold), italic: await pdf.embedFont(lib.StandardFonts.HelveticaOblique) };
  const charset = new Set(fonts.regular.getCharacterSet());
  const measure: Measure = {
    width: (s, f, size) => { try { return fonts[f].widthOfTextAtSize(s, size); } catch { return s.length * size * 0.5; } },
    has: (cp) => charset.has(cp),
  };
  return { fonts, measure };
}

/** Draws one page from its list of steps. An image the page refers to and that could not be embedded is simply left out. */
export function drawOps(lib: PdfLib, page: PDFPage, ops: DrawOp[], fonts: Fonts, images: Record<string, PDFImage> = {}): void {
  const col = (c: RGB) => lib.rgb(c[0], c[1], c[2]);
  for (const o of ops) {
    if (o.t === 'text') { if (o.s) page.drawText(o.s, { x: o.x, y: o.y, font: fonts[o.f], size: o.size, color: col(o.c) }); }
    else if (o.t === 'line') page.drawLine({ start: { x: o.x1, y: o.y1 }, end: { x: o.x2, y: o.y2 }, thickness: o.w, color: col(o.c) });
    else if (o.t === 'rect') page.drawRectangle({ x: o.x, y: o.y, width: o.w, height: o.h, ...(o.fill ? { color: col(o.fill) } : {}), ...(o.stroke ? { borderColor: col(o.stroke), borderWidth: o.sw ?? 1 } : {}) });
    else if (images[o.key]) page.drawImage(images[o.key], { x: o.x, y: o.y, width: o.w, height: o.h });
  }
}

/** SHA-256 of a file, in hex, computed with the platform's own WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** How a page is turned when it is shown, and the box it is cut to. Drawing in "as shown" coordinates needs both. */
export function pageFrame(page: PDFPage): { size: PageSize; matrix: [number, number, number, number, number, number] } {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const { x, y, width: W, height: H } = box;
  const matrix: [number, number, number, number, number, number] = rot === 90 ? [0, 1, -1, 0, x + W, y] : rot === 180 ? [-1, 0, 0, -1, x + W, y + H] : rot === 270 ? [0, -1, 1, 0, x, y + H] : [1, 0, 0, 1, x, y];
  return { size: rot % 180 ? { w: H, h: W } : { w: W, h: H }, matrix };
}

export type PdfProblem = 'encrypted' | 'unreadable' | 'too_many_pages';
/** Page sizes of a PDF, as shown. Refuses a password-protected file and anything that is not a PDF. */
export async function readPages(bytes: Uint8Array): Promise<{ ok: true; pages: PageSize[] } | { ok: false; reason: PdfProblem }> {
  const lib = await pdfLib();
  let pdf: PDFDocument;
  try { pdf = await lib.PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { return { ok: false, reason: /encrypt/i.test(String((e as Error)?.message ?? e)) ? 'encrypted' : 'unreadable' }; }
  const pages = pdf.getPages();
  if (!pages.length) return { ok: false, reason: 'unreadable' };
  if (pages.length > 300) return { ok: false, reason: 'too_many_pages' };
  return { ok: true, pages: pages.map((p) => pageFrame(p).size) };
}
