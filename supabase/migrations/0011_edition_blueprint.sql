-- 0011 The edition blueprint in the database
-- A company's pipeline stages and lead sources are configuration now (the owner's brief, section 7: "editable
-- configuration rather than hard-coded permanent values"). This file:
--   * validates the structure of tenants.config (CompanyConfig in src/domain/types.ts)
--   * answers "which stages and sources does this company have" from the edition and the company's own lists
--   * replaces the fixed CHECK lists on leads.status and leads.source with validation against that answer
--
-- Code that needs to know whether a lead is open, won or lost asks app.stage_kind(); it never compares with 'won'.

-- ---------------------------------------------------------------------------------------------------------------------
-- Small validators used by app.config_problem()
-- ---------------------------------------------------------------------------------------------------------------------

-- Ids of stages, sources, reasons and types: short, lowercase, safe to use in an address or a file name.
create or replace function app.is_option_id(p_id text) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$ select p_id is not null and p_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$' $$;

-- Text in several languages: an object with at least English and Spanish, every value a string.
create or replace function app.is_l10n(p_label jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_label) = 'object'
     and pg_catalog.jsonb_typeof(p_label -> 'en') = 'string'
     and pg_catalog.jsonb_typeof(p_label -> 'es') = 'string'
     and not exists (
       select 1 from pg_catalog.jsonb_each(p_label) e
       where e.key not in ('en', 'es', 'zh') or pg_catalog.jsonb_typeof(e.value) <> 'string'),
    false)
$$;

-- A list of { id, label } (OptionDef). Returns what is wrong with it, or NULL.
create or replace function app.option_list_problem(p_list jsonb, p_name text) returns text
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  e jsonb;
  seen text[] := array[]::text[];
begin
  if p_list is null then return null; end if;
  if pg_catalog.jsonb_typeof(p_list) <> 'array' then return p_name || ' must be a list'; end if;
  for e in select value from pg_catalog.jsonb_array_elements(p_list) loop
    if pg_catalog.jsonb_typeof(e) <> 'object' then return p_name || ': every entry must be an object'; end if;
    if not app.is_option_id(e ->> 'id') then return p_name || ': an entry has no valid id'; end if;
    if (e ->> 'id') = any (seen) then return p_name || ': the id "' || (e ->> 'id') || '" is used twice'; end if;
    if not app.is_l10n(e -> 'label') then return p_name || ': "' || (e ->> 'id') || '" needs a label in English and Spanish'; end if;
    seen := seen || (e ->> 'id');
  end loop;
  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.config_problem(): what is wrong with a company configuration, or NULL when it is valid.
-- Checked here: stage ids unique, at least one open, one won and one lost stage, known role names, known capability
-- names, and the shape of every other part of CompanyConfig. A part the database does not know yet is left alone
-- (the app may add one; it is still stored and returned), but a known part must be right.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.config_problem(p_config jsonb) returns text
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  e jsonb;
  k text;
  v jsonb;
  seen text[] := array[]::text[];
  n_open int := 0; n_won int := 0; n_lost int := 0;
  problem text;
begin
  if p_config is null or pg_catalog.jsonb_typeof(p_config) <> 'object' then return 'the configuration must be an object'; end if;
  if pg_catalog.octet_length(p_config::text) > 200000 then return 'the configuration is too large'; end if;

  -- leadStages: an empty list means "as the edition ships"
  v := p_config -> 'leadStages';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'array' then return 'leadStages must be a list'; end if;
    for e in select value from pg_catalog.jsonb_array_elements(v) loop
      if pg_catalog.jsonb_typeof(e) <> 'object' then return 'leadStages: every stage must be an object'; end if;
      if not app.is_option_id(e ->> 'id') then return 'leadStages: a stage has no valid id'; end if;
      if (e ->> 'id') = any (seen) then return 'leadStages: the id "' || (e ->> 'id') || '" is used twice'; end if;
      if not app.is_l10n(e -> 'label') then return 'leadStages: "' || (e ->> 'id') || '" needs a label in English and Spanish'; end if;
      if coalesce(e ->> 'kind', '') not in ('open', 'won', 'lost') then return 'leadStages: "' || (e ->> 'id') || '" must be open, won or lost'; end if;
      if e ? 'role' and (e ->> 'role') not in ('new', 'contacted', 'visit', 'proposal', 'negotiation') then
        return 'leadStages: "' || (e ->> 'id') || '" has an unknown role';
      end if;
      if e ? 'hot' and pg_catalog.jsonb_typeof(e -> 'hot') <> 'boolean' then return 'leadStages: hot must be true or false'; end if;
      seen := seen || (e ->> 'id');
      case e ->> 'kind' when 'open' then n_open := n_open + 1; when 'won' then n_won := n_won + 1; else n_lost := n_lost + 1; end case;
    end loop;
    if pg_catalog.cardinality(seen) > 0 and (n_open = 0 or n_won = 0 or n_lost = 0) then
      return 'leadStages needs at least one open stage, one won stage and one lost stage';
    end if;
    if pg_catalog.cardinality(seen) > 40 then return 'leadStages: too many stages'; end if;
  end if;

  problem := coalesce(
    app.option_list_problem(p_config -> 'leadSources', 'leadSources'),
    app.option_list_problem(p_config -> 'lostReasons', 'lostReasons'),
    app.option_list_problem(p_config -> 'taskTypes', 'taskTypes'),
    app.option_list_problem(p_config -> 'clientTypes', 'clientTypes'));
  if problem is not null then return problem; end if;
  -- the plain task type always exists
  if pg_catalog.jsonb_typeof(p_config -> 'taskTypes') = 'array' and pg_catalog.jsonb_array_length(p_config -> 'taskTypes') > 0
     and not exists (select 1 from pg_catalog.jsonb_array_elements(p_config -> 'taskTypes') t where t.value ->> 'id' = 'todo') then
    return 'taskTypes must include "todo"';
  end if;

  -- roleLabels: known role names, labels in both languages
  v := p_config -> 'roleLabels';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'roleLabels must be an object'; end if;
    for k, e in select key, value from pg_catalog.jsonb_each(v) loop
      if k <> all (app.office_roles()) then return 'roleLabels: "' || k || '" is not a role'; end if;
      if not app.is_l10n(e) then return 'roleLabels: "' || k || '" needs a label in English and Spanish'; end if;
    end loop;
  end if;

  -- roles: capability lists per role. The owner cannot be listed (never reduced). Read only never gains "write".
  v := p_config -> 'roles';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'roles must be an object'; end if;
    for k, e in select key, value from pg_catalog.jsonb_each(v) loop
      if k = 'owner' then return 'roles: the owner role cannot be changed'; end if;
      if k <> all (app.office_roles()) then return 'roles: "' || k || '" is not a role'; end if;
      if pg_catalog.jsonb_typeof(e) <> 'array' then return 'roles: "' || k || '" must be a list of capabilities'; end if;
      if exists (select 1 from pg_catalog.jsonb_array_elements(e) c where pg_catalog.jsonb_typeof(c.value) <> 'string') then
        return 'roles: "' || k || '" must be a list of capability names';
      end if;
      select c.value into problem from pg_catalog.jsonb_array_elements_text(e) c where c.value <> all (app.capabilities()) limit 1;
      if problem is not null then return 'roles: "' || problem || '" is not a capability'; end if;
      if k = 'readonly' and (e ? 'write' or e ? 'delete') then return 'roles: the read only role cannot write or delete'; end if;
    end loop;
  end if;

  -- modules: screen id -> on or off
  v := p_config -> 'modules';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'modules must be an object'; end if;
    if exists (select 1 from pg_catalog.jsonb_each(v) m where m.key !~ '^[a-z][A-Za-z0-9]{0,39}$' or pg_catalog.jsonb_typeof(m.value) <> 'boolean') then
      return 'modules: every entry must be a screen id with true or false';
    end if;
  end if;

  -- terms: language -> key -> wording
  v := p_config -> 'terms';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'terms must be an object'; end if;
    for k, e in select key, value from pg_catalog.jsonb_each(v) loop
      if k not in ('en', 'es', 'zh') then return 'terms: "' || k || '" is not a language'; end if;
      if pg_catalog.jsonb_typeof(e) <> 'object'
         or exists (select 1 from pg_catalog.jsonb_each(e) w where pg_catalog.jsonb_typeof(w.value) <> 'string') then
        return 'terms: "' || k || '" must map keys to wording';
      end if;
    end loop;
  end if;

  -- routing lives in public.lead_routing, where the turn can be locked. Two homes would drift apart.
  if p_config ? 'routing' then return 'routing is kept in lead_routing, not in the configuration'; end if;

  v := p_config -> 'appointments';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'appointments must be an object'; end if;
    if v ? 'noDoubleBooking' and pg_catalog.jsonb_typeof(v -> 'noDoubleBooking') <> 'boolean' then return 'appointments.noDoubleBooking must be true or false'; end if;
    if v ? 'prepayHours' and (pg_catalog.jsonb_typeof(v -> 'prepayHours') <> 'number' or (v ->> 'prepayHours')::numeric not between 0 and 8760) then return 'appointments.prepayHours is out of range'; end if;
    if v ? 'creditDays' and (pg_catalog.jsonb_typeof(v -> 'creditDays') <> 'number' or (v ->> 'creditDays')::numeric not between 0 and 3650) then return 'appointments.creditDays is out of range'; end if;
  end if;

  v := p_config -> 'vault';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'vault must be an object'; end if;
    if v ? 'approval' and coalesce(v ->> 'approval', '') not in ('second_person', 'step_up') then return 'vault.approval must be second_person or step_up'; end if;
    if v ? 'revealSeconds' and (pg_catalog.jsonb_typeof(v -> 'revealSeconds') <> 'number' or (v ->> 'revealSeconds')::numeric not between 5 and 600) then return 'vault.revealSeconds is out of range'; end if;
  end if;

  v := p_config -> 'security';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'security must be an object'; end if;
    if v ? 'idleMinutes' and (pg_catalog.jsonb_typeof(v -> 'idleMinutes') <> 'number' or (v ->> 'idleMinutes')::numeric not between 5 and 1440) then return 'security.idleMinutes is out of range'; end if;
    if v ? 'mfaRoles' and (pg_catalog.jsonb_typeof(v -> 'mfaRoles') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(v -> 'mfaRoles') r
                   where pg_catalog.jsonb_typeof(r.value) <> 'string' or (r.value #>> '{}') <> all (app.office_roles()))) then
      return 'security.mfaRoles must be a list of roles';
    end if;
  end if;

  v := p_config -> 'hours';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'object' then return 'hours must be an object'; end if;
    if pg_catalog.jsonb_typeof(v -> 'days') <> 'array'
       or exists (select 1 from pg_catalog.jsonb_array_elements(v -> 'days') d where pg_catalog.jsonb_typeof(d.value) <> 'number' or (d.value #>> '{}') not in ('0', '1', '2', '3', '4', '5', '6')) then
      return 'hours.days must be a list of week days (0 to 6)';
    end if;
    if coalesce(v ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return 'hours.open and hours.close must be times (HH:MM)';
    end if;
  end if;

  -- quickLinks: only web addresses. A link that runs script in the browser can never be saved.
  v := p_config -> 'quickLinks';
  if v is not null then
    if pg_catalog.jsonb_typeof(v) <> 'array' then return 'quickLinks must be a list'; end if;
    if pg_catalog.jsonb_array_length(v) > 30 then return 'quickLinks: too many links'; end if;
    for e in select value from pg_catalog.jsonb_array_elements(v) loop
      if pg_catalog.jsonb_typeof(e) <> 'object' or coalesce(e ->> 'id', '') = '' or not app.is_l10n(e -> 'label') then
        return 'quickLinks: every link needs an id and a label in English and Spanish';
      end if;
      if coalesce(e ->> 'url', '') !~* '^https?://[^[:space:]]+$' then return 'quickLinks: a link must be a web address (http or https)'; end if;
    end loop;
  end if;

  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Stages and sources of one edition and configuration (pure), and of one company (reads the company row).
-- ---------------------------------------------------------------------------------------------------------------------

-- The stages in force: the company's own list when it has one, otherwise the edition's. [{ id, kind, role? }, ...]
create or replace function app.stages_of(p_industry text, p_config jsonb) returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_config -> 'leadStages') = 'array' and pg_catalog.jsonb_array_length(p_config -> 'leadStages') > 0
      then p_config -> 'leadStages'
    else app.edition_defaults(p_industry) -> 'leadStages'
  end
$$;

-- The source ids in force.
create or replace function app.sources_of(p_industry text, p_config jsonb) returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_config -> 'leadSources') = 'array' and pg_catalog.jsonb_array_length(p_config -> 'leadSources') > 0
      then array(select s.value ->> 'id' from pg_catalog.jsonb_array_elements(p_config -> 'leadSources') s)
    else array(select pg_catalog.jsonb_array_elements_text(app.edition_defaults(p_industry) -> 'leadSources'))
  end
$$;

-- SECURITY DEFINER: these are called from triggers and from server code on behalf of people who may not read the
-- company row themselves (a worker, the service role acting for a web form). They return configuration, never data.
create or replace function app.tenant_stages(p_tenant uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$ select app.stages_of(t.industry_id, t.config) from public.tenants t where t.id = p_tenant $$;

-- 'open', 'won' or 'lost' for a stage of this company. NULL when the company has no such stage.
create or replace function app.stage_kind(p_tenant uuid, p_stage text) returns text
language sql stable security definer
set search_path = ''
as $$
  select s.value ->> 'kind'
  from pg_catalog.jsonb_array_elements(app.tenant_stages(p_tenant)) s
  where s.value ->> 'id' = p_stage
  limit 1
$$;

create or replace function app.tenant_sources(p_tenant uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$ select app.sources_of(t.industry_id, t.config) from public.tenants t where t.id = p_tenant $$;

revoke all on function app.is_option_id(text), app.is_l10n(jsonb), app.option_list_problem(jsonb, text), app.config_problem(jsonb),
  app.stages_of(text, jsonb), app.sources_of(text, jsonb), app.tenant_stages(uuid), app.stage_kind(uuid, text), app.tenant_sources(uuid)
  from public, anon;
grant execute on function app.is_option_id(text), app.is_l10n(jsonb), app.option_list_problem(jsonb, text), app.config_problem(jsonb),
  app.stages_of(text, jsonb), app.sources_of(text, jsonb), app.tenant_stages(uuid), app.stage_kind(uuid, text), app.tenant_sources(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- tenants.config: validated on the way in, for every caller.
-- A stage or source that leads still use cannot be removed: move the leads first. Otherwise a lead would sit in a
-- stage the company no longer has, and nothing could say whether it is open, won or lost.
-- SECURITY DEFINER: the "still in use" check must see every lead of the company, including leads of an office the
-- person saving the configuration cannot open.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.tenants_config_check() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_problem text;
  v_stuck text;
begin
  if tg_op = 'UPDATE' and new.config is not distinct from old.config and new.industry_id is not distinct from old.industry_id then
    return new;
  end if;
  v_problem := app.config_problem(new.config);
  if v_problem is not null then
    raise exception 'Company configuration: %', v_problem using errcode = '23514', constraint = 'tenants_config_valid';
  end if;
  if tg_op = 'UPDATE' then
    select l.status into v_stuck from public.leads l
    where l.tenant_id = new.id
      and l.status <> all (array(select s.value ->> 'id' from pg_catalog.jsonb_array_elements(app.stages_of(new.industry_id, new.config)) s))
    limit 1;
    if v_stuck is not null then
      raise exception 'Company configuration: the stage "%" still has leads in it. Move them first.', v_stuck
        using errcode = '23514', constraint = 'tenants_config_stage_in_use';
    end if;
    select l.source into v_stuck from public.leads l
    where l.tenant_id = new.id and l.source <> all (app.sources_of(new.industry_id, new.config))
    limit 1;
    if v_stuck is not null then
      raise exception 'Company configuration: the source "%" is still used by leads.', v_stuck
        using errcode = '23514', constraint = 'tenants_config_source_in_use';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.tenants_config_check() from public, anon, authenticated, service_role;
create trigger tenants_config_check before insert or update of config, industry_id on public.tenants
  for each row execute function app.tenants_config_check();

-- ---------------------------------------------------------------------------------------------------------------------
-- leads.status and leads.source: checked against the company's stages and sources instead of a fixed list.
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.leads drop constraint leads_status_check;
alter table public.leads drop constraint leads_source_check;

create or replace function app.leads_validate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if app.stage_kind(new.tenant_id, new.status) is null then
      raise exception 'Lead stage "%" is not one of this company''s stages', new.status
        using errcode = '23514', constraint = 'leads_status_configured';
    end if;
  end if;
  if tg_op = 'INSERT' or new.source is distinct from old.source then
    if new.source <> all (app.tenant_sources(new.tenant_id)) then
      raise exception 'Lead source "%" is not one of this company''s sources', new.source
        using errcode = '23514', constraint = 'leads_source_configured';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.leads_validate() from public, anon;
create trigger leads_validate before insert or update of status, source on public.leads
  for each row execute function app.leads_validate();
