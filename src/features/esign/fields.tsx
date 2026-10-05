// Placing the boxes a signer fills in: signature, initials, date, text and checkbox. Pick a signer, then press a box type
// (it lands on the page being worked on) or drag it onto a page. A box is moved by dragging or with the arrow keys,
// resized from its corner or with Alt and the arrow keys, and removed with Delete. Positions are kept as fractions of the
// page, so they mean the same on a phone, on a monitor and in the PDF.
import { useEffect, useRef, useState } from 'react';
import { LuCalendarDays, LuSignature, LuSquareCheck, LuTextCursorInput, LuTrash2, LuType, LuWandSparkles } from 'react-icons/lu';
import { Button, Card, Field, Note, cx } from '@/ui';
import { useApp } from '@/app/hooks';
import type { SignField } from '@/domain/types';
import type { EnvelopeX, PageSize, PageView } from '@/domain/esign/types';
import { autoPlace, clampField, fieldSize, signerIndex, type SignAnchor } from '@/domain/esign/envelope';
import { roleLabel } from '@/domain/esign/certificate';
import { uid } from '@/lib/id';
import { PageSheet, setViewerOff, viewerPossible, type PEvent, type PageMode } from './pages';

type FieldType = SignField['type'];
const TOOLS: { type: FieldType; icon: typeof LuSignature }[] = [
  { type: 'signature', icon: LuSignature }, { type: 'initials', icon: LuType }, { type: 'date', icon: LuCalendarDays }, { type: 'text', icon: LuTextCursorInput }, { type: 'checkbox', icon: LuSquareCheck },
];
const round = (n: number) => Math.round(n * 10000) / 10000;
const pct = (n: number) => Math.round(n * 1000) / 10;

export function FieldEditor({ envelope, pages, view, images, pdfUrl, mode, anchors, onChange }: {
  envelope: EnvelopeX; pages: PageSize[]; view?: PageView[]; images?: Record<string, string>; pdfUrl?: string | null; mode: PageMode; anchors: SignAnchor[];
  /** Called with the full list after every finished change. */
  onChange: (fields: SignField[]) => void;
}) {
  const { t, lang } = useApp();
  const [fields, setFields] = useState<SignField[]>(envelope.fields);
  const [signerId, setSignerId] = useState(envelope.signers[0]?.id ?? '');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(0);
  const [ghost, setGhost] = useState<{ type: FieldType; x: number; y: number } | null>(null);
  const sheets = useRef<(HTMLDivElement | null)[]>([]);
  const latest = useRef(fields); latest.current = fields;
  // the record changed underneath (a signer was removed, boxes were placed automatically): follow it
  useEffect(() => { setFields(envelope.fields); }, [envelope.fields]);
  useEffect(() => { if (!envelope.signers.some((s) => s.id === signerId)) setSignerId(envelope.signers[0]?.id ?? ''); }, [envelope.signers, signerId]);

  const commit = (next: SignField[]) => { setFields(next); onChange(next); };
  const patch = (id: string, p: Partial<SignField>, save = true) => { const next = latest.current.map((f) => (f.id === id ? clampField({ ...f, ...p }) : f)); if (save) commit(next); else setFields(next); };
  const remove = (id: string) => { commit(latest.current.filter((f) => f.id !== id)); setSelected(''); };
  const sel = fields.find((f) => f.id === selected);
  const signerName = (id: string) => envelope.signers.find((s) => s.id === id)?.name || t('esign.prep.unnamed');

  /** Which page is under a point of the screen (the first page is 1, as a box stores it), and where on it, as fractions. */
  const hit = (cx0: number, cy0: number): { page: number; x: number; y: number } | null => {
    for (let i = 0; i < sheets.current.length; i++) {
      const r = sheets.current[i]?.getBoundingClientRect();
      if (r && cx0 >= r.left && cx0 <= r.right && cy0 >= r.top && cy0 <= r.bottom) return { page: i + 1, x: (cx0 - r.left) / r.width, y: (cy0 - r.top) / r.height };
    }
    return null;
  };
  const add = (type: FieldType, at?: { page: number; x: number; y: number }) => {
    if (!signerId || !pages.length) return;
    const p = at?.page ?? Math.min(page, pages.length - 1) + 1;
    const size = fieldSize(type, pages[p - 1]);
    // a box added from the keyboard lands in the middle of the page, each one a little lower than the last so none hides another
    const n = latest.current.filter((f) => f.page === p).length;
    const f = clampField<SignField>({ id: uid('fd'), signerId, type, page: p, required: true, w: round(size.w), h: round(size.h), x: round(at ? at.x - size.w / 2 : 0.5 - size.w / 2), y: round(at ? at.y - size.h / 2 : Math.min(0.9, 0.3 + n * 0.045)) });
    commit([...latest.current, f]); setSelected(f.id); setPage(p - 1);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.es-box[data-field="${f.id}"]`)?.focus());
  };

  /* ---------- dragging: a new box from the toolbar, an existing box, or its corner ---------- */
  const track = (move: (e: PointerEvent) => void, end: (e: PointerEvent) => void) => {
    const up = (e: PointerEvent) => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); end(e); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  };
  const toolDown = (type: FieldType) => (e: PEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY }; let moved = false;
    track((m) => { if (!moved && Math.hypot(m.clientX - start.x, m.clientY - start.y) < 6) return; moved = true; m.preventDefault(); setGhost({ type, x: m.clientX, y: m.clientY }); },
      (u) => { setGhost(null); if (!moved) return; const at = hit(u.clientX, u.clientY); if (at) add(type, at); });
  };
  const boxDown = (f: SignField, resize: boolean) => (e: PEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    setSelected(f.id); setPage(f.page - 1);
    (e.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.es-box')?.focus();
    const r = sheets.current[f.page - 1]?.getBoundingClientRect(); if (!r) return;
    const start = { x: e.clientX, y: e.clientY }; let moved = false;
    // where on the box it was grabbed, so the box does not jump under the pointer
    const gx = (e.clientX - r.left) / r.width - f.x, gy = (e.clientY - r.top) / r.height - f.y;
    track((m) => {
      if (!moved && Math.abs(m.clientX - start.x) + Math.abs(m.clientY - start.y) < 3) return;
      moved = true; m.preventDefault();
      if (resize) { patch(f.id, { w: round(f.w + (m.clientX - start.x) / r.width), h: round(f.h + (m.clientY - start.y) / r.height) }, false); return; }
      // carried over another page: the box follows the pointer there
      const over = hit(m.clientX, m.clientY);
      if (over) patch(f.id, { page: over.page, x: round(over.x - gx), y: round(over.y - gy) }, false);
    }, () => { if (moved) { onChange(latest.current); const now = latest.current.find((x) => x.id === f.id); if (now) setPage(now.page - 1); } });
  };
  const boxKey = (f: SignField) => (e: React.KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 0.025 : 0.005;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dir[e.key]) {
      e.preventDefault();
      const [dx, dy] = dir[e.key];
      patch(f.id, e.altKey ? { w: round(f.w + dx * step), h: round(f.h + dy * step) } : { x: round(f.x + dx * step), y: round(f.y + dy * step) });
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(f.id); }
    else if (e.key === 'PageDown' && f.page < pages.length) { e.preventDefault(); patch(f.id, { page: f.page + 1 }); setPage(f.page); }
    else if (e.key === 'PageUp' && f.page > 1) { e.preventDefault(); patch(f.id, { page: f.page - 1 }); setPage(f.page - 2); }
  };
  const placeOnLines = () => {
    const have = latest.current;
    const fresh = autoPlace(anchors, envelope.signers, () => uid('fd')).filter((n) => !have.some((f) => f.page === n.page && f.type === n.type && f.signerId === n.signerId && Math.abs(f.x - n.x) < 0.05 && Math.abs(f.y - n.y) < 0.03));
    if (fresh.length) commit([...have, ...fresh]);
    return fresh.length;
  };
  const num = (v: string) => { const n = parseFloat(v); return isFinite(n) ? n / 100 : 0; };

  return (
    <div className="es-editor" data-testid="esign-editor">
      <div className="es-work">
        <div className="es-pages" data-testid="esign-pages">
          {mode !== 'drawn' && (
            <Note tone={mode === 'blank' ? 'warn' : undefined}>
              {t(mode === 'viewer' ? 'esign.prep.viewerNote' : 'esign.prep.blankNote')}{' '}
              {mode === 'viewer' ? <button type="button" className="linkbtn" onClick={() => setViewerOff(true)} data-testid="esign-viewer-off">{t('esign.pages.useSheets')}</button>
                : viewerPossible() && <button type="button" className="linkbtn" onClick={() => setViewerOff(false)} data-testid="esign-viewer-on">{t('esign.pages.useViewer')}</button>}
            </Note>
          )}
          {pages.map((size, i) => (
            <PageSheet key={i} index={i} size={size} view={view?.[i]} images={images} pdfUrl={pdfUrl} mode={mode} className={cx('edit', page === i && 'cur')} label={t('esign.pages.page', { n: i + 1, total: pages.length })} blankNote={t('esign.pages.blankSheet')}
              sheetRef={(el) => { sheets.current[i] = el; }} onPointerDown={() => { setPage(i); setSelected(''); }}>
              {fields.filter((f) => f.page === i + 1).map((f) => (
                <div key={f.id} role="button" tabIndex={0} className={cx('es-box edit', `es-s${signerIndex(envelope, f.signerId) % 6}`, `es-t-${f.type}`, selected === f.id && 'on', !f.required && 'opt')} data-field={f.id}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, fontSize: `${Math.min(1.5, 0.62 * f.h * (size.h / size.w) * 100)}cqw` }}
                  aria-label={t('esign.prep.boxLabel', { type: t('esign.field.' + f.type), signer: signerName(f.signerId), page: i + 1 })} aria-pressed={selected === f.id}
                  onPointerDown={boxDown(f, false)} onKeyDown={boxKey(f)} onFocus={() => { setSelected(f.id); setPage(i); }}>
                  <span className="es-boxname">{f.label || t('esign.field.' + f.type)}{f.required ? ' *' : ''}</span>
                  <span className="es-handle" aria-hidden="true" onPointerDown={boxDown(f, true)} />
                </div>
              ))}
            </PageSheet>
          ))}
        </div>

        <aside className="es-side">
          <Card className="es-tools">
            <div className="es-toolrow">
              <div className="es-toolgroup" role="group" aria-label={t('esign.prep.forSigner')}>
                <span className="label">{t('esign.prep.forSigner')}</span>
                <div className="row tight">
                  {envelope.signers.map((s) => (
                    <button key={s.id} type="button" className={cx('es-chip', `es-s${signerIndex(envelope, s.id) % 6}`)} aria-pressed={signerId === s.id} onClick={() => setSignerId(s.id)} data-testid="esign-tool-signer">
                      <i aria-hidden="true" />{s.name || t('esign.prep.unnamed')}{s.role && <span className="xs dim"> · {roleLabel(s.role, lang)}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="es-toolgroup" role="group" aria-label={t('esign.prep.addBox')}>
                <span className="label">{t('esign.prep.addBox')}</span>
                <div className="row tight">
                  {TOOLS.map(({ type, icon: Icon }) => <Button key={type} size="sm" icon={<Icon aria-hidden="true" />} disabled={!signerId} onPointerDown={toolDown(type)} onClick={() => add(type)} data-testid={`esign-tool-${type}`}>{t('esign.field.' + type)}</Button>)}
                </div>
              </div>
              <div className="es-toolgroup">
                <label className="label" htmlFor="es-page-pick">{t('esign.prep.onPage')}</label>
                <div className="row tight">
                  <select id="es-page-pick" className="input es-pagepick" value={page} onChange={(e) => { const p = Number(e.target.value); setPage(p); sheets.current[p]?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} data-testid="esign-tool-page">
                    {pages.map((_, i) => <option key={i} value={i}>{t('esign.pages.page', { n: i + 1, total: pages.length })}</option>)}
                  </select>
                  {anchors.length > 0 && <Button size="sm" variant="ghost" icon={<LuWandSparkles aria-hidden="true" />} onClick={placeOnLines} data-testid="esign-tool-auto">{t('esign.prep.autoPlace')}</Button>}
                </div>
              </div>
            </div>
            <p className="xs dim es-toolhint">{t('esign.prep.howTo')}</p>
          </Card>
          <Card title={t('esign.prep.props')}>
            {!sel ? <p className="small muted" data-testid="esign-props-empty">{fields.length ? t('esign.prep.pickBox') : t('esign.prep.noBoxes')}</p> : (
              <div className="stack tight" data-testid="esign-props">
                <p className="strong">{t('esign.field.' + sel.type)}</p>
                <Field label={t('esign.prep.signer')}>
                  <select value={sel.signerId} onChange={(e) => patch(sel.id, { signerId: e.target.value })} data-testid="esign-props-signer">{envelope.signers.map((s) => <option key={s.id} value={s.id}>{s.name || t('esign.prep.unnamed')}</option>)}</select>
                </Field>
                {(sel.type === 'text' || sel.type === 'checkbox') && <Field label={t('esign.prep.label')} hint={t('esign.prep.labelHint')}><input value={sel.label ?? ''} maxLength={60} onChange={(e) => patch(sel.id, { label: e.target.value || undefined })} data-testid="esign-props-label" /></Field>}
                {sel.type !== 'signature' && sel.type !== 'date' && <label className="check"><input type="checkbox" checked={sel.required} onChange={(e) => patch(sel.id, { required: e.target.checked })} data-testid="esign-props-required" /><span>{t('esign.prep.required')}</span></label>}
                <div className="es-xy">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <Field key={k} label={t('esign.prep.pos.' + k)}><input type="number" min={0} max={100} step={0.5} value={pct(sel[k])} onChange={(e) => patch(sel.id, { [k]: round(num(e.target.value)) })} data-testid={`esign-props-${k}`} /></Field>
                  ))}
                </div>
                <p className="xs dim">{t('esign.prep.posHint')}</p>
                <Button size="sm" variant="danger" icon={<LuTrash2 aria-hidden="true" />} onClick={() => remove(sel.id)} data-testid="esign-props-delete">{t('esign.prep.deleteBox')}</Button>
              </div>
            )}
          </Card>
        </aside>
      </div>
      {ghost && <div className="es-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">{t('esign.field.' + ghost.type)}</div>}
    </div>
  );
}
