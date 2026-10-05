-- 0014 Gateway: the collection registry
-- The gateway (docs/MASTER-BUILD-SPEC.md, section 7) is two functions the server calls with the person's own token:
--   ws_load(tenant)             everything the person may see, shaped exactly like WorkspaceData in the app
--   ws_apply(tenant, ops, key)  a batch of changes: { c: collection, op: 'upsert' | 'delete', id, row }
-- Neither function knows any collection by name. They read this registry: one row per collection (and per variant
-- of it) that says which table it lives in, which capability reads and writes it, how the fields of the app's row
-- map to columns, and which nested lists it carries. A later migration adds a collection by calling
-- app.ws_register() once; nothing in this range has to be edited. The recipe is in docs/DATABASE.md.
--
-- Security model: the gateway functions are SECURITY INVOKER. Every statement they run is run as the signed-in
-- person, so row level security, column privileges and the guard triggers apply exactly as if the person had
-- written to the table directly. The capability checks in the gateway are there to give a clear answer early;
-- the tables stay the judge. The registry itself is data owned by the migration role: no application role holds any
-- privilege on it and it has no policy (the rule for every table in schema app). The gateway reads it through the
-- small SECURITY DEFINER functions at the end of this file, and nobody but a migration can change it, so the SQL
-- it holds is never influenced by a request.

create table app.ws_collections (
  -- Key in WorkspaceData ('leads'), or '<parent>.<field>' for a nested list ('leads.notes').
  name          text not null,
  -- Variants are tried in order; the first one whose read_caps the person holds is used. This is how office staff
  -- get jobs through the view without prices while a manager gets the table.
  variant       smallint not null default 1,
  -- table:   rows of one table or view, mapped by "fields"
  -- custom:  loaded and applied by the functions named in load_fn / apply_fn (singletons such as the company record)
  -- pending: announced, table not built yet. Loads as an empty list, refuses writes with "not_ready".
  kind          text not null default 'table' check (kind in ('table', 'custom', 'pending')),
  -- Apply order: a collection is applied after the collections its rows point at (clients before jobs).
  ord           integer not null default 500,
  -- Appears as a key of ws_load. False for nested lists and for collections another loader embeds.
  top_level     boolean not null default true,
  -- Table or view in schema public that is read and written.
  relation      text,
  -- When relation is a view: the table underneath, where column types and defaults are taken from.
  base_table    text,
  -- Column that holds the row id the app uses.
  key_col       text not null default 'id',
  -- Capabilities needed to read this variant (all of them). Empty = any office role.
  read_caps     text[] not null default '{}'::text[],
  -- Capabilities needed to write, besides "write". NULL = this variant is read only.
  write_caps    text[],
  -- Capabilities needed to delete a row, besides those for writing. NULL = rows cannot be deleted through the gateway.
  delete_caps   text[],
  -- False for the few things a read-only person may still save for themselves (dismissed notifications).
  needs_write   boolean not null default true,
  -- Field map: { "<field in types.ts>": "<column>" } or { "<field>": { ...options } }. See app.ws_compile().
  fields        jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(fields) = 'object'),
  -- Fields returned with a fixed value (a hidden price is returned as 0 so the row keeps its shape). Ignored on write.
  consts        jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(consts) = 'object'),
  -- Column values every row of this collection has: required when reading, forced when writing ({"parent_type": "lead"}).
  fixed         jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(fixed) = 'object'),
  -- Nested lists only: the collection that carries this list, the field that holds it, the column that points at the parent row.
  parent        text,
  parent_field  text,
  parent_col    text,
  -- Nested lists only: column that stores the place in the list, when the order matters.
  position_col  text,
  -- Rows are added and never changed or removed (history, handoffs).
  append_only   boolean not null default false,
  -- Nested lists only: capabilities needed to remove an element, and the author column that lets a person remove their own.
  remove_caps   text[] not null default '{}'::text[],
  own_col       text,
  -- Extra SQL condition for reading, over the alias t (c for a nested list). $1 is the company id.
  read_filter   text,
  -- SQL order for reading, over the same alias. Default: created_at, then the key.
  order_by      text,
  -- Newest rows only, when the collection is a log.
  row_limit     integer check (row_limit > 0),
  -- kind = custom: app.<load_fn>(p_tenant uuid) returns jsonb, app.<apply_fn>(p_tenant uuid, p_op text, p_id text, p_row jsonb) returns jsonb
  load_fn       text,
  apply_fn      text,
  note          text,
  -- Filled in by app.ws_compile(): the statements the gateway runs, built once at registration.
  known_keys    text[] not null default '{}'::text[],
  key_type      text,
  has_extra     boolean not null default false,
  has_updated   boolean not null default false,
  read_sql      text,
  insert_sql    text,
  update_sql    text,
  changed_sql   text,
  defer_sql     text,
  delete_sql    text,
  exists_sql    text,
  touch_sql     text,
  created_at    timestamptz not null default now(),
  primary key (name, variant),
  constraint ws_collections_parent_trio check ((parent is null) = (parent_field is null) and (parent is null) = (parent_col is null))
);
create index ws_collections_parent_idx on app.ws_collections (parent) where parent is not null;

alter table app.ws_collections enable row level security;
alter table app.ws_collections force row level security;
revoke all on app.ws_collections from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Small helpers used by the compiled statements
-- ---------------------------------------------------------------------------------------------------------------------

-- A timestamp the way JavaScript writes one: 2026-10-03T14:05:09.123Z
create or replace function app.ws_iso(p timestamptz) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- The version of a row: its updated_at to the microsecond. The app sends it back unchanged with an edit, and the
-- edit is refused as "stale" when someone else changed the row in between.
create or replace function app.ws_token(p timestamptz) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

-- Removes the keys whose value is null (top level only: nested values belong to the person who wrote them).
create or replace function app.ws_drop_nulls(p jsonb) returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from pg_catalog.jsonb_each(p) e
  where e.value <> 'null'::jsonb
$$;

-- "Nothing there": how an optional field looks when it was never set, in any of its spellings.
create or replace function app.ws_blank(p jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$ select p is null or p in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb) $$;

-- A row reduced to what matters when asking "did the database store what was sent?": no version, no blanks, and
-- nested lists of records in id order (the database returns a list in its own order).
create or replace function app.ws_norm(p jsonb) returns jsonb
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  o jsonb := '{}'::jsonb;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then return p; end if;
  for k, v in select key, value from pg_catalog.jsonb_each(p) loop
    if k in ('updatedAt', 'tenantId', 'tenant_id') or app.ws_blank(v) then continue; end if;
    if pg_catalog.jsonb_typeof(v) = 'array' and pg_catalog.jsonb_typeof(v -> 0) = 'object' and (v -> 0) ? 'id' then
      select pg_catalog.jsonb_agg(app.ws_norm(e.value) order by e.value ->> 'id') into v from pg_catalog.jsonb_array_elements(v) e;
    end if;
    o := o || pg_catalog.jsonb_build_object(k, v);
  end loop;
  return o;
end
$$;

-- Type and default of a column. Types and defaults come from the base table when the relation is a view.
create or replace function app.ws_col(p_relation text, p_base text, p_col text, out typ text, out dflt text)
language plpgsql stable
set search_path = ''
as $$
declare
  v_rel regclass := pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(p_relation));
  v_base regclass := pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(coalesce(p_base, p_relation)));
begin
  if v_rel is null or v_base is null then
    raise exception 'ws_register: public.% does not exist', coalesce(p_base, p_relation);
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = v_rel and a.attname = p_col and a.attnum > 0 and not a.attisdropped) then
    raise exception 'ws_register: public.% has no column "%"', p_relation, p_col;
  end if;
  select pg_catalog.format_type(a.atttypid, a.atttypmod), pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    into typ, dflt
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum and a.attgenerated = ''
  where a.attrelid = v_base and a.attname = p_col and a.attnum > 0 and not a.attisdropped;
  if typ is null then
    raise exception 'ws_register: public.% has no column "%"', coalesce(p_base, p_relation), p_col;
  end if;
end
$$;

-- How a column is read into JSON: timestamps as ISO text (the format of app.ws_iso, written out so no function is
-- called per value), times as HH:MM, everything else as it is.
create or replace function app.ws_read_expr(p_alias text, p_col text, p_typ text) returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_typ = 'timestamp with time zone' then pg_catalog.format('pg_catalog.to_char(%s.%I at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')', p_alias, p_col)
    when p_typ like 'time%without time zone' then pg_catalog.format('pg_catalog.to_char(%s.%I, ''HH24:MI'')', p_alias, p_col)
    else pg_catalog.format('%s.%I', p_alias, p_col)
  end
$$;

-- How a value of the row ($1) is written into a column of the given type.
--   p_text  SQL that yields the value as text      p_json  SQL that yields it as jsonb
-- A missing value becomes the column default when the column has one, otherwise NULL.
create or replace function app.ws_write_expr(p_text text, p_json text, p_typ text, p_dflt text, p_empty_string boolean) returns text
language sql immutable
set search_path = ''
as $$
  select case when p_dflt is not null then pg_catalog.format('coalesce(%s, %s)', x.e, p_dflt) else x.e end
  from (
    select case
      when p_typ = 'jsonb' then pg_catalog.format('nullif(%s, ''null''::jsonb)', p_json)
      when p_typ like '%[]' then pg_catalog.format(
        'case when pg_catalog.jsonb_typeof(%1$s) = ''array'' then array(select pg_catalog.jsonb_array_elements_text(%1$s))::%2$s end', p_json, p_typ)
      when p_empty_string then pg_catalog.format('(nullif(%s, ''''))::%s', p_text, p_typ)
      else pg_catalog.format('(%s)::%s', p_text, p_typ)
    end as e
  ) x
$$;

-- jsonb_build_object takes at most 100 arguments: build the object in pieces of 40 fields and join them.
-- p_wrap is the function that removes the fields without a value: pg_catalog.jsonb_strip_nulls for fields read from
-- plain columns (fast, and safe there because it only ever meets the object built here), app.ws_drop_nulls for fields
-- that hold JSON written by a person (it leaves what is inside them alone), or NULL to keep every field.
create or replace function app.ws_object_sql(p_pairs text[], p_wrap text) returns text
language sql immutable
set search_path = ''
as $$
  select pg_catalog.string_agg(
    case when p_wrap is not null then p_wrap || '(pg_catalog.jsonb_build_object(' || g.args || '))'
         else 'pg_catalog.jsonb_build_object(' || g.args || ')' end,
    ' || ' order by g.grp)
  from (
    select (x.n - 1) / 80 as grp, pg_catalog.string_agg(x.arg, ', ' order by x.n) as args
    from pg_catalog.unnest(p_pairs) with ordinality as x(arg, n)
    group by 1
  ) g
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.ws_compile(): turns the field map of a collection into the statements the gateway runs.
--
-- A field is "<column>" or an object with these options:
--   col      the column
--   empty    what the app writes for "no value" ('' for Job.start, null for Lead.value). Stored as NULL, returned as this.
--   omit     value that is left out when reading (false for a flag stored NOT NULL DEFAULT false)
--   ro       true: returned, never written (set by the server or by another path)
--   stamp    'member': on insert the column gets the signed-in member, whatever the row says; never updated
--            'member_if_present': the same, only when the row has the field at all
--   defer    true: written after every other change of the request (a link to a row that may arrive later in the
--            same batch, such as Lead.jobId)
--   kind     'ref'       { type, id }          with type_col, id_col
--            'assignee'  'u:<id>' | 'w:<id>'   with member_col, worker_col
--            'actor'     who did it            with kind_col, id_col (a member is always the signed-in one)
--            'obj'       a small object        with cols: { "<key>": "<column>" }
--            'expr'      read-only SQL         with sql (the alias is written {a})
--
-- Parameters of every compiled statement:
--   $1 row jsonb   $2 id text   $3 company uuid   $4 signed-in member uuid   $5 parent row id uuid
--   $6 position integer   $7 keys that are not "extra" text[]   $8 expected version text (or NULL)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_compile(c app.ws_collections) returns app.ws_collections
language plpgsql stable
set search_path = ''
as $$
declare
  a constant text := case when c.parent is null then 't' else 'c' end;
  f text; s jsonb; k text; sub text; col text; typ text; dflt text; re text; we text;
  kind text;
  r_opt text[] := array[]::text[];   -- optional fields read from plain columns
  r_json text[] := array[]::text[];  -- optional fields that hold JSON (a jsonb column, a small object, an expression)
  r_all text[] := array[]::text[];   -- fields that are always present
  w_cols text[] := array[]::text[]; w_exprs text[] := array[]::text[];
  i_cols text[] := array[]::text[]; i_exprs text[] := array[]::text[];
  d_cols text[] := array[]::text[]; d_exprs text[] := array[]::text[];
  parts text[] := array[]::text[];
  pairs text[];
  v_where text;
  v_fixed text := '';
  v_cols text; v_vals text; v_set text; v_sel text; v_left text; v_right text;
  writable boolean := c.write_caps is not null;
begin
  select x.typ into c.key_type from app.ws_col(c.relation, c.base_table, c.key_col) x;
  c.has_extra := exists (
    select 1 from pg_catalog.pg_attribute t
    where t.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(c.relation)) and t.attname = 'extra' and not t.attisdropped);
  c.has_updated := c.parent is null and exists (
    select 1 from pg_catalog.pg_attribute t
    where t.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(c.relation)) and t.attname = 'updated_at' and not t.attisdropped);
  if writable and not c.has_extra then
    raise exception 'ws_register(%): a writable collection needs an "extra" column, so unknown fields are kept instead of dropped', c.name;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute t
    where t.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(c.relation)) and t.attname = 'tenant_id' and not t.attisdropped) then
    raise exception 'ws_register(%): public.% has no tenant_id column', c.name, c.relation;
  end if;

  for f, s in select e.key, e.value from pg_catalog.jsonb_each(c.fields) e order by e.key loop
    if pg_catalog.jsonb_typeof(s) = 'string' then s := pg_catalog.jsonb_build_object('col', s #>> '{}'); end if;
    kind := coalesce(s ->> 'kind', 'col');

    if kind = 'col' then
      col := s ->> 'col';
      select x.typ, x.dflt into typ, dflt from app.ws_col(c.relation, c.base_table, col) x;
      re := 'pg_catalog.to_jsonb(' || app.ws_read_expr(a, col, typ) || ')';
      if s ? 'empty' then
        r_all := r_all || pg_catalog.quote_literal(f) || pg_catalog.format('coalesce(%s, %L::jsonb)', re, (s -> 'empty')::text);
      elsif typ = 'jsonb' then
        r_json := r_json || pg_catalog.quote_literal(f) || case when s ? 'omit' then pg_catalog.format('nullif(%s, %L::jsonb)', re, (s -> 'omit')::text) else re end;
      elsif s ? 'omit' then
        r_opt := r_opt || pg_catalog.quote_literal(f) || pg_catalog.format('nullif(%s, %L::jsonb)', re, (s -> 'omit')::text);
      else
        r_opt := r_opt || pg_catalog.quote_literal(f) || re;
      end if;
      if col = c.key_col or coalesce((s ->> 'ro')::boolean, false) then
        null;  -- the key comes from the operation; a read-only field is never written
      elsif s ->> 'stamp' = 'member' then
        i_cols := i_cols || col; i_exprs := i_exprs || '$4'::text;
      elsif s ->> 'stamp' = 'member_if_present' then
        i_cols := i_cols || col; i_exprs := i_exprs || pg_catalog.format('case when $1 ? %L then $4 end', f);
      else
        we := app.ws_write_expr(pg_catalog.format('$1 ->> %L', f), pg_catalog.format('$1 -> %L', f), typ, dflt, s -> 'empty' = '""'::jsonb);
        if coalesce((s ->> 'defer')::boolean, false) then
          d_cols := d_cols || col; d_exprs := d_exprs || we;
        else
          w_cols := w_cols || col; w_exprs := w_exprs || we;
        end if;
      end if;

    elsif kind = 'obj' then
      pairs := array[]::text[];
      for sub, col in select e.key, e.value from pg_catalog.jsonb_each_text(s -> 'cols') e order by e.key loop
        select x.typ, x.dflt into typ, dflt from app.ws_col(c.relation, c.base_table, col) x;
        pairs := pairs || pg_catalog.quote_literal(sub) || app.ws_read_expr(a, col, typ);
        if not coalesce((s ->> 'ro')::boolean, false) then
          w_cols := w_cols || col;
          w_exprs := w_exprs || app.ws_write_expr(pg_catalog.format('$1 #>> array[%L, %L]', f, sub), pg_catalog.format('$1 #> array[%L, %L]', f, sub), typ, dflt, false);
        end if;
      end loop;
      r_opt := r_opt || pg_catalog.quote_literal(f)
        || pg_catalog.format('nullif(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(%s)), ''{}''::jsonb)', pg_catalog.array_to_string(pairs, ', '));

    elsif kind = 'ref' then
      perform app.ws_col(c.relation, c.base_table, s ->> 'type_col');
      perform app.ws_col(c.relation, c.base_table, s ->> 'id_col');
      r_opt := r_opt || pg_catalog.quote_literal(f) || pg_catalog.format(
        'case when %1$s.%2$I is not null then pg_catalog.jsonb_build_object(''type'', %1$s.%2$I, ''id'', %1$s.%3$I) end', a, s ->> 'type_col', s ->> 'id_col');
      w_cols := w_cols || (s ->> 'type_col') || (s ->> 'id_col');
      w_exprs := w_exprs || pg_catalog.format('($1 #>> array[%L, ''type''])', f) || pg_catalog.format('($1 #>> array[%L, ''id''])::uuid', f);

    elsif kind = 'assignee' then
      perform app.ws_col(c.relation, c.base_table, s ->> 'member_col');
      perform app.ws_col(c.relation, c.base_table, s ->> 'worker_col');
      r_all := r_all || pg_catalog.quote_literal(f) || pg_catalog.format(
        'pg_catalog.to_jsonb(coalesce(''u:'' || %1$s.%2$I::text, ''w:'' || %1$s.%3$I::text, ''''))', a, s ->> 'member_col', s ->> 'worker_col');
      w_cols := w_cols || (s ->> 'member_col') || (s ->> 'worker_col');
      w_exprs := w_exprs
        || pg_catalog.format('case when $1 ->> %1$L like ''u:%%'' then pg_catalog.substr($1 ->> %1$L, 3)::uuid end', f)
        || pg_catalog.format('case when $1 ->> %1$L like ''w:%%'' then pg_catalog.substr($1 ->> %1$L, 3)::uuid end', f);

    elsif kind = 'actor' then
      perform app.ws_col(c.relation, c.base_table, s ->> 'kind_col');
      perform app.ws_col(c.relation, c.base_table, s ->> 'id_col');
      r_opt := r_opt || pg_catalog.quote_literal(f) || pg_catalog.format(
        'pg_catalog.to_jsonb(case when %1$s.%3$I is not null then %1$s.%3$I::text else %1$s.%2$I end)', a, s ->> 'kind_col', s ->> 'id_col');
      i_cols := i_cols || (s ->> 'kind_col') || (s ->> 'id_col');
      i_exprs := i_exprs
        || pg_catalog.format('case when $1 ->> %L = ''automation'' then ''automation'' else ''member'' end', f)
        || pg_catalog.format('case when $1 ->> %L = ''automation'' then null else $4 end', f);

    elsif kind = 'expr' then
      r_json := r_json || pg_catalog.quote_literal(f) || pg_catalog.replace(s ->> 'sql', '{a}', a);

    else
      raise exception 'ws_register(%): field "%" has an unknown kind "%"', c.name, f, kind;
    end if;
  end loop;

  c.known_keys := array(select pg_catalog.jsonb_object_keys(c.fields)) || array(select pg_catalog.jsonb_object_keys(c.consts));

  -- ---- reading ("extra" is merged in underneath by app.ws_row_sql, with every known field name removed from it)
  if pg_catalog.cardinality(r_opt) > 0 then parts := parts || app.ws_object_sql(r_opt, 'pg_catalog.jsonb_strip_nulls'); end if;
  if pg_catalog.cardinality(r_json) > 0 then parts := parts || app.ws_object_sql(r_json, 'app.ws_drop_nulls'); end if;
  if pg_catalog.cardinality(r_all) > 0 then parts := parts || app.ws_object_sql(r_all, null); end if;
  if c.consts <> '{}'::jsonb then parts := parts || (pg_catalog.quote_literal(c.consts::text) || '::jsonb'); end if;
  if c.has_updated then
    parts := parts || pg_catalog.format('pg_catalog.jsonb_build_object(''updatedAt'', pg_catalog.to_char(%s.updated_at at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"''))', a);
  end if;
  c.read_sql := '(' || pg_catalog.array_to_string(parts, ' || ') || ')';

  -- ---- which row: the key, the company, the fixed values and (for a nested list) the parent
  select coalesce(pg_catalog.string_agg(pg_catalog.format(' and t.%I = %L', e.key, e.value), '' order by e.key), '')
    into v_fixed from pg_catalog.jsonb_each_text(c.fixed) e;
  v_where := pg_catalog.format('t.%I = $2::%s and t.tenant_id = $3', c.key_col, c.key_type) || v_fixed
    || case when c.parent_col is not null then pg_catalog.format(' and t.%I = $5', c.parent_col) else '' end;
  c.exists_sql := pg_catalog.format('select true from public.%I t where %s', c.relation, v_where);

  if not writable then
    c.insert_sql := null; c.update_sql := null; c.changed_sql := null; c.defer_sql := null; c.delete_sql := null; c.touch_sql := null;
    return c;
  end if;

  if c.position_col is not null then w_cols := w_cols || c.position_col; w_exprs := w_exprs || '$6::integer'::text; end if;
  w_cols := w_cols || 'extra'::text; w_exprs := w_exprs || '($1 - $7)'::text;

  -- ---- insert
  v_cols := pg_catalog.format('tenant_id, %I', c.key_col);
  v_vals := pg_catalog.format('$3, $2::%s', c.key_type);
  if c.parent_col is not null then v_cols := v_cols || pg_catalog.format(', %I', c.parent_col); v_vals := v_vals || ', $5'; end if;
  for k, col in select e.key, e.value from pg_catalog.jsonb_each_text(c.fixed) e order by e.key loop
    v_cols := v_cols || pg_catalog.format(', %I', k); v_vals := v_vals || pg_catalog.format(', %L', col);
  end loop;
  for i in 1 .. pg_catalog.cardinality(w_cols) loop
    v_cols := v_cols || pg_catalog.format(', %I', w_cols[i]); v_vals := v_vals || ', ' || w_exprs[i];
  end loop;
  for i in 1 .. pg_catalog.cardinality(i_cols) loop
    v_cols := v_cols || pg_catalog.format(', %I', i_cols[i]); v_vals := v_vals || ', ' || i_exprs[i];
  end loop;
  c.insert_sql := pg_catalog.format('insert into public.%I (%s) values (%s)', c.relation, v_cols, v_vals);

  -- ---- update, and "would it change anything". An append-only collection is never updated; the comparison is still
  -- built, so an attempt to rewrite an existing row is noticed and refused instead of silently ignored.
  select pg_catalog.string_agg(pg_catalog.format('%I = v.%I', x.col, x.col), ', ' order by x.n),
         pg_catalog.string_agg(pg_catalog.format('%s as %I', w_exprs[x.n], x.col), ', ' order by x.n),
         pg_catalog.string_agg(pg_catalog.format('t.%I', x.col), ', ' order by x.n),
         pg_catalog.string_agg(pg_catalog.format('v.%I', x.col), ', ' order by x.n)
    into v_set, v_sel, v_left, v_right
  from pg_catalog.unnest(w_cols) with ordinality as x(col, n);
  c.update_sql := case when c.append_only then null else
    pg_catalog.format('update public.%I t set %s from (select %s) v where %s', c.relation, v_set, v_sel, v_where)
      || case when c.has_updated then ' and ($8::text is null or app.ws_token(t.updated_at) = $8)' else '' end end;
  c.changed_sql := pg_catalog.format('select (%s) is distinct from (%s), %s from public.%I t, (select %s) v where %s',
    case when pg_catalog.cardinality(w_cols) > 1 then 'row(' || v_left || ')' else v_left end,
    case when pg_catalog.cardinality(w_cols) > 1 then 'row(' || v_right || ')' else v_right end,
    case when c.has_updated then 'app.ws_token(t.updated_at)' else 'null::text' end, c.relation, v_sel, v_where);

  -- ---- links written after everything else
  if pg_catalog.cardinality(d_cols) > 0 then
    select pg_catalog.string_agg(pg_catalog.format('%I = v.%I', x.col, x.col), ', ' order by x.n),
           pg_catalog.string_agg(pg_catalog.format('%s as %I', d_exprs[x.n], x.col), ', ' order by x.n),
           pg_catalog.string_agg(pg_catalog.format('t.%I', x.col), ', ' order by x.n),
           pg_catalog.string_agg(pg_catalog.format('v.%I', x.col), ', ' order by x.n)
      into v_set, v_sel, v_left, v_right
    from pg_catalog.unnest(d_cols) with ordinality as x(col, n);
    c.defer_sql := pg_catalog.format('update public.%I t set %s from (select %s) v where %s and row(%s) is distinct from row(%s)',
      c.relation, v_set, v_sel, v_where, v_left, v_right);
  else
    c.defer_sql := null;
  end if;

  c.delete_sql := pg_catalog.format('delete from public.%I t where %s', c.relation, v_where);
  -- a write that changes nothing but moves updated_at (the trigger of 0001 does that on every update): used when
  -- only a nested list changed, so the version of the parent row moves with it
  c.touch_sql := pg_catalog.format('update public.%1$I t set %2$I = t.%2$I where %3$s', c.relation, w_cols[1], v_where);
  return c;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- app.ws_register(): adds or replaces one collection (one variant of it). Called by migrations only.
-- The argument is an object with the column names of app.ws_collections as keys; see docs/DATABASE.md.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.ws_register(p_spec jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  c app.ws_collections;
  v_unknown text;
begin
  select e.key into v_unknown from pg_catalog.jsonb_each(p_spec) e
  where e.key not in ('name', 'variant', 'kind', 'ord', 'top_level', 'relation', 'base_table', 'key_col', 'read_caps', 'write_caps', 'delete_caps',
    'needs_write', 'fields', 'consts', 'fixed', 'parent', 'parent_field', 'parent_col', 'position_col', 'append_only', 'remove_caps', 'own_col',
    'read_filter', 'order_by', 'row_limit', 'load_fn', 'apply_fn', 'note')
  limit 1;
  if v_unknown is not null then raise exception 'ws_register: unknown option "%"', v_unknown; end if;

  c := pg_catalog.jsonb_populate_record(null::app.ws_collections, p_spec);
  if c.name is null or c.name !~ '^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)?$' then raise exception 'ws_register: a collection needs a name'; end if;
  c.variant := coalesce(c.variant, 1);
  c.kind := coalesce(c.kind, 'table');
  c.ord := coalesce(c.ord, 500);
  c.key_col := coalesce(c.key_col, 'id');
  c.read_caps := coalesce(c.read_caps, array[]::text[]);
  c.needs_write := coalesce(c.needs_write, true);
  c.fields := coalesce(c.fields, '{}'::jsonb);
  c.consts := coalesce(c.consts, '{}'::jsonb);
  c.fixed := coalesce(c.fixed, '{}'::jsonb);
  c.append_only := coalesce(c.append_only, false);
  c.remove_caps := coalesce(c.remove_caps, array[]::text[]);
  c.top_level := coalesce(c.top_level, c.parent is null);
  c.known_keys := array[]::text[];
  c.has_extra := false;
  c.has_updated := false;
  c.created_at := pg_catalog.now();

  select x into v_unknown
  from pg_catalog.unnest(c.read_caps || coalesce(c.write_caps, '{}') || coalesce(c.delete_caps, '{}') || c.remove_caps) x
  where x <> all (app.capabilities()) limit 1;
  if v_unknown is not null then raise exception 'ws_register(%): "%" is not a capability', c.name, v_unknown; end if;
  if (c.parent is not null) <> (c.name like '%.%') then
    raise exception 'ws_register(%): a nested list is named <parent>.<field> and names its parent', c.name;
  end if;
  if c.parent is not null and c.name <> c.parent || '.' || c.parent_field then
    raise exception 'ws_register(%): the name must be %.%', c.name, c.parent, c.parent_field;
  end if;

  if c.kind = 'table' then
    if c.relation is null then raise exception 'ws_register(%): a table collection names its relation', c.name; end if;
    c := app.ws_compile(c);
  elsif c.kind = 'custom' then
    if c.load_fn is null or pg_catalog.to_regprocedure('app.' || pg_catalog.quote_ident(c.load_fn) || '(uuid)') is null then
      raise exception 'ws_register(%): load_fn must be an existing function app.<name>(uuid)', c.name;
    end if;
    if c.apply_fn is not null and pg_catalog.to_regprocedure('app.' || pg_catalog.quote_ident(c.apply_fn) || '(uuid, text, text, jsonb)') is null then
      raise exception 'ws_register(%): apply_fn must be an existing function app.<name>(uuid, text, text, jsonb)', c.name;
    end if;
  end if;

  -- a real registration takes the place of the placeholder that announced the collection
  if c.kind <> 'pending' then
    delete from app.ws_collections w where w.name = c.name and w.kind = 'pending';
  end if;
  delete from app.ws_collections w where w.name = c.name and w.variant = c.variant;
  insert into app.ws_collections select c.*;
end
$$;

-- Compiles every table collection again. Run it after a migration changes the columns of a registered table
-- (a new default, a new type), so the stored statements match the table.
create or replace function app.ws_recompile() returns integer
language plpgsql
set search_path = ''
as $$
declare
  c app.ws_collections;
  n integer := 0;
begin
  for c in select * from app.ws_collections w where w.kind = 'table' loop
    c := app.ws_compile(c);
    delete from app.ws_collections w where w.name = c.name and w.variant = c.variant;
    insert into app.ws_collections select c.*;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Reading the registry. These are the only doors to app.ws_collections for the gateway, which runs as the caller.
-- SECURITY DEFINER because no application role may read the table itself; each returns registry data only (which
-- collections exist and how they are stored), never a row of a company.
-- ---------------------------------------------------------------------------------------------------------------------

-- Every field name a collection knows, across its variants, plus the names of its nested lists and the keys the
-- gateway itself adds. None of these is ever stored in or read from "extra": a field that has a column (or is set by
-- the server alone, such as the tax ID type of a client) cannot be planted in "extra" to show up as if it were real.
create or replace function app.ws_known(p_name text) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select pg_catalog.array_agg(distinct k.key) from app.ws_collections w cross join lateral pg_catalog.unnest(w.known_keys) as k(key) where w.name = p_name), array[]::text[])
      || array(select distinct w.parent_field from app.ws_collections w where w.parent = p_name)
      || array['updatedAt', 'tenantId', 'tenant_id']
$$;

-- The variant of a collection that applies to a person holding these capabilities. NULL name when none does.
create or replace function app.ws_variant(p_name text, p_perms text[]) returns app.ws_collections
language sql stable security definer
set search_path = ''
as $$
  select w from app.ws_collections w
  where w.name = p_name and w.read_caps <@ p_perms
  order by w.variant
  limit 1
$$;

-- The nested lists of a collection: their registry name and the field of the parent row that holds them.
create or replace function app.ws_children(p_name text) returns table (name text, parent_field text)
language sql stable security definer
set search_path = ''
as $$ select distinct w.name, w.parent_field from app.ws_collections w where w.parent = p_name order by 1 $$;

-- Every collection that is not a nested list: its name, its place in the apply order, whether ws_load returns it,
-- and whether any variant of it can be written.
create or replace function app.ws_names() returns table (name text, ord integer, top_level boolean, writable boolean)
language sql stable security definer
set search_path = ''
as $$
  select w.name, pg_catalog.min(w.ord), pg_catalog.bool_or(w.top_level), pg_catalog.bool_or(w.write_caps is not null or w.apply_fn is not null)
  from app.ws_collections w
  where w.parent is null
  group by w.name
$$;

revoke all on function app.ws_iso(timestamptz), app.ws_token(timestamptz), app.ws_drop_nulls(jsonb), app.ws_blank(jsonb), app.ws_norm(jsonb),
  app.ws_col(text, text, text), app.ws_read_expr(text, text, text), app.ws_write_expr(text, text, text, text, boolean),
  app.ws_object_sql(text[], text), app.ws_compile(app.ws_collections), app.ws_register(jsonb), app.ws_recompile(),
  app.ws_variant(text, text[]), app.ws_known(text), app.ws_children(text), app.ws_names() from public, anon, authenticated, service_role;
grant execute on function app.ws_iso(timestamptz), app.ws_token(timestamptz), app.ws_drop_nulls(jsonb), app.ws_blank(jsonb), app.ws_norm(jsonb),
  app.ws_variant(text, text[]), app.ws_known(text), app.ws_children(text), app.ws_names() to authenticated;
