-- Prints one line per fact about a database: every table with its row count and a checksum of its rows, and every
-- access rule (row level security, policies, privileges, owners, functions, triggers, views, constraints, indexes).
-- Run it on the original database and on the restored one, with the same options, and compare the two outputs line by
-- line. Identical output means the restore brought back the data AND the rules that protect it.
--
--   psql -X -At -v ON_ERROR_STOP=1 -f scripts/backup/fingerprint.sql > before.txt
--
-- It only reads. Run it as a role that can see every row (the administrator), or row level security hides rows.
-- No row content is printed, only counts and checksums.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set extra_float_digits = 3;
set bytea_output = 'hex';

-- The schemas that belong to the product or stand in for Supabase's. System schemas are left out.
create temp view fp_ns as
  select oid, nspname from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema') and nspname !~ '^pg_';

-- 1. Data: count and checksum per table. The checksum does not depend on the order rows are stored in.
select format(
  'select %L || count(*) || ''|'' || coalesce(md5(string_agg(h, '''' order by h)), ''empty'') from (select md5(t::text) as h from %I.%I t) s',
  'data|' || n.nspname || '.' || c.relname || '|', n.nspname, c.relname)
from pg_class c join fp_ns n on n.oid = c.relnamespace
where c.relkind = 'r'
order by n.nspname, c.relname
\gexec

-- 2. Rules. Privileges are read as they take effect: an object with no explicit list has its owner's default list,
--    and pg_dump writes nothing for a list that equals the default, so the two forms must compare as equal.
--    A line "fngrant|...|PUBLIC|EXECUTE" therefore shows every function that anyone may call.
select line from (
  select 'table|' || n.nspname || '.' || c.relname || '|owner=' || pg_get_userbyid(c.relowner)
         || '|rls=' || c.relrowsecurity || '|forced=' || c.relforcerowsecurity || '|kind=' || c.relkind::text
         || '|options=' || coalesce(c.reloptions::text, '') as line
  from pg_class c join fp_ns n on n.oid = c.relnamespace where c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || permissive || '|' || roles::text || '|' || cmd
         || '|using=' || md5(coalesce(qual, '')) || '|check=' || md5(coalesce(with_check, ''))
  from pg_policies
  union all
  select 'grant|' || n.nspname || '.' || c.relname || '|' || coalesce(g.rolname, 'PUBLIC') || '|' || a.privilege_type || '|' || a.is_grantable
  from pg_class c join fp_ns n on n.oid = c.relnamespace,
       aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a
       left join pg_roles g on g.oid = a.grantee
  where c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'colgrant|' || n.nspname || '.' || c.relname || '.' || at.attname || '|' || coalesce(g.rolname, 'PUBLIC') || '|' || a.privilege_type
  from pg_attribute at join pg_class c on c.oid = at.attrelid join fp_ns n on n.oid = c.relnamespace,
       aclexplode(at.attacl) a left join pg_roles g on g.oid = a.grantee
  where at.attnum > 0 and not at.attisdropped
  union all
  select 'column|' || n.nspname || '.' || c.relname || '.' || at.attname || '|' || format_type(at.atttypid, at.atttypmod) || '|notnull=' || at.attnotnull
         || '|default=' || md5(coalesce(pg_get_expr(d.adbin, d.adrelid), ''))
  from pg_attribute at join pg_class c on c.oid = at.attrelid join fp_ns n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = at.attrelid and d.adnum = at.attnum
  where at.attnum > 0 and not at.attisdropped and c.relkind in ('r', 'p')
  union all
  select 'schema|' || n.nspname || '|owner=' || pg_get_userbyid(ns.nspowner) from fp_ns n join pg_namespace ns on ns.oid = n.oid
  union all
  select 'schemagrant|' || ns.nspname || '|' || coalesce(g.rolname, 'PUBLIC') || '|' || a.privilege_type
  from pg_namespace ns join fp_ns n on n.oid = ns.oid, aclexplode(coalesce(ns.nspacl, acldefault('n', ns.nspowner))) a left join pg_roles g on g.oid = a.grantee
  union all
  select 'function|' || p.oid::regprocedure || '|owner=' || pg_get_userbyid(p.proowner) || '|definer=' || p.prosecdef
         || '|config=' || coalesce(p.proconfig::text, '') || '|body=' || md5(p.prosrc)
  from pg_proc p join fp_ns n on n.oid = p.pronamespace
  where not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'fngrant|' || p.oid::regprocedure || '|' || coalesce(g.rolname, 'PUBLIC') || '|' || a.privilege_type
  from pg_proc p join fp_ns n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee
  where not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'trigger|' || t.tgrelid::regclass || '|' || t.tgname || '|enabled=' || t.tgenabled::text || '|' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join fp_ns n on n.oid = c.relnamespace where not t.tgisinternal
  union all
  select 'view|' || schemaname || '.' || viewname || '|' || md5(definition) from pg_views where schemaname in (select nspname from fp_ns)
  union all
  select 'constraint|' || con.conrelid::regclass || '|' || con.conname || '|' || md5(pg_get_constraintdef(con.oid))
  from pg_constraint con join fp_ns n on n.oid = con.connamespace where con.conrelid <> 0
  union all
  select 'index|' || schemaname || '.' || indexname || '|' || md5(indexdef) from pg_indexes where schemaname in (select nspname from fp_ns)
  union all
  select 'sequence|' || schemaname || '.' || sequencename || '|last=' || coalesce(last_value::text, 'unused') from pg_sequences where schemaname in (select nspname from fp_ns)
  union all
  select 'extension|' || e.extname || '|' || e.extversion || '|' || ns.nspname from pg_extension e join pg_namespace ns on ns.oid = e.extnamespace
  union all
  select 'defaultacl|' || pg_get_userbyid(d.defaclrole) || '|' || coalesce(ns.nspname, '') || '|' || d.defaclobjtype::text || '|' || coalesce(g.rolname, 'PUBLIC') || '|' || a.privilege_type
  from pg_default_acl d left join pg_namespace ns on ns.oid = d.defaclnamespace, aclexplode(d.defaclacl) a left join pg_roles g on g.oid = a.grantee
) facts
order by line collate "C";
