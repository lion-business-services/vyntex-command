-- 0028 File storage for workspace files (documents, receipts, signed copies, attachments)
-- Depends on Supabase's "storage" schema, like 0008. One private bucket; files are stored under
--   <tenant_id>/<area>/<random id>.<ext>
-- The server (api/ws.js, file/upload) builds that path itself: the first folder is always the company the person is
-- working in, the name is random, and the browser never chooses a path. Files are read back through the server with
-- a link that lasts one minute. There is no public link and no listing.
--   office member with the "documents" capability   read and add files of their company
--   the same, with "delete" as well                 remove a file
--   nobody                                          replace a file in place (a new version is a new file)
-- A session that still owes the second sign-in step, or was signed out everywhere, gets nothing (app.session_tenants).

-- Companies the caller belongs to AND whose sign-in rules this session satisfies. Evaluated once per statement.
create or replace function app.session_tenants() returns uuid[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_out uuid[];
begin
  if not app.session_live() then return '{}'::uuid[]; end if;
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[]) into v_out
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and t.status <> 'closed'
    and (app.session_aal() = 'aal2' or not app.mfa_needed(m.tenant_id));
  return v_out;
end
$$;
revoke all on function app.session_tenants() from public, anon;
grant execute on function app.session_tenants() to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-files', 'workspace-files', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists workspace_files_read on storage.objects;
create policy workspace_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'workspace-files'
    and app.path_uuid(name, 1) = any ((select app.tenants_can('documents'))::uuid[])
    and app.path_uuid(name, 1) = any ((select app.session_tenants())::uuid[])
  );

drop policy if exists workspace_files_insert on storage.objects;
create policy workspace_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-files'
    and app.path_uuid(name, 1) = any ((select app.tenants_can('documents'))::uuid[])
    and app.path_uuid(name, 1) = any ((select app.session_tenants())::uuid[])
    and pg_catalog.split_part(name, '/', 2) ~ '^[a-z][a-z0-9_-]{1,30}$'
    and pg_catalog.split_part(name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{4,120}$'
    and pg_catalog.split_part(name, '/', 4) = ''
  );

drop policy if exists workspace_files_delete on storage.objects;
create policy workspace_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'workspace-files'
    and app.path_uuid(name, 1) = any ((select app.tenants_can('documents', 'delete'))::uuid[])
    and app.path_uuid(name, 1) = any ((select app.session_tenants())::uuid[])
  );
