// Draws a document as a real PDF in the browser. pdf-lib is loaded only when someone asks for a PDF,
// so it stays out of the main bundle. Standard Helvetica covers English and Spanish; anything it cannot
// encode is replaced before drawing, so a stray symbol never breaks the download.
import type { DocModel, TextBlock } from './model';

type RGB = [number, number, number];
const INK: RGB = [0.086, 0.125, 0.18];
const HEAD: RGB = [0.043, 0.106, 0.2];
const MUTED: RGB = [0.33, 0.39, 0.48];
const LINE: RGB = [0.82, 0.85, 0.89];
const VOID: RGB = [0.62, 0.12, 0.16];

const W = 612, H = 792, M = 56, BOTTOM = 62, CW = W - M * 2;

/** Characters Helvetica cannot draw, by code point, and what stands in for them. */
const SWAP: Record<number, string> = {
  0x2212: '-', 0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x00a0: ' ', 0x2009: ' ', 0x200a: ' ', 0x202f: ' ', 0x2007: ' ',
  0x2192: '->', 0x2190: '<-', 0x2713: 'x', 0x2714: 'x', 0x2605: '*', 0x09: '    ',
};
const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

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

export async function buildPdf(model: DocModel): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  type Font = typeof regular;
  const charset = new Set(regular.getCharacterSet());
  const col = (c: RGB) => rgb(c[0], c[1], c[2]);

  /** Keeps only what Helvetica can draw: accents stay, anything else is swapped for a close match or dropped. */
  const clean = (s: string): string => {
    let out = '';
    for (const ch of String(s ?? '').normalize('NFC')) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n') { out += ch; continue; }
      if (SWAP[cp] !== undefined) { out += SWAP[cp]; continue; }
      if (cp < 32 || cp === 0x7f) continue;
      if (charset.has(cp)) { out += ch; continue; }
      const plain = ch.normalize('NFD').replace(COMBINING, '');
      if (plain && plain !== ch && [...plain].every((c) => charset.has(c.codePointAt(0)!))) { out += plain; continue; }
      if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0xfe0f || cp === 0x200d || cp === 0x200b || (cp >= 0x300 && cp <= 0x36f)) continue;
      out += '?';
    }
    return out;
  };
  const width = (s: string, f: Font, size: number) => { try { return f.widthOfTextAtSize(s, size); } catch { return s.length * size * 0.5; } };

  /** Breaks text into lines that fit, keeping the line breaks the person typed. */
  const wrap = (text: string, f: Font, size: number, max: number): string[] => {
    const lines: string[] = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (let word of para.split(/ +/)) {
        while (width(word, f, size) > max) {
          let n = word.length;
          while (n > 1 && width((line ? line + ' ' : '') + word.slice(0, n), f, size) > max) n--;
          if (line && n <= 1) { lines.push(line); line = ''; continue; }
          lines.push((line ? line + ' ' : '') + word.slice(0, n)); line = ''; word = word.slice(n);
        }
        const next = line ? line + ' ' + word : word;
        if (width(next, f, size) > max && line) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    return lines;
  };

  let page = pdf.addPage([W, H]);
  let y = H - M;
  const need = (h: number) => { if (y - h < BOTTOM) { page = pdf.addPage([W, H]); y = H - M; } };
  const put = (s: string, x: number, yy: number, f: Font, size: number, c: RGB) => { if (s) page.drawText(s, { x, y: yy, font: f, size, color: col(c) }); };
  const putRight = (s: string, right: number, yy: number, f: Font, size: number, c: RGB) => put(s, right - width(s, f, size), yy, f, size, c);
  const rule = (yy: number, c: RGB, thickness = 0.7, x1 = M, x2 = W - M) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color: col(c) });
  /** Draws wrapped lines down from the cursor, moving to a new page when the current one is full. */
  const para = (text: string, f: Font, size: number, c: RGB, lead: number, x = M, max = CW) => {
    for (const line of wrap(text, f, size, max)) { need(lead); y -= lead; put(line, x, y, f, size, c); }
  };

  /* ---------- letterhead ---------- */
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (model.company.logo) {
    try {
      // always re-drawn by the browser first: a damaged upload is skipped instead of reaching the PDF writer
      const png = await rasterize(model.company.logo, 480);
      if (png) logo = await pdf.embedPng(png);
    } catch { logo = null; }
  }
  const top = y;
  const rightW = 210;
  let leftX = M;
  let leftBottom = top;
  if (logo) {
    const s = Math.min(100 / logo.width, 46 / logo.height, 1);
    const lw = logo.width * s, lh = logo.height * s;
    page.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh });
    leftX = M + lw + 12; leftBottom = top - lh;
  }
  const leftW = W - M - rightW - 16 - leftX;
  let ly = top;
  for (const line of wrap(model.company.name, bold, 12.5, leftW)) { ly -= 15; put(line, leftX, ly, bold, 12.5, HEAD); }
  // a contact line that does not fit is split at its separators, so a phone or an email is never cut in half
  const contact = model.company.lines.flatMap((raw) => (width(clean(raw), regular, 9) > leftW ? raw.split(' \u00b7 ') : [raw]));
  for (const raw of contact) for (const line of wrap(raw, regular, 9, leftW)) { ly -= 12; put(line, leftX, ly, regular, 9, MUTED); }
  let ry = top;
  for (const line of wrap(model.title.text, bold, 15, rightW)) { ry -= 17; putRight(line, W - M, ry, bold, 15, HEAD); }
  ry -= 3;
  for (const raw of model.meta) { ry -= 12; putRight(clean(raw), W - M, ry, regular, 9, MUTED); }
  y = Math.min(ly, ry, leftBottom) - 12;
  rule(y, HEAD, 1.4);
  y -= 8;

  /* ---------- body ---------- */
  const drawText = (b: TextBlock) => {
    if (b.style === 'h') { y -= 9; need(15 + 30); para(b.text, bold, 10.5, HEAD, 15); y -= 1; }
    else if (b.style === 'strong') { para(b.text, bold, 10.5, INK, 15); y -= 2; }
    else if (b.style === 'small') { para(b.text, regular, 8.5, MUTED, 12); y -= 3; }
    else { para(b.text, regular, 10, INK, 14.2); y -= 5; }
  };

  for (const b of model.blocks) {
    if (b.t === 'text') drawText(b);
    else if (b.t === 'cols') {
      const gap = 24, cw = (CW - gap) / 2;
      const cells = b.cols.map((c) => ({ head: clean(c.head), lines: wrap(c.body.text, regular, 10, cw) }));
      const rows = Math.max(...cells.map((c) => c.lines.length));
      y -= 6; need(16 + rows * 13.6);
      const start = y;
      cells.forEach((c, i) => {
        const x = M + i * (cw + gap); let yy = start - 13;
        put(c.head, x, yy, bold, 9.5, HEAD);
        for (const line of c.lines) { yy -= 13.6; put(line, x, yy, regular, 10, INK); }
      });
      y = start - 13 - rows * 13.6 - 8;
    } else if (b.t === 'table') {
      y -= 10; rule(y, LINE);
      for (const r of b.rows) {
        const total = r.kind === 'total';
        const f = total ? bold : regular; const size = total ? 11 : 10;
        const lines = wrap(r.label, f, size, CW - 130);
        const h = lines.length * 13.6 + 10;
        need(h);
        if (total) rule(y, HEAD, 1.2);
        let yy = y - 4;
        lines.forEach((line, i) => { yy -= 13.6; put(line, M, yy, f, size, total ? HEAD : INK); if (i === 0) putRight((r.kind === 'minus' ? '-' : '') + clean(r.amount), W - M, yy, f, size, total ? HEAD : INK); });
        y -= h;
        rule(y, total ? HEAD : LINE, total ? 1.2 : 0.7);
      }
      if (b.paidNote) { need(16); y -= 15; putRight(clean(b.paidNote), W - M, y, bold, 9.5, HEAD); }
      y -= 8;
    } else if (b.t === 'sign') {
      const gap = 30, cw = (CW - gap) / 2;
      const tall = 118;
      y -= 14; need(tall);
      const start = y;
      for (let i = 0; i < b.parties.length; i++) {
        const p = b.parties[i]; const x = M + i * (cw + gap); const lineY = start - 52;
        if (p.signed?.image) {
          try {
            const src = await rasterize(p.signed.image, 640);
            if (src) { const img = await pdf.embedPng(src); const s = Math.min((cw - 20) / img.width, 44 / img.height); page.drawImage(img, { x: x + 4, y: lineY + 3, width: img.width * s, height: img.height * s }); }
            else put(wrap(p.signed.name, italic, 14, cw - 8)[0] ?? '', x + 4, lineY + 8, italic, 14, HEAD);
          } catch { put(wrap(p.signed.name, italic, 14, cw - 8)[0] ?? '', x + 4, lineY + 8, italic, 14, HEAD); }
        } else if (p.signed) put(wrap(p.signed.name, italic, 14, cw - 8)[0] ?? '', x + 4, lineY + 8, italic, 14, HEAD);
        rule(lineY, INK, 0.8, x, x + cw);
        let yy = lineY;
        for (const line of wrap(p.label, regular, 9.5, cw)) { yy -= 13; put(line, x, yy, regular, 9.5, INK); }
        if (p.signed) {
          if (p.signed.image && p.signed.name) { yy -= 12.5; put(wrap(p.signed.name, regular, 9.5, cw)[0] ?? '', x, yy, regular, 9.5, INK); }
          yy -= 12.5; put(clean(`${p.dateLabel}: ${p.signed.date}`), x, yy, regular, 9.5, INK);
          for (const line of wrap(p.signed.note, bold, 8.5, cw)) { yy -= 11.5; put(line, x, yy, bold, 8.5, MUTED); }
        } else { yy -= 14; put(clean(`${p.dateLabel}: ________________`), x, yy, regular, 9.5, INK); }
      }
      y = start - tall;
    } else if (b.t === 'notice') {
      const isVoid = b.tone === 'void';
      const lines = wrap(b.text, isVoid ? bold : regular, 9.5, CW - 28);
      const h = lines.length * 13 + 16;
      y -= 10; need(h + 4);
      page.drawRectangle({ x: M, y: y - h, width: CW, height: h, borderColor: col(isVoid ? VOID : MUTED), borderWidth: isVoid ? 1.4 : 0.9, color: rgb(0.97, 0.975, 0.985) });
      page.drawRectangle({ x: M, y: y - h, width: 4, height: h, color: col(isVoid ? VOID : MUTED) });
      let yy = y - 6;
      for (const line of lines) { yy -= 13; put(line, M + 16, yy, isVoid ? bold : regular, 9.5, isVoid ? VOID : INK); }
      y -= h + 6;
    }
  }

  /* ---------- footer on every page ---------- */
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    rule(42, LINE, 0.6);
    put(clean(`${model.company.name} · ${model.number}`), M, 30, regular, 8, MUTED);
    putRight(clean(model.pageLabel(i + 1, pages.length)), W - M, 30, regular, 8, MUTED);
  });

  pdf.setTitle(clean(`${model.title.text} ${model.number}`));
  pdf.setAuthor(clean(model.company.name));
  pdf.setLanguage(model.lang === 'es' ? 'es-US' : 'en-US');
  return pdf.save();
}

/** Hands a finished file to the browser's download. */
export function saveFile(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
