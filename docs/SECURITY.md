# Security

Written for the owner and for the developer who takes over. It says what protects customer data, what the automated test proves, and what is not in place yet. Nothing described here has been deployed.

The owner's standing rule: security defaults on every build. Row level security, encryption of sensitive personal data, audit logs, consent capture, and separate companies from day one. This document goes through each.

## 1. Companies are kept apart inside the database

Every customer company shares one database. What keeps them apart is not the app: it is the database.

* **Every table that holds company data has a `tenant_id` column**, required, indexed.
* **Row level security is enabled and forced on every table.** "Forced" means the rule applies even to the role that owns the tables. A person's query can only ever return rows of a company they belong to, whatever the app asks for.
* **Links between records include the company.** A job points at its client with the pair (company, client). The database refuses a job in company A that points at a client of company B, even for a server process that bypasses the row rules.
* **A row can never move to another company.** A trigger blocks any change of `tenant_id`, for everyone.
* **The anonymous role has no privilege on anything in this project**: none of its tables, views or functions. The browser key that ships with a Supabase app can do nothing here until a person signs in.
* **The last migration checks the house rules** and refuses to finish if a table lacks row level security, a company column or its index.

How membership is decided: `tenant_members` links a signed-in person to a company with one role. The helper functions in the `app` schema (for example `app.tenants_can('clients')`, `app.is_member(tenant_id)`, `app.current_worker(tenant_id)`) read that table and are used by every rule. They run with a fixed search path. The `app` schema is not exposed to browsers.

Two details a developer should know:

* The rules are written so the membership lookup runs once per query, not once per row. The slower style took over a minute on 100,000 rows in testing; the current one takes about 20 milliseconds. A test fails if a slow-style rule is added.
* The helper functions and the role views run as the migration role (`postgres` on Supabase), which is allowed to bypass row level security. That is what lets them read the membership table without the rules calling themselves. The first migration stops with a clear message if it is run by a role that cannot do this.

## 2. The role matrix

The same matrix as `src/domain/permissions.ts`, enforced by the database. A test compares the two lists and fails if they differ.

| | Owner | Manager | Office staff | Field worker |
| --- | --- | --- | --- | --- |
| Leads, clients, tasks, documents, messages | Read and write | Read and write | Read and write | No (own tasks only, see below) |
| Jobs | Read and write, with price | Read and write, with price | Read and write, **without price or payment terms** | Only jobs they are assigned to, without price |
| Client payments, expenses, worker payments | Read and write | Read and write | **Nothing** | Only payments made to them, read only |
| Assignments (who does what, agreed amount) | Read and write | Read and write | Who and what, without amounts | Their own, read only |
| Workers (pay rate, W-9, insurance) | Read and write | Read and write | Name, trade, phone, email only | Their own record, without pay rate |
| Worker tax ID | Through an audited function | Through an audited function | No | No, not even their own |
| History | All | All | Without entries that carry amounts | No |
| Automations | Yes | Yes | No | No |
| Consent records, 1099 export | Yes | Yes (cannot give or revoke the 1099 consent) | No | No |
| Change company name, branding and settings | Yes | No (read only) | No (read only) | No |
| Membership (add, change role, disable) | Yes | No | No | No |
| Audit log | Read | No | No | No |
| Delete records | Yes | Yes | No (their own notes only) | No |
| Work logs | Read and write | Read and write | Read and write | Add for assigned jobs, as themselves; read their own |
| Mark a task done | Yes | Yes | Yes | Their own tasks only |

Things nobody can do from a browser, whatever their role: create a company, change a company's address, plan or status (VYNTEX does that through the server), write e-signature evidence on a document, mark a message as sent, change or delete history, change or delete a consent record, read the encrypted tax ID column.

Where a role may see a row but not all of its columns, the app reads a view instead of the table: `jobs_basic`, `job_assignments_basic`, `worker_directory` for office staff, `my_jobs` and `my_worker_profile` for workers. The hidden columns do not exist in those views. Supabase's database linter flags such views as "security definer views". That is intended here: each view carries its own access rule and is marked as a security barrier, and the tests check both.

Two limits of the matrix that the owner should know:

* **Profit for managers.** The app hides profit figures from managers. A manager can still read prices, payments and expenses, so they could work the profit out. The database cannot hide a number that follows from numbers the person may see. If managers must not know profit, they must not see costs either; that is a change to the matrix, to decide.
* **Documents for office staff.** Staff may open documents but not money. An invoice shows a price. Today the database lets staff see the document record and its wording, not the job price, so the screens will have to show staff an invoice without amounts or not show invoices to staff. To decide.

## 3. Encryption of sensitive personal data

The pricing rules and the product imply one sensitive field today: a worker's tax ID (SSN, EIN or ITIN from a W-9), needed for 1099 work.

* It is stored only as `workers.tax_id_enc`, encrypted inside the database with pgcrypto (OpenPGP, AES-256). There is no plaintext column anywhere; a test checks that.
* No table or view returns it, not even encrypted: signed-in people have no privilege on that column. A separate column, `has_tax_id`, lets the app show "tax ID on file".
* Storing it goes through `set_worker_tax_id`, reading it through `get_worker_tax_id`. Both are for owner and manager only, and both write an audit entry without the value.
* The audit log never contains the tax ID or its encrypted form.
* The same pair of functions (`app.encrypt_pii`, `app.decrypt_pii`) is the pattern for any sensitive field added later, such as a bank or payment reference.

**The key.** The database reads it by name, `pii_encryption_key`, from one of two places:

| Option | Where the key lives | Use it when |
| --- | --- | --- |
| Supabase Vault (recommended) | A secret named `pii_encryption_key` in the project's Vault. Signed-in people and the anonymous role have no access to Vault. | Production on Supabase |
| Database setting | `app.settings.pii_encryption_key` | Local tests and self-managed Postgres. Any session that can run SQL can read a setting, so do not use this on Supabase. |

The setting wins when both exist. Without a key of at least 32 characters the functions refuse to store or read anything; they never fall back to plain text.

**Keep a copy of the key in the company password manager.** If the key is lost, the stored tax IDs cannot be recovered. Changing the key requires re-encrypting every stored value; that procedure is not written yet.

Network addresses are never stored. Where "from where" matters (audit log, consent, demo requests), a keyed hash is stored instead, using a second secret (`ip_hash_salt` in the database, `IP_HASH_SALT` for server functions). Without that secret nothing is stored.

## 4. Audit log

`audit_log` records who did what to the sensitive tables: client payments, worker payments, expenses, assignments, job price changes and job deletions, membership, the company record, workers, documents and consent. For each entry: company, person, their role at that moment, the action, the table, the row, and what changed (old and new value of the changed columns only).

* It is written by database triggers, so the app cannot forget or skip it.
* Contact details, payment references and document wording are replaced with `[redacted]`.
* Reading a tax ID and running the 1099 export are recorded too.
* **It cannot be altered.** There is no rule that allows an update or a delete, the privileges are removed, and a trigger blocks update, delete and truncate for everyone, including the server key and the SQL Editor. Removing an entry would take a deliberate change to the database structure.
* Only the owner of a company can read its audit log.

The activity history that people see on each record (`activity`) is separate and also append-only.

## 5. Consent capture

`consent_records` stores who consented to what, the exact text they agreed to, when, and from where (hashed).

* For a signed-in person, "who recorded it" and "when" come from the session, not from what the browser sends. A consent cannot be back-dated or recorded under another person's name.
* A record is never edited or deleted. It can be revoked once, with a reason, and the revocation is recorded.
* **1099 work.** The pricing rules say 1099 work is performed by Lion Business Services and requires the customer's written consent to share subcontractor payment data. So the function that exports worker payment totals (`export_1099_data`) refuses to run unless the company has an active consent of that kind, and only the company owner can give or revoke it. Revoking it stops the export at once. A consent can be limited to one tax year.
* The demo request form stores its own consent (the sentence, the time) in `demo_requests`.

Consent recorded by office staff on behalf of a client (for example "agreed by phone") is marked with the staff member who recorded it. Consent given directly by a client or worker on a signing page is not built yet.

## 6. Secrets

* Secrets are read from environment variables (Vercel) or from Supabase Vault. `.env.example` lists every variable with no values. `.gitignore` keeps every `.env` file out of Git except that example.
* The Supabase server key (service role) bypasses row level security. It is used only inside server functions in `api/`, never in browser code. The public key (anon) is safe in a browser only because of everything in section 1.
* The server functions in `api/` do not return or log a secret, and when another service answers with an error they keep only the status code, not the message.
* `api/health.js` says only yes or no for whether each integration is configured.
* Never paste a key into a chat, an email, a ticket or a commit. If one leaks, replace it at the provider first, then update Vercel.

## 7. Browser protections

`vercel.json` sends these on every response:

* A Content-Security-Policy that allows scripts and styles from this site only, Google Fonts for the font stylesheet and font files, images from this site and from the browser's own memory (`data:` and `blob:`, used for uploaded logos and drawn signatures), and network calls to this site only. Inline scripts are blocked. The site cannot be embedded in another site.
* `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a `Permissions-Policy` that turns off camera, microphone, location and payment requests.

When the pages start talking to Supabase directly (customer mode), `connect-src` in `vercel.json` must gain the project address: `https://<project-ref>.supabase.co wss://<project-ref>.supabase.co`. It is left out today because nothing in the browser calls Supabase, and a narrower policy is safer.

Caching: every file in `/assets/` has a hash of its content in its name, so browsers may keep it for a year. `index.html` is always checked for a new version, and it points at the current files.

## 8. What the automated database test proves

`bash supabase/tests/run_local.sh` starts a throwaway PostgreSQL 16, applies every migration in order as a role that is not a superuser (as on Supabase), and runs more than 1,500 checks. Each check raises an error on failure. It proves:

* every table has row level security enabled and forced; every company table has its company column, required and indexed; every link between company tables includes the company; every privileged function has a fixed search path;
* the anonymous visitor can read and write nothing;
* **people of company A cannot read, change, delete, move or insert rows of company B, in every table and view**. The list of tables comes from the database catalog, so a new table is covered without editing the test. Seven kinds of people are tried (owner, manager, staff, worker, disabled member, owner of a third company, signed-in person with no company). Afterwards company B's data is compared byte for byte with a snapshot;
* the zeros are real: the same statements return rows for the people entitled to them, and a deliberately careless rule, added and rolled back inside the test, is detected as a leak;
* a link from one company's record to another company's record is rejected for every one of the 30 links, even when row level security is bypassed;
* each role matches the matrix above, including: staff cannot read payments; a worker sees only their own rows and no prices; a manager cannot change membership;
* the audit log records with the right person and role, redacts what it should, and cannot be altered by anyone;
* a tax ID round-trips encrypted, is unreadable by staff and workers, cannot be read without the key, and every read is audited;
* the 1099 export refuses without consent, works with it, and refuses again after revocation;
* the company address rule, the role matrix, the value lists and the industries are identical in the app code and in the database.

A second script, `bash supabase/tests/mutation_check.sh`, tests the test: it breaks one rule at a time (a rule loosened, a trigger removed, a column exposed, 28 breakages in all) and confirms the suite notices. It caught all 28.

**What that test does not prove.** It runs against local stand-ins for the parts Supabase provides: the roles, `auth.uid()`, the `auth` and `storage` schemas, and Vault. It does not exercise Supabase's Data API, Supabase Auth, the Storage service or the real Vault. In particular:

* the storage rules were tested against a stand-in `storage.objects` table, not the Storage service;
* the Vault lookup was tested against a stand-in table;
* the address hash in the audit log depends on a request header the Data API provides; locally that header was set by hand;
* the assumption that Supabase's `postgres` role may bypass row level security is checked by the first migration when it runs, not before.

The same checks should be repeated once on the real project before the first customer. `docs/DEPLOYMENT.md` has that step.

## 9. Not in place yet

An honest list. None of these is hidden behind a screen that pretends otherwise.

* **Customer mode itself.** No sign-in screen, no Supabase connection in the pages, no implementation behind `src/platform/gateway.ts`. No customer data flows anywhere today.
* **Creating a company and inviting people.** Done by hand in the Supabase dashboard for now. No server function, no admin screen.
* **Verification on real Supabase** (see section 8).
* **Plan limits** (number of users per plan) are not enforced by the database.
* **A suspended company.** Only `closed` locks a company out. `suspended` is stored but changes nothing yet.
* **Key rotation** for the encryption key, and a documented restore test of backups. Backup frequency and point-in-time recovery depend on the Supabase plan; confirm before launch.
* **Two-factor sign-in, password rules, session length.** Supabase Auth settings to choose at setup.
* **Real e-signatures.** The columns for the evidence exist and only the server may write them. The signing page, the storage for signature images and the legal review of the wording do not exist.
* **Customer-facing consent pages** (a client or worker giving consent themselves).
* **Sending email or text messages for customers.** Messages can be prepared and queued; nothing sends them.
* **Automations on the server.** Rules run in the browser in the demo. For customers they should run on the server.
* **Stripe.** Not connected. Test mode first; Stripe Tax stays off until the owner confirms the tax setup.
* **Rate limits.** The demo request form limits requests per address in memory, which is a first line of defence only. The assistant endpoint is not behind sign-in.
* **Monitoring and alerts**: error tracking, uptime checks, alerts on unusual access.
* **Data retention and deletion**: closing a company's account, deleting its data on request, exporting it.
* **Reads are not audited**, except tax ID reads and 1099 exports.
* **Privacy policy, terms of service, data processing terms.** Not written. No claim about compliance with any standard is made anywhere, because none has been assessed.
* **Independent security review.** Not done.
* **Reproducible builds.** There is no `package-lock.json` in the folder yet; create it with `npm install` and commit it.
* **Automatic test runs.** The checks are run by hand. Nothing runs them on every change yet.
