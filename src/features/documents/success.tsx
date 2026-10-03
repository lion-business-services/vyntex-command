// The success mark used by the business and system modules: a short circuit line runs into a node and the check draws
// inside it, once, in about 450 ms. After that (and always with reduced motion) it is a plain static check.
// Use it where something just happened in front of the person: a document signed, an email marked as sent, consent
// recorded, settings saved, an assistant action confirmed.
import { useRef } from 'react';
import { cx } from '@/ui';
import './success.css';

/** `draw` plays the drawing once when the mark appears; without it the mark is static. Decorative: the words next to it carry the meaning. */
export function SuccessCheck({ draw, size = 18, className }: { draw?: boolean; size?: number; className?: string }) {
  return (
    <svg className={cx('okcheck', draw && 'draw', className)} viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path className="l" d="M-11 10H1.5" pathLength={100} />
      <circle className="c" cx="10" cy="10" r="8.5" pathLength={100} />
      <path className="k" d="M6.2 10.4l2.6 2.6 5-5.6" pathLength={100} />
    </svg>
  );
}

/** True from the moment `now` turns true while the component is on screen (not when it was already true on arrival). */
export function useBecame(now: boolean): boolean {
  const prev = useRef(now);
  const hit = useRef(false);
  if (now !== prev.current) { hit.current = now; prev.current = now; }
  return hit.current;
}
