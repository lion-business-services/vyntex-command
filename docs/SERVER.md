# Server

How the backend in `api/` works: sign-in, sessions, the second sign-in step, invitations, the live workspace routes,
connections to outside services, webhooks and background jobs. Written for the engineers who build on it and for
whoever deploys it.

**Nothing here has been deployed and nothing here has been run against Supabase or a real provider.** It was proved
against a local stand-in (section 12 says exactly what that means and what is still to prove).

## 1. The shape of it

The browser talks to this site only (`connect-src 'self'` stays). It never holds a Supabase address, key or token.

```
browser ── /api/auth/*          sign-in, second step, fresh checks, invitations, passwords
        ── /api/ws/*            load, apply, protected operations, files
        ── /api/integrations/*  connections to outside services
provider ─ /api/webhooks/<id>   signed calls from providers
Vercel ─── /api/cron/<job>      scheduled runs (secret header)

api/<file>.js ── api/_lib/*  ── Supabase Auth      /auth/v1/*       (plain fetch, no SDK)
                             ── Supabase Data API  /rest/v1/rpc/*   with the PERSON'S token, so row level security decides
                             ── Supabase Storage   /storage/v1/*    with the person's token
                             ── providers          through one adapter per provider
```

| File | What it holds |
| --- | --- |
| `api/auth.js`, `ws.js`, `integrations.js`, `webhooks.js`, `cron.js`, `health.js` | The six entry points of this range (eight functions with `assistant.js` and `demo-request.js`; `public.js` will make nine; the limit is twelve). |
| `api/_lib/env.js` | Every setting, by name. Never returns or logs a value by accident. The production safety rules. |
| `api/_lib/supabase.js` | The fetch client. Person-token calls and the few service-role calls, each with its reason. |
| `api/_lib/session.js` | The sealed cookie, idle timeout, absolute lifetime, refresh rotation. |
| `api/_lib/csrf.js` | Same-origin check and the double-submit value. |
| `api/_lib/guard.js` | The checks every signed-in route runs, in one order. |
| `api/_lib/ratelimit.js` | Limits and lockouts, in the database, with a memory fallback. |
| `api/_lib/crypto.js` | Sealing of stored provider tokens (versioned envelope, key rotation). |
| `api/_lib/audit.js` | Security events. |
| `api/_lib/jobs.js`, `jobs/handlers.js` | The job runner and what each kind of job does. |
| `api/_lib/password.js`, `mail.js`, `respond.js`, `rpc-allowlist.js` | Password rules, system email, answers and errors, the allow-list. |
| `api/_lib/integrations/{core,oauth,store,webhook}.js`, `providers/*` | The integration framework and its adapters. |
| `supabase/migrations/0020` to `0029` | The tables and functions behind all of it. |

## 2. What happens to a request

For every route that needs a signed-in person (`api/_lib/guard.js`), in this order:

1. **The deployment is sane.** Every core setting is present and no production deployment carries a test or
   development value (section 10). Otherwise `503 not_configured`.
2. **It comes from this site.** For anything but GET and HEAD: the `Origin` header must be `APP_ORIGIN`, and the
   `x-vx-csrf` header must equal the `vx-csrf` cookie, be signed by this server, and belong to this session.
3. **There is an open session.** The cookie opens with the server's key, is not idle past the company's limit, is
   not older than the absolute lifetime, and its tokens are fresh (they are exchanged when about to expire).
4. **The second sign-in step is done**, when the session still owes it.
5. **A fresh identity check**, when the route asks for one (within five minutes).

Then the route calls the database **with the person's token**. The database repeats 3 to 5 from its own evidence
(`app.require_mfa`, `app.require_stepup`) and applies row level security and the capability checks. A mistake in
the server does not open anything.

Errors are codes (section 9). A message written by the database, by Supabase Auth or by a provider never reaches
the browser, and neither does a stack trace. Server logs hold a code and a status, never a value typed by a person.

## 3. Sessions

After sign-in the Supabase access token and refresh token are sealed (AES-256-GCM, key derived from
`SESSION_SECRET` with HKDF) into one cookie:

| | Production, preview, staging | Local and test (plain http) |
| --- | --- | --- |
| Session cookie | `__Host-vx` `HttpOnly; Secure; SameSite=Lax; Path=/` | `vx` `HttpOnly; SameSite=Lax; Path=/` |
| csrf cookie | `__Host-vx-csrf` `Secure; SameSite=Lax; Path=/` (readable by the page on purpose) | `vx-csrf` |

A large session is split over up to four cookies (`__Host-vx`, `__Host-vx1`, ...). The frontend reads the csrf
value from the answer of `GET /api/auth/session` (field `csrf`) and sends it as `x-vx-csrf`; it does not need to
know the cookie names.

* **Idle timeout.** The company's `config.security.idleMinutes` (default 30, between 5 minutes and 12 hours),
  enforced from a stamp inside the sealed cookie. A request with the header `x-vx-passive: 1` (background polling)
  does not count as activity. Past the limit: `401 session_idle` and the cookie is cleared.
* **Absolute lifetime.** `SESSION_MAX_HOURS` (default 12) from sign-in, whatever the activity: `401 session_expired`.
* **Refresh rotation.** When the access token has less than a minute left, the refresh token is exchanged and
  replaced. A refresh token never works twice; replaying an old cookie ends the whole session (Supabase Auth's
  reuse detection), for the thief and for the real browser.
* **Sign out** deletes the Supabase session. **Sign out everywhere** revokes every refresh token of the person and
  writes a mark the database checks, so access tokens that were already issued stop working at once too.
* **Key rotation.** Put the new value in `SESSION_SECRET`, the old one in `SESSION_SECRET_PREVIOUS`, deploy. Open
  sessions keep working and are re-sealed with the new key. Remove the previous value a day later.

## 4. No sign-up. Invitations.

There is no route that creates an account from nothing, and Supabase Auth's own sign-up must be switched off in
each project (section 11). An account exists only because of an invitation:

1. A member with the `users` capability calls `POST /api/ws/rpc/member_invite` (needs a fresh identity check).
   The server makes a random token, stores only its SHA-256 hash with the role, the inviter and a 72 hour expiry,
   and emails the link `https://<site>/invite/<token>` to the invited address. The inviter never sees the link.
   If email is not set up, or sending fails, the invitation is withdrawn and the answer says so.
2. The invited person opens the link. `POST /api/auth/invite/check` shows which company it is for.
   `POST /api/auth/invite/accept` with a password creates the account, adds the membership with the invited role,
   and signs them in. The invitation works once. If the address already has an account (a member of another
   company), the password must be that account's own password: an invitation can never reset a password.
3. Only an owner can invite an owner.

**The first owner of a new company** is invited by the platform operator, in the Supabase SQL Editor:

```sql
select public.invite_bootstrap('<tenant id>', 'owner@example.com');
```

It returns the token once. Send `https://<site>/invite/<token>` to the owner through a channel you trust. The
function refuses when the company already has an active owner, and no application role can call it.

**Password rules** (`api/_lib/password.js`): 12 characters or more (72 bytes at most), not one of the common
passwords in the bundled list, not a simple run or repetition, not built from the person's email. No rules about
capitals, digits or symbols.

## 5. The second sign-in step and fresh identity checks

* **Authenticator apps (TOTP)** through Supabase Auth's factor endpoints. `mfa/enroll` returns the secret and the
  `otpauth://` address (and Supabase's QR image when it sends one); `mfa/confirm` with a code finishes and returns
  ten recovery codes, shown once and stored only as hashes.
* **Who must use it.** Roles listed in the company's `config.security.mfaRoles`, plus the operator's required list
  in the database, plus anyone who has an authenticator enrolled. On the LBS deployment every office role, by
  default. Until the step is passed, `GET /api/auth/session` says `mfa.state` = `verify` or `enroll`, and every
  workspace route answers `403 mfa_required`. The database enforces the same from the token's `aal` claim.
* **Recovery code.** `mfa/recovery` uses one code up and removes the lost authenticator. The person then enrols a
  new one (required right away when their role demands the second step).
* **Fresh identity check.** `POST /api/auth/stepup` with a code (or with the password when the person has no
  authenticator) stamps the session for five minutes. Needed for: revealing a tax ID, inviting, changing roles,
  disabling a member, ending someone's sessions, exports, connecting and disconnecting a provider, changing the
  password. The server stamps its sealed cookie AND a row in the database written with the server key; protected
  database functions check that row (`app.require_stepup()`), so the rule holds even if the server had a bug.
* Wrong codes and wrong passwords are counted: five in fifteen minutes lock that step, with a lock that doubles.

**For the LBS database, at setup** (SQL Editor, once), so the database enforces the default too:

```sql
update app.server_settings
   set value = '{"mfaRoles": ["owner", "manager", "staff", "readonly"], "idleMinutes": 30}'
 where key = 'security.required';
```

A company can add roles to the list; it cannot remove a role the operator requires.

## 6. Endpoints

Every answer is JSON: `{ "ok": true, ... }` or `{ "ok": false, "error": "<code>", ... }`. POST bodies are JSON
(`content-type: application/json`) unless noted. Every POST needs the `x-vx-csrf` header. `tenant` is always the
company id (`memberships[].tenantId` from the session answer).

### /api/auth

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/auth/session` | | Not signed in: `{ signedIn: false, deploy, csrf }`. Signed in: `{ signedIn: true, deploy, user: { id, email }, aal, mfa: { state: 'ok' \| 'verify' \| 'enroll', enrolled, required, recoveryCodesLeft }, stepUp: { fresh, expiresAt }, idleMinutes, expiresAt, memberships: [{ tenantId, slug, name, industry, plan, status, role, memberId, workerId, memberName, capabilities: [], mfaRequired }], csrf }` |
| `POST /api/auth/signin` | `{ email, password }` | `{ mfa: 'ok' \| 'verify' \| 'enroll', csrf }`. Wrong anything: `401 invalid_credentials`. Locked: `429 locked` with `retryAfterSeconds`. |
| `POST /api/auth/mfa/enroll` | `{}` | `{ factorId, secret, uri, qr }` |
| `POST /api/auth/mfa/confirm` | `{ factorId, code }` | `{ mfa: 'ok', recoveryCodes: [10 strings] }` |
| `POST /api/auth/mfa/verify` | `{ code }` | `{ mfa: 'ok' }` |
| `POST /api/auth/mfa/recovery` | `{ code }` | `{ mfa: 'ok' \| 'enroll' }` |
| `POST /api/auth/stepup` | `{ code }` or `{ password }` | `{ stepUp: { fresh: true, expiresAt } }`. `400 code_required` when the person has an authenticator and sent a password. |
| `POST /api/auth/signout` | `{}` | `{}` |
| `POST /api/auth/signout-all` | `{}` | `{}` |
| `POST /api/auth/invite/check` | `{ token }` | `{ company, emailHint, expiresAt }` or `400 invite_invalid` |
| `POST /api/auth/invite/accept` | `{ token, password, name? }` | `{ signedIn: true, mfa, slug, tenantId, csrf }`. `400 weak_password` with `reason`; `409 account_exists`; `400 invite_invalid`. |
| `POST /api/auth/password/reset` | `{ email, lang? }` | Always `{ emailConfigured }`. The email link is `/reset-password#token=<token>` (the token is after `#`). |
| `POST /api/auth/password/reset` | `{ token, password }`, or `{ password }` to retry after `weak_password` | `{}`. Every session of the person is ended; they sign in again. |
| `POST /api/auth/password/update` | `{ password }` (needs a fresh identity check) | `{}`. Other browsers are signed out. |

`weak_password` reasons: `too_short`, `too_long`, `common`, `pattern`, `contains_email`.

### /api/ws

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/ws/load?tenant=<id>` | | `{ data: WorkspaceData }` |
| `POST /api/ws/apply` | `{ tenant, ops: [{ c, op: 'upsert' \| 'delete', id, row? }], idem }` (`idem`: 8 to 80 of `A-Z a-z 0-9 _ -`; at most 500 ops and 1 MB) | The gateway's answer as it is: `{ ok, applied, rejected: [{ id, c, reason }], server: { ... } }` |
| `POST /api/ws/rpc/<name>` | `{ tenant, args: { p_...: value } }` | `{ result }`. `404 unknown_operation` for a name not on the list; `501 not_available` when the function is not installed yet. |
| `POST /api/ws/rpc/member_invite` | `{ tenant, args: { email, role, name?, lang?, workerId? }, idem? }` | `{ invitation: { id, email, role, expiresAt }, delivery: 'sent' }`; `409 email_not_configured`; `502 delivery_failed` |
| `POST /api/ws/file/upload` | The file itself as the body. Headers: `content-type` (the file's type), `x-vx-tenant`, `x-vx-area` (optional, default `documents`), `x-vx-filename` (URL-encoded, a label only) | `{ file: { name, size, mime, path } }` (a `FileRef`). At most 4 MB. PDF, JPEG, PNG, WebP, DOCX, XLSX, plain text, CSV; the content must match the type. |
| `POST /api/ws/file/url` | `{ tenant, path, name? }` | `{ url, expiresAt }`. The link is on this site, lasts one minute, works for the person who asked, and always downloads. |
| `GET /api/ws/file/get?k=...` | | The file. |

### /api/integrations

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/integrations?tenant=<id>` | | `{ connections: [{ id, name, kind, built, state, reason, missing: [], approval, account?, scopes, connectedAt?, lastSyncAt?, lastError?, health?, by? }] }` |
| `POST /api/integrations/<id>/connect` | `{ tenant, returnTo? }` (fresh identity check) | OAuth: `{ url }`, send the browser there. Key providers: `{ connection }`, or `502 verify_failed` with `reason`. `409 not_configured` (with `missing`), `409 pending_approval`. |
| `GET /api/integrations/<id>/callback` | | Redirect to `returnTo?integration=<id>&result=connected` or `&result=error&reason=<code>` |
| `POST /api/integrations/<id>/disconnect` | `{ tenant }` (fresh identity check) | `{ removed, revokedAtProvider }` |
| `POST /api/integrations/<id>/sync` | `{ tenant, what? }` | `{ queued: true, job }` |
| `POST /api/integrations/<id>/test` | `{ tenant }` | `{ working, health, reason }` |

Other entry points: `POST /api/webhooks/<provider>` (providers only), `GET /api/cron/tick` and `/api/cron/daily`
(`Authorization: Bearer <CRON_SECRET>`), `GET /api/health` (add `?deep=1` with the same header for the job queue numbers).

## 7. The allow-list of protected operations

`api/_lib/rpc-allowlist.js`. A database function is reachable through `/api/ws/rpc/<name>` only when its name is
listed there. "Fresh check" means the route needs `stepup` within five minutes.

| Name | Fresh check | Notes |
| --- | --- | --- |
| `vault_set`, `vault_request` | no | module range, not installed yet |
| `vault_decide`, `vault_reveal` | **yes** | module range |
| `member_invite` | **yes** | handled by the server (token and email), section 4 |
| `member_set_role`, `member_disable` | **yes** | module range |
| `invite_list`, `invite_revoke` | no | this range |
| `session_revoke_member` | **yes** | this range: `{ p_member }` ends every session of that member |
| `grant_decide`, `appt_mark_paid`, `appt_cancel`, `credit_apply`, `credit_void`, `cash_close`, `lead_assign_next` | no | module range |
| `export_request`, `export_1099_data` | **yes** | |
| `set_worker_tax_id`, `get_worker_tax_id` | **yes** | migration 0005; no company argument |
| `revoke_consent`, `worker_set_task_done` | no | migrations 0006, 0007; no company argument |
| `ws_session`, `ws_hidden_clients` | no | gateway range |
| `security_events_list`, `security_summary`, `webhook_log`, `jobs_log` | no | this range, read only |

Rules for a function added to the list: its first argument is `p_tenant uuid` (the server fills it from `tenant`
and refuses a different value in `args`); argument names start with `p_`; it calls `app.require_mfa(p_tenant)`
first and, when it is sensitive, `app.require_stepup()`.

## 8. The database side (migrations 0020 to 0029)

The server's tables live in schema `app`, which the Data API does not expose: row level security enabled and
forced, no policy, no table privilege for any application role. Access is through functions only. Functions meant
for the server are granted to `service_role` only; nothing is executable by `anon`. `0029` checks all of this and
refuses to finish otherwise.

| Migration | Tables in `app` | For other engineers |
| --- | --- | --- |
| `0020_server_core` | `server_settings`, `security_events` (append only) | `app.security_event(tenant, user, kind, outcome, ip_hash, meta, subject_hash)`: call it from any security definer function that reveals, exports or changes access. It also writes the audit log of 0004. `app.mfa_roles(tenant)`, `app.idle_minutes(tenant)`. |
| `0021_sessions_mfa` | `session_revocations`, `session_stamps`, `mfa_recovery_codes` | `app.session_aal()`, **`app.require_mfa(p_tenant)`**, **`app.require_stepup()`**, `public.auth_context()` |
| `0022_invitations` | `invitations` | `public.invite_create / invite_list / invite_revoke`, `public.invite_bootstrap` (operator only) |
| `0023_rate_limits` | `rate_limits`, `rate_locks` | `app.rate_hit(bucket, key, limit, window_seconds)` |
| `0024_idempotency` | `idempotency_keys` | `public.idem_begin / idem_finish / idem_abort` (server key) |
| `0025_job_queue` | `jobs` | `app.job_enqueue`, `app.job_claim` (`for update skip locked`), `job_finish`, `job_fail`, `job_requeue` |
| `0026_integrations` | `integration_connections`, `oauth_states`, `sync_cursors` | `public.connections_list(p_tenant)`: the source for the `connections` collection |
| `0027_webhook_events` | `webhook_events` | `public.webhook_log(p_tenant)` |
| `0028_workspace_files` | (bucket `workspace-files` and its storage policies) | path `<tenant_id>/<area>/<random>.<ext>` |
| `0029_server_lockdown` | | `public.vx_ws_load`, `vx_ws_apply`, `vx_guard`, `server_sweep`, and the lockdown check |

Error codes raised by the guards: `VX401` session revoked, `VX402` second step required, `VX403` fresh check required.

`0029` is safe to run again. When a later migration adds a table to schema `app`, run it again afterwards.

## 9. Error codes the browser can receive

`not_configured` (503), `bad_origin`, `bad_csrf` (403), `not_signed_in`, `session_idle`, `session_expired`,
`session_revoked` (401), `mfa_required`, `stepup_required`, `forbidden` (403), `invalid_credentials`, `invalid_code`
(401), `locked`, `rate_limited` (429, with `retryAfterSeconds`), `invalid_request`, `invalid_json`, `invalid`,
`invalid_ops`, `invalid_args`, `invalid_path`, `invalid_area`, `tenant_required`, `tenant_mismatch`, `idem_required`,
`weak_password`, `invite_invalid`, `reset_invalid`, `code_required`, `password_required`, `empty_file` (400),
`too_large` (413), `unsupported_media_type`, `type_not_allowed`, `type_mismatch` (415), `conflict`, `rejected`,
`account_exists`, `already_enrolled`, `not_enrolled`, `in_progress`, `idem_mismatch`, `email_not_configured`,
`not_built`, `pending_approval` (409), `link_invalid` (403), `unknown_operation`, `unknown_provider`, `not_found` (404),
`method_not_allowed` (405), `not_available` (501), `verify_failed`, `delivery_failed`, `upstream_error` (502),
`auth_unavailable`, `upstream_unreachable`, `queue_unavailable`, `store_unavailable` (503), `server_error` (500).

## 10. Environment variables

`.env.example` lists every name with an explanation and no value. VYNTEX Command and LBS Command are separate
Vercel projects pointing at separate Supabase projects. **Each variable is set separately in each project, with
its own value. Nothing is shared.**

| Variable | VYNTEX | LBS | Secret | Without it |
| --- | --- | --- | --- | --- |
| `VX_DEPLOY` | `vyntex` | `lbs` | no | defaults to vyntex |
| `APP_ORIGIN` | its public address | its public address | no | the workspace does not run in production |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | its project | its project | no | the workspace does not run |
| `SUPABASE_SERVICE_ROLE_KEY` | its project | its project | yes | the workspace does not run |
| `SESSION_SECRET` | own value | own value | yes | the workspace does not run |
| `TOKEN_ENC_KEY` | own value | own value | yes | the workspace does not run |
| `IP_HASH_SALT` | own value | own value | yes | the workspace does not run |
| `CRON_SECRET` | own value | own value | yes | the workspace does not run; scheduled calls are refused |
| `RESEND_API_KEY`, `SYSTEM_EMAIL_FROM` | own key and sender | own key and sender | key: yes | no invitations, no reset emails, no notices (the screens say so) |
| `RESEND_WEBHOOK_SECRET` | optional | optional | yes | delivery events are refused |
| `SESSION_SECRET_PREVIOUS`, `TOKEN_ENC_KEY_PREVIOUS`, `SESSION_MAX_HOURS`, `VX_ENV` | optional | optional | first two | |
| `DEMO_REQUEST_TO`, `DEMO_REQUEST_FROM` | yes | not used (no sales pages) | no | the demo form says it could not send |
| `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` | optional | optional | key: yes | the built-in assistant is used |
| provider variables | per provider | per provider | secrets: yes | that provider shows "not connected" with the reason |

Set them for Production. For Preview use a separate Supabase project and separate secrets, or leave the server key
out: a preview build must never write to the production database.

**Environment rules** (`problems()` in `api/_lib/env.js`). The workspace routes answer `503 not_configured`, and
`/api/health` shows `workspace: false`, when: a core variable is missing; `SESSION_SECRET` is shorter than 32
characters; `TOKEN_ENC_KEY` is not 32 bytes of base64; or, in production: `VX_ENV` says anything but production,
`SUPABASE_URL` is a local or plain http address, `APP_ORIGIN` is not https, a secret has a sample value, two secrets
share a value, or the test provider's address is set. The server log names the rule and the variable, never a value.

**Rotating the token key.** New value in `TOKEN_ENC_KEY`, old value in `TOKEN_ENC_KEY_PREVIOUS`. Stored tokens
open with either and are sealed again with the new key the next time each connection is used. Remove the previous
value once every connection has been used or reconnected.

## 11. Supabase settings each project needs

IN: Supabase dashboard, for each of the two projects.

* Authentication: **"Allow new users to sign up" off.** The server has no sign-up route; this closes Supabase's own.
* Authentication, multi-factor: **TOTP enabled.**
* Authentication, sessions: refresh token rotation on, reuse interval 10 seconds. Access token lifetime one hour or less.
* Authentication, passwords: minimum length 12; leaked password protection on where the plan offers it.
  "Secure password change": the server demands its own fresh identity check before a password change and its
  sessions never live longer than 12 hours. Whether Supabase's own setting then asks for more is to be confirmed on
  the real project; if a password change is refused there, switch that setting off.
* Email templates are not used by this server (invitations and resets are sent through Resend with links to this
  site), so no template has to point anywhere.
* Data API: exposed schemas `public` only, never `app`.
* Storage: the bucket `workspace-files` exists (created by 0028) and is private.
* Run the migrations in order through `0029`, then `supabase/seed.sql`. For LBS, also the statement in section 5.

IN: Vercel dashboard: the two cron entries of `vercel.json` (`/api/cron/tick` every five minutes, `/api/cron/daily`
once a day) need a plan that allows a schedule more frequent than daily. Vercel sends `CRON_SECRET` by itself when
the variable is set.

## 12. Running it locally, and what the local stand-in is

```
npm run dev:stack          PostgreSQL + the Supabase test double + the site with its api   (http://localhost:4620)
npm run test:server        108 unit tests, then 58 end-to-end tests against the local stack
node tests/server/run.mjs --unit     the unit tests only (no database)
```

`dev:stack` starts a throwaway PostgreSQL 16 (`tests/server/pg_local.sh`), applies every migration, starts
`scripts/dev-supabase.mjs` on port 4621 and `scripts/serve.mjs` on port 4620 with secrets made up for that run,
creates a sample company and prints the invitation link of its first owner (fictional address). Add `--isolated`
to apply only migrations 0001 to 0009, the server range and a small stand-in for the gateway functions.

**`scripts/dev-supabase.mjs` is a test double. It is not Supabase.** It answers the Supabase addresses this server
calls (`/auth/v1/*`, `/rest/v1/rpc/*`, `/storage/v1/object/*`) over the local PostgreSQL: HS256 tokens signed with
a secret made up at start, bcrypt passwords, refresh rotation with reuse detection, real TOTP (RFC 6238, checked
against the RFC's test vectors), sessions and factors in stand-in tables, database functions run as the role in the
token with row level security on, storage rows inserted as the caller so the storage policies decide. It does not
imitate email, the dashboard settings, Vault, rate limits, table endpoints, or anything else.

## 13. What is proven, and what is not

Proven against the local stand-in (`npm run test:server`):

* 108 unit tests without a database: cookie sealing and tampering, idle timeout, absolute lifetime, secret
  rotation, refresh rotation, csrf and Origin, the memory rate limiter and lockout backoff, password rules, signed
  OAuth state and PKCE (RFC 7636 vector), webhook signatures and the replay window, the Resend adapter with mocked
  responses, the provider list and its honest states, the environment rules, the job runner, error answers.
* 319 database checks in SQL (`tests/server/sql/server_core_test.sql`): isolation between two companies for every
  function of this range, direct table access refused for every role, invitations (single use, expiry, revoke),
  the second-step and fresh-check guards, recovery codes, rate limits and lockouts, idempotency keys, the job queue
  (lock, retry, backoff, lock expiry, dead letter), connections, OAuth state, webhook events, security events
  feeding the append-only audit log, storage policies. A test of that test breaks 24 rules on purpose, one at a
  time; all 24 are noticed.
* 58 end-to-end tests through the real handlers: no sign-up, generic sign-in errors, lockout that cannot be used to
  lock a person out, invitations by email, the second step and the `aal2` gate (in the server and in SQL), recovery,
  fresh identity checks (cookie and database, each alone), sign-out and sign-out everywhere, idle timeout, refresh
  rotation and reuse, password reset and change, load and apply, the allow-list, private files, OAuth with a
  stand-in provider that enforces PKCE, single-use and tampered state, sealed tokens, refresh, disconnect, webhooks
  (bad signature, replayed id, stale time stamp), retry and dead letter, the scheduled runner, the whole stack over
  HTTP through `scripts/serve.mjs` with both address styles of the rewrites, and a search of every response for
  secrets, tokens, stack traces and database text.
* The existing database suite (`supabase/tests/rls_isolation.sql`) still passes with these migrations applied.

**Not proven:**

* Nothing was run on Supabase. Supabase Auth's real answers (error codes, the shape of the factor and
  `generate_link` answers, what the migration role may read in schema `auth`), the Data API, and the Storage service
  were imitated from their documentation. The first run against a real project must repeat the end-to-end flows.
* Nothing was run on Vercel: how a rewritten address reaches a function (both styles are handled), the cron
  header, the body size limit, the function count.
* No provider was contacted. All thirteen providers of the list have an adapter and are "tested with mocked
  provider responses" (`tests/integrations`, and for Resend `tests/server`). None was run against the provider
  itself, and no deployment has credentials for any of them: with nothing set, each one is shown as
  "not connected, not configured" and names the settings that are missing.
* The gateway functions `ws_load` and `ws_apply` used by the tests are a small stand-in. (The real ones were also
  applied together with this range and exercised by hand: load, apply with its idempotency key, the session answer
  and the second-step gate worked. That was a spot check, not a test suite.)

## 14. Connections to outside services

One adapter per provider in `api/_lib/integrations/providers/<id>.js`. The framework does everything that is the
same for all of them.

**What the framework does for an adapter beyond the common steps** (added when the twelve adapters were registered):

* `exchange(ctx, code)` receives `ctx.params`, the whole query of the provider's redirect. QuickBooks reads the
  company's realm id there.
* `status(ctx)` at connect time receives `ctx.connection`, the row already stored for this company and provider (or
  null). An adapter refuses a second sign-in that answers for another account with `wrong_account`. A refused OAuth
  sign-in leaves a working connection as it is: only a provider without tokens of its own, or a connection that
  was not working, is written as `error`.
* `webhook.challenge(request, ctx)`: `GET /api/webhooks/<id>` for a provider that checks the address first (Meta,
  WhatsApp). The right word gets the challenge back as plain text; a wrong one gets 403 and counts against the
  rejection limit of the address. Other providers keep answering GET with 405.
* `webhook.inbound(request, raw, ctx)`: message text that cannot be fetched again (WhatsApp, Twilio, Dialpad texts)
  is stored through `messaging_ingest` after the signature passed and before the event is recorded. When it cannot
  be stored the answer is `503 unavailable` and nothing is recorded, so the provider's next attempt is not taken
  for a repeat.
* `webhook.reply(v)`: the answer in the provider's own format (Twilio: an empty TwiML document) instead of JSON.
* `approval.flag` of a built adapter is part of `providerEnvNames()`, so `.env.example` must list it.

**States** (`ConnState`), always from the server:

| State | Reason | Meaning |
| --- | --- | --- |
| `not_connected` | `not_built` | no adapter yet (no provider of the list is in this state any more) |
| `not_connected` | `not_configured` | the deployment lacks a setting (`missing` names them) |
| `pending_approval` | `provider_review` | the provider has not approved this app; its `*_APPROVED` variable is not `true` |
| `setup` | `ready_to_connect` | configured, nobody connected it in this company |
| `connected` | `verified` | the provider answered a real status call for this account |
| `attention` | a code | it was connected and the last check failed |
| `reauth` | a code | the provider no longer accepts the stored tokens: connect again |
| `error` | a code | the last attempt to connect failed |

The database refuses a row that says `connected` without the time it was connected and the time a status call
last succeeded.

**OAuth, as the framework runs it.** `connect`: random state, signed, stored as a hash with the company, the provider
and the person; PKCE verifier stored sealed; the browser gets the provider address only. `callback`: the state must
verify, be found unused and unexpired (it is used up in the statement that finds it), and belong to the person
whose session makes the request; the code is exchanged server side with the verifier and the client secret; the
adapter's `status()` makes a real call; only then is the row written as connected, with the tokens sealed
(AES-256-GCM, `TOKEN_ENC_KEY`, the company and provider bound into the seal). Tokens never reach the browser.

**Webhooks.** Raw body, size limit, the adapter's signature check, a five minute replay window, the event recorded
by the provider's event id (a repeat is answered "ok" and does nothing), then a job. Only a hash of the body and a
redacted copy chosen by the adapter are stored. Rejections are logged with a hash only, at most twenty a minute per
address.

**Jobs.** `integration.refresh`, `integration.sync`, `webhook.process`, `maintenance.sweep`, `security.alerts`.
Retry waits 30 s, 1 min, 2 min, ... up to an hour; after the last attempt the job stays as `dead`
(`select public.job_requeue('<id>')` puts it back). To add scheduled work, push a function onto `hooks.tick` or
`hooks.daily` in `api/_lib/jobs/handlers.js`, or register a new kind there.

### Writing an adapter

1. Copy `providers/mock.js` (OAuth) or `providers/resend.js` (key) to `providers/<id>.js`.
2. Fill the shape:

```js
export default {
  id, name, kind: 'oauth' | 'key' | 'platform',
  env: ['...'],                      // settings that must exist; missing => not_connected / not_configured
  scopes: ['...'],                   // the least that works
  approval: null | { needed: true, flag: '<ID>_APPROVED', note },   // pending_approval until the flag is true
  authUrl(ctx),                      // ctx.state, ctx.challenge, ctx.redirectUri  -> the provider address
  async exchange(ctx, code),         // ctx.verifier  -> normaliseTokens(...)
  async refresh(ctx, tokens),        // -> normaliseTokens(raw, tokens)
  async revoke(ctx, tokens),
  async status(ctx),                 // a REAL call. { ok: true, account: { label, ref }, scopes } or { ok: false, reason }
  async health(ctx),                 // { ok: true, health: 'ok' } or { ok: false, reason, reauth? }
  async sync(ctx, what),             // ctx.cursor.get(resource) / ctx.cursor.set(resource, value)
  webhook: {
    verify(request, raw, ctx),       // { ok, eventId, type, accountRef | tenantId, redacted } or { ok: false, reason }
    async handle(ctx, event),        // event.redacted holds what verify kept; fetch details from the provider by id
  },
  actions: { async sendEmail(ctx, msg) {}, ... },
};
```

3. Use `ctx.fetch` for every call (tests replace it), `ctx.env(name)` for settings, `ctx.tokens` for the access
   token. Throw `ProviderError(code, { reauth })` with a short code; never pass a provider's message on.
4. Use the helpers: `authorizeUrl`, `tokenRequest`, `normaliseTokens` (`oauth.js`); `verifySvix`,
   `verifyTimestamped`, `hmac`, `fresh`, `parseJson` (`webhook.js`).
5. Register it in `providers/index.js`: import it, add it to `BUILT`, remove its placeholder. Add its setting names
   to `.env.example`. Register the callback address `https://<site>/api/integrations/<id>/callback` with the provider.
6. Write `tests/integrations/<id>.test.mjs` with a mocked `fetch`, as `tests/server/unit.resend.test.mjs` does.
   Report it as "tested with mocked provider responses" until real credentials exist.

Never return `ok: true` from `status()` without a call the provider answered. Never keep personal data in
`redacted`. Never log a token.

## 15. Monitoring

`app.security_events` holds failed sign-ins, lockouts, changes to the second step, role and membership changes,
protected operations, exports (when the export function calls `app.security_event`), connection changes and
rejected webhooks. Owners read their company's events through `security_events_list` and the daily counts through
`security_summary`. The hourly job `security.alerts` emails a company's owners when the last hour crossed a line
(ten failed sign-ins, any lockout, any role change, any recovery code, five exports, ten tax ID reveals, twenty
rejected webhooks, five connection errors), once per company, kind and hour, when system email is set up.
`GET /api/health?deep=1` with the cron secret shows how many jobs are waiting and how many are dead.

## 16. Public endpoints (`api/public.js`, round three)

Nobody is signed in on these routes. A request is addressed by a private link (a token the server made and emailed)
or, for the website form, by the company's form key. `api/public.js` is the ninth function.

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /api/public/sign/view` | `{ token }` | `{ ok, view }` where `view` is `signerView()` of `src/domain/esign` |
| `POST /api/public/sign/opened` | `{ token }` | `{ ok }`. The first opening is recorded once. |
| `POST /api/public/sign/submit` | `{ token, consent, typedName, signature, initials?, values }` (512 KB at most) | `{ ok, completed }`, or `409 rejected` with `reason` (`no_consent`, `no_name`, `bad_signature`, `missing_fields` with `fields`, `not_your_turn`, `expired`, `not_open`) |
| `POST /api/public/sign/decline` | `{ token, reason }` | `{ ok }` |
| `GET /api/public/sign/file?k=...` | | The PDF as sent, for a request without a page drawing. `k` is a sealed value from `view`, good for five minutes; it is not the link token. |
| `GET /api/public/review/<token>` | | `{ ok, company, firstName, job?, state: 'open', publicUrl? }` |
| `POST /api/public/review/<token>` | `{ rating: 1..5, comment }` or `{ decline: true }` | `{ ok, low?, publicUrl? }` |
| `POST /api/public/intake/<form key>` | JSON or an HTML form post: `name`, `email`, `phone`, `company`, `address`, `service`, `message`, `lang`, `consent`, `consentText`, `smsOptIn`, `idem`, and the hidden field `website` | `{ ok }` |
| `POST /api/public/office/<name>` | `{ tenant, args }` | Signed-in members only. See section 17. |

**The rules of a link** (`api/_lib/public/core.js`, table `app.public_links` of 0040 and 0041):

* 32 random bytes written as 43 URL-safe characters. Only the SHA-256 hash is stored. The server asks the database
  by hash; the token itself never goes there, and no log line in this range receives a token or its hash.
* One purpose (signing one signer's part of one request, or answering one review request), one expiry, one answer.
  The answer uses the link up. A reminder gives a signer a new link and takes the earlier one back.
* **One refusal.** Unknown, expired, used, taken back, made for the other purpose, or not shaped like a token:
  always `404 { "ok": false, "error": "cannot_be_opened", "reason": "unavailable" }`. This means the review page's
  states `answered`, `declined` and `expired` are never sent by the server: a link that was answered simply no longer
  opens. (`src/features/public/review.tsx` already shows its "unavailable" screen for that.)
* **The same request again** (a retry after a lost connection) gets the answer it got the first time and changes
  nothing: the link remembers a hash of the request that used it and the answer given.
* **Limits**, counted in the database with the memory fallback of section 2: per address and per token presented
  (a wrong token is counted exactly like a right one). Signing: 60 a minute per address and action, 30 views or 12
  answers a minute per token. Reviews: 60 per address, 30 reads and 10 answers per token. Website form: 10 in ten
  minutes per address, 240 per form.
* **Closed to other sites.** No answer carries an `Access-Control-*` header, `OPTIONS` is answered `405`, and a
  signing or review POST that names another origin (`Origin`, `Sec-Fetch-Site`) is refused with `403 bad_origin`.
  The website form is the one exception to the origin check, because it is posted from the company's own site; it
  still gives no permission to read the answer, which is why it accepts an ordinary HTML form post.
* The signer's network address is kept as a keyed hash only (`envelope_signers.extra.ipHash`, and with each
  security event). Events written: `esign.sent`, `esign.viewed`, `esign.signed`, `esign.declined`,
  `esign.completed`, `esign.reminded`, `esign.expired`, `review.answered`, `intake.lead`, `intake.duplicate`,
  `intake.key_rotated`.

New error codes: `cannot_be_opened` (404), `delivery_not_configured` (409), `busy` (503, with `retry-after`).

## 17. Signature requests on the server

**Where the rules are.** `src/domain/esign` holds them (turn order, required boxes, releasing the next signer,
completing, reminders, expiry, the signed copy). `scripts/build-server-domain.mjs` bundles that folder into
`api/_lib/domain.bundle.mjs` (esbuild, `pdf-lib` left outside); `scripts/build.mjs` runs it before every build, and
`node scripts/build-server-domain.mjs --check` says whether the file on disk is current. The file is generated and
is in the repository so the functions and the tests can import it without a build step.

**One transaction per answer, with a row lock.** The server reaches the database through function calls, each its
own transaction, so the JavaScript rules cannot run inside an open transaction. What is built instead gives the same
guarantee:

1. `sign_open(token hash)` returns the request and the length of its trail (`rev`).
2. The server runs `markViewed`, `sign` or `decline` on it.
3. `sign_commit(token hash, action, rev, new state, links, ...)` is one transaction: it locks the link row, locks
   the request row (`for update`), and writes only if the trail is still `rev` long. Otherwise it answers
   `{ conflict: true }` and the server goes back to step 1, up to six times, then `503 busy`.

Two signers submitting at the same moment both land (the second waits for the lock, is told to read again, and is
applied on top). The same token twice at once produces one signature. `app.envelope_store` can only write the state
columns of the request, its signers and its boxes, and refuses a trail that does not start with the stored one.

**Sending** (`envelope_send`). The person's token calls `envelope_send_check`, which decides whether they may send
this request and returns the facts: was the document's template approved, did the company approve its consent
sentence (a `doc_templates` row with `extra.use = 'consent'`), is there a file in the company's folder. The server
runs `sendBlockers()` on them, reads the stored PDF and takes its SHA-256 itself (the fingerprint the browser left
on the draft is not used), makes the links, **hands the emails to Resend, and only when every one was accepted**
calls `envelope_commit(..., 'sent', ...)`. Without `RESEND_API_KEY` and `SYSTEM_EMAIL_FROM` the answer is
`409 delivery_not_configured` and the request stays a draft; a provider refusal is `502 delivery_failed`, also a
draft, and the links made for the attempt open nothing because they were never stored.

**Completion.** After the last signature the server runs `buildSignedPdf()` on the stored file, uploads the result
to `<company>/signature/<random>.pdf` in the private bucket, and calls `sign_finalize`, which puts the file on the
request, records the three fingerprints (`original`, `signed`, `final`) and adds a version of kind `signed` to the
document. If that does not finish while the signer waits, the job `esign.finalize` does it (and the daily pass
picks up any that are still missing). The signer's answer is never held up by the file.

**Reminders and expiry.** The daily job `esign.sweep` runs `sweep()` of the domain on every open request that is
past its date or due a reminder. A reminder issues a new link per signer. Emails that fail are queued as
`esign.notify`, sealed with `TOKEN_ENC_KEY`: the queue never holds a token or an address in the clear.

**The three operations a member starts** live in `api/_lib/public/office.js` with the signature of `member_invite`:
`envelope_send { p_envelope }`, `envelope_remind { p_envelope }`, `review_send { p_review }`, plus the two plain
functions `intake_key_rotate` (fresh identity check) and `intake_key_state`. They are on the allow-list
(`special: 'office'` in `api/_lib/rpc-allowlist.js`) and served at `POST /api/ws/rpc/<name>` like every other
protected operation: `guard()` (configured deployment, origin and csrf, session, second step), `vx_guard`, the rate
limits `ws.rpc` and `office.<name>`, and a security event for a refusal. `api/ws.js` loads `office.js` only when one
of them runs, because the signing code brings the bundled domain rules. The earlier address
`POST /api/public/office/<name>` still answers, with the same checks, for callers written against it.

The browser side is not switched over: `SERVER_SIGNING` in `src/features/esign/prepare.ts` is still `false`. To turn
it on, a live workspace has to (1) save the draft with `source`, `pages`, `view`, `images`, `docNumber`, `docKind`
through `ws/apply`, (2) call `envelope_send`, (3) reload the request. Reminding is one call to `envelope_remind`.

## 18. Review requests

`review_send` (office): the person's token calls `review_send_check`; the server makes the link, and
`review_send_commit` stores its hash and inserts the email as a `queued` message whose text holds the placeholder
`{{link}}`. The address itself travels sealed in `messages.extra.link` and is put in when the message is handed to
the provider, then dropped. **The request stays `draft` until the provider accepted the email**; `message_mark`
turns it to `sent`. A client who opted out of email is refused in the check and again in the commit.
Only the `email` channel is built.

`review_answer`: a rating of 3 or lower creates one follow-up task (`auto = 'review-low:<id>'`, high priority, due
today, assigned to whoever sent the request). The company's public review link (`settings.reviews.publicUrl`, an
`https` address or nothing) is returned after **any** rating.

## 19. Outgoing messages

The job `messages.deliver` (`api/_lib/pipeline/deliver.js`). Every scheduled tick queues one job per `queued`
outgoing message (the key `msg:<id>` makes it one job per message for good).

1. Consent again, from the records at that moment: email never to someone with `email_opt_out`; a text only with
   `sms_opt_in` (client or lead); WhatsApp only with `whatsapp_opt_in`. Otherwise `failed` with `opted_out` or
   `no_consent`.
2. The adapter by channel, through the registry, by action name: email `gmail` (`send`) then `resend`
   (`sendEmail`), text `sms` (`send`; that adapter picks Twilio or Dialpad from `SMS_PROVIDER`), WhatsApp `whatsapp`
   (`send`), Facebook and Instagram `meta` (`sendMessage`). The adapters take different things, so `ARGS` in
   `deliver.js` maps the message to each one: the email adapters get `{ to, subject, text, idempotencyKey }`; text
   gets `{ to, text, consent, quietHours }`, WhatsApp `{ to, text, consent, lastInboundAt }`, Meta
   `{ channel, to, text, lastInboundAt }`, where the consent record of the number and the time the person last wrote
   come from `messaging_outbox_get` (0048). Those adapters refuse without the consent record, outside the reply
   window, or during quiet hours; such a refusal is written to the message with its code. Every action must return
   `{ id }`, the provider's own reference. An adapter that is missing, has no such action, or is not connected for
   this company is skipped; when none is left the message is `failed` with **`not_connected`**. Messages the server
   wrote itself (`extra.system`, today the review request) go out as system email.
   **One sender per message.** `api/_lib/jobs/messaging.js` has a job of its own for the same queued rows
   (`messaging.send`). Both would pick up one message, and that job sends the stored text without filling in the
   link of a review request, so `handlers.js` does not let its tick queue it. The kind stays registered.
3. `message_mark` writes the outcome, and only for a message that is still `queued`. `sent` is refused without a
   provider and its reference. A provider error is retried by the queue (30 s, 1 min, 2 min ...) and written to the
   message as `failed` with the error code on the last attempt.

## 20. Website lead intake

A company makes its form key in settings (`intake_key_rotate`, needs the `settings` capability and a fresh identity
check). The key is returned once; the database keeps its hash in `app.intake_forms`. Making a new one stops the old
one at once. The company's form posts to `/api/public/intake/<key>`.

Checked by the server: 16 KB at most; a name of two characters or more; an email or a phone; their shape; the hidden
field `website` (filled in means a robot: the usual `{ ok: true }`, nothing stored). `intake_submit` then, in one
transaction: the same `idem` again returns the same lead; `lead_find_duplicate` (0017) is asked, and a match gets a
note on the existing lead instead of a second one; otherwise the lead is created (`source = 'website'`, the next
ticket number of the company) and `lead_assign_next` gives it to the next person in the rotation. The consent
sentence the form showed is stored with the time and the hash of the address under `leads.extra.consent`, and a text
message opt-in counts only together with the consent box. The answer is `{ ok: true }` for a real key and an
unknown one, a new lead and a repeated one.

## 21. Scheduled jobs added in this round

| Kind | When | What |
| --- | --- | --- |
| `messages.deliver` | every tick, one per queued message | section 19 |
| `appointments.sweep` | every ten minutes | `appt_release_unpaid` (0033): releases appointments not paid by their deadline |
| `esign.sweep` | daily | expiry, reminders, signed copies still missing |
| `esign.notify`, `esign.finalize` | when needed | a signer email or a signed copy that could not be done at once |
| `vault.expire` | daily | `vault_expire` (0034) |
| `public.purge` | daily | links expired more than 90 days ago. Rate limit counters and idempotency keys are purged by the existing `maintenance.sweep` (`server_sweep`, `ws_purge_requests`). |
| `owner.summary` | daily | one email to a company's owners with counts (new leads, tasks due, appointments today, signatures waiting, reviews answered, messages that failed). No client is named, in the subject or the text. A day with nothing to report sends nothing. |

Each of these does nothing, without failing, on a database that stops before this range. Provider engineers add
their jobs in the marked block at the end of `api/_lib/jobs/handlers.js`.

**The rule engine does not run on the server.** `src/domain/rules/engine.ts` and `steps.ts` work on a whole
workspace held in memory (`DemoState`) with a `Ctx` (pack, wording, actor), and their steps call the browser's
action layer (`actions/messages`, `documents`, `leads`, `jobs`, `reviews`, `catalog`) and `@/platform/session`.
To run time-based rules from a scheduled job three things are missing: (1) a server loader that builds the
workspace of one company without a person's token (today `ws_load` is the only reader and it needs one); (2) a way
to turn what a rule changed in memory into gateway operations applied as "automation" (`ws_apply` only accepts a
person); (3) the engine without `isLive()` and the browser session. Until then time-based rules fire when someone
has the workspace open.

## 22. The database side of this round (0041 to 0045), and what is proven

| Migration | What |
| --- | --- |
| `0041_public_signing` | `app.public_links.request_hash`, `result`; `sign_open`, `sign_commit`, `sign_finalize`, `envelope_get`, `envelope_commit`, `envelopes_due`, `envelopes_unfinished` (server only); `envelope_send_check` (signed-in people) |
| `0042_public_reviews` | `review_send_check` (people); `review_send_commit`, `review_open`, `review_answer` (server only) |
| `0043_message_pipeline` | `messages_queued`, `message_get`, `message_mark` (server only) |
| `0044_lead_intake` | `app.intake_forms`; `intake_key_rotate`, `intake_key_state` (people); `intake_submit` (server only) |
| `0045_scheduled_jobs` | `owner_summary_due`, `public_links_purge` (server only) |

Run `0049_module_lockdown` again after them. No new environment variable.

Proven against the local stand-in (`npm run test:server`, and `bash supabase/tests/run_local.sh`):

* 12 unit tests (`tests/server/unit.public.test.mjs`): the token, the one refusal on every signing and review call,
  sizes, types, methods, another origin, the limits, the form fields, the hidden field, the delivery outcomes
  including `not_connected`, the sealed queue copy, the summary without names, and that no log line holds a token.
* 10 end-to-end tests (`tests/server/e2e.public.test.mjs`) on a throwaway PostgreSQL with every migration: sending
  refused without delivery, without an approved consent sentence and when the provider refuses; an ordered request
  with two signers from sending to completed, with the signed copy stored and its three fingerprints recorded and
  checked against the stored bytes; a replayed submit; two signers at once and the same token twice at once;
  unknown, misshapen, expired, used and revoked tokens answered identically; decline; expiry and reminders; the
  limits; a high and a low review; the website form (duplicate, retry, hidden field, unknown key, replaced key);
  queued messages with no provider connected; the scheduled runs.
* 68 database checks (`supabase/tests/modules/public_endpoints.test.sql`): who may call each function, stale
  writes refused, a rewritten trail refused, a signed copy outside the company's folder refused, reviews, the form.

**Not proven:** nothing ran on Supabase, Vercel or Resend (Resend's answers are mocked). The signed copy was checked
for its fingerprint, its place and its record, not looked at page by page here (the domain's own tests do that).
`envelope_remind` shares its code with the daily pass, which is tested; the route itself was not called by a test.
