// Where a signer draws their signature or initials with a finger, a pen or the mouse, or has their typed name written
// out instead. The result is a small PNG with a clear background, cut to the ink, so it sits well in a box on the page.
import { useEffect, useRef, useState } from 'react';
import { LuEraser, LuPenLine, LuType } from 'react-icons/lu';
import { Button, Field, Modal } from '@/ui';
import type { TFn } from '@/i18n';
import type { PEvent } from './pages';

// ink on paper: fixed, like the printed document, whatever the theme
const INK = 'rgb(11,27,51)';
export const initialsOf = (name: string): string => name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 3).join('');

/** `t` is the wording in the signer's language. `onDone` gets the image and the name as typed. */
export function SignaturePad({ kind, name, t, onDone, onClose }: { kind: 'signature' | 'initials'; name: string; t: TFn; onDone: (png: string, typedName: string) => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [typed, setTyped] = useState(name);
  const [inked, setInked] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(c.clientWidth * ratio); c.height = Math.round(c.clientHeight * ratio);
    const g = c.getContext('2d'); if (!g) return;
    g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK; g.fillStyle = INK;
  }, []);
  const at = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: PEvent) => {
    const g = canvas.current?.getContext('2d'); if (!g) return;
    e.preventDefault();
    try { canvas.current!.setPointerCapture(e.pointerId); } catch { /* the stroke still works without capture */ }
    const p = at(e); drawing.current = true;
    g.beginPath(); g.arc(p.x, p.y, 1.1, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(p.x, p.y);
    setInked(true); setErr(false);
  };
  const move = (e: PEvent) => { if (!drawing.current) return; const g = canvas.current?.getContext('2d'); if (!g) return; const p = at(e); g.lineTo(p.x, p.y); g.stroke(); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvas.current; const g = c?.getContext('2d'); if (!c || !g) return; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.restore(); setInked(false); };
  /** Writes the typed name (or its initials) into the box in a handwriting-like face, as large as fits. */
  const useTyped = () => {
    const c = canvas.current; const g = c?.getContext('2d');
    const text = kind === 'initials' ? initialsOf(typed) : typed.trim();
    if (!c || !g || !text) { setErr(true); return; }
    clear();
    let size = kind === 'initials' ? 64 : 44; const w = c.clientWidth - 32;
    do { g.font = `italic ${size}px Georgia, 'Times New Roman', serif`; size -= 2; } while (g.measureText(text).width > w && size > 14);
    g.textBaseline = 'middle'; g.fillText(text, 16, c.clientHeight / 2);
    setInked(true); setErr(false);
  };
  /** The drawing as a PNG: trimmed to the ink and scaled down, so the record stays small. */
  const image = (): string => {
    const c = canvas.current!; const g = c.getContext('2d')!;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    try {
      const px = g.getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    } catch { x1 = -1; }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
    const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1; const k = Math.min(1, 520 / w, 160 / h);
    const s = document.createElement('canvas'); s.width = Math.max(1, Math.round(w * k)); s.height = Math.max(1, Math.round(h * k));
    s.getContext('2d')!.drawImage(c, x0, y0, w, h, 0, 0, s.width, s.height);
    return s.toDataURL('image/png');
  };
  const done = () => {
    if (!inked || typed.trim().length < 2) { setErr(true); return; }
    onDone(image(), typed.trim());
  };
  const label = t(kind === 'initials' ? 'esign.sign.padInitials' : 'esign.sign.pad');
  return (
    <Modal title={label} onClose={onClose} labelClose={t('esign.sign.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('esign.sign.cancel')}</Button><Button variant="primary" icon={<LuPenLine aria-hidden="true" />} onClick={done} data-testid="esign-pad-done">{t(kind === 'initials' ? 'esign.sign.useInitials' : 'esign.sign.useSignature')}</Button></>}>
      <div className="stack tight">
        <Field label={t('esign.sign.fullName')} error={err && typed.trim().length < 2}><input value={typed} onChange={(e) => { setTyped(e.target.value); setErr(false); }} autoComplete="name" data-testid="esign-pad-name" /></Field>
        <div>
          <div className="label" id="esign-pad-label">{t('esign.sign.padHint')}</div>
          <canvas ref={canvas} className="es-pad" role="img" aria-labelledby="esign-pad-label" data-testid="esign-pad" data-inked={inked ? 'yes' : 'no'} data-autofocus tabIndex={0}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} />
          <div className="es-padbar">
            <Button size="sm" icon={<LuType aria-hidden="true" />} onClick={useTyped} data-testid="esign-pad-typed">{t(kind === 'initials' ? 'esign.sign.typedInitials' : 'esign.sign.typed')}</Button>
            <Button size="sm" variant="ghost" icon={<LuEraser aria-hidden="true" />} onClick={clear} data-testid="esign-pad-clear">{t('esign.sign.clear')}</Button>
          </div>
        </div>
        {err && <p className="small neg" role="alert" data-testid="esign-pad-error">{t('esign.sign.padNeed')}</p>}
      </div>
    </Modal>
  );
}
