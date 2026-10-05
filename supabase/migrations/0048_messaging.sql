-- 0048 Messaging: consent per number, the writer of incoming messages, the outbox reader, scheduled posts
-- (the brief, sections 27 to 32). Used by api/_lib/integrations/messaging/ingest.js and api/_lib/jobs/messaging.js.
--
--   messaging_consents   the current answer to "may this company text or WhatsApp this number?". One row per
--                        company, channel and number. The evidence of an opt-in stays in consent_records; this row
--                        is the switch the sending path reads, and the row a STOP turns off.
-- A person reads these rows (capability "comms"). Nobody writes them directly: an opt-out is a fact reported by a
-- provider, so the server writes it, the same rule as the delivery states of messages (0013).

create table public.messaging_consents (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  channel            text not null check (channel in ('text', 'whatsapp')),
  -- E.164, for example +15555550100.
  address            text not null check (address ~ '^\+[1-9][0-9]{7,14}$'),
  status             text not null check (status in ('opted_in', 'opted_out')),
  -- Where the current status came from: a form the person filled in, a team member, a STOP or START word, the
  -- provider's own block list, or an import.
  source             text not null check (source in ('form', 'staff', 'keyword', 'provider', 'import')),
  client_id          uuid,
  -- The record of what the person agreed to (consent_records), when there is one.
  consent_record_id  uuid,
  granted_at         timestamptz,
  revoked_at         timestamptz,
  expires_at         timestamptz,
  extra              jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, channel, address),
  constraint messaging_consents_state check (
    (status = 'opted_in' and granted_at is not null and revoked_at is null) or (status = 'opted_out' and revoked_at is not null)),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, consent_record_id) references public.consent_records (tenant_id, id) on delete restrict
);
create index messaging_consents_client_idx on public.messaging_consents (tenant_id, client_id);
create index messaging_consents_record_idx on public.messaging_consents (tenant_id, consent_record_id);
select app.module_table('messaging_consents', 'select');

create policy messaging_consents_select on public.messaging_consents for select to authenticated
  using (tenant_id = any ((select app.tenants_can('comms'))::uuid[])
    and (client_id is null or client_id not in (select app.hidden_clients())));

-- Queued outgoing messages waiting for the job, oldest first.
create index messages_outbox_idx on public.messages (at) where status = 'queued' and external_id is null;

-- A phone number as E.164, or null. Ten digits are read as a North American number (the same rule as the server).
create or replace function app.e164(p text) returns text
language sql immutable
set search_path = ''
as $$
  select case
    when x.d = '' then null
    when pg_catalog.btrim(p) like '+%' and pg_catalog.length(x.d) between 8 and 15 then '+' || x.d
    when pg_catalog.length(x.d) = 10 then '+1' || x.d
    when pg_catalog.length(x.d) between 11 and 15 then '+' || x.d
    else null
  end
  from (select pg_catalog.regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
revoke all on function app.e164(text) from public, anon, authenticated, service_role;

-- ---- Server only (service role). SECURITY DEFINER because these run from a webhook or a job, with nobody signed
-- ---- in, and write states a person may not write (received, sent, delivered, failed, opted out).

-- Stores what a provider delivered: messages (once per provider id), delivery reports, STOP and START words.
create or replace function public.messaging_ingest(p_tenant uuid, p_provider text, p_batch jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  it jsonb;
  m jsonb;
  v_client uuid;
  v_key text;
  v_addr text;
  v_at timestamptz;
  v_rows integer;
  n_msg integer := 0;
  n_status integer := 0;
  n_consent integer := 0;
begin
  for it in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'messages', '[]'::jsonb)) e loop
    m := it -> 'message';
    if m is null or coalesce(m ->> 'externalId', '') = '' then continue; end if;
    v_client := null;
    v_key := it #>> '{match,phoneKey}';
    if v_key ~ '^[0-9]{10}$' then
      -- Only when exactly one client has this number. Two clients sharing a phone are left for a person to decide.
      select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(c.id))[1] end into v_client
      from public.clients c
      where c.tenant_id = p_tenant and pg_catalog.right(pg_catalog.regexp_replace(c.phone, '\D', '', 'g'), 10) = v_key;
    end if;
    insert into public.messages (tenant_id, at, channel, recipient, subject, body, status, dir, sender, thread_id, client_id, read, provider, external_id, seconds, error)
    values (p_tenant, coalesce((m ->> 'at')::timestamptz, pg_catalog.now()), m ->> 'channel', coalesce(m ->> 'to', ''), coalesce(m ->> 'subject', ''),
            coalesce(m ->> 'body', ''), m ->> 'status', m ->> 'dir', pg_catalog.left(m ->> 'from', 320), pg_catalog.left(m ->> 'threadId', 200), v_client,
            case when m ->> 'dir' = 'in' then false end, p_provider, pg_catalog.left(m ->> 'externalId', 300), (m ->> 'seconds')::integer, pg_catalog.left(m ->> 'error', 1000))
    on conflict (tenant_id, provider, external_id) where external_id is not null do nothing;
    get diagnostics v_rows = row_count;
    n_msg := n_msg + v_rows;
  end loop;

  for it in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'statuses', '[]'::jsonb)) e loop
    -- A state only moves forward: queued, sent, failed, delivered. A late "sent" does not undo a "delivered".
    update public.messages x
    set status = it ->> 'status',
        error = case when it ->> 'status' = 'failed' then pg_catalog.left(it ->> 'error', 1000) else null end
    where x.tenant_id = p_tenant and x.external_id = it ->> 'externalId'
      -- a text sent by the text adapter is reported on by the company that carried it
      and x.provider in (p_provider, case when p_provider = 'dialpad' then 'sms' else p_provider end)
      and x.dir is distinct from 'in'
      and it ->> 'status' in ('sent', 'delivered', 'failed')
      and (case x.status when 'queued' then 1 when 'sent' then 2 when 'failed' then 3 when 'delivered' then 4 else 9 end)
        < (case it ->> 'status' when 'sent' then 2 when 'failed' then 3 else 4 end);
    get diagnostics v_rows = row_count;
    n_status := n_status + v_rows;
  end loop;

  for it in select e from pg_catalog.jsonb_array_elements(coalesce(p_batch -> 'consent', '[]'::jsonb)) e loop
    v_addr := app.e164(it ->> 'address');
    if v_addr is null or coalesce(it ->> 'channel', '') not in ('text', 'whatsapp') then continue; end if;
    v_at := coalesce((it ->> 'at')::timestamptz, pg_catalog.now());
    if it ->> 'action' = 'opt_out' then
      insert into public.messaging_consents as c (tenant_id, channel, address, status, source, revoked_at)
      values (p_tenant, it ->> 'channel', v_addr, 'opted_out', case when it ->> 'source' = 'provider' then 'provider' else 'keyword' end, v_at)
      on conflict (tenant_id, channel, address) do update
        set status = 'opted_out', source = excluded.source, revoked_at = excluded.revoked_at
        where c.status <> 'opted_out';
      get diagnostics v_rows = row_count;
      n_consent := n_consent + v_rows;
    elsif it ->> 'action' = 'opt_in' then
      -- START undoes a STOP for a number that had agreed before. It never creates consent out of nothing: a first
      -- opt-in needs a record of what the person agreed to.
      update public.messaging_consents c
      set status = 'opted_in', source = 'keyword', granted_at = v_at, revoked_at = null
      where c.tenant_id = p_tenant and c.channel = it ->> 'channel' and c.address = v_addr
        and c.status = 'opted_out' and c.source in ('keyword', 'provider') and c.granted_at is not null;
      get diagnostics v_rows = row_count;
      n_consent := n_consent + v_rows;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('messages', n_msg, 'statuses', n_status, 'consent', n_consent);
end
$$;

-- What the sending job needs for one queued message: the message, the consent of its recipient as it is now, and
-- when that person last wrote on the same thread.
create or replace function public.messaging_outbox_get(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'message', pg_catalog.jsonb_build_object('id', m.id, 'channel', m.channel, 'to', m.recipient, 'subject', m.subject, 'body', m.body,
                                             'status', m.status, 'externalId', m.external_id, 'threadId', m.thread_id),
    'consent', (select pg_catalog.jsonb_build_object('status', c.status, 'channel', c.channel, 'address', c.address, 'grantedAt', c.granted_at,
                                                     'revokedAt', c.revoked_at, 'expiresAt', c.expires_at, 'recordId', c.consent_record_id)
                from public.messaging_consents c
                where c.tenant_id = m.tenant_id and c.channel = m.channel and c.address = app.e164(m.recipient)),
    'lastInboundAt', (select pg_catalog.max(i.at) from public.messages i
                      where i.tenant_id = m.tenant_id and i.channel = m.channel and i.dir = 'in' and i.thread_id is not null and i.thread_id = m.thread_id),
    'quietHours', null)
  from public.messages m
  where m.tenant_id = p_tenant and m.id = p_id
$$;

-- Writes the outcome of a send. Only a message that is still queued can be changed, so a second call does nothing.
create or replace function public.messaging_send_result(p_tenant uuid, p_id uuid, p_status text, p_external_id text, p_error text, p_meta jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('queued', 'sent', 'failed') then raise exception 'unknown status' using errcode = '22023'; end if;
  update public.messages m
  set status = p_status,
      external_id = coalesce(pg_catalog.left(p_external_id, 300), m.external_id),
      error = case when p_status = 'failed' then pg_catalog.left(p_error, 1000) end,
      provider = coalesce(m.provider, case m.channel when 'text' then 'sms' when 'whatsapp' then 'whatsapp' when 'facebook' then 'meta' when 'instagram' then 'meta' end)
  where m.tenant_id = p_tenant and m.id = p_id and m.status = 'queued' and m.external_id is null and m.dir is distinct from 'in';
  return found;
end
$$;

-- Queued messages no provider has yet (for the scheduled run), oldest first.
create or replace function public.messaging_outbox_due(p_limit integer default 100) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id)), '[]'::jsonb)
  from (
    select m.id, m.tenant_id from public.messages m
    where m.status = 'queued' and m.external_id is null and m.dir is distinct from 'in' and m.channel in ('text', 'whatsapp', 'facebook', 'instagram')
    order by m.at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x
$$;

-- Scheduled posts whose time has come.
create or replace function public.social_posts_due(p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id, 'scheduled_for', x.scheduled_for)), '[]'::jsonb)
  from (
    select p.id, p.tenant_id, p.scheduled_for from public.social_posts p
    where p.status = 'scheduled' and p.scheduled_for <= pg_catalog.now()
    order by p.scheduled_for
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
$$;

-- One post for the publishing job. "published" holds the provider id of each channel that already went out.
create or replace function public.social_post_claim(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('id', p.id, 'status', case when p.status = 'scheduled' and p.scheduled_for > pg_catalog.now() then 'waiting' else p.status end,
    'text', p.text, 'media', p.media, 'channels', pg_catalog.to_jsonb(p.channels), 'published', coalesce(p.extra -> 'published', '{}'::jsonb))
  from public.social_posts p
  where p.tenant_id = p_tenant and p.id = p_id
$$;

-- Writes the outcome of publishing. "scheduled" keeps the post waiting and records the channels done so far.
create or replace function public.social_post_result(p_tenant uuid, p_id uuid, p_status text, p_error text, p_published jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('scheduled', 'published', 'failed') then raise exception 'unknown status' using errcode = '22023'; end if;
  update public.social_posts p
  set status = p_status,
      error = case when p_status = 'failed' then pg_catalog.left(p_error, 1000) end,
      published_at = case when p_status = 'published' then pg_catalog.now() else p.published_at end,
      extra = pg_catalog.jsonb_set(p.extra, '{published}', case when pg_catalog.jsonb_typeof(p_published) = 'object' then p_published else '{}'::jsonb end)
  where p.tenant_id = p_tenant and p.id = p_id and p.status = 'scheduled';
  return found;
end
$$;

-- An Instagram webhook names the Instagram account, not the Page the connection was verified for. The Meta adapter
-- keeps that id in the connection settings (ig_account_id), so the lookup accepts it. Otherwise as in 0026.
create or replace function public.conn_by_account(p_provider text, p_account_ref text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('tenant_id', c.tenant_id, 'id', c.id, 'state', c.state)
  from app.integration_connections c
  where c.provider = p_provider and c.state in ('connected', 'attention')
    and (c.account_ref = p_account_ref or (p_provider = 'meta' and c.settings ->> 'ig_account_id' = p_account_ref))
  order by c.connected_at desc nulls last
  limit 1
$$;

revoke all on function public.messaging_ingest(uuid, text, jsonb), public.messaging_outbox_get(uuid, uuid),
  public.messaging_send_result(uuid, uuid, text, text, text, jsonb), public.messaging_outbox_due(integer),
  public.social_posts_due(integer), public.social_post_claim(uuid, uuid), public.social_post_result(uuid, uuid, text, text, jsonb),
  public.conn_by_account(text, text) from public, anon, authenticated;
grant execute on function public.messaging_ingest(uuid, text, jsonb), public.messaging_outbox_get(uuid, uuid),
  public.messaging_send_result(uuid, uuid, text, text, text, jsonb), public.messaging_outbox_due(integer),
  public.social_posts_due(integer), public.social_post_claim(uuid, uuid), public.social_post_result(uuid, uuid, text, text, jsonb),
  public.conn_by_account(text, text) to service_role;

select app.lockdown_check();
