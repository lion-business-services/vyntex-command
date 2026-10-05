// The page every sign-in screen and public token page sits in. The brand frame itself (the lion or the V on one side, the
// form on the other) is drawn by src/brand/AuthFrame.tsx; this adds what every one of these pages needs around it:
// the language choice, how to reach support, the page title, and where the keyboard lands when a step changes.
import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '@/app/hooks';
import { AuthFrame as BrandFrame } from '@/brand/AuthFrame';
import { setLanguage } from '@/store/store';
import { DEPLOY } from '@/config/deployment';
import type { Lang } from '@/domain/types';
import './auth.css';

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Español', zh: '中文' };

/**
 * `step` names the step on screen. When it changes, the keyboard goes to the first field of the new step, or to the step
 * itself when it has none, so a screen reader announces it and nobody has to hunt for the form.
 */
export function AuthFrame({ title, sub, children, testId, step }: { title: string; sub?: string; children: ReactNode; testId?: string; step?: string }) {
  const { t, lang } = useApp();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { document.title = `${title} · ${DEPLOY.productName}`; }, [title]);
  useEffect(() => {
    // only the pages that walk through steps ask for this; a page that passes no step keeps the browser's own focus
    const el = body.current; if (!el || step === undefined) return;
    const field = el.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([disabled]), [data-autofocus]');
    (field ?? el).focus({ preventScroll: !field });
  }, [step]);
  const tools = (
    <div className="seg" role="group" aria-label={t('auth.language')}>
      {DEPLOY.languages.map((code) => <button type="button" key={code} aria-pressed={lang === code} onClick={() => setLanguage(code)} lang={code} data-testid={`auth-lang-${code}`}>{LANG_NAME[code]}</button>)}
    </div>
  );
  return (
    <BrandFrame title={title} sub={sub} tools={tools} footer={t('auth.support', { email: DEPLOY.support.email, phone: DEPLOY.support.phone })}>
      <div className="stack auth-step" data-testid={testId} data-step={step} ref={body} tabIndex={-1} role="group" aria-label={title}>{children}</div>
    </BrandFrame>
  );
}
