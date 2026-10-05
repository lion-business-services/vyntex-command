-- 0043 Outgoing messages: the server's side of the queue
-- A person saves a message as "queued" (0013 lets them write draft and queued, nothing else). The job messages.deliver
-- picks it up, checks consent and opt-outs again here, hands it to the provider, and writes what happened. "sent" is
-- written by message_mark only, and only for a message that was still queued: running the job twice sends once.

create or replace function public.messages_queued(p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenantId', x.tenant_id, 'id', x.id)), '[]'::jsonb)
  from (select m.tenant_id, m.id from public.messages m
        where m.status = 'queued' and coalesce(m.dir, 'out') = 'out' and m.at <= now()
        order by m.at limit greatest(1, least(coalesce(p_limit, 50), 500))) x
$$;

-- One message with what the server needs to decide: may this person be written to on this channel, right now?
create or replace function public.message_get(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('id', m.id, 'tenantId', m.tenant_id, 'channel', m.channel, 'recipient', m.recipient, 'subject', m.subject,
    'body', m.body, 'status', m.status, 'dir', coalesce(m.dir, 'out'), 'system', coalesce((m.extra ->> 'system')::boolean, false), 'link', m.extra ->> 'link',
    'refType', m.ref_type, 'clientId', coalesce(m.client_id, case when m.ref_type = 'client' then m.ref_id end),
    'company', (select t.name from public.tenants t where t.id = m.tenant_id),
    'emailOptOut', coalesce(c.email_opt_out, false),
    'smsOptIn', coalesce(c.sms_opt_in, l.sms_opt_in, false),
    'whatsappOptIn', coalesce(c.whatsapp_opt_in, false),
    'known', c.id is not null or l.id is not null))
  from public.messages m
  left join public.clients c on c.tenant_id = m.tenant_id and c.id = coalesce(m.client_id, case when m.ref_type = 'client' then m.ref_id end)
  left join public.leads l on l.tenant_id = m.tenant_id and m.ref_type = 'lead' and l.id = m.ref_id
  where m.tenant_id = p_tenant and m.id = p_id
$$;

-- Writes the outcome. Only a queued message moves, so a second run changes nothing (returns false).
create or replace function public.message_mark(p_tenant uuid, p_id uuid, p_status text, p_provider text default null, p_external_id text default null,
  p_error text default null) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
begin
  if p_status is null or p_status not in ('sent', 'failed') then raise exception 'invalid' using errcode = '22023'; end if;
  -- "sent" needs the provider's own reference: no acceptance, no "sent"
  if p_status = 'sent' and (p_provider is null or coalesce(p_external_id, '') = '') then raise exception 'invalid' using errcode = '22023'; end if;
  update public.messages x
     set status = p_status, provider = coalesce(p_provider, x.provider), external_id = case when p_status = 'sent' then left(p_external_id, 300) else x.external_id end,
         error = case when p_status = 'failed' then left(coalesce(p_error, 'failed'), 200) end,
         extra = case when p_status = 'sent' then x.extra - 'link' else x.extra end
   where x.tenant_id = p_tenant and x.id = p_id and x.status = 'queued'
  returning * into m;
  if m.id is null then return false; end if;
  if m.ref_type = 'review' and p_status = 'sent' then
    update public.review_requests r set status = 'sent', at = now() where r.tenant_id = p_tenant and r.id = m.ref_id and r.status = 'draft';
  end if;
  return true;
end
$$;

revoke all on function public.messages_queued(integer), public.message_get(uuid, uuid), public.message_mark(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.messages_queued(integer), public.message_get(uuid, uuid), public.message_mark(uuid, uuid, text, text, text, text) to service_role;

select app.lockdown_check();
