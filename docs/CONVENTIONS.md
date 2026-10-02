# Build conventions

Read this before touching the code. It is short on purpose.

## The one rule

**One codebase, one selected industry pack.** The app core never checks which industry is selected.
Anything that differs by industry is data in `src/packs/<id>/` (wording, service types, documents, task templates, KPIs, sample business).
If you catch yourself writing `if (pack.id === 'clean')`, stop and add a field to the pack instead.

## Where things live

| Folder | What it holds |
| --- | --- |
| `config/vyntex-build-pricing.json` | The commercial source of truth. Never edited by code. |
| `src/lib/pricing.ts` | The only reader of the pricing file. Every price, plan name, allowance and rule comes from here. |
| `src/domain/` | Data model (`types.ts`), business actions (`actions.ts`), calculations (`selectors.ts`), automation rules, role permissions, entitlements. No React. |
| `src/packs/` | Industry packs: `pack.ts` (configuration) and `seed.ts` (fictional sample business). |
| `src/store/store.ts` | Demo-mode state (browser only). `useStore`, `act`, `mutate`, `setPrefs`, `switchPack`, `resetDemo`. |
| `src/app/` | Shell, router, `useApp()` hook, shared record components. |
| `src/ui/` | Design system: `styles.css` and the React primitives in `index.tsx`. |
| `src/features/<name>/` | One folder per module: `index.tsx` (page), `i18n.ts` (wording EN + ES), optional `<name>.css` and helper files. |
| `api/` | Server functions (Vercel). Secrets only from environment variables. |
| `supabase/migrations/` | Production database with tenant isolation. |

## Writing a page

```tsx
import { useApp } from '@/app/hooks';          // data, t, pack, lang, can, plan, standing, date/day/dateTime/time formatters
import { act, mutate } from '@/store/store';   // act(action, ...args) runs a domain action and saves
import { A, go, appPath } from '@/app/router'; // <A to="/jobs/j1"> links inside the workspace; go('/jobs/j1') navigates
import { PageHeader, Card, Button, Badge, Stat, Empty, Seg, Tabs, SearchBox, FormModal, Modal, Menu, toast, confirmDialog } from '@/ui';
import type { PageProps } from '@/app/routes'; // { id?: string; sub?: string }

export default function JobsPage({ id }: PageProps) {
  const { data, t } = useApp();
  if (id) return <JobDetail id={id} />;
  ...
}
```

* Change data only through `act(someAction, ...)` from `src/domain/actions.ts` (it logs activity and fires automations) or, for a one-off, `mutate(d => { ... })`.
  If you need a new business action, add it to **your own** `src/features/<name>/actions.ts` with the same `(d: DemoState, ctx: Ctx, ...args)` signature and use `logActivity` from `@/domain/context`.
* Read derived numbers from `src/domain/selectors.ts` (`jobMoney`, `clientMoney`, `workerMoney`, `calendarEvents`, `notices`, `kpiValues`, ...). Do not re-implement a calculation that exists there.
* Money: store numbers, show with `money()` (no cents) or `money2()` (cents) from `@/lib/money`. Parse typed amounts with `parseMoney`.
* Dates: `YYYY-MM-DD` strings. Use `today()`, `addDays()`, and the `date()/day()/dateTime()/time()` formatters from `useApp()`.
* Shared record pieces are in `@/app/shared`: `JobStatusBadge`, `LeadStageBadge`, `TaskStatusBadge`, `DocStatusBadge`, `PriorityBadge`, `DueBadge`, `W9Badge`, `InsuranceBadge`, `PlanBadge`, `DemoTag`, `ContactLinks`, `ActivityList`, `NotesPanel`, `TaskRow`, `NoAccess`.
* Shared forms are in `@/app/forms`: `TaskFormModal` (add or edit a task), `ClientPaymentModal` (record money received for a job), `PayWorkerModal` (pay a worker, split across jobs), plus `PAY_METHODS`, `PAY_TYPES`, `TASK_STATUSES`. Use them instead of building your own.
* Icons: `react-icons/lu` only (Lucide). Decorative icons get `aria-hidden="true"`.

## Wording (EN + ES)

* No visible text in JSX. Everything goes through `t('key')`.
* Each feature owns `src/features/<name>/i18n.ts` exporting `dict: Dict = { en: {...}, es: {...} }`. Prefix keys with the feature name: `jobs.newJob`.
* **Never write an industry word.** Use tokens, which are replaced with the selected industry's wording:
  `{job} {jobs} {Job} {Jobs}`, `{worker} {workers} {Worker} {Workers}`, `{client} {clients} {Client} {Clients}`, `{product}`.
  Example: `'jobs.new': 'New {job}'` reads "New project" in BUILD and "New service" in CLEAN.
* Existing keys to reuse: `common.*`, `nav.*`, `ts.*` (task status), `pr.*` (priority), `doc.kind.*`, `doc.status.*` in `src/i18n/app.ts`; job status `st_<status>`, lead stage `ls_<stage>`, lead source `src_<source>`, pay method `m_<method>`, pay type `pt_<type>`, note kind `nk_<kind>`, service type `ty_<id>` in `src/i18n/base.en.ts`.
  Careful: some older keys in `base.en.ts` contain BUILD words ("project", "subcontractor"); packs override the ones the original demo used. For new text, write a new key with tokens.
* Spanish must read as written by a native professional (US Hispanic business Spanish, "usted" in the interface). Not a word-for-word translation.
* No em dashes or en dashes in any text. Use commas or rewrite the sentence.
* Copy is plain and specific. Buttons say what happens ("Record payment", not "Submit"). No "seamless", "powerful", "revolutionary", "supercharge".
* Never show developer words to the user: tenant, schema, payload, RLS, JSON, API, webhook, config, seed, mock.
* Run `node scripts/check-i18n.mjs` before you finish: every English key needs a Spanish twin and every literal `t('...')` key must exist.

## Honest states (this matters commercially)

* Nothing in the demo leaves the browser. When an action would send, charge, sign or sync in production, show `<DemoTag />` (Demo simulation), `<DemoTag kind="connect" />` (Connect during setup) or `<DemoTag kind="preview" />` next to it.
* Never show "Connected", "Sent", "Paid by card" or "Signed" as real. Demo e-signatures carry `demo: true` and are labelled as a demo.
* What a capability costs comes from `standing('<entitlementId>')` in `useApp()` and is shown with `<PlanBadge feature="..." />`:
  Included, Included from <plan>, Available add-on, Usage-based, Custom quote, Preview. See `src/domain/entitlements.ts`.
  Never type a price, plan name or allowance in a feature. Never present the client portal as included or priced.
* No dead buttons. If a control is on screen it does something real in the demo, or it is clearly labelled with one of the tags above and explains what happens in production.
* All sample people and companies are fictional: 555 phone numbers, example.com emails, "Sample" street names.

## Roles

`can('<permission>')` from `useApp()` (see `src/domain/permissions.ts`). Owner sees everything; Manager has no Settings and no profit numbers (`can('profit')`); Office staff has no money, team, reports, automations or compliance. Workers only see the portal.
Hide money and profit figures when the role lacks `money` / `profit`. Hide delete buttons when the role lacks `delete`.

## Design system

Dark first. Tokens are CSS variables in `src/ui/styles.css` (`--bg --surface --surface-2 --surface-3 --line --line-strong --text --text-2 --text-3 --accent --ok --warn --bad --info --violet` and their `-soft` versions). A light theme flips the same tokens, so **never hard-code a colour**; use the variables.

Classes you can use directly: `.btn(.primary .ghost .outline .danger .sm .lg .block)`, `.iconbtn`, `.linkbtn`, `.card(.flush)`, `.card-h`, `.note(.warn .bad)`, `.badge(.ok .warn .bad .info .violet .accent .outline)`, `.dot`, `.count`, `.kpis` + `.kpi(.attn)`, `.field`, `.input`, `.fgrid`, `.check`, `.searchbox`, `.filters`, `.seg`, `.tabs`, `.table-wrap` + `table.tbl.stackable` (stacks into cards on phones; put `data-label` on each `td`, class `t1` on the title cell), `.list` + `.item(.click .done)`, `.avatar`, `.kv`, `.empty`, `.bar` + `.legend`, `.timeline`, `.kanban` + `.kcol` + `.kcard`, `.modal`, `.menu`, `.row(.tight .between .top .nowrap)`, `.stack(.tight)`, `.grid2`, `.grid3`, `.split`, `.muted .dim .small .xs .strong .num .pos .neg .nowrap .grow .clip .sr`, `.cut` (the chamfered brand corner; use it sparingly), `.paper` (printable document), `.no-print`.

Feature-specific styles go in `src/features/<name>/<name>.css`, imported from that feature's `index.tsx`, with class names prefixed by the feature (`.jobs-...`).

* Every page works at 360px wide, 768px and 1440px. No horizontal page scroll. Tables use `.tbl` so they stack on phones.
* Keyboard: everything reachable by Tab, visible focus, Esc closes overlays. Clickable rows are real `<a>` or `<button>` elements.
* Every list has an empty state that says what to do next. Every filter has a "no matches" state with a way to clear it.
* Put `data-testid` on the main controls of your page (kebab-case, feature-prefixed: `jobs-new`, `jobs-filter-status`).

## Reference implementation

`src/features/leads/` is the model to follow: list with filters, table and board views, detail page, forms, empty and no-match states, honest wording, test ids.

## Checks before you are done

```
node scripts/build.mjs --out /tmp/<your-own-folder>    # must build
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.local.json   # no errors in your files
node scripts/check-i18n.mjs
node scripts/check-pricing.mjs
```

Then open your pages in a browser (`DIST=/tmp/<your-own-folder> PORT=<your-port> node scripts/serve.mjs`, Playwright with
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) in at least two industries, both languages, desktop and phone width, and look at the screenshots.
