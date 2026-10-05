-- 0048b The "connections" collection travels with ws_load
-- Until now "connections" was the one placeholder left from 0018: it loaded as an empty list, and the Integrations
-- screen read GET /api/integrations instead. Every provider has an adapter now, so the list of what a company has
-- connected is registered as a real collection. It is read only: a connection is written by the server alone, after
-- the provider answered a real status call (0026). ws_apply refuses any write to it with "read_only".
--
-- The loader of 0039 is replaced by one that answers an empty list, instead of an error, for a member who may not see
-- connections (a field worker in the portal): a list that is part of every load must never make the load fail.
-- GET /api/integrations stays the source for the Integrations screen: it also says what is configured on the server
-- and why a provider that was never connected is in the state it is in.
create or replace function app.ws_load_connections(p_tenant uuid) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if pg_catalog.to_regprocedure('public.connections_list(uuid)') is null then return '[]'::jsonb; end if;
  if not coalesce(app.is_office(p_tenant), false) and not coalesce(app.can(p_tenant, 'integrations'), false) then return '[]'::jsonb; end if;
  execute 'select public.connections_list($1)' into v using p_tenant;
  return coalesce(v, '[]'::jsonb);
end
$$;
revoke all on function app.ws_load_connections(uuid) from public, anon, service_role;
grant execute on function app.ws_load_connections(uuid) to authenticated;

select app.ws_register('{"name": "connections", "kind": "custom", "ord": 230, "load_fn": "ws_load_connections"}');

select app.lockdown_check();
