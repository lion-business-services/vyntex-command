-- 0008 File storage for worker documents (W-9 forms, insurance certificates)
-- Kept in its own migration because it depends on Supabase's "storage" schema, which a plain Postgres does not have.
--
-- One private bucket. Files are stored under   <tenant_id>/<worker_id>/<file name>
-- so the first folder says which company a file belongs to and the second which worker.
--   owner, manager   read, upload, replace and delete any file of their company
--   worker           read and upload inside their own folder only; cannot replace or delete
--   staff, anon      nothing
-- In the worker policies the first test (my_worker_ids, evaluated once per statement) narrows the rows cheaply and the
-- second (current_worker of that exact company) confirms the worker folder belongs to the company folder it sits in.
-- Files are reached with short-lived signed links created by the app, never with public links.

-- Returns folder number p_position of a storage path as a uuid, or NULL when it is missing or not a uuid.
create or replace function app.path_uuid(p_name text, p_position integer) returns uuid
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.split_part(p_name, '/', p_position) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then pg_catalog.split_part(p_name, '/', p_position)::uuid
  end
$$;
revoke all on function app.path_uuid(text, integer) from public, anon;
grant execute on function app.path_uuid(text, integer) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'worker-documents', 'worker-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy worker_documents_office_read on storage.objects for select to authenticated
  using (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team'))::uuid[]));

create policy worker_documents_office_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'worker-documents'
    and app.path_uuid(name, 1) = any ((select app.tenants_can('team'))::uuid[])
    and app.path_uuid(name, 2) is not null
  );

create policy worker_documents_office_update on storage.objects for update to authenticated
  using (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team'))::uuid[]))
  with check (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team'))::uuid[]) and app.path_uuid(name, 2) is not null);

create policy worker_documents_office_delete on storage.objects for delete to authenticated
  using (bucket_id = 'worker-documents' and app.path_uuid(name, 1) = any ((select app.tenants_can('team', 'delete'))::uuid[]));

create policy worker_documents_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'worker-documents'
    and app.path_uuid(name, 2) = any ((select app.my_worker_ids())::uuid[])
    and app.path_uuid(name, 2) = app.current_worker(app.path_uuid(name, 1))
  );

create policy worker_documents_own_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'worker-documents'
    and app.path_uuid(name, 2) = any ((select app.my_worker_ids())::uuid[])
    and app.path_uuid(name, 2) = app.current_worker(app.path_uuid(name, 1))
  );
