// Text for a PDF page: what the standard font can draw, and where lines break. Pure: the widths come from whoever calls
// (the PDF writer's own font tables), so the same code lays out a document, a certificate and a field value.
import type { FontId } from './types';

/** How wide a text is in a font, and whether the font has a character at all. */
export interface Measure { width(s: string, f: FontId, size: number): number; has(codePoint: number): boolean }

/** Characters Helvetica cannot draw, by code point, and what stands in for them. */
const SWAP: Record<number, string> = {
  0x2212: '-', 0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x00a0: ' ', 0x2009: ' ', 0x200a: ' ', 0x202f: ' ', 0x2007: ' ',
  0x2192: '->', 0x2190: '<-', 0x2713: 'x', 0x2714: 'x', 0x2605: '*', 0x09: '    ',
};
const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

/** Keeps only what the font can draw: accents stay, anything else is swapped for a close match or dropped. */
export function cleaner(m: Measure): (s: string) => string {
  return (s) => {
    let out = '';
    for (const ch of String(s ?? '').normalize('NFC')) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n') { out += ch; continue; }
      if (SWAP[cp] !== undefined) { out += SWAP[cp]; continue; }
      if (cp < 32 || cp === 0x7f) continue;
      if (m.has(cp)) { out += ch; continue; }
      const plain = ch.normalize('NFD').replace(COMBINING, '');
      if (plain && plain !== ch && [...plain].every((c) => m.has(c.codePointAt(0)!))) { out += plain; continue; }
      if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0xfe0f || cp === 0x200d || cp === 0x200b || (cp >= 0x300 && cp <= 0x36f)) continue;
      out += '?';
    }
    return out;
  };
}

/** Breaks text into lines that fit, keeping the line breaks the person typed. A word longer than the line is cut. */
export function wrapper(m: Measure): (text: string, f: FontId, size: number, max: number) => string[] {
  const clean = cleaner(m);
  return (text, f, size, max) => {
    const lines: string[] = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (let word of para.split(/ +/)) {
        while (m.width(word, f, size) > max) {
          let n = word.length;
          while (n > 1 && m.width((line ? line + ' ' : '') + word.slice(0, n), f, size) > max) n--;
          if (line && n <= 1) { lines.push(line); line = ''; continue; }
          lines.push((line ? line + ' ' : '') + word.slice(0, n)); line = ''; word = word.slice(n);
        }
        const next = line ? line + ' ' + word : word;
        if (m.width(next, f, size) > max && line) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    return lines;
  };
}
