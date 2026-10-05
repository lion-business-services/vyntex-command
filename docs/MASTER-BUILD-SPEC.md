# VYNTEX Command: master build specification

Engineering contract for the integrated build ordered in the owner's brief (111 sections):
`/root/.claude/uploads/94014889-6396-5951-a153-f13fef057bc9/2b66d966-attachment.txt` (cited below as "brief §N").
The owner's words win over this file. This file wins over habit. The data model is `src/domain/types.ts` (already extended);
this file says how everything else fits around it.

## 0. Rules that never bend

1. One codebase, one platform. VYNTEX Command stays the principal codebase. NOVA is not embedded; its business rules are ported
   as configuration and domain logic (brief §1, §5, §100).
2. Keep what works. The eight field editions, every route, every `data-testid`, both languages and the three QA suites
   (`tests/qa_matrix.py`, `qa_flows.py`, `qa_motion.py`) keep passing. An upgrade, never a rewrite.
3. Never invent content: no made-up clients, metrics, testimonials, tax rates, legal wording, prices or plan contents.
   Sample records are fictional and labelled as sample. Prices of the eight editions render only from `src/lib/pricing.ts`.
   The new edition is not in the pricing file, so it shows no plan and no price (see §2).
4. Never fake a live connection (brief §107). In demo and preview a connection is never `connected`. A message is `demo`,
   never `sent`. Server-only states are set by the server only.
5. No secrets, no real client data in the repository. Tax IDs never appear in logs, URLs, browser storage, analytics or
   error reports (brief §11, §55, §104). The demo stores the type and last four digits only.
6. Nothing is deployed, pushed, or changed on a live system by this build. Live NOVA is read-only for us.
7. Security is enforced by the server and the database. The browser hides what a role may not use, and the database
   refuses it (brief §51, §52).
8. Copy: plain, sentence case, no em or en dashes, Spanish written natively (workspace uses "usted"). No all-caps eyebrows,
   no decorative numbering. See `scratchpad/BRIEF2.md` for the design system and motion rules; they still apply.

## 1. Two deployments from one codebase (brief §3, §53, §82)

Build flag `VX_DEPLOY` (environment variable or `--deploy <id>` on `scripts/build.mjs`), passed to the bundle as the
constant `__VX_DEPLOY__`. `VX_SAMPLE_PREVIEW=1` becomes `__VX_SAMPLE_PREVIEW__`.

`src/config/deployment.ts` exports `DEPLOY: Deployment`:

```ts
export type DeployId = 'vyntex' | 'lbs';
export interface Deployment {
  id: DeployId;
  productName: string;            // 'VYNTEX Command' | 'LBS Command'
  theme: 'vyntex' | 'lbs';        // sets <html data-brand>
  lockedEdition: IndustryId | null;   // lbs: 'practice'
  marketing: boolean;             // sales pages exist
  publicDemo: boolean;            // /demo exists
  samplePreview: boolean;         // /preview exists: sample records, clearly labelled, test builds only
  showPlans: boolean;             // plan badges, upgrade hints, pricing links
  languages: Lang[];              // vyntex: en, es. lbs: en, es, zh
  liveBase: 'slug' | 'app';       // vyntex: /<company-slug>. lbs: /app
  support: { email: string; phone: string };
  quickLinks: { id: string; label: L10n; url: string }[];   // lbs: bookkeeping and payroll client links (from env at build; empty = shown as "not set")
}
```

| | `vyntex` (default) | `lbs` |
|---|---|---|
| Public address (example) | command.vyntexusa.com | lbscommand.vyntexusa.com |
| `/` | sales overview | sign-in |
| Sales pages, pricing, public demo | yes | no (routes do not exist in the bundle's router) |
| Live workspace | `/<company-slug>/...` | `/app/...` |
| Sample preview | `/demo` | `/preview`, only when built with `VX_SAMPLE_PREVIEW=1` |
| Edition | per company | locked to `practice` |
| Plans and prices | shown | hidden |
| Brand | chrome and cyan on graphite/navy | emerald and gold metallic, Playfair Display + Poppins |
| Database, auth, storage, secrets, logs, backups | VYNTEX Supabase project and Vercel project | separate Supabase project and separate Vercel project |

Static files: `public/` is shared; `public-lbs/` is copied on top for the lbs build (its own `index.html`, icons, `brand-lbs/`).
Outputs: `dist/` (vyntex), `dist-lbs/` (lbs) unless `--out` is given. One `vercel.json`; each Vercel project sets `VX_DEPLOY`.
Neither bundle contains the other's brand assets, product name or routes; `tests/deploy_split.mjs` greps the outputs to prove it.

Router (`src/app/router.tsx`): `APP_BASE` becomes `appBase()`, resolved from the address and the deployment:
`/demo` or `/preview` (sample mode), `/<slug>` or `/app` (live mode). `appPath`, `go`, `A` keep their signatures.
`src/platform/mode.ts` learns the lbs layout; `RESERVED_SLUGS` gains `preview`, `review`, `book`, `mfa`.

Shared public routes in both deployments: `/signin`, `/invite/<token>`, `/reset-password`, `/sign/<token>` (signing page),
`/review/<token>` (review page).

## 2. The ninth edition and the edition blueprint (brief §2, §6)

Edition id `practice`, working product name **VYNTEX PRACTICE** (not approved by the owner; one constant, easy to rename;
"Pro" is avoided because it is a plan name). `priced: false`: it is absent from the pricing file, so the pricing page lists it
as "quoted", plan pickers hide for it, and `planByTier` is never called for it. `scripts/check-pricing.mjs` learns that an
unpriced edition is allowed only when its pack says so.

`IndustryPack` (`src/packs/types.ts`) gains the blueprint. Existing packs get these through `fieldDefaults()` in
`src/packs/blueprint.ts`, so each of the eight keeps a small file and identical behaviour.

```ts
family: 'field' | 'practice';
priced: boolean;
modules: ModuleId[];                 // which screens exist in this edition, in menu order per group
leadStages: StageDef[];              // field editions: new, contacted, scheduled(visit), sent(proposal), won, lost (ids unchanged)
leadSources: OptionDef[];
lostReasons: OptionDef[];
taskTypes: OptionDef[];              // always includes 'todo'; practice adds 'client_request', 'call', 'document', 'review'
clientTypes: OptionDef[];            // practice: individual, sole_prop, llc, s_corp, c_corp, partnership, nonprofit
roleLabels: Record<OfficeRole, L10n>;
rolePermissions: Record<OfficeRole, Permission[]>;
docKinds: DocKind[];
appointmentTypes: Omit<AppointmentType, 'id'>[] ;   // starter set copied into a new company
rules: RuleDef[];                    // shipped automations for the edition
usesWorkers: boolean;                // field: true. practice: false (no subcontractor screens, no worker portal)
// existing fields stay: id, product, label, blurb, ticketPrefix, recurring, sampleCompany, serviceTypes, terms, jobStatuses,
// kpis, agreement, kickoffTasks, closeoutTasks, compliance, grammar
```

Practice edition wording (terms): job = engagement, jobs = engagements, worker screens absent, "visit" = appointment.
Practice lead stages (brief §7), editable per company: New, Contacted, Appointment Set, Proposal Sent, Negotiating, Won, Lost.
Practice roles (labels): Owner, Senior associate (`manager`), Associate (`staff`), Read only (`readonly`).

Company configuration lives in `data.config: CompanyConfig` and is read only through `src/domain/config.ts`:

```ts
stagesOf(d, pack): StageDef[]          stageOf(d, pack, id): StageDef | undefined
isOpen(d, pack, stageId) / isWon / isLost / stageByRole(d, pack, role)
sourcesOf, lostReasonsOf, taskTypesOf, clientTypesOf (d, pack): OptionDef[]
moduleOn(d, pack, id: ModuleId): boolean
roleLabel(d, pack, role, lang): string
permissionsOf(d, pack, role): Permission[]      // edition matrix, then company override; owner is never reduced
routingOf(d): LeadRouting                        // defaults: manual, empty pool
```

Code must never compare a lead status to a literal such as `'won'` again; it asks `isWon()`. The field editions keep the
same six stage ids, so saved demo data and the seeds stay valid.

`pick(l10n, lang)` in `@/i18n` reads an `L10n` with English fallback. `makeT` falls back to English for a missing `zh` key.

## 3. Roles and capabilities (brief §51)

`OfficeRole = owner | manager | staff | readonly` (+ worker portal). `Permission` in `src/domain/permissions.ts` gains:

`appointments, catalog, opportunities, reviews, integrations, social, comms, esign, cash, payroll, bookkeeping, licensing,
deadlines, users, audit, export, import, config, assignLeads, allClients, credits, secureView, secureReveal, secureApprove, write`

`write` is the general "may change records" capability; `readonly` has every viewing capability a staff member has and
lacks `write`. Every action button and every action function checks `write` (or a more specific capability).
`can(p)` from `useApp()` resolves through `permissionsOf(data, pack, role)`. The same names are used by `app.can()` in the
database, and `supabase/tests/parity.mjs` compares the two matrices per edition.

Office scoping (ported from NOVA): a client with an `officeId` is visible to people of that office, to anyone with
`allClients`, and to people holding an `AccessGrant`. A client without an office is visible to everyone in the company.
Others see the name only and can file an `AccessRequest`. Selector: `visibleClients(d, user, perms)` in `src/domain/access.ts`.

## 4. Module registry

`src/app/modules.ts` is the one list of screens. Each entry: `{ id: ModuleId | 'dashboard', path, perm, group: 'work' |
'business' | 'system', icon, labelKey, page: lazy(...), count?(app) }`. `Shell` builds the menu from it, filtered by
`moduleOn()` and `can()`. `routes.tsx` derives `PAGES` from it. A module owns `src/features/<id>/` with `index.tsx`,
`i18n.ts`, `<id>.css`, and its actions in `src/domain/actions/<area>.ts`.

Other extension points, each a plain registry file that module agents append to in their own feature folder and that
Foundation pre-wires with stubs so later agents never edit shared files:

* `src/app/search.ts`: `SearchProvider[]` for the command palette (brief §38).
* `src/features/clients/tabs.ts`: client profile tabs (brief §10): overview, engagements, appointments, tasks, documents,
  billing, communications, notes, opportunities, activity, secure. Each tab component lives in its module's folder as
  `ClientTab.tsx` and is imported lazily.
* `src/features/settings/panels.ts`: settings sections.

Routes added: `/appointments`, `/catalog`, `/opportunities`, `/reviews`, `/esign`, `/integrations`, `/social`, `/cash`,
`/payroll`, `/bookkeeping`, `/licensing`, `/deadlines`, `/security`, `/audit`. `/messages` becomes the communications center.

## 5. Store, sample mode and live mode

`src/store/store.ts` keeps its API (`useStore`, `act`, `mutate`, `mutateQuiet`, `ctx`, `ready`, ...). `DATA_VERSION` 7.
`freshData` fills every `ModuleCollection` with `[]`, `config` with `{}`, and copies the edition's starter appointment types,
rules and templates.

`src/platform/session.ts`: `isLive(): boolean`, `session(): WorkspaceSession | null`. In live mode:

* `uid()` returns `crypto.randomUUID()` (the prefix is ignored); the database keys are UUIDs.
* the store starts from `gateway.load()` instead of a seed, never touches localStorage for business data, and after every
  commit calls `syncSoon()`: `src/platform/diff.ts` compares the committed state with the last acknowledged state per
  collection by `id` and produces `Op[] = { c: collection, op: 'upsert' | 'delete', id, row? }`; the gateway posts them to
  `/api/ws/apply`. Rejected ops roll the collection back to the server's copy and show a toast with the reason.
* protected things are not ordinary ops and have their own gateway methods (§7): tax-ID vault, member and invitation
  management, appointment payment and credits, access approvals, exports, connections, sending anything outside.
  In sample mode the same UI calls sample implementations that are labelled as such.

`src/platform/gateway.ts` grows from types into the real client contract; `src/platform/live/` holds the fetch
implementation; `src/platform/sample.ts` holds the sample-mode implementation of the protected operations.

## 6. Server (brief §47 to §50, §63 to §67, §89, §92)

The browser never talks to Supabase or to a provider. CSP stays `connect-src 'self'`. Vercel functions, Web-API style,
few entry points with path rewrites (stay under 12 functions):

| File | Addresses |
|---|---|
| `api/auth.js` | `/api/auth/{signin,mfa/verify,mfa/enroll,mfa/confirm,mfa/recovery,signout,signout-all,session,invite/accept,password/reset,password/update,stepup}` |
| `api/ws.js` | `/api/ws/{load,apply}` and `/api/ws/rpc/<name>` (allow-list) and `/api/ws/file/{upload,url}` |
| `api/integrations.js` | `/api/integrations` (list), `/api/integrations/<provider>/{connect,callback,disconnect,sync,test}` |
| `api/webhooks.js` | `/api/webhooks/<provider>` |
| `api/cron.js` | `/api/cron/<job>` (Vercel Cron, secret header) |
| `api/public.js` | `/api/public/{sign,review,intake,book}/...` (token addressed, rate limited) |
| existing | `api/assistant.js`, `api/demo-request.js`, `api/health.js` |

Shared code in `api/_lib/`: `request.js` (exists), `env.js`, `supabase.js` (fetch client for GoTrue and PostgREST: no SDK),
`session.js`, `csrf.js`, `ratelimit.js`, `crypto.js`, `audit.js`, `jobs.js`, `integrations/{core,oauth,store,webhook}.js`,
`integrations/providers/<id>.js`.

Session: after sign-in the Supabase access and refresh tokens are sealed (AES-256-GCM, key from `SESSION_SECRET`) into an
`HttpOnly; Secure; SameSite=Lax; Path=/` cookie (`__Host-vx` in production). Refresh rotation on use; idle timeout from
company config (default 30 minutes) enforced server side with a sealed last-activity stamp; `signout-all` revokes refresh
tokens. State-changing requests require a same-origin `Origin` and the `x-vx-csrf` header matching the csrf cookie.
No public sign-up route exists; accounts come from invitations created by a user with `users`. MFA: TOTP through GoTrue's
factor endpoints, recovery codes hashed in our table; roles listed in `config.security.mfaRoles` (lbs default: all office
roles) cannot load a workspace below `aal2`. Sensitive actions require a fresh step-up (re-verify within 5 minutes).
Every auth event is audited. Rate limits: per address and per account, stored in the database (`app.rate_hit`).

Local proof without Supabase: `scripts/dev-supabase.mjs` imitates GoTrue (`/auth/v1/*`, HS256 tokens, TOTP) and
PostgREST RPC (`/rest/v1/rpc/*`) over the local PostgreSQL from `supabase/tests/run_local.sh`. It is a test double, named
as one everywhere; reports say "proved against the local stand-in", never "tested on Supabase".

## 7. Database (brief §52, §60, §102)

Existing migrations 0001 to 0009 stay untouched. Inspect them before writing. New files, by owner:

| Range | Content |
|---|---|
| `0010`–`0019` | roles (`readonly`), edition blueprint in the database (`practice` industry, per-tenant `config`), configurable stages (replace fixed checks with config-validated values), new columns on existing tables, `app.ws_load()`, `app.ws_apply()`, public wrappers |
| `0020`–`0029` | server core: invitations, MFA recovery codes, sessions and step-up, rate limits, idempotency keys, job queue with locks, integration connections with encrypted tokens, OAuth state, webhook event log, audit additions |
| `0030`–`0049` | module tables: offices, grants, catalog, playbooks, appointment types, appointments, credits, cross-sell, opportunities, reviews, templates, envelopes, social posts, cash, deadlines, rules, vault, protected RPCs |
| `0050`–`0059` | provider-specific tables (sync maps, message threads, call log) |
| `0060`–`0069` | migration staging for LBS (import batches, source maps, dry-run reports) |

Conventions: uuid keys; `tenant_id` on every row with composite foreign keys; forced row level security with policies
written against `app.can()`; `created_at`, `updated_at`; soft references validated in the same tenant; money `numeric(12,2)`;
typed columns for keys, statuses, dates, money and anything filtered or reported on; one `extra jsonb` column per table for
presentation attributes the app adds later (the gateway round-trips unknown fields through it, so the app and database
cannot drift apart silently). Sensitive values use `app.encrypt_pii`. Functions are `security invoker` unless they must not
be, have a fixed `search_path`, and execute is granted to `authenticated` only (never `anon`, except token-addressed public
RPCs that take an unguessable token and are rate limited).

Gateway RPCs (public schema wrappers, called by `api/ws.js` with the user's token):

* `ws_load(p_tenant uuid) returns jsonb`: the `WorkspaceData` object, filtered by role and office scope, tax IDs never included.
* `ws_apply(p_tenant uuid, p_ops jsonb, p_idem text) returns jsonb`: applies ops in one transaction. Per collection it
  checks the capability, validates the row, maps fields to columns, stamps the actor, writes the audit entry, and returns
  `{ ok, applied, rejected: [{ id, c, reason }], server: { <collection>: [rows changed by triggers] } }`.
  Read-only collections through this path: `audit`, `secureLog`, `reveals`, `credits`, `connections`, `grants`, `users`.
* protected RPCs: `vault_set`, `vault_request`, `vault_decide`, `vault_reveal` (returns the value once, logs it),
  `member_invite`, `member_set_role`, `member_disable`, `grant_decide`, `appt_mark_paid`, `appt_cancel` (issues a credit when
  the staff cancels a paid appointment), `credit_apply`, `credit_void`, `cash_close`, `export_request` (audited), `lead_assign_next` (round robin
  with a row lock so two leads never get the same turn).

Tests extend `supabase/tests/`: isolation between two tenants for every new table, role matrix, office scope, vault flow,
idempotency, the gateway round trip for every edition's sample business (`tests/gateway_roundtrip.mjs`: load a seed through
`ws_apply`, read it back with `ws_load`, compare).

## 8. Integrations (brief §19 to §33, §65 to §69, §107)

One adapter shape, `api/_lib/integrations/providers/<id>.js`:

```js
export default {
  id, name, kind: 'oauth' | 'key' | 'platform',
  env: ['GOOGLE_CLIENT_ID', ...],            // what must be configured; missing => state stays not_connected with reason 'not_configured'
  scopes: [...], approval: null | { needed: true, note },   // provider review needed => 'pending_approval' until env says approved
  authUrl(ctx), exchange(ctx, code), refresh(ctx, tokens), revoke(ctx, tokens),
  status(ctx), health(ctx), sync(ctx, what), webhook: { verify(req, raw), handle(ctx, event) },
  actions: { sendEmail?, createEvent?, charge?, publish?, sendMessage?, placeCall?, ... }
}
```

Core guarantees: OAuth with PKCE and signed `state`, server-side code exchange, tokens encrypted at rest and never sent to
the browser, automatic refresh, webhook signature verification, replay window, idempotency by provider event id, an event
log, retries with backoff through the job queue. Every adapter has unit tests with a mocked `fetch`
(`tests/integrations/*.test.mjs`, Node's built-in test runner). The Integrations screen shows the states from `ConnState`
and the exact reason for each. "Tested with mocked provider responses" is how these are reported until credentials exist.

Providers: gmail, resend, gcal, gmeet, gbp, gmaps, square, quickbooks, whatsapp, meta, dialpad, sms, ai.
Reference implementations to port from (Netlify functions): `/home/claude/agc/netlify/functions/_lib/`.

## 9. Automation (brief §35 to §37)

One engine, `src/domain/rules/engine.ts`, shared by the browser (sample mode) and the server jobs: `emit(d, ctx, event,
subject)` finds active `RuleDef`s for the event, evaluates `if`, runs `then` steps, and writes one `AutomationRun` with a
dedupe key. The eight existing coded rules become shipped `RuleDef`s whose step is `builtin` (behaviour unchanged, so the
field editions' flows and their tests do not move), and the builder can add generic steps around them.

## 10. Files and ownership

Agents edit only what their assignment lists. Shared files (`types.ts`, `store.ts`, `modules.ts`, `Shell.tsx`,
`styles.css` tokens, `packs/types.ts`, `i18n/index.ts`) belong to Foundation; anyone else who needs a change there writes it
in their report instead of editing. Each agent builds into its own folder (`--out`), uses its own port, and never rebuilds
`dist/`. Do not use `pkill -f`; stop servers by PID.

## 11. Verification an agent must run before reporting

`npm run typecheck:local` (clean for the files you own), `node scripts/build.mjs --out <yours>` for both deployments when
you touched the frontend, `npm run check`, and the tests for your area. Look at your screens with Playwright
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) at 1440, 1024 and 390 wide in English and Spanish, as owner and as a
restricted role. Report: what you built, what you proved and how, what is not proved, what you need from someone else.
