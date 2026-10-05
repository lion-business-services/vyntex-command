-- 0010 Roles and capabilities
-- A fourth office role, "readonly", and a longer list of capabilities (docs/MASTER-BUILD-SPEC.md, section 3).
-- What a role may do is no longer one fixed table: it is the matrix of the company's edition, then the company's own
-- list for that role when it has one (tenants.config -> 'roles'). The owner role always holds everything.
--
-- One source: app.edition_defaults() below holds the default matrix of each edition family. Everything else in the
-- database (app.can, app.tenants_can, the policies, the gateway) resolves through app.permissions_for().
-- supabase/tests/parity.mjs compares that source with `rolePermissions` of every pack in src/packs.
--
-- Nothing in 0001 to 0009 is edited. Functions are redefined here with the same names and arguments, so every
-- policy and view written against them keeps working and picks up the new behaviour.

-- ---------------------------------------------------------------------------------------------------------------------
-- The role list
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.tenant_members drop constraint tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check
  check (role in ('owner', 'manager', 'staff', 'readonly', 'worker'));

-- What a company changed on top of its edition (CompanyConfig in src/domain/types.ts). Empty means "as the edition ships".
-- The structure is validated by a trigger in 0011. Lead routing is NOT kept here: see public.lead_routing (0012).
alter table public.tenants add column config jsonb not null default '{}'::jsonb
  check (pg_catalog.jsonb_typeof(config) = 'object');

-- ---------------------------------------------------------------------------------------------------------------------
-- Company addresses the site keeps for itself: the first list (0001) plus the pages added by this build.
-- Keep in step with RESERVED_SLUGS and RESERVED_EXTRA in src/platform/mode.ts (parity.mjs compares with their union).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.reserved_slugs() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array[
    'demo', 'pricing', 'request-demo', 'api', 'assets', 'brand', 'login', 'logout', 'signup', 'signin', 'register',
    'auth', 'callback', 'invite', 'reset-password', 'admin', 'app', 'www', 'static', 'public', 'settings', 'account',
    'billing', 'checkout', 'pay', 'webhooks', 'support', 'help', 'docs', 'legal', 'privacy', 'terms', 'about',
    'contact', 'blog', 'status', 'health', 'new', 'onboarding', 'portal', 'worker', 'client', 'dashboard', 'sign',
    'vyntex', 'null', 'undefined',
    'preview', 'review', 'book', 'mfa'
  ]::text[]
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Capabilities
-- ---------------------------------------------------------------------------------------------------------------------

-- Every capability name, in one list. Same names and order as ALL_PERMISSIONS in src/packs/blueprint.ts.
create or replace function app.capabilities() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array[
    'leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant',
    'settings', 'compliance', 'profit', 'delete',
    'appointments', 'catalog', 'opportunities', 'reviews', 'integrations', 'social', 'comms', 'esign', 'cash', 'payroll',
    'bookkeeping', 'licensing', 'deadlines',
    'users', 'audit', 'export', 'import', 'config', 'assignLeads', 'allClients', 'credits',
    'secureView', 'secureReveal', 'secureApprove', 'write'
  ]::text[]
$$;

-- The four office roles. Field workers ("worker") hold no capability: they use the portal views and functions.
create or replace function app.office_roles() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$ select array['owner', 'manager', 'staff', 'readonly']::text[] $$;

-- 'field' for the eight editions with crews on site, 'practice' for the professional-services edition.
create or replace function app.edition_family(p_industry text) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select case when p_industry = 'practice' then 'practice' else 'field' end $$;

-- What an edition ships with, as data: the role matrix, the pipeline stages and the lead sources.
-- Labels are not kept here: they are wording and live in the packs (src/packs). The database needs the ids, and for
-- a stage its kind (open, won or lost) and the part it plays for the automations.
--   field editions     src/packs/blueprint.ts          (FIELD_ROLE_PERMISSIONS, FIELD_STAGES, FIELD_SOURCES)
--   practice edition   src/packs/practice/pack.ts          (ROLES, STAGES, leadSources)
-- "readonly" is the list of what an office person may look at; it never holds "write".
create or replace function app.edition_defaults(p_industry text) returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select case app.edition_family(p_industry)
    when 'practice' then jsonb_build_object(
      'family', 'practice',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView","reports","automations","social","delete","export","import","assignLeads","credits","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView","import","credits","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"appointment","kind":"open","role":"visit"},
        {"id":"proposal","kind":"open","role":"proposal"},
        {"id":"negotiating","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","walk_in","referral","google","facebook","instagram","whatsapp","existing_client","other"]'::jsonb)
    else jsonb_build_object(
      'family', 'field',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","reports","automations","assistant","compliance","delete","appointments","catalog","opportunities","reviews","social","comms","esign","cash","deadlines","export","assignLeads","allClients","credits","secureView","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"scheduled","kind":"open","role":"visit"},
        {"id":"sent","kind":"open","role":"proposal"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","referral","facebook","instagram","google","other"]'::jsonb)
  end
$$;

-- Default capabilities of a role in an edition.
create or replace function app.role_permissions(p_industry text, p_role text) returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(
    (select pg_catalog.array_agg(x.value order by x.ordinality)
     from pg_catalog.jsonb_array_elements_text(app.edition_defaults(p_industry) -> 'rolePermissions' -> p_role) with ordinality as x(value, ordinality)),
    array[]::text[])
$$;

-- The one-argument form from 0003 stays for whoever calls it: it now answers for the field editions, from the same source.
create or replace function app.role_permissions(p_role text) returns text[]
language sql immutable parallel safe
set search_path = ''
as $$ select app.role_permissions('build', p_role) $$;

-- What a role may do in one company: the edition's matrix, then the company's own list for that role.
--   * the owner is never reduced
--   * a company can only hand out capabilities that exist
--   * any role that is not an office role (worker, or a word we do not know) holds nothing
create or replace function app.permissions_for(p_industry text, p_config jsonb, p_role text) returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_role = 'owner' then app.capabilities()
    when p_role is null or p_role <> all (app.office_roles()) then array[]::text[]
    when pg_catalog.jsonb_typeof(p_config -> 'roles' -> p_role) = 'array' then
      coalesce(
        (select pg_catalog.array_agg(x.value)
         from pg_catalog.jsonb_array_elements_text(p_config -> 'roles' -> p_role) as x(value)
         where x.value = any (app.capabilities())),
        array[]::text[])
    else app.role_permissions(p_industry, p_role)
  end
$$;

-- Capabilities of the signed-in person in one company. Empty when they do not belong to it, are disabled, or are a worker.
create or replace function app.my_permissions(p_tenant uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select app.permissions_for(t.industry_id, t.config, m.role)
     from public.tenant_members m
     join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and t.status <> 'closed'),
    array[]::text[])
$$;

-- Does the signed-in person hold this capability in this company?
create or replace function app.can(p_tenant uuid, p_permission text) returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(p_permission = any (app.my_permissions(p_tenant)), false) $$;

-- Companies in which the signed-in person holds ALL of the listed capabilities. Once per statement (see 0003).
create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.status <> 'closed'
    and p_permissions <@ app.permissions_for(t.industry_id, t.config, m.role)
$$;

-- "Office" now includes the read-only role: it reads what office staff read. Writing is a separate question,
-- answered by the "write" capability in every write policy (0013).
create or replace function app.office_tenants() returns uuid[]
language sql stable security definer
set search_path = ''
as $$ select app.tenants_with_role('owner', 'manager', 'staff', 'readonly') $$;

create or replace function app.is_office(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.has_role(p_tenant, app.office_roles()) $$;

revoke all on function app.capabilities(), app.office_roles(), app.edition_family(text), app.edition_defaults(text),
  app.role_permissions(text, text), app.permissions_for(text, jsonb, text), app.my_permissions(uuid) from public, anon;
grant execute on function app.capabilities(), app.office_roles(), app.edition_family(text), app.edition_defaults(text),
  app.role_permissions(text, text), app.permissions_for(text, jsonb, text), app.my_permissions(uuid)
  to authenticated, service_role;
