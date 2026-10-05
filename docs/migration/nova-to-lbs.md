# Moving Lion Business Services from NOVA to LBS Command

**Status: proved on generated data; never run against NOVA or an LBS database.**
Everything below was rehearsed on a throwaway local PostgreSQL with a fictional data set of the same size and shape
as NOVA (`npm run test:migrate`). No command in this document has been run on a Supabase project. The first real run
must be the rehearsal in step 2, on a copy, with the owner watching.

Written for the person who operates the migration on Windows with VS Code. Every step says where to do it:
"IN: VS Code terminal" or "IN: Supabase Dashboard, project ...".

## What this tool does and does not do

* It reads NOVA and inserts into LBS Command. It never updates or deletes anything in NOVA. Three separate locks
  enforce that (a statement check, a read-only session, a role that cannot write), and step 0 refuses to start when
  the third one is missing.
* It never copies a tax ID. The audit found none stored in NOVA; the four tax ID columns are not in the list of
  columns the tool reads, and the load runs as a role that has no access to the vault table. If the preflight report
  says NOVA does hold tax IDs, each one is typed in again by a person through the vault of LBS Command.
* It never creates a team member. NOVA staff are matched to people already invited to LBS Command, by email.
* It never loads a record a person has to look at first. Those wait in a list until the owner answers.
* It can take its own work out again (step "If something is wrong"), exactly the rows it put in.

## Before you start: what must be on the computer

IN: VS Code terminal (PowerShell)

```
node --version          # 20 or newer
psql --version          # 16 or newer. Install: winget install PostgreSQL.PostgreSQL.16  (client tools are enough)
age --version           # Install: winget install FiloSottile.age
```

If `psql` is installed and not found, set the folder once per terminal: `$env:PGBIN = "C:\Program Files\PostgreSQL\16\bin"`.
The backup script is a shell script: run it in the VS Code terminal with the **Git Bash** profile.

Pick a folder for the reports that is **outside the repository and outside OneDrive or any synced folder**, for example
`C:\Users\<you>\lbs-migration`. One file in it (`40-needs-review.csv`) shows client names, emails and phone numbers in
full. On Windows the tool cannot set file permissions; the folder's own protection is what keeps it private.

## What the owner decides before step 5

1. **The answers to the needs-review list** (`40-needs-review.csv`). One word per row in the `decision` column:
   * `load`: bring it over (a duplicate that is really two people who share an email, a record NOVA had marked for
     review that is a real client, a record wrongly taken for a sample);
   * `skip`: do not bring it over;
   * `load_without_field`: bring the client over with the unusable email or phone left empty.
   A row with no answer is not loaded and stays in NOVA.
2. **Which history to carry.** The tool carries what the table below says. Invoices, payments, appointments, credits,
   tickets and the old list of services per client are counted and listed, not carried (reasons below). If any of them
   should come over, say so before step 5: it is a change to the tool, not a switch.
3. **Who approves.** One named person reads `40-dry-run.md` and approves it. Their name is stored with the batch.
4. **Team members.** Everyone who owned clients or leads in NOVA should be invited to LBS Command with the same email
   before step 3, or their clients arrive unassigned (the report says how many).
5. **How long NOVA stays readable** (step 10).

## The ten steps of the brief, and the command for each

Set these once per terminal session. Nothing here is saved to a file. Passwords are typed, never pasted into a file
of the repository.

IN: VS Code terminal (PowerShell)

```
$env:MIGRATE_REPORT_DIR = "C:\Users\<you>\lbs-migration\reports"
$env:LBS_TENANT_SLUG    = "<the slug of the Lion Business Services company in LBS Command>"
# NOVA, with the read-only role of step 2
$env:NOVA_PGHOST = "db.<nova project ref>.supabase.co"; $env:NOVA_PGPORT = "5432"; $env:NOVA_PGDATABASE = "postgres"
$env:NOVA_PGUSER = "nova_migration_ro"; $env:NOVA_PGSSLMODE = "require"; $env:NOVA_PGPASSWORD = Read-Host "NOVA read-only password"
# LBS Command
$env:LBS_PGHOST = "db.<lbs project ref>.supabase.co"; $env:LBS_PGPORT = "5432"; $env:LBS_PGDATABASE = "postgres"
$env:LBS_PGUSER = "postgres"; $env:LBS_PGSSLMODE = "require"; $env:LBS_PGPASSWORD = Read-Host "LBS database password"
```

Use the **direct connection** shown under Connect in each Supabase project (port 5432). Do not use the transaction
pooler (port 6543). The tool has not been tried through a pooler.

### 1. Full encrypted backup

IN: VS Code terminal (Git Bash profile). This is the only step that connects to NOVA with its `postgres` role;
`pg_dump` only reads.

```
read -s -p "NOVA postgres password: " PGPASSWORD; export PGPASSWORD
BACKUP_LABEL=nova BACKUP_DIR=/c/Users/<you>/lbs-migration/backups BACKUP_AGE_RECIPIENT=age1... \
PGHOST=db.<nova project ref>.supabase.co PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGSSLMODE=require \
bash scripts/backup/backup.sh
unset PGPASSWORD
```

It writes `nova_<time>.dump.age`, a `.sha256` file and a manifest. Prove the backup can be
restored before relying on it: `docs/security/backup-and-recovery.md`. Then, back in PowerShell:

```
$env:MIGRATE_BACKUP_FILE = "C:\Users\<you>\lbs-migration\backups\nova_<time>.dump.age"
```

The backup must be less than 24 hours old when step 2 runs.

### 2. Isolated migration target

**The read-only role in NOVA.** One statement block, run once. It adds a database role; it changes no record.

IN: Supabase Dashboard, project Nova-crm, SQL Editor

```sql
create role nova_migration_ro login password '<a long random password from the password manager>' bypassrls;
grant usage on schema public to nova_migration_ro;
grant select on all tables in schema public to nova_migration_ro;
```

`bypassrls` is needed because NOVA's row level security shows a client only to a signed-in owner; without it the role
would silently read zero rows (the preflight checks for exactly that). Not verified on Supabase: whether the dashboard
lets `postgres` create a role with `bypassrls` on NOVA's PostgreSQL version. If it refuses, stop and report it; do
not work around it by connecting as `postgres`, the preflight will refuse that role because it can write.

**The target.** Lion Business Services has its own Supabase project (sections 3 and 53 of the brief): its own
database, storage, secrets and backups. For the rehearsal use a second, empty project (or a Supabase branch of the LBS
project) with the same migrations; for the real run use the LBS project itself.

IN: Supabase Dashboard, project LBS (or the rehearsal project), SQL Editor: all migrations of `supabase/migrations`
applied in order, including `0060_migration_staging.sql`; the Lion Business Services company created with edition
`practice`; the team invited.

IN: VS Code terminal

```
node tools/migrate-nova/00-preflight.mjs      # report: 00-preflight.md
node tools/migrate-nova/10-extract.mjs        # report: 10-extract.md   prints the batch id
```

`00-preflight` changes nothing. It refuses when the NOVA role could write, when row level security would hide rows,
when a table or column is missing, when the two databases are the same one, when the staging migration is missing, or
when the backup is missing, unencrypted, older than 24 hours or does not match its checksum.
`10-extract` copies twelve NOVA tables into the schema `migrate` of the target and compares each with NOVA by row
count and checksum. Do it when nobody is working in NOVA: a table that changes while it is read is refused.

### 3. Dry run

```
node tools/migrate-nova/20-map.mjs            # report: 20-map.md      unmapped lead sources and stages, staff matched
node tools/migrate-nova/30-validate.mjs       # report: 30-validate.md one outcome per record, and why
node tools/migrate-nova/40-dry-run.mjs        # reports below          prints APPROVAL TOKEN: <64 characters>
```

`40-dry-run` runs the whole load inside one transaction on the target and rolls it back. Every rule of the real
tables has its say; nothing stays.

### 4. The migration report

In the report folder:

| File | What it is | May it be shared? |
| --- | --- | --- |
| `40-dry-run.md` | totals per kind of record: created, skipped, duplicate, invalid, needs review; counts source against target; twenty samples per kind, source next to target | yes, inside the firm: emails, phones and names are masked |
| `40-dry-run-totals.csv`, `40-dry-run-counts.csv`, `40-dry-run-samples.csv` | the same as spreadsheets | yes, masked |
| `40-needs-review.csv` | every record a person has to decide on, values in full | **no. Never email it, never commit it, delete it after step 9** |

### 5. Human approval

The owner fills the `decision` column of a copy of `40-needs-review.csv` (see "What the owner decides").

```
node tools/migrate-nova/30-validate.mjs --decisions "C:\Users\<you>\lbs-migration\answers.csv" --decided-by "Full Name"
node tools/migrate-nova/40-dry-run.mjs        # a new report and a NEW token: the old approval is void
```

Repeat until the report is the one the approver accepts. The approval is three things given to the next command: the
token of that exact report, the approver's name, and the checksum of the backup (in the `.sha256` file of step 1).

### 6. Insert only

```
node tools/migrate-nova/50-apply.mjs --approve <token> --approver "Full Name" --backup-sha256 <checksum>
```

It refuses when any of the three is missing or wrong, when the report file is not the approved one, or when step 3
was run again after the approval. It inserts in batches (200 records; `MIGRATE_BATCH_SIZE`), each batch one
transaction. It can be run again after an interruption: the id map remembers what was created, nothing is inserted
twice.

Role and settings, exactly: the connection is the project's role `postgres` (direct connection). Every batch runs
`SET LOCAL ROLE service_role` with `request.jwt.claims` empty. That is the server path of `docs/DATABASE.md`
section 10: history rows (handoffs, timeline entries, notes) keep their original dates and authors because no
signed-in person is attached, and `service_role` has no privilege on the vault table and cannot change or delete
history. `postgres` must be a member of `service_role` (it is on Supabase; the preflight checks).

### 7. NOVA is never updated or deleted

Nothing to run. How it is enforced: `tools/migrate-nova/source.mjs` is the only file that connects to NOVA; it sends
only `SELECT` and `COPY (SELECT ...) TO STDOUT`, inside `BEGIN TRANSACTION READ ONLY`, on a session opened with
`default_transaction_read_only = on`, with a role that holds no write privilege. `50-apply` and `70-rollback` do not
load that file at all.

### 8. Compare source and destination counts, and 9. validate critical samples

```
node tools/migrate-nova/60-reconcile.mjs      # reports: 60-reconcile.md, 60-reconcile.csv, 60-reconcile-samples.csv
```

It compares NOVA now with the staged copy (count and checksum per table), checks that every source row has one
outcome, that every "created" outcome is one row in the target and the reverse, and compares **every** loaded row
with what the mapping said, column by column. Twenty records per kind are listed field by field. It ends with
"Unresolved differences": the list must say "None." It exits with an error when it does not.

Then a person opens LBS Command and checks at least ten clients they know against NOVA: name, phone, email, address,
language, notes, owners of a business. The tool cannot do that part.

### 10. Keep NOVA readable

The tool never switches NOVA off. Recommendation, for the owner to decide: the team stops entering data in NOVA on
the day of step 6 and keeps it for reading until Lion Business Services confirms the new platform in writing; the
brief sets no number of days and this document does not invent one. Things that stay only in NOVA are listed under
"Not carried". Check the plan of the Nova-crm project: Supabase pauses inactive projects on the free plan, and a
paused project is not readable. When NOVA is finally retired, remove the read-only role first:

IN: Supabase Dashboard, project Nova-crm, SQL Editor

```sql
drop owned by nova_migration_ro; drop role nova_migration_ro;
```

After LBS has confirmed, remove the staged copy of NOVA from the LBS database (the id map and the outcomes stay):

```
node tools/migrate-nova/90-purge-staging.mjs --confirm "REMOVE STAGING"
```

## If something is wrong: taking the import out again

```
node tools/migrate-nova/70-rollback.mjs --batch <batch id> --confirm "REMOVE THIS IMPORT"
```

Removes exactly the rows the id map recorded for that batch, in one transaction, and checks that the number removed is
the number recorded. It refuses when people have already changed imported records (add `--discard-edits` only after
the owner agrees to lose those changes). It needs the staged copy, so run it before the purge. The audit log keeps
the record of the import and of its removal: audit entries are never removed. It runs as `postgres`, not as
`service_role`, because imported timeline entries are append-only for every role; the rule is lifted for that one
table for the length of the transaction. Do it while nobody is working.

## What is carried over

| NOVA | LBS Command | Notes |
| --- | --- | --- |
| `clients` that are clients | `clients` | individual or business; name, company, phone, email (lower case), one address line, client since, language, email opt-out, SMS opt-in, WhatsApp number, social links, birthday, lifecycle active or inactive, office, owner; `external_ids.square` and `external_ids.nova`; website, business type, partner terms and documents folder link in `extra` |
| the person named on a business record | `client_people` (contact) | primary when the business has no primary owner |
| `client_owners` | `client_people` (owner) | |
| `clients.notes`, `client_comments` | `notes` | original date; original author when matched |
| `clients` that are open leads | `leads` | stage and source mapped to the company's ids; value, next action, lost reason; ticket `NOVA-0001`... |
| clients with lead history | one closed (won) `leads` row linked to the client | so the history has a record to hang under |
| `lead_assignments` | `lead_handoffs` | original date and people |
| `lead_activities` | `notes` (notes, contact attempts) and `activity` (stage changes, conversion, loss) | "assignment" entries are already the handoff |
| `services` | `catalog_services` | name, category, description, active; conversion trigger in `extra` |
| `service_variations` | `catalog_tiers` | price, name, Square variation id in `external_ids.square`, SKU and pricing type in `extra` |
| `appointment_types` | `appointment_types` | three languages, minutes, fee, prepaid when it has a fee |
| `offices` | `offices` | an office with the same name is reused |
| `profiles` | matched to `tenant_members` by email | never created |

Lead stages: new, contacted, appointment_set to appointment, proposal_sent to proposal, negotiating, won, lost.
Lead sources: website, phone, walk_in, referral, google, facebook, instagram, whatsapp, existing_client, other. Any
other text becomes `other`, the original text is kept in the source detail, and the report lists it.

## Not carried, and why

| NOVA | Why | Where it stays |
| --- | --- | --- |
| tax ID columns of `clients`, `tax_id_reveal_sessions`, `pii_access_log` | never copied by design | NOVA; re-entered through the vault if one exists |
| the 5 sample services, the demo firm's clients, the sample lead, anything matching `tools/migrate-nova/sample-criteria.json` | the brief: sample and test records are not customers | listed in the needs-review file with the rule that matched; `load` overrides |
| `invoices`, `payments` | the audit found only the demo firm's; in LBS Command an invoice or payment belongs to an engagement, NOVA's belong to a client | others are listed as needs review; decision for the owner |
| `appointments`, `consultation_credits`, `client_credits`, `tickets`, `client_services`, `sales_pitches`, `reviews`, `contracts`, `jobs`, `estimates` | no live rows at the time of the audit, or no equivalent yet | counted in the report; a count above zero is a question for the owner |
| `audit_log` | it stores hashes, not values | NOVA |
| `service_gap_rules`, `recommendation_dismissals` | the rules match no live service | the practice edition has its own |
| `client_office_access`, `client_access_requests` | access is granted again, with an end date | |
| client photos (`photo_url`) | they sit in a public storage bucket in NOVA; the files are not copied | NOVA |
| unassigned office | 571 of 573 clients had none | they arrive without an office and are visible to the whole team, as the access rule says; the report counts them |

## For the developer

* One command proves everything on generated data: `npm run test:migrate` (about 15 seconds).
* `tools/migrate-nova/source-tables.mjs` is the list of what is read. `sql/20-map.sql` is the mapping.
  `sql/30-validate.sql` is the rules. `sql/load/*.sql` is the load, shared by the dry run and the apply.
* Known limits: names are compared with the target's `app.norm_name`, which drops letters outside A to Z, so a name
  written only in Chinese characters never matches by name (email and phone still match). Duplicates are not merged:
  the later record waits for a decision. A decision cannot yet say "attach this record's notes to the other one".
