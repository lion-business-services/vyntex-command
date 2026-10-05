-- 0041 The server side of signature requests: sending, a signer opening, signing or declining, the signed copy
-- (the brief, section 18). 0035 left these to the server; this file is how the server writes them.
--
-- How a signer's answer is recorded. The rules (whose turn it is, required boxes, releasing the next signer, completing)
-- are written once, in src/domain/esign/envelope.ts, and the server runs them. The server reaches the database through
-- function calls only, each one its own transaction, so one answer is three steps:
--   1. sign_open      reads the request behind a link, and how long its trail is ("rev")
--   2. the server runs the rules on what it read
--   3. sign_commit    one transaction: locks the link, locks the request row, and writes ONLY when the trail is still as
--                     long as in step 1. If someone else wrote in between it answers "conflict" and the server starts
--                     again from step 1 with what is there now. Two signers answering at the same moment therefore both
--                     land: the second one waits for the row lock, is told to read again, and is applied on top.
-- A link is used up by the answer (signed or declined). The answer is remembered with the link, so the same request
-- sent again (a retry after a lost connection) gets the same answer and changes nothing.
--
-- Nothing here is executable by a signed-in person or by anon, except envelope_send_check, which a member with the
-- "esign" capability calls with their own token before the server sends a request.

alter table app.public_links add column if not exists request_hash text check (request_hash ~ '^[0-9a-f]{64}$');
alter table app.public_links add column if not exists result jsonb;

-- ---------------------------------------------------------------------------------------------------------------------
-- A request as the domain code reads it (EnvelopeX): the columns, the fields kept in "extra", signers and boxes.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.envelope_json(p_tenant uuid, p_envelope uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select (e.extra - array['id', 'docId', 'title', 'status', 'ordered', 'created', 'createdBy', 'sentAt', 'expiresAt', 'completedAt', 'remindEvery',
                          'lastReminder', 'events', 'demo', 'signedFile', 'signers', 'fields'])
    || jsonb_strip_nulls(jsonb_build_object('id', e.id, 'docId', e.doc_id, 'title', e.title, 'status', e.status, 'ordered', e.ordered,
         'created', app.ws_iso(e.created), 'createdBy', e.created_by, 'sentAt', app.ws_iso(e.sent_at), 'expiresAt', app.ws_iso(e.expires_at),
         'completedAt', app.ws_iso(e.completed_at), 'remindEvery', e.remind_every, 'lastReminder', app.ws_iso(e.last_reminder),
         'demo', e.demo, 'signedFile', e.signed_file))
    || jsonb_build_object('events', e.events,
         'signers', coalesce((select jsonb_agg((s.extra - array['id', 'name', 'email', 'role', 'order', 'status', 'viewedAt', 'signedAt', 'typedName', 'signature', 'consent', 'ipHash'])
              || jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'role', s.role, 'order', s.sign_order, 'status', s.status,
                   'viewedAt', app.ws_iso(s.viewed_at), 'signedAt', app.ws_iso(s.signed_at), 'typedName', s.typed_name, 'signature', s.signature, 'consent', s.consent))
              order by s.sign_order, s.created_at, s.id)
            from public.envelope_signers s where s.tenant_id = e.tenant_id and s.envelope_id = e.id), '[]'::jsonb),
         'fields', coalesce((select jsonb_agg((f.extra - array['id', 'signerId', 'type', 'page', 'x', 'y', 'w', 'h', 'label', 'required', 'value'])
              || jsonb_strip_nulls(jsonb_build_object('id', f.id, 'signerId', f.signer_id, 'type', f.type, 'page', f.page, 'x', f.x, 'y', f.y, 'w', f.w, 'h', f.h,
                   'label', f.label, 'required', f.required, 'value', f.value))
              order by f.position, f.id)
            from public.envelope_fields f where f.tenant_id = e.tenant_id and f.envelope_id = e.id), '[]'::jsonb))
  from public.envelopes e where e.tenant_id = p_tenant and e.id = p_envelope
$$;
revoke all on function app.envelope_json(uuid, uuid) from public, anon, authenticated, service_role;

-- Writes back what the rules changed: the state of the request, of each signer and of each box. Nothing else of a
-- request can be changed through here (not its document, its signers' names or addresses, or where the boxes are),
-- and the trail can only grow: what is already in it has to come back unchanged.
create or replace function app.envelope_store(p_tenant uuid, p_envelope uuid, p_new jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb;
  n integer;
  s jsonb;
begin
  select e.events into v_old from public.envelopes e where e.tenant_id = p_tenant and e.id = p_envelope;
  n := jsonb_array_length(v_old);
  if jsonb_typeof(p_new -> 'events') <> 'array' or jsonb_array_length(p_new -> 'events') < n
     or (n > 0 and jsonb_path_query_array(p_new -> 'events', ('$[0 to ' || (n - 1) || ']')::jsonpath) <> v_old) then
    raise exception 'trail_rewritten' using errcode = 'P0001';
  end if;
  update public.envelopes e
     set status = p_new ->> 'status', sent_at = (p_new ->> 'sentAt')::timestamptz, expires_at = (p_new ->> 'expiresAt')::timestamptz,
         completed_at = (p_new ->> 'completedAt')::timestamptz, last_reminder = (p_new ->> 'lastReminder')::timestamptz,
         events = p_new -> 'events',
         extra = e.extra || jsonb_strip_nulls(jsonb_build_object('consentText', p_new -> 'consentText', 'hashes', p_new -> 'hashes'))
   where e.tenant_id = p_tenant and e.id = p_envelope;
  for s in select * from jsonb_array_elements(coalesce(p_new -> 'signers', '[]'::jsonb)) loop
    update public.envelope_signers x
       set status = s ->> 'status', viewed_at = (s ->> 'viewedAt')::timestamptz, signed_at = (s ->> 'signedAt')::timestamptz,
           typed_name = s ->> 'typedName', signature = s ->> 'signature', consent = (s ->> 'consent')::boolean,
           extra = x.extra || jsonb_strip_nulls(jsonb_build_object('sentAt', s -> 'sentAt', 'declinedAt', s -> 'declinedAt', 'declineReason', s -> 'declineReason',
                     'consentAt', s -> 'consentAt', 'initials', s -> 'initials', 'lastReminder', s -> 'lastReminder'))
     where x.tenant_id = p_tenant and x.envelope_id = p_envelope and x.id = (s ->> 'id')::uuid;
  end loop;
  for s in select * from jsonb_array_elements(coalesce(p_new -> 'fields', '[]'::jsonb)) loop
    update public.envelope_fields f set value = s ->> 'value'
     where f.tenant_id = p_tenant and f.envelope_id = p_envelope and f.id = (s ->> 'id')::uuid and f.value is distinct from (s ->> 'value');
  end loop;
end
$$;
revoke all on function app.envelope_store(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- Gives the signers the rules just let in their links. p_links: [{ signerId, tokenHash }]. One live link per signer:
-- an earlier one is taken back. A link lasts as long as the request does.
create or replace function app.envelope_links(p_tenant uuid, p_envelope uuid, p_links jsonb) returns integer
language plpgsql
set search_path = ''
as $$
declare
  l jsonb;
  n integer := 0;
  v_until timestamptz;
begin
  select coalesce(e.expires_at, now() + interval '30 days') into v_until from public.envelopes e where e.tenant_id = p_tenant and e.id = p_envelope;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if (l ->> 'tokenHash') !~ '^[0-9a-f]{64}$' or not exists (select 1 from public.envelope_signers s
         where s.tenant_id = p_tenant and s.envelope_id = p_envelope and s.id = (l ->> 'signerId')::uuid and s.status in ('sent', 'viewed')) then
      raise exception 'invalid_link' using errcode = 'P0001';
    end if;
    update app.public_links x set revoked_at = now()
     where x.tenant_id = p_tenant and x.purpose = 'sign' and x.signer_id = (l ->> 'signerId')::uuid and x.used_at is null and x.revoked_at is null;
    insert into app.public_links (tenant_id, purpose, token_hash, signer_id, expires_at)
    values (p_tenant, 'sign', l ->> 'tokenHash', (l ->> 'signerId')::uuid, greatest(v_until, now() + interval '1 hour'));
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke all on function app.envelope_links(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The signing page
-- ---------------------------------------------------------------------------------------------------------------------
-- What a link opens right now, or NULL (unknown, another purpose, used, revoked, expired: all the same answer).
-- With p_request_hash: when the link was used up by exactly this request, the answer given then ("replay").
create or replace function public.sign_open(p_token_hash text, p_request_hash text default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  l app.public_links%rowtype;
  v_env uuid;
begin
  select * into l from app.public_links x where x.token_hash = p_token_hash and x.purpose = 'sign';
  if not found or l.revoked_at is not null then return null; end if;
  if l.used_at is not null then
    if p_request_hash is not null and l.request_hash = p_request_hash and l.result is not null then
      return jsonb_build_object('replay', l.result);
    end if;
    return null;
  end if;
  if l.expires_at <= now() then return null; end if;
  select s.envelope_id into v_env from public.envelope_signers s where s.tenant_id = l.tenant_id and s.id = l.signer_id;
  if v_env is null then return null; end if;
  return (
    select jsonb_build_object('tenantId', l.tenant_id, 'signerId', l.signer_id, 'envelopeId', e.id, 'rev', jsonb_array_length(e.events),
             'company', t.name, 'envelope', app.envelope_json(l.tenant_id, e.id),
             'doc', (select jsonb_build_object('title', d.title, 'number', d.number) from public.documents d where d.tenant_id = e.tenant_id and d.id = e.doc_id),
             'sentBy', (select m.name from public.tenant_members m where m.tenant_id = e.tenant_id and m.id = e.created_by))
    from public.envelopes e join public.tenants t on t.id = e.tenant_id
    where e.tenant_id = l.tenant_id and e.id = v_env and not e.demo);
end
$$;

-- Step 3 (see the head of this file). p_action: viewed, signed or declined. p_links: links for the signers this
-- answer let in. Returns NULL when the link is not usable, { conflict: true } when the request changed since it was
-- read, { ok: true } when it was written.
create or replace function public.sign_commit(p_token_hash text, p_action text, p_rev integer, p_envelope jsonb, p_links jsonb default '[]'::jsonb,
  p_ip_hash text default null, p_request_hash text default null, p_result jsonb default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l app.public_links%rowtype;
  v_env uuid;
  v_len integer;
begin
  if p_action is null or p_action not in ('viewed', 'signed', 'declined') then raise exception 'invalid' using errcode = '22023'; end if;
  select * into l from app.public_links x
   where x.token_hash = p_token_hash and x.purpose = 'sign' and x.used_at is null and x.revoked_at is null and x.expires_at > now()
   for update;
  if not found then return null; end if;
  select s.envelope_id into v_env from public.envelope_signers s where s.tenant_id = l.tenant_id and s.id = l.signer_id;
  -- the row lock: one writer per request at a time
  select jsonb_array_length(e.events) into v_len from public.envelopes e where e.tenant_id = l.tenant_id and e.id = v_env and not e.demo for update;
  if not found then return null; end if;
  if v_len <> p_rev then return jsonb_build_object('conflict', true); end if;
  perform app.envelope_store(l.tenant_id, v_env, p_envelope);
  if p_action in ('signed', 'declined') then
    update app.public_links x set used_at = now(), request_hash = p_request_hash, result = p_result where x.id = l.id;
    -- from where, as a salted hash only: the address itself is never stored
    update public.envelope_signers s set extra = s.extra || jsonb_strip_nulls(jsonb_build_object('ipHash', p_ip_hash))
     where s.tenant_id = l.tenant_id and s.id = l.signer_id;
    if p_action = 'declined' then
      -- nobody else can sign a request that was declined
      update app.public_links x set revoked_at = now()
       where x.tenant_id = l.tenant_id and x.purpose = 'sign' and x.used_at is null and x.revoked_at is null
         and x.signer_id in (select s.id from public.envelope_signers s where s.tenant_id = l.tenant_id and s.envelope_id = v_env);
    end if;
  end if;
  perform app.envelope_links(l.tenant_id, v_env, p_links);
  if (p_envelope ->> 'status') = 'completed' then
    update public.documents d set status = 'signed', updated = current_date
     where d.tenant_id = l.tenant_id and d.id = (select e.doc_id from public.envelopes e where e.tenant_id = l.tenant_id and e.id = v_env) and d.status in ('draft', 'sent', 'viewed');
  end if;
  perform app.security_event(l.tenant_id, null, 'esign.' || p_action, 'ok', p_ip_hash, jsonb_build_object('envelope', v_env, 'signer', l.signer_id));
  return jsonb_build_object('ok', true, 'tenantId', l.tenant_id, 'envelopeId', v_env);
end
$$;

-- The signed copy, once it is in private storage: the file on the request, the fingerprints, and a new version of the
-- document. Safe to repeat: a request that already has its signed copy is left as it is.
create or replace function public.sign_finalize(p_tenant uuid, p_envelope uuid, p_file jsonb, p_hashes jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  e public.envelopes%rowtype;
  v_n integer;
begin
  if jsonb_typeof(p_file) <> 'object' or (p_file ->> 'path') is null or left(p_file ->> 'path', 37) <> p_tenant::text || '/'
     or (p_hashes ->> 'original') !~ '^[0-9a-f]{64}$' or (p_hashes ->> 'signed') !~ '^[0-9a-f]{64}$' or (p_hashes ->> 'final') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into e from public.envelopes x where x.tenant_id = p_tenant and x.id = p_envelope for update;
  if not found or e.status <> 'completed' then raise exception 'not_completed' using errcode = 'P0001'; end if;
  if e.signed_file is not null then return false; end if;
  update public.envelopes x
     set signed_file = p_file, extra = x.extra || jsonb_build_object('hashes', p_hashes),
         events = x.events || jsonb_build_array(jsonb_build_object('at', app.ws_iso(now()), 'kind', 'signed_copy'))
   where x.tenant_id = p_tenant and x.id = p_envelope;
  select coalesce(max((v ->> 'v')::integer), 0) into v_n from public.documents d, jsonb_array_elements(coalesce(d.versions, '[]'::jsonb)) v
   where d.tenant_id = p_tenant and d.id = e.doc_id;
  update public.documents d
     set versions = coalesce(d.versions, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('v', v_n + 1, 'at', app.ws_iso(now()), 'by', 'system',
           'kind', 'signed', 'file', p_file, 'hashes', p_hashes)),
         updated = current_date
   where d.tenant_id = p_tenant and d.id = e.doc_id;
  perform app.security_event(p_tenant, null, 'esign.completed', 'ok', null, jsonb_build_object('envelope', p_envelope));
  return true;
end
$$;

-- A request by its id, for the server's own work (the signed copy, reminders, expiry). Never reachable by a person.
create or replace function public.envelope_get(p_tenant uuid, p_envelope uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('tenantId', e.tenant_id, 'envelopeId', e.id, 'rev', jsonb_array_length(e.events), 'company', t.name,
           'envelope', app.envelope_json(e.tenant_id, e.id),
           'doc', (select jsonb_build_object('title', d.title, 'number', d.number) from public.documents d where d.tenant_id = e.tenant_id and d.id = e.doc_id),
           'sentBy', (select m.name from public.tenant_members m where m.tenant_id = e.tenant_id and m.id = e.created_by))
  from public.envelopes e join public.tenants t on t.id = e.tenant_id
  where e.tenant_id = p_tenant and e.id = p_envelope and not e.demo
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------------------------------------------------
-- Called with the PERSON'S token before the server sends: may they send this request, and the facts the rules need
-- (was the wording of the document approved, did the company approve its consent sentence, is there a file).
create or replace function public.envelope_send_check(p_tenant uuid, p_envelope uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  e public.envelopes%rowtype;
  d public.documents%rowtype;
  v_lang text;
  v_consent text;
  v_consent_ok boolean := false;
  v_tpl_ok boolean;
begin
  perform app.require_mfa(p_tenant);
  if not (app.can(p_tenant, 'esign') and app.can(p_tenant, 'write')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into e from public.envelopes x where x.tenant_id = p_tenant and x.id = p_envelope
     and (x.client_id is null or x.client_id not in (select app.hidden_clients()));
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into d from public.documents x where x.tenant_id = p_tenant and x.id = e.doc_id;
  v_lang := coalesce(e.extra ->> 'lang', 'en');
  -- the consent sentence is wording like any other: one template per language, marked use = consent, approved or not
  select btrim(b.text), t.approved into v_consent, v_consent_ok
    from public.doc_templates t join public.doc_template_blocks b on b.tenant_id = t.tenant_id and b.template_id = t.id
   where t.tenant_id = p_tenant and t.extra ->> 'use' = 'consent' and t.lang in (v_lang, 'en') and btrim(b.text) <> ''
   order by (t.lang = v_lang) desc, b.position, b.id limit 1;
  v_tpl_ok := d.template_id is null or coalesce((select t.approved from public.doc_templates t where t.tenant_id = p_tenant and t.id = d.template_id), false);
  return jsonb_build_object('tenantId', p_tenant, 'envelopeId', e.id, 'rev', jsonb_array_length(e.events), 'demo', e.demo,
    'company', (select t.name from public.tenants t where t.id = p_tenant), 'member', app.current_member(p_tenant),
    'envelope', app.envelope_json(p_tenant, e.id),
    'templateApproved', v_tpl_ok,
    'consentApproved', coalesce(v_consent_ok, false) and coalesce(v_consent, '') <> '' and v_consent !~ '\[[^\]]*\]|\{\{',
    'consentText', coalesce(v_consent, ''),
    'hasDocument', d.id is not null and d.status <> 'void' and left(coalesce(e.extra #>> '{source,path}', ''), 37) = p_tenant::text || '/');
end
$$;

-- Records a request as sent, or a reminder, or its expiry: the server's writes that do not come from a signer.
-- p_action: sent (the request must still be a draft), reminded, expired. Same "rev" rule as sign_commit.
create or replace function public.envelope_commit(p_tenant uuid, p_envelope uuid, p_action text, p_rev integer, p_new jsonb, p_links jsonb default '[]'::jsonb,
  p_member uuid default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  e public.envelopes%rowtype;
begin
  if p_action is null or p_action not in ('sent', 'reminded', 'expired') then raise exception 'invalid' using errcode = '22023'; end if;
  select * into e from public.envelopes x where x.tenant_id = p_tenant and x.id = p_envelope and not x.demo for update;
  if not found then return null; end if;
  if jsonb_array_length(e.events) <> p_rev then return jsonb_build_object('conflict', true); end if;
  if (p_action = 'sent' and e.status <> 'draft') or (p_action <> 'sent' and e.status not in ('sent', 'partly_signed')) then
    return jsonb_build_object('conflict', true);
  end if;
  perform app.envelope_store(p_tenant, p_envelope, p_new);
  if p_action = 'expired' then
    update app.public_links x set revoked_at = now()
     where x.tenant_id = p_tenant and x.purpose = 'sign' and x.used_at is null and x.revoked_at is null
       and x.signer_id in (select s.id from public.envelope_signers s where s.tenant_id = p_tenant and s.envelope_id = p_envelope);
  else
    perform app.envelope_links(p_tenant, p_envelope, p_links);
  end if;
  if p_action = 'sent' then
    update public.documents d set status = 'sent', updated = current_date, envelope_id = p_envelope
     where d.tenant_id = p_tenant and d.id = e.doc_id and d.status = 'draft';
  end if;
  perform app.security_event(p_tenant, (select m.user_id from public.tenant_members m where m.tenant_id = p_tenant and m.id = p_member),
    'esign.' || p_action, 'ok', null, jsonb_build_object('envelope', p_envelope));
  return jsonb_build_object('ok', true);
end
$$;

-- Open requests whose time is up or whose reminder is due, for the daily run. The rules decide again per request.
create or replace function public.envelopes_due(p_limit integer default 200) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenantId', x.tenant_id, 'envelopeId', x.id)), '[]'::jsonb)
  from (select e.tenant_id, e.id from public.envelopes e
        where e.status in ('sent', 'partly_signed') and not e.demo
          and (e.expires_at <= now()
            or (e.remind_every is not null and coalesce(e.last_reminder, e.sent_at) <= now() - make_interval(days => e.remind_every)))
        order by e.expires_at limit greatest(1, least(coalesce(p_limit, 200), 1000))) x
$$;

-- Completed requests that still have no signed copy (the server stopped between the last signature and the file).
create or replace function public.envelopes_unfinished(p_limit integer default 50) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenantId', x.tenant_id, 'envelopeId', x.id)), '[]'::jsonb)
  from (select e.tenant_id, e.id from public.envelopes e where e.status = 'completed' and not e.demo and e.signed_file is null
        order by e.completed_at limit greatest(1, least(coalesce(p_limit, 50), 500))) x
$$;

revoke all on function public.sign_open(text, text), public.sign_commit(text, text, integer, jsonb, jsonb, text, text, jsonb),
  public.sign_finalize(uuid, uuid, jsonb, jsonb), public.envelope_get(uuid, uuid),
  public.envelope_commit(uuid, uuid, text, integer, jsonb, jsonb, uuid), public.envelopes_due(integer), public.envelopes_unfinished(integer)
  from public, anon, authenticated;
grant execute on function public.sign_open(text, text), public.sign_commit(text, text, integer, jsonb, jsonb, text, text, jsonb),
  public.sign_finalize(uuid, uuid, jsonb, jsonb), public.envelope_get(uuid, uuid),
  public.envelope_commit(uuid, uuid, text, integer, jsonb, jsonb, uuid), public.envelopes_due(integer), public.envelopes_unfinished(integer)
  to service_role;
revoke all on function public.envelope_send_check(uuid, uuid) from public, anon, service_role;
grant execute on function public.envelope_send_check(uuid, uuid) to authenticated;

-- The server stores the signed copy and reads the file that was sent. Its role passes row level security (it is how
-- Supabase's own service key works); the folder is still the company's, and sign_finalize refuses any other path.

select app.lockdown_check();
