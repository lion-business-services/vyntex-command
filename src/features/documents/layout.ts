// Lays a document out on letter-size pages as a list of drawing steps per page. No browser and no PDF library here: the
// widths come from whoever calls. The PDF writer (pdf.ts) and the on-screen pages of the signature screens (paint.ts)
// both draw this same list, so a box placed on the screen lands on the same spot in the file.
// It also reports where the signature lines ended up, so signature boxes can be placed on them automatically.
import type { DocModel, TextBlock } from './model';
import type { DrawOp, FontId, PageView, RGB } from '@/domain/esign/types';
import type { SignAnchor } from '@/domain/esign/envelope';
import { cleaner, wrapper, type Measure } from '@/domain/esign/text';

const INK: RGB = [0.086, 0.125, 0.18];
const HEAD: RGB = [0.043, 0.106, 0.2];
const MUTED: RGB = [0.33, 0.39, 0.48];
const LINE: RGB = [0.82, 0.85, 0.89];
const VOID: RGB = [0.62, 0.12, 0.16];
const PAPER: RGB = [0.97, 0.975, 0.985];

export const PAGE_W = 612, PAGE_H = 792;
const W = PAGE_W, H = PAGE_H, M = 56, BOTTOM = 62, CW = W - M * 2;

/** Pixel size of each picture the document uses: `logo`, and `sig<block>:<party>` for a signature drawn in the one-signer demo. */
export type ImageSizes = Record<string, { w: number; h: number }>;
export interface DocLayout { pages: PageView[]; anchors: SignAnchor[] }
export const sigKey = (block: number, party: number) => `sig${block}:${party}`;

export function layoutDoc(model: DocModel, m: Measure, images: ImageSizes = {}): DocLayout {
  const clean = cleaner(m); const wrap = wrapper(m);
  const width = (s: string, f: FontId, size: number) => m.width(s, f, size);
  const pages: PageView[] = []; const anchors: SignAnchor[] = [];
  let ops: DrawOp[] = []; let y = 0;
  const open = () => { ops = []; pages.push({ w: W, h: H, ops }); y = H - M; };
  const need = (h: number) => { if (y - h < BOTTOM) open(); };
  const put = (s: string, x: number, yy: number, f: FontId, size: number, c: RGB) => { if (s) ops.push({ t: 'text', x, y: yy, s, f, size, c }); };
  const putRight = (s: string, right: number, yy: number, f: FontId, size: number, c: RGB) => put(s, right - width(s, f, size), yy, f, size, c);
  const rule = (yy: number, c: RGB, thickness = 0.7, x1 = M, x2 = W - M) => ops.push({ t: 'line', x1, y1: yy, x2, y2: yy, w: thickness, c });
  /** Draws wrapped lines down from the cursor, moving to a new page when the current one is full. */
  const para = (text: string, f: FontId, size: number, c: RGB, lead: number, x = M, max = CW) => {
    for (const line of wrap(text, f, size, max)) { need(lead); y -= lead; put(line, x, y, f, size, c); }
  };
  open();

  /* ---------- letterhead ---------- */
  const logo = images.logo;
  const top = y;
  const rightW = 210;
  let leftX = M;
  let leftBottom = top;
  if (logo) {
    const s = Math.min(100 / logo.w, 46 / logo.h, 1);
    const lw = logo.w * s, lh = logo.h * s;
    ops.push({ t: 'img', x: M, y: top - lh, w: lw, h: lh, key: 'logo' });
    leftX = M + lw + 12; leftBottom = top - lh;
  }
  const leftW = W - M - rightW - 16 - leftX;
  let ly = top;
  for (const line of wrap(model.company.name, 'bold', 12.5, leftW)) { ly -= 15; put(line, leftX, ly, 'bold', 12.5, HEAD); }
  // a contact line that does not fit is split at its separators, so a phone or an email is never cut in half
  const contact = model.company.lines.flatMap((raw) => (width(clean(raw), 'regular', 9) > leftW ? raw.split(' · ') : [raw]));
  for (const raw of contact) for (const line of wrap(raw, 'regular', 9, leftW)) { ly -= 12; put(line, leftX, ly, 'regular', 9, MUTED); }
  let ry = top;
  for (const line of wrap(model.title.text, 'bold', 15, rightW)) { ry -= 17; putRight(line, W - M, ry, 'bold', 15, HEAD); }
  ry -= 3;
  for (const raw of model.meta) { ry -= 12; putRight(clean(raw), W - M, ry, 'regular', 9, MUTED); }
  y = Math.min(ly, ry, leftBottom) - 12;
  rule(y, HEAD, 1.4);
  y -= 8;

  /* ---------- body ---------- */
  const drawText = (b: TextBlock) => {
    if (b.style === 'h') { y -= 9; need(15 + 30); para(b.text, 'bold', 10.5, HEAD, 15); y -= 1; }
    else if (b.style === 'strong') { para(b.text, 'bold', 10.5, INK, 15); y -= 2; }
    else if (b.style === 'small') { para(b.text, 'regular', 8.5, MUTED, 12); y -= 3; }
    // a list: one item per line, set in from the margin with a short rule in front
    else if (b.style === 'list') {
      for (const item of b.text.split('\n').filter((x) => x.trim())) {
        const lines = wrap(item, 'regular', 10, CW - 14);
        lines.forEach((line, i) => { need(14.2); y -= 14.2; if (i === 0) ops.push({ t: 'line', x1: M + 1, y1: y + 3.4, x2: M + 6, y2: y + 3.4, w: 0.9, c: MUTED }); put(line, M + 14, y, 'regular', 10, INK); });
      }
      y -= 5;
    }
    else { para(b.text, 'regular', 10, INK, 14.2); y -= 5; }
  };

  model.blocks.forEach((b, bi) => {
    if (b.t === 'text') drawText(b);
    else if (b.t === 'cols') {
      const gap = 24, cw = (CW - gap) / 2;
      const cells = b.cols.map((c) => ({ head: clean(c.head), lines: wrap(c.body.text, 'regular', 10, cw) }));
      const rows = Math.max(...cells.map((c) => c.lines.length));
      y -= 6; need(16 + rows * 13.6);
      const start = y;
      cells.forEach((c, i) => {
        const x = M + i * (cw + gap); let yy = start - 13;
        put(c.head, x, yy, 'bold', 9.5, HEAD);
        for (const line of c.lines) { yy -= 13.6; put(line, x, yy, 'regular', 10, INK); }
      });
      y = start - 13 - rows * 13.6 - 8;
    } else if (b.t === 'table') {
      y -= 10; rule(y, LINE);
      for (const r of b.rows) {
        const total = r.kind === 'total';
        const f: FontId = total ? 'bold' : 'regular'; const size = total ? 11 : 10;
        const lines = wrap(r.label, f, size, CW - 130);
        const h = lines.length * 13.6 + 10;
        need(h);
        if (total) rule(y, HEAD, 1.2);
        let yy = y - 4;
        lines.forEach((line, i) => { yy -= 13.6; put(line, M, yy, f, size, total ? HEAD : INK); if (i === 0) putRight((r.kind === 'minus' ? '-' : '') + clean(r.amount), W - M, yy, f, size, total ? HEAD : INK); });
        y -= h;
        rule(y, total ? HEAD : LINE, total ? 1.2 : 0.7);
      }
      if (b.paidNote) { need(16); y -= 15; putRight(clean(b.paidNote), W - M, y, 'bold', 9.5, HEAD); }
      y -= 8;
    } else if (b.t === 'sign') {
      const gap = 30, cw = (CW - gap) / 2;
      const tall = 118;
      y -= 14; need(tall);
      const start = y; const page = pages.length;
      b.parties.forEach((p, i) => {
        const x = M + i * (cw + gap); const lineY = start - 52;
        const img = images[sigKey(bi, i)];
        const name = () => put(wrap(p.signed!.name, 'italic', 14, cw - 8)[0] ?? '', x + 4, lineY + 8, 'italic', 14, HEAD);
        if (p.signed?.image && img) { const s = Math.min((cw - 20) / img.w, 44 / img.h); ops.push({ t: 'img', x: x + 4, y: lineY + 3, w: img.w * s, h: img.h * s, key: sigKey(bi, i) }); }
        else if (p.signed) name();
        rule(lineY, INK, 0.8, x, x + cw);
        let yy = lineY;
        for (const line of wrap(p.label, 'regular', 9.5, cw)) { yy -= 13; put(line, x, yy, 'regular', 9.5, INK); }
        if (p.signed) {
          if (p.signed.image && p.signed.name) { yy -= 12.5; put(wrap(p.signed.name, 'regular', 9.5, cw)[0] ?? '', x, yy, 'regular', 9.5, INK); }
          yy -= 12.5; put(clean(`${p.dateLabel}: ${p.signed.date}`), x, yy, 'regular', 9.5, INK);
          for (const line of wrap(p.signed.note, 'bold', 8.5, cw)) { yy -= 11.5; put(line, x, yy, 'bold', 8.5, MUTED); }
        } else {
          yy -= 14; put(clean(`${p.dateLabel}: ________________`), x, yy, 'regular', 9.5, INK);
          // where a signature box and its date box belong, as fractions of the page from the top left
          const dx = x + width(clean(p.dateLabel + ': '), 'regular', 9.5);
          anchors.push({ page, role: p.signer, kind: 'signature', x: x / W, y: (H - (lineY + 48)) / H, w: cw / W, h: 46 / H });
          anchors.push({ page, role: p.signer, kind: 'date', x: dx / W, y: (H - (yy + 11)) / H, w: Math.min(120, x + cw - dx) / W, h: 14 / H });
        }
      });
      y = start - tall;
    } else if (b.t === 'notice') {
      const isVoid = b.tone === 'void';
      const lines = wrap(b.text, isVoid ? 'bold' : 'regular', 9.5, CW - 28);
      const h = lines.length * 13 + 16;
      y -= 10; need(h + 4);
      ops.push({ t: 'rect', x: M, y: y - h, w: CW, h, fill: PAPER, stroke: isVoid ? VOID : MUTED, sw: isVoid ? 1.4 : 0.9 });
      ops.push({ t: 'rect', x: M, y: y - h, w: 4, h, fill: isVoid ? VOID : MUTED });
      let yy = y - 6;
      for (const line of lines) { yy -= 13; put(line, M + 16, yy, isVoid ? 'bold' : 'regular', 9.5, isVoid ? VOID : INK); }
      y -= h + 6;
    }
  });

  /* ---------- footer on every page ---------- */
  pages.forEach((p, i) => {
    ops = p.ops;
    rule(42, LINE, 0.6);
    put(clean(`${model.company.name} · ${model.number}`), M, 30, 'regular', 8, MUTED);
    putRight(clean(model.pageLabel(i + 1, pages.length)), W - M, 30, 'regular', 8, MUTED);
  });
  return { pages, anchors };
}
