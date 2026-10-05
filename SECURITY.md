# Security

VYNTEX Command and LBS Command are built from this repository. LBS Command holds tax and financial records of the clients of Lion Business Services, so security problems here are treated as urgent.

## Reporting a problem

If you find a weakness, or you think data was exposed:

1. Write to **info@vyntexusa.com** with the subject "Security report". Or call 609-780-3218 and ask for the owner.
2. Say what you saw, where (the address or the file), and how to see it again. A few lines are enough to start.
3. Do **not** open a public issue, and do not put the details in a pull request, a chat channel or a shared document.
4. Do not include real client data, a real tax ID or a working key in the report. Describe it, or send a redacted screenshot.
5. Do not test against live client data, and do not keep trying once you have shown the problem exists.

Staff of Lion Business Services and Vyntex: if a key, a password or client data was exposed, do not wait for an answer to an email. Follow the first-hour steps in `docs/security/monitoring-and-incident-response.md`.

What happens next: the report is read by the owner and the lead developer, you get an answer, and the fix goes through the same reviewed process as any other change. No response time is promised here, because none has been set by the owner yet.

## What this repository claims, and what it does not

The platform is built to **support** a written information security plan for a tax and financial services firm: access control, two-step sign-in, encryption, audit trail, backups with a tested restore, and the records a review needs. `docs/security/wisp-evidence-map.md` maps each safeguard to the file or test that shows it, and marks what is still configuration or the firm's own responsibility.

It does **not** make anyone compliant by itself, and no certification or audit has been obtained. Nothing in the product or in these documents says "IRS compliant", "SOC 2 certified" or similar, and a check in `scripts/security/check-evidence.mjs` fails the build if such a phrase appears on a screen. A qualified professional has to assess the firm's whole program: people, devices, contracts and procedures, not only this software.

## Where things are

| Topic | Document |
| --- | --- |
| How data is protected, the role matrix, what the database tests prove | `docs/SECURITY.md` |
| How LBS is kept separate from client companies | `docs/security/isolation.md` |
| Safeguards mapped to evidence | `docs/security/wisp-evidence-map.md` |
| Weaknesses of the older system and how each is prevented here | `docs/security/legacy-defects.md` |
| Every automated security test and how to run it | `docs/security/security-test-plan.md` |
| Secrets: where each lives and how to replace it | `docs/security/secrets-and-environments.md` |
| Backups and the restore drill | `docs/security/backup-and-recovery.md` |
| What is logged, alerts, and the incident runbook | `docs/security/monitoring-and-incident-response.md` |
| How long records are kept, deletion, export | `docs/security/data-retention.md` |
| GitHub settings to switch on | `docs/security/github-settings.md` |
| Removing customer data from the older system's repository | `docs/security/repository-cleaning.md` |
| Deployment, step by step | `docs/DEPLOYMENT.md` |

## Rules for everyone who changes this repository

* No secret and no real person's data in the repository, ever. Sample records are fictional and say so.
* Every change reaches `main` through a pull request that passed the checks and was reviewed.
* Security is enforced on the server and in the database. A screen that hides a button is a courtesy, not a control.
* Run `node --test "tests/security/*.test.mjs"` before opening a pull request. It runs the secret scan, the personal data scan, the header check and their tests.
