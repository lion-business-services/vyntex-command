// The completion certificate: the page added behind a signed document. It lists what was recorded and nothing else:
// the document, two fingerprints, and for every signer the name, the email address, when their link went out, when they
// opened it, when they signed, and the consent they ticked. It makes no statement about any law.
import type { ISODateTime, Lang } from '../types';
import type { DrawOp, EnvelopeX, PageSize, PageView, RGB } from './types';
import { type Measure, wrapper } from './text';

export interface CertRow { label: string; value: string; mono?: boolean }
export interface CertificateModel {
  title: string;
  rows: CertRow[];
  signers: { heading: string; rows: CertRow[] }[];
  /** What this page is, in one sentence. */
  note: string;
  /** Present on a sample: says plainly that nothing was sent and nothing is legally signed. */
  sample?: string;
  footer: string;
}
export interface CertificateInput {
  env: EnvelopeX;
  docTitle: string;
  docNumber?: string;
  company: string;
  /** Name of the person who sent the request. */
  sentBy?: string;
  /** Product the record was made with, e.g. "VYNTEX Command". */
  product: string;
  hashes: { original: string; signed: string };
  lang: Lang;
  sample: boolean;
}

const L = {
  en: {
    title: 'Completion certificate', doc: 'Document', number: 'Document number', id: 'Request ID', company: 'Sent by', order: 'Signing order', seq: 'One after another', par: 'Everyone at the same time',
    sent: 'Sent', completed: 'Completed', original: 'Original file, SHA-256', signed: 'Signed pages, SHA-256', signedNote: 'The fingerprint of the signed pages was taken with every box filled in, before this certificate page was added.',
    signer: 'Signer', name: 'Name', typed: 'Name typed when signing', email: 'Email', role: 'Signs as', linkSent: 'Link made available', viewed: 'Opened', signedAt: 'Signed', consent: 'Consent',
    consentYes: (at: string) => `Ticked the consent box on ${at}.`, consentText: 'Sentence shown', notRecorded: 'Not recorded',
    note: (p: string) => `This page lists what ${p} recorded for this signature request. It makes no statement about legal effect.`,
    sample: 'Sample record. No message was sent to anyone and nothing here is a legally binding signature.', watermark: 'Sample: not a legally binding signature',
    page: (n: number, t: number) => `Certificate page ${n} of ${t}`,
    roles: { client: 'Client', co_owner: 'Co-owner', spouse: 'Spouse', firm: 'Company representative' } as Record<string, string>,
  },
  es: {
    title: 'Certificado de finalización', doc: 'Documento', number: 'Número de documento', id: 'ID de la solicitud', company: 'Enviado por', order: 'Orden de firma', seq: 'Uno después de otro', par: 'Todos al mismo tiempo',
    sent: 'Enviado', completed: 'Completado', original: 'Archivo original, SHA-256', signed: 'Páginas firmadas, SHA-256', signedNote: 'La huella de las páginas firmadas se tomó con todos los campos llenos, antes de agregar esta página de certificado.',
    signer: 'Firmante', name: 'Nombre', typed: 'Nombre escrito al firmar', email: 'Correo', role: 'Firma como', linkSent: 'Enlace disponible', viewed: 'Abierto', signedAt: 'Firmado', consent: 'Consentimiento',
    consentYes: (at: string) => `Marcó la casilla de consentimiento el ${at}.`, consentText: 'Frase mostrada', notRecorded: 'Sin registro',
    note: (p: string) => `Esta página enumera lo que ${p} registró para esta solicitud de firma. No afirma nada sobre su efecto legal.`,
    sample: 'Registro de muestra. No se envió ningún mensaje a nadie y nada aquí es una firma con validez legal.', watermark: 'Muestra: no es una firma con validez legal',
    page: (n: number, t: number) => `Página ${n} de ${t} del certificado`,
    roles: { client: 'Cliente', co_owner: 'Copropietario', spouse: 'Cónyuge', firm: 'Representante de la empresa' } as Record<string, string>,
  },
};
const words = (lang: Lang) => (lang === 'es' ? L.es : L.en);
/** Label of a signer's role in a language; a role the company typed itself is shown as typed. */
export const roleLabel = (role: string | undefined, lang: Lang): string => (role ? words(lang).roles[role] ?? role : '');
export const watermarkText = (lang: Lang): string => words(lang).watermark;
/** A moment written so it cannot be misread: 2026-03-04 15:07:22 UTC. */
export const utcStamp = (iso?: ISODateTime): string => { const d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : ''; };

export function certificateModel(i: CertificateInput): CertificateModel {
  const t = words(i.lang); const e = i.env;
  const at = (iso?: ISODateTime) => utcStamp(iso) || t.notRecorded;
  const rows: CertRow[] = [
    { label: t.doc, value: i.docTitle },
    ...(i.docNumber ? [{ label: t.number, value: i.docNumber }] : []),
    { label: t.id, value: e.id },
    { label: t.company, value: [i.company, i.sentBy].filter(Boolean).join(' · ') },
    { label: t.order, value: e.ordered && e.signers.length > 1 ? t.seq : t.par },
    { label: t.sent, value: at(e.sentAt) },
    { label: t.completed, value: at(e.completedAt) },
    { label: t.original, value: i.hashes.original, mono: true },
    { label: t.signed, value: i.hashes.signed, mono: true },
  ];
  const signers = [...e.signers].sort((a, b) => a.order - b.order).map((s, n) => ({
    heading: `${t.signer} ${n + 1}`,
    rows: [
      { label: t.name, value: s.name },
      ...(s.typedName && s.typedName !== s.name ? [{ label: t.typed, value: s.typedName }] : []),
      { label: t.email, value: s.email },
      ...(s.role ? [{ label: t.role, value: roleLabel(s.role, i.lang) }] : []),
      { label: t.linkSent, value: at(s.sentAt) },
      { label: t.viewed, value: at(s.viewedAt) },
      { label: t.signedAt, value: at(s.signedAt) },
      { label: t.consent, value: s.consent ? t.consentYes(at(s.consentAt ?? s.signedAt)) : t.notRecorded },
    ] as CertRow[],
  }));
  if (e.consentText) rows.push({ label: t.consentText, value: e.consentText });
  return { title: t.title, rows, signers, note: `${t.note(i.product)} ${t.signedNote}`, sample: i.sample ? t.sample : undefined, footer: `${i.company} · ${e.id}` };
}

const INK: RGB = [0.086, 0.125, 0.18];
const HEAD: RGB = [0.043, 0.106, 0.2];
const MUTED: RGB = [0.33, 0.39, 0.48];
const LINE: RGB = [0.82, 0.85, 0.89];

/** Lays the certificate out on pages of the given size. Returns the drawing of each page. */
export function layoutCertificate(model: CertificateModel, m: Measure, size: PageSize, lang: Lang): PageView[] {
  const wrap = wrapper(m);
  const W = size.w, H = size.h, M = Math.min(56, W * 0.09), CW = W - M * 2, labelW = Math.min(150, CW * 0.32);
  const pages: PageView[] = [];
  let ops: DrawOp[] = []; let y = 0;
  const open = () => { ops = []; pages.push({ w: W, h: H, ops }); y = H - M; };
  const need = (h: number) => { if (y - h < 58) open(); };
  const text = (s: string, x: number, yy: number, f: 'regular' | 'bold', sz: number, c: RGB) => { if (s) ops.push({ t: 'text', x, y: yy, s, f, size: sz, c }); };
  const rule = (yy: number, c: RGB, w = 0.7) => ops.push({ t: 'line', x1: M, y1: yy, x2: W - M, y2: yy, w, c });
  const row = (r: CertRow) => {
    // a fingerprint is 64 characters: small enough to stay on one line, so it can be compared by eye
    const sz = r.mono ? Math.min(9, (CW - labelW) / 36) : 9.5;
    const lines = wrap(r.value, 'regular', sz, CW - labelW);
    const label = wrap(r.label, 'bold', 9, labelW - 10);
    const n = Math.max(lines.length, label.length);
    need(n * 12.5 + 6);
    let yy = y;
    label.forEach((s, k) => text(s, M, y - 12.5 * (k + 1), 'bold', 9, HEAD));
    for (const s of lines) { yy -= 12.5; text(s, M + labelW, yy, 'regular', sz, INK); }
    y -= n * 12.5 + 6;
  };
  open();
  y -= 20; text(wrap(model.title, 'bold', 17, CW)[0] ?? '', M, y, 'bold', 17, HEAD);
  y -= 12; rule(y, HEAD, 1.4); y -= 8;
  if (model.sample) { for (const s of wrap(model.sample, 'bold', 9.5, CW)) { y -= 13; text(s, M, y, 'bold', 9.5, HEAD); } y -= 8; }
  for (const r of model.rows) row(r);
  for (const s of model.signers) {
    need(13 * 4 + 30);
    y -= 8; rule(y, LINE); y -= 18; text(s.heading, M, y, 'bold', 11, HEAD); y -= 6;
    for (const r of s.rows) row(r);
  }
  const note = wrap(model.note, 'regular', 8.5, CW);
  need(note.length * 11.5 + 20);
  y -= 10; rule(y, LINE); y -= 4;
  for (const s of note) { y -= 11.5; text(s, M, y, 'regular', 8.5, MUTED); }
  const t = words(lang);
  pages.forEach((p, k) => {
    p.ops.push({ t: 'line', x1: M, y1: 42, x2: W - M, y2: 42, w: 0.6, c: LINE });
    const foot = wrap(model.footer, 'regular', 8, CW - 150)[0] ?? '';
    p.ops.push({ t: 'text', x: M, y: 30, s: foot, f: 'regular', size: 8, c: MUTED });
    const label = wrap(t.page(k + 1, pages.length), 'regular', 8, 150)[0] ?? '';
    p.ops.push({ t: 'text', x: W - M - m.width(label, 'regular', 8), y: 30, s: label, f: 'regular', size: 8, c: MUTED });
  });
  return pages;
}
