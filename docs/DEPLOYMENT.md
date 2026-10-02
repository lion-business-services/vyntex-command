# Deployment

**Nothing has been deployed.** No GitHub repository, no Supabase project, no Vercel project and no DNS record exists for this product. Everything so far was written and tested on a local computer. These are the steps for the day the owner says to go ahead. Do not start them before that.

Each step names the software it happens in, in capitals: IN: GitHub Desktop, IN: Supabase dashboard, IN: Supabase SQL Editor, IN: Vercel dashboard, IN: GoDaddy DNS, IN: Resend dashboard. The steps use the screens with buttons first. Where a typed command exists it is given as an alternative.

Menu names in these products change from time to time. If a name below is not exactly what you see, look for the closest one.

## What going live means today

| Goes live | Does not exist yet |
| --- | --- |
| The sales pages, the demo, the demo request form, the assistant, the health check | Customer sign-in and customer workspaces |
| The database, empty of customers. It receives demo requests. | Billing through Stripe |

So the first deployment is the sales site and demo. The database is set up at the same time so it is ready and so demo requests are stored.

## Before you start

Decide or have at hand:

* **The subdomain.** Not final. This document writes `<subdomain>.vyntexusa.com`; the candidates are still being decided. Replace it everywhere below once chosen.
* **Accounts**, each under a VYNTEX email with two-factor sign-in on: GitHub, Supabase, Vercel, Resend, Anthropic, and access to the GoDaddy account that holds vyntexusa.com.
* **A password manager entry** for this product. The database password and the encryption key go there and nowhere else.
* **The monthly cost.** About $45 a month to start (Supabase Pro about $25, Vercel Pro about $20), plus email and assistant usage. These are estimates; confirm on the vendors' pricing pages. Details in `docs/ARCHITECTURE.md`.

Rules that apply to every step:

* Never paste a key or password into a chat, an email or a file in this folder. Keys go only into the Vercel environment variables screen, the Supabase Vault screen, or the password manager.
* This product gets its own Supabase project and its own repository. Do not reuse a project or repository of another VYNTEX system.

## Step 1. Create the repository

First, on your computer, in this folder, run `npm install` once. It creates a file named `package-lock.json`, which makes every future build use the same library versions. Keep that file.

IN: GitHub Desktop

1. File, Add local repository, choose this folder. GitHub Desktop says it is not a repository yet and offers "create a repository". Accept.
2. Name: `vyntex-platform`. Leave "Initialize with a README" off (there is one already). Create.
3. Look at the list of changed files on the left before the first commit. **No file whose name starts with `.env` may be in that list, except `.env.example`.** `node_modules` and `dist` must not be there either. If one is, stop and ask the developer.
4. Type a summary such as "First version" and press Commit.
5. Press Publish repository. **Keep "Keep this code private" ticked.** Choose the VYNTEX organization if there is one.

Alternative with typed commands, on Windows in PowerShell, after creating an empty private repository on github.com:

```
& "C:\Program Files\Git\bin\git.exe" init
& "C:\Program Files\Git\bin\git.exe" add .
& "C:\Program Files\Git\bin\git.exe" status
& "C:\Program Files\Git\bin\git.exe" commit -m "First version"
& "C:\Program Files\Git\bin\git.exe" branch -M main
& "C:\Program Files\Git\bin\git.exe" remote add origin https://github.com/<organization>/vyntex-platform.git
& "C:\Program Files\Git\bin\git.exe" push -u origin main
```

Read the output of `status` before committing: the same rule about `.env` files applies.

## Step 2. Create the Supabase project

IN: Supabase dashboard

1. New project. Name: `vyntex-platform`. This is a new project for this product only.
2. Database password: let Supabase generate one, and save it in the password manager.
3. Region: the one closest to the customers (for New Jersey, an East US region).
4. Plan: Pro before real customers. The free plan pauses a project after about a week without activity.
5. Wait until the project is ready.

## Step 3. Inspect, then run the migrations in order

The owner's rule is to inspect the schema before running migrations. On a new project the inspection should show an empty `public` schema.

IN: Supabase SQL Editor

1. New query. Paste this and press Run. It only reads.

   ```sql
   select table_schema, table_name from information_schema.tables
   where table_schema in ('public', 'app') order by 1, 2;
   ```

   Expected: no rows. If there are rows, stop: this is not a fresh project, and the migrations must not be run over someone else's tables.

2. Now run the migration files **one at a time, in this exact order**. For each file: open it from the folder `supabase/migrations` in a text editor, select all, copy, paste into a new query, press Run, and wait for "Success" before the next one. If the editor asks you to confirm a query that changes privileges, read the message and confirm.

   | Order | File | What it creates |
   | --- | --- | --- |
   | 1 | `0001_platform.sql` | Industries, companies, membership, demo requests |
   | 2 | `0002_tenant_data.sql` | Clients, leads, jobs, tasks, workers, payments, documents and the rest |
   | 3 | `0003_access_rules.sql` | Row level security and the role rules |
   | 4 | `0004_audit_log.sql` | The audit log |
   | 5 | `0005_pii_encryption.sql` | Encryption of worker tax IDs |
   | 6 | `0006_consent_and_1099.sql` | Consent records and the 1099 export |
   | 7 | `0007_role_views_and_portal.sql` | The limited views for staff and workers |
   | 8 | `0008_storage_worker_documents.sql` | The private file bucket for W-9 forms and insurance certificates |
   | 9 | `0009_lockdown_check.sql` | Final check. It fails on purpose if any table is unprotected. |

   If a file stops with an error, do not go on to the next one. Copy the error message (it contains no secret) and send it to the developer. One known case: the first file stops with "Migrations must run as a role with BYPASSRLS" if it is run by an unusual role; the SQL Editor's default role is the right one.

3. Run `supabase/seed.sql` the same way. It loads the eight industries. It contains no customer data and no sample data.

4. Run `supabase/tests/verify_remote.sql` the same way. It only reads. **Every row of the result must say `ok`.** If one says `PROBLEM`, stop and send that row to the developer.

## Step 4. Put the encryption key in Supabase Vault

The database encrypts worker tax IDs with a key it reads from Vault. Without the key, tax IDs cannot be stored or read; nothing else is affected.

1. Create the key. IN: your password manager, generate a random password of 48 characters or more, letters and digits. Save it in the entry for this product, labelled "pii_encryption_key".
2. IN: Supabase dashboard, open Vault (under Project Settings or Integrations, depending on the dashboard version). Add a new secret. Name: `pii_encryption_key` exactly. Value: the key. Save.
3. Do the same for a second random value of 32 characters or more, named `ip_hash_salt`. It is used to store a keyed hash of a network address instead of the address itself.

Do not type either value into the SQL Editor, a file or a chat. **If the encryption key is lost, the stored tax IDs cannot be recovered.**

## Step 5. Supabase settings

IN: Supabase dashboard

1. Authentication, sign-in settings: turn **off** "Allow new users to sign up". People join a company by invitation only. Keep email confirmation on.
2. Authentication, URL configuration: Site URL `https://<subdomain>.vyntexusa.com`.
3. Project Settings, Data API: the exposed schemas must list `public` and must **not** list `app`.
4. Storage: the bucket `worker-documents` exists and is marked private. Do not make it public.
5. Project Settings, API keys: you will need the Project URL, the public key (anon or publishable) and the server key (service role or secret) in step 7. Copy them straight from this screen into Vercel. Do not store the server key anywhere else.

## Step 6. The email sender for demo requests

IN: Resend dashboard

1. Add the domain you want to send from (for example a subdomain of vyntexusa.com used only for sending).
2. Resend shows DNS records to add (for SPF and DKIM).

IN: GoDaddy DNS

3. My Products, vyntexusa.com, DNS. Add each record exactly as Resend shows it. Do not change or remove any existing record: the main website and the company email depend on them.

IN: Resend dashboard

4. Press Verify and wait until the domain shows as verified. Create an API key with permission to send only. You will paste it into Vercel in the next step.

## Step 7. Create the Vercel project and set the environment variables

Importing a repository into Vercel publishes it at once at a `vercel.app` address. Do this step only when the owner has said to deploy.

IN: Vercel dashboard

1. Add New, Project, Import Git Repository, choose `vyntex-platform`. Install the Vercel GitHub app for that one repository when asked.
2. Framework Preset: Other. Leave the build and output settings alone: they are read from `vercel.json` (build command `node scripts/build.mjs`, output folder `dist`).
3. Open Environment Variables and add these. Names exactly as written. Tick "Sensitive" for every one marked secret.

   | Name | Value | Secret |
   | --- | --- | --- |
   | `SUPABASE_URL` | The Project URL from Supabase | no |
   | `SUPABASE_ANON_KEY` | The public key from Supabase | no |
   | `SUPABASE_SERVICE_ROLE_KEY` | The server key from Supabase | yes |
   | `RESEND_API_KEY` | The key from Resend | yes |
   | `DEMO_REQUEST_TO` | The address that receives demo requests | no |
   | `DEMO_REQUEST_FROM` | A sender on the domain verified in Resend, for example `VYNTEX USA <demo@...>` | no |
   | `IP_HASH_SALT` | A random value of 32 characters or more (it may be the same one stored in Vault). Used when a server function stores the keyed hash of a visitor's address. | yes |
   | `ANTHROPIC_API_KEY` | The key from Anthropic. Leave it out to keep the built-in assistant. | yes |
   | `ASSISTANT_MODEL` | Optional. Leave empty for the default. | no |

   Do not add `PII_ENCRYPTION_KEY`: with Vault the key stays in the database. Do not add the Stripe variables yet. When Stripe is connected later, start with the **test** keys, and leave Stripe Tax off until the owner confirms the tax setup.

   Set the variables for the Production environment. Leave Preview without the server key and the email key, so that test builds of other branches cannot write to the database or send email.

4. Press Deploy. When it finishes, Vercel shows an address ending in `vercel.app`.

After any later change to an environment variable, redeploy (Deployments, the latest one, Redeploy): a running deployment keeps the old values.

## Step 8. Connect the subdomain

IN: Vercel dashboard

1. The project, Settings, Domains. Add `<subdomain>.vyntexusa.com`.
2. Vercel shows a DNS record to create: type CNAME, a name, and a value. Keep this screen open and use **the exact value Vercel shows**.

IN: GoDaddy DNS

3. My Products, vyntexusa.com, DNS, Add New Record.
4. Type: CNAME. Name: only the subdomain word (not the full address). Value: the value from Vercel. TTL: the default. Save.
5. Do not touch any other record.

IN: Vercel dashboard

6. Wait until the domain shows as valid. Vercel creates the security certificate by itself; this can take from a few minutes to an hour.

If vyntexusa.com uses nameservers that are not GoDaddy's, the record has to be added wherever those nameservers are managed. GoDaddy shows the nameservers on the same DNS screen.

One subdomain serves the sales pages, the demo and, later, every customer company at `https://<subdomain>.vyntexusa.com/<company-slug>`. No DNS change is needed per customer.

## Step 9. Verify

IN: a web browser

1. `https://<subdomain>.vyntexusa.com/api/health` shows `"ok": true`, and under `configured` each integration you set up shows `true`. It never shows a key.
2. `https://<subdomain>.vyntexusa.com/` and `/pricing` load. `/demo` opens the demo. Switch industry and language.
3. `/request-demo`: send one test request with your own details. The email arrives at the `DEMO_REQUEST_TO` address.
4. An address that does not exist, such as `/not-a-company`, shows the site's "not found" page, not an error.
5. The padlock is shown and `http://` is redirected to `https://`.

IN: Supabase dashboard, Table Editor

6. The table `demo_requests` has one row: your test. The column `consent_text` holds the sentence you agreed to. If the email arrived but no row appeared, tell the developer: the form's server function and the table must use the same column names, and the Vercel log of that request shows the status the database answered with.

IN: Vercel dashboard

7. The project, Logs: no errors from the functions during your test.

## Step 10. Before the first real customer

Sales site and demo can be public once step 9 passes. Before any customer data goes in, every line here must be true:

* [ ] The owner has approved going live.
* [ ] Two-factor sign-in is on for GitHub, Supabase, Vercel, Resend, Anthropic and GoDaddy.
* [ ] The repository is private and contains no `.env` file.
* [ ] `verify_remote.sql` shows `ok` on every row.
* [ ] The encryption key is in Vault and in the password manager, and nowhere else.
* [ ] "Allow new users to sign up" is off in Supabase.
* [ ] The Supabase plan includes backups, and a restore has been tried once.
* [ ] The developer has repeated the company isolation test against the real project with two test companies (the local test uses stand-ins; see `docs/SECURITY.md`).
* [ ] Customer sign-in and the data connection are built and reviewed (not done yet).
* [ ] The address of the Supabase project has been added to `connect-src` in `vercel.json` (needed only once the pages talk to Supabase).
* [ ] The privacy policy and terms the customer agrees to are written and published.
* [ ] The pricing file is the version the owner approved. Stripe, if connected, is in test mode until the owner says otherwise, with Stripe Tax off.
* [ ] Someone receives alerts when the site or a function fails.

## Afterwards

**Publishing a change.** IN: GitHub Desktop: commit, then Push origin. Vercel builds and publishes the `main` branch by itself. Other branches get a preview address and do not change the live site.

**Undoing a release.** IN: Vercel dashboard: Deployments, pick the previous good one, Promote to Production (or Instant Rollback).

**A database change.** A new numbered file goes into `supabase/migrations`. Test it locally with `bash supabase/tests/run_local.sh`, then inspect and run it in the Supabase SQL Editor as in step 3, then run `0009_lockdown_check.sql` again and `verify_remote.sql` again. Never edit a migration that has already been run on the real project; add a new one.

**Adding a customer company.** Not automated yet. Until it is, it is done by the developer in the Supabase dashboard: create the company row, invite the owner from the Authentication screen, and link the two in `tenant_members`. The address `/<company-slug>` works only once customer mode is built.
