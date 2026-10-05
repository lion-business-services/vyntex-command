# VYNTEX Command master build: completion report

Date: October 5, 2026. Scope: the first integrated build ordered in the 111-section master brief.

**Bottom line.** One codebase now builds two separate products: VYNTEX Command (nine editions, for client companies) and LBS Command (standalone, Lion Business Services brand). Every screen works with sample records, the database and server are built and pass their tests on a local stand-in, and thirteen provider adapters are written and tested with mocked responses. Nothing has been deployed, pushed, or connected to a live provider, and no real client data has been touched. The three security gaps in the live NOVA database are still open and need your approval to close.

## 1. Architecture

| Item | What was built |
|---|---|
| Codebase | One repository, VYNTEX Command. NOVA is not embedded; its rules were ported as configuration and domain logic. |
| Deployments | A build switch (`VX_DEPLOY`) produces two bundles. Neither contains the other's brand, product name or routes (79 automated checks). |
| VYNTEX Command | Sales pages, public demo, live workspace per company at `/<company>`. Example address: command.vyntexusa.com. |
| LBS Command | Sign-in at `/`, workspace at `/app`, no sales pages, no demo, no plans, edition locked to professional services. Example address: lbscommand.vyntexusa.com. |
| Databases | Same schema, two Supabase projects: one for VYNTEX client companies, one dedicated to LBS with its own secrets, storage, logs and backups. Neither project has been created yet (cost and your approval). |
| Tenancy | Every row carries its company. 55 tables, 175 row level security policies, all forced. Office scope inside a company (ported from NOVA). |
| Editions | Nine: BUILD, CLEAN, LANDSCAPE, WASH, HAUL, SNOW, TURNOVER, EVENTS, and the new professional-services edition. Menu, wording, stages, sources, roles, documents, appointment types and automations come from the edition, then from each company's own settings. |
| Browser to server | The browser never talks to Supabase or a provider. All calls go through the platform's own server with sealed cookies. |

Decision needed: the ninth edition's product name. The working name "VYNTEX PRACTICE" is one constant. It has no plans or prices because it is not in the pricing file; the pricing page shows it as quoted on request.

## 2. NOVA migration

**Logic moved into the platform:** the seven lead stages (now editable), sources and lost reasons, round-robin assignment with pool, order, exclusions, away dates and fallback, handoff history, individual and business clients with owners and contacts, office-based client access with access requests, the service catalog with price tiers, playbooks, appointment types with fees, prepayment deadlines, credits and no-show rules, cross-sell rules, the tax-ID vault, review requests, English, Spanish and Chinese (Chinese falls back to English where not yet written).

**Data migrated: none.** The migration tool is built and proved on generated data only: 87 of 87 checks, including insert-only loading, a rerun that adds nothing, rollback that restores the target exactly, and source checksums identical before and after. It follows your ten steps: backup, staging, dry run, report, approval token, insert only, reconcile, NOVA left untouched.

**Deliberately not carried over:** open sign-up, functions callable without sign-in, public storage, the incomplete ticket module (replaced by client requests in Tasks), the five sample services and one sample lead, and cross-sell rules that matched no service. Invoices and payments are listed for your review instead of loaded, because each must be tied to an engagement.

**Still open on live NOVA:** client names readable without sign-in, open sign-up, and about 200 real customers in the NOVA Git history. The fix and its rollback are in `deploy/nova-containment/`. My one attempt to apply it was cancelled before it ran; nothing changed on NOVA.

## 3. Modules

Status key: **Sample** = complete and tested with sample records in both deployments. **Live proved** = also driven through the server and database on the local stand-in.

| Module | Status |
|---|---|
| Leads, pipeline settings, routing, handoffs | Sample. Live proved for create, edit, reload. |
| Clients, profile tabs, duplicates, merge, office access | Sample. Live proved for create, edit, reload. |
| CSV import and export (clients, leads, catalog, deadlines) | Sample |
| Service catalog, tiers, playbooks | Sample; database round trip proved |
| Engagements, repeating work, won-lead workflow | Sample. Live proved for create and reload. |
| Appointments, prepayment, credits, calendar | Sample; database functions proved, including two sessions spending one credit |
| Tasks, client requests, comments, mentions, notifications | Sample |
| Documents, templates, uploads, versions | Sample |
| E-signature: field placement, signing page, certificate | Sample. Server signing proved on the stand-in. Live sending from the browser is written but switched off until one browser pass proves it. |
| Communications center, templates, notices | Sample |
| Integrations screen, social module | Sample (every provider honestly "not connected") |
| Rule engine, 29 shipped rules for the edition, builder, history | Sample. The engine does not yet run on the server for time-based events. |
| Cross-sell and opportunities, review requests | Sample; review server endpoints proved on the stand-in |
| Tax-ID vault | Sample; database functions proved (value never stored or logged in clear, one viewing, requester cannot approve) |
| Security center, roles and permissions, offices, audit trail | Sample |
| Settings and company customization | Sample |
| Reports, payments, petty cash with daily close, deadlines | Sample |
| Payroll, bookkeeping, licensing | Shells only, as the brief allows. Their source was not supplied. No calculations, no tax rates. |
| Assistant | Sample. Named "Assistant" and off by default in LBS, per your earlier decision. |
| Sign-in, invitations, two-step sign-in, sessions | Live proved: 19 browser tests |

Document templates ship as structure only. Engagement letter, Section 7216 and Form 2848 wording must be supplied by you; a document cannot be sent for signature until its template is marked approved.

## 4. Integrations

No provider credentials exist yet, so nothing is connected or exercised live. Every adapter is implemented and tested with mocked provider responses (208 tests). The Integrations screen lists all thirteen as not connected with the exact missing setting.

| Provider | Implemented | Tested (mocked) | Needs before going live |
|---|---|---|---|
| Resend (system email) | Yes | Yes | API key, verified sending domain |
| Gmail | Yes | Yes | Google Cloud project, OAuth verification for Gmail scopes. One mailbox per company today, not per person. |
| Google Calendar | Yes, two-way | Yes | Google OAuth verification |
| Google Meet | Yes, through Calendar | Yes | Calendar connected |
| Google Business Profile | Yes: reviews, replies, review link | Yes | Google must grant API access |
| Google Maps | Yes: server-side geocoding | Yes | API key |
| Square | Yes: customers, catalog (insert only), payments, webhooks, payment links | Yes, with reconciliation rules | Application keys; sandbox first, then production |
| QuickBooks Online | Yes: customers, invoices, payments, conflict reporting | Yes | Intuit keys; sandbox first, then production approval |
| Meta: Facebook and Instagram | Yes: publishing and messaging | Yes | Meta app review and business verification |
| WhatsApp Business | Yes: templates, send, inbound | Yes | Business account, approved templates |
| Dialpad | Yes: calls, call log, click to call, text | Yes | Account and API access; the plan decides what is available |
| SMS | Yes: Twilio or Dialpad, STOP handling | Yes | Provider account, registered sender |
| E-signature | Built in, no outside provider | Yes, on the stand-in | Resend for emails; approved template wording |
| AI model | Yes, with tax-ID masking | Yes | API key. The assistant endpoint does not use this adapter yet. |

## 5. Security

| Area | State |
|---|---|
| Accounts | Invitation only. No sign-up route exists. |
| Two-step sign-in | Authenticator app plus recovery codes; required roles enforced by server and database. Passkeys not built. |
| Sessions | Sealed HTTP-only cookies, idle timeout, refresh rotation, sign out everywhere, fresh identity check for sensitive actions. |
| Permissions | 40 capabilities; four office roles plus worker; enforced in the database, mirrored in the interface, compared automatically. |
| Company isolation | 6,472 database assertions pass, including deliberate-breakage tests. |
| Tax-ID vault | Encrypted; type and last four shown; reason, approval, single timed viewing, full access log. |
| Audit | Append-only log; exports recorded. |
| Backups | Encrypted backup and a restore drill that passes locally. Scheduled backups are not set up. |
| Secrets | Server-side only; scanners for secrets, personal data and bundles all clean. |
| GitHub | Workflows, code owners, scanning and settings guide written. Not yet run on GitHub. |
| Rate limits and webhooks | Database-backed limits; signature, replay and duplicate checks per provider. |
| Compliance | The platform supports a WISP with an evidence map. It makes no compliance claim; a qualified professional must validate. |

## 6. Branding

VYNTEX: brighter graphite and navy ground in place of near-black, chrome and cyan identity and motion kept. LBS: its own theme from your logo (emerald ground, brushed gold as the only accent, Playfair Display and Poppins, ledger-style rules, rounded corners), your lion on the sign-in page and sidebar. Both are responsive to 360 pixels wide and pass contrast checks.

## 7. Quality checks (final run)

| Suite | Result |
|---|---|
| Typecheck, wording and sample-data checks | Clean |
| Unit tests | 291 of 291 |
| Page matrix, nine editions, English and Spanish, desktop and phone | 1,772 pages, 0 issues |
| Workflow tests | 651 of 651 |
| Motion tests | 29 of 29 |
| Module suites (appointments, catalog, communications, operations, security), both deployments | All pass |
| Database | 6,472 assertions; 18 sample businesses round trip (5,134 records) |
| Server | 120 unit, 72 end to end |
| Browser against the local stack | 57 of 57 |
| Provider adapters | 208 of 208 |
| Security scripts | 101 of 101 |
| Migration tool | 87 of 87 |

Everything above ran in a sandbox against a local PostgreSQL and a stand-in for Supabase. Nothing ran on Supabase, Vercel, GitHub or any provider.

## 8. Known gaps

- Live e-signature sending from the browser is switched off pending one proof run.
- Server-side run of the rule engine for scheduled events is not built; rules run in the browser today.
- Gmail and Calendar connect per company, not per person.
- Chinese is written for sign-in pages only; other screens fall back to English.
- A new live company starts without starter appointment types.
- Per-rule delay and schedule, passkeys, device list, scheduled backups, retention settings and the finance database test file are not built.
- The Docker image and Kubernetes reference files were never built or applied (no Docker here).
- No `package-lock.json` (no registry here): run `npm install` once in VS Code and commit it.

## 9. What is needed from you

1. **Approve or decline closing the NOVA gaps** (`deploy/nova-containment/README.md`).
2. **Approve creating two Supabase projects and two Vercel projects** (adds cost), and the final addresses and DNS.
3. **Edition name** and whether it gets plans and prices.
4. **LBS inputs:** approved engagement letter, Section 7216 and Form 2848 wording; the bookkeeping and payroll client link addresses; source of the payroll, bookkeeping and licensing tools; answers to the migration review list; who approves the migration.
5. **Provider accounts:** Resend, Google Cloud, Square, Intuit, Meta, WhatsApp, Dialpad, an SMS sender, an AI key. Google and Meta reviews should start early.
6. **Legal and compliance review** of the security documents before any compliance statement is made.
7. Confirm the support line shown in LBS (currently info@vyntexusa.com, 609-780-3218).
