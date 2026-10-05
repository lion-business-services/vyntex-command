# Square and QuickBooks Online

**Status: tested with mocked provider responses; not exercised against Square or Intuit.** No credentials exist in
this build. The code follows the public documentation of both providers as the author knew it; every address, field
name and limit below must be confirmed in a sandbox before anyone relies on it. Nothing here makes a connection
show as connected: only a real answer from the provider does.

These two connections are for the money a company takes from its own clients and for that company's own books.
They have nothing to do with what VYNTEX charges its customers for the platform. The two ledgers are separate.

Code: `api/_lib/integrations/providers/square.js`, `providers/quickbooks.js`, the rules in
`api/_lib/integrations/finance/` (pure, no database, no network), jobs in `api/_lib/jobs/finance.js`.
Tests: `tests/integrations/square.*.test.mjs`, `tests/integrations/quickbooks.*.test.mjs`.

## 1. What each one does

### Square

| Part | What happens | What never happens |
| --- | --- | --- |
| Connect | OAuth on Square's page. The server exchanges the code. `connected` only after Square answers "which merchant is this token for". The card says `(sandbox)` or `(production)` next to the business name. | A token in the browser. A connection marked connected without Square's answer. |
| Customers | Read from Square and matched to clients: the stored Square id, then the email, then the phone. A match becomes a link. | A local name, email or phone replaced by Square's. A difference is listed as "needs review" by field name only. |
| Catalog, in | Square items arrive as proposals: link to a service with the same name, or a new service to approve. | A catalog row written by the sync. A local price changed because Square has another. |
| Catalog, out | Insert only. A service Square does not have yet is created there with an idempotency key. | An update or a delete of anything that exists at Square. What would be an update is reported and not sent. |
| Payments | `payment.updated`, `invoice.payment_made` and an hourly check. Each payment is recorded once, by its Square payment id, against the record the rules name. | A payment counted twice. A payment placed by guessing. |
| Refunds | Read only. A refund Square reports lowers what its payment's record has received. | A refund issued from this platform. A local payment mark rewritten by a refund. |
| Payment link | A Square checkout page for what one appointment still owes. | A card field on this platform. Card numbers, brands, last four digits or fingerprints stored or logged. |

### QuickBooks Online

| Part | What happens | What never happens |
| --- | --- | --- |
| Connect | Intuit OAuth 2 for one QuickBooks company (its realm id). `connected` only after QuickBooks answers with that company's information. The card says `(sandbox)` or `(production)`. | A connection to a company the token was not issued for: QuickBooks refuses it and the card says wrong account. |
| Tokens | Intuit replaces the refresh token on refresh. The new pair is stored at once, sealed, with the realm id. | A refresh token reused after it was replaced. |
| Customers | Read and matched like Square's. A customer is created in QuickBooks only for a client a person approved for it. | A customer created by a sync. |
| Invoices | Sent from an engagement, once, with a `requestid`. When the local figures change later, one update goes out carrying the SyncToken stored at the last send. | A forced update. When QuickBooks holds a newer version the record becomes "conflict" and nothing more is sent until a person decides. |
| Payments | Sent once against the pushed invoice, with a `requestid`. | A sent payment changed. |
| Changes | Change data capture from a stored moment. A linked record whose SyncToken moved, or that was deleted in QuickBooks, becomes "conflict". | The stored SyncToken moved forward to make a later update pass. |
| Audit | Every write, refusal and conflict leaves a row with the request id and the outcome, and an entry in the company's audit log. | |

## 2. Setup, sandbox first

Do everything in the sandbox of each provider before production. Production transactions are never used for testing.

### Square

1. IN: Square Developer Dashboard, create an application. Open its **Sandbox** credentials.
2. IN: Square Developer Dashboard, OAuth page (Sandbox), set the redirect URL to
   `https://<site>/api/integrations/square/callback`, exactly.
3. IN: Square Developer Dashboard, Webhooks (Sandbox), add a subscription to
   `https://<site>/api/webhooks/square` for the events `payment.updated`, `invoice.payment_made` and
   `refund.updated` (`payment.created` and `refund.created` are also understood). Copy its signature key.
4. IN: Vercel, the project's environment variables, set `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`,
   `SQUARE_ENVIRONMENT=sandbox`, `SQUARE_WEBHOOK_SIGNATURE_KEY`. Set them separately in each deployment (VYNTEX
   Command and LBS Command share nothing).
5. IN: VYNTEX Command, Integrations, connect Square with a sandbox seller account. The card must read
   `<business name> (sandbox)`.
6. IN: Square Developer Dashboard, send test events and take sandbox payments. Check the payment appears once.

### QuickBooks Online

1. IN: Intuit Developer, create an app with the scope `com.intuit.quickbooks.accounting`. Use its **Development**
   keys and a sandbox company.
2. IN: Intuit Developer, Keys and OAuth, add the redirect URI `https://<site>/api/integrations/quickbooks/callback`.
3. IN: Intuit Developer, Webhooks, set the endpoint `https://<site>/api/webhooks/quickbooks` for Customer, Invoice
   and Payment. Copy the verifier token.
4. IN: Vercel, the project's environment variables, set `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`,
   `QUICKBOOKS_ENVIRONMENT=sandbox`, `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`, and `QUICKBOOKS_APPROVED=true` (the card
   shows "provider approval pending" until this is true).
5. IN: VYNTEX Command, Integrations, connect QuickBooks and choose the sandbox company. The card must read
   `<company name> (sandbox)`.

### Environment variables

| Variable | Secret | Meaning |
| --- | --- | --- |
| `SQUARE_APPLICATION_ID` | no | The Square application id (the sandbox one starts with `sandbox-`). |
| `SQUARE_APPLICATION_SECRET` | yes | The application secret. Used for the code exchange, the refresh and the revoke call. |
| `SQUARE_ENVIRONMENT` | no | `sandbox` or `production`. No default: any other value stops every Square call with `environment_invalid`. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | yes | The signature key of the webhook subscription. |
| `SQUARE_WEBHOOK_URL` | no | Optional. The notification address exactly as registered at Square, when it is not `APP_ORIGIN` + `/api/webhooks/square`. The signature covers this address. |
| `SQUARE_OAUTH_FLOW` | no | Optional. `code` (default: the exchange is authenticated with the secret) or `pkce` (Square's flow without a secret: challenge and verifier, refresh tokens rotate). |
| `SQUARE_API_VERSION` | no | Optional. The `Square-Version` date sent with every call. Default `2025-01-23`. |
| `SQUARE_EXPECTED_MERCHANT_ID` | no | Optional. A deployment that serves one company (LBS Command) can name the only Square merchant it accepts. |
| `QUICKBOOKS_CLIENT_ID` | no | The Intuit app's client id (development or production keys). |
| `QUICKBOOKS_CLIENT_SECRET` | yes | The client secret. |
| `QUICKBOOKS_ENVIRONMENT` | no | `sandbox` or `production`. No default. |
| `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN` | yes | The verifier token of the app's webhooks. |
| `QUICKBOOKS_APPROVED` | no | `true` once the app may be used with the keys in place. Until then nobody can connect. |
| `QUICKBOOKS_MINOR_VERSION` | no | Optional. The `minorversion` sent with every call. Default `75`. |

## 3. What production access requires

These are requirements to confirm with each provider. They are stated from public documentation, not from an
approval this project has received.

**Square (to confirm with Square):**

* Production credentials of the same application, and the production redirect URL and webhook subscription
  registered separately from the sandbox ones (a production subscription has its own signature key).
* The OAuth permissions the adapter asks for must be justified by what is used: `MERCHANT_PROFILE_READ`,
  `CUSTOMERS_READ`, `ITEMS_READ`, `ITEMS_WRITE` (the insert-only push), `PAYMENTS_READ`, `PAYMENTS_WRITE` and
  `ORDERS_READ`, `ORDERS_WRITE` (payment links), `INVOICES_READ`. If the push or the payment link is not wanted,
  remove its permissions from the adapter's list before going live.
* Whether Square accepts the application secret and a PKCE challenge in the same flow is not confirmed. The
  adapter therefore uses one or the other (`SQUARE_OAUTH_FLOW`). Confirm which flow Square expects from a server
  that keeps a secret.
* Whether a seller's Square plan includes the Checkout API (payment links), the Invoices API and webhooks.
* The pinned API version (`SQUARE_API_VERSION`) is still supported.
* How long Square repeats an undelivered webhook. The adapter accepts an event whose signed creation time is up to
  25 hours old; the hourly check covers anything older.

**Intuit (to confirm with Intuit):**

* Production keys are issued after Intuit's app assessment (hosting, security and privacy questionnaire, a privacy
  policy and terms address, the redirect and disconnect addresses). `QUICKBOOKS_APPROVED` stays unset in production
  until that is done.
* Whether the QuickBooks plans of the companies involved, and the Intuit developer program tier, allow the
  accounting calls and change data capture in the volume expected.
* The refresh token lifetime and rotation rules in force, and the supported `minorversion`.
* That the realm id arrives as `realmId` on the redirect, and that a token is refused for any other realm (the
  adapter relies on that refusal to catch a wrong company).
* The webhook retry policy. The adapter accepts a notification whose newest change is up to 25 hours old; the daily
  change run covers anything older, within the 30 day reach of change data capture.

## 4. Webhook addresses and checks

| Provider | Address | Signature | Event id used for "only once" |
| --- | --- | --- | --- |
| Square | `https://<site>/api/webhooks/square` | `x-square-hmacsha256-signature`: HMAC-SHA256, base64, over the notification address followed by the raw body | Square's `event_id` |
| QuickBooks | `https://<site>/api/webhooks/quickbooks` | `intuit-signature`: HMAC-SHA256, base64, over the raw body, keyed with the verifier token | a hash of the signed body (a notification has no id of its own) |

A call with a missing or wrong signature is refused and logged by hash only. An accepted event is recorded by its
id; a repeat is answered "ok" and does nothing. What is stored of an event: its type and provider ids for Square;
realm ids, entity names and a count for QuickBooks. No amount, no name, no card, no entity content.

A Square event is handled by reading the payment, refund or invoice from Square by id with the company's own
token. A QuickBooks notification only starts the change run for each company it names.

## 5. How a payment is placed (the reconciliation rules)

The same payment always gets the same answer. The first rule that names exactly one record wins.

1. **Order.** The Square order was created by this platform for one record (a payment link). The order id was
   stored when the link was made.
2. **Reference.** The payment's reference id carries this platform's code for a record (`VXA` or `VXJ` and the
   record id, which is what the payment link puts on the order).
3. **Note.** The payment's note carries that code (somebody typed or pasted it at the register).
4. **Client and amount.** The payer is linked to a client, and that client has exactly one open record whose
   remaining balance equals the amount, to the cent.

What follows from that:

* Rules 1 to 3 say what the money is for, so a part payment or an overpayment is accepted. Part payments add up;
  the appointment is marked paid (method card, reference `square:<payment id>`) when the total reaches the fee.
  Anything above the fee becomes a credit for the client, as it does when a person records a payment. A payment on
  an engagement becomes one received payment on it with the same reference.
* Rule 4 is an inference, so it accepts an exact amount only. Two open records with that balance: nobody guesses.
  The payment goes to the list as "ambiguous" with both named.
* References that name two different records contradict each other: "ambiguous".
* A payment for a cancelled record, or for one already paid in full, is not applied: "unmatched".
* Another currency, or no usable reference and no linked client: "unmatched".
* A payment that is not completed yet (approved, pending, failed, cancelled) is not recorded at all. Square sends
  the event again when it completes.
* **Once.** A payment is stored under its Square payment id, which is unique per company. The same event again,
  another event for the same payment, the invoice event for the same money, and the hourly check all find it
  there and change nothing.
* **Unmatched list.** A person with the money capability assigns an unmatched or ambiguous payment to a record
  (`finance_payment_assign`). Once: a placed payment is not moved.
* **Refunds.** A completed refund is stored once under its refund id and lowers what its payment's record has
  received. A refund larger than what is left of the payment, or for a payment that is not in the ledger, goes to
  the list. The local payment mark and any credit already written are left as they are for a person to settle.
* **Amounts** are whole cents from Square's answer to the database. The database stores `numeric(12,2)` and
  converts exactly. An amount that is not an exact number of cents is refused, never rounded. For a Square payment
  the amount used is `amount_money` (what was charged for the sale, without tip).

## 6. Bulk changes: preview first

Linking many clients and creating catalog objects are bulk writes. Each has two runs.

| Run (`what` of `POST /api/integrations/<id>/sync`) | Writes |
| --- | --- |
| `customers` (also part of `all`) | proposals only |
| `customers:apply` | the provider's id on each cleanly matched client whose slot is empty. Refused with `preview_required` when no preview ran in the last 24 hours. |
| `catalog` (Square), `items` (QuickBooks) | proposals only |
| `catalog_push` (Square) | nothing: the list of what would be created and what is refused |
| `catalog_push:apply` (Square) | the new objects at Square. Refused without a preview from the last 24 hours. |
| `payments` (Square), `changes` (QuickBooks) | the ledger, or conflict marks |

The scheduled daily run uses `all`. It writes no client row and no catalog row, and it does not count as the
preview an apply run needs: only a `customers` or `catalog_push` run a person asked for does.

**Before any apply run, take a database backup** (`scripts/backup/`). The platform checks that a preview exists;
it cannot check that a backup was taken. That step is the operator's.

## 7. Error codes

A provider's own message is never stored, logged or shown. Codes: `environment_invalid`, `not_connected`,
`token_expired`, `token_revoked`, `token_rejected`, `invalid_grant`, `permission_revoked`, `wrong_account`,
`account_unknown`, `account_inactive`, `realm_missing`, `rate_limited`, `provider_unreachable`, `provider_error`,
`bad_response`, `request_rejected`, `preview_required`, `catalog_too_large`, `update_refused`, `sync_unknown`,
`sync_conflict`, `duplicate_name`, `duplicate_document`, `approval_required`, `customer_not_linked`,
`item_not_mapped`, `invoice_not_pushed`, `nothing_due`, `context_closed`, `currency_mismatch`,
`finance_not_installed` (the finance migration is missing on this database).

## 8. What is proven and what is not

* Proven with mocked responses (Node's test runner, no network): the connection matrix for both providers, both
  webhook signature checks, the reconciliation rules, the insert-only catalog, the QuickBooks conflict handling.
* The database functions of the finance migration were applied to a throwaway local PostgreSQL with every existing
  migration and exercised with the server role in a hand-run script (part payments, a repeat, an overpayment, a
  refund, linking). They are not yet part of `supabase/tests`, and the three functions for people
  (`finance_unmatched`, `finance_payment_assign`, `finance_customer_approve`) were compiled but not run.
* Not proven: anything against Square or Intuit. No sandbox account was used. The adapters are not registered in
  `providers/index.js` until the owner of that file adds them, so the Integrations screen still shows both as not built.
