// Which product this bundle is. One codebase builds two separate deployments (docs/MASTER-BUILD-SPEC.md, section 1):
//
//   vyntex   VYNTEX Command, the product sold to client companies: sales pages, public demo, a workspace per company.
//   lbs      LBS Command, the standalone workspace of Lion Business Services: its own address, sign-in, database,
//            storage, secrets and brand. No sales pages, no public demo, no plans, one edition.
//
// The choice is made when the bundle is built (VX_DEPLOY, see scripts/build.mjs), never at run time, so one deployment
// cannot be switched into the other from the browser.
import type { IndustryId, L10n, Lang } from '@/domain/types';

declare const __VX_DEPLOY__: string | undefined;
declare const __VX_SAMPLE_PREVIEW__: boolean | undefined;
declare const __VX_LINK_BOOKKEEPING__: string | undefined;
declare const __VX_LINK_PAYROLL__: string | undefined;

export type DeployId = 'vyntex' | 'lbs';

export interface Deployment {
  id: DeployId;
  productName: string;
  /** Sets `data-brand` on the page; the stylesheet of that brand takes over. */
  theme: 'vyntex' | 'lbs';
  /** When set, the workspace only ever shows this edition and the edition picker does not exist. */
  lockedEdition: IndustryId | null;
  /** The sales pages (overview, pricing, request a demo). */
  marketing: boolean;
  /** The public demo under /demo. */
  publicDemo: boolean;
  /** A workspace with sample records under /preview, for review builds only. Always labelled as sample data. */
  samplePreview: boolean;
  /** Plan badges, upgrade hints and pricing links. */
  showPlans: boolean;
  languages: Lang[];
  /** Where a live workspace lives: `/<company-slug>` or `/app`. */
  liveBase: 'slug' | 'app';
  support: { email: string; phone: string };
  /** Links the team sends to clients often, shown on the home screen. An empty address is shown as "not set", never guessed. */
  quickLinks: { id: string; label: L10n; url: string }[];
}

const link = (v: string | undefined) => (typeof v === 'string' ? v : '');

// The two descriptions sit inside one conditional on the build constant itself, written out in full, so the bundler keeps
// only the one this build is: the VYNTEX bundle does not carry the LBS product name or links, and the other way round.
export const DEPLOY: Deployment = typeof __VX_DEPLOY__ !== 'undefined' && __VX_DEPLOY__ === 'lbs'
  ? {
    id: 'lbs', productName: 'LBS Command', theme: 'lbs', lockedEdition: 'practice',
    marketing: false, publicDemo: false, samplePreview: typeof __VX_SAMPLE_PREVIEW__ !== 'undefined' && __VX_SAMPLE_PREVIEW__ === true, showPlans: false,
    languages: ['en', 'es', 'zh'], liveBase: 'app',
    // Support for the platform itself is VYNTEX. Lion Business Services' own contact details come from its company record.
    support: { email: 'info@vyntexusa.com', phone: '609-780-3218' },
    quickLinks: [
      { id: 'bookkeeping', label: { en: 'Bookkeeping client link', es: 'Enlace de contabilidad para clientes', zh: '簿记客户链接' }, url: link(typeof __VX_LINK_BOOKKEEPING__ !== 'undefined' ? __VX_LINK_BOOKKEEPING__ : '') },
      { id: 'payroll', label: { en: 'Payroll client link', es: 'Enlace de nómina para clientes', zh: '薪资客户链接' }, url: link(typeof __VX_LINK_PAYROLL__ !== 'undefined' ? __VX_LINK_PAYROLL__ : '') },
    ],
  }
  : {
    id: 'vyntex', productName: 'VYNTEX Command', theme: 'vyntex', lockedEdition: null,
    marketing: true, publicDemo: true, samplePreview: false, showPlans: true,
    languages: ['en', 'es'], liveBase: 'slug',
    support: { email: 'info@vyntexusa.com', phone: '609-780-3218' },
    quickLinks: [],
  };
export const isLbs = DEPLOY.id === 'lbs';
