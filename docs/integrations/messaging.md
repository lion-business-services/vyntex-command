# Messaging connections: Meta, WhatsApp, Dialpad, text messages, VYNTEX AI

Status of everything on this page: **tested with mocked provider responses; not exercised against the providers.**
No app, account or key of any of these providers exists in this build. A connection shows as connected only after
the provider answered a real status call, so nothing here can show as connected until real credentials are set.

Files: `api/_lib/integrations/providers/{meta,whatsapp,dialpad,sms,ai}.js`, shared code in
`api/_lib/integrations/messaging/`, background work in `api/_lib/jobs/messaging.js`, tests in `tests/integrations/`.

Run the tests: `node --test tests/integrations/meta.adapter.test.mjs tests/integrations/meta.jobs.test.mjs tests/integrations/whatsapp.adapter.test.mjs tests/integrations/dialpad.adapter.test.mjs tests/integrations/sms.adapter.test.mjs tests/integrations/ai.adapter.test.mjs`

## 1. What each one does

| Connection | Kind | What it does |
| --- | --- | --- |
| `meta` Facebook and Instagram | OAuth (Facebook Login for Business) | Connects one Facebook Page and the Instagram professional account linked to it. Publishes Page posts (text, photo) and Instagram photo posts. Receives Messenger and Instagram direct messages by webhook and answers them inside the 24 hour reply window. |
| `whatsapp` WhatsApp Business | Key (a system user token, a phone number id, a business account id) | Lists message templates with their approval state. Sends approved templates, and free text inside the 24 hour window. Receives messages and delivery reports by webhook. Downloads received files through the server. |
| `dialpad` Dialpad | OAuth, or an admin API key (`DIALPAD_AUTH_MODE`) | Lists users and numbers. Subscribes to call events and stores each finished call as one record (direction, from, to, length, outcome, voicemail reference, the team member). Reads the call log. Click to call through the API where the account allows it, otherwise a link. Text messages where the account has them. |
| `sms` Text messages | Key | One adapter, two carriers chosen by `SMS_PROVIDER`: `twilio` or `dialpad`. Consent required, STOP, START and HELP handled, quiet hours passed in by the caller, segment count, and a cost only when the provider reports one. |
| `ai` VYNTEX AI | Platform key | The model behind the assistant. Masks tax IDs, card numbers and bank numbers before a request leaves, returns token usage for metering, has a time limit and one retry, and never logs a prompt. |

### Rules every sending path follows

* **Consent.** For text and WhatsApp the caller passes the person's consent record with the message:
  `{ status: 'opted_in', channel: 'text' | 'whatsapp', address: '+1...', grantedAt, revokedAt?, expiresAt?, recordId? }`.
  Missing, revoked, expired, or for another number or channel: refused with `consent_missing`, `consent_revoked`,
  `consent_expired` or `consent_mismatch` before any call to the provider.
* **STOP.** An incoming message that is only STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT, ALTO,
  PARAR, DETENER, BAJA or CANCELAR becomes an opt-out for the store to record. START, UNSTOP, YES, INICIAR and
  COMENZAR undo an opt-out for a number that had agreed before (never create consent out of nothing). HELP, INFO and
  AYUDA are reported as `help`; the adapter sends no automatic reply, because the wording of that reply is the
  company's to write. After an opt-out the stored record is `opted_out`, and every send is refused.
* **Reply window.** Messenger, Instagram and WhatsApp allow free text for 24 hours after the person last wrote. The
  caller passes `lastInboundAt`; outside the window the send is refused with `outside_messaging_window` before any
  call. Meta's own refusal maps to the same code.
* **Templates.** A WhatsApp template is sent only when Meta shows it as approved for that language at the moment of
  sending (`template_not_approved`, `template_not_found`, `template_params_invalid` otherwise).
* **Quiet hours.** The caller passes `{ start: '21:00', end: '08:00', timeZone }` from the company's settings.
  Inside them a text is refused with `quiet_hours`; the job holds it and tries again.
* **Cost.** Segments are counted from the standard (160 or 153 characters, 70 or 67 with characters outside the basic
  alphabet). `cost` is `null` unless the provider reported a price for that message. No rate is assumed anywhere.
* **Errors are codes.** A provider's error text is never stored, logged or returned: it can name people and accounts.
* **One message, one record.** Every adapter turns its payload into the platform `Message` shape
  (`messaging/normalize.js`). The provider's id is unique per company and provider, so a repeated webhook or a sync
  after a webhook adds nothing. The adapter does not decide which client a message belongs to: it returns `match`
  (a phone number, a Page-scoped id, the Dialpad user) and the store does the lookup.

## 2. Webhook addresses

| Provider | Address to register | Signature checked |
| --- | --- | --- |
| Meta (Page and Instagram) | `https://<site>/api/webhooks/meta` | `x-hub-signature-256`: HMAC-SHA256 of the raw body with the app secret |
| WhatsApp | `https://<site>/api/webhooks/whatsapp` | the same, with the same app secret |
| Dialpad | `https://<site>/api/webhooks/dialpad?t=<company id>` (created by the adapter's `subscribeEvents`, not by hand) | the event is a JWT signed with HS256; the secret is made per company from `DIALPAD_WEBHOOK_SECRET` and the company id, so the company named in the address is proven by the signature |
| Twilio | `https://<site>/api/webhooks/sms` for incoming messages; `https://<site>/api/webhooks/sms?t=<company id>` as the status callback of each send | `X-Twilio-Signature`: HMAC-SHA1 over the full address and the sorted fields, with the auth token. The address is rebuilt from `APP_ORIGIN`. |

Callback addresses for sign-in: `https://<site>/api/integrations/meta/callback`, `https://<site>/api/integrations/dialpad/callback`.

What the webhook log keeps (the redacted copy): ids, counts, states. Never message text, names or phone numbers.
A WhatsApp message id contains the person's phone number, so the log keeps a hash of it instead.

Replay: Meta and WhatsApp bodies carry their own time; a body older than the provider's retry period is refused
(36 hours for Meta, 7 days for WhatsApp, narrower with `META_WEBHOOK_MAX_AGE_S` / `WHATSAPP_WEBHOOK_MAX_AGE_S`).
Dialpad events must be within five minutes (`DIALPAD_WEBHOOK_MAX_AGE_S` to change). Twilio's signature has no time
stamp, so a repeat is stopped by the event id only. In all cases a repeated event is recorded once.

## 3. Setup, step by step

### Facebook and Instagram

1. IN: Meta for Developers, create an app of type Business for the company that runs this deployment.
2. IN: Meta for Developers, add the products Facebook Login for Business, Messenger, Instagram and Webhooks.
3. IN: Meta for Developers, Facebook Login for Business, Settings: add the redirect address
   `https://<site>/api/integrations/meta/callback`. Optionally create a configuration and note its id.
4. IN: Meta for Developers, App settings, Basic: copy the App ID and the App Secret. Add the privacy policy
   address, the terms address and the data deletion instructions address.
5. IN: Vercel, project settings, Environment Variables: set `META_APP_ID`, `META_APP_SECRET`,
   `META_WEBHOOK_VERIFY_TOKEN` (a long random value you make up), and `META_LOGIN_CONFIG_ID` if you made a configuration.
6. IN: Meta for Developers, Webhooks: for the objects Page and Instagram, set the callback address
   `https://<site>/api/webhooks/meta` and the same verify token, then subscribe to `messages`,
   `messaging_postbacks`, `message_deliveries`, `message_reads`.
7. IN: Meta Business settings (business.facebook.com), complete Business Verification for the company.
8. IN: Meta for Developers, App Review: request advanced access for each permission in section 4 with a screen
   recording of the feature. Until approved, only people with a role on the app can connect.
9. IN: Vercel: when Meta has approved, set `META_APPROVED=true`. Until then the screen shows "Pending provider approval".
10. IN: VYNTEX Command, Integrations: Connect, sign in to Facebook, choose the Page. With more than one Page,
    choose the Page in the settings of the connection.

### WhatsApp Business

1. IN: Meta for Developers, in the same app, add the product WhatsApp.
2. IN: WhatsApp Manager (business.facebook.com, WhatsApp accounts), add the business phone number, verify it, and
   set the display name. Note the Phone number ID and the WhatsApp Business Account ID.
3. IN: Meta Business settings, Users, System users: create a system user, give it the WhatsApp account as an asset
   with full control, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. IN: Vercel: set `META_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (a random value), `WHATSAPP_SYSTEM_USER_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`.
5. IN: Meta for Developers, WhatsApp, Configuration: set the callback address `https://<site>/api/webhooks/whatsapp`
   and the verify token, and subscribe to the field `messages`.
6. IN: WhatsApp Manager, Message templates: create each template and wait for its approval. Only approved templates
   can be sent outside the 24 hour window.
7. IN: Vercel: set `WHATSAPP_APPROVED=true` once the business is verified and the number is live.
8. IN: VYNTEX Command, Integrations: Connect. The server checks the number with Meta and records the result.

### Dialpad

1. Decide the mode. The account's Dialpad plan decides what is available: listing calls, call events, starting a
   call through the API and text messages are each granted (or not) by Dialpad for the account. The adapter does
   not assume any of them: what Dialpad refuses comes back as `not_allowed` or `plan_not_supported`.
2. OAuth mode (several companies, each signs in): IN: Dialpad, ask Dialpad for an OAuth app (client id and secret)
   with the redirect address `https://<site>/api/integrations/dialpad/callback` and the scopes in section 4.
   IN: Vercel: set `DIALPAD_CLIENT_ID`, `DIALPAD_CLIENT_SECRET`, `DIALPAD_WEBHOOK_SECRET` (a long random value), and
   `DIALPAD_APPROVED=true` once Dialpad has approved the app.
3. API key mode (one company, its own account): IN: Dialpad Admin, Admin settings, My company, Authentication, API keys:
   create a key. IN: Vercel: set `DIALPAD_AUTH_MODE=api_key`, `DIALPAD_API_KEY`, `DIALPAD_WEBHOOK_SECRET`.
4. Text messages through Dialpad: IN: Vercel: set `DIALPAD_SMS_ENABLED=true`. The content of text events is a
   separate permission that Dialpad grants.
5. IN: VYNTEX Command, Integrations: Connect. Then "Subscribe to call events" (the adapter's `subscribeEvents`),
   which creates the webhook and the subscription at Dialpad for this company.
6. Test first against Dialpad's sandbox with `DIALPAD_ENVIRONMENT=sandbox`.

### Text messages

1. IN: Vercel: set `SMS_PROVIDER` to `twilio` or `dialpad`, and `SMS_FROM_NUMBER` (the company's sending number).
2. Twilio: IN: Twilio Console, copy the Account SID and Auth Token; buy or port the number; register the sender with
   the carriers (see section 4). IN: Vercel: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and optionally
   `TWILIO_MESSAGING_SERVICE_SID`. IN: Twilio Console, on the number (or the messaging service), set "A message
   comes in" to `https://<site>/api/webhooks/sms`, method POST.
3. Dialpad: connect Dialpad first (above). The sending number must be one of the account's numbers.
4. IN: Vercel: set `SMS_APPROVED=true` once the sender registration is approved.
5. IN: VYNTEX Command, Integrations: Connect.

### VYNTEX AI

1. IN: Anthropic Console, create an API key for this deployment.
2. IN: Vercel: set `ANTHROPIC_API_KEY`, and `ASSISTANT_MODEL` to the model id to use.
3. IN: VYNTEX Command, Integrations: Connect. The server asks the provider for that model; a key that may not use
   it shows as `model_not_found`.

## 4. What needs the provider's review

These are requirements to confirm with each provider before launch. Nothing here states how long a review takes.

| Provider | What is reviewed | What the app asks for |
| --- | --- | --- |
| Meta | App Review for each permission, and Business Verification of the company | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_messaging`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`, `business_management`. The human agent tag (answers up to 7 days after the person wrote) is a separate permission, `human_agent`. |
| WhatsApp | Business Verification, the display name of the number, and each message template | `whatsapp_business_messaging`, `whatsapp_business_management` |
| Dialpad | The OAuth app and its scopes; text message content | `calls:list`, `offline_access`; `message_content_export` when text messages are enabled |
| Text messages | Registration of the sender and the kinds of messages with the phone carriers (in the United States: 10DLC brand and campaign registration, or toll-free verification) | |
| Anthropic | Nothing to review | |

Prepare for the reviews: a public privacy policy that names each of these services and what is shared with it, a
data deletion address, the callback addresses above, a test user, and a short recording of each feature.

## 5. Environment variables

| Variable | For | Secret |
| --- | --- | --- |
| `META_APP_ID` | Meta app id | no |
| `META_APP_SECRET` | Meta app secret: token exchange, and the signature of Meta and WhatsApp webhooks | yes |
| `META_WEBHOOK_VERIFY_TOKEN` | The value typed into Meta's webhook form for Page and Instagram | yes |
| `META_APPROVED` | `true` once App Review and Business Verification are done | no |
| `META_LOGIN_CONFIG_ID` | Optional. Facebook Login for Business configuration id | no |
| `META_GRAPH_VERSION` | Optional. Graph API version, for example `v23.0` (the default) | no |
| `META_WEBHOOK_MAX_AGE_S` | Optional. Oldest accepted Meta webhook body, in seconds (default 129600) | no |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | The value typed into the WhatsApp webhook form | yes |
| `WHATSAPP_SYSTEM_USER_TOKEN` | Token of the system user | yes |
| `WHATSAPP_PHONE_NUMBER_ID` | The number messages are sent from | no |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | The WhatsApp Business account that owns the number and the templates | no |
| `WHATSAPP_APPROVED` | `true` once the business is verified and the number is live | no |
| `WHATSAPP_WEBHOOK_MAX_AGE_S` | Optional. Oldest accepted WhatsApp webhook body, in seconds (default 604800) | no |
| `DIALPAD_AUTH_MODE` | `oauth` (default) or `api_key` | no |
| `DIALPAD_CLIENT_ID`, `DIALPAD_CLIENT_SECRET` | OAuth mode | secret: yes |
| `DIALPAD_API_KEY` | API key mode | yes |
| `DIALPAD_WEBHOOK_SECRET` | The value each company's webhook secret is made from | yes |
| `DIALPAD_APPROVED` | OAuth mode: `true` once Dialpad approved the app | no |
| `DIALPAD_ENVIRONMENT` | Optional. `sandbox` to use sandbox.dialpad.com | no |
| `DIALPAD_SMS_ENABLED` | Optional. `true` to ask for text events and the text content scope | no |
| `DIALPAD_WEBHOOK_MAX_AGE_S` | Optional. Oldest accepted Dialpad event, in seconds (default 300) | no |
| `SMS_PROVIDER` | `twilio` or `dialpad` | no |
| `SMS_FROM_NUMBER` | The sending number, E.164 | no |
| `SMS_APPROVED` | `true` once the sender registration is approved | no |
| `TWILIO_ACCOUNT_SID` | Twilio account | no |
| `TWILIO_AUTH_TOKEN` | Twilio auth token: API calls and the webhook signature | yes |
| `TWILIO_MESSAGING_SERVICE_SID` | Optional. Send through a messaging service instead of one number | no |
| `ANTHROPIC_API_KEY` | The model provider's key | yes |
| `ASSISTANT_MODEL` | Model id | no |
| `AI_TIMEOUT_MS` | Optional. Time limit of one model call (default 25000) | no |

## 6. How other code calls the adapters

```js
import { getAdapter } from './_lib/integrations/providers/index.js';
import { connectionCtx, makeCtx } from './_lib/integrations/core.js';

// A text message (the consent record comes from the company's records; the adapter refuses without it).
const sms = await getAdapter('sms');
const sent = await sms.actions.send(await connectionCtx(sms, tenantId), { to, text, consent, quietHours, statusCallback: `${origin}/api/webhooks/sms?t=${tenantId}` });
// sent: { id, status, backend, segments, segmentsSource, cost, message, match, extra }

// The assistant (api/assistant.js): replace its own fetch with this. No connection row is needed.
import ai from './_lib/integrations/providers/ai.js';
const out = await ai.actions.complete(makeCtx(ai, {}), { system: systemPrompt(input.lang, input.data), messages: input.messages, tools: TOOLS, maxTokens: MAX_OUTPUT_TOKENS });
// out: { text, toolCalls: [{ id, name, input }], stopReason, model, usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, redactions, attempts }
// Errors are ProviderError with .code: rate_limited and overloaded -> 429 busy; provider_timeout -> 504; anything else -> 502.
```

Click to call: `dialpad.actions.clickToCall(ctx, { to, userId })` answers `{ placed: true, mode: 'api' }` or
`{ placed: false, deepLink: true, link: 'dialpad://+1...', tel: 'tel:+1...', reason }`. A link is never a placed call.

## 7. Known limits

* Key connections (`whatsapp`, `sms`, `dialpad` in API key mode, `ai`) read their credentials from the deployment's
  settings, because the framework's connect step takes no credentials from a person. One deployment therefore has
  one WhatsApp number, one text sender and (in API key mode) one Dialpad account. That fits LBS Command. For several
  companies on VYNTEX Command, the connect step must accept and seal per-company credentials; the WhatsApp adapter
  already reads them from the connection when they are there.
* Incoming WhatsApp, Twilio and Dialpad text messages are stored only when `api/webhooks.js` calls `ingestInbound`
  (three lines, in the report). Without that call the signature is checked and the event is logged, but the text
  is not stored, because these providers offer no way to read a message again by id.
* Meta's webhook verification needs `api/webhooks.js` to answer GET with the adapter's `challenge`.
* Photos for social posts: a provider needs the bytes or an address it can fetch. The job has a place for that
  (`deps.media` in `api/_lib/jobs/messaging.js`) and nothing behind it yet, so a scheduled post with a picture fails
  with `media_unavailable`. Instagram accepts no text-only post.
* Segments and cost come back from the adapter with every send. The messages table has no column for them yet.
* Queued WhatsApp messages go out as free text. A queued template send needs a place on the message for the
  template name and its parameters.
* The redaction in the AI adapter masks by shape. It can mask a harmless number that looks like a tax ID or an
  account number (for example a 13 digit time stamp), and it cannot recognise a tax ID written in words.

## 8. Database (to add as a migration)

Proven on a throwaway local PostgreSQL 16 with every current migration applied first: the file applies,
`app.lockdown_check()` passes, and a script exercised each function (an incoming message stored once and matched
to the only client with that number, STOP then START, delivery reports out of order, a post published once, the
Instagram id finding the Meta connection, no privilege for a signed-in person). Not run: the repository's own
database test suite with this file in place.

```sql
-- NNNN Messaging: consent per number, the writer of incoming messages, the outbox reader, scheduled posts
-- (the brief, sections 27 to 32). Used by api/_lib/integrations/messaging/ingest.js and api/_lib/jobs/messaging.js.
--
--   messaging_consents   the current answer to "may this company text or WhatsApp this number?". One row per
--                        company, channel and number. The evidence of an opt-in stays in consent_records; this row
--                        is the switch the sending path reads, and the row a STOP turns off.
-- A person reads these rows (capability "comms"). Nobody writes them directly: an opt-out is a fact reported by a
-- provider, so the server writes it, the same rule as the delivery states of messages (0013).

create table public.messaging_consents (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  channel            text not null check (channel in ('text', 'whatsapp')),
  -- E.164, for example +15555550100.
  address            text not null check (address ~ '^\+[1-9][0-9]{7,14}$'),
  status             text not null check (status in ('opted_in', 'opted_out')),
  -- Where the current status came from: a form the person filled in, a team member, a STOP or START word, the
  -- provider's own block list, or an import.
  source             text not null check (source in ('form', 'staff', 'keyword', 'provider', 'import')),
  client_id          uuid,
  -- The record of what the person agreed to (consent_records), when there is one.
  consent_record_id  uuid,
  granted_at         timestamptz,
  revoked_at         timestamptz,
  expires_at         timestamptz,
  extra              jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, channel, address),
  constraint messaging_consents_state check (
    (status = 'opted_in' and granted_at is not null and revoked_at is null) or (status = 'opted_out' and revoked_at is not null)),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, consent_record_id) references public.consent_records (tenant_id, id) on delete restrict
);
create index messaging_consents_client_idx on public.messaging_consents (tenant_id, client_id);
create index messaging_consents_record_idx on public.messaging_consents (tenant_id, consent_record_id);
select app.module_table('messaging_consents', 'select');

create policy messaging_consents_select on public.messaging_consents for select to authenticated
  using (tenant_id = any ((select app.tenants_can('comms'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));

-- Queued outgoing messages waiting for the job, oldest first.
create index messages_outbox_idx on public.messages (at) where status = 'queued' and external_id is null;

-- A phone number as E.164, or null. Ten digits are read as a North American number (the same rule as the server).
create or replace function app.e164(p text) returns text
language sql immutable
set search_path = ''
as $$
  select case
    when x.d = '' then null
    when pg_catalog.btrim(p) like '+%' and pg_catalog.length(x.d) between 8 and 15 then '+' || x.d
    when pg_catalog.length(x.d) = 10 then '+1' || x.d
    when pg_catalog.length(x.d) between 11 and 15 then '+' || x.d
    else null
  end
  from (select pg_catalog.regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
revoke all on function app.e164(text) from public, anon, authenticated, service_role;

-- ---- Server only (service role). SECURITY DEFINER because these run from a webhook or a job, with nobody signed
-- ---- in, and write states a person may not write (received, sent, delivered, failed, opted out).

-- Stores what a provider delivered: messages (once per provider id), delivery reports, STOP and START words.
create or replace function public.messaging_ingest(p_tenant uuid, p_provider text, p_batch jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  it jsonb;
  m jsonb;
  v_client uuid;
  v_key text;
  v_addr text;
  v_at timestamptz;
  v_rows integer;
  n_msg integer := 0;
  n_status integer := 0;
  n_consent integer := 0;
begin
  for it in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'messages', '[]'::jsonb)) e loop
    m := it -> 'message';
    if m is null or coalesce(m ->> 'externalId', '') = '' then continue; end if;
    v_client := null;
    v_key := it #>> '{match,phoneKey}';
    if v_key ~ '^[0-9]{10}$' then
      -- Only when exactly one client has this number. Two clients sharing a phone are left for a person to decide.
      select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(c.id))[1] end into v_client
      from public.clients c
      where c.tenant_id = p_tenant and pg_catalog.right(pg_catalog.regexp_replace(c.phone, '\D', '', 'g'), 10) = v_key;
    end if;
    insert into public.messages (tenant_id, at, channel, recipient, subject, body, status, dir, sender, thread_id, client_id, read, provider, external_id, seconds, error)
    values (p_tenant, coalesce((m ->> 'at')::timestamptz, pg_catalog.now()), m ->> 'channel', coalesce(m ->> 'to', ''), coalesce(m ->> 'subject', ''),
            coalesce(m ->> 'body', ''), m ->> 'status', m ->> 'dir', pg_catalog.left(m ->> 'from', 320), pg_catalog.left(m ->> 'threadId', 200), v_client,
            case when m ->> 'dir' = 'in' then false end, p_provider, pg_catalog.left(m ->> 'externalId', 300), (m ->> 'seconds')::integer, pg_catalog.left(m ->> 'error', 1000))
    on conflict (tenant_id, provider, external_id) where external_id is not null do nothing;
    get diagnostics v_rows = row_count;
    n_msg := n_msg + v_rows;
  end loop;

  for it in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'statuses', '[]'::jsonb)) e loop
    -- A state only moves forward: queued, sent, failed, delivered. A late "sent" does not undo a "delivered".
    update public.messages x
    set status = it ->> 'status',
        error = case when it ->> 'status' = 'failed' then pg_catalog.left(it ->> 'error', 1000) else null end
    where x.tenant_id = p_tenant and x.external_id = it ->> 'externalId'
      -- a text sent by the text adapter is reported on by the company that carried it
      and x.provider in (p_provider, case when p_provider = 'dialpad' then 'sms' else p_provider end)
      and x.dir is distinct from 'in'
      and it ->> 'status' in ('sent', 'delivered', 'failed')
      and (case x.status when 'queued' then 1 when 'sent' then 2 when 'failed' then 3 when 'delivered' then 4 else 9 end)
        < (case it ->> 'status' when 'sent' then 2 when 'failed' then 3 else 4 end);
    get diagnostics v_rows = row_count;
    n_status := n_status + v_rows;
  end loop;

  for it in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'consent', '[]'::jsonb)) e loop
    v_addr := app.e164(it ->> 'address');
    if v_addr is null or coalesce(it ->> 'channel', '') not in ('text', 'whatsapp') then continue; end if;
    v_at := coalesce((it ->> 'at')::timestamptz, pg_catalog.now());
    if it ->> 'action' = 'opt_out' then
      insert into public.messaging_consents as c (tenant_id, channel, address, status, source, revoked_at)
      values (p_tenant, it ->> 'channel', v_addr, 'opted_out', case when it ->> 'source' = 'provider' then 'provider' else 'keyword' end, v_at)
      on conflict (tenant_id, channel, address) do update
        set status = 'opted_out', source = excluded.source, revoked_at = excluded.revoked_at
        where c.status <> 'opted_out';
      get diagnostics v_rows = row_count;
      n_consent := n_consent + v_rows;
    elsif it ->> 'action' = 'opt_in' then
      -- START undoes a STOP for a number that had agreed before. It never creates consent out of nothing: a first
      -- opt-in needs a record of what the person agreed to.
      update public.messaging_consents c
      set status = 'opted_in', source = 'keyword', granted_at = v_at, revoked_at = null
      where c.tenant_id = p_tenant and c.channel = it ->> 'channel' and c.address = v_addr
        and c.status = 'opted_out' and c.source in ('keyword', 'provider') and c.granted_at is not null;
      get diagnostics v_rows = row_count;
      n_consent := n_consent + v_rows;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('messages', n_msg, 'statuses', n_status, 'consent', n_consent);
end
$$;

-- What the sending job needs for one queued message: the message, the consent of its recipient as it is now, and
-- when that person last wrote on the same thread.
create or replace function public.messaging_outbox_get(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'message', pg_catalog.jsonb_build_object('id', m.id, 'channel', m.channel, 'to', m.recipient, 'subject', m.subject, 'body', m.body,
                                             'status', m.status, 'externalId', m.external_id, 'threadId', m.thread_id),
    'consent', (select pg_catalog.jsonb_build_object('status', c.status, 'channel', c.channel, 'address', c.address, 'grantedAt', c.granted_at,
                                                     'revokedAt', c.revoked_at, 'expiresAt', c.expires_at, 'recordId', c.consent_record_id)
                from public.messaging_consents c
                where c.tenant_id = m.tenant_id and c.channel = m.channel and c.address = app.e164(m.recipient)),
    'lastInboundAt', (select pg_catalog.max(i.at) from public.messages i
                      where i.tenant_id = m.tenant_id and i.channel = m.channel and i.dir = 'in' and i.thread_id is not null and i.thread_id = m.thread_id),
    'quietHours', null)
  from public.messages m
  where m.tenant_id = p_tenant and m.id = p_id
$$;

-- Writes the outcome of a send. Only a message that is still queued can be changed, so a second call does nothing.
create or replace function public.messaging_send_result(p_tenant uuid, p_id uuid, p_status text, p_external_id text, p_error text, p_meta jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('queued', 'sent', 'failed') then raise exception 'unknown status' using errcode = '22023'; end if;
  update public.messages m
  set status = p_status,
      external_id = coalesce(pg_catalog.left(p_external_id, 300), m.external_id),
      error = case when p_status = 'failed' then pg_catalog.left(p_error, 1000) end,
      provider = coalesce(m.provider, case m.channel when 'text' then 'sms' when 'whatsapp' then 'whatsapp' when 'facebook' then 'meta' when 'instagram' then 'meta' end)
  where m.tenant_id = p_tenant and m.id = p_id and m.status = 'queued' and m.external_id is null and m.dir is distinct from 'in';
  return found;
end
$$;

-- Queued messages no provider has yet (for the scheduled run), oldest first.
create or replace function public.messaging_outbox_due(p_limit integer default 100) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id)), '[]'::jsonb)
  from (
    select m.id, m.tenant_id from public.messages m
    where m.status = 'queued' and m.external_id is null and m.dir is distinct from 'in' and m.channel in ('text', 'whatsapp', 'facebook', 'instagram')
    order by m.at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x
$$;

-- Scheduled posts whose time has come.
create or replace function public.social_posts_due(p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id, 'scheduled_for', x.scheduled_for)), '[]'::jsonb)
  from (
    select p.id, p.tenant_id, p.scheduled_for from public.social_posts p
    where p.status = 'scheduled' and p.scheduled_for <= pg_catalog.now()
    order by p.scheduled_for
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

-- One post for the publishing job. "published" holds the provider id of each channel that already went out.
create or replace function public.social_post_claim(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('id', p.id, 'status', case when p.status = 'scheduled' and p.scheduled_for > pg_catalog.now() then 'waiting' else p.status end,
    'text', p.text, 'media', p.media, 'channels', pg_catalog.to_jsonb(p.channels), 'published', coalesce(p.extra -> 'published', '{}'::jsonb))
  from public.social_posts p
  where p.tenant_id = p_tenant and p.id = p_id
$$;

-- Writes the outcome of publishing. "scheduled" keeps the post waiting and records the channels done so far.
create or replace function public.social_post_result(p_tenant uuid, p_id uuid, p_status text, p_error text, p_published jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('scheduled', 'published', 'failed') then raise exception 'unknown status' using errcode = '22023'; end if;
  update public.social_posts p
  set status = p_status,
      error = case when p_status = 'failed' then pg_catalog.left(p_error, 1000) end,
      published_at = case when p_status = 'published' then pg_catalog.now() else p.published_at end,
      extra = pg_catalog.jsonb_set(p.extra, '{published}', case when pg_catalog.jsonb_typeof(p_published) = 'object' then p_published else '{}'::jsonb end)
  where p.tenant_id = p_tenant and p.id = p_id and p.status = 'scheduled';
  return found;
end
$$;

-- An Instagram webhook names the Instagram account, not the Page the connection was verified for. The Meta adapter
-- keeps that id in the connection settings (ig_account_id), so the lookup accepts it. Otherwise as in 0026.
create or replace function public.conn_by_account(p_provider text, p_account_ref text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'state', c.state)
  from app.integration_connections c
  where c.provider = p_provider and c.state in ('connected', 'attention')
    and (c.account_ref = p_account_ref or (p_provider = 'meta' and c.settings ->> 'ig_account_id' = p_account_ref))
  order by c.connected_at desc nulls last
  limit 1
$$;

revoke all on function public.messaging_ingest(uuid, text, jsonb), public.messaging_outbox_get(uuid, uuid),
  public.messaging_send_result(uuid, uuid, text, text, text, jsonb), public.messaging_outbox_due(integer),
  public.social_posts_due(integer), public.social_post_claim(uuid, uuid), public.social_post_result(uuid, uuid, text, text, jsonb),
  public.conn_by_account(text, text) from public, anon, authenticated;
grant execute on function public.messaging_ingest(uuid, text, jsonb), public.messaging_outbox_get(uuid, uuid),
  public.messaging_send_result(uuid, uuid, text, text, text, jsonb), public.messaging_outbox_due(integer),
  public.social_posts_due(integer), public.social_post_claim(uuid, uuid), public.social_post_result(uuid, uuid, text, text, jsonb),
  public.conn_by_account(text, text) to service_role;

select app.lockdown_check();
```
