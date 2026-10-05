-- 0037 Deadlines and the rule engine's definitions (the brief, sections 35 and 74)
--   ComplianceItem -> compliance_items     assignee = assignee_member_id (a team member)
--   RuleDef        -> rules                id = rule_id (a shipped rule keeps its name, for example "lead-intake";
--                                          a rule the company adds gets a generated id), when { event, days } =
--                                          event / days, if = conditions, then = steps
-- A rule is WHEN an event, IF conditions, THEN steps. The event is a typed column with a fixed list; conditions and
-- steps are JSON whose shape is checked by app.rule_problem(), the same lists as RuleCond and RuleStep in
-- src/domain/types.ts (supabase/tests/parity.mjs compares them). What a step does is the engine's business
-- (src/domain/rules); the database only refuses a rule the engine could not read.
-- Every run of a rule is recorded in automation_runs (0002, widened in 0012): its rule id is free text, so runs of
-- the rules defined here need nothing new, and "dedupe" keeps a rule from running twice for the same occasion.

-- ---------------------------------------------------------------------------------------------------------------------
-- compliance_items: dates the business must not miss, its own or a client's
-- ---------------------------------------------------------------------------------------------------------------------
create table public.compliance_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  title               text not null check (length(btrim(title)) between 1 and 300),
  kind                text not null default 'deadline' check (kind in ('filing', 'license', 'renewal', 'deadline', 'insurance', 'other')),
  client_id           uuid,
  job_id              uuid,
  due                 date not null,
  repeat              text check (repeat in ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  status              text not null default 'open' check (status in ('open', 'done', 'waived')),
  assignee_member_id  uuid,
  authority           text check (length(authority) <= 200),
  note                text check (length(note) <= 4000),
  done_at             date,
  -- Days before the due date to remind.
  remind              integer[] check (cardinality(remind) <= 12 and 0 <= all (remind) and 3650 >= all (remind)),
  extra               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  constraint compliance_items_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete set null (job_id),
  foreign key (tenant_id, assignee_member_id) references public.tenant_members (tenant_id, id) on delete set null (assignee_member_id)
);
create index compliance_items_client_idx on public.compliance_items (tenant_id, client_id);
create index compliance_items_job_idx on public.compliance_items (tenant_id, job_id);
create index compliance_items_assignee_idx on public.compliance_items (tenant_id, assignee_member_id);
create index compliance_items_due_idx on public.compliance_items (tenant_id, due) where status = 'open';
select app.module_table('compliance_items');

create policy compliance_items_select on public.compliance_items for select to authenticated
  using (tenant_id = any ((select app.tenants_can('deadlines'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy compliance_items_insert on public.compliance_items for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('deadlines', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy compliance_items_update on public.compliance_items for update to authenticated
  using (tenant_id = any ((select app.tenants_can('deadlines', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())))
  with check (tenant_id = any ((select app.tenants_can('deadlines', 'write'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create policy compliance_items_delete on public.compliance_items for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('deadlines', 'write', 'delete'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));
create trigger compliance_items_audit_delete after delete on public.compliance_items
  for each row execute function app.audit_row('note');

-- ---------------------------------------------------------------------------------------------------------------------
-- rules
-- ---------------------------------------------------------------------------------------------------------------------

-- The operators a condition may use and the kinds of step a rule may take: RuleCond.op and RuleStep.do in types.ts.
create or replace function app.rule_ops() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$ select array['is', 'is_not', 'in', 'gt', 'lt', 'has', 'empty', 'not_empty']::text[] $$;

create or replace function app.rule_step_kinds() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$ select array['task', 'message', 'notify', 'assign', 'stage', 'document', 'envelope', 'appointment', 'opportunity', 'review', 'tag', 'playbook', 'builtin']::text[] $$;

-- A value a condition compares with, or a parameter of a step: text, a number, true or false, or a list of texts.
create or replace function app.rule_value_ok(p jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p) in ('string', 'number', 'boolean')
      or (pg_catalog.jsonb_typeof(p) = 'array' and not exists (select 1 from pg_catalog.jsonb_array_elements(p) e where pg_catalog.jsonb_typeof(e) <> 'string'))
$$;

-- What is wrong with the conditions and steps of a rule, or NULL when the engine can read them.
create or replace function app.rule_problem(p_if jsonb, p_then jsonb) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  e jsonb;
  k text; v jsonb;
begin
  if pg_catalog.jsonb_typeof(p_if) is distinct from 'array' then return 'if must be a list of conditions'; end if;
  if pg_catalog.jsonb_typeof(p_then) is distinct from 'array' then return 'then must be a list of steps'; end if;
  if pg_catalog.jsonb_array_length(p_if) > 30 or pg_catalog.jsonb_array_length(p_then) > 30 then return 'a rule has at most 30 conditions and 30 steps'; end if;
  for e in select value from pg_catalog.jsonb_array_elements(p_if) loop
    if pg_catalog.jsonb_typeof(e) <> 'object' then return 'a condition must be an object'; end if;
    if pg_catalog.jsonb_typeof(e -> 'field') is distinct from 'string' or pg_catalog.length(e ->> 'field') not between 1 and 80 then return 'a condition names a field'; end if;
    if coalesce(e ->> 'op', '') <> all (app.rule_ops()) then return 'a condition uses an operator that does not exist'; end if;
    if e ? 'value' and e -> 'value' <> 'null'::jsonb and not app.rule_value_ok(e -> 'value') then return 'the value of a condition is text, a number, true or false, or a list of texts'; end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(e) x where x not in ('field', 'op', 'value')) then return 'a condition has field, op and value only'; end if;
  end loop;
  for e in select value from pg_catalog.jsonb_array_elements(p_then) loop
    if pg_catalog.jsonb_typeof(e) <> 'object' then return 'a step must be an object'; end if;
    if coalesce(e ->> 'do', '') <> all (app.rule_step_kinds()) then return 'a step does something that does not exist'; end if;
    if pg_catalog.jsonb_typeof(e -> 'params') is distinct from 'object' then return 'a step carries its parameters as an object'; end if;
    for k, v in select key, value from pg_catalog.jsonb_each(e -> 'params') loop
      if not app.rule_value_ok(v) then return 'a parameter of a step is text, a number, true or false, or a list of texts'; end if;
    end loop;
    if exists (select 1 from pg_catalog.jsonb_object_keys(e) x where x not in ('do', 'params')) then return 'a step has do and params only'; end if;
  end loop;
  return null;
end
$$;
revoke all on function app.rule_ops(), app.rule_step_kinds(), app.rule_value_ok(jsonb), app.rule_problem(jsonb, jsonb) from public, anon;
grant execute on function app.rule_ops(), app.rule_step_kinds(), app.rule_value_ok(jsonb), app.rule_problem(jsonb, jsonb) to authenticated, service_role;

create table public.rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  -- The id the app uses: the name of a shipped rule, or a generated id.
  rule_id     text not null check (rule_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  name        jsonb not null check (app.is_l10n(name)),
  about       jsonb check (about is null or app.is_l10n(about)),
  active      boolean not null default true,
  event       text not null check (event in (
                'lead.created', 'lead.stage', 'lead.won', 'lead.lost', 'lead.idle', 'client.created', 'job.created', 'job.status', 'job.completed',
                'payment.received', 'appointment.booked', 'appointment.paid', 'appointment.unpaid', 'appointment.completed', 'appointment.no_show',
                'appointment.cancelled', 'task.overdue', 'doc.sent', 'envelope.completed', 'envelope.idle', 'message.received', 'review.due',
                'deadline.near', 'client.birthday', 'worker.document', 'daily',
                'appointment.soon', 'appointment.pay_soon', 'opportunity.created', 'credit.expiring')),
  -- Days, for the "idle" and "near" events.
  days        integer check (days between 0 and 3650),
  conditions  jsonb not null default '[]'::jsonb,
  steps       jsonb not null default '[]'::jsonb,
  -- Shipped with the edition. It can be switched off or edited, and reset to how it shipped.
  shipped     boolean,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, rule_id),
  constraint rules_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint rules_shape check (app.rule_problem(conditions, steps) is null)
);
create index rules_event_idx on public.rules (tenant_id, event) where active;
select app.module_table('rules');

create policy rules_select on public.rules for select to authenticated
  using (tenant_id = any ((select app.tenants_can('automations'))::uuid[]));
create policy rules_insert on public.rules for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]));
create policy rules_update on public.rules for update to authenticated
  using (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('automations', 'write'))::uuid[]));
create policy rules_delete on public.rules for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('automations', 'write', 'delete'))::uuid[]));
-- a change to what the business does automatically is on record (the brief, section 60)
create trigger rules_audit after insert or update or delete on public.rules for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. Deadlines (49) after clients and jobs; rules (105) next to the automation switches (100).
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "complianceItems", "ord": 49, "relation": "compliance_items",
  "read_caps": ["deadlines"], "write_caps": ["deadlines"], "delete_caps": ["delete"], "order_by": "t.due, t.created_at, t.id",
  "fields": { "id": "id", "title": "title", "kind": "kind", "clientId": "client_id", "jobId": "job_id", "due": "due", "repeat": "repeat",
              "status": "status", "assignee": "assignee_member_id", "authority": "authority", "note": "note", "doneAt": "done_at", "remind": "remind" }
}$j$);

select app.ws_register($j${
  "name": "rules", "ord": 105, "relation": "rules", "key_col": "rule_id",
  "read_caps": ["automations"], "write_caps": ["automations"], "delete_caps": ["delete"], "order_by": "t.created_at, t.rule_id",
  "fields": { "id": "rule_id", "name": "name", "about": "about", "active": "active",
              "when": { "kind": "obj", "cols": { "event": "event", "days": "days" } },
              "if": "conditions", "then": "steps", "shipped": "shipped" }
}$j$);

select app.lockdown_check();
