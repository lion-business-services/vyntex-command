# VYNTEX Command

## Master build (October 2026): start here

This repository now builds two separate products from one codebase:

* `npm run build` builds **VYNTEX Command** into `dist/` (sales pages, public demo, nine editions, a live workspace per company).
* `npm run build:lbs` builds **LBS Command** into `dist-lbs/` (standalone Lion Business Services deployment, professional-services edition only).

Read in this order: `docs/MASTER-BUILD-REPORT.md` (what was built, what is proved, what is still needed), `docs/MASTER-BUILD-SPEC.md`
(the engineering contract), `docs/DEPLOYMENT.md` (two deployments, step by step), `docs/DATABASE.md`, `docs/SERVER.md`,
`docs/integrations/`, `docs/security/`, `docs/migration/nova-to-lbs.md`.

Tests: `npm run check`, `npm run test:unit`, `npm run test:integrations`, `npm run test:security`, `npm run test:server`,
`npm run test:db`, `npm run test:e2e`, `npm run test:migrate`, and the browser suites under `tests/qa_*.py`.
Nothing here is deployed by running a build: production deployment waits for the owner's explicit go-ahead.

The platform's name is VYNTEX Command, "the AI-Powered Business Operating Platform" (one setting: `src/config/brand.ts`).

One business operations platform for small service companies: leads, clients, jobs, tasks, crews, calendar, documents, payments, reports and 1099 compliance. It is sold as eight industry editions (VYNTEX BUILD, CLEAN, LANDSCAPE, WASH, HAUL, SNOW, TURNOVER, EVENTS). All eight run on one codebase; an edition is a configuration folder, not a copy of the app.

## What is in this folder today

| Part | State |
| --- | --- |
| Sales pages (`/`, `/pricing`, `/request-demo`) | Working. |
| Public demo (`/demo`) | Working. A sample business per industry, in English and Spanish. Everything stays in the visitor's browser. |
| Server functions (`api/`) | Demo request form, assistant, health check. Each one does nothing and says so until its keys are set. |
| Customer database (`supabase/`) | Written and tested locally. Not created on Supabase yet. |
| Customer workspaces (`/<company-slug>`) | Prepared (address rules, database, access rules). The sign-in screens and the connection between the pages and the database are not built yet. |

**State of hosting.** The code is in the GitHub repository `lion-business-services/VYNTEX-COMMAND` and a test copy runs on Vercel at https://vyntex-command.vercel.app/ (demo only: no database, no keys). No Supabase project, sending domain or DNS record exists yet. `docs/DEPLOYMENT.md` lists the remaining steps for when the owner decides to go ahead.

## Run it on your computer

You need Node.js 20 or newer. In a terminal, inside this folder:

```
npm install          # once, downloads the libraries
npm run build        # builds the site into dist/
npm start            # serves dist/ at http://localhost:4173
```

Then open `http://localhost:4173` for the sales pages and `http://localhost:4173/demo` for the demo.

While changing code:

```
npm run dev          # rebuilds on every change and serves the result
```

On Windows, `npm run dev` only starts the first half (the rebuild) because of how Windows chains commands. Use two terminals instead: `node scripts/build.mjs --watch` in one and `npm start` in the other.

To try a server function with real keys, copy `.env.example` to `.env.local`, fill in what you need, and start the server with that file:

```
node --env-file=.env.local scripts/serve.mjs
```

`.env.local` is ignored by Git. Never commit it.

## Checks

| Command | What it proves |
| --- | --- |
| `npm run check` | Prices and plan names come only from the pricing file, every wording key exists in English and Spanish, the sample businesses are consistent. |
| `npm run typecheck` | The TypeScript code has no type errors (after `npm install`). `npm run typecheck:local` does the same without the downloaded type packages. |
| `npm run build` | The site builds. |
| `npm run qa:facts` then `npm run qa:matrix` | Opens every page in every industry, in English and Spanish, on a desktop and a phone screen, and checks each one: no errors, no sideways scroll, no missing wording, no construction words in the other editions, no English left in Spanish. Needs Python with Playwright and the site running (`npm start`). |
| `npm run qa:flows` | Walks the demo like a visitor in every industry: new lead, won lead to job, completed job to invoice, payment, PDF, demo signature, tasks, search, roles, plan badges, language, guided tour, reset, plus the pricing numbers against the pricing file and the request form. Same requirements. |
| `python3 tests/qa_motion.py` | With motion reduced nothing animates and no text stays hidden; the keyboard reaches every control with a visible focus ring; the command palette works from the keyboard. |
| `bash supabase/tests/run_local.sh` | The database rules hold: company isolation, the role matrix, encryption, audit log, consent. Needs PostgreSQL 15 or newer installed locally. Uses a throwaway local server and touches nothing online. |
| `bash supabase/tests/mutation_check.sh` | The database test itself can be trusted: it breaks one rule at a time and confirms the test notices. Takes a few minutes. |

## Folder map

| Path | What it holds |
| --- | --- |
| `config/vyntex-build-pricing.json` | The commercial source of truth: plans, prices, add-ons, rules. Changed only with the owner's approval. |
| `src/lib/pricing.ts` | The only code that reads the pricing file. |
| `src/domain/` | The data model, the business actions, the calculations, the role matrix and the plan entitlements. |
| `src/packs/<industry>/` | One folder per industry edition: wording, service types, documents, task templates, sample business. |
| `src/platform/` | Which workspace an address belongs to (`mode.ts`) and the list of data operations a workspace provides (`gateway.ts`). |
| `src/store/` | The demo's data, kept in the browser. |
| `src/brand/` | The brand components: the V mark (flat and dimensional), the wordmark lockup, the circuit trace, the scroll reveal. |
| `src/packs/seeds.ts` | Loads each edition's sample business on demand, so a visitor downloads one edition before the first screen and the rest in the background. |
| `src/app/`, `src/ui/`, `src/features/` | The screens. |
| `api/` | Server functions for Vercel. `api/_lib/` holds shared helpers and is not reachable from outside. |
| `supabase/migrations/` | The customer database, as numbered SQL files to run in order. |
| `supabase/seed.sql` | Reference data only: the eight industries. |
| `supabase/tests/` | The local database tests. |
| `scripts/` | Build, local server and the checks. `build-preview.mjs` makes an embeddable preview of the site (the page lives in memory instead of the address bar). |
| `tests/` | The browser tests (`qa_matrix.py`, `qa_flows.py`, `qa_motion.py`) and small helpers. |
| `types-local/` | A stand-in for the React type package, used only by `npm run typecheck:local` where libraries cannot be downloaded. |
| `vercel.json` | Hosting settings: build, address rewrites, security headers. |
| `.env.example` | Every environment variable, explained, with no values. |
| `docs/` | `CONVENTIONS.md` (how to write code here, including the design system), `ARCHITECTURE.md`, `SECURITY.md`, `DEPLOYMENT.md`, `COMPLETION-REPORT.md` (first build), `REDESIGN-REPORT.md` (brand, interface and motion upgrade). |

## Rules that do not bend

* Secrets live in environment variables or in Supabase Vault. Never in code, never in Git, never pasted into a chat.
* This product has its own Supabase project and its own repository. It is never mixed with another VYNTEX system.
* Every table has row level security, enabled and forced. The last migration and the database tests both refuse a table without it.
* The demo never shows something as sent, paid, signed or connected when it is not.
* Prices, plan names and allowances are never typed into a screen. They come from the pricing file.
