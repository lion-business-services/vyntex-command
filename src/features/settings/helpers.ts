// Small helpers for Settings: initials, logo downscaling, colour readability, the email sending rule and the data download.
import type { IndustryId, Lang } from '@/domain/types';
import type { TFn } from '@/i18n';
import { PRICING_RULES } from '@/lib/pricing';
import { RULE_COPY } from '@/lib/pricing-copy';
import { publicRules } from '@/lib/pricing-view';

const SKIP = new Set(['llc', 'inc', 'corp', 'co', 'ltd', 'the', 'and', 'of', 'y', 'de', 'la', 'el', 'los', 'las', 'del', 'sa', 'srl']);
/** "Rivera Hauling LLC" -> "RH". Two letters from the first two meaningful words; one word gives its first two letters. */
export function suggestInitials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !SKIP.has(w.toLowerCase()));
  if (!parts.length) return '';
  const out = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return out.toUpperCase();
}

/* ---------- logo ---------- */
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;
export const LOGO_SIDE = 256;
export type LogoProblem = 'type' | 'size' | 'read';

/** Reads an image chosen by the person, scales it down to at most 256 pixels on its longer side and returns it as a PNG data URL. Rejects with a LogoProblem. */
export function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject('type' satisfies LogoProblem); return; }
    if (file.size > MAX_LOGO_BYTES) { reject('size' satisfies LogoProblem); return; }
    const reader = new FileReader();
    reader.onerror = () => reject('read' satisfies LogoProblem);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject('read' satisfies LogoProblem);
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || LOGO_SIDE; const h0 = img.naturalHeight || LOGO_SIDE;
          const scale = Math.min(1, LOGO_SIDE / Math.max(w0, h0));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w0 * scale)); canvas.height = Math.max(1, Math.round(h0 * scale));
          const ctx = canvas.getContext('2d'); if (!ctx) { reject('read' satisfies LogoProblem); return; }
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch { reject('read' satisfies LogoProblem); }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- accent colour ---------- */
/** Mid-tone colours that stay readable with light and with dark text, so they work in both appearances. */
export const ACCENT_PRESETS = ['#E8590C', '#E03131', '#D6336C', '#7048E8', '#1C7ED6', '#0CA678', '#2F9E44', '#B08900'];
export const isHex = (v: string | undefined): v is string => !!v && /^#[0-9a-f]{6}$/i.test(v);
/** The same three variables the workspace frame sets from the saved accent colour. */
export const accentVars = (accent: string) => ({ '--accent': accent, '--accent-soft': accent + '22', '--accent-line': accent + '66' });
/** A design token as written in the stylesheet (the brand default, whatever accent the workspace currently overrides it with). */
export function rootToken(name: string): string {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch { return ''; }
}
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim()); if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contrast ratio between two hex colours (1 to 21), or null when either is not a plain hex colour. */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b); if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
/** True when button text on the colour, or the colour on the page background, would be hard to read in the current appearance. */
export function hardToRead(accent: string): boolean {
  const onButton = contrast(accent, rootToken('--accent-ink')); const onPage = contrast(accent, rootToken('--surface'));
  return (onButton !== null && onButton < 3) || (onPage !== null && onPage < 3);
}

/* ---------- pricing rule about email sending ---------- */
/** The customer-facing rule about automatic emails and the sending domain, worded from the pricing file. */
export function emailSendingRule(industry: IndustryId, lang: Lang, t: TFn): string | null {
  const shown = PRICING_RULES.filter((r) => !RULE_COPY.find((c) => c.source === r)?.internal);
  const at = shown.findIndex((r) => RULE_COPY.find((c) => c.source === r)?.key === 'price.r.emails');
  return at >= 0 ? publicRules(industry, lang, t)[at] ?? null : null;
}

/* ---------- download ---------- */
export function downloadFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
