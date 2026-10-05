// Draws a document as a real PDF in the browser. pdf-lib is loaded only when someone asks for a PDF,
// so it stays out of the main bundle. Standard Helvetica covers English and Spanish; anything it cannot
// encode is replaced before drawing, so a stray symbol never breaks the download.
// The page content itself is worked out in layout.ts; this file embeds the pictures and writes the pages.
import type { PDFImage } from 'pdf-lib';
import type { DocModel } from './model';
import { layoutDoc, sigKey, type DocLayout, type ImageSizes } from './layout';
import { cleaner } from '@/domain/esign/text';
import { drawOps, openFonts, pdfLib } from '@/domain/esign/pdfkit';

/** Has the browser decode an image (PNG, JPG, SVG, WebP) and hand back a clean PNG for the PDF. Gives null when it cannot be read. */
function rasterize(src: string, maxW: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || maxW) * scale)); c.height = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface RenderedDoc {
  bytes: Uint8Array;
  /** What was drawn on each page, and where the signature lines are. */
  layout: DocLayout;
  /** The pictures the pages use, as PNG data addresses, so the same pages can be drawn on screen. */
  images: Record<string, string>;
}

/** The PDF of a document together with the description of its pages. */
export async function renderDoc(model: DocModel): Promise<RenderedDoc> {
  const lib = await pdfLib();
  const pdf = await lib.PDFDocument.create();
  const { fonts, measure } = await openFonts(lib, pdf);
  const clean = cleaner(measure);

  const embedded: Record<string, PDFImage> = {}; const sizes: ImageSizes = {}; const images: Record<string, string> = {};
  const picture = async (key: string, src: string | undefined, maxW: number) => {
    if (!src) return;
    try {
      // always re-drawn by the browser first: a damaged upload is skipped instead of reaching the PDF writer
      const png = await rasterize(src, maxW);
      if (!png) return;
      const img = await pdf.embedPng(png);
      embedded[key] = img; sizes[key] = { w: img.width, h: img.height }; images[key] = png;
    } catch { /* the document is drawn without this picture */ }
  };
  await picture('logo', model.company.logo, 480);
  for (let bi = 0; bi < model.blocks.length; bi++) {
    const b = model.blocks[bi];
    if (b.t === 'sign') for (let i = 0; i < b.parties.length; i++) await picture(sigKey(bi, i), b.parties[i].signed?.image, 640);
  }

  const layout = layoutDoc(model, measure, sizes);
  for (const p of layout.pages) drawOps(lib, pdf.addPage([p.w, p.h]), p.ops, fonts, embedded);

  pdf.setTitle(clean(`${model.title.text} ${model.number}`));
  pdf.setAuthor(clean(model.company.name));
  pdf.setLanguage(model.lang === 'es' ? 'es-US' : 'en-US');
  return { bytes: await pdf.save(), layout, images };
}

export async function buildPdf(model: DocModel): Promise<Uint8Array> { return (await renderDoc(model)).bytes; }

/** Hands a finished file to the browser's download. */
export function saveFile(bytes: Uint8Array, name: string, mime = 'application/pdf') {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
