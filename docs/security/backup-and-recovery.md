# Backup and recovery

Written for the owner and for the person who operates Supabase and Vercel. The owner's rule (brief, section 61): do not claim backups work unless a restore has been tested. This page says exactly what has been tested and what has not.

There are two deployments and two databases. Everything on this page is done twice, separately: once for **VYNTEX Command** (client companies) and once for **LBS Command** (Lion Business Services). Their backups never share a folder, a key or a storage location.

## What exists, in one table

| Layer | What it is | State |
| --- | --- | --- |
| 1. Supabase's own backups | Made by Supabase inside the project. What is kept and for how long depends on the plan. | Not checked. No project exists yet. To confirm IN: Supabase Dashboard once the projects exist (section 1). |
| 2. The extra encrypted copy | `scripts/backup/backup.sh` makes a dump of the database, encrypts it, and writes it to a place outside Supabase and Vercel. `scripts/backup/restore.sh` restores it. | Scripts written. Restore **tested locally** end to end (section 3). **Not tested against a Supabase project.** |
| 3. Files in Supabase Storage | Uploaded documents live in Storage, not in the database. A database backup holds their names only. | Manual procedure (section 6). No script. |
| Schedule and alerting | Something that makes the backup regularly and tells a person when it did not happen. | **Not built.** Section 7 lists the choices. |

## 1. Supabase's own backups

What Supabase keeps (daily backups, point-in-time recovery, for how many days) differs by plan and changes over time. No number is written here on purpose. Read it from the dashboard of the plan in use.

For each of the two projects:

1. IN: Supabase Dashboard. Open the project. Check its name at the top.
2. IN: Supabase Dashboard, Database, Backups. Read what the page says: whether scheduled backups exist on this plan, how many days are kept, and whether point-in-time recovery is on.
3. Write the three answers, with the date and the plan name, in the table of section 8.
4. IN: Supabase Dashboard, Database, Backups. If the page offers point-in-time recovery as an add-on, it has a monthly cost: the owner decides.
5. Confirm in Supabase's documentation (search "Database backups" on supabase.com/docs) what a backup does not include. At the time of writing it says the files in Storage are not part of a database backup, only their records. That is why section 6 exists.

Restoring one of Supabase's own backups replaces the project's current database with the earlier state. It is a button on the same page. Do not press it to try it out on a project that holds real data: the test of a restore is section 5.

## 2. The extra encrypted copy

Why have it when Supabase makes backups: a backup that lives inside the same account as the database is lost with the account (a billing problem, a deleted project, a stolen login). The extra copy is outside, encrypted, and can be restored on any PostgreSQL server.

### How it is protected

* **Encryption.** The dump is encrypted with age (age-encryption.org) to a public key, while it is being written. No readable copy touches the disk. Every block is authenticated: a damaged or altered file is refused at restore, and the local test checks that it is.
* **Why not `openssl enc -aes-256-gcm`.** OpenSSL's command line refuses it ("AEAD ciphers not supported"; tried here on OpenSSL 3.0.13). Its other modes do not detect tampering. So the scripts use age only.
* **Checksum.** A `.sha256` file is written next to each backup. `restore.sh` checks it first.
* **Manifest.** A small `.manifest.json` says what the file is (label, date, size, checksum, PostgreSQL version). It holds no address, no user name, no password.

### The keys, and where they live

Each deployment has its **own** key pair. Making one (once per deployment):

1. IN: VS Code terminal (Git Bash). Install age if it is not there: `winget install FiloSottile.age` in a PowerShell window, then reopen the terminal.
2. IN: VS Code terminal. Create the pair for LBS in a file outside the repository:

   ```
   age-keygen -o lbs-backup-key.txt
   ```

   It prints a line `Public key: age1...`.
3. IN: your password manager. Create an entry "LBS Command, backup key". Paste the whole content of `lbs-backup-key.txt` (it contains the private key, a line starting with `AGE-SECRET-KEY-1`).
4. IN: your password manager. Add the public key (`age1...`) to the same entry as a second field.
5. Delete the file `lbs-backup-key.txt` from the computer and empty the recycle bin. The private key now exists in the password manager only.
6. Repeat steps 2 to 5 for VYNTEX Command, with its own entry and its own pair.

| Key | Can do | Lives | Who holds it |
| --- | --- | --- | --- |
| Backup public key (`age1...`), one per deployment | Encrypt only | On the computer or job that makes backups, as `BACKUP_AGE_RECIPIENT` | Whoever runs backups |
| Backup private key (`AGE-SECRET-KEY-1...`), one per deployment | Decrypt a backup | Password manager only. Needed only to restore. | ______ (owner decides; at least two people, so one absence does not block a recovery) |
| Tax ID encryption key (`pii_encryption_key`), one per deployment | Read the encrypted tax IDs inside the database | Supabase Vault of that project, and the password manager | ______ |
| Database password, one per project | Connect to the database | Password manager | ______ |

Two facts to keep in mind:

* **A backup does not contain the tax ID key.** The tax IDs inside a backup are encrypted with a key that is deliberately not in the database dump. After a restore they stay unreadable until the key is put back in the Vault of the new project. The local test proves both halves (section 3, step 11). **If that key is lost, a perfect restore still cannot bring the tax IDs back.**
* **Losing the backup private key makes every backup unreadable.** There is no recovery from that.

### Making a backup

The scripts are Bash. On Windows they run in Git Bash (the terminal profile "Git Bash" in VS Code). They were run and tested on Linux only; the first run on Windows is a test of its own.

Needed on the computer, once:

1. PostgreSQL client tools of the same major version as the server or newer (the installer from postgresql.org; tick "Command Line Tools" only). The script refuses to run with an older `pg_dump`.
2. age (step 1 of the keys section).

For each deployment (shown for LBS):

1. IN: Supabase Dashboard (project of LBS Command). Press **Connect** at the top. Choose the **Session pooler** connection (or the direct connection if the computer has IPv6). Not the transaction pooler: `pg_dump` needs a full session. Leave this window open: it shows host, port, user and database name.
2. IN: VS Code terminal (Git Bash), in the repository folder. Type the settings, reading the values from that window. The password is typed, not pasted into a file. A leading space keeps the line out of the terminal history:

   ```
    export PGHOST=<host from the Connect window>
    export PGPORT=5432
    export PGUSER=<user from the Connect window>
    export PGDATABASE=postgres
    read -s PGPASSWORD && export PGPASSWORD
    export BACKUP_LABEL=lbs
    export BACKUP_DIR=<the folder for LBS backups, outside the repository>
    export BACKUP_AGE_RECIPIENT=<the LBS public key, age1...>
    export BACKUP_SCHEMAS="public app auth storage"
   ```

   After `read -s PGPASSWORD`, type the database password and press Enter. Nothing is shown.
3. IN: VS Code terminal. Run:

   ```
   bash scripts/backup/backup.sh
   ```

4. It prints the file it wrote, its size and its checksum. Three files appear in the folder: `lbs_<date>.dump.age`, the same name with `.sha256`, and `lbs_<date>.manifest.json`.
5. Close that terminal. The password it held is gone with it.
6. Copy the three files to the off-platform location (section 8 says where).

`BACKUP_SCHEMAS="public app auth storage"` saves four things in one file: the product's own tables, rules and functions (`public`, `app`), the accounts people sign in with (`auth`, which Supabase manages), and the records of stored files (`storage`). The accounts have to be in the backup: every membership in the product points at an account, and a restore without them is refused (the local test checks that). Supabase's other internal schemas are left out; the database role is not expected to be able to read all of them.

## 3. What the local restore test proves

`bash scripts/backup/restore-test.sh` runs the whole circle on one computer, with no network: it starts a throwaway PostgreSQL 16, applies every migration, inserts marker rows, makes an encrypted backup with `backup.sh`, drops the database, restores with `restore.sh` into a fresh database, and compares. Then it restores twice more:

* on a second, brand new server (roles first, then the whole database). This is the path for a PostgreSQL server the firm runs itself.
* on a third server prepared like a new Supabase project: the platform's roles, its `auth` and `storage` tables and its wide default privileges are already there, and the product is absent. The backup used is the one limited to named schemas, as in section 2. The platform's own tables are kept, the account rows and the product's policies on the storage table come back, and the product's schemas are restored. This is the shape a restore into Supabase takes, and the settings used are the ones in section 4.

What is compared (`scripts/backup/fingerprint.sql`): for every table, the number of rows and a checksum of their content; and every access rule: row level security flags, policies, privileges on tables, columns, schemas and functions, owners, function bodies, triggers, views, constraints, indexes, sequences. The two listings must be identical line for line. A restore that brought the data back without the rules that protect it would fail this test.

It also checks that:

* only encrypted files are written, and the marker text cannot be found in them;
* a wrong key is refused; an altered file is refused by the checksum, and by the decryption when the checksum is skipped;
* a restore is refused unless the target database is named twice, refused over a database that already has tables, refused when it would overwrite the platform's own tables, and refused when the accounts the product refers to are not restored with it;
* after the restore onto the prepared server, exactly one rule is missing, the one no backup of named schemas can carry (section 4, step 7). The test stops if that ever becomes more than one;
* no decrypted copy is left on disk afterwards;
* the comparison itself works: one cent changed in one row, and one weakened rule, are each noticed;
* on the restored database the encrypted tax ID is unreadable without its key and readable with it; a visitor who is not signed in is still refused; the owner of company A still sees company A's clients and none of company B's.

The result of the last run is at the end of this page (section 9).

**What it does not prove.** It runs against local stand-ins for what Supabase provides (roles, the `auth` and `storage` schemas, Vault). The stand-in `auth` schema has one table; the real one has many, and which of them must be carried is settled in the Supabase drill (section 5). It does not prove a restore into a real Supabase project, it does not cover the files in Storage, and it was not run on Windows.

## 4. Restoring for real

Two different situations.

**The project is fine, data was damaged or deleted by mistake.** Use Supabase's own backup first: it is the fastest way back.

1. Stop and tell the owner. Write down the time the damage happened, as exactly as possible.
2. IN: Supabase Dashboard (the affected project), Database, Backups. Choose the backup (or the point in time) just before the damage.
3. Read the warning: the restore replaces the current database, and everything entered after that moment is lost.
4. With the owner's go-ahead, press **Restore**.
5. Afterwards, do the checks of section 4.3 below.

**The project is gone or cannot be trusted** (deleted, account lost, compromised). Use the extra encrypted copy.

1. IN: Supabase Dashboard. Create a new project (cost: owner's approval). Follow `docs/DEPLOYMENT.md` for its settings, but **do not run the migrations**: the backup brings the tables and rules itself.
2. IN: Supabase Dashboard (new project), Vault. Add the secret `pii_encryption_key` with the value from the password manager, and `ip_hash_salt` the same way.
3. IN: VS Code terminal (Git Bash). Set `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` for the **new** project, as in section 2.
4. IN: your password manager. Copy the backup private key of this deployment.
5. IN: VS Code terminal. Type the remaining settings. The key is typed into a hidden prompt, as the password was:

   ```
    export RESTORE_FILE=<path to the .dump.age file>
    export RESTORE_CONFIRM=postgres
    export RESTORE_PLATFORM_SCHEMAS="auth storage extensions"
    export RESTORE_PLATFORM_TABLES="auth.users auth.identities auth.mfa_factors storage.buckets"
    read -s BACKUP_AGE_IDENTITY && export BACKUP_AGE_IDENTITY
   ```

   `RESTORE_PLATFORM_SCHEMAS` names the schemas Supabase creates by itself: their tables are kept as Supabase made them. `RESTORE_PLATFORM_TABLES` names the tables inside them whose rows come back: the accounts, their sign-in identities, their authenticator enrolments, and the list of storage buckets. This list is a starting point: the drill of section 5 confirms it against a real project. Sessions are left out on purpose, so everyone signs in again after a recovery. Add `storage.objects` only if the files themselves are being put back too (section 6); without the files, those rows would point at nothing.
6. IN: VS Code terminal. Run:

   ```
   bash scripts/backup/restore.sh
   ```

   It checks the checksum, decrypts, refuses if the target already has tables in `public` or `app` or if a named platform table already holds rows, clears the new project's default privileges so they end up as the original's, and restores in one transaction: everything or nothing.
7. IN: Supabase Dashboard (new project), SQL Editor. Press **New query**, paste this one line and press **Run**:

   ```sql
   alter default privileges revoke execute on functions from public;
   ```

   It is the one rule that belongs to the whole database and that a backup of named schemas cannot carry (it comes from `supabase/migrations/0001_platform.sql`): database functions created later are not open to everyone by default. The local test proves it is the only one missing, and fails if a later migration adds another.
8. Close the terminal.
9. IN: Vercel (the deployment's project), Settings, Environment Variables. Replace `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` with the new project's values. Redeploy.

**4.3 Checks after any restore**

1. IN: Supabase Dashboard, SQL Editor. Run `supabase/tests/verify_remote.sql`. It only reads. Every row must say `ok`.
2. IN: Supabase Dashboard, Authentication, Sign In / Providers. **Allow new users to sign up** is off.
3. IN: a browser. Sign in as the owner. Open a client, a document and the audit screen.
4. As the owner, reveal one tax ID you know. It must match. If it is refused, the key in Vault is missing or wrong.
5. Write what happened, when, what was restored and what was lost in the security log. A restore after an incident is part of the incident record (`docs/security/monitoring-and-incident-response.md`).

Steps 5 to 7 of the second procedure were tried on a local server prepared like a new Supabase project, and have **not** been tried against a real one. Expect to adjust them during the first drill, the list of platform tables above all.

## 5. The restore drill

A backup is proven by restoring it. Two drills, both recorded.

**Local drill** (free, a few seconds, proves the scripts and the migrations of the day):

1. IN: VS Code terminal (Git Bash), or any Linux or macOS computer with PostgreSQL 15 or newer and age:

   ```
   RESTORE_EVIDENCE_FILE=restore-drill-$(date +%F).txt bash scripts/backup/restore-test.sh
   ```

2. The last line must be `RESTORE TEST PASSED`. Keep the evidence file with the security records.

It also runs on every pull request (`.github/workflows/ci.yml`, job "Unit, server and security tests").

**Supabase drill** (uses a scratch project; cost and approval: the owner). This is the one that proves the real path, and it has not been done.

1. IN: Supabase Dashboard. Create a scratch project. Name it so nobody mistakes it for production.
2. Make a real backup of the deployment (section 2).
3. Restore it into the scratch project (section 4, second procedure).
4. Run the checks of section 4.3. Sign in on a test deployment that points at the scratch project.
5. Write down every step that had to be changed, and correct this page and the scripts.
6. IN: Supabase Dashboard (scratch project), Settings, General. Delete the scratch project. It holds a full copy of real data.
7. Record the drill: date, who, which backup, how long it took from "start" to "people can work again", what went wrong.

How often: ______ (owner decides). A common practice is every quarter and after every large change to the database; that is a suggestion, not a requirement stated anywhere in this repository.

## 6. Files in Storage

The buckets (`worker-documents`, and the workspace files bucket of `supabase/migrations/0028_workspace_files.sql`) hold uploaded documents. A database backup has their records, not the files.

Manual procedure, per deployment:

1. IN: Supabase Dashboard, Storage. Open the bucket.
2. Select the folders, press **Download**. Save into a new empty folder outside the repository.
3. IN: VS Code terminal (Git Bash). Pack and encrypt the folder with the same public key as the database backup, then remove the readable copy:

   ```
   tar -cf - <folder> | age -r <public key age1...> -o lbs_storage_$(date -u +%Y%m%dT%H%M%SZ).tar.age
   rm -rf <folder>
   ```

4. Store the `.tar.age` file with the database backup of the same day.

This is workable for a small number of files and is not automated. A script that copies a whole bucket through the Storage interface is **not built**; it is listed as a gap.

## 7. Schedule and monitoring: not built

Today a backup happens when a person runs it. The owner's brief asks for scheduled backups and for a failed backup to be noticed. The choices, for the owner and the developer:

| Choice | For | Against |
| --- | --- | --- |
| A person runs it on a fixed day, with a calendar reminder and a line in the security log | Nothing new to build. The database password never leaves the password manager and one computer. | Depends on a person. A missed week is noticed only if someone reads the log. |
| A scheduled job on a small server the firm controls | Automatic. The password stays on a machine the firm owns. | A server to maintain and secure. |
| A scheduled GitHub Actions workflow | Automatic, no server. | The production database password and the storage location's key become GitHub secrets, and client data passes through GitHub's computers (encrypted before it is written, but read there). For LBS this widens who must be trusted. Not recommended for LBS. |

Whatever is chosen, monitoring is: the newest `.manifest.json` in the off-platform location must be younger than the agreed interval, and someone is told when it is not.

## 8. Decisions and facts to fill in

Nothing in this table is invented. Blanks are for the owner (and, where it says so, her counsel).

| | VYNTEX Command | LBS Command |
| --- | --- | --- |
| Supabase plan, and date checked | ______ | ______ |
| Supabase scheduled backups: yes or no, days kept (from the dashboard) | ______ | ______ |
| Point-in-time recovery: on or off | ______ | ______ |
| How much data may be lost at most (recovery point objective) | ______ | ______ |
| How long the system may be down at most (recovery time objective) | ______ | ______ |
| How often the extra encrypted copy is made | ______ | ______ |
| Where the extra copy is stored (outside Supabase and Vercel) | ______ | ______ |
| How long extra copies are kept, and how old ones are destroyed (see `docs/security/data-retention.md`) | ______ | ______ |
| Who holds the backup private key (two people) | ______ | ______ |
| How often the restore drill is run | ______ | ______ |
| Date and result of the last Supabase drill | not done | not done |

## 9. Evidence: the last local run

Run on 3 October 2026, PostgreSQL 16.13, in this repository. The output is pasted as printed.

```
== 1. starting a throwaway PostgreSQL in /tmp/vx-pg-ops/one
   server 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
== 2. database, Supabase stand-ins, migrations, seed
   29 migrations applied as the non-superuser role postgres
== 3. marker rows
== 4. fingerprint of the original
   50 tables, 2220 rows, 3065 rule lines (policies, privileges, functions, triggers, constraints)
== 5. key pair for this run, then backup.sh
   == backing up database "vyntex_restore_src" as "restore-test" (server 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1), pg_dump (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1))
   == written: /tmp/vx-pg-ops/backups/restore-test_20261003T201916Z.dump.age (797495 bytes)
   == sha256:  b13cda83515e7374aec7b1ea5edca9adc3813938c4fb53d9c1dff28ca833c42f
   == This backup is not proven until a restore of it has been tried. See docs/security/backup-and-recovery.md.
   second backup, named schemas only (app auth public restore_test storage): 797378 bytes
== 6. only encrypted files were written, and the marker text is not readable in them
   restore-test_20261003T201916Z.dump.age: 797495 bytes, sha256 b13cda83515e7374aec7b1ea5edca9adc3813938c4fb53d9c1dff28ca833c42f
== 7. a wrong key and an altered file are refused
   refused, as it must be: restore with another key (age: error: no identity matched any of the recipients)
   refused, as it must be: altered file, caught by the checksum (checksum mismatch for tampered.dump.age: the file is damaged or was changed after the backup)
   refused, as it must be: altered file with the checksum skipped, caught by the decryption (age: error: failed to decrypt and authenticate payload chunk)
   refused, as it must be: restore without naming the target database (RESTORE_CONFIRM must be exactly the name of the target database (postgres))
   refused, as it must be: restore over a database that already has tables (the target database already has 45 table(s) in public app. Restore into an empty database, never over live dat)
== 8. dropping the original database
   vyntex_restore_src is gone
== 9. restore.sh into a fresh database on the same server
   == checksum ok: restore-test_20261003T201916Z.dump.age
   == decrypted: 50 tables of data in the archive
   == restoring into "vyntex_restore_dst" (server 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1), pg_restore (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1))
   == restore finished
   identical: 50 tables, 2220 rows, 3065 rule lines
== 9b. the comparison itself is tested: one changed value and one removed rule must each show up
   one cent changed in one row of 2000: noticed
   row level security no longer forced on one table: noticed
== 10. restore onto a brand new server (roles first, then the database)
   == checksum ok: restore-test_20261003T201916Z.dump.age
   == decrypted: 50 tables of data in the archive
   == checksum ok: restore-test_20261003T201916Z.roles.sql.age
   == roles applied
   == restoring into "vyntex_restore_dst" (server 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1), pg_restore (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1))
   == restore finished
   identical: 50 tables, 2220 rows, 3065 rule lines
== 11. the encrypted tax ID: unreadable without the key, readable with it, and the access rules still apply
   without the key: refused
   with the key, as the company owner: the stored value comes back
   a visitor who is not signed in: still refused on the restored database
   owner of company A: sees the 40 clients of A and none of the 25 of B
== 12. restore onto a server prepared like a new Supabase project (its own roles, auth and storage already there)
   refused, as it must be: the whole backup over the platform's own tables (pg_restore: error: could not execute query: ERROR:  function "jwt" already exists with same argument types)
   and that failed restore left nothing behind (one transaction)
   refused, as it must be: the product without the accounts it refers to (pg_restore: error: could not execute query: ERROR:  insert or update on table "tenant_members" violates foreig)
   refused, as it must be: a platform table outside the platform schemas (RESTORE_PLATFORM_TABLES: public.clients is not in one of the schemas of RESTORE_PLATFORM_SCHEMAS)
   == checksum ok: restore-test-named_20261003T201916Z.dump.age
   == decrypted: 50 tables of data in the archive
   == schemas already in the target, kept as they are: auth public storage 
   == platform tables whose rows are restored: auth.users storage.buckets storage.objects 
   == policies restored on platform tables: 9
   == default privileges of the target cleared (the archive sets the original ones)
   == restoring into "vyntex_restore_dst" (server 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1), pg_restore (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1))
   == restore finished
   refused, as it must be: the same restore a second time (the target database already has 45 table(s) in public app. Restore into an empty database, never over live dat)
   one database-wide default is not in a backup of named schemas; putting it back as the procedure says
   identical: 50 tables, 2220 rows, 3065 rule lines

   Restore drill, local
   started (UTC):        2026-10-03T20:19:13Z
   finished (UTC):       2026-10-03T20:19:23Z
   PostgreSQL:           16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
   migrations applied:   29
   tables compared:      50
   rows compared:        2220
   rule lines compared:  3065
   backup size (bytes):  797495
   backup sha256:        b13cda83515e7374aec7b1ea5edca9adc3813938c4fb53d9c1dff28ca833c42f
   same server restore:  identical
   new server restore:   identical
   platform restore:     identical (on a server prepared like a new Supabase project)
   comparison tested:    one changed value noticed, one weakened rule noticed
   refusals checked:     wrong key, altered file (checksum), altered file (decryption), unnamed target, non-empty target,
                         whole backup over platform tables, product without accounts, restore run twice
   result:               PASSED

RESTORE TEST PASSED
```
