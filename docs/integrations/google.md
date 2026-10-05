# Google connections

Gmail, Google Calendar, Google Meet, Google Business Profile and Google Maps.

**Status: tested with mocked provider responses; not exercised against Google.** No Google Cloud project, client,
account, Pub/Sub topic or API key exists in this build. The code follows Google's published APIs. Nothing below may be
described as working live until it has been run against Google with real credentials.

The adapters are not registered yet: `providers/index.js` still lists the five as "not built". Section 9 has the lines
that register them. Calendar and the inbound hand over also need the tables in section 8.

## 1. What each connection does

| Card | Kind | What it does | What it does not do |
| --- | --- | --- | --- |
| Gmail (`gmail`) | Google sign-in | Sends email from the connected mailbox (attachments, replies inside a thread). Lists and reads threads. Finds new inbox messages since the last run and hands over, for each, the addresses to look up (sender, recipients). | It does not look up the client or lead (the caller does, with the addresses returned). It does not change the mailbox: no labels, no read marks, no drafts, no delete. |
| Google Calendar (`gcal`) | Google sign-in | Keeps one calendar, made by this app, in the connected account. Appointments are written to it; changes made in Google come back. Duplicates are prevented, conflicts are reported. | It never reads the person's other calendars, so it does not know their busy times. |
| Google Meet (`gmeet`) | No sign-in of its own | Adds a Meet link to a calendar event. Works through the Calendar connection. | It cannot be connected unless Calendar is connected. |
| Google Business Profile (`gbp`) | Google sign-in | Lists the accounts and locations the person manages, lists reviews, replies to a review, gives the "write a review" link of a location. | No posts, no profile edits, no review notices by push. |
| Google Maps (`gmaps`) | Deployment key | Turns an address into coordinates on the server, with a daily cap per company. Builds "open in Maps" links without any call. | No map in the browser, no device location. The key never leaves the server. |

One connection per company and service. The framework stores one row per company and provider, so "each team member
connects their own mailbox or calendar" (owner's brief, sections 19 and 21) is not possible yet. It needs a change in the
framework's table and functions (a person column in the key), which is outside these files.

### States a person sees

* **Not connected, not configured**: `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` (or `GOOGLE_MAPS_API_KEY`) is missing.
* **Pending provider approval**: the service's `*_APPROVED` variable is not `true` (section 4).
* **Ready to connect**: configured and approved, nobody connected it in this company.
* **Connected**: only after Google answered a real call for that account (Gmail: the mailbox profile; Calendar and
  Business Profile: who the token belongs to, and for Business Profile also the account list; Meet: the calendar itself
  saying it allows Meet; Maps: one geocoding request for a fixed public address).
* **Connect again**: Google no longer accepts the stored token (`invalid_grant`, a 401, a removed permission).
* Reason codes specific to Google: `scope_missing` (a permission was unticked on the consent screen), `wrong_account`
  (the account is outside `GOOGLE_ALLOWED_DOMAINS`, or a later check found a different account), `no_refresh_token`,
  `no_business_account`, `access_not_granted`, `calendar_not_connected`, `calendar_reauth`, `meet_not_available`,
  `calendar_missing`, `invalid_key`, `daily_cap_reached`, `rate_limited`, `provider_down`, `provider_unreachable`.

Errors are always one of these codes. Google's own message text is never stored, logged or shown.

## 2. Scopes, and why each one

| Connection | Scope | Why |
| --- | --- | --- |
| all three sign-ins | `openid`, `email` | To learn which Google account answered, so the card can name it and a later check can tell if it changed. |
| Gmail | `https://www.googleapis.com/auth/gmail.send` | Send messages. |
| Gmail | `https://www.googleapis.com/auth/gmail.readonly` | Read threads and attachments, read the change history, and start push notices (`users.watch` needs a reading scope). `gmail.modify` is not asked for because nothing here changes the mailbox. |
| Calendar, Meet | `https://www.googleapis.com/auth/calendar.app.created` | Create one calendar and manage its events, and nothing else in the account. A Meet link is part of an event, so Meet needs no scope of its own. |
| Business Profile | `https://www.googleapis.com/auth/business.manage` | The only scope the Business Profile APIs have. |
| Maps | none (API key) | |

Each connection asks only for its own scopes (`include_granted_scopes` is left off), and each stores its own tokens.

## 3. Google Cloud setup, step by step

Do this once per deployment. VYNTEX Command and LBS Command are separate deployments: each gets its **own** Google
Cloud project, client, key and topic. Nothing is shared between them.

1. **IN: Google Cloud Console, project picker (top bar), New project.** Create one project for this deployment.
2. **IN: Google Cloud Console, APIs and Services, Library.** Enable: Gmail API, Google Calendar API, Geocoding API, and
   Cloud Pub/Sub API. For Business Profile also enable: My Business Account Management API, My Business Business
   Information API, Google My Business API (they stay unusable until Google grants access, step 9).
3. **IN: Google Cloud Console, Google Auth Platform (formerly APIs and Services, OAuth consent screen), Branding.**
   App name, support email, the app's home page, the privacy policy address and the terms address, and the authorised
   domain of the deployment. The privacy policy must say what Google data is read and what it is used for.
4. **IN: Google Auth Platform, Audience.** User type External. While the app is in "Testing", add the Google accounts
   that will try it as test users. Only test users can connect until Google has verified the app.
5. **IN: Google Auth Platform, Data access.** Add exactly the scopes of section 2.
6. **IN: Google Auth Platform, Clients, Create client.** Type "Web application". Under "Authorised redirect URIs" add
   the three callback addresses of section 5. Copy the client id and the client secret into the deployment's
   environment as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The secret goes nowhere else.
7. **Gmail push notices (optional; without them the mailbox is read every 15 minutes).**
   1. **IN: Google Cloud Console, Pub/Sub, Topics, Create topic.** Name it, for example `gmail-push`.
   2. **IN: that topic, Permissions, Add principal.** Principal `gmail-api-push@system.gserviceaccount.com`, role
      "Pub/Sub Publisher". This lets Gmail publish to the topic.
   3. **IN: Google Cloud Console, IAM and Admin, Service accounts, Create service account.** Name it, for example
      `gmail-push-caller`. It needs no roles. Pub/Sub signs each push in its name.
   4. **IN: Pub/Sub, Subscriptions, Create subscription.** Topic: the one above. Delivery type "Push". Endpoint: the
      Gmail webhook address of section 5. Tick "Enable authentication", choose the service account from the previous
      step, and set "Audience" to the same webhook address.
   5. Set `GOOGLE_PUBSUB_TOPIC` (`projects/<project id>/topics/<topic>`), `GOOGLE_PUBSUB_AUDIENCE` (the audience typed
      above), `GOOGLE_PUBSUB_SERVICE_ACCOUNT` (the service account's email) and, optionally,
      `GOOGLE_PUBSUB_SUBSCRIPTION` (`projects/<project id>/subscriptions/<name>`).
8. **Calendar push notices (optional; without them the calendar is read every 15 minutes).** Set
   `GOOGLE_CHANNEL_SECRET` to 32 or more random characters. `APP_ORIGIN` must be the public https address. Google
   requires the address that receives notices to be https with a valid certificate. Whether the domain must also be
   verified for the project (Search Console, then APIs and Services, Domain verification) is a requirement to confirm
   with Google for the current API version.
9. **Business Profile access.** Google grants access to these APIs per project, on request, to businesses with a
   verified profile. **IN: the Business Profile APIs "request access" form linked from Google's Business Profile API
   documentation**, give the project number. Until Google answers, leave `GOOGLE_GBP_APPROVED` unset.
10. **Maps key. IN: Google Cloud Console, APIs and Services, Credentials, Create credentials, API key.** Restrict it:
    "API restrictions" to the Geocoding API only. It is used from the server, so an HTTP referrer restriction does not
    apply; restrict by IP address only if the deployment has fixed outgoing addresses (Vercel functions normally do
    not). Put it in `GOOGLE_MAPS_API_KEY`. Billing must be enabled on the project for the Geocoding API. Set a daily
    quota for the API in the console as a second limit beside `GOOGLE_MAPS_DAILY_CAP`.
11. When Google has approved a service (section 4), set its flag to `true`: `GOOGLE_GMAIL_APPROVED`,
    `GOOGLE_CALENDAR_APPROVED` (also unlocks Meet), `GOOGLE_GBP_APPROVED`. During testing with test users the flag may
    be set on a staging deployment so the flow can be exercised; the production card should stay "pending approval"
    until Google's verification is complete.

## 4. Google's review: what to confirm with Google

These are requirements as Google documents them, to be confirmed with Google for this app before relying on them. No
timeline is promised here, because Google gives none that can be relied on.

| Scope | Google's category | What that requires |
| --- | --- | --- |
| `gmail.readonly` | Restricted | OAuth app verification, plus a security assessment by an assessor Google recognises (CASA), repeated periodically, because the data passes through a server. Limited use rules of the Google API Services User Data Policy apply. |
| `gmail.send` | Sensitive | OAuth app verification (brand, domain ownership, privacy policy, a written justification per scope, usually a video showing the consent flow and the use of the data). |
| `calendar.app.created` | Sensitive (confirm: Google's scope list is the authority) | OAuth app verification as above. |
| `business.manage` | Sensitive (confirm) | OAuth app verification, and separately the per-project access grant to the Business Profile APIs. |
| `openid`, `email` | Non-sensitive | Nothing beyond the consent screen. |

To prepare (owner's brief, section 69): the privacy policy and terms pages on the deployment's own domain; the domain
verified for the project; the consent screen texts; one paragraph per scope saying what is read and why (section 2 is
the basis); the list of test users; the callback addresses; a recording of connect, use and disconnect; the data
deletion path (disconnecting deletes the stored tokens; see section 7).

An unverified app shows Google's "unverified app" warning and is limited to the listed test users. The code does not
work around any of this: the card says "pending provider approval".

## 5. Addresses to register

Replace `https://<site>` with the deployment's `APP_ORIGIN`. Exact match, no trailing slash.

| What | Address | Where it is entered |
| --- | --- | --- |
| Gmail callback | `https://<site>/api/integrations/gmail/callback` | OAuth client, Authorised redirect URIs |
| Calendar callback | `https://<site>/api/integrations/gcal/callback` | OAuth client, Authorised redirect URIs |
| Business Profile callback | `https://<site>/api/integrations/gbp/callback` | OAuth client, Authorised redirect URIs |
| Gmail webhook | `https://<site>/api/webhooks/gmail` | Pub/Sub push subscription: endpoint and audience |
| Calendar webhook | `https://<site>/api/webhooks/gcal` | Nowhere: the server gives it to Google when it starts a watch channel |

Meet and Maps have no callback. Meet, Business Profile and Maps have no webhook.

## 6. How the parts behave

**Sign-in.** Authorization Code with PKCE and the framework's signed, single-use state. `access_type=offline` and
`prompt=consent` so Google returns a refresh token; a consent that returns none is refused (`no_refresh_token`). Google
does not rotate refresh tokens: a refresh returns a new access token and the stored refresh token is kept.
`GOOGLE_ALLOWED_DOMAINS` (optional, comma separated) limits which accounts may be connected; the check is made on the
account Google reports, not on the hint sent to the account chooser.

**Disconnect.** Google revokes the whole grant of an account to the app, not one token. If the same Google account is
also connected for another Google service in the company, the grant is kept (the answer says "not revoked at the
provider") and only the stored tokens of this connection are deleted. The Calendar watch channel is stopped first.

**Gmail send.** The message is built as RFC 2822 (text and HTML, attachments as base64, non ASCII names encoded). Every
header value is reduced to one line, so a subject or a name cannot add a header. Replies carry `In-Reply-To`,
`References` and the Gmail thread id. Gmail has no idempotency key: when the caller passes one, the message gets a
`Message-ID` made from it and the mailbox is first searched for that id, so a retry returns the first send. Whether
Gmail keeps a caller's `Message-ID` on send is to be confirmed against Google; without a key, a send is never repeated
after an uncertain failure.

**Gmail sync.** By history id. First run: remember the current id, import nothing. Later runs: read `history` since the
stored id (inbox, messages added), hand each new message over once, then store the new id. If Gmail no longer has that
history (404), the newest 50 inbox messages are handed over and the position restarts from now.

**Gmail push.** A Pub/Sub push is accepted only when its bearer token is a JWT signed by Google (RS256, Google's public
keys), issued by Google, made out to `GOOGLE_PUBSUB_AUDIENCE`, naming `GOOGLE_PUBSUB_SERVICE_ACCOUNT` with a verified
email, and not expired. Replay protection: the signed expiry, the Pub/Sub message id recorded once by the framework,
and the fact that a notice carries no content (a repeat can only start a sync that finds nothing new). The stored copy
holds the type, the history id and the publish time; the mailbox address is used to find the company and is not stored.

**Calendar out.** The event id is derived from the company and the local id, so a repeated insert meets Google's
"already exists" instead of making a twin. Each event carries the local id in `extendedProperties.private`. The link
table keeps the event's `etag` and both sides' last change times. Updates are sent with `If-Match`, so Google applies
them only if its copy is still the agreed one.

**Calendar in.** Incremental with a sync token; `410 Gone` clears the token and reads everything again, and the link
table keeps known events from doubling. The echo of the app's own write is recognised by its `etag` and skipped.

**Conflict rule.** If only one side changed since the last agreement, that side wins without a conflict. If both
changed, the newer `updated` time wins (a tie goes to Google) and the answer contains `conflict: { winner, loser }` with
the losing side's time and, for Google's copy, its content. The loser is never overwritten silently: the caller gets
it and decides how to show or keep it.

**Calendar push.** Google does not sign watch notices; it returns the token given when the channel was made. The token
is `v1.<company>.<HMAC-SHA256>` over the company and the channel id with `GOOGLE_CHANNEL_SECRET`, so a notice cannot be
forged or moved to another company or channel. Each message number of a channel is recorded once; a notice of an ended
channel, or of a channel that is no longer the current one, is refused or ignored. Channels last 7 days and are renewed
when under 2 days remain; the replaced channel is stopped.

**Meet.** `conferenceData.createRequest` on the event, with a request id derived from the company and the local id, so
asking twice gives the same link. When Google is still creating the conference the answer says `pending: true` and
`linkFor` reads it later.

**Business Profile.** `replyToReview` uses PUT, which replaces the reply. What is handed over for a new review is its
id, stars and time; the reviewer's name and the text stay at Google and are read on demand.

**Maps.** Each geocode counts against the company's daily cap before the call is made. The key is sent only to Google.

**Outage and rate limit.** A 5xx answer or a network failure is retried twice (after 250 ms and 750 ms) for calls that
are safe to repeat, then reported as `provider_down` or `provider_unreachable`. A 429, or a 403 with one of Google's
rate reasons, is `rate_limited` with the wait Google asked for; the job handlers queue the work again for that moment.

## 7. Data kept

| Where | What |
| --- | --- |
| `app.integration_connections` | The account's email as label, a reference, the granted scopes, the sealed tokens. |
| `app.sync_cursors` | Gmail: history id, watch end time. Calendar: calendar id, sync token, watch channel. Business Profile: time of the newest review seen. |
| `app.gcal_links` | Local id, event id, etag, last change times, a content hash. |
| `app.google_inbound` | Ids, times and, for Gmail, the email addresses to match. No subject, no body, no review text. |
| `app.webhook_events` | Type, history id or channel and message number. No address. |
| Logs | Codes and counts only. |

Disconnecting deletes the connection row with its tokens. The cursors, links and inbound rows of the company are not
removed by disconnecting today; see the gaps.

## 8. Tables this needs

Give the file the next free migration number. Applied and exercised on the local PostgreSQL stand-in (functions,
duplicate handling, permissions), not on Supabase.

```sql
-- 00NN Google connections: the calendar link map and the inbound hand over
-- Two small tables used only by the server (service role), for api/_lib/integrations/google/state.js.
--
-- app.gcal_links      which local record is which Google Calendar event, with the versions both sides had when they
--                     last agreed. Prevents duplicates and lets a conflict be seen instead of overwritten.
-- app.google_inbound  changes found at Google (a new email, a moved event, a new review). The adapters put a row here;
--                     the module that owns the records applies it. (tenant, provider, ref) is unique, so the same
--                     change arriving twice (a webhook and the daily sync, a retried job) is stored once.

create table app.gcal_links (
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  local_id        text not null check (local_id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  calendar_id     text not null check (pg_catalog.length(calendar_id) between 1 and 200),
  event_id        text not null check (pg_catalog.length(event_id) between 1 and 1024),
  etag            text check (pg_catalog.length(etag) <= 200),
  remote_updated  timestamptz,
  local_updated   timestamptz,
  hash            text check (pg_catalog.length(hash) <= 64),
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, local_id),
  unique (tenant_id, event_id)
);
alter table app.gcal_links enable row level security;
alter table app.gcal_links force row level security;
revoke all on app.gcal_links from public, anon, authenticated, service_role;

create or replace function public.gcal_link_get(p_tenant uuid, p_local text) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select pg_catalog.to_jsonb(l) from app.gcal_links l where l.tenant_id = p_tenant and l.local_id = p_local $$;

create or replace function public.gcal_link_by_event(p_tenant uuid, p_event text) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select pg_catalog.to_jsonb(l) from app.gcal_links l where l.tenant_id = p_tenant and l.event_id = p_event $$;

create or replace function public.gcal_link_put(p_tenant uuid, p_row jsonb) returns jsonb
language sql security definer
set search_path = ''
as $$
  insert into app.gcal_links as l (tenant_id, local_id, calendar_id, event_id, etag, remote_updated, local_updated, hash, updated_at)
  values (p_tenant, p_row ->> 'local_id', p_row ->> 'calendar_id', p_row ->> 'event_id', p_row ->> 'etag',
          (p_row ->> 'remote_updated')::timestamptz, (p_row ->> 'local_updated')::timestamptz, p_row ->> 'hash', pg_catalog.now())
  on conflict (tenant_id, local_id) do update set
    calendar_id = excluded.calendar_id, event_id = excluded.event_id, etag = excluded.etag,
    remote_updated = excluded.remote_updated, local_updated = excluded.local_updated, hash = excluded.hash, updated_at = pg_catalog.now()
  returning pg_catalog.to_jsonb(l)
$$;

create or replace function public.gcal_link_delete(p_tenant uuid, p_local text) returns boolean
language sql security definer
set search_path = ''
as $$ with d as (delete from app.gcal_links l where l.tenant_id = p_tenant and l.local_id = p_local returning 1) select exists (select 1 from d) $$;

create table app.google_inbound (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  provider    text not null check (provider in ('gmail', 'gcal', 'gbp')),
  kind        text not null check (kind ~ '^[a-z][a-z0-9_.]{1,40}$'),
  -- The change's own id at the provider (a message id, an event id with its version, a review id with its time).
  ref         text not null check (pg_catalog.length(ref) between 1 and 400),
  -- Ids, times and lookup input only. Message text, subjects, reviewer names and review text stay at Google.
  data        jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(data) = 'object' and pg_catalog.length(data::text) <= 8000),
  status      text not null default 'new' check (status in ('new', 'applied', 'conflict', 'ignored')),
  note        text check (note ~ '^[a-z][a-z0-9_.]{1,60}$'),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  unique (tenant_id, provider, ref)
);
create index google_inbound_new_idx on app.google_inbound (tenant_id, provider, created_at) where status = 'new';
alter table app.google_inbound enable row level security;
alter table app.google_inbound force row level security;
revoke all on app.google_inbound from public, anon, authenticated, service_role;

-- True when the change is new, false when it was already stored.
create or replace function public.google_inbound_put(p_tenant uuid, p_provider text, p_kind text, p_ref text, p_data jsonb) returns boolean
language sql security definer
set search_path = ''
as $$
  with i as (
    insert into app.google_inbound (tenant_id, provider, kind, ref, data)
    values (p_tenant, p_provider, p_kind, p_ref, coalesce(p_data, '{}'::jsonb))
    on conflict (tenant_id, provider, ref) do nothing
    returning 1)
  select exists (select 1 from i)
$$;

-- The oldest changes not handled yet, for the module that applies them.
create or replace function public.google_inbound_pending(p_tenant uuid, p_provider text, p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.created_at), '[]'::jsonb) from (
    select g.id, g.provider, g.kind, g.ref, g.data, g.created_at
    from app.google_inbound g
    where g.tenant_id = p_tenant and g.provider = p_provider and g.status = 'new'
    order by g.created_at limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

create or replace function public.google_inbound_mark(p_id uuid, p_status text, p_note text default null) returns void
language sql security definer
set search_path = ''
as $$ update app.google_inbound g set status = p_status, note = p_note, handled_at = pg_catalog.now() where g.id = p_id $$;

revoke all on function public.gcal_link_get(uuid, text), public.gcal_link_by_event(uuid, text), public.gcal_link_put(uuid, jsonb),
  public.gcal_link_delete(uuid, text), public.google_inbound_put(uuid, text, text, text, jsonb),
  public.google_inbound_pending(uuid, text, integer), public.google_inbound_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gcal_link_get(uuid, text), public.gcal_link_by_event(uuid, text), public.gcal_link_put(uuid, jsonb),
  public.gcal_link_delete(uuid, text), public.google_inbound_put(uuid, text, text, text, jsonb),
  public.google_inbound_pending(uuid, text, integer), public.google_inbound_mark(uuid, text, text) to service_role;
```

## 9. Lines to add in shared files

`api/_lib/integrations/providers/index.js`:

```js
import gmail from './gmail.js';
import gcal from './gcal.js';
import gmeet from './gmeet.js';
import gbp from './gbp.js';
import gmaps from './gmaps.js';

const BUILT = { resend, gmail, gcal, gmeet, gbp, gmaps };
// and remove the gmail, gcal, gmeet, gbp and gmaps entries from PLACEHOLDERS
```

`api/_lib/jobs/handlers.js`:

```js
import { registerGoogleJobs, googleTick, googleDaily } from './google.js';
registerGoogleJobs();
hooks.tick.push(googleTick);
hooks.daily.push(googleDaily);
```

`.env.example` (and `VARIABLES` in `api/_lib/env.js`):

| Variable | Secret | For |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | no | OAuth client of this deployment's Google Cloud project (Gmail, Calendar, Meet, Business Profile). |
| `GOOGLE_CLIENT_SECRET` | yes | Its secret. |
| `GOOGLE_GMAIL_APPROVED` | no | `true` once Google verified the app for the Gmail scopes. Until then Gmail shows "pending approval". |
| `GOOGLE_CALENDAR_APPROVED` | no | `true` once Google verified the app for the Calendar scope. Also unlocks Meet. |
| `GOOGLE_GBP_APPROVED` | no | `true` once Google granted this project access to the Business Profile APIs. |
| `GOOGLE_ALLOWED_DOMAINS` | no | Optional. Comma separated domains; only Google accounts in them may be connected. |
| `GOOGLE_PUBSUB_TOPIC` | no | Optional. `projects/<id>/topics/<name>`: where Gmail publishes change notices. Without it the mailbox is polled. |
| `GOOGLE_PUBSUB_AUDIENCE` | no | Audience set on the Pub/Sub push subscription (the Gmail webhook address). Without it Gmail notices are refused. |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | no | Email of the service account the push subscription signs with. Without it Gmail notices are refused. |
| `GOOGLE_PUBSUB_SUBSCRIPTION` | no | Optional. Full name of the subscription; when set, notices from any other are refused. |
| `GOOGLE_CHANNEL_SECRET` | yes | 32 or more random characters. Signs the token of Calendar watch channels. Without it the calendar is polled and notices are refused. |
| `GOOGLE_CALENDAR_NAME` | no | Optional. Name of the calendar created in the connected account. Default: the product name of the deployment. |
| `GOOGLE_MAPS_API_KEY` | yes | Server-side key restricted to the Geocoding API. |
| `GOOGLE_MAPS_DAILY_CAP` | no | Optional. Geocoding requests per company per day. Default 200. |

`vercel.json`: nothing. The existing `/api/integrations/*`, `/api/webhooks/*` and cron routes cover it.

## 10. Tests

```
node --test --test-concurrency=1 tests/integrations/google.*.test.mjs
```

65 tests in 6 files (Gmail 22, Calendar 20, Meet 5, Business Profile 6, Maps 6, jobs and the call helper 6), all with
a stand-in for `fetch`. They cover, per connection where it applies: connect, callback exchange, refresh on expiry,
revoked permission, wrong account, webhook valid, bad signature or token, duplicate event, provider outage with
backoff, rate limit with Retry-After, malformed payload, successful sync.

## 11. Known gaps

* Not exercised against Google. Every statement about Google's behaviour above comes from its documentation.
* Not run through the framework's endpoints end to end: that needs the registration lines of section 9.
* One connection per company and service, not per person.
* Nothing applies the rows of `app.google_inbound` yet: the appointments and communications modules have to read
  them (`google_inbound_pending`), apply them (`gcal.actions.applyInbound` gives the verdict) and mark them.
* Disconnecting does not clear the company's cursors, links or inbound rows. Reconnecting a different account would
  start from the old positions; Calendar recovers by itself (the stored calendar is not found, a new one is made),
  Gmail recovers through the "history lost" path. A cleanup on disconnect belongs in the framework.
* If two companies of one deployment connect the same mailbox, a Gmail push notice is matched to one of them only;
  the other is caught up by the 15 minute poll.
* Gmail: no drafts, no forward helper (a forward is a send with the original attachments, which the caller can build
  with `getAttachment`), no label changes, no search beyond the `q` of `listThreads`.
* Calendar: recurring events are passed through as Google sends them (the series, not each occurrence).
* Business Profile: no push notices, no posts, no profile edits. Sync reads the first account and up to 10 locations.
* Maps: the daily cap falls back to an in-memory counter when the database cannot be reached.
