# Data retention and deletion

How long each kind of record is kept, how records are removed, and how a company or a person can get a copy. Owner's brief, section 87.

**The durations on this page are blank on purpose.** How long a tax practice must keep a client's records, a signed engagement letter, a consent, or an audit trail depends on federal and state rules and on the firm's own obligations. Those are decisions for the owner and her counsel. Nothing here states a legal requirement. The page lists what has to be decided and what the platform can and cannot do once it is.

## 1. What the platform does today

| Behaviour | State | Where |
| --- | --- | --- |
| Nothing a person entered is deleted automatically. No business record has an expiry. | By design | |
| A company is never deleted. It is closed, and a closed company locks everyone out. | Implemented | `tenants.status` in `supabase/migrations/0001_platform.sql` |
| A member who leaves is disabled, not deleted. Their name stays on what they did. A disabled member can read nothing. | Implemented | test: "a disabled member reads nothing" in `supabase/tests/rls_isolation.sql` |
| The last owner of a company cannot remove or demote themselves. | Implemented | test: "the last owner cannot remove themselves" in `supabase/tests/rls_isolation.sql` |
| A client can be marked active, inactive or former without being deleted. | Implemented (column) | `clients.lifecycle` in `supabase/migrations/0012_new_columns.sql` |
| The audit log and the security events cannot be changed or deleted by anyone, and are not removed when the record they describe is removed. | Implemented | test: "the service role cannot delete from the audit log" in `supabase/tests/rls_isolation.sql` |
| A consent record blocks the deletion of the client, worker or document it refers to. It can be revoked, never edited. | Implemented | `supabase/migrations/0006_consent_and_1099.sql` |
| Deleting a job removes its own lines (assignments, expenses, notes, tasks, documents), each removal written to the audit log, and never the payments made to workers. | Implemented | `supabase/migrations/0002_tenant_data.sql`, `supabase/migrations/0004_audit_log.sql` |
| Technical rows with no further use are swept once a day: rate limit counters, used sign-in states, expired idempotency keys, finished background jobs, old webhook records. The intervals are fixed in the function. | Implemented | `server_sweep` in `supabase/migrations/0029_server_lockdown.sql` |
| A retention period per kind of record, set by the company, after which records are flagged or removed. | **Not built** | |
| A hold that stops deletion of a client's records while a dispute or an examination is open. | **Not built** | |
| A reviewed "delete this client's data" workflow (request, approval by a second person, execution, record). | **Not built** | |
| Export of one company's whole data set on request. | **Not built** as a function. The backup of section 4 is the fallback. | |

Until the three "not built" rows exist, the rule for staff is simple: **do not delete client records.** Mark a client as former. Deletion is done by the owner, after the checks of section 3, and written down.

## 2. The schedule to decide

One copy per deployment. "Kept for" starts at the event in the second column. Fill in with counsel.

| Kind of record | Clock starts at | Kept for | Then | Decided by, date |
| --- | --- | --- | --- | --- |
| Client profile and contact details | End of the last engagement | ______ | ______ | |
| Tax returns and their workpapers | Filing date | ______ | ______ | |
| Tax IDs in the secure vault | End of the last engagement | ______ | ______ | |
| Engagement letters and signed agreements | End of the engagement | ______ | ______ | |
| Signature evidence (who signed, when, from where) | Signature date | ______ | ______ | |
| Consent records (for example consent to share payment data for 1099 work) | Revocation, or end of the engagement | ______ | ______ | |
| Invoices, payments, credits | Payment date | ______ | ______ | |
| Bookkeeping and payroll records held for clients | End of the engagement | ______ | ______ | |
| Uploaded client documents | Upload date, or end of the engagement | ______ | ______ | |
| Messages, emails and call records with clients | Date of the message | ______ | ______ | |
| Leads that never became clients | Date the lead was lost | ______ | ______ | |
| Staff accounts and profiles | Departure | ______ | ______ | |
| Audit log | Date of the entry | ______ | ______ | |
| Security events | Date of the event | ______ | ______ | |
| Tax ID reveal records | Date of the reveal | ______ | ______ | |
| Backups made by Supabase | Date of the backup | Set by the plan: read it from the dashboard and write it here ______ | Removed by Supabase | |
| The extra encrypted backups | Date of the backup | ______ | Destroyed (section 3) | |
| Server and platform logs (Vercel, Supabase) | Date of the line | Set by the plan: ______ | Removed by the vendor | |
| Demo requests (VYNTEX Command only) | Date of the request | ______ | ______ | |

Two things to settle with counsel while filling this in:

* **Deletion against the duty to keep.** A person may ask for their data to be removed while a rule requires the firm to keep it. Which one wins, for which records, is a legal answer.
* **Backups.** A record deleted today is still inside every backup made before today, until those backups age out. The schedule for backups is therefore part of the answer to any deletion request.

## 3. Removing records

**When a staff member leaves** (the same day):

1. IN: the application, Team screen (as an owner). Disable the member. Do not delete: their name stays on the history of what they did.
2. IN: the application, Team screen. Reassign their open leads, tasks and clients.
3. IN: Supabase Dashboard, Authentication, Users. Open the user's menu and choose **Ban user**.
4. IN: GitHub, IN: Vercel, IN: Supabase (organization and team member lists). Remove them if they had access.
5. Replace every secret they could read (`docs/security/secrets-and-environments.md`).
6. Write the date and what was done in the security log.

**When a client's records are to be deleted** (after the retention period, or on a request counsel has confirmed):

1. Confirm in writing who asked, which records, and that no hold applies (a dispute, an examination, an unpaid balance). The platform does not check holds: this step is the check.
2. A second person approves. The person who asked does not approve their own request.
3. Export what must be handed over or archived first (section 4).
4. IN: the application, as an owner. Delete the records. Each deletion is written to the audit log by the database, with who did it. The audit entries themselves stay.
5. Tax IDs: IN: the application, the client's secure tab. Remove the stored tax ID. (The functions that store and remove a client tax ID were not built when this was written; until they are, the platform holds none.)
6. Files: IN: Supabase Dashboard, Storage. Check the client's uploaded files are gone from the bucket; remove any that remain.
7. Record: who asked, who approved, what was deleted, when, and which backups still contain it and until what date.

**Destroying backups that have aged out:**

1. IN: the off-platform location. Delete the `.dump.age`, `.sha256` and `.manifest.json` files older than the period in section 2. Empty the bin of that location.
2. Because every backup is encrypted, destroying the last copy of a retired backup key also makes every backup made with it unreadable. Do that only when all of them are past their period.
3. Write the date and the file names in the security log.

**Closing a company** (VYNTEX Command, a client company that stops using the product):

1. Agree with the company in writing what happens to its data: handed over, kept for a period, deleted.
2. Hand over the export (section 4).
3. Set the company to closed. This is done by the developer on the server side; no screen does it today.
4. Deleting a closed company's rows for good is **not built** as a procedure. Until it is, a closed company's data stays in the database, unreachable by its former users.

## 4. Getting a copy

| Need | How today |
| --- | --- |
| A list from one screen | The CSV export of that screen, for roles that hold the export capability. Exports are meant to be recorded in the audit log; the general export function is not yet in the database at the time of writing. |
| The 1099 payment totals of a company | `export_1099_data`. Needs the company's recorded consent, owner or manager only, and every run is in the audit log (test: "every export that ran was written to the audit log" in `supabase/tests/rls_isolation.sql`). |
| Everything of one company | Not built as a function. The developer extracts it from the database with a query limited to that company, as the owner of the request watches, and records it. |
| Everything of the deployment | The encrypted backup: `docs/security/backup-and-recovery.md`. |

A copy of client data that leaves the platform is no longer protected by it. Record every hand-over: what, to whom, how it was sent, when.

## 5. What must never be lost by a deletion

The owner's brief: "Do not cascade-delete critical audit evidence casually." In this platform the audit log has no link that deletes its entries when a record is deleted, and it refuses deletion itself. The older system deleted a client's audit trail together with the client; `docs/security/legacy-defects.md` lists that and how it is prevented here.

## 6. To build

* Retention settings per company and per kind of record, with a report of what is past its period.
* A hold on a client that blocks deletion until it is lifted, with who set it and why.
* The deletion workflow of section 3 inside the application: request, second approval, execution, record.
* A full export of one company.
* Final deletion of a closed company after its agreed period.
