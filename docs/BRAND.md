# Brand and theme

One codebase carries two brands. The bundle decides which one (`DEPLOY.theme`, set when it is built), `main.tsx` writes it
on the page as `data-brand="vyntex"` or `data-brand="lbs"`, and the stylesheet of that brand takes over.

| | VYNTEX Command | LBS Command |
| --- | --- | --- |
| Tokens | `src/ui/styles.css` (`:root`, `:root[data-theme="light"]`) | `src/ui/theme-lbs.css` (`:root[data-brand="lbs"]`, plus `[data-theme="light"]`) |
| Mark and lockup | `VMark`, `VMark3D`, `Lockup` in `src/brand/index.tsx` | `LionMark`, `LbsWordmark`, `LbsLockup` in `src/brand/lbs.tsx` |
| Pictures | `public/brand/` | `public-lbs/brand-lbs/` (the official logo, cut into transparent files) |
| Fonts | Sora (headings), Manrope (text) | Playfair Display (titles and large figures), Poppins (everything else) |

Feature CSS never names a brand. It uses the tokens, and both themes define every one of them. If a screen looks wrong in
one brand, the fix is a token in that brand's file, not a rule in the feature.

## Rules for anyone writing a screen

* Never type a colour. Use the tokens (`docs/CONVENTIONS.md` lists them).
* A page title or a large figure uses `font-family:var(--font-title)`. Everything else uses `--font-display` or `--font-body`.
  In VYNTEX `--font-title` is the heading face; in LBS it is Playfair Display. `h1`, `h2` (LBS only) and `.kpi .v` already do this.
* In shared screens (sidebar, sign-in, emails, loading) use `BrandLockup` and `BrandMark` from `@/brand`, never `Lockup` or
  `VMark` directly. Those two are the VYNTEX pieces and belong to the sales pages.
* `--cobalt --blue --cyan --ice` are "the brand's metal, dark to light": the blue spectrum in VYNTEX, bronze to pale gold in
  LBS. Use them for brand moments only. `--blue-soft` is the row highlight (blue tint in VYNTEX, calm green in LBS).
* `.cut`, the chamfer, the circuit trace and glow are VYNTEX signatures. Under LBS they switch themselves off; do not rebuild
  them by hand in a feature.

## Brand components (`@/brand`)

| Component | Props | Notes |
| --- | --- | --- |
| `BrandLockup` | `size?: 'sm' \| 'md' \| 'lg'`, `tagline?: string`, `mark?: boolean` | The lockup of this deployment. Same props as `Lockup`. |
| `BrandMark` | `size?: number`, `className?: string` | The V or the lion. `size` is the width of the V; the lion is drawn 1.3 times that in height so it carries the same weight. |
| `LionMark` (`@/brand/lbs`) | `size?: number` (height in px, default 40), `className?: string`, `label?: string` | Picks `lion-96`, `lion-256` or `lion-768` by size. Decorative (`alt=""`) unless `label` is given. |
| `LbsWordmark` (`@/brand/lbs`) | `height?: number` (default 44), `className?: string` | "LION BUSINESS SERVICES" as drawn in the logo, `alt` is the firm's name. |
| `LbsLockup` (`@/brand/lbs`) | same as `Lockup` | `sm`, `md`: the lion beside the product name in type. `lg`: the official logo, a rule, the product name. |
| `AuthFrame` (`@/brand/AuthFrame`) | `children`, `title?`, `sub?`, `tools?`, `footer?` (all `ReactNode`) | Sign-in frame for both brands. Presentation only, no wording of its own. It renders the page's `<main id="main">` and the `<h1>`; the form inside must not add another. |

`BrandLockup`, `BrandMark` and `AuthFrame` test the build constant `__VX_DEPLOY__` at the branch itself. esbuild folds that
to true or false, so each bundle drops the other brand's components and the addresses of its pictures. It does not fold a
value read from another file (`DEPLOY.theme`, `isLbs`) or a named constant, which is why the test is written out each time.
Proved on the built bundles: the VYNTEX bundle contains no `brand-lbs/` address.

The product name in the LBS lockup is `DEPLOY.productName`. There is no LBS tagline: none was supplied and none is invented.

## VYNTEX Command: "Metallic Intelligence"

Graphite and navy surfaces, brushed chrome for the identity, one blue spectrum (cobalt, VYNTEX blue, electric cyan, ice).
Cyan marks the one thing to act on. Chamfered corners, circuit traces and controlled glow are the signatures.

### The dark theme is navy graphite, not black

The owner's brief (sections 43, 45, 93) asks for "brighter graphite/navy", "not overly black", "dark premium technology, not
flat black website". The ground and every surface were lifted about five to ten points of lightness and given more blue;
the chrome, the cyan and the component shapes are unchanged. `L*` is perceptual lightness (0 black, 100 white).

| Token | Before | After | L* before | L* after |
| --- | --- | --- | --- | --- |
| `--bg` | `#070A11` | `#111829` | 2.7 | 8.4 |
| `--surface` | `#0C111B` | `#182135` | 5.0 | 12.9 |
| `--surface-2` | `#121927` | `#1F2A42` | 8.7 | 17.2 |
| `--surface-3` | `#1A2334` | `#293651` | 13.6 | 22.7 |
| `--surface-4` | `#232E44` | `#354464` | 18.9 | 28.9 |
| `--line` | `#1B2535` | `#28344D` | | |
| `--line-strong` | `#2B3850` | `#3D4D6E` | | |
| `--line-chrome` | `rgba(200,210,225,.20)` | `rgba(200,210,225,.22)` | | |
| `--text` | `#EEF2F8` | `#F0F4FA` | | |
| `--text-2` | `#AEB8C8` | `#B9C3D3` | | |
| `--text-3` | `#7E8A9C` | `#97A3B8` | | |
| `--bad` | `#FF6B76` | `#FF7A85` | | |
| `--info` | `#6CB6FF` | `#7CBEFF` | | |
| `--violet` | `#B69CFF` | `#BDA6FF` | | |
| `--side` | `#080C14` | `#0D1423` | 3.3 | 6.4 |
| `--side-2` | `#0B111C` | `#131C30` | | |
| `--side-line` | `#172132` | `#1F2A42` | | |
| `--side-text` / `--side-text-2` | `#C9D2DE` / `#8490A2` | `#CDD5E0` / `#909CB0` | | |

New tokens:

* `--ground`: what lies behind every screen. Dark: a cobalt radial light from the top right and a faint one from the bottom
  left (`rgba(11,63,168,.34)` and `rgba(10,139,240,.09)`), drawn once on a fixed layer (`body::before`). Light: `none`.
* `--bad-ink`: the text colour on a solid `--bad` fill (the red count bubble). White on the old red was 2.8:1; the dark ink is 7.4:1.
* `--font-title`: page titles and large figures (see the rules above).

The sales pages (`.mk` in `src/features/marketing/marketing.css`) pin the same dark values and add a wide cobalt light that
returns every 3000px down the page on alternating sides, so no stretch of the page reads as one flat colour. The product
window (`.vx-frame`) takes its background from the surface tokens instead of two typed near-blacks.

Text contrast on the dark theme after the change (WCAG ratio; AA needs 4.5 for text, 3 for large text):

| Colour | on `--bg` | on `--surface` | on `--surface-2` | on `--surface-3` |
| --- | --- | --- | --- | --- |
| `--text` `#F0F4FA` | 16.0 | 14.5 | 13.0 | 10.9 |
| `--text-2` `#B9C3D3` | 10.0 | 9.0 | 8.0 | 6.8 |
| `--text-3` `#97A3B8` | 7.0 | 6.3 | 5.6 | 4.7 |
| `--accent` `#00DDFF` | 10.8 | 9.8 | 8.7 | 7.3 |
| `--ok` `#3DDC97` | 10.0 | 9.1 | 8.1 | 6.8 |
| `--warn` `#F7B955` | 10.1 | 9.2 | 8.2 | 6.9 |
| `--bad` `#FF7A85` | 7.1 | 6.4 | 5.7 | 4.8 |
| `--info` `#7CBEFF` | 9.0 | 8.2 | 7.3 | 6.1 |
| `--violet` `#BDA6FF` | 8.5 | 7.7 | 6.9 | 5.8 |

Before the change `--text-3` was 4.5 on `--surface-3`; it is 4.7 now, so the lift cost no contrast.

### Light theme fixes found while measuring

The light theme was not restyled. Four values were below AA on tinted backgrounds and were darkened:
`--accent` `#0072C6` to `#0066B3` (3.9 to 4.7 on its own soft tint), `--text-3` `#647187` to `#5C6A80` (4.4 to 4.9 on `--bg`),
`--ok` `#0E7A4B` to `#0B6A40`, and the first stop of `--grad-cta`. The sidebar, which stays dark in the light theme, now keeps
the dark theme's cyan for its active item, counts and initials (the light theme's cobalt was 3.1:1 on navy). A company colour
saved in Settings is left alone.

## LBS Command

Lion Business Services is a tax, bookkeeping, payroll and business-services firm. The owner asked for "bold and corporate, in
a metallic gradient of the Lion brand colors, with a professional layout and finish", and not a recolour of VYNTEX.

### Where it comes from

The official logo: a gold lion and a gold wordmark on a ground that runs from near-black green (`#000301`) through emerald
(`#0C3F23`) to a bronze corner (`#2B1F06`). The gold runs from deep bronze (`#6C2E01`) through `#D98909` and `#FEC848` to a
pale highlight (`#FEF8C8`). The second source is the paper such a firm works on: the ledger and the letterhead.

### The system

* **Ground**: the logo's own directional gradient, held darker than any card (`--ground`), never flat black and never flat green.
  The sidebar and the sign-in panel carry the full version, emerald and bronze corner included.
* **Gold is the only accent and it is a metal**: always a gradient from bronze through gold to the pale highlight. It is used
  for the identity (lion, lockup), the one main action, the key edges (the rule under a page title, the top edge of a figure
  tile, the rule over a totals row) and keyboard focus. Nothing else is gold.
* **A calm green marks selection**: the current page in the sidebar, the row under the pointer, the chosen search result.
* **Text is ivory**. On the light theme the paper is a pale ledger green, the ink is green-black and the action colour is bronze.
* **No cyan and no blue anywhere.**

### Shape language

Corners are rounded like the letters of the wordmark (cards 14px, controls 10px, dialogs 18px): no cut corners, no circuit
traces, no glow. The one drawn device is a ruled line taken from the letterhead and the ledger: a thick rule over a thin one
under each page title, a double rule under column heads, and a gold double rule over a totals row. Depth is a lit top edge
and a soft shadow, like embossed paper, and the main button is a bar of brushed gold.

Where each part lands:

| Part | LBS treatment |
| --- | --- |
| Corner radius | `--radius:14px`, `--radius-s:10px`, dialogs 18px, `--cut:0` |
| Card | A faint top-lit gradient from `--surface-2` to `--surface`, hairline border, lit top edge. `.card.premium` loses the cut corner and keeps a short gold rule. |
| Page title (`.page-h`) | Playfair Display, then a 2px gold rule over a 1px one, fading to the right |
| Figure tile (`.kpi`) | No cut corner; a 40px gold rule on the top edge; the figure in Playfair Display, lining and tabular |
| Primary button | Brushed gold bar, dark ink `#1C1300` (light theme: bronze bar, ivory text), bronze edge, soft bronze shadow |
| Secondary button | Emerald with an ivory hairline; the border turns gold on hover |
| Focus ring | 2px `--accent` outline, 2px offset: gold on dark (12:1 on the ground), bronze on light (5.5:1) |
| Table | Column heads in `--text-2` over a double rule; totals row under a gold double rule; hover row in calm green |
| Sidebar | The logo's ground top to bottom, a gold hairline on its edge, current page in green with a gold marker |
| Top bar | Translucent ground with a hairline; search field with the gold icon |
| Dialog, palette | 18px corners, a gilt top edge, no glow |
| Empty state | The icon in a double ring, like a seal; no circuit trace |
| Printable documents | Stay paper white; headings in deep green instead of navy |

### Tokens (dark, the default)

| Token | Value |
| --- | --- |
| `--bg --surface --surface-2 --surface-3 --surface-4` | `#06160E` `#0E2A1B` `#133423` `#1A412C` `#225138` (L* 5.8, 14.6, 18.9, 24.3, 30.7) |
| `--line --line-strong --line-chrome` | `#1E402C` `#2F5C42` `rgba(214,226,208,.24)` |
| `--text --text-2 --text-3` | `#F8F4E6` `#C5CFBF` `#9BAD99` |
| `--accent --accent-2 --accent-ink` | `#FEC848` `#D98909` `#1C1300` |
| `--cobalt --blue --cyan --ice` (bronze to pale gold) | `#6C2E01` `#D98909` `#FEC848` `#FEF8C8` |
| `--grad-chrome` (identity text) | `#FEF8C8` > `#FEC848` > `#C27A08` > `#FDE08A` > `#D98909` |
| `--grad-cta` (main button) | `#FEEFB2` > `#FAD264` > `#EAA821` > `#CF8A0B` > `#DFA01F` |
| `--rule --rule-2` (the ruled line) | `rgba(254,200,72,.62)` `rgba(254,200,72,.30)` |
| `--select`, `--blue-soft` (selection) | `#3F9A6B`, `rgba(84,176,124,.16)` |
| `--side --side-2 --side-text --side-text-2` | `#04110A` `#0A2416` `#DCE2D2` `#A3B4A0` |

The light theme redefines the same names: paper `#EDF1EA` / `#FFFEFA` / `#F5F7F1` / `#E6ECE3` / `#D8E1D5`, ink `#0A1F14` /
`#3B5244` / `#566B5C`, action `#8A5300` with ivory `#FFFDF5` on it.

### Status colours

They must not be mistaken for gold or for the emerald of the surfaces, so each sits on its own hue and none is blue.
A status always carries its word or icon as well; colour is never the only signal.

| Meaning | Dark | Hue | Light | Hue |
| --- | --- | --- | --- | --- |
| (accent, for reference) | gold `#FEC848` | 42 | bronze `#8A5300` | 36 |
| Success `--ok` | mint `#74E4B8` | 156 | `#085A3E` | 160 |
| Warning `--warn` | tangerine `#FF9052` | 22 | `#9E3A0A` | 19 |
| Danger `--bad` | rose `#FF8795` | 353 | `#B3213F` | 348 |
| Information `--info` | iris `#C9B6FF` | 256 | `#6741B8` | 259 |
| Fifth category `--violet` | orchid `#EDA4E4` | 307 | `#96309A` | 298 |

Success is a pale mint on dark (L* 84) against emerald surfaces (L* 15 to 30): the same hue family, told apart by lightness
and by always being text or a small tint, never a surface. Warning is the closest neighbour of gold (20 degrees of hue);
it is redder, more saturated and never a gradient.

### Contrast (WCAG ratio; AA needs 4.5 for text, 3 for large text and focus rings)

Dark:

| Colour | on `--bg` | on `--surface` | on `--surface-2` | on `--surface-3` |
| --- | --- | --- | --- | --- |
| `--text` `#F8F4E6` | 16.9 | 14.0 | 12.4 | 10.4 |
| `--text-2` `#C5CFBF` | 11.6 | 9.6 | 8.5 | 7.1 |
| `--text-3` `#9BAD99` | 7.8 | 6.5 | 5.7 | 4.8 |
| `--accent` `#FEC848` | 12.0 | 9.9 | 8.8 | 7.4 |
| `--ok` `#74E4B8` | 12.0 | 9.9 | 8.8 | 7.4 |
| `--warn` `#FF9052` | 8.3 | 6.9 | 6.1 | 5.1 |
| `--bad` `#FF8795` | 8.1 | 6.7 | 5.9 | 5.0 |
| `--info` `#C9B6FF` | 10.3 | 8.5 | 7.5 | 6.3 |
| `--violet` `#EDA4E4` | 9.8 | 8.1 | 7.1 | 6.0 |

Ink `#1C1300` on the gold button: 6.4 at its darkest stop, 15.9 at its lightest. Sidebar text `#DCE2D2`: 9.1 on the emerald
end of the sidebar, 15.2 on the dark end; sidebar captions `#A3B4A0`: 5.5 on the emerald end.

Light:

| Colour | on `--bg` | on `--surface` | on `--surface-2` | on `--surface-3` |
| --- | --- | --- | --- | --- |
| `--text` `#0A1F14` | 15.1 | 17.1 | 16.0 | 14.3 |
| `--text-2` `#3B5244` | 7.4 | 8.4 | 7.9 | 7.1 |
| `--text-3` `#566B5C` | 5.0 | 5.7 | 5.3 | 4.8 |
| `--accent` `#8A5300` | 5.5 | 6.3 | 5.9 | 5.3 |
| `--ok` `#085A3E` | 7.2 | 8.2 | 7.7 | 6.9 |
| `--warn` `#9E3A0A` | 6.0 | 6.8 | 6.4 | 5.7 |
| `--bad` `#B3213F` | 5.7 | 6.5 | 6.1 | 5.4 |
| `--info` `#6741B8` | 6.1 | 6.9 | 6.4 | 5.8 |
| `--violet` `#96309A` | 5.8 | 6.5 | 6.1 | 5.5 |

Ivory `#FFFDF5` on the bronze button: 5.1 at its lightest stop, 8.0 at its darkest.

These are computed from the token values. The rendered screens were also measured (text colour against the pixels behind
it) on the workspace pages in both themes at 1440, 390 and 360 pixels wide: no text below AA.

### Type

* Playfair Display 700: page titles (`h1`), section titles (`h2`), large figures, the product name in the lockup.
* Poppins 400, 500, 600: everything else. Only these three weights are requested, on purpose: the interface asks for 650,
  700 and 800 in places, and with 600 as the heaviest Poppins they all settle on semibold, which keeps a dense screen calm.
* Figures in Playfair are set `lining-nums tabular-nums` so columns of money line up.
* The page shell of the LBS deployment (`public-lbs/index.html`) must request:
  `https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Poppins:wght@400;500;600&display=swap`
* Until the fonts arrive, or when they are blocked, two stand-ins defined in `theme-lbs.css` are used: `LBS Serif Fallback`
  (Times New Roman or Liberation Serif, size-adjusted 111.26%) and `LBS Sans Fallback` (Arial or Liberation Sans,
  size-adjusted 112.16%). Their metrics are matched to the real faces, so text does not reflow when the fonts load.

### The company colour

The workspace frame writes the company's saved accent colour inline, and Settings derives the button from it. In the LBS
deployment the brand decides: `theme-lbs.css` restates the four accent tokens on `.shell` with priority, so gold stays gold
whatever the company record holds. The accent picker in Settings therefore has no effect in LBS and should be hidden there.

### Sign-in frame

`AuthFrame` puts the brand panel beside the form on wide screens and above it under 900px. The panel is always dark, like
the sidebar. LBS: the logo's ground, the lion large, the official wordmark, the letterhead rule and "LBS Command". VYNTEX:
navy with the cobalt light and faint grid of the sales pages, the V mark and the lockup. No slogan, statistic or claim in
either. The only motion is one short fade of the identity when the page opens; with reduced motion it is still.

## Motion

Unchanged, and the same for both brands: the tokens and rules in `docs/CONVENTIONS.md`. LBS adds no ambient motion.
`prefers-reduced-motion: reduce` stops everything (`tests/qa_motion.py`).
