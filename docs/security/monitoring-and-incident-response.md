# Security monitoring and incident response

What the platform records, what a person should look at and how often, which alerts to set up in the hosting dashboards, and what to do in the first hour when something is wrong. Owner's brief, section 62.

This page gives no legal advice. Whether an event must be reported to clients, to a regulator or to an insurer, and by when, is decided with counsel.

## 1. What is recorded

Everything below is recorded separately for each deployment, inside its own database or its own hosting project.

| Record | What goes in | Where | Who can read it | Can it be changed |
| --- | --- | --- | --- | --- |
| Audit log | Who changed what in the sensitive tables: payments, membership, the company record, workers, documents, consent, prices. Old and new value of the changed fields, with contact details and document wording redacted. Reads of a tax ID and exports. | Table `audit_log` (`supabase/migrations/0004_audit_log.sql`) | The company owner, and roles holding the audit capability | No. Triggers block update, delete and truncate for everyone (test: "owner cannot delete from the audit log" in `supabase/tests/rls_isolation.sql`) |
| Security events | Sign-in success, failure and lockout; second-step enrolment, use and removal; recovery codes; password changes and resets; sign-out everywhere; invitations; members added, removed or changed in role; connections made, failed and removed; refused webhooks; refused operations. Each with outcome, severity and a keyed hash of the address. Never a password, code, token or key. | Table `app.security_events` (`supabase/migrations/0020_server_core.sql`), written by `api/_lib/audit.js` and by database triggers | Owner and audit roles, through `security_events_list` and `security_summary` | No. Append only, same kind of triggers |
| Webhook log | Every call a provider makes: verified or refused, a hash of the body, a redacted copy, the result. | Table `app.webhook_events` (`supabase/migrations/0027_webhook_events.sql`) | The server; owners through `webhook_log` | Status only, by the server |
| Job log | Background work: queued, running, failed with a short code, or dead after the last attempt. | Table `app.jobs` (`supabase/migrations/0025_job_queue.sql`) | The server; owners through `jobs_log` | By the server |
| Connection state | The honest state of each integration, last check, last error code. | Table `app.integration_connections` (`supabase/migrations/0026_integrations.sql`) | Owners, on the Integrations screen | By the server |
| Server log | One line per notable event: a scope, a short code, a few numbers. Never a value typed by a person, never a provider's message (`log()` in `api/_lib/respond.js`). | Vercel, Project, Logs | Members of the Vercel team | Kept by Vercel for a time that depends on the plan (confirm) |
| Platform logs | Sign-in service, database and API logs of Supabase. | Supabase Dashboard, Logs | Members of the Supabase organization | Kept by Supabase for a time that depends on the plan (confirm) |
| Repository history | Every change to the code, who approved it, which checks ran. | GitHub | Repository members | No, with branch protection on |

## 2. The signals the owner asked for

| Signal (brief, section 62) | Where it shows | State |
| --- | --- | --- |
| Failed sign-in trends | Security events `signin.failed`, `signin.locked`; counted per company by `security_summary` | Recorded. An email goes to the company's owners when a line is crossed (below). |
| Unusual reveal activity (tax IDs) | Every read of a worker tax ID is in the audit log today. For client tax IDs the encrypted store exists; the request, approval and reveal functions, and the records they write, are not built yet. | Worker tax IDs: recorded. Client reveals: not yet built at the time of writing. |
| Repeated export attempts | Every export that ran is in the audit log; a refused one leaves a refusal (test: "every export that ran was written to the audit log" in `supabase/tests/rls_isolation.sql`) | Recorded for the 1099 export. A general export request function is not yet built. |
| Integration failures | Security events `integration.error`, `integration.connect_failed`; the connection's own state | Recorded |
| Permission changes | Security events `member.added`, `member.removed`, `member.role_changed`, written by a database trigger, so no code path can skip them | Recorded |
| High-risk actions | Security events with severity `high` (the database decides the severity, `app.security_severity`); protected operations recorded as `operation.protected` and `operation.refused` | Recorded |
| Webhook failures | Security event `webhook.rejected`; the webhook log | Recorded |
| Backup failures | Nothing automatic. A backup is made by a person (`docs/security/backup-and-recovery.md`, section 7). | **Not built** |

**Notices to admins.** Once a day the scheduled job `security.alerts` (`api/_lib/jobs/handlers.js`) asks the database which companies crossed a line in the last hour (`security_alerts_due` in `supabase/migrations/0020_server_core.sql`) and emails that company's owners, one notice per company, kind and hour. It needs system email to be configured (`RESEND_API_KEY`, `SYSTEM_EMAIL_FROM`); without it no notice is sent and nothing pretends otherwise. Proved with imitated email answers only: no live email has been sent by this build.

To reconcile with the server engineer: the job is queued by the daily schedule, so it looks at one hour per day. If hourly notices are wanted, the five-minute schedule has to queue it too.

## 3. Alerts to set up in the dashboards

None of this exists until a person switches it on. Features and their cost differ by plan: where a step says "confirm", check the plan before relying on it, and get the owner's approval before anything that adds cost. Do every step for both deployments.

**Vercel**

1. IN: Vercel, your account, Settings, Notifications. Turn on email for **Deployment failed**.
2. IN: Vercel, Project, Settings, Deployment Protection. Protection is on for preview deployments.
3. IN: Vercel, Project, Logs. Save a filter for status 500 and above on `/api/`. Look at it in the weekly review until an alert exists.
4. IN: Vercel, Project, Observability (or Monitoring). If the plan offers alerts on error rate, create one for the functions (confirm).
5. IN: Vercel, Project, Settings, Log Drains. If logs must be kept longer than Vercel keeps them, add a drain to a store the firm controls (confirm; cost). The LBS project gets its own destination.
6. IN: Vercel, Project, Settings, Cron Jobs. Both scheduled calls are listed and their last run succeeded.

**Supabase**

1. IN: Supabase Dashboard, Advisors, Security Advisor. Run it after every database change. Every finding is read; the ones that are intended are written down (`docs/SECURITY.md` explains the views it flags).
2. IN: Supabase Dashboard, Authentication, Sign In / Providers. **Allow new users to sign up** is off. Check it in every review: it is one switch.
3. IN: Supabase Dashboard, Authentication, Rate Limits. Read the limits for sign-in and email. Lower them if the defaults are wider than the firm needs.
4. IN: Supabase Dashboard, Logs, Auth. Save a query for failed sign-ins. Look at it in the weekly review.
5. IN: Supabase Dashboard, Project Settings, Billing and usage. Turn on the email for usage limits, so a paused or throttled project is not a surprise.
6. IN: Supabase Dashboard, organization, Team. Two-factor sign-in is on for every member (and enforced for the organization if the plan allows it: confirm).

**GitHub**

1. IN: GitHub (your account, Settings, Notifications). Email is on for Dependabot alerts, secret scanning alerts and failed workflow runs.
2. IN: GitHub (repository, Security). Open alerts are zero, or each one has an owner and a date.

**From outside**

1. An uptime monitor that calls `/api/health` on each deployment every few minutes and emails when it fails. The address answers without touching the database (`api/health.js`). The service used is the owner's choice (cost: confirm).

## 4. The regular review

Fill in who and how often. The suggestions are common practice, not a rule stated anywhere in this repository.

| Check | How | Suggested | Decided: who, how often |
| --- | --- | --- | --- |
| Security events of each company | IN: the application, the security screen, as an owner | Weekly | ______ |
| Failed functions | IN: Vercel, Project, Logs, the saved filter | Weekly | ______ |
| Failed sign-ins at the platform | IN: Supabase Dashboard, Logs, Auth | Weekly | ______ |
| Dead jobs and failing connections | IN: the application, Integrations screen; `/api/health` | Weekly | ______ |
| Newest backup is recent | The date in the newest `.manifest.json` in the off-platform location | Weekly | ______ |
| Open dependency and secret alerts | IN: GitHub (repository, Security) | Weekly | ______ |
| Who has access: GitHub, Vercel, Supabase, the application's Team screen | Compare each list with the current staff list | Monthly, and on every departure | ______ |
| Sign-up switch, Security Advisor, exposed schemas | IN: Supabase Dashboard | Monthly, and after every database change | ______ |
| Restore drill | `docs/security/backup-and-recovery.md`, section 5 | Quarterly | ______ |
| The settings of `docs/security/github-settings.md` | Its step 10 | Twice a year | ______ |

Write each review in the security log of the firm: date, who, what was looked at, what was found. A review that is not written down cannot be shown to anyone later.

## 5. When something is wrong: the first hour

An incident is anything that may have exposed, changed or destroyed protected data, or given someone access they should not have. A suspicion is enough to start. Starting and finding nothing costs an hour; waiting can cost far more.

**People.** Fill in before it is needed.

| Role | Who | Reach them at |
| --- | --- | --- |
| Incident lead (decides and coordinates) | ______ | ______ |
| Technical lead (can change settings in GitHub, Vercel, Supabase) | ______ | ______ |
| Owner | ______ | ______ |
| Counsel | ______ | ______ |
| Insurer, if there is a cyber policy | ______ | ______ |

**Step 1. Write it down (minutes 0 to 5).** The time, who noticed, what was seen, on which deployment (VYNTEX Command or LBS Command). Start a timeline and add a line for every action from now on. Do not delete, tidy or "fix" anything yet.

**Step 2. Contain (minutes 5 to 30).** Stop the damage without destroying the evidence. Pick the row that matches.

| What happened | Do this |
| --- | --- |
| A staff account is or may be taken over | IN: the application, Team screen (as an owner): disable the member. The database refuses a disabled member at once, whatever session they still hold (test: "a disabled member reads nothing" in `supabase/tests/rls_isolation.sql`). IN: Supabase Dashboard, Authentication, Users: open the user's menu and choose **Ban user**, so no new session can start. Then read that user's security events and audit entries. Give the account back only after the person has set a new password and a new authenticator. |
| A secret was exposed (a key in a file, a chat, a screenshot) | Replace it now: `docs/security/secrets-and-environments.md`, "How to replace each one". Replace first, investigate second. |
| A release is behaving badly or was not meant to go out | IN: Vercel, Project, Deployments: open the last good deployment, press **Promote** (or **Instant Rollback**). |
| The database's server key may be known to someone | Replace `SUPABASE_SERVICE_ROLE_KEY` (same document). If the old key cannot be revoked on its own, regenerate the project's signing secret: this signs everyone out, which is acceptable here. |
| A laptop or phone with access is lost or stolen | IN: GitHub, IN: Vercel, IN: Supabase, IN: the password manager: sign out that device's sessions and change the account passwords. IN: the application: sign out everywhere for that person. |
| An account nobody recognises exists | Disable it, do not delete it. IN: Supabase Dashboard, Authentication, Sign In / Providers: check **Allow new users to sign up** is off. Read what the account did. |
| A provider tells you they were breached | Replace that provider's keys, then disconnect and reconnect the connected accounts (same document). |
| Client data was sent to the wrong person | Record exactly what, to whom and when. Ask the recipient in writing to delete it. This is a question for counsel in step 5. |
| Data was destroyed or encrypted | Do not restore over it yet: the damaged state is evidence. Go to step 3, then `docs/security/backup-and-recovery.md`, section 4. |
| You are not sure the attacker is out | Take the affected deployment offline: IN: Vercel, Project, Settings, pause the project or remove its production domain. The other deployment is separate and keeps running. |

**Step 3. Keep the evidence (minutes 30 to 45).** Logs age out. Save them now, to a folder only the incident lead and the owner can open.

1. IN: Vercel, Project, Logs. Export or copy the logs for the period.
2. IN: Supabase Dashboard, Logs. Export the Auth, API and database logs for the period.
3. IN: Supabase Dashboard, SQL Editor. Save the security events and the audit entries of the period to a file (the developer writes the query; it only reads).
4. IN: GitHub (repository, Insights or Settings, Audit log if the plan has one). Save the period.
5. Screenshots of anything on screen that will change.

**Step 4. Size it (minutes 45 to 60).** As far as can be told now: which deployment, what kind of data (tax IDs, contact details, documents, financial records), whose, how many people, from when to when, and whether the cause is closed. "Not known yet" is a valid answer; write it down as that.

**Step 5. Tell the owner and call counsel.** In the first hour, not after the investigation. Whether clients, the IRS, the Federal Trade Commission, a state authority or an insurer must be told, and the deadline for each, are legal questions, and some deadlines are short. For a tax practice, IRS Publication 4557 describes whom to contact after a data theft. Counsel and the owner decide what is sent and to whom. Nobody else contacts clients or authorities.

## 6. After the first hour

1. **Remove the cause.** Close the hole that was used, not only the symptom. A change to the code goes through a pull request like any other.
2. **Replace every secret the affected system could reach,** not only the one known to be exposed.
3. **Restore if needed** (`docs/security/backup-and-recovery.md`, section 4), and run the checks listed there.
4. **Prove the controls still hold.** IN: VS Code terminal: `npm run test:db` and `node --test "tests/security/*.test.mjs"`. IN: Supabase Dashboard, SQL Editor: `supabase/tests/verify_remote.sql`.
5. **Watch.** For the following weeks, do the weekly review of section 4 daily.
6. **Write the incident record** (below) and keep it with the written information security plan.
7. **Review it** within a few weeks: what happened, what worked, what was slow, what changes. Update this page.

## 7. The incident record

One per incident, kept by the firm, not in this repository.

| Field | |
| --- | --- |
| Number and date opened | |
| Deployment | VYNTEX Command or LBS Command |
| Who noticed, how, when | |
| What happened, in plain words | |
| Timeline of actions, with times and names | |
| Data involved: kind, whose, how many people, period | |
| Cause | |
| How it was contained and when | |
| Secrets replaced | |
| Evidence saved, and where | |
| Counsel consulted on (date), advice summarised | |
| Notifications sent: to whom, when, by whom | |
| What was restored, and what was lost | |
| Changes made so it does not repeat | |
| Closed on, by | |

## 8. Not built

* A check that the newest backup is recent, and a notice when it is not.
* An uptime monitor and an error tracking service: both are outside services to choose.
* Notices for the platform operator across all companies. The email notice of section 2 goes to each company's own owners.
* The records for client tax ID reveals, until the request, approval and reveal flow is built.
* Drill of this runbook. It has not been walked through with the people named in section 5; do that once the names are filled in.
