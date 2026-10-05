# Removing real customer data from the NOVA repository

**This is a procedure to follow, not something that has been done.** Nothing in it was run. It is carried out by the developer, with the owner's approval, on a date they choose.

## What is wrong

NOVA is the older internal system of Lion Business Services. In the NOVA repository there is a file `supabase/migrations/0015_customers_import.sql` (this platform has a migration with the same number; it is a different file and holds no data). The NOVA file holds about 200 real customers exported from Square: names, email addresses, phone numbers, some street addresses and business names, and their Square customer ids. No tax ID numbers were found in it.

Deleting the file in a new commit does not remove it. Git keeps every earlier version, and anyone with a copy of the repository can read it. The data has to be removed from the history itself, on GitHub and in every copy.

What the scan of this platform reports on that file today (run on 3 October 2026 against a read-only copy):

```
supabase/migrations/0015_customers_import.sql:40  [bulk-contacts]  180 different email addresses that are not on a sample domain. ...
supabase/migrations/0015_customers_import.sql:40  [bulk-contacts]  156 different phone numbers that are not 555 sample numbers. ...
supabase/migrations/0015_customers_import.sql:32  [provider-export]  insert into public.clients with 200 row(s) carrying "square_customer_id": ...
```

The same scan is what proves, at the end, that the data is gone.

## Before anything else: decisions for the owner

1. **Who has had access.** Everyone who could read the repository could read those customers. IN: GitHub (NOVA repository Settings, Collaborators and teams), list the people and teams. IN: GitHub (repository Settings, Deploy keys) and IN: GitHub (organization Settings, GitHub Apps), list the services that can read it (Vercel and any coding tool). IN: GitHub (repository, Insights, Forks), list the forks. Write all of it down with today's date.
2. **Whether anyone must be told.** Whether this exposure requires notifying customers or a regulator is a legal question. Consult counsel with the list from step 1. This document draws no conclusion on it.
3. **Which of the two ways below to use.** Way A keeps the history of the code. Way B is simpler and loses it.
4. **A date and a quiet hour**, and the word to every person with a copy: push everything, then stop working on NOVA until told.

## What to gather

* The list of every person and computer that has a copy (a "clone") of the NOVA repository.
* An external drive or an encrypted folder for the safety copy. The safety copy contains the customer data, so it is handled like the data itself.
* On the developer's computer: Git, Python, and the tool `git-filter-repo`. IN: VS Code terminal:

  ```
  py -m pip install --user git-filter-repo
  & "C:\Program Files\Git\bin\git.exe" filter-repo --version
  ```

  The second line must print a version. If it says "filter-repo is not a git command", the folder where Python puts programs is not on the PATH: fix that before the day.
* A copy of this platform's repository on the same computer, for its scan (`scripts/security/scan-pii.mjs`).

## Way A: rewrite the history

Every command is typed IN: VS Code terminal unless the step says otherwise. Replace `<organization>/<nova-repository>` with the real name.

**A1. Freeze**

1. Confirm with every person on the list that their work is pushed.
2. IN: GitHub (NOVA repository, Pull requests). Merge or close every open pull request. An open pull request keeps old commits alive on GitHub.

**A2. Safety copy**

1. Make a complete copy, all branches and tags:

   ```
   & "C:\Program Files\Git\bin\git.exe" clone --mirror https://github.com/<organization>/<nova-repository>.git nova-safety-copy.git
   ```

2. Move the folder `nova-safety-copy.git` to the external drive or the encrypted folder. It is the way back if the rewrite goes wrong.
3. Write down where it is and who holds it. The owner decides how long it is kept; it is destroyed after that (step A9).

**A3. Look for keys in the history, before rewriting**

A history that held customer data may hold other things. The NOVA audit found no keys in the database folder, but only the current files were read.

1. Make a fresh working copy:

   ```
   & "C:\Program Files\Git\bin\git.exe" clone https://github.com/<organization>/<nova-repository>.git nova-clean
   ```

2. IN: GitHub (NOVA repository Settings, Advanced Security). If secret scanning is available, turn it on and read its alerts. If gitleaks is installed, run it over the full history of `nova-clean`.
3. For every key found: replace it at the provider first (see `docs/security/secrets-and-environments.md`), then note it. A key that was ever in the history is treated as known to others, whether or not the history is rewritten.

**A4. Rewrite**

1. Go into the fresh copy:

   ```
   cd nova-clean
   ```

2. Remove the file from every commit:

   ```
   & "C:\Program Files\Git\bin\git.exe" filter-repo --invert-paths --path supabase/migrations/0015_customers_import.sql
   ```

3. Check that no commit knows the file any more. This must print nothing:

   ```
   & "C:\Program Files\Git\bin\git.exe" log --all --oneline -- supabase/migrations/0015_customers_import.sql
   ```

4. Run this platform's scan on the rewritten copy (adjust the path to where VYNTEX-COMMAND is on the computer):

   ```
   node ..\VYNTEX-COMMAND\scripts\security\scan-pii.mjs --root . --all
   ```

   It must end with `personal data scan: clean`. If it reports another file, that file holds customer data too: add another `--path` for it and repeat steps 2 to 4.
5. The scan reads the files as they are now. To be sure no older version of another file held customers, search every commit for the id column of the import. This must print nothing:

   ```
   & "C:\Program Files\Git\bin\git.exe" grep -l "square_customer_id" $(& "C:\Program Files\Git\bin\git.exe" rev-list --all) -- "*.sql" "*.json" "*.csv"
   ```

   Files that only define the column (a `create table` or `alter table`) are expected in the result. Open each one listed and confirm it has no customer rows.
6. The database was built with that migration, so the folder needs a file with its number. IN: VS Code, in the NOVA repository, create `supabase/migrations/0015_customers_import.sql` with one comment line and no data, for example: `-- Customer rows were loaded on <date> from Square, outside Git. This file is a marker.` Commit it.

**A5. Replace the history on GitHub**

1. IN: GitHub (NOVA repository Settings, Rules, or Branches). If a rule blocks force pushes, switch it off for the next ten minutes. Write down that you did.
2. `filter-repo` removed the link to GitHub on purpose. Put it back:

   ```
   & "C:\Program Files\Git\bin\git.exe" remote add origin https://github.com/<organization>/<nova-repository>.git
   ```

3. Push every branch, replacing what is there:

   ```
   & "C:\Program Files\Git\bin\git.exe" push origin --force --all
   ```

4. Push every tag the same way:

   ```
   & "C:\Program Files\Git\bin\git.exe" push origin --force --tags
   ```

5. IN: GitHub (NOVA repository Settings, Rules, or Branches). Switch the rule back on.

**A6. Ask GitHub to purge what a push cannot**

GitHub keeps old commits reachable by their address, in pull request records and in cached pages, even after a forced push. Only GitHub Support can remove those.

1. IN: a browser, GitHub Support (support.github.com). Open a ticket. Say that sensitive data was removed from the history of `<organization>/<nova-repository>` with `git filter-repo`, name the file path, and ask them to remove cached views, references from pull requests and unreachable commits. Do not paste any customer data into the ticket.
2. Keep the ticket number. Wait for their confirmation before step A8.

**A7. Every other copy**

A single old copy that is pushed again brings everything back.

1. Every person on the list deletes their NOVA folder, empties the recycle bin, and makes a fresh clone. Nobody runs "pull" or "merge" on an old copy.
2. IN: GitHub (NOVA repository, Insights, Forks). Delete every fork, or have its owner delete it. A fork is a full copy with the old history.
3. IN: Vercel (NOVA project, Deployments). Old deployments keep the source files they were built from. Delete the deployments that are no longer needed, and IN: Vercel (project Settings, Git or Security) check that source files and logs of deployments are not public.
4. Think of the places a copy travels without Git: a zip of the folder, a backup of a laptop, a chat or email where the file was sent, a coding tool that was given the repository. Remove what can be removed and write down what cannot.

**A8. Verify from the outside**

1. Make a brand new clone in an empty folder:

   ```
   & "C:\Program Files\Git\bin\git.exe" clone https://github.com/<organization>/<nova-repository>.git nova-verify
   ```

2. Run the scan on it:

   ```
   node VYNTEX-COMMAND\scripts\security\scan-pii.mjs --root nova-verify --all
   ```

   Expected: `personal data scan: clean`.
3. Inside `nova-verify`, the check of step A4.3 prints nothing.
4. IN: a browser. Open the address of an old commit that contained the file (take one from the safety copy's log). After GitHub Support has confirmed, it must show "not found".
5. IN: NOVA itself. Open a client list and a client profile. The application and its database were not touched by any of this, and must work as before.

**A9. Record and close**

1. Write in the security log of the firm: the date, who did it, the ticket number, the output of the scan in step A8.2, the list from "decisions for the owner" step 1, and what counsel advised.
2. On the date the owner chose, destroy the safety copy: delete the folder from the encrypted drive and empty the bin. Write that down too.

## Way B: a new repository without history

Simpler, and it leaves no old history anywhere on GitHub. The price is that the record of who changed what in NOVA's code is lost (the safety copy keeps it until it is destroyed). Reasonable if NOVA is being retired in favour of the new platform.

1. Do A1 (freeze), A2 (safety copy) and A3 (look for keys).
2. In a fresh clone, delete the file, add the marker file of step A4.6, and run the scan of step A4.4 until it is clean.
3. Delete the hidden `.git` folder of that clone. What remains is the code with no history.
4. IN: GitHub (organization). Create a new **private** repository with a new name.
5. IN: VS Code terminal, inside the folder:

   ```
   & "C:\Program Files\Git\bin\git.exe" init
   & "C:\Program Files\Git\bin\git.exe" add .
   & "C:\Program Files\Git\bin\git.exe" status
   & "C:\Program Files\Git\bin\git.exe" commit -m "NOVA, history removed"
   & "C:\Program Files\Git\bin\git.exe" branch -M main
   & "C:\Program Files\Git\bin\git.exe" remote add origin https://github.com/<organization>/<new-repository>.git
   & "C:\Program Files\Git\bin\git.exe" push -u origin main
   ```

   Read the output of `status` before committing: no file whose name starts with `.env` may be listed, except an example file with no values.
6. IN: Vercel (NOVA project, Settings, Git). Disconnect the old repository and connect the new one.
7. IN: GitHub (old NOVA repository Settings, General, Danger Zone). Delete the old repository. Its forks: confirm on GitHub's documentation what happens to forks of a deleted private repository, and delete each fork by hand to be sure.
8. Do A7 (every other copy), A8 with the new repository's address, and A9.

## Keeping it from happening again

* In this platform the check is automatic: `scripts/security/scan-pii.mjs` runs on every pull request (`.github/workflows/ci.yml` and `.github/workflows/secret-scan.yml`) and its tests are in `tests/security/scan-pii.test.mjs`, including one that rebuilds the shape of the NOVA file with invented people and expects the scan to stop it.
* Customer data is loaded into a database from outside Git: an import run by a person from a file that never enters the repository. The LBS migration plan (owner's brief, section 40) follows that rule.
* If NOVA stays in use for a while, copy the two scan scripts into its repository and run them before each commit.
