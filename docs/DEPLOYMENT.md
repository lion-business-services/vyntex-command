# Deployment

**The owner has said: no production deployment until she says so. Nothing in this document is to be executed now.** It is the procedure for the day she gives the go-ahead, written so that the person who operates GitHub, Vercel and Supabase can follow it without being a security specialist.

Each step names the software it happens in, in the form "IN: Supabase Dashboard, SQL Editor", and asks for one action. Menu names in these products change from time to time: if a name is not exactly what you see, look for the closest one. Where a step says "confirm", the fact depends on the plan in use and was not checked here.

## What is being deployed

One repository, `lion-business-services/VYNTEX-COMMAND`, builds two separate products. They share the code and nothing else.

| | VYNTEX Command | LBS Command |
| --- | --- | --- |
| For | Client companies of Vyntex LLC | Lion Business Services only |
| Address | `command.vyntexusa.com` | `lbscommand.vyntexusa.com` |
| Vercel project | its own | its own |
| Supabase project | its own | its own |
| Build setting | `VX_DEPLOY=vyntex` | `VX_DEPLOY=lbs` |
| Secrets, storage, logs, backups | its own | its own |
| Edition | per company | locked to the professional services edition |

Why they are separate and how to verify each boundary: `docs/security/isolation.md`.

**State today, as far as this repository knows.** The code is on GitHub. `README.md` says a test copy of the sales pages and demo runs on Vercel with no database and no keys; confirm that IN: Vercel before relying on it. No Supabase project exists. No custom domain points at either product. Parts of the live workspace were still being built when this page was written; section 12 lists what to reconcile before the first real use.

## 0. Before anything

Have these, or stop here.

1. **The owner's go-ahead, in writing,** for each deployment separately.
2. **Approval of the cost.** Creating a Supabase project may add cost, and so may a paid Vercel plan, a second Vercel team, a second Supabase organization and paid GitHub security features. The owner approves each one before it is created. Read the current prices on the vendors' own pricing pages; no price is written here.
3. **Accounts,** each with two-factor sign-in on: GitHub, Vercel, Supabase, Resend, the domain registrar that holds `vyntexusa.com`, and each provider to be connected.
4. **Two folders in the company password manager:** "VYNTEX Command" and "LBS Command". Every secret below goes into the folder of its deployment before it is used anywhere.
5. **A decision on where LBS lives:** in its own Supabase organization and its own Vercel team (recommended), or next to VYNTEX. See `docs/security/isolation.md`, "Who can open LBS".
6. **The repository settings done:** `docs/security/github-settings.md`, all ten steps.
7. **Green checks on `main`:** IN: GitHub (repository, Actions), the latest runs of CI and Secret scan passed.

Rules for every step:

* Never paste a key or a password into a chat, an email, a ticket or a file in the repository.
* Do one deployment from start to finish, then the other. Use a separate browser window (or browser profile) for each, and read the project name at the top of the page before every paste. The most likely serious mistake in this whole procedure is putting one deployment's key into the other's project.
* If a step fails, stop. Copy the error text (it holds no secret) and send it to the developer. Do not continue with the next step.

Sections 1 to 9 are done **twice**: once for VYNTEX Command, once for LBS Command. The examples say "the deployment's".

## 1. Create the Supabase project

Cost: owner's approval first (section 0).

1. IN: Supabase Dashboard. Choose the organization for this deployment.
2. IN: Supabase Dashboard. Press **New project**.
3. Name: `vyntex-command` or `lbs-command`. The name must say which one it is.
4. Database password: press **Generate a password**.
5. IN: your password manager. Save that password in the deployment's folder as "Database password".
6. IN: Supabase Dashboard. Region: the one closest to the users (for New Jersey, an East US region).
7. Plan: the one the owner approved. A free project pauses when unused and has no backups to speak of: not for real data (confirm on the plan page).
8. Press **Create new project**. Wait until it is ready.
9. IN: Supabase Dashboard, Project Settings, General. Copy the **Reference ID**. IN: your password manager, save it. It tells the two projects apart later.

## 2. Look, then apply the migrations in order

The database is created from the files in `supabase/migrations`, applied in the order of their numbers, every one of them, none skipped. At the time of writing there are 29 files, `0001` to `0029`; more will be added (the module range starts at `0030`). The folder is the list of record.

**2.1 Look first**

1. IN: Supabase Dashboard, SQL Editor. Press **New query**.
2. Paste this and press **Run**. It only reads.

   ```sql
   select table_schema, table_name from information_schema.tables
   where table_schema in ('public', 'app') order by 1, 2;
   ```

3. Expected: no rows. If there are rows, stop: this is not a new project.

**2.2 Apply**

There are two ways. Way A needs no extra software and is slow with this many files. Way B is faster and needs the PostgreSQL client tools on the computer (the installer from postgresql.org, "Command Line Tools" only) and the Git Bash terminal in VS Code. Neither has been run against a Supabase project yet; the same files in the same order are applied to a local PostgreSQL 16 by the automated tests.

*Way A, in the dashboard.* For each file, in order:

1. IN: VS Code. Open the next file in `supabase/migrations` (lowest number first).
2. IN: VS Code. Select all (Ctrl+A), copy (Ctrl+C).
3. IN: Supabase Dashboard, SQL Editor. Press **New query**.
4. Paste. Press **Run**.
5. Wait for "Success". If the editor asks you to confirm a query that changes privileges or looks destructive, read the message and confirm.
6. If there is an error: stop. Do not run the next file. Send the error to the developer.
7. Tick the file off on a list, so none is run twice or skipped.

*Way B, from the terminal.*

1. IN: Supabase Dashboard. Press **Connect**. Choose **Session pooler**. Leave the window open.
2. IN: VS Code terminal (Git Bash), in the repository folder. Type the connection, reading the values from that window. The leading space keeps each line out of the terminal's history:

   ```
    export PGHOST=<host>
    export PGPORT=5432
    export PGUSER=<user>
    export PGDATABASE=postgres
    read -s PGPASSWORD && export PGPASSWORD
   ```

   After the last line, type the database password and press Enter. Nothing is shown.
3. IN: VS Code terminal. Check which project you are about to change. The first line prints the user name: the part after the dot must be this deployment's reference ID (section 1, step 9). The second line must print `1`:

   ```
   echo $PGUSER
   psql -X -Atc "select 1"
   ```

4. IN: VS Code terminal. Apply every file in order, stopping at the first error:

   ```
   for f in supabase/migrations/*.sql; do echo "== $f"; psql -X -q -v ON_ERROR_STOP=1 -f "$f" || break; done
   ```

5. The last line printed must be the last file of the folder, with no error under it.
6. Close the terminal. The password it held is gone with it.

One known stop: the first file refuses to run with "Migrations must run as a role with BYPASSRLS" when the connection uses an unusual role. The SQL Editor's default role and the `postgres` user of the Connect window are the right ones.

**2.3 Reference data**

1. Apply `supabase/seed.sql` the same way as one more file. It loads the list of editions. It holds no customer data and no sample data.

**2.4 Check**

1. IN: Supabase Dashboard, SQL Editor. Press **New query**. Paste the content of `supabase/tests/verify_remote.sql`. Press **Run**. It only reads.
2. **Every row must say `ok`.** If one says `PROBLEM`, stop and send that row to the developer.
3. IN: Supabase Dashboard, Advisors, Security Advisor. Run it. Read every finding. The ones about "security definer views" are intended (`docs/SECURITY.md`, section 2); send any other to the developer.

## 3. The two secrets that live in the database

The database encrypts tax IDs with a key it reads from Vault. Without it, tax IDs cannot be stored or read.

1. IN: your password manager. Generate a random value of 48 characters or more. Save it in the deployment's folder as `pii_encryption_key`.
2. IN: Supabase Dashboard, Vault (under Project Settings or Integrations, depending on the dashboard version). Press **Add new secret**. Name: `pii_encryption_key` exactly. Value: paste it. Save.
3. IN: your password manager. Generate a second random value of 32 characters or more. Save it as `ip_hash_salt`.
4. IN: Supabase Dashboard, Vault. Add it as a secret named `ip_hash_salt`.

**If `pii_encryption_key` is lost, the stored tax IDs cannot be recovered,** not even from a perfect backup. Two people hold it (`docs/security/secrets-and-environments.md`). Each deployment has its own, different value.

**3.1 The second sign-in step, required for everyone at LBS**

A new database requires the second step (an authenticator app) from nobody until it is told to (`supabase/migrations/0020_server_core.sql`: the operator's list `security.required` starts empty). A company can add roles to its own list from its settings; the operator's list is the one a company can never shorten. For LBS Command, set it to every office role before the first person is invited.

1. IN: Supabase Dashboard (the **LBS** project: check the name), SQL Editor. Press **New query**.
2. Paste this and press **Run**:

   ```sql
   update app.server_settings
      set value = '{"mfaRoles": ["owner", "manager", "staff", "readonly"]}'::jsonb
    where key = 'security.required'
   returning key, value;
   ```

3. The result is one row showing the four roles. If it shows no row, stop: the migrations were not applied completely.
4. For VYNTEX Command, the owner decides whether the operator requires it for any role, or leaves it to each client company. Record the decision.

To reconcile: the statement above is written from the table definition in that migration. The server document (planned as `docs/SERVER.md`) is to confirm it, or name the function to use instead.

## 4. Supabase settings

1. IN: Supabase Dashboard, Authentication, Sign In / Providers. Turn **Allow new users to sign up** off. Accounts are created by invitation only. This is the switch the older system left on.
2. Same page. Keep **Confirm email** on.
3. Same page, Multi-Factor. Turn on the authenticator app option (TOTP).
4. IN: Supabase Dashboard, Authentication, URL Configuration. Site URL: the deployment's address (`https://command.vyntexusa.com` or `https://lbscommand.vyntexusa.com`). Redirect URLs: the same address only.
5. IN: Supabase Dashboard, Authentication, Rate Limits. Read the limits. Lower them if they are wider than needed.
6. IN: Supabase Dashboard, Authentication, password settings. Set the minimum length the owner chose, and turn on the leaked password check if the plan offers it (confirm).
7. IN: Supabase Dashboard, Project Settings, Data API. Exposed schemas: `public` is listed, `app` is **not**.
8. IN: Supabase Dashboard, Project Settings, Database. Turn on **Enforce SSL on incoming connections**.
9. Same page, Network Restrictions. If the plan offers it, allow direct database connections only from the addresses that need them (confirm).
10. IN: Supabase Dashboard, Storage. Every bucket shows **Private**. None is public.
11. IN: Supabase Dashboard, Database, Backups. Read what the plan keeps and write it in the table of `docs/security/backup-and-recovery.md`, section 8.
12. IN: Supabase Dashboard, Project Settings, API Keys. Leave this page open in its own tab: step 6 copies three values from it straight into Vercel.

## 5. System email

Invitations and password resets are sent through Resend from the server. Each deployment gets its own key.

1. IN: Resend. Add the sending domain (a subdomain of `vyntexusa.com` used only for sending is the usual choice).
2. IN: Resend. It shows DNS records to add.
3. IN: the registrar's DNS page for `vyntexusa.com`. Add each record exactly as shown. Do not change or remove any existing record: the main website and the company email depend on them.
4. IN: Resend. Press **Verify**. Wait until the domain shows as verified.
5. IN: Resend, API Keys. Create a key with permission to send only, named after the deployment. Copy it.
6. IN: your password manager. Save it in the deployment's folder as `RESEND_API_KEY`.

## 6. Create the Vercel project and set its variables

Importing a repository into Vercel builds it and publishes it at a `vercel.app` address at once. Do this step only on the day the owner said to deploy.

1. IN: Vercel. Choose the team for this deployment.
2. IN: Vercel. Press **Add New**, then **Project**.
3. Choose **Import Git Repository**, then `lion-business-services/VYNTEX-COMMAND`. If asked, install the Vercel GitHub app for that one repository only.
4. Project name: `vyntex-command` or `lbs-command`.
5. Framework Preset: **Other**. Leave the build and output settings alone: they are read from `vercel.json`.
6. Open **Environment Variables**. Before pressing Deploy, add the variables of the table below. For each one: type the name exactly, paste the value, tick **Sensitive** when the table says secret, and tick **Production** only.

   | Name | Value | Secret |
   | --- | --- | --- |
   | `VX_DEPLOY` | `vyntex` or `lbs`. Tick Production **and** Preview for this one: it decides which product is built. | no |
   | `APP_ORIGIN` | `https://command.vyntexusa.com` or `https://lbscommand.vyntexusa.com` | no |
   | `SUPABASE_URL` | Project URL, from the Supabase tab of step 4.12 | no |
   | `SUPABASE_ANON_KEY` | The public key, from the same tab | no |
   | `SUPABASE_SERVICE_ROLE_KEY` | The server key, from the same tab. Paste it into Vercel and into the password manager, nowhere else. | **yes** |
   | `SESSION_SECRET` | New random value, 48 characters or more | **yes** |
   | `TOKEN_ENC_KEY` | 32 random bytes in base64 (`docs/security/secrets-and-environments.md`, "Making a new secret") | **yes** |
   | `IP_HASH_SALT` | New random value, 32 characters or more | **yes** |
   | `CRON_SECRET` | New random value, 32 characters or more | **yes** |
   | `RESEND_API_KEY` | From step 5 | **yes** |
   | `SYSTEM_EMAIL_FROM` | A sender on the domain verified in Resend | no |

   VYNTEX Command only: `DEMO_REQUEST_TO` and `DEMO_REQUEST_FROM` for the demo request form, and `ANTHROPIC_API_KEY` (secret) if the assistant is to answer in connected mode.

   LBS Command only, optional: `VX_LINK_BOOKKEEPING` and `VX_LINK_PAYROLL`, the two client links shown on its home screen. They are public addresses, not secrets.

   Provider variables (Google, Square, QuickBooks, Meta, Dialpad, text messages) are added later, one provider at a time, when that provider's account and approval exist (section 10). The full list is in `docs/security/secrets-and-environments.md`; once `.env.example` is rewritten for this build it is the list of record.

   Never set any name that starts with `MOCK_`. The server refuses to run the workspace in production if one is present.
7. Check the list once more against the table. Every secret is ticked Sensitive and Production only. Nothing but `VX_DEPLOY` is ticked for Preview.
8. Press **Deploy**. Wait for it to finish.
9. IN: Vercel, Project, Settings, Git. **Production Branch** is `main`.
10. IN: Vercel, Project, Settings, Environments, Production. Turn off **Auto-assign Custom Production Domains**, so a new version reaches the public address only when a person promotes it (`docs/security/github-settings.md`, step 9).
11. IN: Vercel, Project, Settings, Deployment Protection. Turn on protection for preview deployments.
12. IN: Vercel, Project, Settings, Cron Jobs. Two scheduled calls are listed (`/api/cron/tick`, `/api/cron/daily`). How often a plan allows them to run differs by plan (confirm).
13. IN: your password manager. Every value of the table is in the deployment's folder.

After any later change to a variable: IN: Vercel, Project, Deployments, open the latest production deployment and press **Redeploy**. A running deployment keeps the old values.

## 7. Connect the address

1. IN: Vercel, Project, Settings, Domains. Press **Add**. Type `command.vyntexusa.com` (or `lbscommand.vyntexusa.com` in the LBS project).
2. Vercel shows a DNS record: type CNAME, a name, a value. Keep the page open.
3. IN: the registrar's DNS page for `vyntexusa.com`. Press **Add New Record**.
4. Type: CNAME. Name: `command` (or `lbscommand`), only that word. Value: exactly the value Vercel shows. TTL: the default. Save.
5. Do not touch any other record.
6. IN: Vercel, Project, Settings, Domains. Wait until the domain shows as valid. Vercel creates the certificate by itself; this can take from a few minutes to an hour.
7. IN: Vercel, Project, Deployments. Open the deployment built in section 6, press **Promote**, so the address shows it.

Company subdomains (`clientname.command.vyntexusa.com`) are for later. They need a wildcard domain, which changes how DNS for that name is managed; it is a separate decision and nothing in this procedure depends on it. Today each company is reached at `command.vyntexusa.com/<company>`.

## 8. The first company and its first owner

There is no sign-up page. The first owner of a company is invited by the operator, once; after that, owners invite everyone else from the Team screen.

1. IN: Supabase Dashboard, SQL Editor. Press **New query**. Create the company row. For LBS Command there is exactly one, with the professional services edition:

   ```sql
   insert into public.tenants (slug, name, industry_id, plan_id, status)
   values ('<address-word>', '<company name>', '<edition id>', '<plan id>', 'active')
   returning id;
   ```

   `<address-word>`: lowercase letters, digits and single hyphens, 3 to 40 characters. `<edition id>`: `practice` for LBS; for a VYNTEX client, the edition they bought. `<plan id>`: a plan id from the pricing file for a priced edition. To reconcile: which plan id the unpriced professional services edition uses is not settled in the code yet; ask the developer before this step for LBS.
2. Copy the `id` the query returns.
3. IN: Supabase Dashboard, SQL Editor. Press **New query**. Create the invitation, with the owner's real email address:

   ```sql
   select public.invite_bootstrap('<the id from step 2>', '<owner email>');
   ```

4. It returns a token, once. Copy it. The database keeps only a hash of it.
5. Build the link: the deployment's address, then `/invite/`, then the token.
6. Send the link to the owner through a channel you trust (not a public chat). It works once and expires after three days.
7. The owner opens the link and sets a password. Where the second sign-in step is required for their role (step 3.1: always at LBS), they are asked to add an authenticator app before the workspace opens.
8. IN: Supabase Dashboard, SQL Editor. Close the query tab that shows the token.

The function refuses to run a second time for a company that already has an active owner (`supabase/migrations/0022_invitations.sql`).

## 9. Check the deployment

Do every line. Write the date and the result of each in the security log.

**From a browser, not signed in**

1. `/api/health` on the deployment's address answers with `"ok": true`. It lists which settings are in place as yes or no, never a value.
2. The padlock is shown, and the `http://` address redirects to `https://`.
3. VYNTEX Command: `/`, `/pricing` and `/demo` load. LBS Command: `/` shows the sign-in page, and `/pricing` and `/demo` do not exist.
4. An address that does not exist shows the "not found" page of the site, not an error.
5. There is no page that lets a stranger create an account.

**The headers the site really sends**

6. IN: VS Code terminal:

   ```
   curl -sI https://<the deployment's address>/
   ```

   The answer contains `content-security-policy` with `connect-src 'self'` and `frame-ancestors 'none'`, `strict-transport-security`, `x-content-type-options: nosniff` and `x-frame-options: DENY`.

**Signed in as the first owner**

7. Sign in. The second step (authenticator) is asked for.
8. Open the Team screen and invite a second person with a lower role. They receive the email.
9. Sign in as that person in another browser. They see only what their role allows.
10. As the owner, open the security screen. The sign-ins of steps 7 and 9 are listed.

**In the dashboards**

11. IN: Supabase Dashboard, Authentication, Sign In / Providers. **Allow new users to sign up** is still off.
12. IN: Supabase Dashboard, SQL Editor. `supabase/tests/verify_remote.sql` again: every row `ok`.
13. IN: Vercel, Project, Logs. No errors from the functions during these checks.
14. IN: Vercel, Project, Settings, Cron Jobs. The last run of each scheduled call succeeded.

**The separation between the two deployments**

15. Follow "How to verify" for every row of the table in `docs/security/isolation.md`.

**Before the first real client record**

16. A backup was made and a restore drill was done: `docs/security/backup-and-recovery.md`, sections 2 and 5.
17. The alerts of `docs/security/monitoring-and-incident-response.md`, section 3, are set up, and the names in its section 5 are filled in.
18. The developer has repeated the company isolation test against the real project with two test companies. The local tests use stand-ins for Supabase (`docs/SECURITY.md`, section 8).
19. The privacy policy and the terms the users agree to are written and published. That is counsel's work, not this document's.

## 10. Connecting providers

One provider at a time, sandbox or test account first (owner's brief, section 84), each deployment with its own application registered at the provider.

1. IN: the provider's developer console. Register an application for this deployment. Redirect address: the deployment's address followed by `/api/integrations/<provider>/callback`. Webhook address: the deployment's address followed by `/api/webhooks/<provider>`.
2. IN: Vercel, Project, Settings, Environment Variables. Add the provider's variables (names in `docs/security/secrets-and-environments.md`). Secrets are Sensitive and Production only. Where the provider has a sandbox, set its environment variable to the sandbox value first.
3. Redeploy.
4. IN: the application, Integrations screen, as an owner. Connect. The screen shows the real state: it says connected only after the provider answered.
5. Some providers must approve an application before it can be used with real accounts (Google for Gmail and Calendar access, Meta for messaging). Until then the screen says so.

No provider has been connected live by this build. The adapters are proved with imitated provider answers only. To reconcile: the exact callback and webhook addresses and each provider's setup belong in the server document (planned as `docs/SERVER.md`), which does not exist yet.

## 11. Afterwards

**Publishing a change.** A pull request, reviewed, with green checks, merged to `main`. Vercel builds it for both projects. IN: Vercel, Project, Deployments: open the new deployment, look at it, press **Promote**. Each deployment is promoted separately; LBS does not have to take a release the day VYNTEX does.

**Undoing a release.** IN: Vercel, Project, Deployments. Open the previous good deployment. Press **Promote** (or **Instant Rollback**). This puts back the pages and the server functions. It does not undo a database change.

**A database change.** A new numbered file in `supabase/migrations`, never an edit of a file that was already applied. Tested locally (`npm run test:db`), reviewed by a security owner, then applied to each project as in section 2.2, then `verify_remote.sql` again. Apply the database change before promoting the code that needs it.

**Undoing a database change.** There is no automatic undo. A migration that must be reversed is reversed by a new migration, written and reviewed like any other. If data was damaged, restore from a backup: `docs/security/backup-and-recovery.md`, section 4. This is why a backup is made before any migration is applied to a project with real data.

**Rolling back the whole deployment.** If a deployment must be taken away entirely: IN: Vercel, Project, Settings, Domains, remove the domain (the address stops answering); the Supabase project stays untouched with its data. Deleting a Supabase project destroys its data and its backups: never without the owner's written instruction and a verified extra backup.

**Adding a client company (VYNTEX Command).** Section 8 again, in the VYNTEX project.

## 12. To reconcile before the first real use

Open items that this page cannot settle because the pieces were still being written:

* `.env.example` lists the earlier, shorter set of variables. The table in section 6 follows `api/_lib/env.js`.
* The server document (planned as `docs/SERVER.md`) with every endpoint, callback and webhook address is not written yet.
* Which plan id the professional services edition uses when its company row is created (section 8, step 1).
* Whether the sign-in service's own emails are used at all, or every email goes through the server and Resend. If they are used, a custom SMTP sender has to be set IN: Supabase Dashboard, Authentication, and its templates reviewed.
* Whether any migration needs a Supabase extension to be switched on by hand first. The first file creates `pgcrypto` itself; nothing else was found, and a real project is the test.
* The statement of step 3.1 (required second sign-in step) against the server document.
* None of sections 1 to 9 has been run against real projects. The first run is a rehearsal: do it for a throwaway project first if the owner approves the cost.
