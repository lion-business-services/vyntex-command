# Secrets and environments

What the secrets are, where each one lives, who holds it, and how to replace it. Owner's brief, sections 85 and 104.

A secret is anything that lets its holder act as the platform or read protected data: provider keys, signing secrets, encryption keys, the database's server key, tokens of connected accounts, and the logins of the hosting accounts themselves.

## The rules

1. A secret lives in exactly three kinds of place: the provider that issued it, the environment variables of one Vercel project (marked Sensitive) or the Vault of one Supabase project, and the company password manager. Nowhere else.
2. Never in the repository, in the browser bundle, in browser storage, in a log line, in an error message, in a chat, an email or a ticket.
3. Every secret exists separately for each deployment (VYNTEX Command, LBS Command) and for each environment. No value is used twice.
4. If a secret was seen anywhere outside rule 1, it is treated as known to others and replaced. Replace first, investigate second.

What enforces the rules in code:

| Rule | Check | Where |
| --- | --- | --- |
| Not in the repository | Secret scan of the files and of the Git history on every pull request | `scripts/security/scan-secrets.mjs`, `.github/workflows/secret-scan.yml`, `.gitleaks.toml` |
| Not in the browser bundle | Scan of both builds for keys and for the names of server-only settings | `scripts/security/scan-bundle.mjs`, `.github/workflows/ci.yml` |
| Environment files stay out of Git | `.gitignore` ignores every `.env` file except the example; the scan reports one that is not ignored | `tests/security/scan-secrets.test.mjs` |
| The example file has names only | The scan reports a value next to a secret-looking name in `.env.example` | `tests/security/scan-secrets.test.mjs` |
| Not in logs or answers | The server answers with short codes, never a provider's or the database's message; the container server logs the kind of route, never the address | `api/_lib/respond.js`, `tests/security/container-server.test.mjs` |
| No value used twice inside a deployment, no sample value in production | The server refuses to run the workspace | `problems()` in `api/_lib/env.js` |

## Environments

| Environment | What it is here | Address | Database | Provider credentials |
| --- | --- | --- | --- | --- |
| Local | A developer's computer. | `localhost` | A throwaway PostgreSQL and a stand-in for Supabase, started by the test scripts. No real project. | None. Providers are imitated by the tests. |
| Development | Not used as a separate place. Work happens locally. | | | |
| Preview | The address Vercel builds for each branch and pull request. Unreviewed code. | A `vercel.app` address, protected | None, or the staging project. **Never production.** | None, or sandbox credentials only |
| Staging | Optional. A full copy of a deployment for trying a release and for restore drills. Exists only if the owner approves its cost (a Supabase project and provider sandbox accounts). | To be chosen if created | Its own Supabase project | Sandbox or test accounts only (Square sandbox, QuickBooks sandbox, test OAuth users, Stripe test mode if billing is added) |
| Production | The live deployment. | `command.vyntexusa.com`, `lbscommand.vyntexusa.com` | Its own Supabase project, one per deployment | Live accounts, one set per deployment |

Each environment has its own values for everything in the inventory below, and its own webhook addresses at each provider (a provider's test webhook points at staging, its live webhook at production).

How a development value is kept from becoming production (brief, section 85: "No development key should silently become production"):

* IN: Vercel, Project, Settings, Environment Variables: each variable is ticked for one environment. Production values are ticked for Production only.
* The server checks itself at start and refuses to serve the workspace in production when: `VX_ENV` says something other than production, the database address is local or not HTTPS, the session secret is a known sample value, two of its secrets are equal, or the test provider (`MOCK_OAUTH_BASE`) is configured. The health answer names the broken rule by code, never by value (`api/_lib/env.js`).
* Provider adapters name their environment explicitly (`SQUARE_ENVIRONMENT`, `QUICKBOOKS_ENVIRONMENT`), so sandbox and live cannot be confused by a key alone.

## Inventory

One copy of this table exists per deployment. "Holder" is a person, and is left for the owner to fill in. Names come from `api/_lib/env.js` and from the provider adapters in `api/_lib/integrations/providers`. To reconcile: `.env.example` has not been rewritten for this build yet; when it is, it is the list of record and this table follows it.

**Core (the workspace does not run without them)**

| Name | What it is | Secret | Lives in | Holder |
| --- | --- | --- | --- | --- |
| `VX_DEPLOY` | `vyntex` or `lbs` | no | Vercel | |
| `APP_ORIGIN` | The one public address of the deployment | no | Vercel | |
| `SUPABASE_URL` | Address of this deployment's Supabase project | no | Vercel | |
| `SUPABASE_ANON_KEY` | Public key of that project. Used by the server only; the browser never receives it. | no (but not published) | Vercel | |
| `SUPABASE_SERVICE_ROLE_KEY` | Server key. Bypasses row level security. | **yes** | Vercel, password manager | ______ |
| `SESSION_SECRET` | Seals the session cookie | **yes** | Vercel, password manager | ______ |
| `TOKEN_ENC_KEY` | Seals provider tokens before they are stored | **yes** | Vercel, password manager | ______ |
| `IP_HASH_SALT` | Turns a network address into a keyed hash | **yes** | Vercel, password manager | ______ |
| `CRON_SECRET` | Proves a scheduled call comes from Vercel | **yes** | Vercel, password manager | ______ |

**In the database (Supabase Vault of each project)**

| Name | What it is | Lives in | Holder |
| --- | --- | --- | --- |
| `pii_encryption_key` | Encrypts tax IDs inside the database. **If lost, stored tax IDs cannot be recovered.** | Vault, password manager | ______ (two people) |
| `ip_hash_salt` | The same purpose as `IP_HASH_SALT`, for entries the database writes itself | Vault, password manager | ______ |

**Features (one feature stays off without them)**

| Name | Feature | Secret |
| --- | --- | --- |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SYSTEM_EMAIL_FROM` | System email (invitations, password resets) | first two |
| `DEMO_REQUEST_TO`, `DEMO_REQUEST_FROM` | Demo request form (VYNTEX only) | no |
| `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` | Assistant | first |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail, Calendar, Meet, Business Profile | second |
| `GOOGLE_MAPS_API_KEY` | Maps | yes |
| `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square | second and fourth |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENVIRONMENT`, `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN` | QuickBooks Online | second and fourth |
| `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Facebook, Instagram, WhatsApp | all but the first |
| `DIALPAD_CLIENT_ID`, `DIALPAD_CLIENT_SECRET`, `DIALPAD_WEBHOOK_SECRET` | Dialpad | second and third |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM_NUMBER` | Text messages | second |

Never set in production: `MOCK_OAUTH_BASE`, `MOCK_CLIENT_ID`, `MOCK_CLIENT_SECRET` and the other `MOCK_` names. They belong to the test provider.

**Stored by the platform itself**

| What | Where | Protection |
| --- | --- | --- |
| Tokens of connected accounts (Google, Square and so on) | Database, table `app.integration_connections` | Sealed by the server with `TOKEN_ENC_KEY` before storing (`api/_lib/crypto.js`). The database cannot open them and a backup holds them sealed. Never sent to the browser. |
| Invitation and reset tokens | Database | Only a hash is stored (`supabase/migrations/0022_invitations.sql`) |
| Recovery codes for two-step sign-in | Database | Only hashes are stored (`supabase/migrations/0021_sessions_mfa.sql`) |

**Operational (outside the application)**

| What | Lives in | Holder |
| --- | --- | --- |
| Database password of each Supabase project | Password manager. Used only for backups and for running migrations by hand; the application does not use it. | ______ |
| Backup private key of each deployment (`AGE-SECRET-KEY-1...`) | Password manager only | ______ (two people) |
| Logins and recovery codes: GitHub, Vercel, Supabase, the domain registrar, each provider console | Password manager, with two-factor sign-in on every account | ______ |
| `GITLEAKS_LICENSE` | GitHub, repository secrets (Actions and Dependabot) | ______ |

## Making a new secret

1. IN: your password manager. Use its generator: 48 characters or more, letters and digits. Save it in the entry for the right deployment before using it anywhere.
2. For `TOKEN_ENC_KEY` only, which must be exactly 32 random bytes written in base64: IN: VS Code terminal, run

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   copy the line it prints into the password manager entry, then clear the terminal (type `cls`).
3. IN: Vercel, Project (the right one: check the name), Settings, Environment Variables. Add or edit the variable. Tick **Sensitive**. Tick **Production** only.
4. IN: Vercel, Project, Deployments. Open the latest production deployment, press **Redeploy**. A running deployment keeps the old values until then.

## When to replace a secret

* When a person who could read it leaves or changes role. The same day.
* When it was seen outside the three places of rule 1 (a scan finding, a paste, a screenshot).
* After a security incident, for every secret the affected system could reach.
* On a schedule the owner sets: every ______ (owner decides).

## How to replace each one

Each procedure ends the same way: check that the feature works, then record the date and the reason in the security log.

**The database server key (`SUPABASE_SERVICE_ROLE_KEY`) and public key**

1. IN: Supabase Dashboard (the right project), Project Settings, API Keys.
2. If the page offers to create a new secret key next to the existing one: create it, copy it.
3. IN: Vercel, Project, Settings, Environment Variables. Replace `SUPABASE_SERVICE_ROLE_KEY`. Redeploy.
4. IN: a browser. Open `/api/health` on the deployment and sign in once. Both work.
5. IN: Supabase Dashboard, Project Settings, API Keys. Delete the old key.
6. If the page only offers to regenerate the signing secret for the older style of keys: that replaces the public key and the server key together and signs everyone out. Do it at a quiet hour, then replace both variables in Vercel and redeploy at once. Menu names differ between dashboard versions; read what the page says before pressing.

**`SESSION_SECRET`**

Planned replacement, nobody is signed out:

1. IN: Vercel, Environment Variables. Copy nothing: add `SESSION_SECRET_PREVIOUS` and type into it the current value from the password manager.
2. Replace `SESSION_SECRET` with a new value. Redeploy.
3. The next day: delete `SESSION_SECRET_PREVIOUS`. Redeploy.

After a suspected leak: replace `SESSION_SECRET`, do not set the previous one, redeploy. Every open session ends and people sign in again. That is the point.

**`TOKEN_ENC_KEY`**

1. IN: Vercel, Environment Variables. Add `TOKEN_ENC_KEY_PREVIOUS` with the current value.
2. Replace `TOKEN_ENC_KEY` with a new 32-byte value. Redeploy. Tokens sealed with either key still open (`api/_lib/crypto.js`), and the same file lets the server tell which ones still need sealing again with the new key.
3. Ask the developer to confirm that no stored token is still sealed with the old key. Only then delete `TOKEN_ENC_KEY_PREVIOUS` and redeploy. A token that was not resealed by then stops working and its account has to be connected again.
4. After a suspected leak of this key, also disconnect and reconnect every connected account (below): the sealed tokens must be assumed readable.

**`IP_HASH_SALT`, and `ip_hash_salt` in Vault**

1. Replace the value IN: Vercel, Environment Variables, and IN: Supabase Dashboard, Vault. Redeploy.
2. Effect to know: hashes written after the change cannot be matched with hashes written before it. Rate limit counters start again, and "same address as before" can no longer be told across the change in the audit trail.

**`CRON_SECRET`**

1. IN: Vercel, Environment Variables. Replace it. Redeploy. Vercel sends the new value with scheduled calls by itself.
2. IN: Vercel, Project, Logs. The next scheduled run answers with status 200.

**A provider key or client secret (Resend, Google, Square, QuickBooks, Meta, Dialpad, text messages, Anthropic)**

1. IN: the provider's console. Create a new key or secret. Most consoles allow two at once.
2. IN: Vercel, Environment Variables. Replace the value. Redeploy.
3. IN: the application, Integrations screen (as an owner). The connection still shows its real state and a test call works.
4. IN: the provider's console. Delete the old key.

**A webhook signing secret**

1. IN: the provider's console. Create a new signing secret for the webhook (or a new webhook endpoint with its own secret).
2. IN: Vercel, Environment Variables. Replace the value. Redeploy.
3. IN: the provider's console. Send a test event. IN: Vercel, Project, Logs: the call to `/api/webhooks/` answers with status 200.
4. Delete the old secret or endpoint at the provider. Events sent in the minutes between steps 1 and 2 are refused and retried by the provider.

**The tokens of a connected account**

1. IN: the application, Integrations screen. Press **Disconnect** on the connection. The stored tokens are deleted, and the provider is asked to revoke them where it offers that. (Proved with imitated provider answers only; no live provider has been connected yet.)
2. IN: the provider's own security page (for Google: the account's "Third-party access"). Check the application no longer has access; remove it if it does.
3. IN: the application, Integrations screen. Connect again.

**The tax ID encryption key (`pii_encryption_key`)**

Replacing it means decrypting and re-encrypting every stored tax ID. **That procedure is not built.** Until it is: guard this key as the most sensitive value in the system, keep it with two people, and treat a suspected leak as an incident (`docs/security/monitoring-and-incident-response.md`). This is listed as a gap.

**The database password**

1. IN: Supabase Dashboard, Project Settings, Database. Press **Reset database password**. Let the dashboard generate it.
2. IN: your password manager. Replace the entry.
3. Nothing in Vercel changes: the application does not use this password.

**The backup key pair**

1. Create a new pair (`docs/security/backup-and-recovery.md`, section 2). New backups use the new public key.
2. Keep the old private key in the password manager for as long as backups made with it are kept. Mark the entry with the date it stopped being used.
3. After a suspected leak of the private key: the old backups must be assumed readable. Destroy them or re-encrypt them, and record which.

**An account login (GitHub, Vercel, Supabase, a provider console, the registrar)**

1. IN: that service, account settings. Change the password, sign out other sessions, and review the list of two-factor devices and access tokens.
2. When a person leaves: remove them from the organization or team IN: GitHub, IN: Vercel and IN: Supabase, the same day, then replace every secret in this document that they could read.

## If a secret leaked

1. Replace it now, using the procedure above. Do not wait to understand how it leaked.
2. IN: the provider's console or logs. Look for use of the old key that was not yours.
3. If it was in the repository: it stays in the Git history after the file is fixed. Replacing it is what makes it harmless; cleaning the history is a second, slower step (`docs/security/repository-cleaning.md` describes the method).
4. Record it and follow `docs/security/monitoring-and-incident-response.md`.

## To reconcile

* `.env.example` still lists the earlier, shorter set of variables. When it is rewritten it becomes the list of record, and `scripts/security/scan-bundle.mjs` reads the secret-looking names from it automatically.
* The server document (planned as `docs/SERVER.md`) is not written yet. Endpoint names in the checks above come from the code in `api/`.
* How to confirm that every stored token was resealed after a `TOKEN_ENC_KEY` change (step 3 above) needs a query or a screen from the server side.
