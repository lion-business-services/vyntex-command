# GitHub settings to switch on

The files in this repository (`.github/CODEOWNERS`, `.github/dependabot.yml`, the workflows in `.github/workflows`) do nothing for security until the settings below are switched on by a person. This page is the list, in the order to do them. Repository: `lion-business-services/VYNTEX-COMMAND`.

Each step names the software it happens in. Menu names on GitHub change from time to time: if a name is not exactly what you see, look for the closest one.

**About plans and cost.** Some of these features are free on every plan, some need a paid organization plan for a private repository, and some are separate paid products. This page says which, as far as is known at the time of writing, and marks each such statement "confirm". Confirm on GitHub's pricing page before relying on it, and get the owner's approval before anything that adds cost. Where a paid feature is not bought, the row says what still protects the repository without it.

| Feature | Private repository needs (confirm) | Without it |
| --- | --- | --- |
| Two-factor sign-in for the organization, teams, Dependabot alerts and updates, GitHub Actions | Free plan | |
| Branch protection or rulesets, CODEOWNERS reviews | A paid organization plan (GitHub Team) | Nothing stops a direct push to `main`. Do not skip this one. |
| Secret scanning and push protection | GitHub Secret Protection (paid, per committer) | `scripts/security/scan-secrets.mjs` and gitleaks still run in CI on every pull request |
| Code scanning (CodeQL) and dependency review | GitHub Code Security (paid, per committer) | The two workflows fail at their last step. Disable them (step 6) and rely on Dependabot alerts, which are free |
| Environments with required reviewers | GitHub Enterprise | Production approval is done on the Vercel side (step 9, option B) |

## 1. Two-factor sign-in for everyone

1. IN: GitHub (your own account, Settings, Password and authentication). Turn on two-factor authentication for your own account first. Use an authenticator app or a security key, not text messages.
2. IN: GitHub (your own account, Settings, Password and authentication). Download the recovery codes.
3. IN: your password manager. Save the recovery codes in the entry for GitHub.
4. IN: GitHub (organization `lion-business-services`, Settings, Authentication security). Tick **Require two-factor authentication for everyone in the organization**.
5. IN: GitHub (organization Settings, Authentication security). Press **Save**. Members without two-factor sign-in are removed from the organization until they turn it on, so tell them first.

## 2. People, teams and who can push

1. IN: GitHub (organization, People). Read the list. Remove anyone who no longer works on this.
2. IN: GitHub (organization, Teams). Press **New team**. Name: `maintainers`. Visibility: Visible. Create.
3. IN: GitHub (organization, Teams). Press **New team**. Name: `security-owners`. Create.
4. IN: GitHub (team `maintainers`, Members). Add the people who write code.
5. IN: GitHub (team `security-owners`, Members). Add the owner and the lead developer. These people must approve changes to the database, the server functions, the security checks and the pricing file (`.github/CODEOWNERS` lists the paths).
6. IN: GitHub (repository Settings, Collaborators and teams). Add team `maintainers` with role **Write**.
7. IN: GitHub (repository Settings, Collaborators and teams). Add team `security-owners` with role **Maintain**.
8. IN: GitHub (repository Settings, Collaborators and teams). Remove every individual who is listed outside a team, and anyone with role Admin who does not need it. The fewer admins, the fewer people who can switch these settings off.
9. IN: GitHub (organization Settings, Member privileges). Set **Base permissions** to **No permission**, so that being in the organization does not by itself give access to this repository.
10. IN: GitHub (organization Settings, Member privileges). Untick **Allow forking of private repositories**.

With one developer only: a pull request cannot be approved by its own author. Either the owner reviews and approves (she is in `security-owners`), or set the number of required approvals in step 4 to 0 and keep everything else. The second choice keeps the automated checks and the history of pull requests, and gives up the second pair of eyes. It is the owner's decision; write it down.

## 3. Repository basics

1. IN: GitHub (repository Settings, General). Under Danger Zone, check that visibility is **Private**.
2. IN: GitHub (repository Settings, General, Pull Requests). Tick **Allow squash merging**. Untick **Allow merge commits** and **Allow rebase merging**. One change, one commit on `main`.
3. IN: GitHub (repository Settings, General, Pull Requests). Tick **Automatically delete head branches**.
4. IN: GitHub (repository Settings, General, Pull Requests). Tick **Always suggest updating pull request branches**.

## 4. Protect the `main` branch

1. IN: GitHub (repository Settings, Rules, Rulesets). Press **New ruleset**, then **New branch ruleset**.
2. Ruleset name: `main`. Enforcement status: **Active**.
3. Bypass list: leave it empty. Nobody skips these rules, admins included.
4. Target branches: press **Add target**, choose **Include default branch**.
5. Tick **Restrict deletions**.
6. Tick **Block force pushes**.
7. Tick **Require linear history**.
8. Tick **Require a pull request before merging**, and inside it:
   * Required approvals: **1**
   * Tick **Dismiss stale pull request approvals when new commits are pushed**
   * Tick **Require review from Code Owners**
   * Tick **Require approval of the most recent reviewable push**
   * Tick **Require conversation resolution before merging**
9. Tick **Require status checks to pass**, and inside it tick **Require branches to be up to date before merging**.
10. Still inside it, press **Add checks** and add each of these names. A check appears in the search only after it has run once, so open a first pull request before this step:

    | Check name | From |
    | --- | --- |
    | `Typecheck, checks and both builds` | `.github/workflows/ci.yml` |
    | `Unit, server and security tests` | `.github/workflows/ci.yml` |
    | `Database rules on PostgreSQL 16` | `.github/workflows/ci.yml` |
    | `Keys and personal data in the files` | `.github/workflows/secret-scan.yml` |
    | `Keys in the Git history (gitleaks)` | `.github/workflows/secret-scan.yml` (only if step 7 is done) |
    | `Analyze (javascript-typescript)` and `Analyze (actions)` | `.github/workflows/codeql.yml` (only if step 6 is done) |
    | `New or changed libraries` | `.github/workflows/dependency-review.yml` (only if step 6 is done) |

11. Press **Create**.
12. Test it. IN: VS Code terminal, on a throwaway change:

    ```
    & "C:\Program Files\Git\bin\git.exe" push origin main
    ```

    The push must be refused with a message about the ruleset. If it goes through, the ruleset is not active: go back to step 2.

**Signed commits (if practical).** A signed commit proves which account made it. Turn the rule on only after every person who commits has set up signing, because an unsigned push is refused from that moment. Commits made by GitHub itself (a squash merge from the website, Dependabot) are signed already.

1. IN: VS Code terminal. Create a signing key (press Enter at each question, or set a passphrase):

   ```
   ssh-keygen -t ed25519 -C "signing key" -f "$env:USERPROFILE\.ssh\id_ed25519_signing"
   ```

2. IN: VS Code terminal. Tell Git to sign with it:

   ```
   & "C:\Program Files\Git\bin\git.exe" config --global gpg.format ssh
   & "C:\Program Files\Git\bin\git.exe" config --global user.signingkey "$env:USERPROFILE\.ssh\id_ed25519_signing.pub"
   & "C:\Program Files\Git\bin\git.exe" config --global commit.gpgsign true
   ```

3. IN: VS Code. Open the file `id_ed25519_signing.pub` in the `.ssh` folder of your user folder and copy its one line. This is the public half. Never copy the file without `.pub`.
4. IN: GitHub (your own account, Settings, SSH and GPG keys). Press **New SSH key**. Key type: **Signing Key**. Paste. Save.
5. Make one commit and push it on a branch. IN: GitHub (the branch's commit list). The commit shows **Verified**.
6. When every committer shows Verified: IN: GitHub (repository Settings, Rules, Rulesets, `main`). Tick **Require signed commits**. Save.

## 5. Dependabot

Free on every plan (confirm).

1. IN: GitHub (repository Settings, Advanced Security). On older layouts this page is called **Code security and analysis**.
2. Turn on **Dependency graph**.
3. Turn on **Dependabot alerts**.
4. Turn on **Dependabot security updates**.
5. `.github/dependabot.yml` already asks for weekly version updates of npm packages, GitHub Actions and the container base images. Nothing more to switch on for that.
6. IN: GitHub (repository, Insights, Dependency graph, Dependabot). After a few minutes the three update jobs are listed.

Dependabot can only read the libraries once `package-lock.json` is committed. If the file is missing: IN: VS Code terminal, run `npm install` once and commit the file it creates.

## 6. Secret scanning, push protection and code scanning

These are paid products for a private repository (confirm): GitHub Secret Protection covers secret scanning and push protection, GitHub Code Security covers CodeQL and dependency review. Get the owner's approval for the cost first.

If the owner approves Secret Protection:

1. IN: GitHub (repository Settings, Advanced Security). Turn on **Secret Protection** (or **Secret scanning** on older layouts).
2. On the same page, turn on **Push protection**. A push that contains a recognised key is refused before it reaches GitHub.
3. On the same page, turn on **Scan for non-provider patterns** if it is offered (private keys, connection strings).

If the owner approves Code Security:

4. IN: GitHub (repository Settings, Advanced Security). Turn on **Code Security**.
5. Do not press "Set up" for the default CodeQL configuration. The repository has its own, `.github/workflows/codeql.yml`; the two would clash.
6. IN: GitHub (repository, Actions). Open the latest **CodeQL** run and the latest **Dependency review** run. Both must be green.
7. IN: GitHub (repository, Security, Code scanning). Results appear here. Read and close each one.

If the owner does not approve one of them:

8. IN: GitHub (repository, Actions). Choose the workflow **CodeQL** (and **Dependency review**) in the left list, press the **...** button, choose **Disable workflow**. A workflow that fails on every pull request teaches people to ignore red marks.
9. Leave their names out of the required checks in step 4.10.
10. Write the decision in the security log. What still runs without the paid products: the repository's own secret and personal data scans, gitleaks (step 7), Dependabot alerts and updates.

## 7. The gitleaks licence key

The job `Keys in the Git history (gitleaks)` uses the gitleaks action. For a repository that belongs to an organization the action asks for a licence key. Confirm the terms and any cost on the gitleaks action's page, and get the owner's approval if there is a cost.

1. IN: a browser, the gitleaks website. Request a licence key for the organization `lion-business-services`.
2. IN: GitHub (repository Settings, Secrets and variables, Actions). Press **New repository secret**. Name: `GITLEAKS_LICENSE`. Value: the key. Add.
3. IN: GitHub (repository Settings, Secrets and variables, Dependabot). Press **New repository secret**. Name: `GITLEAKS_LICENSE`. Same value. Dependabot's pull requests cannot read the Actions secrets, only this separate list.
4. IN: GitHub (repository, Actions, Secret scan). Press **Run workflow** on `main`. The gitleaks job must be green.

If the key is not obtained: disable the job by removing its name from the required checks. The first job of the same workflow (the repository's own scan) needs no key and keeps running.

## 8. GitHub Actions settings

1. IN: GitHub (repository Settings, Actions, General, Actions permissions). Choose **Allow lion-business-services, and select non-lion-business-services, actions and reusable workflows**.
2. Tick **Allow actions created by GitHub**.
3. In the box "Allow specified actions and reusable workflows", enter:

   ```
   gitleaks/gitleaks-action@*
   ```

4. If the option **Require actions to be pinned to a full-length commit SHA** is shown, tick it. Every action in this repository already is.
5. Press **Save**.
6. On the same page, under **Fork pull request workflows**, choose **Require approval for all external contributors**.
7. On the same page, under **Workflow permissions**, choose **Read repository contents and packages permissions**.
8. On the same page, untick **Allow GitHub Actions to create and approve pull requests**.
9. Press **Save**.

The workflows in this repository use no secret except the gitleaks licence key, and no workflow has a key to Supabase or Vercel. Keep it that way: a workflow that can reach the production database turns every pull request into a way in.

## 9. Who may deploy to production

Production must only ever receive code that passed the checks and that a person approved. There are two ways to hold that line. Use B unless the organization is on GitHub Enterprise.

**Option A: GitHub environments with required reviewers** (private repositories: GitHub Enterprise, confirm)

1. IN: GitHub (repository Settings, Environments). Press **New environment**. Name: `production-vyntex`.
2. Tick **Required reviewers**. Add the team `security-owners`.
3. Under **Deployment branches and tags**, choose **Selected branches and tags**, and add `main`.
4. Save. Repeat steps 1 to 3 with the name `production-lbs`.
5. This only has an effect if deployments are made by a GitHub Actions workflow that names the environment. No such workflow exists in this repository today (Vercel deploys from Git by itself), so option A also needs that workflow to be written first.

**Option B: approval on the Vercel side** (works on any GitHub plan)

1. IN: Vercel, Project (VYNTEX Command), Settings, Git. Check that **Production Branch** is `main`. Because of step 4, `main` only ever receives reviewed, checked pull requests.
2. IN: Vercel, Project, Settings, Environments, Production. Turn off **Auto-assign Custom Production Domains**. From now on a merge to `main` builds a new version but does not put it on the public address.
3. To release: IN: Vercel, Project, Deployments. Open the new deployment, look at it on its own address, then press **Promote**. That click is the explicit approval, and Vercel records who made it.
4. IN: Vercel, Team Settings, Members. Only the people who may release have a role that can promote. Everyone else is Viewer or is not a member.
5. Repeat steps 1 to 4 for the second Vercel project (LBS Command). The two projects have separate member lists if LBS is kept in its own Vercel team, which `docs/security/isolation.md` recommends.

## 10. Check the result

1. IN: GitHub (repository Settings, Rules, Rulesets). `main` is **Active**.
2. IN: GitHub (repository, Security). The overview shows no feature marked "Disabled" that this page turned on.
3. IN: GitHub (repository, Pull requests). Open a small pull request. Every required check runs, a code owner is asked for a review automatically, and the Merge button is grey until both are done.
4. IN: VS Code terminal. Run the repository's own checks once, to see what they print when all is well:

   ```
   node --test "tests/security/*.test.mjs"
   ```

5. Write the date and who did these steps in the security log of the firm. Review this page every six months, and whenever someone joins or leaves.

## Not verified here

This page was written without access to the organization's GitHub settings. The workflows were checked for structure (valid YAML, every action pinned to a full commit, permissions per job) and have not run on GitHub yet. The first pull request is their test; if a job fails for a reason that is not the code, fix the workflow before making its check required.
