-- 0045 What the scheduled jobs of this round read and clean
--   owner_summary_due    yesterday's counts per active company, with the addresses of its owners. Counts only: the
--                        email built from it names no client.
--   public_links_purge   links that stopped working long ago

create or replace function public.owner_summary_due(p_limit integer default 500) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenantId', t.id,
    'owners', (select coalesce(jsonb_agg(m.email), '[]'::jsonb) from public.tenant_members m
               where m.tenant_id = t.id and m.role = 'owner' and m.status = 'active' and m.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
    'counts', jsonb_build_object(
      'newLeads', (select count(*) from public.leads l where l.tenant_id = t.id and l.created_at >= now() - interval '1 day'),
      'tasksDue', (select count(*) from public.tasks k where k.tenant_id = t.id and k.status <> 'done' and k.due <= current_date),
      'appointmentsToday', (select count(*) from public.appointments a where a.tenant_id = t.id and a.date = current_date and a.status not like 'cancelled%' and a.status <> 'no_show'),
      'signaturesWaiting', (select count(*) from public.envelopes e where e.tenant_id = t.id and e.status in ('sent', 'partly_signed') and not e.demo),
      'messagesFailed', (select count(*) from public.messages g where g.tenant_id = t.id and g.status = 'failed' and g.updated_at >= now() - interval '1 day'),
      'reviewsAnswered', (select count(*) from public.review_requests r where r.tenant_id = t.id and r.status = 'rated' and r.updated_at >= now() - interval '1 day'))) order by t.id), '[]'::jsonb)
  from (select x.id from public.tenants x where x.status = 'active' order by x.id limit greatest(1, least(coalesce(p_limit, 500), 5000))) t
$$;

create or replace function public.public_links_purge(p_days integer default 90) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare n integer;
begin
  delete from app.public_links l where l.expires_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 30));
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.owner_summary_due(integer), public.public_links_purge(integer) from public, anon, authenticated;
grant execute on function public.owner_summary_due(integer), public.public_links_purge(integer) to service_role;

select app.lockdown_check();
