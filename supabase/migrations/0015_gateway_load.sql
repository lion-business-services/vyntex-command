-- 0015 Gateway: reading
-- public.ws_load(tenant) returns the WorkspaceData object of src/platform/gateway.ts: the same keys as DemoState
-- (minus the four that only exist for the demo), every list in the shape of src/domain/types.ts, camelCase.
-- What a person gets depends on their role, because every query below runs as that person:
--   * office staff and the read-only role get jobs through the staff view: price 0, no payment terms, no expenses,
--     no payments, assignments without amounts (the role views of 0007 decide, not this file)
--   * a field worker gets the portal only: their jobs, assignments, tasks, payments and their own profile
--   * clients of another office are left out (0013), and so is everything attached to them
--   * the tax ID of a client is never part of any row: only its type and last four digits
-- Lists whose tables are not built yet come back empty (registry kind "pending").

-- The gate both gateway functions pass first: the caller belongs to the company, and, when the server core range
-- (0020 and later) is installed, their session is still good and has passed the second sign-in step where the company
-- requires one (app.require_mfa). Looked up by name so this file applies with or without that range.
create or replace function app.ws_gate(p_tenant uuid) returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_role text := app.member_role(p_tenant);
begin
  if v_role is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if pg_catalog.to_regprocedure('app.require_mfa(uuid)') is not null then
    execute 'select app.require_mfa($1)' using p_tenant;
  end if;
  return v_role;
end
$$;

-- " and <alias>.<col> = '<value>'" for every fixed column of a collection.
create or replace function app.ws_fixed_sql(c app.ws_collections, p_alias text) returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.string_agg(pg_catalog.format(' and %s.%I = %L', p_alias, e.key, e.value), '' order by e.key), '')
  from pg_catalog.jsonb_each_text(c.fixed) e
$$;

-- The SQL expression that builds one row of a collection, nested lists included, for a person with these capabilities.
-- A nested list the person may not read comes back empty.
create or replace function app.ws_row_sql(c app.ws_collections, p_perms text[]) returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_sql text := case when c.has_extra then pg_catalog.format('(t.extra - %L::text[]) || ', app.ws_known(c.name)) else '' end || c.read_sql;
  ch record;
  cc app.ws_collections;
begin
  for ch in select k.name, k.parent_field from app.ws_children(c.name) k loop
    cc := app.ws_variant(ch.name, p_perms);
    if cc.name is null or cc.kind <> 'table' then
      v_sql := v_sql || pg_catalog.format(' || pg_catalog.jsonb_build_object(%L, ''[]''::jsonb)', ch.parent_field);
    else
      v_sql := v_sql || pg_catalog.format(
        ' || pg_catalog.jsonb_build_object(%L, coalesce((select pg_catalog.jsonb_agg(%s order by %s) from public.%I c where c.tenant_id = t.tenant_id and c.%I = t.%I%s%s), ''[]''::jsonb))',
        ch.parent_field, case when cc.has_extra then pg_catalog.format('(c.extra - %L::text[]) || ', app.ws_known(cc.name)) else '' end || cc.read_sql,
        coalesce(cc.order_by, case when cc.position_col is not null then pg_catalog.format('c.%I, c.created_at, c.id', cc.position_col) else 'c.created_at, c.id' end),
        cc.relation, cc.parent_col, c.key_col, app.ws_fixed_sql(cc, 'c'),
        case when cc.read_filter is not null then ' and (' || cc.read_filter || ')' else '' end);
    end if;
  end loop;
  return v_sql;
end
$$;

-- One collection as the person may see it: a list, or one row when p_id is given (NULL when it is not there).
create or replace function app.ws_read(p_tenant uuid, p_name text, p_perms text[], p_id text default null) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c app.ws_collections := app.ws_variant(p_name, p_perms);
  v_out jsonb;
  v_order text;
begin
  if c.name is null or c.kind = 'pending' then
    return case when p_id is null then '[]'::jsonb end;
  end if;
  if c.kind = 'custom' then
    execute pg_catalog.format('select app.%I($1)', c.load_fn) into v_out using p_tenant;
    return v_out;
  end if;
  if p_id is not null then
    execute pg_catalog.format('select %s from public.%I t where t.tenant_id = $1 and t.%I = $2::%s%s',
      app.ws_row_sql(c, p_perms), c.relation, c.key_col, c.key_type, app.ws_fixed_sql(c, 't'))
      into v_out using p_tenant, p_id;
    return v_out;
  end if;
  v_order := coalesce(c.order_by, pg_catalog.format('t.created_at, t.%I', c.key_col));
  execute pg_catalog.format(
    'select coalesce(pg_catalog.jsonb_agg(x.j order by x.n), ''[]''::jsonb) from ('
    || 'select %s as j, pg_catalog.row_number() over (order by %s) as n from public.%I t where t.tenant_id = $1%s%s order by %s%s) x',
    app.ws_row_sql(c, p_perms), v_order, c.relation, app.ws_fixed_sql(c, 't'),
    case when c.read_filter is not null then ' and (' || c.read_filter || ')' else '' end,
    v_order, case when c.row_limit is not null then ' limit ' || c.row_limit else '' end)
    into v_out using p_tenant;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Loaders of the parts of WorkspaceData that are not lists of rows
-- ---------------------------------------------------------------------------------------------------------------------

-- pack: the edition of the company.
create or replace function app.ws_load_pack(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$ select pg_catalog.to_jsonb(t.industry_id) from public.tenants t where t.id = p_tenant $$;

-- company: Company in types.ts. Name and the four typed columns come from the row, the rest from branding.
create or replace function app.ws_load_company(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('initials', '', 'license', '', 'phone', '', 'email', '')
      || t.branding
      || app.ws_drop_nulls(pg_catalog.jsonb_build_object(
           'name', t.name, 'legalName', t.legal_name, 'address', t.address, 'website', t.website, 'timezone', t.timezone))
  from public.tenants t where t.id = p_tenant
$$;

-- config: CompanyConfig. The routing part is read from lead_routing, where the turn is kept.
create or replace function app.ws_load_config(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select t.config || coalesce(
    (select pg_catalog.jsonb_build_object('routing',
        r.extra
        || pg_catalog.jsonb_build_object('mode', r.mode, 'pool', pg_catalog.to_jsonb(r.pool), 'cursor', r.cursor,
             'exclude', pg_catalog.to_jsonb(r.exclude), 'skipAway', r.skip_away)
        || app.ws_drop_nulls(pg_catalog.jsonb_build_object('fallbackId', r.fallback_id)))
     from public.lead_routing r where r.tenant_id = t.id),
    '{}'::jsonb)
  from public.tenants t where t.id = p_tenant
$$;

-- settings: WorkspaceSettings. The 1099 consent is evidence and lives in consent_records (0006); it is shown here
-- (who and when) for the people who may read it, and can never be written through the settings.
create or replace function app.ws_load_settings(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select (t.settings - 'consent1099') || coalesce(
    (select pg_catalog.jsonb_build_object('consent1099', pg_catalog.jsonb_build_object('name', c.subject_name, 'at', app.ws_iso(c.granted_at)))
     from public.consent_records c
     where c.tenant_id = t.id and c.kind = 'share_1099_data' and c.revoked_at is null
       and (c.expires_at is null or c.expires_at > pg_catalog.now())
     order by c.granted_at desc limit 1),
    '{}'::jsonb)
  from public.tenants t where t.id = p_tenant
$$;

-- automation: { enabled: { <rule id>: true | false }, runs: [...] }
create or replace function app.ws_load_automation(p_tenant uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_perms text[] := app.my_permissions(p_tenant);
begin
  return pg_catalog.jsonb_build_object(
    'enabled', coalesce((select pg_catalog.jsonb_object_agg(s.rule_id, s.enabled) from public.automation_settings s where s.tenant_id = p_tenant), '{}'::jsonb),
    'runs', app.ws_read(p_tenant, 'automationRuns', v_perms));
end
$$;

-- readNotifications: the notification ids this person dismissed.
create or replace function app.ws_load_read_notifications(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select pg_catalog.to_jsonb(s.read_notifications) from public.member_state s
     where s.tenant_id = p_tenant and s.member_id = app.current_member(p_tenant)),
    '[]'::jsonb)
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The worker portal. Written out by hand: a worker reads the portal views and their own rows, nothing else, and the
-- registry (built for office roles) is not consulted. Every other list is present and empty so the shape is the same.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_load_worker(p_tenant uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  r record;
begin
  -- every list the office gets, empty
  for r in select n.name from app.ws_names() n where n.top_level loop
    v_out := v_out || pg_catalog.jsonb_build_object(r.name, '[]'::jsonb);
  end loop;
  return v_out || pg_catalog.jsonb_build_object(
    'pack', (select pg_catalog.to_jsonb(w.industry_id) from public.my_workspaces() w where w.tenant_id = p_tenant),
    'company', (
      select pg_catalog.jsonb_build_object('initials', '', 'license', '', 'phone', '', 'email', '')
          || (w.branding - 'accent') || pg_catalog.jsonb_build_object('name', w.name)
      from public.my_workspaces() w where w.tenant_id = p_tenant),
    'config', '{}'::jsonb,
    'settings', '{}'::jsonb,
    'automation', pg_catalog.jsonb_build_object('enabled', '{}'::jsonb, 'runs', '[]'::jsonb),
    'readNotifications', app.ws_load_read_notifications(p_tenant),
    'workers', coalesce((
      select pg_catalog.jsonb_agg(app.ws_drop_nulls(pg_catalog.jsonb_build_object(
        'id', p.id, 'name', p.name, 'trade', p.trade, 'phone', p.phone, 'email', p.email, 'w9', p.w9, 'w9Date', p.w9_date,
        'coiExp', p.coi_exp, 'insurer', p.insurer, 'active', p.active, 'hasTaxId', nullif(p.has_tax_id, false))))
      from public.my_worker_profile p where p.tenant_id = p_tenant), '[]'::jsonb),
    'jobs', coalesce((
      select pg_catalog.jsonb_agg(
        app.ws_drop_nulls(pg_catalog.jsonb_build_object('id', j.id, 'number', j.number, 'name', j.name, 'address', j.address, 'type', j.type,
          'status', j.status, 'repeat', j.repeat))
        || pg_catalog.jsonb_build_object('clientId', '', 'price', 0, 'scope', '', 'payTerms', '', 'managerId', '',
          'start', coalesce(j.start_date::text, ''), 'end', coalesce(j.end_date::text, ''), 'created', coalesce(j.start_date::text, ''),
          'expenses', '[]'::jsonb, 'received', '[]'::jsonb, 'notes', '[]'::jsonb,
          'assign', coalesce((
            select pg_catalog.jsonb_agg(app.ws_drop_nulls(pg_catalog.jsonb_build_object('id', a.id, 'workerId', a.worker_id, 'scope', a.scope,
              'price', a.price, 'payType', a.pay_type, 'rate', a.rate, 'qty', a.qty, 'status', a.status)) order by a.created_at, a.id)
            from public.job_assignments a where a.tenant_id = j.tenant_id and a.job_id = j.id), '[]'::jsonb),
          'log', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.id, 'date', g.date, 'workerId', g.worker_id, 'text', g.text) order by g.date, g.created_at, g.id)
            from public.work_logs g where g.tenant_id = j.tenant_id and g.job_id = j.id), '[]'::jsonb))
        order by j.start_date nulls last, j.number)
      from public.my_jobs j where j.tenant_id = p_tenant), '[]'::jsonb),
    'tasks', coalesce((
      select pg_catalog.jsonb_agg(app.ws_drop_nulls(pg_catalog.jsonb_build_object('id', k.id, 'title', k.title, 'description', k.description,
        'jobId', k.job_id, 'assignee', 'w:' || k.assignee_worker_id::text, 'due', k.due, 'status', k.status, 'pri', k.pri, 'created', k.created,
        'doneAt', k.done_at)) order by k.due nulls last, k.created_at, k.id)
      from public.tasks k where k.tenant_id = p_tenant and k.assignee_worker_id = app.current_worker(p_tenant)), '[]'::jsonb),
    'workerPays', coalesce((
      select pg_catalog.jsonb_agg(app.ws_drop_nulls(pg_catalog.jsonb_build_object('id', p.id, 'date', p.date, 'method', p.method, 'ref', p.ref,
        'amount', p.amount, 'workerId', p.worker_id, 'payType', p.pay_type, 'from', p.period_from, 'to', p.period_to))
        || pg_catalog.jsonb_build_object('jobId', coalesce(p.job_id::text, '')) order by p.date, p.created_at, p.id)
      from public.worker_payments p where p.tenant_id = p_tenant and p.worker_id = app.current_worker(p_tenant)), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.ws_load() and its public wrapper
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_load(p_tenant uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_role text := app.ws_gate(p_tenant);
  v_perms text[];
  v_keys text[] := array[]::text[];
  v_values jsonb[] := array[]::jsonb[];
  v_out jsonb;
  r record;
begin
  if v_role = 'worker' then
    return app.ws_load_worker(p_tenant);
  end if;
  v_perms := app.my_permissions(p_tenant);
  -- the parts are collected and joined once at the end: adding each to a growing object would copy it every time
  for r in select n.name from app.ws_names() n where n.top_level order by n.ord, n.name loop
    v_keys := v_keys || r.name;
    v_values := v_values || app.ws_read(p_tenant, r.name, v_perms);
  end loop;
  select pg_catalog.jsonb_object_agg(x.k, x.v) into v_out from unnest(v_keys, v_values) as x(k, v);
  return v_out;
end
$$;

-- Who is signed in and where: WorkspaceSession in src/platform/gateway.ts, plus the capabilities the person holds.
create or replace function app.ws_session(p_tenant uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform app.ws_gate(p_tenant);
  select pg_catalog.jsonb_build_object(
      'tenantId', w.tenant_id, 'slug', w.slug, 'name', w.name, 'industry', w.industry_id, 'planId', w.plan_id, 'status', w.status,
      'role', w.role, 'memberId', w.member_id, 'workerId', w.worker_id, 'actorId', coalesce(w.worker_id, w.member_id),
      'permissions', pg_catalog.to_jsonb(app.my_permissions(p_tenant)))
    into v_out
  from public.my_workspaces() w where w.tenant_id = p_tenant;
  return v_out;
end
$$;

-- Clients of other offices: the name and the office only, so the person can ask for access (src/domain/access.ts,
-- hiddenClients). Nothing else about them is returned. SECURITY DEFINER because it reads rows the caller may not open;
-- it answers only for a person who holds "clients" in that company.
create or replace function app.ws_hidden_clients(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.can(p_tenant, 'clients') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name, 'officeId', c.office_id) order by c.name, c.id)
    from public.clients c
    where c.tenant_id = p_tenant and c.id = any (app.hidden_client_ids())), '[]'::jsonb);
end
$$;

create or replace function public.ws_load(p_tenant uuid) returns jsonb
language sql
set search_path = ''
as $$ select app.ws_load(p_tenant) $$;

create or replace function public.ws_session(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$ select app.ws_session(p_tenant) $$;

create or replace function public.ws_hidden_clients(p_tenant uuid) returns jsonb
language sql stable
set search_path = ''
as $$ select app.ws_hidden_clients(p_tenant) $$;

revoke all on function app.ws_gate(uuid), app.ws_fixed_sql(app.ws_collections, text), app.ws_row_sql(app.ws_collections, text[]),
  app.ws_read(uuid, text, text[], text), app.ws_load_pack(uuid), app.ws_load_company(uuid), app.ws_load_config(uuid),
  app.ws_load_settings(uuid), app.ws_load_automation(uuid), app.ws_load_read_notifications(uuid), app.ws_load_worker(uuid),
  app.ws_load(uuid), app.ws_session(uuid), app.ws_hidden_clients(uuid),
  public.ws_load(uuid), public.ws_session(uuid), public.ws_hidden_clients(uuid) from public, anon, authenticated, service_role;
grant execute on function app.ws_gate(uuid), app.ws_fixed_sql(app.ws_collections, text), app.ws_row_sql(app.ws_collections, text[]),
  app.ws_read(uuid, text, text[], text), app.ws_load_pack(uuid), app.ws_load_company(uuid), app.ws_load_config(uuid),
  app.ws_load_settings(uuid), app.ws_load_automation(uuid), app.ws_load_read_notifications(uuid), app.ws_load_worker(uuid),
  app.ws_load(uuid), app.ws_session(uuid), app.ws_hidden_clients(uuid),
  public.ws_load(uuid), public.ws_session(uuid), public.ws_hidden_clients(uuid) to authenticated;
