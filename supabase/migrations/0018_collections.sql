-- 0018 The collections of the core data model
-- One app.ws_register() call per collection of WorkspaceData that the tables of 0002 and 0012 hold, the parts that
-- are not lists (company, config, settings, ...), and a placeholder for every module collection whose table comes
-- later. The field names are the ones in src/domain/types.ts; the options are explained above app.ws_compile (0014).
--
-- Apply order ("ord"): people 5, workers 10, clients 20, leads 30, jobs 40, tasks 50, worker payments 60,
-- documents 70, messages 80, history 90, automations 100. Module collections choose their own place.

-- ---------------------------------------------------------------------------------------------------------------------
-- The parts that are not lists of rows
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${ "name": "pack", "kind": "custom", "ord": 0, "load_fn": "ws_load_pack",
  "note": "IndustryId of the company. Read only." }$j$);
select app.ws_register($j${ "name": "company", "kind": "custom", "ord": 1, "load_fn": "ws_load_company", "apply_fn": "ws_apply_company",
  "write_caps": ["settings"], "note": "Company. One operation: { c: company, op: upsert, id: company, row: Company }." }$j$);
select app.ws_register($j${ "name": "config", "kind": "custom", "ord": 2, "load_fn": "ws_load_config", "apply_fn": "ws_apply_config",
  "write_caps": [], "note": "CompanyConfig. The config capability for everything but routing, assignLeads for routing; the tables decide." }$j$);
select app.ws_register($j${ "name": "settings", "kind": "custom", "ord": 3, "load_fn": "ws_load_settings", "apply_fn": "ws_apply_settings",
  "write_caps": ["settings"], "note": "WorkspaceSettings. consent1099 is shown, never written here." }$j$);
select app.ws_register($j${ "name": "readNotifications", "kind": "custom", "ord": 4, "load_fn": "ws_load_read_notifications",
  "apply_fn": "ws_apply_read_notifications", "write_caps": [], "needs_write": false,
  "note": "Row: { ids: [...] }, for the person signed in." }$j$);
select app.ws_register($j${ "name": "automation", "kind": "custom", "ord": 100, "load_fn": "ws_load_automation", "apply_fn": "ws_apply_automation",
  "write_caps": ["automations"], "note": "Loads as { enabled, runs }. One operation per rule: id = rule id, row = { enabled }." }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- users (TeamUser): read only here. Roles, invitations and switching a person off are protected functions.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "users", "ord": 5, "relation": "tenant_members", "read_filter": "t.role <> 'worker'", "order_by": "t.created_at, t.id",
  "fields": {
    "id": "id", "name": "name", "role": "role", "email": { "col": "email", "empty": "" }, "phone": "phone", "title": "title", "bio": "bio",
    "photo": "photo", "languages": "languages", "officeIds": { "col": "office_ids", "omit": [] },
    "active": { "kind": "expr", "sql": "pg_catalog.to_jsonb({a}.status <> 'disabled')" },
    "inLeadPool": "in_lead_pool",
    "away": { "kind": "obj", "cols": { "from": "away_from", "to": "away_to", "note": "away_note" } },
    "invitedAt": "invited_at", "lastSeen": "last_seen_at"
  } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- workers: the table for roles with "team", the directory view (0007) for the other office roles.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "workers", "variant": 1, "ord": 10, "relation": "workers", "read_caps": ["team"], "write_caps": ["team"], "delete_caps": ["delete"],
  "order_by": "t.name, t.id",
  "fields": {
    "id": "id", "name": "name", "trade": "trade", "phone": "phone", "email": "email", "payType": "pay_type", "rate": "rate",
    "w9": "w9", "w9Date": "w9_date", "coiExp": "coi_exp", "insurer": "insurer", "active": "active",
    "hasTaxId": { "kind": "expr", "sql": "nullif(pg_catalog.to_jsonb({a}.has_tax_id), 'false'::jsonb)" }
  } }$j$);
select app.ws_register($j${
  "name": "workers", "variant": 2, "ord": 10, "relation": "worker_directory", "order_by": "t.name, t.id",
  "consts": { "w9": false },
  "fields": { "id": "id", "name": "name", "trade": "trade", "phone": "phone", "email": "email", "active": "active" } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- clients. The type and last four digits of the tax ID are shown to people with "secureView" and are never written
-- here (the vault sets them). The number itself is not in any collection.
-- ---------------------------------------------------------------------------------------------------------------------
do $clients$
declare
  v_fields constant jsonb := $j${
    "id": "id", "name": "name", "company": "company", "phone": "phone", "email": "email", "addresses": "addresses", "since": "since",
    "emailOptOut": { "col": "email_opt_out", "omit": false },
    "kind": "kind", "clientType": "client_type", "birthday": "birthday", "lang": "lang",
    "smsOptIn": "sms_opt_in", "whatsappOptIn": "whatsapp_opt_in", "whatsapp": "whatsapp", "social": "social", "officeId": "office_id",
    "assignedTo": "assigned_to", "lifecycle": "lifecycle", "tags": "tags", "referredBy": "referred_by", "externalIds": "external_ids"
  }$j$;
begin
  perform app.ws_register(jsonb_build_object(
    'name', 'clients', 'variant', 1, 'ord', 20, 'relation', 'clients', 'read_caps', array['clients', 'secureView'], 'write_caps', array['clients'],
    'delete_caps', array['delete'], 'order_by', 't.name, t.id',
    'fields', v_fields || $j${ "taxIdType": { "col": "tax_id_type", "ro": true }, "taxIdLast4": { "col": "tax_id_last4", "ro": true } }$j$::jsonb));
  perform app.ws_register(jsonb_build_object(
    'name', 'clients', 'variant', 2, 'ord', 20, 'relation', 'clients', 'read_caps', array['clients'], 'write_caps', array['clients'],
    'delete_caps', array['delete'], 'order_by', 't.name, t.id',
    -- without "secureView" the two fields are simply not part of the row
    'fields', v_fields));
end
$clients$;

select app.ws_register($j${
  "name": "clients.owners", "parent": "clients", "parent_field": "owners", "parent_col": "client_id", "relation": "client_people",
  "fixed": { "role": "owner" }, "read_caps": ["clients"], "write_caps": ["clients"], "position_col": "position",
  "fields": { "id": "id", "name": "name", "title": "title", "phone": "phone", "email": "email", "pct": "pct", "primary": "is_primary" } }$j$);
select app.ws_register($j${
  "name": "clients.contacts", "parent": "clients", "parent_field": "contacts", "parent_col": "client_id", "relation": "client_people",
  "fixed": { "role": "contact" }, "read_caps": ["clients"], "write_caps": ["clients"], "position_col": "position",
  "fields": { "id": "id", "name": "name", "title": "title", "phone": "phone", "email": "email", "pct": "pct", "primary": "is_primary" } }$j$);

-- Notes of leads, clients and jobs share one table (0002); each list is the same map with its own parent column.
do $notes$
declare p text;
begin
  foreach p in array array['lead', 'client', 'job'] loop
    perform app.ws_register(jsonb_build_object(
      'name', p || 's.notes', 'parent', p || 's', 'parent_field', 'notes', 'parent_col', p || '_id', 'relation', 'notes',
      'fixed', jsonb_build_object('parent_type', p), 'write_caps', array[]::text[],
      -- removed by a role that may delete, or by the person who wrote it
      'remove_caps', array['delete'], 'own_col', 'by_member_id', 'order_by', 'c.at desc, c.id',
      'fields', $j${
        "id": "id", "at": "at", "kind": "kind", "text": "text", "pin": { "col": "pin", "omit": false },
        "by": { "col": "by_member_id", "stamp": "member" }, "mentions": "mentions" }$j$::jsonb));
  end loop;
end
$notes$;

-- ---------------------------------------------------------------------------------------------------------------------
-- leads. clientId and jobId are written last: the client and the job of a won lead usually arrive in the same request,
-- and the job points back at the lead.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "leads", "ord": 30, "relation": "leads", "read_caps": ["leads"], "write_caps": ["leads"], "delete_caps": ["delete"],
  "order_by": "t.created desc, t.ticket desc, t.id",
  "fields": {
    "id": "id", "ticket": "ticket", "name": "name", "company": "company", "phone": "phone", "email": "email", "address": "address",
    "type": "type", "source": "source", "status": "status", "pri": "pri",
    "ownerId": { "col": "owner_id", "empty": "" },
    "value": { "col": "value", "empty": null },
    "apptDate": "appt_date", "apptTime": "appt_time", "followUp": "follow_up", "created": "created",
    "clientId": { "col": "client_id", "defer": true }, "jobId": { "col": "job_id", "defer": true },
    "lostReason": "lost_reason", "lostAt": "lost_at", "sourceDetail": "source_detail",
    "nextAction": { "kind": "obj", "cols": { "text": "next_action_text", "due": "next_action_due" } },
    "lastContact": "last_contact", "originalOwnerId": "original_owner_id", "serviceIds": "service_ids", "lang": "lang", "kind": "kind",
    "smsOptIn": "sms_opt_in", "officeId": "office_id"
  } }$j$);
select app.ws_register($j${
  "name": "leads.handoffs", "parent": "leads", "parent_field": "handoffs", "parent_col": "lead_id", "relation": "lead_handoffs",
  "append_only": true, "read_caps": ["leads"], "write_caps": ["leads"], "order_by": "c.at, c.id",
  "fields": {
    "id": "id", "at": "at", "from": { "col": "from_member_id", "empty": "" }, "to": { "col": "to_member_id", "empty": "" },
    "by": { "kind": "actor", "kind_col": "by_kind", "id_col": "by_member_id" }, "reason": "reason", "how": "how"
  } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- jobs. With "money": the table, with price, payment terms, expenses and payments. Without: the staff view of 0007,
-- where the price does not exist; it is returned as 0 so the row keeps its shape, and ignored when sent back.
-- ---------------------------------------------------------------------------------------------------------------------
do $jobs$
declare
  v_fields constant jsonb := $j${
    "id": "id", "number": "number", "name": "name", "clientId": "client_id", "address": "address", "type": "type", "status": "status",
    "start": { "col": "start_date", "empty": "" }, "end": { "col": "end_date", "empty": "" },
    "repeat": "repeat", "scope": "scope", "managerId": { "col": "manager_id", "empty": "" }, "created": "created", "leadId": "lead_id",
    "serviceId": "service_id", "tierId": "tier_id", "period": "period", "parentId": { "col": "parent_id", "defer": true }, "officeId": "office_id"
  }$j$;
begin
  perform app.ws_register(jsonb_build_object(
    'name', 'jobs', 'variant', 1, 'ord', 40, 'relation', 'jobs', 'read_caps', array['jobs', 'money'], 'write_caps', array['jobs', 'money'],
    'delete_caps', array['delete'], 'order_by', 't.created desc, t.number desc, t.id',
    'fields', v_fields || $j${ "price": "price", "payTerms": "pay_terms" }$j$::jsonb));
  perform app.ws_register(jsonb_build_object(
    'name', 'jobs', 'variant', 2, 'ord', 40, 'relation', 'jobs_basic', 'base_table', 'jobs', 'read_caps', array['jobs'], 'write_caps', array['jobs'],
    'order_by', 't.created desc, t.number desc, t.id',
    'consts', $j${ "price": 0, "payTerms": "" }$j$::jsonb,
    'fields', v_fields));
end
$jobs$;

select app.ws_register($j${
  "name": "jobs.assign", "variant": 1, "parent": "jobs", "parent_field": "assign", "parent_col": "job_id", "relation": "job_assignments",
  "read_caps": ["team", "money"], "write_caps": ["team", "money"], "remove_caps": ["delete"],
  "fields": { "id": "id", "workerId": "worker_id", "scope": "scope", "price": "price", "payType": "pay_type", "rate": "rate", "qty": "qty", "status": "status" } }$j$);
select app.ws_register($j${
  "name": "jobs.assign", "variant": 2, "parent": "jobs", "parent_field": "assign", "parent_col": "job_id", "relation": "job_assignments_basic",
  "read_caps": ["jobs"], "consts": { "price": 0 },
  "fields": { "id": "id", "workerId": "worker_id", "scope": "scope", "status": "status" } }$j$);
select app.ws_register($j${
  "name": "jobs.expenses", "parent": "jobs", "parent_field": "expenses", "parent_col": "job_id", "relation": "job_expenses",
  "read_caps": ["money"], "write_caps": ["money"], "remove_caps": ["delete"], "order_by": "c.date, c.created_at, c.id",
  "fields": { "id": "id", "date": "date", "vendor": "vendor", "desc": "description", "amount": "amount" } }$j$);
select app.ws_register($j${
  "name": "jobs.received", "parent": "jobs", "parent_field": "received", "parent_col": "job_id", "relation": "client_payments",
  "read_caps": ["money"], "write_caps": ["money"], "remove_caps": ["delete"], "order_by": "c.date, c.created_at, c.id",
  "fields": { "id": "id", "date": "date", "method": "method", "ref": "ref", "amount": "amount" } }$j$);
select app.ws_register($j${
  "name": "jobs.log", "parent": "jobs", "parent_field": "log", "parent_col": "job_id", "relation": "work_logs",
  "read_caps": ["jobs"], "write_caps": ["jobs"], "remove_caps": ["delete"], "order_by": "c.date, c.created_at, c.id",
  "fields": { "id": "id", "date": "date", "workerId": "worker_id", "text": "text" } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "tasks", "ord": 50, "relation": "tasks", "read_caps": ["tasks"], "write_caps": ["tasks"], "delete_caps": ["delete"],
  "order_by": "t.created, t.created_at, t.id",
  "fields": {
    "id": "id", "title": "title", "description": "description", "jobId": "job_id", "leadId": "lead_id", "clientId": "client_id",
    "assignee": { "kind": "assignee", "member_col": "assignee_member_id", "worker_col": "assignee_worker_id" },
    "due": "due", "status": "status", "pri": "pri", "created": "created", "doneAt": "done_at", "auto": "auto",
    "type": "type", "requestedBy": "requested_by", "channel": "channel", "apptId": "appt_id"
  } }$j$);
select app.ws_register($j${
  "name": "tasks.comments", "parent": "tasks", "parent_field": "comments", "parent_col": "task_id", "relation": "task_comments",
  "read_caps": ["tasks"], "write_caps": ["tasks"], "remove_caps": ["delete"], "own_col": "by_member_id", "order_by": "c.at, c.id",
  "fields": { "id": "id", "at": "at", "by": { "col": "by_member_id", "stamp": "member" }, "text": "text", "mentions": "mentions" } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- workerPays, docs, messages
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "workerPays", "ord": 60, "relation": "worker_payments", "read_caps": ["money"], "write_caps": ["money"], "delete_caps": ["delete"],
  "order_by": "t.date, t.created_at, t.id",
  "fields": {
    "id": "id", "date": "date", "method": "method", "ref": "ref", "amount": "amount", "workerId": "worker_id",
    "jobId": { "col": "job_id", "empty": "" }, "payType": "pay_type", "from": "period_from", "to": "period_to"
  } }$j$);

-- The e-signature evidence columns of a document are written by the server alone (0003), so "esign" is returned and
-- never written through the gateway.
select app.ws_register($j${
  "name": "docs", "ord": 70, "relation": "documents", "read_caps": ["documents"], "write_caps": ["documents"], "delete_caps": ["delete"],
  "order_by": "t.created desc, t.number desc, t.id",
  "fields": {
    "id": "id", "kind": "kind", "number": "number", "title": "title",
    "jobId": { "col": "job_id", "empty": "" }, "clientId": { "col": "client_id", "empty": "" },
    "status": "status", "created": "created", "updated": "updated", "edits": { "col": "edits", "omit": {} },
    "esign": { "kind": "obj", "ro": true, "cols": {
      "signerName": "esign_signer_name", "signerEmail": "esign_signer_email", "status": "esign_status", "sentAt": "esign_sent_at",
      "viewedAt": "esign_viewed_at", "signedAt": "esign_signed_at", "typedName": "esign_typed_name", "consent": "esign_consent" } },
    "templateId": "template_id", "file": "file", "versions": "versions", "folder": "folder", "envelopeId": "envelope_id", "leadId": "lead_id"
  } }$j$);

-- A person writes drafts. provider, externalId and error come from the provider through the server.
select app.ws_register($j${
  "name": "messages", "ord": 80, "relation": "messages", "read_caps": ["comms"], "write_caps": ["comms"], "delete_caps": ["delete"],
  "order_by": "t.at desc, t.id",
  "fields": {
    "id": "id", "at": "at", "channel": "channel", "to": "recipient", "subject": "subject", "body": "body", "status": "status",
    "ref": { "kind": "ref", "type_col": "ref_type", "id_col": "ref_id" }, "auto": "auto", "dir": "dir", "from": "sender",
    "threadId": "thread_id", "clientId": "client_id", "by": { "col": "by_member_id", "stamp": "member_if_present" }, "read": "read",
    "provider": { "col": "provider", "ro": true }, "externalId": { "col": "external_id", "ro": true }, "error": { "col": "error", "ro": true },
    "seconds": "seconds", "attachments": "attachments"
  } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- activity: the history. Append only; the newest 600 entries are loaded (the app keeps the same number).
-- "by" and "at" are stamped by the database (0003): a person writes history in their own name, now.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "activity", "ord": 90, "relation": "activity", "append_only": true, "write_caps": [], "order_by": "t.at desc, t.id", "row_limit": 600,
  "fields": {
    "id": "id", "at": { "col": "at", "ro": true }, "kind": "kind", "params": { "col": "params", "omit": {} },
    "ref": { "kind": "ref", "type_col": "ref_type", "id_col": "ref_id" }, "also": { "col": "also", "omit": [] },
    "by": { "kind": "actor", "kind_col": "by_kind", "id_col": "by_id" }
  } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- automationRuns: the log of what the rules did. Embedded in "automation" when loading. Any office role with
-- "write" can record a run (a rule ran while they worked); only roles with "automations" can read the log,
-- so the second variant reads nothing.
-- ---------------------------------------------------------------------------------------------------------------------
do $runs$
declare
  v_fields constant jsonb := $j${
    "id": "id", "at": "at", "ruleId": "rule_id", "steps": "steps", "ref": { "kind": "ref", "type_col": "ref_type", "id_col": "ref_id" },
    "status": "status", "error": "error", "dedupe": "dedupe" }$j$;
begin
  perform app.ws_register(jsonb_build_object('name', 'automationRuns', 'variant', 1, 'ord', 101, 'top_level', false, 'relation', 'automation_runs',
    'append_only', true, 'read_caps', array['automations'], 'write_caps', array[]::text[], 'order_by', 't.at desc, t.id', 'row_limit', 500, 'fields', v_fields));
  perform app.ws_register(jsonb_build_object('name', 'automationRuns', 'variant', 2, 'ord', 101, 'top_level', false, 'relation', 'automation_runs',
    'append_only', true, 'write_caps', array[]::text[], 'read_filter', 'false', 'fields', v_fields));
end
$runs$;

-- ---------------------------------------------------------------------------------------------------------------------
-- audit (AuditEntry): the audit log of 0004, newest 500 entries, for people with "audit". Read only for everyone.
-- "by" is the member behind the entry when there is one, otherwise the role that acted (service_role, system).
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "audit", "ord": 900, "relation": "audit_log", "read_caps": ["audit"], "order_by": "t.at desc, t.id desc", "row_limit": 500,
  "fields": {
    "id": { "kind": "expr", "sql": "pg_catalog.to_jsonb({a}.id::text)" },
    "at": "at",
    "by": { "kind": "expr", "sql": "coalesce((select pg_catalog.to_jsonb(m.id) from public.tenant_members m where m.tenant_id = {a}.tenant_id and m.user_id = {a}.actor), pg_catalog.to_jsonb({a}.actor_role))" },
    "action": "action", "entity": "table_name", "entityId": "row_id", "ipHash": "ip_hash"
  } }$j$);

-- ---------------------------------------------------------------------------------------------------------------------
-- Module collections: announced here so ws_load returns them (empty) from the first day and the app's shape is whole.
-- The migration that builds a table registers the real collection under the same name; that replaces the placeholder.
-- ---------------------------------------------------------------------------------------------------------------------
do $pending$
declare
  v_name text;
  n integer := 0;
begin
  foreach v_name in array array[
    'offices', 'grants', 'accessRequests', 'catalog', 'playbooks', 'apptTypes', 'appointments', 'credits', 'crossSell', 'opportunities',
    'reviews', 'templates', 'envelopes', 'connections', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'reveals', 'secureLog'
  ] loop
    n := n + 1;
    perform app.ws_register(jsonb_build_object('name', v_name, 'kind', 'pending', 'ord', 200 + n));
  end loop;
end
$pending$;
