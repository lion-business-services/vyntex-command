# Security test plan

Every automated security test in this repository, what it proves, how to run it, and what still has to be checked by hand after a deployment. Owner's brief, section 96.

Two rules for reading this page:

* "Proved" means a test ran and passed on the date given. It never means "the feature exists".
* Everything automated here runs against local stand-ins: a throwaway PostgreSQL, an imitation of Supabase's sign-in and data interfaces, and imitated providers. Nothing has been run against a real Supabase project or a live provider. Section 4 is the list of checks that only a real deployment can answer.

## 1. Run everything

IN: VS Code terminal, in the repository folder. Git Bash is needed for the lines that start with `bash`.

| Command | What it runs | Needs | Result on 3 October 2026 |
| --- | --- | --- | --- |
| `npm run test:db` | The database rules (section 2.1) | PostgreSQL 15 or newer on the computer | 2,615 assertions passed, about one minute |
| `bash supabase/tests/mutation_check.sh` | A test of the database tests: breaks one rule at a time and expects them to notice | The same | Not run in this pass |
| `npm run test:server` | Server tests: sign-in, sessions, second step, CSRF, rate limits, webhooks, integrations (section 2.2) | PostgreSQL | Unit part run here: 104 tests passed. End-to-end part not run in this pass (it belongs to the server work and shares fixed ports). |
| `npm run test:unit` | Unit tests of the app's domain logic | Nothing | 25 tests passed |
| `npm run test:split` | The two builds are separate products | Nothing | 67 checks passed |
| `node --test "tests/security/*.test.mjs"` | The scans, the header check, the evidence check, the container server (section 2.3) | Git, for one test | 101 tests passed |
| `node scripts/security/scan-secrets.mjs` | Keys and tokens in the files | Nothing | clean |
| `node scripts/security/scan-pii.mjs` | Real people's data in the files | Nothing | clean |
| `node scripts/security/check-headers.mjs` | Browser protections in `vercel.json` | Nothing | 20 of 20 passed |
| `node scripts/security/scan-bundle.mjs dist --deploy vyntex` | The VYNTEX build carries nothing it must not | A build (`npm run build`) | clean |
| `node scripts/security/scan-bundle.mjs dist-lbs --deploy lbs` | The same for the LBS build | A build (`npm run build:lbs`) | **2 findings**: the product name "VYNTEX Command" is inside the LBS build (section 5) |
| `node scripts/security/check-evidence.mjs` | The security documents cite files and tests that exist; no screen claims a certification | Nothing | clean |
| `bash scripts/backup/restore-test.sh` | Backup, encryption and restore, end to end (section 2.4) | PostgreSQL, age | passed, about nine seconds |

The short names proposed for `package.json` (not added yet; they are a request to the owner of that file): `security:secrets`, `security:pii`, `security:bundle`, `security:headers`, `security:evidence`, `test:security`, `test:restore`. Other documents use these names.

All of the above run on every pull request (`.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml`), except the mutation check, which takes several minutes and is run by hand before a release.

## 2. What each suite proves

### 2.1 Database (`supabase/tests`)

`run_local.sh` starts a throwaway PostgreSQL 16, applies every migration as a role that is not a superuser (as on Supabase), and runs the files below. Every assertion raises on failure.

| File | Sections | Proves |
| --- | --- | --- |
| `supabase/tests/rls_isolation.sql` | catalog, anonymous, tenant isolation, cross-tenant foreign keys, role matrix, audit log, PII encryption, consent and 1099, other guards | Every table has row level security enabled and forced. A visitor who is not signed in reads and runs nothing. People of company A cannot read, change, delete, move or insert rows of company B, in every table and view found in the catalog, for seven kinds of people. The role matrix. The audit log records, redacts and cannot be altered. Tax IDs are encrypted, unreadable without the key, and every read is recorded. |
| `supabase/tests/gateway.sql` | capabilities, configuration, configurable stages, tax ID secret, ws_load, ws_apply, lead rotation, duplicates, office scope, profile | The capability matrix per edition and the read-only role. The client tax ID store cannot be read or repointed. What a person loads depends on role and office. Changes are checked, idempotent and audited. Office scope. |
| `supabase/tests/concurrency.sh` | | Two leads arriving at once never get the same turn. |
| `supabase/tests/parity.mjs` | | The role matrix, capabilities, value lists, editions and address rule are identical in the app code and in the database. |
| `tests/gateway_roundtrip.mjs` | | Every edition's sample business survives a write through the gateway and a read back. |
| `supabase/tests/verify_remote.sql` | | Read-only checks for a real project (section 4). Not run by `run_local.sh`. |

In CI the same script runs against a `postgres:16` service: `.github/scripts/db-tests.sh` runs `run_local.sh` itself and only replaces how the server is started. That path was tried here against a local server over a network port: 2,615 assertions passed.

### 2.2 Server (`tests/server`)

Written and owned by the server work; listed here because they are the security tests of sign-in and integrations. Names are the files.

| File | Proves |
| --- | --- |
| `tests/server/auth.e2e.test.mjs` | No sign-up. Sealed, HttpOnly session cookie. CSRF and same-origin checks. Lockout and rate limits. Invitations. The second sign-in step, required by role. Fresh identity check for protected operations. Sign-out everywhere. Idle and absolute session limits. Refresh rotation. Password reset and change. No secret, token or database text in any answer. |
| `tests/server/ws.e2e.test.mjs` | Load and apply run as the person. Idempotent apply. The read-only role. Protected operations by allow-list. Private file storage with limits. |
| `tests/server/integrations.e2e.test.mjs` | OAuth with PKCE and signed single-use state. "Connected" only after a verified call. Token refresh. Webhook signature, replay window and repeat handling. The job queue. The scheduled addresses need their secret. |
| `tests/server/db.e2e.test.mjs` | The server tables pass their database checks, and rules broken on purpose are noticed. |
| `tests/server/serve.e2e.test.mjs` | The routes answer over HTTP in both address styles, with the headers of `vercel.json`. |
| `tests/server/unit.crypto.test.mjs`, `tests/server/unit.csrf.test.mjs`, `tests/server/unit.session.test.mjs`, `tests/server/unit.oauth.test.mjs`, `tests/server/unit.webhook.test.mjs`, `tests/server/unit.ratelimit.test.mjs`, `tests/server/unit.totp.test.mjs`, `tests/server/unit.password.test.mjs` | The building blocks: sealing, CSRF values, session cookies, OAuth state, webhook signatures, limits, one-time codes, password rules. |

### 2.3 Repository, build and hosting (`tests/security`)

| File | Proves |
| --- | --- |
| `tests/security/scan-secrets.test.mjs` | 25 key formats are found (Supabase service and anon keys, Resend, Square, Meta, Google, Anthropic, Stripe, GitHub, AWS, the backup key, private key blocks, database addresses with a password, npm tokens). References and stand-ins are not. A finding never prints the value. An environment file that Git does not ignore is reported, one that Git ignores is not. The allow-list allows one value in one file and nothing wider. Exit codes. This repository is clean. |
| `tests/security/scan-pii.test.mjs` | Tax ID formats, lists of real-looking contacts, large inserts of person rows and provider exports are found, including a rebuilt copy of the older system's customer import. The same shapes with sample data are clean. No value is printed. This repository is clean. |
| `tests/security/scan-bundle.test.mjs` | A build with a key, a server setting name, a database address, a source map, an inline script or the other deployment's brand is refused. |
| `tests/security/check-headers.test.mjs` | The real `vercel.json` passes, and 21 ways of weakening it are each noticed (inline scripts, eval, open sources, a direct database connection from the page, framing, missing HSTS and the rest). |
| `tests/security/check-evidence.test.mjs` | A security document that points at a missing file or a missing test is reported; open items and code blocks are not citations; a screen that claims a certification is reported. |
| `tests/security/container-server.test.mjs` | The container server sends the headers of `vercel.json` on every answer, serves nothing outside the build (13 traversal attempts), does not reach helper files, takes the caller's address from the connection unless told to trust a proxy, hides error text from answers and logs, enforces body and time limits, never logs an address, and makes the scheduled calls with the same schedule as `vercel.json`. |

### 2.4 Backup and restore (`scripts/backup/restore-test.sh`)

Proves that an encrypted backup restores to an identical database, data and access rules, on the same server, on a new server, and on a server prepared like a new Supabase project; that a wrong key and an altered file are refused; and that the comparison itself notices a changed value and a weakened rule. Details and the last output: `docs/security/backup-and-recovery.md`.

## 3. The owner's list, item by item

Section 96 of the brief asks for automated tests of each of these, with negative tests.

| Asked for | Where | State |
| --- | --- | --- |
| Tenant isolation | `supabase/tests/rls_isolation.sql`, section "tenant isolation"; `tests/server/ws.e2e.test.mjs` | Passing locally |
| Role permissions | `supabase/tests/rls_isolation.sql` "role matrix"; `supabase/tests/gateway.sql` "capabilities"; `supabase/tests/parity.mjs` | Passing locally |
| Unauthenticated access | `supabase/tests/rls_isolation.sql` "anonymous"; `tests/server/auth.e2e.test.mjs` | Passing locally (database part run here) |
| Secure ID reveal | Worker tax ID: `supabase/tests/rls_isolation.sql` "PII encryption". Client tax ID store: `supabase/tests/gateway.sql` "tax ID secret". | Store and worker reveal: passing. Client request, approval and one-time reveal: **not built, no test** |
| Audit events | `supabase/tests/rls_isolation.sql` "audit log"; security events in `tests/server/auth.e2e.test.mjs` | Passing locally |
| Duplicate prevention | `supabase/tests/gateway.sql` "duplicates" and "ws_apply" (idempotency); `supabase/tests/concurrency.sh` | Passing locally |
| Protected exports | `supabase/tests/rls_isolation.sql` "consent and 1099" | 1099 export: passing. General export: **not built, no test** |
| Integration routes | `tests/server/integrations.e2e.test.mjs` | Written; not run in this pass. Imitated providers only. |
| Webhook verification | `tests/server/integrations.e2e.test.mjs`, `tests/server/unit.webhook.test.mjs` | Unit part passing here |
| CSRF | `tests/server/auth.e2e.test.mjs`, `tests/server/unit.csrf.test.mjs` | Unit part passing here |
| Rate limits | `tests/server/auth.e2e.test.mjs`, `tests/server/unit.ratelimit.test.mjs` | Unit part passing here |
| Ownership rules | `supabase/tests/rls_isolation.sql` "other guards" (last owner); `supabase/tests/gateway.sql` "office scope" and "profile" | Passing locally |
| Mutation and negative tests | `supabase/tests/mutation_check.sh`; `tests/server/db.e2e.test.mjs`; the "notices:" tests in `tests/security/check-headers.test.mjs`; steps 7, 9b and 12 of `scripts/backup/restore-test.sh` | Present. The database mutation check was not run in this pass. |

## 4. Checks that need a real deployment

No automated test can answer these. Each is a step for a person, done once per deployment and repeated after every database change. They are also in `docs/DEPLOYMENT.md`, section 9.

| Check | How |
| --- | --- |
| The database rules hold on the real project | IN: Supabase Dashboard, SQL Editor: run `supabase/tests/verify_remote.sql`. Every row says `ok`. |
| Supabase's own review | IN: Supabase Dashboard, Advisors, Security Advisor. Read every finding. |
| Company isolation on the real project | The developer creates two test companies with one test person each and repeats the cross-company reads and writes through the deployed site. Remove the test companies afterwards. |
| Nobody can sign up | IN: a private browser window: there is no sign-up page; IN: Supabase Dashboard: the switch is off. |
| The headers the site really sends | IN: VS Code terminal: `curl -sI https://<address>/` and compare with `node scripts/security/check-headers.mjs`. |
| The two deployments are separate | Every row of `docs/security/isolation.md`. |
| The Storage service enforces the bucket rules | Signed in as a member of company A, request a file path of company B through the site. It is refused. |
| The Vault holds the key and the application role cannot read it | Reveal one tax ID as an owner (works); the Security Advisor shows no finding about Vault. |
| Each provider, in its sandbox | Connect, sync, receive one webhook, disconnect. One provider at a time. |
| A restore into Supabase | The drill of `docs/security/backup-and-recovery.md`, section 5. |

An independent penetration test or security review has not been done. Whether and when to commission one is the owner's decision; it is the usual way to check what the people who built a system cannot see themselves.

## 5. Open findings from this pass

* `node scripts/security/scan-bundle.mjs dist-lbs --deploy lbs` reports the text "VYNTEX Command" in two script files of the LBS build: the brand settings object and a note inside the pricing file, which is bundled into both builds. The build specification says neither build carries the other's product name. `npm run test:split` does not check for that text and passes. One of the two has to change: the build, or the rule. Until then the bundle scan job of CI fails for the LBS build.
* The pricing file's internal note (it names who approves price changes) is shipped to every visitor inside both builds. It is not a secret, and it is not meant for the public either.
* The end-to-end server tests and the database mutation check were not run in this pass.

## 6. Adding a test

A new table, function or route ships with its negative test: the forbidden action is tried and must be refused. For a database object, `supabase/tests/run_local.sh` picks up test files of later migrations by itself. For a row in `docs/security/legacy-defects.md` or `docs/security/wisp-evidence-map.md`, add the test's name there; `scripts/security/check-evidence.mjs` then keeps the reference true.
