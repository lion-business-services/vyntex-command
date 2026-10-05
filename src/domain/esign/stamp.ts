// The signed copy. Takes the PDF exactly as it was sent, writes every filled box onto its pages, and adds the completion
// certificate behind it. The file that was sent is never changed: the result is a new file.
// Two fingerprints are printed on the certificate (the original, and the pages once filled in); the fingerprint of the
// finished file is returned to be kept on the record, because a file cannot contain its own.
// No browser code: the server runs this same function when the last signer finishes.
import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import type { Lang } from '../types';
import type { EnvelopeHashes, EnvelopeX } from './types';
import { cleaner } from './text';
import { dataUrlBytes, drawOps, openFonts, pageFrame, pdfLib, sha256Hex, type Fonts, type PdfLib } from './pdfkit';
import { certificateModel, layoutCertificate, watermarkText, type CertificateInput } from './certificate';

export interface SignedCopyInput extends Omit<CertificateInput, 'env' | 'hashes' | 'lang' | 'sample'> { lang?: Lang }
export interface SignedCopy { bytes: Uint8Array; hashes: Required<EnvelopeHashes>; pages: number }

/** Runs `draw` with the page's coordinates turned to "as shown": origin at the bottom left of what a reader sees. */
function asShown(lib: PdfLib, page: PDFPage, draw: (size: { w: number; h: number }) => void) {
  const { size, matrix } = pageFrame(page);
  page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(...matrix));
  draw(size);
  page.pushOperators(lib.popGraphicsState());
}

/** A light diagonal line of text across a page of a sample, so a printout can never pass for a signed original. */
function watermark(lib: PdfLib, page: PDFPage, fonts: Fonts, text: string) {
  asShown(lib, page, ({ w, h }) => {
    const angle = Math.atan2(h, w);
    const size = Math.min(34, (Math.hypot(w, h) * 0.78) / Math.max(1, fonts.bold.widthOfTextAtSize(text, 1)));
    const len = fonts.bold.widthOfTextAtSize(text, size);
    page.drawText(text, { x: w / 2 - (Math.cos(angle) * len) / 2 + Math.sin(angle) * size * 0.3, y: h / 2 - (Math.sin(angle) * len) / 2 - Math.cos(angle) * size * 0.3, size, font: fonts.bold, color: lib.rgb(0.45, 0.5, 0.58), opacity: 0.2, rotate: lib.radians(angle) });
  });
}

async function fillFields(lib: PdfLib, pdf: PDFDocument, fonts: Fonts, env: EnvelopeX, clean: (s: string) => string) {
  const pages = pdf.getPages();
  const inks = new Map<string, PDFImage | null>();
  const ink = async (src: string | undefined): Promise<PDFImage | null> => {
    if (!src) return null;
    if (!inks.has(src)) { try { inks.set(src, await pdf.embedPng(dataUrlBytes(src))); } catch { inks.set(src, null); } }
    return inks.get(src) ?? null;
  };
  const dark = lib.rgb(0.043, 0.106, 0.2);
  for (const f of env.fields) {
    const page = pages[f.page - 1];
    if (!page || !f.value) continue;
    const signer = env.signers.find((s) => s.id === f.signerId);
    const img = f.type === 'signature' ? await ink(signer?.signature) : f.type === 'initials' ? await ink(signer?.initials) : null;
    asShown(lib, page, ({ w: pw, h: ph }) => {
      // boxes are stored as fractions from the top left; a PDF counts from the bottom left
      const x = f.x * pw, w = f.w * pw, h = f.h * ph, y = ph - f.y * ph - h;
      if (f.type === 'signature' || f.type === 'initials') {
        if (img) { const k = Math.min(w / img.width, h / img.height); page.drawImage(img, { x: x + 1, y: y + 1, width: img.width * k, height: img.height * k }); }
        // an image that cannot be read never leaves the box empty: the typed name stands in
        else { const full = signer?.typedName || signer?.name || ''; const name = clean(f.type === 'initials' ? full.split(/\s+/).filter(Boolean).map((x) => x[0]!.toUpperCase()).slice(0, 3).join('') : full); const size = Math.max(6, Math.min(h * 0.6, 16, (w - 4) / Math.max(1, fonts.italic.widthOfTextAtSize(name, 1)))); page.drawText(name, { x: x + 2, y: y + h * 0.25, size, font: fonts.italic, color: dark }); }
      } else if (f.type === 'checkbox') {
        const p = Math.min(w, h) * 0.2;
        page.drawLine({ start: { x: x + p, y: y + p }, end: { x: x + w - p, y: y + h - p }, thickness: 1.3, color: dark });
        page.drawLine({ start: { x: x + p, y: y + h - p }, end: { x: x + w - p, y: y + p }, thickness: 1.3, color: dark });
      } else {
        let text = clean(f.value || '').replace(/\n/g, ' ');
        let size = Math.max(6, Math.min(11, h * 0.72));
        while (size > 6 && fonts.regular.widthOfTextAtSize(text, size) > w - 4) size -= 0.5;
        while (text.length > 1 && fonts.regular.widthOfTextAtSize(text, size) > w - 4) text = text.slice(0, -1);
        page.drawText(text, { x: x + 2, y: y + Math.max(2, (h - size) / 2 + size * 0.18), size, font: fonts.regular, color: dark });
      }
    });
  }
}

/**
 * Builds the signed copy of an envelope from the PDF that was sent. The envelope must carry the signers' answers.
 * A sample envelope (`demo`) gets the "not a legally binding signature" line across every page, certificate included.
 */
export async function buildSignedPdf(source: Uint8Array, env: EnvelopeX, i: SignedCopyInput): Promise<SignedCopy> {
  const lib = await pdfLib();
  const lang: Lang = i.lang ?? env.lang ?? 'en';
  const sample = !!env.demo;
  const original = await sha256Hex(source);

  // 1. the pages, with every box filled in
  const pdf = await lib.PDFDocument.load(source, { updateMetadata: false });
  const { fonts, measure } = await openFonts(lib, pdf);
  await fillFields(lib, pdf, fonts, env, cleaner(measure));
  const mark = cleaner(measure)(watermarkText(lang));
  if (sample) for (const p of pdf.getPages()) watermark(lib, p, fonts, mark);
  const filled = await pdf.save();
  const signed = await sha256Hex(filled);

  // 2. the certificate, behind them
  const out = await lib.PDFDocument.load(filled, { updateMetadata: false });
  const kit = await openFonts(lib, out);
  const first = pageFrame(out.getPages()[0]).size;
  // a certificate is always drawn upright on a page a person can read: at least as large as a half-letter sheet
  const size = { w: Math.max(396, Math.min(first.w, first.h)), h: Math.max(560, Math.max(first.w, first.h)) };
  const model = certificateModel({ ...i, env, hashes: { original, signed }, lang, sample });
  const sheets = layoutCertificate(model, kit.measure, size, lang);
  for (const sheet of sheets) {
    const page = out.addPage([sheet.w, sheet.h]);
    drawOps(lib, page, sheet.ops, kit.fonts);
    if (sample) watermark(lib, page, kit.fonts, mark);
  }
  out.setSubject(`${model.title} ${env.id}`);
  const bytes = await out.save();
  return { bytes, hashes: { original, signed, final: await sha256Hex(bytes) }, pages: out.getPageCount() };
}
