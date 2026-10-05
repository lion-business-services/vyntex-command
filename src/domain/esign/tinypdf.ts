// A one-page PDF with a few lines of text, written out by hand. The sample business uses it for its made-up files, so
// a sample needs no PDF library and its records carry a few lines of text, never the bytes of a file.
// Letters outside plain ASCII are written as octal escapes of the standard Western encoding.

export function tinyPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => [...s].map((ch) => { const c = ch.charCodeAt(0); return ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : c > 126 ? (c < 256 ? '\\' + c.toString(8).padStart(3, '0') : '?') : ch; }).join('');
  const text = ['BT', '/F1 12 Tf', '72 708 Td', '16 TL', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // every character is plain ASCII by now, so one character is one byte
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0));
}
