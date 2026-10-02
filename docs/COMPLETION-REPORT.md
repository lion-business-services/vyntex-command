# Completion report

VYNTEX platform demo, built from the four files in "VYNTEX - FINAL files for Abdul". Prepared 2 October 2026.
Nothing has been deployed. No GitHub repository, Supabase project, Vercel project or DNS record was created.

## 1. What changed

* The single-file demo became a real application: React and TypeScript, one codebase, 116 source files, with the eight industries as configuration.
* New modules that the old demo did not have: clients, a task board with five stages, documents as their own area, messages, payments, reports, automations, an assistant, settings, a guided tour, global search, notifications and activity history.
* New public pages: overview with a live industry switch, pricing built from the pricing file, and a Request a demo form.
* Sample businesses were rewritten for all eight industries, in English and Spanish, with enough records for every screen to look lived in.
* A production foundation was added: database with company isolation, hosting settings, server functions and documentation.

## 2. What was preserved

* The principle "one codebase plus one selected industry pack". The app core never checks which industry is selected.
* All eight editions, their product names, wording, service types and agreement templates. The legal clauses of the agreements were carried over word for word, with the "draft, have an attorney review" notice kept on screen, in print and in the PDF.
* Every feature of the old demo: industry switching, leads, jobs, tasks, workers, calendar with "Add to Google", contracts, invoices, payments with split across jobs, pay types and rates, document editing, PDF, role views, the worker portal, W-9 and insurance tracking, the 1099 report with the $600 and $2,000 thresholds, English and Spanish.
* The pricing file, copied unchanged. No price, plan name, allowance or rule was altered.
* Sample people and jobs from the old demo where they fit, for continuity.
* AGC was used as reference only. No AGC name, wording or branding appears anywhere.

## 3. Architecture

* Layers: platform core, industry pack (configuration), company settings and branding, users and roles, data, connections, automation rules. A ninth industry is one new folder and one line in the registry.
* Demo mode runs entirely in the visitor's browser with fictional data and never touches a database. Customer mode is prepared separately: addresses of the form `/<company-slug>` on one subdomain, one deployment for every customer.
* One reader for the pricing file (`src/lib/pricing.ts`). A build check fails if a plan price is typed anywhere else, if a capability is marked "included" without quoting the exact line of the pricing file, or if a line of the pricing file has no customer wording.
* Wording is centralized: 2,149 keys, each in English and Spanish, with industry words filled in automatically and grammar adjusted (for example "an event", "la unidad").
* Pages load on demand, and every built file is named by its content so browsers can cache it safely.

## 4. Modules completed

Dashboard, Leads (table and pipeline), Clients, Jobs (table and board, with team, money, tasks, documents, log, activity), Tasks (To do, In progress, Waiting, Review, Completed), Calendar (month and agenda), Team with compliance, 1099 and compliance, Documents (estimate, agreement, invoice: generate, edit, print, PDF, demo signature), Messages, Payments, Reports (profit, sales, money, work, team, with CSV), Automations (eight rules plus repeat visits, with run history), Assistant, Settings (your business, team and roles, plan and add-ons, connections, automatic emails, language, your data), Worker portal, Guided tour, Global search, Notifications.

## 5. Industry packs

All eight are complete and pass the same checks: VYNTEX BUILD, CLEAN, LANDSCAPE, WASH, HAUL, SNOW, TURNOVER, EVENTS.
Each has its own product name, wording, service types, agreement, kickoff and closeout task lists, dashboard figures and a sample business of 7 to 9 workers, 10 to 12 clients, 14 jobs and 15 or 16 leads, in both languages.

## 6. Pricing and add-ons

* Plans, prices, yearly savings, setup fees, user allowances, welcome credits, add-ons and the customer-facing rules all render from the pricing file, on the pricing page, in Settings and in the plan badges across the demo.
* BUILD shows Foundation, Builder, Master Builder. Every other edition shows Essential, Pro, Elite.
* Every capability carries one of: Included, Included from a higher plan, Available add-on, Usage-based, Custom quote, Preview. The Plan selector in the demo changes these badges live.
* The Client Portal appears only as a custom-quote add-on marked "Not built yet", with no price.
* The two internal rules (Stripe Tax, plan naming) are never shown to customers.

## 7. Demo and Request a demo flow

* Demo controls: industry, view as (Owner, Manager, Office staff, any worker), plan, language, guided tour, "put your business on it" (name, logo, colour), and Reset with confirmation.
* "See pricing" and "Request a demo" are always visible from the demo, and pricing links back.
* The request form validates, records consent and posts to the server. With no delivery set up it tells the visitor plainly that the request was not sent and offers email, phone and WhatsApp with the official details (info@vyntexusa.com, 609-780-3218). It never claims a delivery that did not happen.

## 8. Fully working today

* Everything inside the demo: all records, calculations, automations, filters, role views, language, personalization, reset.
* "Add to Google" calendar links, PDF download of documents, CSV downloads, printing, the workspace data download.
* The request-a-demo form up to the server, including validation, rate limiting and the honest "not sent" answer.

## 9. Demo-simulated, or waiting for credentials

| Item | State |
| --- | --- |
| Demo request email | Code written. Needs `RESEND_API_KEY`, `DEMO_REQUEST_TO`, `DEMO_REQUEST_FROM`. Not exercised against Resend. |
| Demo request storage | Code written. Needs the Supabase project. Not exercised against Supabase. |
| Assistant with an AI model | Code written, never executes an action on its own. Needs `ANTHROPIC_API_KEY`. Not exercised against the live service. In the demo the built-in assistant answers from the records and says so. |
| E-signature | Demo simulation, labelled as such. Nothing is legally signed. |
| Sending emails | Emails are prepared in Messages. Nothing is sent. Connect during setup. |
| Google Calendar two-way sync, website lead form, text reminders | Shown with their plan standing as "Connect during setup" or usage-based. No fake "Connected" state anywhere. |
| Customer sign-in and live database connection | Not built. The database, access rules and address rules are ready for it. |
| Stripe | Not started. Test mode first, and Stripe Tax stays off until you confirm the tax setup. |

## 10. Security and data isolation

* Database written for Supabase: 22 tables, row level security enabled and forced on every one, 70 policies, composite keys so a row can never point at another company's record.
* Role matrix enforced in the database for owner, manager, office staff and worker. Workers see only their own rows and never a job price.
* Tax IDs stored encrypted, readable only through an owner or manager function that writes to the audit log. Append-only audit log. Consent records, and the 1099 export refuses to run without the written consent the pricing rules require.
* Secrets only in environment variables or Supabase Vault. `.env.example` has names only.
* Browser protections in `vercel.json`: content security policy, no framing, strict transport.
* The demo keeps all data in the visitor's browser and labels it as sample data.

## 11. QA completed

All of this was run on the final build.

* Page matrix: 1,312 page checks (8 industries x 2 languages x desktop and phone x 41 pages each). Each page checked for errors, sideways scroll, missing wording, unfilled words, product and sample company shown, construction words in other editions, English left in Spanish. Result: 0 issues.
* Visitor flows: 558 checks across all eight industries, plus Spanish and phone runs: new lead, won lead to job, completed job to invoice, payment, PDF, demo signature, tasks, search, notifications, roles, plan badges, language, tour, reset, industry switch. Result: all passed.
* Commercial: every plan price, setup fee and plan name on the pricing page compared with the pricing file for 8 editions x 3 plans x 2 billing periods. All match.
* Database: 1,523 assertions on a local PostgreSQL 16 (isolation, role matrix, encryption, audit, consent), plus 69 parity checks between the app and the database. All passed. A separate run broke 28 rules one at a time and the test caught all 28.
* Static checks: build, type check, pricing guard, wording check, sample data check. All passed.

Not verified, stated plainly:
* Type check ran against a local stand-in for the React type package, because libraries cannot be downloaded in this workspace. Run `npm install` and `npm run typecheck` once on a normal machine.
* The brand fonts (Sora, Manrope) could not be loaded here. Screens were reviewed in the fallback font.
* Nothing was tested on real Supabase, Vercel, Resend or the Anthropic service.
* Screen reader testing was not done. Keyboard use, focus and labels were built in and spot checked.

## 12. Needed before production

1. Your decisions, listed below.
2. A GitHub repository, a new Supabase project for this product only, a Vercel project, and the subdomain record at GoDaddy. Steps are in `docs/DEPLOYMENT.md`.
3. Environment variables set in Vercel (see `.env.example`), and a sending domain verified in Resend.
4. Customer mode: sign-in screens and the connection between the screens and the database.
5. An attorney's review of the agreement templates, as the templates themselves say.
6. Stripe in test mode, per the pricing rules.

## Decisions for you

These are the points where the files disagree or leave a gap. Nothing was changed silently.

1. **Assistant.** The pricing file does not list it. It is shown as "Preview". Decide the plan or add-on it belongs to.
2. **E-signature.** The old demo had a signature pad and the agreements mention electronic signatures, but no plan lists e-signature. It is shown as "Preview". Decide where it belongs.
3. **Email inbox and online card payments by clients.** Not in the pricing file. The inbox is one small "Preview" card. Online payments are not shown at all.
4. **Welcome credit rule.** The rule names "VYNTEX BUILD / VYNTEX CLEAN" only, while the file says every edition shares the rules. It is worded as "not usable on this edition" for all eight. Confirm.
5. **Spanish and industry wording of the pricing lines.** The pricing file is English and uses construction words. The customer wording for both languages is in `src/lib/pricing-copy.ts`, each line quoting the original. Please read it once.
6. **Catalog claims left out** because the pricing file does not back them: "we set it up and train your team", unlimited jobs, the competitor comparison, the description of what the client portal does.
7. **Platform name and subdomain.** Not final. The name is one setting (`src/config/brand.ts`), currently "VYNTEX".
8. **Spanish register.** The interface and the agreement templates you supplied use "usted". The automatic client emails are written in the informal register you prefer for client documents. Say if the agreements should move to informal too.
9. **Roles.** Office staff can open documents, including invoices, but not money screens. Managers do not see profit on screen, although the database lets a manager read prices. Confirm both.
10. **Small items from the supplied files, left as they were:** the service type "Short-term rentals (Airbnb)" names a brand, and the BUILD licence line reads "NJ HIC #__________".
