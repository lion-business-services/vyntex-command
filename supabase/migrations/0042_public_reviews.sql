-- 0042 Review requests, the server side (the brief, section 33)
--   review_send_check   with the PERSON'S token: may they send this draft, and who it goes to
--   review_send_commit  the server issues the private link (only its hash is stored) and queues the message that
--                       carries it. The request stays a draft until a provider accepted the message (0043 marks it sent).
--   review_open         the public page opens the link
--   review_answer       the client's answer: a rating with an optional comment, or "no thanks". The link is used up.
--                       A rating of 3 or lower creates one follow-up task. The company's public review link is returned
--                       after ANY rating: a low rating is never kept away from it.

create or replace function app.review_public_url(p_tenant uuid) returns text
language sql stable
set search_path = ''
as $$
  -- a public review link is only ever a secure web address
  select case when u ~ '^https://[^/\s]+\.[^/\s]+' and length(u) <= 500 then u else '' end
  from (select btrim(coalesce(t.settings #>> '{reviews,publicUrl}', '')) as u from public.tenants t where t.id = p_tenant) x
$$;
revoke all on function app.review_public_url(uuid) from public, anon, authenticated, service_role;

create or replace function public.review_send_check(p_tenant uuid, p_review uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.review_requests%rowtype;
  c public.clients%rowtype;
begin
  perform app.require_mfa(p_tenant);
  if not (app.can(p_tenant, 'reviews') and app.can(p_tenant, 'write')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into r from public.review_requests x where x.tenant_id = p_tenant and x.id = p_review and x.client_id not in (select app.hidden_clients());
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into c from public.clients x where x.tenant_id = p_tenant and x.id = r.client_id;
  return jsonb_build_object('reviewId', r.id, 'status', r.status, 'channel', r.channel, 'member', app.current_member(p_tenant),
    'company', (select t.name from public.tenants t where t.id = p_tenant),
    'firstName', split_part(btrim(c.name), ' ', 1), 'hasEmail', c.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$', 'emailOptOut', c.email_opt_out,
    'lang', coalesce(c.lang, 'en'),
    'linkDays', least(365, greatest(1, coalesce(nullif(t_days.v, '')::integer, 30))),
    'pending', exists (select 1 from public.messages m where m.tenant_id = p_tenant and m.id::text = r.extra ->> 'messageId' and m.status = 'queued'))
  from (select (select t.settings #>> '{reviews,linkDays}' from public.tenants t where t.id = p_tenant) as v) t_days;
end
$$;

create or replace function public.review_send_commit(p_tenant uuid, p_review uuid, p_token_hash text, p_ttl_hours integer, p_subject text, p_body text,
  p_sealed_link text, p_member uuid default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.review_requests%rowtype;
  c public.clients%rowtype;
  v_msg uuid;
begin
  select * into r from public.review_requests x where x.tenant_id = p_tenant and x.id = p_review for update;
  if not found or r.status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'not_draft'); end if;
  select * into c from public.clients x where x.tenant_id = p_tenant and x.id = r.client_id;
  if c.email_opt_out then return jsonb_build_object('ok', false, 'reason', 'opted_out'); end if;
  if c.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('ok', false, 'reason', 'no_address'); end if;
  perform public.link_issue(p_tenant, 'review', p_review, p_token_hash, p_ttl_hours);
  -- the body holds a placeholder; the address itself travels sealed and is put in when the message is handed over
  insert into public.messages (tenant_id, channel, recipient, subject, body, status, ref_type, ref_id, client_id, dir, by_member_id, auto, extra)
  values (p_tenant, 'email', c.email, left(coalesce(p_subject, ''), 300), left(coalesce(p_body, ''), 8000), 'queued', 'review', p_review, c.id, 'out', p_member,
          -- "auto" is unique per company: one request message per review request and link
          'review.request:' || p_review || ':' || left(p_token_hash, 12), jsonb_build_object('system', true, 'link', p_sealed_link))
  returning id into v_msg;
  update public.review_requests x
     set extra = x.extra || jsonb_build_object('messageId', v_msg, 'expires', to_char((now() + make_interval(hours => p_ttl_hours)) at time zone 'UTC', 'YYYY-MM-DD')) - 'token'
   where x.tenant_id = p_tenant and x.id = p_review;
  return jsonb_build_object('ok', true, 'messageId', v_msg);
end
$$;

-- What the public page shows for a link, or NULL. The first opening is recorded.
create or replace function public.review_open(p_token_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l app.public_links%rowtype;
  r public.review_requests%rowtype;
begin
  select * into l from app.public_links x
   where x.token_hash = p_token_hash and x.purpose = 'review' and x.used_at is null and x.revoked_at is null and x.expires_at > now();
  if not found then return null; end if;
  select * into r from public.review_requests x where x.tenant_id = l.tenant_id and x.id = l.review_id;
  if not found or r.status not in ('draft', 'sent', 'opened') then return null; end if;
  if r.status = 'sent' then
    update public.review_requests x set status = 'opened', extra = x.extra || jsonb_build_object('openedAt', app.ws_iso(now()))
     where x.tenant_id = r.tenant_id and x.id = r.id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('tenantId', l.tenant_id,
    'company', (select t.name from public.tenants t where t.id = l.tenant_id),
    'firstName', (select split_part(btrim(c.name), ' ', 1) from public.clients c where c.tenant_id = r.tenant_id and c.id = r.client_id),
    'job', (select j.name from public.jobs j where j.tenant_id = r.tenant_id and j.id = r.job_id),
    'state', 'open', 'publicUrl', nullif(app.review_public_url(l.tenant_id), '')));
end
$$;

create or replace function public.review_answer(p_token_hash text, p_rating integer, p_comment text, p_decline boolean, p_ip_hash text default null,
  p_request_hash text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l app.public_links%rowtype;
  r public.review_requests%rowtype;
  v_task uuid;
  v_out jsonb;
  v_es boolean;
  v_client text;
begin
  select * into l from app.public_links x where x.token_hash = p_token_hash and x.purpose = 'review' for update;
  if not found or l.revoked_at is not null then return null; end if;
  if l.used_at is not null then
    -- the same answer sent again (a retry) gets the answer given then, and changes nothing
    if p_request_hash is not null and l.request_hash = p_request_hash and l.result is not null then return l.result; end if;
    return null;
  end if;
  if l.expires_at <= now() then return null; end if;
  select * into r from public.review_requests x where x.tenant_id = l.tenant_id and x.id = l.review_id for update;
  if not found or r.status not in ('draft', 'sent', 'opened') then return null; end if;
  if coalesce(p_decline, false) then
    update public.review_requests x set status = 'declined', extra = x.extra || jsonb_build_object('answeredAt', app.ws_iso(now()))
     where x.tenant_id = r.tenant_id and x.id = r.id;
    v_out := jsonb_build_object('ok', true, 'declined', true);
  else
    if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid' using errcode = '22023'; end if;
    if p_rating <= 3 and not exists (select 1 from public.tasks t where t.tenant_id = r.tenant_id and t.auto = 'review-low:' || r.id) then
      select coalesce(t.settings ->> 'lang', 'en') = 'es' into v_es from public.tenants t where t.id = r.tenant_id;
      select c.name into v_client from public.clients c where c.tenant_id = r.tenant_id and c.id = r.client_id;
      insert into public.tasks (tenant_id, title, description, client_id, job_id, assignee_member_id, due, status, pri, auto)
      values (r.tenant_id,
              left(case when v_es then 'Llamar a ' || v_client || ' por su opinión (' || p_rating || ' de 5)' else 'Call ' || v_client || ' about their feedback (' || p_rating || ' of 5)' end, 300),
              case when btrim(coalesce(p_comment, '')) <> '' then (case when v_es then 'Lo que escribió: ' else 'What they wrote: ' end) || left(btrim(p_comment), 3000) end,
              r.client_id, r.job_id,
              (select m.id from public.tenant_members m where m.tenant_id = r.tenant_id and m.id = r.by_member_id and m.status <> 'disabled'),
              current_date, 'todo', 'high', 'review-low:' || r.id)
      returning id into v_task;
    end if;
    update public.review_requests x
       set status = 'rated', rating = p_rating, comment = nullif(left(btrim(coalesce(p_comment, '')), 4000), ''),
           extra = x.extra || jsonb_strip_nulls(jsonb_build_object('answeredAt', app.ws_iso(now()), 'taskId', v_task))
     where x.tenant_id = r.tenant_id and x.id = r.id;
    -- the public link goes back whatever the rating was
    v_out := jsonb_strip_nulls(jsonb_build_object('ok', true, 'low', p_rating <= 3, 'publicUrl', nullif(app.review_public_url(r.tenant_id), '')));
  end if;
  update app.public_links x set used_at = now(), request_hash = p_request_hash, result = v_out where x.id = l.id;
  perform app.security_event(r.tenant_id, null, 'review.answered', 'ok', p_ip_hash, jsonb_build_object('review', r.id, 'declined', coalesce(p_decline, false)));
  return v_out || jsonb_build_object('tenantId', r.tenant_id);
end
$$;

revoke all on function public.review_send_commit(uuid, uuid, text, integer, text, text, text, uuid), public.review_open(text),
  public.review_answer(text, integer, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_send_commit(uuid, uuid, text, integer, text, text, text, uuid), public.review_open(text),
  public.review_answer(text, integer, text, boolean, text, text) to service_role;
revoke all on function public.review_send_check(uuid, uuid) from public, anon, service_role;
grant execute on function public.review_send_check(uuid, uuid) to authenticated;

select app.lockdown_check();
