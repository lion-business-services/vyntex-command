# How LBS is kept separate from VYNTEX client companies

Lion Business Services holds tax and financial records of its clients. The owner's brief (sections 3 and 53) requires that it does not share an address, a database, storage, secrets, logs or backups with the companies that use VYNTEX Command. This page lists each boundary, what creates it, and how to verify it. Verification is something a person does and writes down; a boundary nobody checked is an assumption.

**State today.** No Supabase project and no production Vercel project exists for either deployment. The boundaries that live in the code are built and tested. The boundaries that live in accounts and settings are created when `docs/DEPLOYMENT.md` is followed, and verified with the "how to verify" column afterwards.

## The two deployments

| | VYNTEX Command | LBS Command |
| --- | --- | --- |
| Who uses it | Client companies of Vyntex LLC, each a row set in one shared database | Lion Business Services only |
| Address (planned) | `command.vyntexusa.com` | `lbscommand.vyntexusa.com` |
| Vercel project | its own | its own |
| Supabase project | its own | its own |
| Build | `node scripts/build.mjs` | `node scripts/build.mjs --deploy lbs` |

Both come from the same repository. That is the one thing they share, and section 9 says what that means.

## The boundaries

| # | Boundary | What creates it | Kind | How to verify |
| --- | --- | --- | --- | --- |
| 1 | Address | Two Vercel projects, each with its own domain. LBS is not a path under the VYNTEX address. | Configuration | IN: Vercel, Project (LBS Command), Settings, Domains: only `lbscommand.vyntexusa.com`. IN: Vercel, Project (VYNTEX Command), Settings, Domains: no LBS address. |
| 2 | Application build | The deployment is chosen when the pages are built (`VX_DEPLOY`), never at run time, so one cannot be switched into the other from a browser (`src/config/deployment.ts`). The LBS build has no sales pages, no public demo and its own brand files. | Code | `node scripts/security/scan-bundle.mjs dist-lbs --deploy lbs` and the same for `dist` with `--deploy vyntex`: neither build carries the other's product name or brand files. Tested in `tests/security/scan-bundle.test.mjs`. Runs on every pull request (`.github/workflows/ci.yml`). |
| 3 | Sign-in | Each Supabase project has its own user list. An account in one does not exist in the other. The session cookie is bound to its own address (the `__Host-` prefix, `api/_lib/session.js`), so a browser never sends one deployment's cookie to the other. | Configuration and code | IN: Supabase Dashboard (LBS project), Authentication, Users: only LBS staff. Then IN: a browser: sign in to VYNTEX Command, open `lbscommand.vyntexusa.com` in the same browser: it asks for a sign-in. |
| 4 | Database | Two Supabase projects: two PostgreSQL servers, two sets of keys. There is no connection string, key or network path from one to the other. | Configuration | IN: Vercel, Project (LBS Command), Settings, Environment Variables: `SUPABASE_URL` shows the LBS project's address. IN: Vercel, Project (VYNTEX Command), the same screen: a different address. The two project references (the first part of the address) must differ. |
| 5 | Company isolation inside each database | Row level security, forced, on every table, with company id on every row. In the LBS database there is one company; the rules still apply, so a second one could never read the first. | Code | `bash supabase/tests/run_local.sh` (test: "every table in public has row level security enabled and forced" in `supabase/tests/rls_isolation.sql`). After deployment: `supabase/tests/verify_remote.sql` IN: Supabase Dashboard, SQL Editor, on each project. |
| 6 | Storage | Buckets belong to a Supabase project. Each deployment's files are in its own project's buckets, which are private. | Configuration and code | IN: Supabase Dashboard (each project), Storage: every bucket shows **Private**. test: "the worker documents bucket is private" in `supabase/tests/rls_isolation.sql`. |
| 7 | Secrets | Every secret exists twice with different values, one per Vercel project: database keys, session secret, token encryption key, address hash salt, cron secret, every provider key. The tax ID encryption key is in each project's own Vault. | Configuration | Follow "Check that no secret is shared" below. The server refuses to start the workspace in production when two of its own secrets are equal (`problems()` in `api/_lib/env.js`); it cannot compare across deployments, so that check is manual. |
| 8 | Integration accounts | LBS connects its own Google, Square, QuickBooks, Resend and other accounts, with its own application credentials. Provider tokens are sealed with the deployment's own key before they are stored (`api/_lib/crypto.js`). | Configuration | IN: each provider's console: the application registered for LBS lists only `lbscommand.vyntexusa.com` as its redirect address. |
| 9 | Logs | Vercel keeps function logs per project. Supabase keeps database, sign-in and API logs per project. The audit log and the security events are tables inside each database. | Configuration | IN: Vercel, Project (LBS Command), Logs: only LBS requests. If a log drain is added later, LBS gets its own destination. |
| 10 | Backups | Supabase's backups are per project. The extra encrypted copy uses a separate label, key pair and storage location per deployment (`scripts/backup/backup.sh`, `docs/security/backup-and-recovery.md`). | Configuration and code | The LBS backup folder holds only files that start with `lbs_`. The LBS private key cannot decrypt a VYNTEX backup: `bash scripts/backup/restore-test.sh` checks that a wrong key is refused. |
| 11 | People with access | Who can open the LBS project in Supabase and in Vercel is a separate list from who can open the VYNTEX one. | Organizational | See "Who can open LBS" below. |

## Check that no secret is shared

Values cannot be read back from Vercel once marked Sensitive, and they must not be pasted anywhere to compare them. Compare where they came from instead:

1. IN: your password manager. Open the folder for VYNTEX Command and the folder for LBS Command side by side.
2. For each name in `docs/security/secrets-and-environments.md`, both folders have an entry, and each was generated separately. If an entry in one folder says "same as the other", it is wrong: generate a new value and replace it (the rotation steps are in that document).
3. IN: Supabase Dashboard (each project), Project Settings, API. The project reference in the address differs between the two.
4. IN: Vercel (each project), Settings, Environment Variables. Each name exists, and "Updated" shows when it was last set. No variable in the LBS project is linked from a shared (team level) variable: the column "Shared" must be empty.
5. Write the date and the result in the security log.

## Who can open LBS

The strongest separation for people is separate accounts on the hosting side, because a member of a Vercel team or a Supabase organization usually sees every project in it.

| Choice | What it gives | Cost and effort |
| --- | --- | --- |
| LBS in its **own Supabase organization** and its **own Vercel team** (recommended for LBS) | Being a member on the VYNTEX side gives nothing on the LBS side. Billing, audit trail and member list are separate. | A second organization and team to administer. Plan cost may apply per organization or team: confirm on the vendors' pricing pages and get the owner's approval. |
| Both projects in one organization and one team | Less to administer. | Everyone with a role there can reach both. Separation of people then depends on per-project roles, which not every plan offers. |

Either way:

1. IN: Supabase Dashboard (the organization that holds the LBS project), Team. List the members. Each one is a named person at Lion Business Services or the developer. Two-factor sign-in is on for each.
2. IN: Vercel (the team that holds the LBS project), Settings, Members. The same check.
3. IN: GitHub (repository Settings, Collaborators and teams). People who can change the code can change what both deployments run: see section 9 below.
4. Repeat this review every time someone joins or leaves, and write it down.

## Preview and test builds must never reach production data

A preview build is code that has not been reviewed yet. It must not hold a key to a production database (owner's brief, section 57).

1. IN: Vercel (each project), Settings, Environment Variables. Every database key, the session secret, the token encryption key and every provider key is ticked for **Production** only.
2. For Preview, either set no database variables at all (the build then shows the sample preview only), or set the keys of a separate staging Supabase project. Never the production project's.
3. IN: Vercel (each project), Settings, Deployment Protection. Turn on protection for preview deployments, so a preview address is not open to the internet.
4. The server also refuses mixed settings: in production it will not run with a local database address, a test flag or a sample secret (`problems()` in `api/_lib/env.js`).

## Network exposure of the databases

The owner's brief, section 59: do not expose databases directly to the public internet where avoidable.

* The browser never connects to a database. It calls its own site only (`connect-src 'self'` in `vercel.json`, checked by `scripts/security/check-headers.mjs`), and the server functions call Supabase.
* A Supabase project still has a public database address. Reduce it, for each project:
  1. IN: Supabase Dashboard, Project Settings, Database. Turn on **Enforce SSL on incoming connections**.
  2. IN: Supabase Dashboard, Project Settings, Database, Network Restrictions. If the plan offers it, restrict direct database connections to the addresses that need them (the office, for backups). The server functions use the HTTPS interface, not a direct connection, so they are not affected. Confirm on the plan.
  3. IN: Supabase Dashboard, Project Settings, Data API. The exposed schemas list `public` and not `app`.

## 9. What one repository means

Both deployments are built from the same code. A harmful change merged to `main` reaches both. That is why the controls on the repository are part of LBS's isolation, not an extra:

* nobody pushes to `main` directly; every change is a reviewed pull request that passed the checks (`docs/security/github-settings.md`);
* changes to the database, the server functions, the security checks and the hosting settings need a review from the security owners (`.github/CODEOWNERS`);
* production gets a new version only when a person promotes it (the same document, step 9), separately for each deployment. LBS does not have to take a release the day VYNTEX does.

If a dedicated, contractually separate environment is ever required (for LBS or for a large client), the same code can run in a container on infrastructure that the firm controls: `deploy/k8s/README.md` says when that is justified.

## Not proven

* Everything in the "Configuration" rows: no project exists yet, so none of it has been set or checked.
* That the two Supabase projects cannot reach each other is a property of how Supabase separates projects. It is taken from Supabase's documentation, not tested here.
* The session cookie test of row 3 needs both deployments running.
