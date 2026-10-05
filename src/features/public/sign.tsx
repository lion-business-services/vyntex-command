// The signing page a signer opens from their private link (no sign-in): /sign/<token>.
// It shows the same signing steps as the sample page inside the app (src/features/esign/signing.tsx); here the request
// comes from the server, which checks the link, records the opening, the consent and the signature, lets the next signer
// in and builds the signed copy. The link itself is the key: it is sent in the body of each call, never in an address
// the server would log.
import { useMemo } from 'react';
import { useApp } from '@/app/hooks';
import { makeT } from '@/i18n';
import { BrandLockup } from '@/brand';
import type { SignPayload, SignerView } from '@/domain/esign/types';
import { SigningFlow, type SigningAdapter, type SubmitResult } from '@/features/esign/signing';
import { useTitle } from './title';
import '@/features/esign/esign.css';

/** What the server answers. The addresses and shapes are the contract the server side is built to. */
interface ViewAnswer { ok: boolean; view?: SignerView; reason?: string }
async function call<T>(action: 'view' | 'opened' | 'submit' | 'decline', body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`/api/public/sign/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    return (await res.json()) as T;
  } catch { return null; }
}
/** Only an address on this site is opened: the server hands out a short-lived address of its own for the file. */
const sameSite = (url: string): string | null => { try { const u = new URL(url, window.location.origin); return u.origin === window.location.origin ? u.href : null; } catch { return null; } };
/** Talks to the server with the token of the link. A link that is unknown, used up or mistyped simply loads nothing. */
export function linkAdapter(token: string): SigningAdapter {
  const ok = /^[A-Za-z0-9_-]{20,200}$/.test(token);
  const adapter: SigningAdapter = {
    async load() {
      if (!ok) return null;
      const r = await call<ViewAnswer>('view', { token });
      const view = r?.ok && r.view ? r.view : null;
      // a signer has to be able to read what they sign: when the server gives the file an address, offer to open it
      const file = view?.fileUrl ? sameSite(view.fileUrl) : null;
      adapter.openDocument = file ? async () => { window.open(file, '_blank', 'noopener'); return true; } : undefined;
      return view;
    },
    async opened() { await call('opened', { token }); },
    async submit(p: SignPayload): Promise<SubmitResult> {
      const r = await call<{ ok: boolean; completed?: boolean; reason?: string; fields?: string[] }>('submit', { token, ...p });
      return r?.ok ? { ok: true, completed: !!r.completed } : { ok: false, reason: r?.reason ?? 'unavailable', fields: r?.fields };
    },
    async decline(reason: string) { const r = await call<{ ok: boolean }>('decline', { token, reason }); return { ok: !!r?.ok }; },
  };
  return adapter;
}

/** `/sign/<token>`: the signing page a signer opens from their email. */
export function SignPage({ token }: { token?: string }) {
  const { t, pack, lang } = useApp();
  useTitle(t('public.sign.title'));
  const adapter = useMemo(() => linkAdapter(token ?? ''), [token]);
  return (
    <div className="es-public" data-testid="public-sign">
      <header className="es-public-head"><BrandLockup size="sm" /></header>
      <main id="main" className="es-public-main"><SigningFlow adapter={adapter} wording={(l) => makeT(l ?? lang, pack)} /></main>
      <footer className="es-public-foot small muted">{t('esign.sign.foot')}</footer>
    </div>
  );
}
