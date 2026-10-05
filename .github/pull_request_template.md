## What this changes

<!-- One or two plain sentences. What a user or an operator will notice. -->

## How it was checked

<!-- The commands you ran and what they printed (counts, not "it works"). Say what was NOT checked. -->

## Security checklist

Tick what applies. Leave a line unticked and say why if it does not hold. "Not applicable" is a fine answer.

**Data and access**
- [ ] No real client, staff or customer data is in this change: sample records are fictional (example.com emails, 555 phone numbers) and labelled as samples.
- [ ] No full tax ID anywhere: not in code, tests, logs, URLs or browser storage. Type and last four digits only.
- [ ] Every new table has `tenant_id`, row level security enabled and forced, and policies written against `app.can()`.
- [ ] Every new database function has a fixed `search_path`, is not executable by `anon` (unless it is a token-addressed public function with a rate limit), and checks the caller's capability itself.
- [ ] What a role may not do is refused by the server or the database, not only hidden on the screen.
- [ ] Sensitive actions (reveal, export, role change, payment change, deletion) write an audit entry, and the entry holds no secret value.

**Secrets and configuration**
- [ ] No key, token or password in the change. New settings are read from environment variables on the server and are listed in `.env.example` with no value.
- [ ] Nothing secret reaches the browser bundle, a log line or an error message.
- [ ] `vercel.json` headers are unchanged, or the change is explained below (`node scripts/security/check-headers.mjs` passes).

**Integrations**
- [ ] Webhooks verify the provider's signature and ignore repeats.
- [ ] A connection is never shown as connected, and a message never as sent, unless the provider confirmed it.

**Checks run**
- [ ] `npm run typecheck` and `npm run check`
- [ ] `node --test "tests/security/*.test.mjs"` (secret scan, personal data scan, header check, their tests)
- [ ] `npm run test:db` when `supabase/` changed
- [ ] Both builds (`node scripts/build.mjs` and `node scripts/build.mjs --deploy lbs`) and the bundle scan when `src/` changed

## Deployment notes

<!-- New environment variables (names only), migrations to apply and in what order, anything to do by hand. Write "none" if none. -->
