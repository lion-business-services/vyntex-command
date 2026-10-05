# Safeguards mapped to evidence

For Lion Business Services (LBS), which handles tax and financial records of its clients and therefore keeps a written information security plan (a WISP).

## What this page is, and is not

It is a map: for each safeguard area that such a plan has to cover, what LBS Command does about it, which file or test shows that, and what stays with the firm. It is written for the person who maintains the firm's plan and for whoever reviews it.

**It is not a statement of compliance.** The platform supports the plan. It does not by itself make LBS compliant with the FTC Safeguards Rule, with IRS guidance or with anything else, and nobody has audited or certified it. A plan covers people, devices, offices, contracts and procedures, and most of those are outside any software. A qualified professional has to assess the whole program (owner's brief, sections 54 and 108).

The safeguard areas in sections 2 and 3 are paraphrased from the FTC Safeguards Rule (16 CFR 314.4) and from IRS Publications 4557 and 5708. The paraphrase is for orientation. The texts themselves govern, and counsel reads them, not this page.

**Status words**, one per row:

* **Implemented in code**: the control is built and a test or file shows it. "Implemented" still means "proved on a local test system": no production deployment exists yet.
* **Requires configuration**: the control exists only after a person switches something on or fills something in. The step is named.
* **Organizational**: the firm's own responsibility. The platform cannot do it.

A row can need all three. The status column says which parts are which. Where a feature the owner asked for is not built, the row says **not built**.

How to read evidence: a path in backticks is a file in this repository; `test: "..."` names a check inside the file on the same line. `scripts/security/check-evidence.mjs` verifies on every pull request that each of them exists.

## 1. The owner's evidence list

The technical evidence the brief asks for in section 54, item by item.

| # | Evidence asked for | What the platform does | Evidence | Status | Remains with LBS |
| --- | --- | --- | --- | --- | --- |
| E1 | Access-control policy | Access is decided by capability, per role, per company, and enforced by the database on every table. The same matrix is in the app and in the database, and a test compares them. | `supabase/migrations/0010_roles_and_capabilities.sql`, `supabase/migrations/0013_access_rules_v2.sql`, `supabase/tests/parity.mjs` | Implemented in code | Write the policy itself: who gets which role and why. The matrix is its technical annex. |
| E2 | Role assignment | Accounts exist by invitation only. Only a member with the capability can invite, only an owner can make an owner, and every change of role is recorded by a database trigger. | `supabase/migrations/0022_invitations.sql`. `tests/server/auth.e2e.test.mjs` test: "invitations: created by a member with the capability, after a fresh identity check, delivered by email only" | Implemented in code. Requires configuration: sign-up switched off in the sign-in service (`docs/DEPLOYMENT.md`, section 4). | Decide who may invite. Review the member list on a schedule (`docs/security/monitoring-and-incident-response.md`, section 4). |
| E3 | Multi-factor authentication | A second sign-in step with an authenticator app, recovery codes stored as hashes, and a rule that listed roles cannot load the workspace without it, enforced by the server and again by the database. | `supabase/migrations/0021_sessions_mfa.sql`. `tests/server/auth.e2e.test.mjs` test: "second sign-in step required by role: the workspace does not load below aal2, in the server and in SQL" | Implemented in code. **Requires configuration: a new database requires it from nobody. For LBS the operator's list must be set to every office role** (`docs/DEPLOYMENT.md`, step 3.1). | Two-factor sign-in on the accounts around the platform too: GitHub, Vercel, Supabase, email, the password manager. |
| E4 | Least privilege | The read-only role changes nothing. Staff of one office do not see another office's clients. The browser key can do nothing without a sign-in. Server-only functions cannot be run by a signed-in person. Preview builds hold no production key. | `supabase/tests/rls_isolation.sql` test: "anon cannot execute any function in public or app". `supabase/tests/gateway.sql` test: "staff of the first office see its client and not the client of the second office". `supabase/migrations/0029_server_lockdown.sql` | Implemented in code. Requires configuration: who is a member of the Vercel team, the Supabase organization and the GitHub teams (`docs/security/isolation.md`, `docs/security/github-settings.md`). | Keep the number of owners and of hosting administrators small. |
| E5 | Audit trail | An append-only audit log written by database triggers, with who, what, role and the old and new value. It cannot be edited or deleted by anyone and is not removed with the record it describes. | `supabase/migrations/0004_audit_log.sql`. `supabase/tests/rls_isolation.sql` test: "owner cannot delete from the audit log" and test: "the service role cannot empty the audit log" | Implemented in code | Decide how long it is kept (`docs/security/data-retention.md`). Read it in the regular review. |
| E6 | Secure ID reveal records | Worker tax IDs: every read goes through one function and is recorded. Client tax IDs: the encrypted store exists and cannot be read or repointed by anyone directly. The request, approval by a second person, and one-time reveal for client tax IDs are **not built**. | `supabase/migrations/0005_pii_encryption.sql`. `supabase/tests/gateway.sql` test: "client_secrets has no policy at all" | Implemented in code for the store and for worker tax IDs. Client reveal flow: not built. | Until it is built, no client tax ID can be revealed through the platform, so there is nothing to record. Decide who may approve reveals. |
| E7 | Security-event records | Sign-ins, failures, lockouts, second-step changes, password changes, invitations, role changes, connections, refused webhooks and refused operations, each with outcome and severity, append only. | `supabase/migrations/0020_server_core.sql`, `api/_lib/audit.js` | Implemented in code | Read them (weekly is suggested). Keep the review record. |
| E8 | Encryption | In transit: HTTPS only, with a header that tells browsers to refuse plain HTTP. At rest, by the application: tax IDs encrypted inside the database with a key kept outside the data; provider tokens sealed by the server before storage; backups encrypted before they are written. At rest, by the hosts: the storage encryption Supabase and Vercel provide. | `scripts/security/check-headers.mjs`. `supabase/tests/rls_isolation.sql` test: "there is no plaintext tax ID column anywhere". `api/_lib/crypto.js`, `tests/server/unit.crypto.test.mjs`. `scripts/backup/backup.sh` | Implemented in code for the application layer. Requires configuration: the two keys in Vault, "Enforce SSL" on the database (`docs/DEPLOYMENT.md`, sections 3 and 4). | Confirm the hosts' encryption at rest in their documentation or contract and keep the reference. Full-disk encryption on every laptop and phone that reaches client data. |
| E9 | Backup | An encrypted copy of the database outside the hosting platform, with checksum and manifest, separate per deployment. | `scripts/backup/backup.sh` | Implemented in code. Requires configuration: key pair, storage location, and who runs it. **A schedule and a missed-backup alert are not built.** | Decide the interval, the location and the holders of the key (`docs/security/backup-and-recovery.md`, section 8). Confirm what the Supabase plan itself keeps. Back up the stored files (section 6 there). |
| E10 | Recovery | A restore script, and a test that restores a backup on a new server and on a server prepared like a new Supabase project and compares every table and every access rule. | `scripts/backup/restore.sh`, `scripts/backup/restore-test.sh`, `scripts/backup/fingerprint.sql` | Implemented in code and tested locally. **A restore into a real Supabase project has not been tried.** | Run the Supabase drill and record it. Set the recovery objectives (blank in the same section 8). |
| E11 | Incident-response logging | The records an investigation needs (E5, E7, webhook and job logs), and a runbook with a record template. | `docs/security/monitoring-and-incident-response.md` | Requires configuration: the alerts in the hosting dashboards. Organizational: the plan itself. | Fill in the names. Have counsel review the notification part. Rehearse it once. |
| E12 | Vendor and integration inventory | The list of every outside service the platform can use and the setting each needs. Each connection shows its real state to the owner. Nothing is connected by default. | `docs/security/secrets-and-environments.md`, `api/_lib/integrations/providers` | Implemented in code (the inventory of what the software can reach). | The vendor list of the plan: which of them LBS actually uses, the contract or terms with each, and the periodic check of each. That includes Supabase, Vercel, GitHub and the email provider. |
| E13 | User offboarding | A member is disabled, loses access at once, and an owner can end their sessions. Their history stays. | `supabase/tests/rls_isolation.sql` test: "a disabled member reads nothing". `tests/server/auth.e2e.test.mjs` test: "an owner ends the sessions of a member" | Implemented in code | The offboarding checklist: the application, the hosting accounts, the password manager, the devices, and replacing the secrets the person could read (`docs/security/data-retention.md`, section 3). |
| E14 | Data retention | Nothing a person entered expires by itself; clients can be marked former; technical rows are swept daily. Retention periods per kind of record are **not built**. | `docs/security/data-retention.md`. `supabase/migrations/0029_server_lockdown.sql` | Organizational. Not built: configurable retention, legal hold. | Fill in the schedule with counsel. |
| E15 | Secure deletion | Deletions are recorded in the audit log, which itself is kept. A reviewed deletion workflow is **not built**; the procedure is manual. Destroying aged-out backups is a documented manual step. | `docs/security/data-retention.md` | Organizational. Not built: deletion workflow. | Follow the manual procedure and record each deletion. Disposal of paper and devices. |
| E16 | Vulnerability management | Every change is scanned for keys and personal data, libraries are watched for known vulnerabilities, the code is analysed, and the build is checked before it ships. | `.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml`, `.github/workflows/codeql.yml`, `.github/workflows/dependency-review.yml`, `.github/dependabot.yml` | Implemented in code. Requires configuration: the GitHub settings, some of which are paid (`docs/security/github-settings.md`). | Decide on the paid features. Commission an independent test of the deployed system: none has been done. Patch the firm's own computers. |
| E17 | Security training acknowledgement tracking | **Not built.** No screen or table records who completed training or acknowledged a policy. | | Organizational | Keep the acknowledgements outside the platform until this is built. |
| E18 | Risk assessment documentation | **Not built** as a feature. This repository supplies inputs: what data the system holds, the known weaknesses of the older system and how each is handled, the test plan and its gaps. | `docs/security/legacy-defects.md`, `docs/security/security-test-plan.md`, `docs/security/isolation.md` | Organizational | Write the risk assessment. Revisit it when the system changes. |

## 2. FTC Safeguards Rule, element by element

Paraphrased from 16 CFR 314.4. The letters follow the paragraphs of that section.

| Element | Covered by | Status | Remains with LBS |
| --- | --- | --- | --- |
| (a) A qualified individual in charge of the program | Nothing in software | Organizational | Name the person: ______ |
| (b) A written risk assessment | E18 | Organizational | Write it and keep it current |
| (c)(1) Access controls | E1, E2, E4, E13 | Implemented in code; Requires configuration | The policy and the periodic access review |
| (c)(2) Know what data, people, devices and systems there are | E12; the data model in `docs/ARCHITECTURE.md`; the Team screen for people | Implemented in code for the system's own data and members | The inventory of devices, offices, paper files and other software |
| (c)(3) Encrypt customer information in transit and at rest | E8 | Implemented in code; Requires configuration | Devices, email and file sharing outside the platform |
| (c)(4) Secure development practices for software the firm builds or uses | E16; reviewed pull requests and protected branches | Implemented in code; Requires configuration | Assess the other software the firm uses |
| (c)(5) Multi-factor authentication for anyone reaching customer information | E3 | Implemented in code; Requires configuration (`docs/DEPLOYMENT.md`, step 3.1) | The same on every other system that holds client data |
| (c)(6) Secure disposal, and a periodic review of what is kept | E14, E15 | Organizational; parts not built | The retention schedule and the disposal procedure |
| (c)(7) Change management | Every change is a reviewed pull request with passing checks; database changes are numbered files that are never edited afterwards; a release reaches production only when a person promotes it. `.github/CODEOWNERS`, `docs/security/github-settings.md`, `docs/DEPLOYMENT.md` section 11 | Implemented in code; Requires configuration | Approve who the reviewers are |
| (c)(8) Log and monitor the activity of authorized users, and detect unauthorized access | E5, E7; the daily notice to owners (`api/_lib/jobs/handlers.js`) | Implemented in code; Requires configuration (dashboard alerts) | Do the reviews and keep the record |
| (d) Test and monitor the safeguards: continuous monitoring, or periodic penetration tests and vulnerability assessments | E16; `docs/security/security-test-plan.md` | Implemented in code for automated checks | Decide between continuous monitoring and scheduled outside testing, and arrange it. None has been done. |
| (e) Staff: training, qualified security personnel, keeping them current | E17 | Organizational | All of it |
| (f) Oversee service providers | E12 | Organizational | Select, contract and periodically assess each provider |
| (g) Keep the program current | The test plan and this map are updated with the code | Organizational | Review the plan after changes and after incidents |
| (h) A written incident response plan | E11 | Organizational; template provided | Complete it, with counsel |
| (i) Regular written reports from the qualified individual to those who govern the firm | Nothing in software | Organizational | Write them. The review records and test results are inputs. |
| (j) Notifying the FTC of certain security events | The incident record and the preserved logs | Organizational | A legal question: counsel decides whether and when |

## 3. IRS Publications 4557 and 5708

Topics paraphrased from "Safeguarding Taxpayer Data" and from the IRS's plan template for tax practices.

| Topic | Covered by | Status | Remains with LBS |
| --- | --- | --- | --- |
| Two-factor sign-in wherever it is offered | E3 | Implemented in code; Requires configuration | The tax software, email and every other account |
| Strong, unique passwords | Password rules enforced at sign-up by invitation, change and reset (`api/_lib/password.js`, `tests/server/unit.password.test.mjs`) | Implemented in code | A password manager for the firm; no shared accounts |
| Backups of client data, encrypted, kept in a separate place | E9, E10 | Implemented in code; Requires configuration | The schedule, the location, the drill |
| Encryption of stored client data and of drives | E8 for the platform | Implemented in code for the platform | Drive encryption on every device |
| Anti-virus, firewall, secure wireless, virtual private network for remote work | Nothing in software | Organizational | The office network and every device |
| Limit access to taxpayer data to those who need it | E1, E4, the office scope | Implemented in code | Assign offices and roles deliberately |
| Recognise phishing; staff awareness | E17 | Organizational | Training and its record |
| Watch for signs of data theft | E7, and the weekly review | Implemented in code; Requires configuration | The firm's IRS accounts and filing identifiers are watched outside the platform |
| Know whom to contact after a data theft | E11 | Organizational | The contact list and counsel's instructions |
| A recovery plan | E10 | Implemented in code and tested locally | The Supabase drill and the recovery objectives |
| The written plan itself: purpose and scope, responsible people, risk assessment, inventory, safety measures, implementation | This page for the safety measures of the platform | Organizational | The plan |
| Attachments of the plan: who has access to client data | The Team screen is the list for the platform | Implemented in code | Sign and date a copy for the plan at each review |
| Attachments: record retention and destruction | `docs/security/data-retention.md` | Organizational | Fill in and adopt |
| Attachments: breach procedures and notifications | `docs/security/monitoring-and-incident-response.md` | Organizational | Complete with counsel |
| Attachments: list of vendors that handle client data | E12 | Organizational | Maintain the list |
| Attachments: rules of behaviour and staff acknowledgements | E17 | Organizational; tracking not built | Keep them on file |

## 4. The two things a reviewer should hear first

1. **Nothing is deployed.** Every "Implemented in code" above was proved on a local test system that imitates Supabase. The first real deployment has to repeat the checks of `docs/security/security-test-plan.md`, section 4, and their results are the first real evidence.
2. **The gaps are listed, not hidden.** Not built at the time of writing: the request, approval and reveal flow for client tax IDs; a general recorded export; retention settings, legal hold and a deletion workflow; scheduled backups and their alert; training acknowledgement tracking; a risk assessment feature. An independent security test has not been done.

## 5. Keeping this page true

When a control changes, change its row in the same pull request. Run `node scripts/security/check-evidence.mjs`: it fails if a row points at a file or a test that no longer exists, and if any screen of the product claims a certification. It cannot check that a row's wording is fair; that is what the security owners' review of this folder is for (`.github/CODEOWNERS`).
