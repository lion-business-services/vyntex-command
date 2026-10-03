# Redesign report: VYNTEX Command

Brand, interface, motion and conversion upgrade of the platform built in the first phase. Prepared 2 October 2026.
This was an upgrade, not a rebuild. No business rule, calculation, price, role or database file was changed: `src/domain/`, `src/lib/`, `config/`, `api/` and `supabase/` are identical to the first delivery.
Nothing was deployed by this work. The test site on Vercel updates only when this code is pushed to the GitHub repository.

Only what was built and checked is listed as done. What was not done, or not verified, is in sections 11 and 14.

## 1. Visual system

* One design language, "Metallic Intelligence", held as tokens in `src/ui/styles.css`: graphite surfaces (five levels), a chrome scale used for identity only, one blue spectrum taken from the logo (cobalt, blue, cyan, ice), status colours, three depth levels and two glows.
* Cyan is reserved for the action and the active item. Chrome never carries body text.
* Three button styles: primary (one per view, cyan to ice), secondary (graphite with a metallic border), tertiary (text only).
* Four card levels: section, raised, hoverable record, and premium (VYNTEX AI, automation and key calls to action get the lit edge and one cut corner). The angular cut is kept for brand moments.
* Light theme for the workspace: pearl and ice surfaces, cobalt accent, the sidebar stays dark. The public pages are always dark.
* Type scale kept on Sora (headings) and Manrope (text).
* Empty states share one motif: the icon sits on a small circuit node. One copy in the shared stylesheet, used by every module.

## 2. Branding

* The product is named VYNTEX Command, "AI-Powered Business Operating Platform", with the promise "One intelligent command center. Built around your business." All three are settings in `src/config/brand.ts`. The eight editions keep their names.
* The official V mark was cut out of the supplied logo as a transparent image in three sizes (`public/brand/vyntex-v*.webp`). It is the real mark, not a redrawing.
* Wordmark lockup: VYNTEX in chrome, COMMAND in the blue spectrum, used in the page header, the sidebar, the footer and the "Powered by" line.
* The assistant is called VYNTEX AI everywhere in the interface, including the sidebar.
* Footer contact details are the official ones only: info@vyntexusa.com, 609-780-3218, Suite 27A, 331 Tilton Rd, Northfield, NJ 08225.

## 3. Marketing pages

Overview page (`/`), in this order: hero, industry selector, value statement, "eight places" problem that converges into one system, workflow line with its automations, sticky product walkthrough, VYNTEX AI, automation "when / then", "Everything connected" diagram, the eight editions, customization, what is included and what costs extra, request band, final call to action "Your business. Under command."

* Hero: message and three calls to action on the left (Explore live demo, Request a demo, See pricing), the dimensional V mark, and a product window that plays a 13 second loop of the sample company with a pause button.
* Every product visual is built from the sample business of the selected edition and labelled as a sample company. Numbers are computed from that data, never typed.
* VYNTEX AI section: plays a real answer produced by the demo's built-in interpreter from the sample records, then an instruction that becomes a card waiting for confirmation. The page says plainly that the demo uses a built-in interpreter and that an AI model is connected during setup.
* Customization section: example brands are marked as made up for the page.
* Pricing page (`/pricing`): plan cards from the pricing file with the "Most popular" mark the file itself carries, a first-payment estimate, the four labels (Included, Available add-on, Usage-based, Custom quote), add-ons, and the customer-facing rules. The Client Portal stays "Not built yet", quoted, with no price.
* Request a demo page (`/request-demo`): what you will see on the left, a short form on the right, and separate states for sent, not sent and failed. It still never claims a delivery that did not happen.
* No testimonials, customer logos, user counts, awards, uptime or certifications appear anywhere.

## 4. Application interface

* Sidebar: lockup, company block, grouped navigation, active item marked by a 2px cyan rail, and a line that always reads "Live demo · Sample data".
* Top bar: one field, "Search or ask VYNTEX AI…", with the Ctrl K or ⌘K hint.
* Command palette (new): actions (new lead, task, job, document, record a payment, open the calendar), "Go to" for every module the role may open, record search, and "Ask VYNTEX AI" with the typed question.
* Demo bar: Live demo tag, industry, view as, plan, language, guided tour, reset, See pricing, Request a demo. Controls shrink in a set order and never overlap, in both languages, from 1180px up; below that they move into the tag's menu.
* Dashboard rebuilt around a hierarchy: greeting with the state of the day, up to six figures, "Needs attention", today's operation, active jobs, pipeline and revenue, "Handled for you" (automation activity) and VYNTEX AI suggestions worked out from the records by fixed rules.
* Module polish in every module: filter bars, tables that stack on phones, board cards, a one-time success mark on documents, print layout for reports.
* Guided tour: thin lit edge on the real control, lighter dimming, "Step n of total" with one segment per step.
* Touch screens and small windows: buttons, segmented controls and icon buttons are at least 40px tall, and the task tick has a 40px target.

## 5. 3D implementation

* The hero mark is a layered 2.5D build in CSS (`VMark3D` in `src/brand/`): the real mark, a glow layer, a chrome light sweep clipped to the chrome limb, and circuit pulses on traced paths. It floats slowly, leans 1 to 3 degrees toward the pointer on desktop, and never spins.
* No WebGL and no 3D library. The brief allows this when it performs better, and no library can be installed in the build workspace. Cost: one 73 KB image that the browser caches.
* The product window in the hero has a 3 degree perspective tilt.
* Not built: a true 3D model of the mark. See section 14.

## 6. Motion system

* Six duration tokens (100ms, 180ms, 320ms, 620ms, 1100ms, 9s for ambient loops) and two easing curves. Nothing else is used.
* One scroll reveal for the whole site (`Reveal`): fade, 16px rise, blur clearing; panels rise 24px.
* Sales pages carry the expressive motion. The workspace has micro-interactions only: 1 to 2px hover lift, lit border, row highlight, dialog and palette transitions. No ambient motion, parallax or 3D behind work screens.
* Loops pause when off screen. With "reduce motion" set in the operating system, every page is static and complete.

## 7. Scroll interactions

* Scroll progress line under the page header.
* "Eight places" section: eight separate tools drift, then settle into one system as you scroll.
* Sticky walkthrough: six steps on the left, the product window on the right changes with the active step. On phones it becomes stacked sections.
* Circuit traces draw when they come into view, only where the idea is connection, automation or flow (hero to product window, workflow line, automation rule, connected diagram, final call to action).
* Arriving at a section link (for example `/#industries`) lands on the section and stays there while the page above settles.

## 8. Conversion

* One primary action per view. "Explore live demo" leads on the overview page; "Request a demo" stays in the header on every page and in the demo bar.
* The live demo is one click from the hero, from every edition row and from each walkthrough step, and opens in the chosen edition.
* Pricing: a first-payment estimate for the chosen plan and period, and "Request a demo with this plan" carries the plan to the form.
* Request form: fewer decisions, the official phone, WhatsApp and email beside it, and "Or look first" for visitors not ready to ask.
* The demo keeps "See pricing" and "Request a demo" in view, and the tour ends on both.
* Not measured: no conversion figures exist yet, so none are claimed.

## 9. Responsive

* Checked at 1440, 1280, 1024, 768, 390 and 360 wide; the demo bar also at every step from 1920 down to 360, in both languages.
* Phones have their own composition: message first, call to action in view at once, simplified visuals, stacked storytelling, no parallax.
* No sideways scroll on any page in the final test run (section 11).
* Fixed in this pass: demo bar controls overlapping in Spanish between 1200 and 1680; 4px sideways scroll at 360 from the user name in the top bar.

## 10. Accessibility

* Keyboard: Tab reaches the controls on the four entry pages with a visible focus ring on each; "Skip to content" is the first stop; the command palette opens with Ctrl K, runs with Enter and closes with Esc.
* Reduced motion: nothing animates and no text is left faded out, on the overview, pricing, request and dashboard pages, desktop and phone.
* Tap targets of 40px on touch screens. Decorative icons are hidden from assistive technology. The emoji that marked automated tasks was replaced by an icon.
* English grammar repair now goes by sound ("a unit", "an event").
* Not done: testing with a screen reader, and a contrast audit with a tool.

## 11. Performance

Measured on the final build, served locally. Sizes are compressed (gzip).

| | First delivery | Now |
| --- | --- | --- |
| Script needed before the overview page shows | 300 KB | 242 KB |
| Script needed before the dashboard shows | 298 KB | 212 KB |
| Stylesheet (one file for the whole site) | 22 KB | 46 KB |
| Marketing page code | 10 KB | 25 KB |
| Images on the overview page | about 70 KB | about 80 KB (the V mark) |
| Layout shift on load (CLS) | 0 | 0 |

* The script got lighter although the pages do more, because each edition's sample business now loads on demand: the one being shown first, the other seven in the background a few seconds later (`src/packs/seeds.ts`). Before, all eight were downloaded before the first screen.
* The files the page needs at once are announced in the HTML so they download together, the first page's code and the hero image are requested at the very start, and the first headings are drawn without a fade.
* Largest paint, local machine with no network delay: about 0.8 s on the overview page (the V mark), 0.5 to 0.6 s on pricing, request and the dashboard.
* PDF generation (177 KB) still loads only when a PDF is made.

Not verified, stated plainly:
* No Lighthouse or real-network measurement was run, and response to input (INP) was not measured. Run Lighthouse on the Vercel test site after the push.
* Only Chromium was used. Safari and Firefox were not tested, and no physical phone was used.
* The brand fonts (Sora, Manrope) cannot load in the build workspace, so every screen was reviewed in the fallback font. Look at headings once on the live test site.
* The type check ran against the local stand-in for the React types. Run `npm install` and `npm run typecheck` once on a normal machine.

## 12. Components

New: `VMark`, `VMark3D`, `Lockup`, `CircuitTrace`, `Reveal`, `Frame`, `ScrollProgress`, `Arrow` and the hooks `useInView`, `usePrefersReducedMotion` (all in `src/brand/`); `CommandPalette` (in `src/app/Shell.tsx`); the hero product window; the eight story sections; the dashboard parts and its insight rules; the document success mark.

Changed: workspace shell (sidebar, top bar, demo bar), `TaskRow`, guided tour, the three public pages, the dashboard, and the screens of all modules (presentation only).

## 13. Major files

* `src/ui/styles.css`: tokens, buttons, cards, forms, shell, palette, light theme, touch sizes.
* `src/brand/` (new): `index.tsx`, `brand.css`. `public/brand/vyntex-v.webp`, `-sm`, `-xs` (new).
* `src/config/brand.ts`: name, descriptor, promise, tagline in both languages.
* `src/app/Shell.tsx`, `src/app/shared.tsx`, `src/i18n/app.ts`, `src/i18n/index.ts`, `src/i18n/features.ts`.
* `src/features/marketing/`: `landing.tsx`, `parts.tsx`, `pricing.tsx`, `request.tsx`, `marketing.css`, `pages.css`, `i18n.ts`, `pages-i18n.ts`, `hero/` (new), `sections/` (new: walkthrough, ai, automation, connected, editions, customization, plans, closing).
* `src/features/dashboard/`: `index.tsx`, `parts.tsx` (new), `insights.ts` (new), `dashboard.css`, `i18n.ts`.
* Screens and stylesheets of leads, clients, jobs, tasks, calendar, team, portal, documents, messages, payments, reports, compliance, automations, assistant, settings, tour.
* Loading: `src/packs/seeds.ts` (new), `src/store/store.ts`, `src/main.tsx`, the eight `pack.ts` files (one import removed each), `scripts/build.mjs`, `vercel.json` (cache rule for `/brand/`).
* Tests and docs: `tests/qa_motion.py` (new), `tests/qa_matrix.py`, `tests/pack_facts.mjs`, `scripts/check-seeds.mjs`, `README.md`, `docs/CONVENTIONS.md`, this report.

## QA on the final build

All of this ran on the final build, after the last code change.

* Page matrix: 1,312 page checks (8 industries, English and Spanish, desktop and phone, 41 pages each): errors, sideways scroll, missing wording, unfilled words, industry wording, English left in Spanish. Result: 0 issues.
* Visitor flows: 476 checks across all eight industries plus Spanish and phone runs and the sales pages, including every plan price against the pricing file. Result: all passed.
* Motion and keyboard (`tests/qa_motion.py`, new): 29 checks. Result: all passed.
* Static checks: build, type check (local stand-in), pricing guard, wording check (2,439 keys in both languages), sample data check. All passed.
* Screens were reviewed by eye: the overview page top to bottom at desktop and phone width, pricing, request, the dashboard in dark and light, every module in light, in Spanish, on a phone and as office staff, and the demo bar at eighteen widths.
* The database tests were not rerun because nothing under `supabase/` or `api/` changed.

## 14. Remaining recommendations

For a decision by Daysi:
1. **Spanish tagline.** The footer showed the English tagline on the Spanish page. It now reads "Automatización con IA | Desarrollo web | Tecnología digital" in Spanish. Confirm or give the official wording.
2. **VYNTEX AI in the plans.** The pricing file still does not list the assistant, so it keeps its "Preview" mark inside the workspace while the sales page presents it prominently, as the brief asks. Decide the plan or add-on it belongs to.
3. **Client word in TURNOVER prices.** "Property manager / owner" read badly inside plan lines, so those lines use the plain word "client" in that edition. Every other screen keeps the trade's word. Confirm.
4. **Amounts in sample task titles.** A few sample tasks name an amount ("Call Rachel about the $3,200 balance") and office staff can read task titles. It is sample data, and office staff already open invoices. Say if amounts should come out of task titles.
5. The open decisions from the first report still stand: e-signature plan, welcome-credit wording, pricing wording review, roles, subdomain.

Technical, in order of value:
1. Run Lighthouse and a real-phone pass on the test site, and look at the headings in Sora.
2. Split the stylesheet so the workspace does not download the sales pages' styles (about 15 KB compressed to save on each side).
3. Load only the visitor's language at first (about 30 KB compressed).
4. A true 3D model of the mark, if wanted, needs the mark as vector or 3D artwork and a WebGL library. The layered version was chosen for speed.
5. Known small gaps: the industry switch on the overview page is a dim-and-settle, not a full cross-fade; the VYNTEX AI panel grows about 85px while it plays at desktop width; long Spanish edition names are cut in the closed edition selector on the pricing page at 1024px; the overview page is long on phones (about 28 screens).
6. Customer mode (sign-in and the connection to the database) is still the next build step, unchanged from the first report.
