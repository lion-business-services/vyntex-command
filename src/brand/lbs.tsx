// Lion Business Services brand pieces for the LBS Command deployment: the lion and the product lockup.
// The pictures are the official logo cut into transparent files (public-lbs/brand-lbs, shipped only with that deployment).
// Nothing here runs in the VYNTEX bundle: brand/index.tsx picks a brand when the bundle is built and the other one is dropped.
import { asset } from '@/app/router';
import { DEPLOY } from '@/config/deployment';

/** Width over height of the lion artwork (435 by 768 pixels at full size). */
const LION = 435 / 768;
/** Width over height of the official lockup, the lion beside "LION BUSINESS SERVICES" (999 by 600). */
const LOCKUP = 999 / 600;
/** Width over height of the wordmark alone (918 by 360). */
const WORDMARK = 918 / 360;
/** The firm's name, read out where its logo stands as a picture. A proper name, the same in every language. */
export const LBS_FIRM = 'Lion Business Services';

/**
 * The lion. `size` is its height in CSS pixels (the artwork is taller than wide). The file is chosen so it stays sharp on
 * high-density screens without sending the large one to a sidebar. Decoration by default; pass `label` only where the
 * lion is the one thing that names the firm.
 */
export function LionMark({ size = 40, className, label }: { size?: number; className?: string; label?: string }) {
  const file = size <= 48 ? 'lion-96.png' : size <= 128 ? 'lion-256.png' : 'lion-768.png';
  return <img className={`lbs-mark ${className ?? ''}`} src={asset('brand-lbs/' + file)} alt={label ?? ''} width={Math.round(size * LION)} height={size} decoding="async" />;
}

/** The wordmark "LION BUSINESS SERVICES" as drawn in the logo. `height` in CSS pixels. */
export function LbsWordmark({ height = 44, className }: { height?: number; className?: string }) {
  const file = height <= 60 ? 'wordmark-120.png' : 'wordmark-360.png';
  return <img className={`lbs-word ${className ?? ''}`} src={asset('brand-lbs/' + file)} alt={LBS_FIRM} width={Math.round(height * WORDMARK)} height={height} decoding="async" />;
}

/**
 * The LBS Command lockup. Same props as the VYNTEX `Lockup`.
 *   sm, md  compact places (the sidebar, a page header): the lion beside the product name set in type, in brushed gold.
 *           The official wordmark is too wide and too fine to read at these sizes, so it is not squeezed in.
 *   lg      roomy places: the official logo (lion and wordmark, as drawn), a rule, then the product name.
 * The product name comes from the deployment, never typed here. `mark={false}` leaves the name alone.
 */
export function LbsLockup({ size = 'md', tagline, mark = true }: { size?: 'sm' | 'md' | 'lg'; tagline?: string; mark?: boolean }) {
  const name = (
    <span className="lbs-lockup-t">
      <span className="lbs-name">{DEPLOY.productName}</span>
      {tagline && <span className="lbs-tag">{tagline}</span>}
    </span>
  );
  if (size === 'lg') {
    return (
      <span className="lbs-lockup lg">
        {mark && <img className="lbs-official" src={asset('brand-lbs/lockup-240.png')} alt={LBS_FIRM} width={Math.round(92 * LOCKUP)} height={92} decoding="async" />}
        {name}
      </span>
    );
  }
  return (
    <span className={`lbs-lockup ${size}`}>
      {mark && <LionMark size={size === 'md' ? 60 : 52} />}
      {name}
    </span>
  );
}
