# Database

How the database is organised after the master build, how the app talks to it, and how to add to it.
Written for the developer who writes the next migration. `docs/SECURITY.md` explains the protections of
migrations 0001 to 0009 for the owner; this file covers what 0010 to 0019 add and the rules every later
migration follows. Nothing here has been run on a real Supabase project: everything was proved on a local
PostgreSQL 16 with stand-ins for what Supabase provides (see "Tests").

## 1. Migration ranges

| Range | Content | Owner |
| --- | --- | --- |
| `0001` to `0009` | platform, tenant tables, row level security, audit, encryption, consent, role views, storage | first build, never edited |
| `0010` to `0019` | roles and capabilities, edition blueprint, new columns, access rules second pass, the gateway, lead rotation, duplicate search | this document |
| `0020` to `0029` | server core: sessions, invitations, rate limits, job queue, connections, webhooks (schema `app`) | server range |
| `0030` to `0049` | module tables: offices, grants, catalog, appointments, credits, envelopes, vault functions and the rest | module range |
| `0050` and later | provider tables, migration staging | later |

| File | What it does |
| --- | --- |
| `0010_roles_and_capabilities.sql` | `readonly` role, `tenants.config`, the 40 capabilities, the default matrix per edition, `app.can` and `app.tenants_can` resolved per company, four more reserved addresses |
| `0011_edition_blueprint.sql` | validation of `tenants.config`, stages and sources per company, `leads.status` and `leads.source` checked against them |
| `0012_new_columns.sql` | every new field of `src/domain/types.ts` on the existing tables, `extra` everywhere, seven new tables |
| `0013_access_rules_v2.sql` | every write rule asks for `write`, office scope, rules for the new tables, guards, audit triggers |
| `0014_gateway_registry.sql` | the collection registry and the compiler that turns a field map into statements |
| `0015_gateway_load.sql` | `ws_load`, `ws_session`, `ws_hidden_clients` |
| `0016_gateway_apply.sql` | `ws_apply` |
| `0017_lead_routing_and_duplicates.sql` | `lead_assign_next`, `client_find_duplicate`, `lead_find_duplicate`, `member_update_profile` |
| `0018_collections.sql` | the registration of every core collection, placeholders for the module collections |
| `0019_lockdown_check.sql` | `app.lockdown_check()`, the house rules as a function any migration can call |

Run order is the file order. Seed after the migrations: `supabase/seed.sql` (the nine editions).

## 2. House rules (every table, every migration)

1. `id uuid primary key`, `tenant_id uuid not null references public.tenants`, `unique (tenant_id, id)`.
2. Every link to another tenant table is a composite foreign key that includes `tenant_id`, and has an index.
3. Row level security enabled and forced. Start from zero privileges, then grant what is needed.
4. Policies are written with the once-per-statement helpers: `tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[])`.
   Never `app.can(tenant_id, ...)` in a policy or a view (it runs per row; a test refuses it).
5. Every insert, update and delete policy asks for `write` (a test and `verify_remote.sql` check the text of every policy).
6. `created_at`, `updated_at` with the `app.touch_updated_at()` trigger, and the `app.tenant_id_immutable()` trigger.
7. `extra jsonb not null default '{}'` on every table that holds records of the app.
8. Money is `numeric(12,2)`. Lists of allowed values are CHECK constraints in the form `col in ('a', 'b')`, so `parity.mjs` can compare them with `types.ts`.
9. Functions are SECURITY INVOKER unless they cannot be. A SECURITY DEFINER function has `set search_path = ''`, a short body, and a comment that says why.
10. No function is executable by `anon`. A public, token-addressed function is the one exception and must be listed in `app.anon_functions` with its reason, or `app.lockdown_check()` takes the privilege away again.
11. End every migration that creates a table or a function with `select app.lockdown_check();`.
12. Tables in schema `app` have no policy and no privilege for any application role; they are reached through functions (rule of the server range, checked by `0029`).

## 3. Roles and capabilities

Office roles: `owner`, `manager`, `staff`, `readonly`. Field workers have role `worker` and hold no capability.
The 40 capability names are in `app.capabilities()` and are the same list as `Permission` in `src/domain/permissions.ts`.

What a role may do in one company is resolved by `app.permissions_for(industry, config, role)`:

1. the owner always holds every capability;
2. if the company's configuration has a list for that role (`tenants.config -> 'roles' -> '<role>'`), that list, limited to names that exist;
3. otherwise the edition's default from `app.edition_defaults(industry) -> 'rolePermissions'`.

`app.edition_defaults()` is the one source of the default matrices (field editions and practice). `parity.mjs` compares
it with `rolePermissions` of all nine packs, and compares `app.permissions_for` with `permissionsOf()` in
`src/domain/config.ts` for a set of overrides.

`app.can(tenant, capability)`, `app.tenants_can(variadic capabilities)` and `app.my_permissions(tenant)` all resolve this way.
`write` is the general "may change records" capability. `readonly` never holds it: the configuration is refused if it
tries (`roles.readonly` may not contain `write` or `delete`), and `roles.owner` cannot be given at all.

Guards that hold whatever a policy says (triggers, for signed-in people):

| Trigger | Rule |
| --- | --- |
| `tenants_guard` | name, branding, settings need `settings`; `config` needs `config`; `config.roles` and `config.security` need the owner role |
| `tenant_members_guard` | only an owner adds, changes or removes an owner (membership itself needs `users`) |
| `jobs_write_guard` | writing a job needs `write`, also through the staff view `jobs_basic` |
| `messages_guard` | a person writes status `draft` or `demo` only; `provider`, `externalId`, `error`, direction `in` are the server's; a queued, sent or received message can only be marked read |
| `clients_tax_guard` | `tax_id_type` and `tax_id_last4` change only when `client_secrets` changes |
| `lead_handoffs_append_only` | handoffs are never updated |

## 4. The edition blueprint in the database

* `industries` has the ninth row, `practice` (`seed.sql`). `app.edition_family(industry)` is `field` or `practice`.
* `tenants.config jsonb` is `CompanyConfig` from `types.ts`. `app.config_problem(config)` returns what is wrong with a
  configuration or NULL; the trigger `tenants_config_check` refuses a bad one for every caller. Checked: stage ids
  unique, at least one open, one won and one lost stage, labels in English and Spanish, known roles, known
  capabilities, option lists with unique ids, `taskTypes` includes `todo`, shapes and ranges of `modules`, `terms`,
  `appointments`, `vault`, `security`, `hours`, and `quickLinks` that are web addresses only. A key the database does
  not know is stored and returned untouched.
* Stages and sources in force: the company's own list when it has one, otherwise the edition's.
  `app.stage_kind(tenant, stage)` answers `open`, `won` or `lost` (NULL when the company has no such stage);
  `app.tenant_stages(tenant)` and `app.tenant_sources(tenant)` return the lists. Code never compares a stage with `'won'`.
* `leads.status` and `leads.source` have no fixed CHECK any more. The trigger `leads_validate` checks them against the
  company's lists. A stage or source that leads still use cannot be removed from the configuration.
* Lead routing is not in `tenants.config`: it lives in `lead_routing` (one row per company) so the turn can be locked.
  `ws_load` returns it as `config.routing`, `ws_apply` splits it out again.

## 5. Office scope

A client with `office_id` is visible to people whose `tenant_members.office_ids` contains that office, to anyone
holding `allClients`, and to people holding a grant. Everyone in the company sees a client without an office.
The same scope follows the client into `client_people`, client notes, `jobs` (and `jobs_basic`), `tasks`, `documents`
and `messages`. Leads follow the same rule, and the member who owns a lead always sees it.

* `app.hidden_clients()` returns the clients the caller may not open; policies use `client_id not in (select app.hidden_clients())`,
  which the database evaluates once per statement as a hash.
* `app.granted_client_ids()` returns `'{}'` today. **The migration that creates the grants table redefines this one
  function** (SECURITY DEFINER, `set search_path = ''`) to return the client ids of the caller's grants that have not
  expired. Every scope rule already calls it; nothing else has to change. A test proves the hook.
* `public.ws_hidden_clients(tenant)` returns `[{ id, name, officeId }]` for the hidden clients, so the app can offer "ask for access".
* Not scoped: job children (assignments, expenses, payments, work logs) and lead handoffs read directly from their
  tables. Through `ws_load` they only ever arrive nested under a visible job or lead.

## 6. The tax ID of a client

* `client_secrets (tenant_id, client_id, tax_id_enc, tax_id_type, last4, set_by, set_at)`: the value encrypted with
  `app.encrypt_pii` (0005). No policy, and no privilege for `authenticated`, `service_role` or `anon`.
* `clients.tax_id_type` and `clients.tax_id_last4` are copies kept by a trigger on `client_secrets`. Nobody can write
  them, the server key included.
* `ws_load` returns `taxIdType` and `taxIdLast4` to people with `secureView`, and never anything else.
  `ws_apply` ignores both fields. A field with one of these names planted in `extra` is never returned.
* **For the module range:** `vault_set`, `vault_request`, `vault_decide`, `vault_reveal` are SECURITY DEFINER functions
  that insert, update or delete the row in `client_secrets` (with `app.encrypt_pii` / `app.decrypt_pii`) and write
  their own audit entries. The row trigger on `client_secrets` already audits every change with the value and the
  last four digits redacted.

## 7. The gateway

The server (`api/ws.js`) calls these with the person's own token. They run as that person (SECURITY INVOKER): every
statement passes row level security, column privileges, constraints, guard triggers and audit triggers exactly as a
direct write would. Executable by `authenticated` only.

### `public.ws_session(p_tenant uuid) returns jsonb`

`{ tenantId, slug, name, industry, planId, status, role, memberId, workerId, actorId, permissions: [...] }`

### `public.ws_load(p_tenant uuid) returns jsonb`

The `WorkspaceData` object: one key per key of `DemoState` (without `v`, `seededOn`, `seedLang`, `touched`), rows
shaped as in `types.ts`. `parity.mjs` checks that the keys match.

* Every row of a table collection carries `updatedAt`, its version (see "stale" below).
* `staff` and `readonly` in a field edition: jobs through `jobs_basic` with `price: 0`, `payTerms: ''`, `expenses: []`,
  `received: []`, assignments with `price: 0` and no rate; workers from `worker_directory`; no `workerPays`; no audit;
  history without entries that carry amounts.
* `worker`: the portal only (own jobs without price, own assignments, tasks, payments, profile); every other list empty.
* `users` come from `tenant_members` (office roles; `active` is false for a disabled member; `mfa` is not stored).
* `activity` is the newest 600 entries, `audit` and `automation.runs` the newest 500.
* A collection whose table is not built yet is an empty list.
* Size: measured on the local database, a company with 200,000 records loads in about 9 seconds (53 MB). The sample
  businesses (about 300 records) load in a few milliseconds. A company past some tens of thousands of records needs
  paging, which the registry can express (`read_filter`, `row_limit`) but the app does not use yet.

### `public.ws_apply(p_tenant uuid, p_ops jsonb, p_idem text) returns jsonb`

```
p_ops   [ { "c": "<collection>", "op": "upsert" | "delete", "id": "<row id>", "row": { ...the whole row } }, ... ]
        or { "atomic": true, "ops": [ ... ] }      all or nothing
answer  { "ok": bool, "applied": n,
          "rejected": [ { "c", "id", "reason", "detail" } ],
          "server":   { "<collection>": [ rows the database stored differently from what was sent ] },
          "versions": { "<collection>": { "<id>": "<updatedAt>" } } }
```

Order inside one request: upserts in registry order (`ord`), then the links marked `defer` (so a lead, its client
and the job that points back at the lead can arrive together), then deletes in reverse order. At most 1000 operations.

| Reason | Meaning |
| --- | --- |
| `forbidden` | the capability is missing (detail `write`, `delete`, `remove:<list>` or the collection), or a policy or guard refused |
| `read_only` | `audit`, `users` and every collection registered without a writer |
| `not_ready` | the collection is announced, its table is not built yet |
| `unknown_collection` | not registered (a nested list cannot be addressed on its own) |
| `wrong_tenant` | the row names another company (`tenantId` or `tenant_id`) |
| `invalid` | a constraint or a cast failed; detail is the constraint or column name |
| `stale` | the row carried an `updatedAt` that is no longer current; the current row is in `server` |
| `missing_reference` | a link points at a row that does not exist in this company. For a `defer` link the row is stored without the link and returned in `server` |
| `in_use` | delete refused by a foreign key |
| `duplicate` | a unique rule (ticket, document number, an id in a connected system, an id that exists elsewhere) |
| `append_only` | history cannot be changed or deleted |
| `rolled_back` | another operation of an atomic batch was refused |

Rules the app can rely on:

* **Unknown fields are kept.** A field without a column goes to `extra` and comes back merged into the row. A field
  that has a column (in any variant) is never stored in or read from `extra`.
* **The actor is never taken from the row.** Note, comment, handoff and message authors and the author of a history
  entry are the signed-in member; a history entry is stamped with the current time. `automation` stays `automation`.
  The stored row is returned in `server`.
* **Server-owned fields are ignored on write and returned on read:** `docs.esign`, `clients.taxIdType`,
  `clients.taxIdLast4`, `messages.provider`, `externalId`, `error`, `config.routing.cursor`, `settings.consent1099`.
* **Nested lists** (`notes`, `handoffs`, `owners`, `contacts`, `assign`, `expenses`, `received`, `log`, `comments`)
  are synced by id. A list that is not in the row is left alone. A list the person may not read is ignored.
  Removing an element may need `delete` (or being its author, for notes and comments). Any change to a nested list
  moves the version of the parent row.
* **Versions.** Send `updatedAt` back unchanged with an edit to get the stale check; leave it out for last write wins.
  After an apply, take the new value from `versions`.
* **Idempotency.** The same key from the same person in the same company returns the stored answer with
  `"replayed": true`. The same key with a different request is an error (SQLSTATE 22023). Keys live in `ws_requests`;
  `public.ws_purge_requests(days)` (service role) removes old ones.
* **Parts that are not lists** are operations too, with any id:
  `{ c: 'company', row: Company }`, `{ c: 'config', row: CompanyConfig }`, `{ c: 'settings', row: WorkspaceSettings }`,
  `{ c: 'readNotifications', row: { ids: [...] } }`, `{ c: 'automation', id: '<rule id>', row: { enabled } }`.
  Automation runs are the collection `automationRuns` (they load inside `automation.runs`).
* **Files are paths.** `file.dataUrl`, a `data:` logo or photo are refused: upload first, store the path.
* A whole-request error (not a member, a worker, more than 1000 operations, a reused key) raises instead of answering.

### Other functions of this range

| Function | Who | What |
| --- | --- | --- |
| `lead_assign_next(tenant) returns uuid` | `leads` and `write`, or the server | the member whose turn it is; locks the routing row |
| `lead_assign_next(tenant, lead) returns jsonb` | same | takes a turn, sets the owner and first owner, records the handoff; a lead that has an owner keeps it and no turn is used |
| `client_find_duplicate(tenant, email, phone, name, address)` | `clients`, or the server | matches with what matched and a score; a hidden client comes back with its name only |
| `lead_find_duplicate(tenant, email, phone)` | `leads`, or the server | leads from the same person |
| `member_update_profile(tenant, member, patch)` | the member, or `users` and `write` | name, phone, title, bio, photo, languages, away; with `users` also inLeadPool, officeIds |
| `ws_hidden_clients(tenant)` | `clients` | names of clients in other offices |

Duplicates: email, phone and name are matched, not constrained (a family shares an email). Unique where it is safe:
`clients.external_ids` per provider, `messages (provider, external_id)`, `automation_runs.dedupe`, tickets and numbers.

## 8. Registering a collection (the recipe for a module migration)

A collection is one key of `WorkspaceData`. The gateway knows no collection by name: it reads `app.ws_collections`.
The 21 module collections are registered as placeholders (`kind: pending`): they load as `[]` and refuse writes with
`not_ready`. Building one means the seven steps below. The example registers `offices` and `catalog` with its nested
`tiers`; it was run end to end in a scratch copy (all generic tests covered the three tables, and the practice sample
business sent its offices and catalog through `ws_apply` and read them back identical). It is an illustration of the
steps, not a decision about those tables.

**Step 1. The table**, by the house rules of section 2. `extra` is required for a writable collection (registration
refuses without it). A nested list is its own table with a foreign key to the parent and, when the order matters, a `position` column.

**Step 2. Standard triggers, row level security, privileges.**

```sql
create trigger offices_touch before update on public.offices for each row execute function app.touch_updated_at();
create trigger offices_00_tenant_fixed before update of tenant_id on public.offices for each row execute function app.tenant_id_immutable();
alter table public.offices enable row level security;
alter table public.offices force row level security;
revoke all on public.offices from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.offices to authenticated, service_role;
```

**Step 3. Policies.** Read with the reading capability, write with `write` plus the writing capability, delete with `delete` too.

```sql
create policy offices_select on public.offices for select to authenticated
  using (tenant_id = any ((select app.office_tenants())::uuid[]));
create policy offices_insert on public.offices for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('settings', 'write'))::uuid[]));
create policy offices_update on public.offices for update to authenticated
  using (tenant_id = any ((select app.tenants_can('settings', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('settings', 'write'))::uuid[]));
create policy offices_delete on public.offices for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('settings', 'write', 'delete'))::uuid[]));
```

A table that points at a client adds the office scope: `and (client_id is null or client_id not in (select app.hidden_clients()))`.

**Step 4. Audit**, where the brief asks for it: `create trigger offices_audit after insert or update or delete on public.offices for each row execute function app.audit_row('<column to redact>', ...);`

**Step 5. Foreign keys for the plain uuid columns of 0012** that were waiting for this table, each with its index:

```sql
alter table public.clients add constraint clients_office_fk foreign key (tenant_id, office_id)
  references public.offices (tenant_id, id) on delete set null (office_id);
```

Waiting columns: `clients.office_id`, `leads.office_id`, `jobs.office_id` (indexed), `jobs.service_id` (indexed),
`jobs.tier_id`, `tasks.appt_id` (indexed), `documents.template_id`, `documents.envelope_id` (indexed).
Arrays cannot carry a foreign key: `tenant_members.office_ids`, `leads.service_ids` (validate with a trigger if needed,
as `lead_routing_check` does).

**Step 6. Register.** One call per collection and per nested list. The argument is an object whose keys are the options below.

```sql
select app.ws_register($j${
  "name": "offices", "ord": 6, "relation": "offices",
  "write_caps": ["settings"], "delete_caps": ["delete"], "order_by": "t.name, t.id",
  "fields": { "id": "id", "name": "name", "address": "address", "phone": "phone", "timezone": "timezone", "main": "main" }
}$j$);

select app.ws_register($j${
  "name": "catalog", "ord": 12, "relation": "catalog_services",
  "read_caps": ["catalog"], "write_caps": ["catalog", "config"], "delete_caps": ["delete"],
  "fields": { "id": "id", "name": "name", "i18n": "i18n", "category": "category", "description": "description",
              "active": "active", "repeat": "repeat", "playbookId": "playbook_id", "docKinds": "doc_kinds",
              "appointmentTypeId": "appointment_type_id", "externalIds": "external_ids" }
}$j$);

select app.ws_register($j${
  "name": "catalog.tiers", "parent": "catalog", "parent_field": "tiers", "parent_col": "service_id",
  "relation": "catalog_tiers", "read_caps": ["catalog"], "write_caps": ["catalog", "config"], "position_col": "position",
  "fields": { "id": "id", "name": "name", "price": "price", "unit": "unit", "note": "note", "externalIds": "external_ids" }
}$j$);
```

Registering a name that was a placeholder replaces the placeholder. Registration fails loudly on a column that does
not exist, an unknown capability, an unknown option, or a writable table without `extra`.

| Option | Meaning |
| --- | --- |
| `name` | key in `WorkspaceData`; `<parent>.<field>` for a nested list |
| `variant` | 1, 2, ... The first variant whose `read_caps` the person holds is used (how staff get `jobs_basic`). Default 1 |
| `kind` | `table` (default), `custom` (functions), `pending` (placeholder) |
| `ord` | apply order. A collection comes after everything its rows point at. Core: users 5, workers 10, clients 20, leads 30, jobs 40, tasks 50, workerPays 60, docs 70, messages 80, activity 90, automation 100 |
| `relation`, `base_table` | table or view in `public`; for a view, the table that holds the column types and defaults |
| `key_col` | column of the row id, default `id`. A text key works (`connections` keyed by provider) |
| `read_caps` | capabilities needed to read (all of them). Empty = any office role |
| `write_caps` | capabilities needed to write besides `write`. Leave it out for a read-only collection. `[]` = `write` alone |
| `delete_caps` | capabilities needed to delete besides those for writing. Leave it out and rows cannot be deleted through the gateway |
| `needs_write` | `false` for something a read-only person may save for themselves |
| `fields` | the map, see below |
| `consts` | fields returned with a fixed value and ignored on write (`{"price": 0}` for a variant that hides the price) |
| `fixed` | column values forced on write and required on read (`{"role": "owner"}`) |
| `parent`, `parent_field`, `parent_col` | nested list: the parent collection, the field of its row, the column that points at it |
| `position_col` | nested list: column that keeps the order of the list |
| `append_only` | rows are added, never changed or removed |
| `remove_caps`, `own_col` | nested list: what removing an element needs; the author column that lets a person remove their own |
| `read_filter` | SQL condition over alias `t` (`c` for a nested list). The read filter of the collection |
| `order_by`, `row_limit` | SQL order over the same alias; newest N rows for a log |
| `load_fn`, `apply_fn` | `kind: custom`: `app.<fn>(p_tenant uuid) returns jsonb` and `app.<fn>(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb` |
| `top_level` | `false` when another loader embeds the collection |

A field is `"<column>"` or an object:

| Field option | Meaning |
| --- | --- |
| `col` | the column |
| `empty` | what the app writes for "no value" (`""` for `Job.start`, `null` for `Lead.value`): stored as NULL, returned as this |
| `omit` | value left out when reading (`false` for a flag stored NOT NULL DEFAULT false, `{}`, `[]`) |
| `ro` | returned, never written (set by the server or another path) |
| `stamp` | `member`: on insert the column gets the signed-in member, never updated. `member_if_present`: only when the row has the field |
| `defer` | written after every other change of the request (a link to a row that may arrive later in the same batch) |
| `kind: ref` | `{ type, id }` with `type_col`, `id_col` |
| `kind: assignee` | `u:<id>` or `w:<id>` with `member_col`, `worker_col` |
| `kind: actor` | who did it, with `kind_col`, `id_col`; a member is always the signed-in one |
| `kind: obj` | a small object from several columns: `cols: { "<key>": "<column>" }` |
| `kind: expr` | read-only SQL expression; write the row alias as `{a}` |

Types are taken from the catalog: `timestamptz` is read and written as `2026-10-03T14:05:09.123Z`, `time` as `HH:MM`,
`date` as `YYYY-MM-DD`, arrays and `jsonb` as JSON. A missing value becomes the column default when there is one.
After a migration changes the type or default of a registered column, call `select app.ws_recompile();`.

**Step 7. The house rules once more:** `select app.lockdown_check();`

**Tests for a new table.** `rls_isolation.sql` takes the list of tables from the catalog, so a new table is attacked
by the isolation loop, the foreign key loop and the read-only loop without editing any test. It needs sample rows:

* `supabase/tests/modules/<name>.seed.sql`: rows for the three sample companies (`test.id('a')`, `'b'`, `'c'`), in the
  new tables only. Do not add rows to the core tables there: the tests count them. A new foreign key on a core table
  is attacked on an existing row, no sample value is needed.
* `supabase/tests/modules/<name>.test.sql`: the module's own assertions, with the harness (`test.ok`, `test.is`,
  `test.as`, `test.apply`, `test.load`). Run after `gateway.sql`, in the same database.
* A sample business that has rows for a collection sends them through the round trip as soon as the collection is
  registered; give the pack's seed rows and the round trip compares them.

## 9. Tests

```
bash supabase/tests/run_local.sh          the one command: throwaway PostgreSQL, every migration, every test
MIGRATIONS_MAX=0019 bash supabase/tests/run_local.sh     only up to a migration number
bash supabase/tests/mutation_check.sh     breaks one rule at a time and checks that the suite notices (about twenty minutes)
ONLY="module:" bash supabase/tests/mutation_check.sh     only the breakages of the module range
```

| Part | Covers |
| --- | --- |
| `rls_isolation.sql` | catalog rules, anonymous access, company A against company B in every table and view for eight kinds of people, cross-company links, the role matrix, audit, encryption, consent |
| `gateway.sql` | capabilities and overrides, the read-only role in every table, configuration validation, stages per edition and per company, the tax ID secret, `ws_load` per role, `ws_apply` (every refusal reason, versions, idempotency, atomic batches, nested lists), lead rotation, duplicates, office scope, profiles |
| `modules/00_harness.test.sql` | helpers for the module tests (a session with or without the second sign-in step, a fresh identity check, `test.find_text`), two fresh companies M (practice) and N (field edition) with every module table filled |
| `modules/10_matrix.test.sql` | all 25 module tables: read, insert, update and delete for nine kinds of people in both companies, against a hand-written table of the capabilities each one needs |
| `modules/20_gateway.test.sql` | every module collection through `ws_load` (shape per field) and `ws_apply` (new rows, nested lists, ignored server fields, every refusal), read-only collections, office scope in every table that points at a client, access requests and grants |
| `modules/30_appointments.test.sql` | `appt_mark_paid`, `appt_cancel`, `credit_issue`, `credit_apply`, `credit_void` (happy path, every refusal, the same request twice, amounts to the cent), what a person cannot write directly, the two scheduled jobs, double booking |
| `modules/40_vault.test.sql` | the tax ID vault: store, ask, approve, view once, expiry, the two-person and the single-person rule, removal, evidence that cannot be edited, and a search of every stored text for the planted numbers |
| `modules/60_cash.test.sql` | `cash_close` to the cent and the lock of a closed day for every caller |
| `modules/70_members_exports.test.sql` | `member_set_role`, `member_disable`, `member_enable`, `export_request` (every kind, no tax ID in any file, office scope), and the links of the public pages (hash only, single purpose, single use, revoked, replaced) |
| `modules/90_concurrency.test.sql` | real second sessions (dblink): a credit spent once, a person booked once, a closed day that stays closed; each as a scripted interleaving and as several sessions at once |
| `concurrency.sh` | two sessions asking for the next lead at once (one is seen waiting for the row lock), then 240 turns from eight sessions at once |
| `parity.mjs` | reserved addresses, capability names, the role matrix and stages of all nine packs, value lists against CHECK constraints, editions, the keys of `WorkspaceData` against the registry, every mapped field against `types.ts` |
| `tests/gateway_roundtrip.mjs` | every edition's sample business, English and Spanish, through `ws_apply` and back from `ws_load`, compared field by field |
| `verify_remote.sql` | read-only structure check for a real project (SQL Editor) |

What the local run does not prove is listed in `docs/SECURITY.md`, section 8: the Data API, Supabase Auth, the
Storage service and Vault are stand-ins.

## 10. Known limits

* `ws_load` returns the whole workspace in one answer. No paging yet.
* Office scope does not reach job children and handoffs read directly from their tables (section 5).
* A person with many hidden clients pays about 100 ms per statement for the hidden set (measured with 30,000 hidden clients).
* History written through the gateway is always stamped "now" and with the signed-in member (rule of 0003). An import
  that must keep original times and authors goes through the server key, not through `ws_apply`.
* `client_secrets` is read and written by the vault functions only (section 11.4).
* `extra` is not added to `audit_log`, `industries`, `demo_requests`, `client_secrets` and `ws_requests`: none of them holds a record of the app.

## 11. Module tables (migrations 0030 to 0049)

Numbers `0041` to `0048` are left free for the public pages of the next round. `0049` is the closing check and
stays last: it refuses to finish when a module collection is still a placeholder, when a protected function is
executable by the wrong role, when a guard is missing, or when `app.public_links` is open.

| File | Tables | Collections | Protected functions |
| --- | --- | --- | --- |
| `0030_offices_and_access.sql` | `offices`, `access_requests`, `access_grants` | `offices`, `accessRequests`, `grants` (read only) | `grant_decide`, `grant_revoke` |
| `0031_catalog_and_playbooks.sql` | `playbooks`, `playbook_steps`, `catalog_services`, `catalog_tiers` | `playbooks` (+ `steps`), `catalog` (+ `tiers`) | |
| `0032_appointments_and_credits.sql` | `appointment_types`, `appointments`, `credits` | `apptTypes`, `appointments`, `credits` (read only) | |
| `0033_appointment_money.sql` | | | `appt_mark_paid`, `appt_cancel`, `credit_apply`, `credit_void`, `credit_issue`; server only: `appt_release_unpaid`, `credits_expiring` |
| `0034_vault.sql` | `reveal_requests`, `secure_access_log` | `reveals`, `secureLog` (both read only) | `vault_set`, `vault_clear`, `vault_request`, `vault_decide`, `vault_reveal`, `vault_copied`; server only: `vault_expire` |
| `0035_templates_and_envelopes.sql` | `doc_templates`, `doc_template_blocks`, `envelopes`, `envelope_signers`, `envelope_fields` | `templates` (+ `blocks`), `envelopes` (+ `signers`, `fields`) | |
| `0036_cash.sql` | `cash_entries`, `cash_closes` | `cash`, `cashCloses` | `cash_close` |
| `0037_deadlines_and_rules.sql` | `compliance_items`, `rules` | `complianceItems`, `rules` | |
| `0038_crosssell_reviews_posts.sql` | `cross_sell_rules`, `opportunities`, `review_requests`, `social_posts` | `crossSell`, `opportunities`, `reviews`, `posts` | |
| `0039_members_exports_audit.sql` | | `audit` gets its `summary` | `member_set_role`, `member_disable`, `member_enable`, `export_request` |
| `0040_public_links.sql` | `app.public_links` | | server only: `link_issue`, `link_peek`, `link_use`, `link_revoke` |
| `0049_module_lockdown.sql` | | | the closing check |

The foreign keys that 0012 left waiting are added with their tables: `clients.office_id`, `leads.office_id`,
`jobs.office_id`, `jobs.service_id`, `jobs.tier_id`, `tasks.appt_id`, `documents.template_id`, `documents.envelope_id`.

### 11.1 Rules every protected function follows

* It lives in `public`, takes `p_tenant uuid` first, is executable by `authenticated` only, and passes
  `app.module_gate(p_tenant, capabilities...)` first: a live session, the second sign-in step where the company
  asks for it, an active office member, every capability named. The server key is refused: these are things a
  person does.
* A refusal is one of: SQLSTATE `42501` (not allowed), `VX402` `mfa_required`, `VX403` `stepup_required`, `22023`
  with the message `invalid`, or `P0001` with one word: `not_found`, `expired`, `conflict`, `locked`,
  `needs_other_person`, `too_small`. No message repeats what was sent.
* It writes one security event and one audit entry (`app.module_event`), naming the record it is about.
* It answers with the record in the shape of `src/domain/types.ts` (the same reader the gateway uses).
* Guards that must hold for every caller, the server key included, are AFTER triggers with lowercase names, so a
  link to another company is still answered by the foreign key first. Guards that only bind a signed-in person
  test `current_user`, so the protected functions and the server pass.

### 11.2 Offices, access requests and grants (0030)

A person asks for a client they cannot open by writing an `accessRequests` row through `ws_apply`: it is always
their own and always `pending`, whatever the row said. `grant_decide(p_tenant, p_request, p_approve, p_expires)`
needs `allClients` and `write`, refuses the person who asked (`needs_other_person`), a second decision (`expired`)
and an end date in the past (`invalid`), and writes the grant. `grant_revoke(p_tenant, p_grant)` takes it back.
`app.granted_client_ids()` is redefined here: grants of the active member that have not run out. `grants` is read
only through the gateway.

### 11.3 Catalog, appointments and credits (0031 to 0033)

* Catalog and playbooks: read with `catalog`, written with `catalog` and `config`. Price changes are in the audit log.
* `appointments`: the payment (`paid_*`), `credit_id` and `meet_url` are not writable by a person. A person cannot
  confirm an appointment that must be paid first, cancel a paid one by changing its status, change the fee or the
  client of a paid one, or delete it (`appointments_person_guard`).
* Double booking (`appointments_double_booking`): two appointments of one team member on one day collide when one
  starts before the other has ended and its type's free minutes have passed. Only `scheduled`, `awaiting_payment`
  and `confirmed` hold time. The rule is the company's (`config.appointments.noDoubleBooking`, on unless switched
  off) and holds for every caller. Two bookings at the same moment wait for each other on a lock per person.
  Refusal: SQLSTATE `23P01`; through `ws_apply`, `invalid` with detail `appointments_no_double_booking`.
* `credits` is a ledger: written once, then used once or voided once. Nobody edits or deletes an entry, the server
  key included (`credits_ledger_guard`). People hold SELECT only.
* `appt_mark_paid(p_tenant, p_appt, p_method, p_ref, p_amount, p_idem)`: `appointments`, `money`, `write`. Once per
  appointment (`conflict`), at least the fee (`too_small`), whole cents. More than the fee becomes an
  `overpayment` credit. The same `p_idem` from the same person answers the first result again and records nothing
  twice; the same key with other arguments is a `conflict`.
* `appt_cancel(p_tenant, p_appt, p_by, p_reason)` answers `{ appointment, credit?, kept? }`. What was paid stays
  with the client as a credit, except when the client cancels inside the prepay window and the company keeps late
  cancellations (`settings.appointments.clientCancel = "forfeit"`, `kept: "forfeit"`), or when there is no client
  record yet (`kept: "no_client"`).
* `credit_apply(p_tenant, p_credit, p_appt)` answers `{ credit, appointment, remainder? }`. It locks the credit row
  first, so two sessions can never spend the same credit. Same client, not used, not voided, not expired, and it
  must cover the fee; what is left comes back as a new credit with the same last day.
* `credit_void`, `credit_issue`: `appointments`, `credits`, `write`.
* Server only: `appt_release_unpaid(p_limit)` releases prepaid appointments whose pay-by moment passed and returns
  them; `credits_expiring(p_days)` lists usable credits about to run out.

### 11.4 The tax ID vault (0034)

`client_secrets` (0012) keeps the number encrypted and no application role holds a privilege on it. The functions
of 0034 are the only doors, and `vault_reveal` is the only function that reads the table and decrypts.

| Function | Who | What |
| --- | --- | --- |
| `vault_set(p_tenant, p_client, p_type, p_value)` | `clients`, `secureView`, `secureReveal`, `write` | stores or replaces; checks the shape for the type; answers `{ taxIdType, taxIdLast4 }`. An empty value removes the number and needs a fresh identity check. |
| `vault_request(p_tenant, p_client, p_reason)` | the same | one open request per person and client; a reason of five characters or more |
| `vault_decide(p_tenant, p_request, p_approve)` | another person with `secureApprove` | two-person rule (default): the person who asked can never approve. Single-person rule (`config.vault.approval = "step_up"`): they approve their own, and their fresh identity check is the approval. An approval needs a fresh identity check and is good for 15 minutes. |
| `vault_reveal(p_tenant, p_request)` | the person who asked | fresh identity check, approved and not run out; marks the request used and writes the log before it answers `{ value, hideAt, last4 }`. Once. |
| `vault_copied`, `vault_clear` | | logged as `export` and `clear` |
| `vault_expire()` | server only | closes approvals past their window and requests nobody answered for 24 hours |

`reveal_requests` and `secure_access_log` are evidence: the first only moves forward, the second is append only,
for every caller. The number is never written to the audit log, the security events, the access log or an error
message. `modules/40_vault.test.sql` plants `123-45-6789`, runs every operation, and searches every text, JSON and
byte column of every table for it. Whoever runs the database keeps statement logging with parameters off (the
default on Supabase), because the number arrives as an argument.

### 11.5 Templates and signature requests (0035)

`envelopes.client_id` is copied from the document by a trigger and is not writable, so a request follows the office
scope of its document's client. `signers` are stored before `fields` (registry order). `Envelope.events` has no id
in `types.ts`, so it is a JSON list on the row: a person may only append to it. Outside the demo, a person writes
`draft` and `void` only, and signers and fields only while the request is a draft: sending, viewing and signing are
the server's. Who approved a template and when is stamped from the session.

### 11.6 Cash (0036)

`cash_close(p_tenant, p_date, p_office, p_counted, p_note)`: `cash` and `write`. Expected = the last count of that
drawer plus the open entries up to the day; a difference needs a note; a day is counted once and never before a
closed day (`locked`). Every entry up to that day then carries the close, and `cash_entries_lock` refuses any
insert, change, removal or move into a closed day, for every caller (SQLSTATE `23514`, constraint
`cash_day_closed` or `cash_entry_closed`). A count and an entry at the same moment wait on one lock per drawer.

### 11.7 Deadlines, rules, cross-sell, reviews, posts (0037, 0038)

* `rules`: keyed by `rule_id` (text: a shipped rule keeps its name). `event` is a fixed list, the same 30 events as
  `RuleEvent` in `types.ts`; conditions and steps are JSON checked by `app.rule_problem` against `app.rule_ops()`
  and `app.rule_step_kinds()`. `parity.mjs` reads all three lists from `types.ts`. A new event is one line in the
  CHECK of a new migration.
* `opportunities`: one open suggestion per client and service. `reviews`: a person writes `draft` and `demo` rows;
  a rating comes from the public page. `posts`: a person cannot mark a post published or failed; approval is
  stamped and is for owner and manager.

### 11.8 Members, exports, audit, connections (0039)

* `member_set_role`, `member_disable`, `member_enable`: `users` and a fresh identity check. Disabling ends every
  session of the person and closes their reveal requests. The last owner cannot be removed or disabled.
* `export_request(p_tenant, p_kind)`: `export`, the capability of the kind, and a fresh identity check. Runs with
  the caller's rights, so the office scope applies. Answers `{ fileName, mime, rows, content }` (CSV). No kind
  includes a tax ID.
* `connections` is the one placeholder left on purpose. `gateway.sql` (core range) asserts that at least one
  collection is still pending, and connection state lives in the server range. `app.ws_load_connections` is ready;
  registering it is one statement once that assertion accepts zero. Until then the app reads connections from the
  server, and `ws_apply` answers `not_ready` for the collection.

### 11.9 Links for the public pages (0040)

`app.public_links`: purpose (`sign` or `review`), the SHA-256 of the token, one signer or one review request, an
expiry, used and revoked marks. Closed like the server tables. The server issues, looks up, uses and revokes links
through `link_issue`, `link_peek`, `link_use` and `link_revoke`. The public functions the pages call are left for
migrations `0041` to `0048`.

