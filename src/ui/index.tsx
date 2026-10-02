// Shared interface pieces. Features compose these instead of writing their own markup and styles.
import { type ReactNode, type CSSProperties, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { LuX, LuSearch, LuInbox } from 'react-icons/lu';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'violet' | 'accent' | 'neutral';
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* ---------- buttons ---------- */
type BtnProps = { variant?: 'default' | 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' | 'lg'; block?: boolean; icon?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>;
export function Button({ variant = 'default', size = 'md', block, icon, className, children, type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={cx('btn', variant !== 'default' && variant, size !== 'md' && size, block && 'block', className)} {...rest}>{icon}{children}</button>;
}
export function IconButton({ label, size, className, children, ...rest }: { label: string; size?: 'sm' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cx('iconbtn', size, className)} aria-label={label} title={label} {...rest}>{children}</button>;
}

/* ---------- small pieces ---------- */
export function Badge({ tone = 'neutral', outline, children, title }: { tone?: Tone; outline?: boolean; children: ReactNode; title?: string }) {
  return <span className={cx('badge', tone !== 'neutral' && tone, outline && 'outline')} title={title}>{children}</span>;
}
export function Dot({ tone = 'neutral' }: { tone?: Tone }) { return <span className={cx('dot', tone !== 'neutral' && tone)} aria-hidden="true" />; }
export function Avatar({ name, size, accent }: { name: string; size?: 'sm'; accent?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  return <span className={cx('avatar', size, accent && 'accent')} aria-hidden="true">{initials}</span>;
}
export function Card({ title, actions, children, flush, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section className={cx('card', flush && 'flush', className)} id={id}>
      {(title || actions) && <div className="card-h">{title ? <h2>{title}</h2> : <span />}{actions && <div className="row tight">{actions}</div>}</div>}
      {children}
    </section>
  );
}
export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header>
      {back}
      <div className="page-h"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="actions">{actions}</div>}</div>
    </header>
  );
}
export function Stat({ label, value, hint, onClick, attention, testId }: { label: ReactNode; value: ReactNode; hint?: ReactNode; onClick?: () => void; attention?: boolean; testId?: string }) {
  const body = <><div className="k">{label}</div><div className="v">{value}</div>{hint && <div className="h">{hint}</div>}</>;
  return onClick ? <button type="button" className={cx('kpi', attention && 'attn')} onClick={onClick} data-testid={testId}>{body}</button> : <div className={cx('kpi', attention && 'attn')} data-testid={testId}>{body}</div>;
}
export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><LuInbox aria-hidden="true" /><b>{title}</b>{children && <div className="small">{children}</div>}{action && <div style={{ marginTop: 10 }}>{action}</div>}</div>;
}
export function Note({ tone, children }: { tone?: 'warn' | 'bad'; children: ReactNode }) { return <div className={cx('note', tone)}>{children}</div>; }

/* ---------- inputs ---------- */
export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  return <div className="searchbox"><LuSearch aria-hidden="true" /><input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} /></div>;
}
export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined && <span className="count">{o.count}</span>}</button>)}
    </div>
  );
}
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" type="button" aria-selected={t.id === value} onClick={() => onChange(t.id)}>{t.label}{t.count !== undefined && t.count > 0 && <span className="count">{t.count}</span>}</button>)}
    </div>
  );
}
export function Field({ label, children, hint, error, full, htmlFor }: { label: ReactNode; children: ReactNode; hint?: ReactNode; error?: boolean; full?: boolean; htmlFor?: string }) {
  return <div className={cx('field', error && 'err', full && 'full')}><label htmlFor={htmlFor}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, size, labelClose = 'Close' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow'; labelClose?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea, button:not([aria-label])');
    (first || el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = overflow; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-h"><h2 id={titleId}>{title}</h2><IconButton label={labelClose} onClick={onClose}><LuX /></IconButton></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- form modal: describe the fields, get the values ---------- */
export type FieldDef = {
  k: string; label: string; type?: 'text' | 'number' | 'money' | 'date' | 'time' | 'email' | 'tel' | 'select' | 'textarea' | 'checkbox';
  options?: [string, string][]; req?: boolean; full?: boolean; hint?: string; placeholder?: string;
};
export function FormModal({ title, fields, initial, onSave, onClose, saveLabel, cancelLabel, requiredMsg, extra, validate }: {
  title: string; fields: FieldDef[]; initial?: Record<string, any>; onSave: (values: Record<string, any>) => void; onClose: () => void;
  saveLabel: string; cancelLabel: string; requiredMsg: string; extra?: ReactNode; validate?: (v: Record<string, any>) => string | null;
}) {
  const [v, setV] = useState<Record<string, any>>(() => ({ ...(initial || {}) }));
  const [err, setErr] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const uidp = useId();
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Record<string, any> = {}; const bad: string[] = [];
    for (const f of fields) {
      let val = v[f.k];
      if (f.type === 'number' || f.type === 'money') { val = val === '' || val === undefined || val === null ? null : Number(String(val).replace(/[^0-9.-]/g, '')); if (val !== null && !isFinite(val)) val = null; }
      else if (f.type === 'checkbox') val = !!val;
      else val = typeof val === 'string' ? val.trim() : val ?? '';
      if (f.req && (val === '' || val === null || val === undefined)) bad.push(f.k);
      out[f.k] = val;
    }
    if (bad.length) { setErr(bad); setMsg(requiredMsg); return; }
    const custom = validate?.(out); if (custom) { setMsg(custom); return; }
    onSave(out); onClose();
  };
  return (
    <Modal title={title} onClose={onClose} labelClose={cancelLabel}>
      <form onSubmit={submit} noValidate>
        <div className="fgrid">
          {fields.map((f) => {
            const id = uidp + f.k; const bad = err.includes(f.k);
            const common = { id, value: v[f.k] ?? '', onChange: (e: React.ChangeEvent<any>) => set(f.k, e.target.value), 'aria-invalid': bad || undefined, 'aria-required': f.req || undefined, placeholder: f.placeholder };
            if (f.type === 'checkbox') return <label key={f.k} className={cx('check', f.full && 'full')}><input type="checkbox" checked={!!v[f.k]} onChange={(e) => set(f.k, e.target.checked)} /><span>{f.label}</span></label>;
            return (
              <Field key={f.k} label={<>{f.label}{f.req && <span aria-hidden="true"> *</span>}</>} htmlFor={id} error={bad} full={f.full || f.type === 'textarea'} hint={f.hint}>
                {f.type === 'select' ? <select {...common}>{(f.options || []).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}</select>
                  : f.type === 'textarea' ? <textarea rows={3} {...common} />
                  : <input type={f.type === 'money' || f.type === 'number' ? 'number' : f.type || 'text'} step={f.type === 'money' ? '0.01' : undefined} min={f.type === 'money' ? 0 : undefined} inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined} {...common} />}
              </Field>
            );
          })}
        </div>
        {extra}
        {msg && <p className="small neg" role="alert" style={{ marginTop: 10 }}>{msg}</p>}
        <div className="modal-f" style={{ margin: '18px -18px -18px' }}>
          <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" type="submit">{saveLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- confirm + toast (imperative, so any action can use them) ---------- */
type Ask = { message: string; confirmLabel: string; cancelLabel: string; danger?: boolean; resolve: (ok: boolean) => void };
let asking: Ask | null = null;
let toasts: { id: number; text: string; err?: boolean }[] = [];
let seq = 0;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
let snap: { asking: Ask | null; toasts: typeof toasts } = { asking, toasts };
const refresh = () => { snap = { asking, toasts }; ping(); };
export function confirmDialog(message: string, confirmLabel: string, cancelLabel: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => { asking = { message, confirmLabel, cancelLabel, danger, resolve }; refresh(); });
}
export function toast(text: string, err = false) {
  const id = ++seq; toasts = [...toasts, { id, text, err }]; refresh();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); refresh(); }, Math.min(9000, 3200 + Math.max(0, text.length - 40) * 55));
}
export function Overlays() {
  const s = useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => snap, () => snap);
  const done = (ok: boolean) => { const a = asking; asking = null; refresh(); a?.resolve(ok); };
  return (
    <>
      {s.asking && (
        <Modal title={s.asking.confirmLabel} onClose={() => done(false)} size="narrow" labelClose={s.asking.cancelLabel}
          footer={<><Button variant="ghost" onClick={() => done(false)}>{s.asking.cancelLabel}</Button><Button variant={s.asking.danger ? 'danger' : 'primary'} onClick={() => done(true)} data-autofocus>{s.asking.confirmLabel}</Button></>}>
          <p>{s.asking.message}</p>
        </Modal>
      )}
      <div className="toasts" role="status" aria-live="polite">{s.toasts.map((t) => <div key={t.id} className={cx('toast', t.err && 'err')}>{t.text}</div>)}</div>
    </>
  );
}

/* ---------- dropdown menu ---------- */
export function Menu({ button, children, label, align }: { button: ReactNode; children: ReactNode | ((close: () => void) => ReactNode); label: string; align?: 'left' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const style: CSSProperties | undefined = align === 'left' ? { left: 0, right: 'auto' } : undefined;
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      <span onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label}>{button}</span>
      {open && <div className="menu" role="menu" style={style} onClick={() => setOpen(false)}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

/* ---------- money bar: how a job's price splits into labour, expenses and profit ---------- */
export function MoneyBar({ parts, total, label }: { parts: { value: number; cls: 's1' | 's2' | 's3' | 's4' | 's5'; label: string }[]; total: number; label: string }) {
  const base = Math.max(total, parts.reduce((a, p) => a + Math.max(0, p.value), 0), 1);
  return <div className="bar" role="img" aria-label={label} title={label}>{parts.map((p, i) => <span key={i} className={p.cls} style={{ width: `${(Math.max(0, p.value) / base) * 100}%` }} />)}</div>;
}
