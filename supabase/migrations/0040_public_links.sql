-- 0040 Links for the public pages (the signing page and the review page of the next round)
-- A person outside the company reaches one record through a link that carries a random token. This table is where
-- such a link lives, and it follows the rules of the server range (0020 to 0029): schema app, row level security
-- enabled and forced with no policy, no privilege for any application role, reached through functions only.
--   hashed          only SHA-256 of the token is stored (token_hash); the token itself exists in the email and nowhere else
--   expiry          expires_at is required
--   single purpose  a link is for signing ONE signer's part of ONE request, or for answering ONE review request;
--                   a token presented for the other purpose is not found
--   single use      link_use marks it used; a used, revoked or expired link is not found again
-- What is here: the table and the four server functions that issue, look up, use and revoke a link.
-- What is left for the next round: the public functions the pages call (open the request, record a view, sign,
-- decline, answer a review). They take the token, call link_peek or link_use, and write envelope_signers,
-- envelope_fields, envelopes.events and review_requests as the server. Each one must be listed in
-- app.anon_functions with its reason (0019) and rate limited (0023).

create table app.public_links (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  purpose      text not null check (purpose in ('sign', 'review')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  signer_id    uuid,
  review_id    uuid,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint public_links_one_target check ((purpose = 'sign') = (signer_id is not null) and (purpose = 'review') = (review_id is not null)),
  constraint public_links_expiry check (expires_at > created_at),
  constraint public_links_signer_fk foreign key (tenant_id, signer_id) references public.envelope_signers (tenant_id, id) on delete cascade,
  constraint public_links_review_fk foreign key (tenant_id, review_id) references public.review_requests (tenant_id, id) on delete cascade
);
create index public_links_signer_idx on app.public_links (tenant_id, signer_id);
create index public_links_review_idx on app.public_links (tenant_id, review_id);
create index public_links_expiry_idx on app.public_links (expires_at) where used_at is null and revoked_at is null;
alter table app.public_links enable row level security;
alter table app.public_links force row level security;
revoke all on app.public_links from public, anon, authenticated, service_role;
create trigger public_links_touch before update on app.public_links for each row execute function app.touch_updated_at();
create trigger public_links_00_tenant_fixed before update of tenant_id on app.public_links for each row execute function app.tenant_id_immutable();

-- Issues a link for one signer or one review request. The server makes the token, sends it, and passes only its
-- hash. An earlier open link for the same target is revoked: one live link per target.
create or replace function public.link_issue(p_tenant uuid, p_purpose text, p_target uuid, p_token_hash text, p_ttl_hours integer default 336) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_purpose is null or p_purpose not in ('sign', 'review') or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if (p_purpose = 'sign' and not exists (select 1 from public.envelope_signers s where s.tenant_id = p_tenant and s.id = p_target))
     or (p_purpose = 'review' and not exists (select 1 from public.review_requests r where r.tenant_id = p_tenant and r.id = p_target)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update app.public_links l set revoked_at = pg_catalog.now()
   where l.tenant_id = p_tenant and l.purpose = p_purpose and coalesce(l.signer_id, l.review_id) = p_target and l.used_at is null and l.revoked_at is null;
  insert into app.public_links (tenant_id, purpose, token_hash, signer_id, review_id, expires_at)
  values (p_tenant, p_purpose, p_token_hash, case when p_purpose = 'sign' then p_target end, case when p_purpose = 'review' then p_target end,
          pg_catalog.now() + pg_catalog.make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 336), 8760))))
  returning id into v_id;
  return v_id;
end
$$;

-- What a token is good for right now, or NULL: unknown, for another purpose, used, revoked or expired all look the same.
create or replace function public.link_peek(p_purpose text, p_token_hash text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('id', l.id, 'tenantId', l.tenant_id, 'purpose', l.purpose,
           'signerId', l.signer_id, 'reviewId', l.review_id, 'expiresAt', app.ws_iso(l.expires_at),
           'envelopeId', (select s.envelope_id from public.envelope_signers s where s.tenant_id = l.tenant_id and s.id = l.signer_id)))
  from app.public_links l
  where l.token_hash = p_token_hash and l.purpose = p_purpose and l.used_at is null and l.revoked_at is null and l.expires_at > pg_catalog.now()
$$;

-- Uses a link up. The update is the test, so two requests with the same token cannot both win. NULL when it was not usable.
create or replace function public.link_use(p_purpose text, p_token_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l app.public_links%rowtype;
begin
  update app.public_links x set used_at = pg_catalog.now()
   where x.token_hash = p_token_hash and x.purpose = p_purpose and x.used_at is null and x.revoked_at is null and x.expires_at > pg_catalog.now()
  returning * into l;
  if l.id is null then return null; end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('id', l.id, 'tenantId', l.tenant_id, 'purpose', l.purpose,
    'signerId', l.signer_id, 'reviewId', l.review_id));
end
$$;

-- Takes back every open link of a target (a request that was voided, a signer that was replaced).
create or replace function public.link_revoke(p_tenant uuid, p_purpose text, p_target uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare n integer;
begin
  update app.public_links l set revoked_at = pg_catalog.now()
   where l.tenant_id = p_tenant and l.purpose = p_purpose and coalesce(l.signer_id, l.review_id) = p_target and l.used_at is null and l.revoked_at is null;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.link_issue(uuid, text, uuid, text, integer), public.link_peek(text, text), public.link_use(text, text),
  public.link_revoke(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.link_issue(uuid, text, uuid, text, integer), public.link_peek(text, text), public.link_use(text, text),
  public.link_revoke(uuid, text, uuid) to service_role;

select app.lockdown_check();
