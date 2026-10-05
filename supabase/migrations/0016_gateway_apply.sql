-- 0016 Gateway: writing
-- public.ws_apply(tenant, ops, key) applies a batch of changes in one transaction and says what happened to each:
--   ops     [{ "c": "<collection>", "op": "upsert" | "delete", "id": "<row id>", "row": { ...the whole row } }, ...]
--           or { "atomic": true, "ops": [...] } when the batch must be applied completely or not at all
--   key     idempotency key. The same key from the same person returns the stored answer and changes nothing.
--   answer  { ok, applied, rejected: [{ c, id, reason, detail }], server: { <collection>: [rows] }, versions: { <collection>: { <id>: <version> } } }
--
-- For every operation, in this order: the collection is looked up in the registry (0014) for the caller's
-- capabilities; "write" and the collection's own capability are checked; the row is checked (an object, the right id,
-- no other company's id inside); fields are mapped to columns and unknown fields go to "extra"; the author columns
-- are stamped from the session; nested lists are synced to their child tables by id; the statement runs as the
-- caller, so row level security, constraints, guard triggers and the audit triggers of 0004 and 0013 all apply.
-- An operation that is refused does not stop the others (unless the batch is atomic): it is listed in "rejected"
-- with a reason, and the app rolls that row back to the server's copy.
--
-- Reasons: forbidden, read_only, unknown_collection, not_ready, wrong_tenant, invalid, stale, missing_reference,
--          in_use, duplicate, append_only, rolled_back.
-- "server" holds the rows the database stored differently from what was sent (a stamped author, a rounded amount,
-- a field only the server may set) and the current copy of every row refused as stale.
-- "versions" holds the new version of every row that was applied; the app sends it back as row.updatedAt.

-- Raised inside the gateway to refuse one operation. The message is the reason, the detail says which part.
create or replace function app.ws_refuse(p_reason text, p_detail text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_reason using errcode = 'VXG02', detail = coalesce(p_detail, '');
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Nested lists: the elements of row.<field> are synced to the child table by id.
--   new id        inserted (author stamped, position kept)
--   known id      updated when something changed (never for an append-only list)
--   id missing    removed, when the caller may remove it: they hold remove_caps, or they wrote it (own_col)
-- Returns true when anything changed.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_sync_children(
  p_tenant uuid, p_perms text[], p_member uuid, cc app.ws_collections, p_parent uuid, p_list jsonb
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_drop constant text[] := app.ws_known(cc.name);
  v_existing text[];
  v_sent text[] := array[]::text[];
  v_changed boolean := false;
  v_differs boolean;
  v_token text;
  v_own boolean;
  v_id text;
  el jsonb;
  pos bigint;
  n bigint;
begin
  execute pg_catalog.format('select coalesce(pg_catalog.array_agg(t.%I::text), ''{}''::text[]) from public.%I t where t.tenant_id = $1 and t.%I = $2%s',
    cc.key_col, cc.relation, cc.parent_col, app.ws_fixed_sql(cc, 't')) into v_existing using p_tenant, p_parent;

  for el, pos in select e.value, e.ordinality from pg_catalog.jsonb_array_elements(p_list) with ordinality as e(value, ordinality) loop
    if pg_catalog.jsonb_typeof(el) <> 'object' or coalesce(el ->> 'id', '') = '' then
      perform app.ws_refuse('invalid', cc.parent_field);
    end if;
    v_id := el ->> 'id';
    if v_id = any (v_sent) then perform app.ws_refuse('invalid', cc.parent_field || ': the id ' || v_id || ' appears twice'); end if;
    v_sent := v_sent || v_id;
    if v_id = any (v_existing) then
      if cc.update_sql is null then continue; end if;
      execute cc.changed_sql into v_differs, v_token using el, v_id, p_tenant, p_member, p_parent, pos::integer, v_drop, null::text;
      if v_differs then
        execute cc.update_sql using el, v_id, p_tenant, p_member, p_parent, pos::integer, v_drop, null::text;
        get diagnostics n = row_count;
        if n = 0 then raise exception 'Not allowed' using errcode = '42501'; end if;
        v_changed := true;
      end if;
    else
      execute cc.insert_sql using el, v_id, p_tenant, p_member, p_parent, pos::integer, v_drop, null::text;
      v_changed := true;
    end if;
  end loop;

  if not cc.append_only then
    foreach v_id in array v_existing loop
      if v_id = any (v_sent) then continue; end if;
      v_own := false;
      if cc.own_col is not null then
        execute pg_catalog.format('select t.%I = $1 from public.%I t where t.tenant_id = $2 and t.%I = $3::%s', cc.own_col, cc.relation, cc.key_col, cc.key_type)
          into v_own using p_member, p_tenant, v_id;
      end if;
      if not (cc.remove_caps <@ p_perms or coalesce(v_own, false)) then
        perform app.ws_refuse('forbidden', 'remove:' || cc.parent_field);
      end if;
      execute cc.delete_sql using null::jsonb, v_id, p_tenant, p_member, p_parent, 0, v_drop, null::text;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'Not allowed' using errcode = '42501'; end if;
      v_changed := true;
    end loop;
  end if;
  return v_changed;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- One upsert. Raises to refuse it; the caller turns the error into a reason.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_upsert(p_tenant uuid, p_perms text[], p_member uuid, p_name text, p_id text, p_row jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  c app.ws_collections := app.ws_variant(p_name, p_perms);
  cc app.ws_collections;
  ch record;
  v_drop text[];
  v_differs boolean;
  v_token text;
  v_expected text := p_row ->> 'updatedAt';
  v_touched boolean := false;
  v_children boolean := false;
  n bigint;
begin
  if c.name is null then
    if exists (select 1 from app.ws_names() n where n.name = p_name) then perform app.ws_refuse('forbidden', p_name); end if;
    perform app.ws_refuse('unknown_collection', p_name);
  end if;
  if c.parent is not null then perform app.ws_refuse('unknown_collection', p_name); end if;
  if c.kind = 'pending' then perform app.ws_refuse('not_ready', p_name); end if;
  if c.needs_write and not ('write' = any (p_perms)) then perform app.ws_refuse('forbidden', 'write'); end if;
  if pg_catalog.jsonb_typeof(p_row) is distinct from 'object' then perform app.ws_refuse('invalid', 'row'); end if;
  if p_row ? 'id' and (p_row ->> 'id') is distinct from p_id then perform app.ws_refuse('invalid', 'id'); end if;
  -- a row that names another company is refused outright, whatever else it says
  if coalesce(p_row ->> 'tenantId', p_row ->> 'tenant_id', p_tenant::text) <> p_tenant::text then
    perform app.ws_refuse('wrong_tenant', p_name);
  end if;

  if c.kind = 'custom' then
    if c.apply_fn is null then perform app.ws_refuse('read_only', p_name); end if;
    if not (coalesce(c.write_caps, array[]::text[]) <@ p_perms) then perform app.ws_refuse('forbidden', p_name); end if;
    execute pg_catalog.format('select app.%I($1, $2, $3, $4)', c.apply_fn) using p_tenant, 'upsert'::text, p_id, p_row;
    return;
  end if;

  if c.write_caps is null then
    -- read only for everyone, or only for this person (another variant of the collection may be writable)
    if exists (select 1 from app.ws_names() n where n.name = p_name and n.writable) then perform app.ws_refuse('forbidden', p_name); end if;
    perform app.ws_refuse('read_only', p_name);
  end if;
  if not (c.write_caps <@ p_perms) then perform app.ws_refuse('forbidden', p_name); end if;

  v_drop := app.ws_known(c.name);

  execute c.changed_sql into v_differs, v_token using p_row, p_id, p_tenant, p_member, null::uuid, 0, v_drop, null::text;
  if v_differs is null then
    execute c.insert_sql using p_row, p_id, p_tenant, p_member, null::uuid, 0, v_drop, null::text;
    v_touched := true;
  else
    if v_expected is not null and c.has_updated and v_expected is distinct from v_token then perform app.ws_refuse('stale', p_name); end if;
    if v_differs then
      if c.append_only then perform app.ws_refuse('append_only', p_name); end if;
      -- the version is checked again inside the UPDATE, so two people saving at the same instant cannot both win
      execute c.update_sql using p_row, p_id, p_tenant, p_member, null::uuid, 0, v_drop, case when c.has_updated then v_expected end;
      get diagnostics n = row_count;
      if n = 0 then
        execute c.changed_sql into v_differs, v_token using p_row, p_id, p_tenant, p_member, null::uuid, 0, v_drop, null::text;
        if v_expected is not null and v_expected is distinct from v_token then perform app.ws_refuse('stale', p_name); end if;
        raise exception 'Not allowed' using errcode = '42501';
      end if;
      v_touched := true;
    end if;
  end if;

  for ch in select k.name, k.parent_field from app.ws_children(c.name) k loop
    if not (p_row ? ch.parent_field) then continue; end if;   -- a list that was not sent is left as it is
    cc := app.ws_variant(ch.name, p_perms);
    -- a list the person may not read or write is ignored: they were sent an empty one and cannot mean to clear it
    if cc.name is null or cc.kind <> 'table' or cc.write_caps is null or not (cc.write_caps <@ p_perms) then continue; end if;
    if pg_catalog.jsonb_typeof(p_row -> ch.parent_field) <> 'array' then perform app.ws_refuse('invalid', ch.parent_field); end if;
    if app.ws_sync_children(p_tenant, p_perms, p_member, cc, p_id::uuid, p_row -> ch.parent_field) then v_children := true; end if;
  end loop;

  -- only a nested list changed: move the version of the parent row too, so an older copy of it is seen as stale
  if v_children and not v_touched and c.has_updated then
    execute c.touch_sql using p_row, p_id, p_tenant, p_member, null::uuid, 0, v_drop, null::text;
  end if;
end
$$;

-- One delete. Deleting a row that is already gone is not an error: the result the caller wanted is there.
create or replace function app.ws_delete(p_tenant uuid, p_perms text[], p_member uuid, p_name text, p_id text) returns void
language plpgsql
set search_path = ''
as $$
declare
  c app.ws_collections := app.ws_variant(p_name, p_perms);
  v_exists boolean;
  n bigint;
begin
  if c.name is null then
    if exists (select 1 from app.ws_names() n where n.name = p_name) then perform app.ws_refuse('forbidden', p_name); end if;
    perform app.ws_refuse('unknown_collection', p_name);
  end if;
  if c.parent is not null then perform app.ws_refuse('unknown_collection', p_name); end if;
  if c.kind = 'pending' then perform app.ws_refuse('not_ready', p_name); end if;
  if c.needs_write and not ('write' = any (p_perms)) then perform app.ws_refuse('forbidden', 'write'); end if;
  if c.kind = 'custom' then
    if c.apply_fn is null then perform app.ws_refuse('read_only', p_name); end if;
    if not (coalesce(c.write_caps, array[]::text[]) <@ p_perms) then perform app.ws_refuse('forbidden', p_name); end if;
    execute pg_catalog.format('select app.%I($1, $2, $3, $4)', c.apply_fn) using p_tenant, 'delete'::text, p_id, null::jsonb;
    return;
  end if;
  if c.append_only then perform app.ws_refuse('append_only', p_name); end if;
  if c.write_caps is null and not exists (select 1 from app.ws_names() n where n.name = p_name and n.writable) then
    perform app.ws_refuse('read_only', p_name);
  end if;
  if c.write_caps is null or c.delete_caps is null or not (c.write_caps <@ p_perms) or not (c.delete_caps <@ p_perms) then
    perform app.ws_refuse('forbidden', 'delete');
  end if;
  execute c.delete_sql using null::jsonb, p_id, p_tenant, p_member, null::uuid, 0, array[]::text[], null::text;
  get diagnostics n = row_count;
  if n = 0 then
    execute c.exists_sql into v_exists using null::jsonb, p_id, p_tenant, p_member, null::uuid, 0, array[]::text[], null::text;
    if v_exists then raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The batch
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_apply_ops(p_tenant uuid, p_ops jsonb, p_atomic boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_perms constant text[] := app.my_permissions(p_tenant);
  v_member constant uuid := app.current_member(p_tenant);
  -- one entry per operation, by its place in the request: 'applied', or the refusal { reason, detail }
  v_state jsonb := '{}'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_server jsonb := '{}'::jsonb;
  v_versions jsonb := '{}'::jsonb;
  v_applied integer := 0;
  v_stored jsonb;
  v_sqlstate text; v_message text; v_detail text; v_constraint text; v_column text;
  v_reason text;
  c app.ws_collections;
  r record;
begin
  begin
    -- 1. upserts, parents before the rows that point at them
    for r in
      select o.idx, o.op ->> 'c' as c, o.op ->> 'op' as kind, o.op ->> 'id' as id, o.op -> 'row' as row,
             coalesce((select n.ord from app.ws_names() n where n.name = o.op ->> 'c'), 1000000) as ord
      from pg_catalog.jsonb_array_elements(p_ops) with ordinality as o(op, idx)
      order by 6, 1
    loop
      if pg_catalog.jsonb_typeof(p_ops -> (r.idx::integer - 1)) <> 'object' or r.c is null or coalesce(r.id, '') = '' or r.kind is null or r.kind not in ('upsert', 'delete') then
        v_state := v_state || pg_catalog.jsonb_build_object(r.idx::text, pg_catalog.jsonb_build_object('reason', 'invalid', 'detail', 'operation'));
        continue;
      end if;
      if r.kind <> 'upsert' then continue; end if;
      begin
        perform app.ws_upsert(p_tenant, v_perms, v_member, r.c, r.id, r.row);
        v_state := v_state || pg_catalog.jsonb_build_object(r.idx::text, 'applied');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail,
          v_constraint = constraint_name, v_column = column_name;
        v_reason := case
          when v_sqlstate = 'VXG02' then v_message
          when v_sqlstate = '42501' then 'forbidden'
          when v_sqlstate = '23503' then 'missing_reference'
          when v_sqlstate = '23505' then 'duplicate'
          when v_sqlstate like '23%' or v_sqlstate like '22%' then 'invalid'
        end;
        if v_reason is null then raise; end if;   -- not a refusal: a fault. Let it stop the request loudly.
        v_state := v_state || pg_catalog.jsonb_build_object(r.idx::text, pg_catalog.jsonb_build_object('reason', v_reason,
          'detail', case when v_sqlstate = 'VXG02' then v_detail else coalesce(nullif(v_constraint, ''), nullif(v_column, ''), v_sqlstate) end));
      end;
    end loop;

    -- 2. links that may point at a row from later in the same request (Lead.jobId and the job that names the lead)
    for r in
      select o.idx, o.op ->> 'c' as c, o.op ->> 'id' as id, o.op -> 'row' as row
      from pg_catalog.jsonb_array_elements(p_ops) with ordinality as o(op, idx)
      where v_state -> o.idx::text = '"applied"'::jsonb and o.op ->> 'op' = 'upsert'
      order by 1
    loop
      c := app.ws_variant(r.c, v_perms);
      if c.defer_sql is null then continue; end if;
      begin
        execute c.defer_sql using r.row, r.id, p_tenant, v_member, null::uuid, 0, array[]::text[], null::text;
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint = constraint_name;
        v_reason := case when v_sqlstate = '23503' then 'missing_reference' when v_sqlstate = '42501' then 'forbidden'
                         when v_sqlstate like '23%' or v_sqlstate like '22%' then 'invalid' end;
        if v_reason is null then raise; end if;
        v_state := v_state || pg_catalog.jsonb_build_object(r.idx::text, pg_catalog.jsonb_build_object('reason', v_reason,
          'detail', coalesce(nullif(v_constraint, ''), v_sqlstate), 'stored', true));
      end;
    end loop;

    -- 3. deletes, in the opposite order: the rows that point at something go before the thing they point at
    for r in
      select o.idx, o.op ->> 'c' as c, o.op ->> 'id' as id,
             coalesce((select n.ord from app.ws_names() n where n.name = o.op ->> 'c'), 1000000) as ord
      from pg_catalog.jsonb_array_elements(p_ops) with ordinality as o(op, idx)
      where not (v_state ? o.idx::text) and o.op ->> 'op' = 'delete'
      order by 4 desc, 1
    loop
      begin
        perform app.ws_delete(p_tenant, v_perms, v_member, r.c, r.id);
        v_state := v_state || pg_catalog.jsonb_build_object(r.idx::text, 'applied');
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail, v_constraint = constraint_name;
        v_reason := case
          when v_sqlstate = 'VXG02' then v_message
          when v_sqlstate = '42501' then 'forbidden'
          when v_sqlstate = '23503' then 'in_use'
          when v_sqlstate like '23%' or v_sqlstate like '22%' then 'invalid'
        end;
        if v_reason is null then raise; end if;
        v_state := v_state || pg_catalog.jsonb_build_object(r.idx::text, pg_catalog.jsonb_build_object('reason', v_reason,
          'detail', case when v_sqlstate = 'VXG02' then v_detail else coalesce(nullif(v_constraint, ''), v_sqlstate) end));
      end;
    end loop;

    if p_atomic and exists (select 1 from pg_catalog.jsonb_each(v_state) s where s.value <> '"applied"'::jsonb) then
      raise exception 'atomic batch refused' using errcode = 'VXG01';
    end if;
  exception when sqlstate 'VXG01' then
    -- everything this block did is undone by the database; say so for the operations that had gone through
    select coalesce(pg_catalog.jsonb_object_agg(s.key,
        case when s.value = '"applied"'::jsonb then pg_catalog.jsonb_build_object('reason', 'rolled_back', 'detail', '') else s.value - 'stored' end), '{}'::jsonb)
      into v_state from pg_catalog.jsonb_each(v_state) s;
  end;

  -- 4. the answer: what was applied, what was refused, and how the database holds the rows now
  for r in
    select o.idx, o.op ->> 'c' as c, o.op ->> 'op' as kind, o.op ->> 'id' as id, o.op -> 'row' as row, v_state -> o.idx::text as state
    from pg_catalog.jsonb_array_elements(p_ops) with ordinality as o(op, idx)
    order by 1
  loop
    if r.state = '"applied"'::jsonb then
      v_applied := v_applied + 1;
    else
      v_rejected := v_rejected || pg_catalog.jsonb_build_object('c', r.c, 'id', r.id, 'reason', r.state ->> 'reason', 'detail', coalesce(r.state ->> 'detail', ''));
    end if;
    if r.kind = 'upsert' and r.c is not null and r.id is not null
       and (r.state = '"applied"'::jsonb or r.state ->> 'reason' = 'stale' or coalesce((r.state ->> 'stored')::boolean, false)) then
      c := app.ws_variant(r.c, v_perms);
      if c.kind = 'table' then
        v_stored := app.ws_read(p_tenant, r.c, v_perms, r.id);
      elsif c.kind = 'custom' then
        v_stored := app.ws_read(p_tenant, r.c, v_perms);
      else
        v_stored := null;
      end if;
      if v_stored is null then continue; end if;
      if r.state = '"applied"'::jsonb and v_stored ? 'updatedAt' then
        v_versions := pg_catalog.jsonb_set(v_versions, array[r.c], coalesce(v_versions -> r.c, '{}'::jsonb) || pg_catalog.jsonb_build_object(r.id, v_stored -> 'updatedAt'));
      end if;
      if app.ws_norm(v_stored) is distinct from app.ws_norm(r.row) then
        v_server := pg_catalog.jsonb_set(v_server, array[r.c], coalesce(v_server -> r.c, '[]'::jsonb) || pg_catalog.jsonb_build_array(v_stored));
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('ok', pg_catalog.jsonb_array_length(v_rejected) = 0, 'applied', v_applied,
    'rejected', v_rejected, 'server', v_server, 'versions', v_versions);
end
$$;

create or replace function app.ws_apply(p_tenant uuid, p_ops jsonb, p_idem text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_role text := app.ws_gate(p_tenant);
  v_uid constant uuid := (select auth.uid());
  v_atomic boolean := false;
  v_ops jsonb := p_ops;
  v_hash text;
  v_prev record;
  v_result jsonb;
begin
  -- field workers change their own things through the portal functions (0007), never through this door
  if v_role = 'worker' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_ops) = 'object' then
    v_atomic := coalesce((p_ops ->> 'atomic')::boolean, false);
    v_ops := p_ops -> 'ops';
  end if;
  if v_ops is null or pg_catalog.jsonb_typeof(v_ops) <> 'array' then
    raise exception 'ws_apply: the changes must be a list' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(v_ops) > 1000 then
    raise exception 'ws_apply: too many changes in one request (the limit is 1000)' using errcode = '22023';
  end if;

  if p_idem is not null then
    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_ops::text, 'UTF8')), 'hex');
    -- The unique key makes a second request with the same key wait here until the first one has finished.
    insert into public.ws_requests (tenant_id, user_id, key, request_hash) values (p_tenant, v_uid, p_idem, v_hash)
      on conflict (tenant_id, user_id, key) do nothing;
    if not found then
      select q.request_hash, q.result into v_prev from public.ws_requests q
      where q.tenant_id = p_tenant and q.user_id = v_uid and q.key = p_idem;
      if v_prev.request_hash is distinct from v_hash then
        raise exception 'ws_apply: this idempotency key was already used for a different request' using errcode = '22023';
      end if;
      if v_prev.result is null then
        raise exception 'ws_apply: the first request with this key has not finished' using errcode = '55006';
      end if;
      return v_prev.result || pg_catalog.jsonb_build_object('replayed', true);
    end if;
  end if;

  v_result := app.ws_apply_ops(p_tenant, v_ops, v_atomic);

  if p_idem is not null then
    update public.ws_requests q set result = v_result where q.tenant_id = p_tenant and q.user_id = v_uid and q.key = p_idem;
  end if;
  return v_result;
end
$$;

create or replace function public.ws_apply(p_tenant uuid, p_ops jsonb, p_idem text) returns jsonb
language sql
set search_path = ''
as $$ select app.ws_apply(p_tenant, p_ops, p_idem) $$;

-- Old idempotency keys are of no use after a few days. Called by the server's cleanup job with the service key.
create or replace function public.ws_purge_requests(p_days integer default 7) returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  delete from public.ws_requests q where q.created_at < pg_catalog.now() - pg_catalog.make_interval(days => greatest(coalesce(p_days, 7), 1));
  get diagnostics n = row_count;
  return n;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Appliers of the parts of WorkspaceData that are not lists of rows. Each one is  (tenant, op, id, row) -> jsonb.
-- They run as the caller: the policies and app.tenants_guard (0013) decide, these only shape the statement.
-- ---------------------------------------------------------------------------------------------------------------------

-- company: name and the typed columns from the row, every other key into branding.
create or replace function app.ws_apply_company(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare n bigint;
begin
  if p_op <> 'upsert' then perform app.ws_refuse('forbidden', 'company'); end if;
  update public.tenants t
     set name = coalesce(nullif(pg_catalog.btrim(p_row ->> 'name'), ''), t.name),
         legal_name = p_row ->> 'legalName',
         address = p_row ->> 'address',
         website = p_row ->> 'website',
         timezone = p_row ->> 'timezone',
         branding = p_row - array['name', 'legalName', 'address', 'website', 'timezone', 'updatedAt', 'tenantId', 'tenant_id', 'id']
   where t.id = p_tenant;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Not allowed' using errcode = '42501'; end if;
  return null;
end
$$;

-- settings: the whole object, except the 1099 consent, which is recorded in consent_records and only shown here.
create or replace function app.ws_apply_settings(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare n bigint;
begin
  if p_op <> 'upsert' then perform app.ws_refuse('forbidden', 'settings'); end if;
  update public.tenants t
     set settings = p_row - array['consent1099', 'updatedAt', 'tenantId', 'tenant_id', 'id']
   where t.id = p_tenant;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Not allowed' using errcode = '42501'; end if;
  return null;
end
$$;

-- config: everything except routing goes to tenants.config (the "config" capability, and the owner for roles and
-- sign-in rules); routing goes to lead_routing ("assignLeads"). A part that did not change is not written, so a
-- person who may only change the routing can send the whole object back.
-- The turn itself (cursor) belongs to the rotation: it is returned, and ignored when sent, so an old copy of the
-- settings can never hand the same turn out twice. Changing the pool starts the rotation at its first person.
create or replace function app.ws_apply_config(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_config constant jsonb := p_row - array['routing', 'updatedAt', 'tenantId', 'tenant_id', 'id'];
  v_routing constant jsonb := p_row -> 'routing';
  v_now jsonb;
  v_pool uuid[];
  v_exclude uuid[];
  n bigint;
begin
  if p_op <> 'upsert' then perform app.ws_refuse('forbidden', 'config'); end if;
  select t.config into v_now from public.tenants t where t.id = p_tenant;
  if v_now is distinct from v_config then
    update public.tenants t set config = v_config where t.id = p_tenant;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;

  if v_routing is not null and pg_catalog.jsonb_typeof(v_routing) = 'object' then
    if coalesce(v_routing ->> 'mode', 'manual') not in ('manual', 'round_robin') then perform app.ws_refuse('invalid', 'routing.mode'); end if;
    v_pool := array(select pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_routing -> 'pool') = 'array' then v_routing -> 'pool' else '[]'::jsonb end))::uuid[];
    v_exclude := array(select pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_routing -> 'exclude') = 'array' then v_routing -> 'exclude' else '[]'::jsonb end))::uuid[];
    if not exists (select 1 from public.lead_routing r where r.tenant_id = p_tenant) then
      insert into public.lead_routing (tenant_id, mode, pool, exclude, skip_away, fallback_id, extra)
      values (p_tenant, coalesce(v_routing ->> 'mode', 'manual'), v_pool, v_exclude, coalesce((v_routing ->> 'skipAway')::boolean, true),
              nullif(v_routing ->> 'fallbackId', '')::uuid, v_routing - array['mode', 'pool', 'cursor', 'exclude', 'skipAway', 'fallbackId']);
    else
      update public.lead_routing r
         set mode = coalesce(v_routing ->> 'mode', 'manual'), pool = v_pool, exclude = v_exclude,
             skip_away = coalesce((v_routing ->> 'skipAway')::boolean, true), fallback_id = nullif(v_routing ->> 'fallbackId', '')::uuid,
             extra = v_routing - array['mode', 'pool', 'cursor', 'exclude', 'skipAway', 'fallbackId']
       where r.tenant_id = p_tenant
         and (r.mode, r.pool, r.exclude, r.skip_away, r.fallback_id, r.extra) is distinct from
             (coalesce(v_routing ->> 'mode', 'manual'), v_pool, v_exclude, coalesce((v_routing ->> 'skipAway')::boolean, true),
              nullif(v_routing ->> 'fallbackId', '')::uuid, v_routing - array['mode', 'pool', 'cursor', 'exclude', 'skipAway', 'fallbackId']);
      get diagnostics n = row_count;
      if n = 0 and exists (
        select 1 from public.lead_routing r where r.tenant_id = p_tenant
          and (r.mode, r.pool, r.exclude, r.skip_away, r.fallback_id) is distinct from
              (coalesce(v_routing ->> 'mode', 'manual'), v_pool, v_exclude, coalesce((v_routing ->> 'skipAway')::boolean, true), nullif(v_routing ->> 'fallbackId', '')::uuid)) then
        raise exception 'Not allowed' using errcode = '42501';
      end if;
    end if;
  end if;
  return null;
end
$$;

-- readNotifications: { ids: [...] } for the person signed in. Their own row; no capability is needed.
create or replace function app.ws_apply_read_notifications(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_member constant uuid := app.current_member(p_tenant);
  v_ids constant text[] := case when p_op = 'upsert' and pg_catalog.jsonb_typeof(p_row -> 'ids') = 'array'
    then array(select pg_catalog.jsonb_array_elements_text(p_row -> 'ids')) else array[]::text[] end;
begin
  if p_op = 'upsert' and pg_catalog.jsonb_typeof(p_row -> 'ids') is distinct from 'array' then perform app.ws_refuse('invalid', 'ids'); end if;
  insert into public.member_state (tenant_id, member_id, read_notifications) values (p_tenant, v_member, v_ids)
    on conflict (tenant_id, member_id) do update set read_notifications = excluded.read_notifications;
  return null;
end
$$;

-- automation: one switch per rule. The id of the operation is the rule id, the row is { enabled }.
create or replace function app.ws_apply_automation(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_op = 'delete' then
    delete from public.automation_settings s where s.tenant_id = p_tenant and s.rule_id = p_id;
    return null;
  end if;
  if pg_catalog.jsonb_typeof(p_row -> 'enabled') is distinct from 'boolean' then perform app.ws_refuse('invalid', 'enabled'); end if;
  insert into public.automation_settings (tenant_id, rule_id, enabled) values (p_tenant, p_id, (p_row ->> 'enabled')::boolean)
    on conflict (tenant_id, rule_id) do update set enabled = excluded.enabled;
  return null;
end
$$;

revoke all on function app.ws_refuse(text, text), app.ws_sync_children(uuid, text[], uuid, app.ws_collections, uuid, jsonb),
  app.ws_upsert(uuid, text[], uuid, text, text, jsonb), app.ws_delete(uuid, text[], uuid, text, text), app.ws_apply_ops(uuid, jsonb, boolean),
  app.ws_apply(uuid, jsonb, text), app.ws_apply_company(uuid, text, text, jsonb), app.ws_apply_settings(uuid, text, text, jsonb),
  app.ws_apply_config(uuid, text, text, jsonb), app.ws_apply_read_notifications(uuid, text, text, jsonb),
  app.ws_apply_automation(uuid, text, text, jsonb),
  public.ws_apply(uuid, jsonb, text), public.ws_purge_requests(integer) from public, anon, authenticated, service_role;
grant execute on function app.ws_refuse(text, text), app.ws_sync_children(uuid, text[], uuid, app.ws_collections, uuid, jsonb),
  app.ws_upsert(uuid, text[], uuid, text, text, jsonb), app.ws_delete(uuid, text[], uuid, text, text), app.ws_apply_ops(uuid, jsonb, boolean),
  app.ws_apply(uuid, jsonb, text), app.ws_apply_company(uuid, text, text, jsonb), app.ws_apply_settings(uuid, text, text, jsonb),
  app.ws_apply_config(uuid, text, text, jsonb), app.ws_apply_read_notifications(uuid, text, text, jsonb),
  app.ws_apply_automation(uuid, text, text, jsonb),
  public.ws_apply(uuid, jsonb, text) to authenticated;
grant execute on function public.ws_purge_requests(integer) to service_role;
