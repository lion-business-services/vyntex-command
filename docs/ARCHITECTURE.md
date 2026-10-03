# Architecture

Written for the owner and for the developer who takes over. Nothing described here has been deployed.

## The short version

* One codebase, one deployment, one database. Every customer company is a set of rows in that database, kept apart by rules the database itself enforces.
* An industry edition is a configuration folder. The app core never asks which industry is selected.
* A company is reached at `https://<subdomain>.vyntexusa.com/<company-slug>`. The public demo is at `/demo`. There is no separate deployment per customer.
* The pricing file is the only place prices and plan contents live. The database stores a plan id and nothing else about money owed to VYNTEX.

## The layers

| Layer | What it is | Where |
| --- | --- | --- |
| Platform | The app shell, the screens, the business actions, the role matrix. The same for every company. | `src/app`, `src/ui`, `src/features`, `src/domain` |
| Industry configuration | A pack per edition: product name, wording, service types, document templates, task templates, dashboard tiles, sample business. | `src/packs/<id>/` |
| Tenant configuration | One row per customer company: address, name, industry, plan, status, settings. | table `tenants` |
| Branding | The company's initials, license line, phone, email, logo, accent colour. Shown on screens and documents. | `tenants.branding` |
| Users | People who sign in, each linked to a company with one role: owner, manager, staff or worker. | Supabase Auth plus table `tenant_members` |
| Data | Clients, leads, jobs, tasks, workers, payments, documents and the rest. Every row carries its company id. | `supabase/migrations/0002_tenant_data.sql` |
| Integrations | Email (Resend), the assistant (Anthropic), payments (Stripe, later), calendar and text messages (later). Keys only in environment variables. | `api/` |
| Workflows | Automation rules that react to events (new lead, won lead, status change, payment, start of day). | `src/domain/automations.ts` |

## Demo mode and customer mode

| | Demo mode | Customer mode |
| --- | --- | --- |
| Address | `/demo` | `/<company-slug>` |
| Who | Anyone, no account | Invited people who sign in |
| Data | A fictional sample business per industry | The company's real records |
| Where the data lives | In the visitor's browser only | In the Supabase database |
| What leaves the browser | Nothing, except a demo request the visitor sends on purpose and questions typed to the assistant when it is connected | Every read and write, under the access rules |
| State today | Working | Database and rules ready and tested locally. Sign-in and the data connection are not built. |

**The public demo never touches the customer database.** It has no account, no company row and no key that could read one. The only table a visitor can cause a write to is `demo_requests`, and only through the server function, never directly.

The two modes share the same screens. What changes is where the data operations go. `src/platform/gateway.ts` describes those operations once, named after the business actions in `src/domain/actions.ts`. Today the demo runs them against the browser copy. The Supabase implementation plugs in behind the same names later. That file contains types only, on purpose: a pretend implementation would misstate what works.

## Addresses

`src/platform/mode.ts` decides what an address is:

* `/demo/...` is the demo.
* `/<company-slug>/...` is a company, when the first part is a valid company address.
* Everything else is a site page (`/`, `/pricing`, `/request-demo`) or a word the site keeps for itself (`api`, `assets`, `brand`, `login`, `admin` and others).

A valid company address has 3 to 40 characters, lowercase letters and digits, single hyphens between them, and is not on the reserved list. The database enforces exactly the same rule on `tenants.slug`, and a test (`supabase/tests/parity.mjs`) fails if the two ever differ.

One subdomain serves everything. Hosting (`vercel.json`) sends every page address to the single page app and leaves `/api/*` and real files alone. The name of the subdomain is not final; the documents say `<subdomain>.vyntexusa.com`.

Not done yet: the router (`src/app/router.tsx`, `src/app/App.tsx`) still has `/demo` fixed as the only workspace. When customer mode is built it should call `resolvePath()` from `mode.ts`.

## Industry packs

A pack (`src/packs/<id>/pack.ts`) is data: the product name as sold, the words used for job, worker and client, the service types, the agreement wording, the tasks created when a job is won or finished, the dashboard tiles, and whether worker compliance applies. `seed.ts` next to it builds the fictional sample business for the demo.

### Adding a ninth industry

1. Copy an existing folder to `src/packs/<new-id>/` and edit `pack.ts` and `seed.ts`.
2. Add one line to the registry in `src/packs/index.ts`, and one line to the sample-data loaders in `src/packs/seeds.ts` (each edition's sample business is downloaded on demand; the type checker asks for the line).

Those two steps are all the app needs. Three small data entries keep everything else in agreement, and the checks tell you if one is missing:

* add the id to `IndustryId` in `src/domain/types.ts` (the type checker asks for it),
* add the product name to the pricing file, with the owner's approval (the parity test in `supabase/tests` asks for it),
* add one row to `supabase/seed.sql` and run that file again in the Supabase SQL Editor (the parity test asks for it).

No screen, action or database table changes.

## How the pricing file drives what a company gets

1. `config/vyntex-build-pricing.json` lists the plans, their features, the add-ons and the rules. Code never edits it.
2. `src/lib/pricing.ts` is the only reader.
3. `src/domain/entitlements.ts` maps each capability of the app to the exact feature line in the pricing file it comes from, or marks it as an add-on, usage-based, custom quote, or preview. `scripts/check-pricing.mjs` fails the build if a line it points to disappears.
4. In the demo the visitor picks a plan to preview. In customer mode the plan is `tenants.plan_id`, set by VYNTEX, never by the customer's browser.

The database has no `plans` table and no price column. A test confirms that.

Not done yet: plan limits (for example the number of users in a plan) are shown by the app but not enforced by the database.

## The data model in the database

`src/domain/types.ts` is the model. The tables mirror it in snake_case. A few names differ because the original word is reserved in SQL or because a nested list became its own table:

| In the app | In the database |
| --- | --- |
| `Job.start`, `Job.end` | `jobs.start_date`, `jobs.end_date` (empty in the app is NULL here) |
| `Job.assign[]`, `Job.expenses[]`, `Job.received[]`, `Job.log[]` | `job_assignments`, `job_expenses`, `client_payments`, `work_logs` |
| `notes[]` on leads, clients and jobs | `notes`, with a typed parent |
| `Expense.desc` | `job_expenses.description` |
| `WorkerPayment.from`, `.to` | `worker_payments.period_from`, `period_to` |
| `Task.assignee` (`u:<id>` or `w:<id>`) | `tasks.assignee_member_id` or `tasks.assignee_worker_id` |
| `Message.to` | `messages.recipient` |
| `Ref { type, id }` | `ref_type`, `ref_id` |
| `Activity.by` | `activity.by_kind`, `activity.by_id` |
| `DocRecord.esign` | `documents.esign_*` columns |
| `TeamUser` | `tenant_members` |
| `Company` | `tenants.name` plus `tenants.branding` |
| `settings.consent1099` | a row in `consent_records` |
| `Message.status: 'demo'` | does not exist: a real message is `draft`, `queued`, `sent` or `failed` |

Ids are UUIDs in the database. The short ids in the demo (`j1`, `w2`) are sample data only.

Role-specific views: a role that may see a row but not all of its columns reads a view instead of the table. Office staff read `jobs_basic`, `job_assignments_basic` and `worker_directory`. A field worker reads `my_jobs` and `my_worker_profile`. Everyone gets their companies from the function `my_workspaces()`. `docs/SECURITY.md` explains why.

Deleting: a company row is never deleted, it is closed. Deleting a job removes its own assignments, expenses, client payments, work logs, notes, tasks and documents (each removal is written to the audit log), but never the payments made to workers, because the 1099 totals depend on them. A consent record blocks the deletion of the client, worker or document it refers to.

Not modelled yet: which notifications each person has read (`readNotifications` in the demo).

## Hosting and tenancy: the options that were considered

Cost figures are estimates at small scale, read from the vendors' public pricing pages on 2 October 2026. **Confirm them on the current pricing pages before committing**: supabase.com/pricing, vercel.com/pricing, resend.com/pricing.

| | A. Shared database, row level security (chosen) | B. One schema per company | C. One Supabase project per company |
| --- | --- | --- | --- |
| How companies are kept apart | Every row carries the company id; the database filters every query | Each company has its own copy of the tables inside one database | Each company has its own database and its own keys |
| Strength of separation | Strong when every table has the rules and they are tested. A missing rule is the risk, which is why the tests walk every table. | Strong between schemas. Access rules per role are still needed inside each one. | Strongest. A mistake cannot cross companies. |
| A new customer | Add rows. Seconds. | Create a schema and run every migration for it. | Create a project, run migrations, set keys, connect the app. |
| A change to the tables | Run one migration once | Run it once per company, and handle the ones that fail halfway | Run it once per project |
| Fits "one subdomain, a path per company, one deployment" | Yes | Partly: the data connection has to switch schema per request | No: one deployment would need every company's keys |
| Reports across companies for VYNTEX | Simple | Possible, awkward | Hard |
| Rough monthly cost, 1 to 20 companies | Supabase Pro about $25 (includes one small database), Vercel Pro about $20. Around **$45 a month**, flat. | The same hosting bill, around **$45 a month**, plus noticeably more engineering time | Supabase Pro about $25 plus about $10 per extra project: around **$115 a month at 10 companies, $215 at 20**, plus Vercel, plus operations time |
| When to choose it | Now | Rarely worth it on Supabase | A large customer that contractually requires its own database |

Shared across all three: Resend for email has a free tier (about 3,000 emails a month, 100 a day) and a paid plan at about $20 a month; the assistant is billed by Anthropic per use; the subdomain costs nothing extra on the existing domain.

Two notes on the free tiers. Supabase's free plan pauses a project after about a week without activity, so it is fine for a trial run and not for customers. Vercel's free plan is for personal, non-commercial use, so the paid plan is needed before selling.

Option A does not close the door on C. A company that needs its own database later can be moved to its own project with the same migrations.
