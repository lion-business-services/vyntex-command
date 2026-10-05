-- 0022 Invitations: the only way an account comes to exist
-- There is no sign-up. A person joins a company because a member who holds the "users" capability invited that email
-- address with a role. The invitation link carries a random token; only its SHA-256 hash is stored, it works once,
-- and it expires. The very first owner of a new company is invited by the platform operator (invite_bootstrap).
--
-- Flow (api/auth.js, invite/accept):
--   1. invite_claim(hash)      takes the invitation for two minutes, so two browsers cannot both use it
--   2. the server creates the sign-in account for that email (or checks the password of an existing one)
--   3. invite_complete(hash, user)  adds the membership with the invited role and marks the invitation used
--   on failure: invite_release(hash) gives the invitation back

create table app.invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  email        text not null check (email = pg_catalog.lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' and pg_catalog.length(email) <= 320),
  name         text not null default '' check (pg_catalog.length(name) <= 200),
  role         text not null check (role in ('owner', 'manager', 'staff', 'readonly', 'worker')),
  -- Set only for a field worker's portal account: the worker record the account belongs to.
  worker_id    uuid,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- tenant_members.id of the inviter. NULL only for the first owner, invited by the platform operator.
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  claimed_at   timestamptz,
  used_at      timestamptz,
  -- auth.users id of the account that accepted.
  used_by      uuid,
  revoked_at   timestamptz,
  revoked_by   uuid,
  unique (tenant_id, id),
  constraint invitations_inviter_fk foreign key (tenant_id, invited_by) references public.tenant_members (tenant_id, id) on delete restrict,
  constraint invitations_revoker_fk foreign key (tenant_id, revoked_by) references public.tenant_members (tenant_id, id) on delete restrict,
  constraint invitations_worker_fk foreign key (tenant_id, worker_id) references public.workers (tenant_id, id) on delete restrict,
  constraint invitations_worker_link check ((role = 'worker') = (worker_id is not null)),
  constraint invitations_expiry check (expires_at > created_at)
);
create index invitations_tenant_idx on app.invitations (tenant_id, created_at desc);
-- One open invitation per address and company. Inviting the same address again replaces the earlier one.
create unique index invitations_open_uidx on app.invitations (tenant_id, email) where used_at is null and revoked_at is null;
alter table app.invitations enable row level security;
alter table app.invitations force row level security;
revoke all on app.invitations from public, anon, authenticated, service_role;
create trigger invitations_00_tenant_fixed before update of tenant_id on app.invitations
  for each row execute function app.tenant_id_immutable();

-- Creates an invitation. The server makes the token and passes only its hash; this function decides who may invite.
create or replace function public.invite_create(
  p_tenant uuid, p_email text, p_role text, p_name text, p_token_hash text,
  p_ttl_hours integer default 72, p_worker uuid default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_me uuid;
  v_my_role text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'users'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform app.require_stepup();
  v_me := app.current_member(p_tenant);
  v_my_role := app.member_role(p_tenant);
  if p_role is null or p_role not in ('owner', 'manager', 'staff', 'readonly', 'worker') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  -- Only an owner can make another owner. Otherwise a manager who may invite could hand out more than they hold.
  if p_role = 'owner' and v_my_role <> 'owner' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or pg_catalog.length(v_email) > 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.tenant_members m join auth.users u on u.id = m.user_id
    where m.tenant_id = p_tenant and m.status = 'active' and pg_catalog.lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  update app.invitations i set revoked_at = pg_catalog.now(), revoked_by = v_me
   where i.tenant_id = p_tenant and i.email = v_email and i.used_at is null and i.revoked_at is null;
  v_expires := pg_catalog.now() + pg_catalog.make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 72), 336)));
  insert into app.invitations (tenant_id, email, name, role, worker_id, token_hash, invited_by, expires_at)
  values (p_tenant, v_email, pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 200), p_role, p_worker, p_token_hash, v_me, v_expires)
  returning id into v_id;
  perform app.security_event(p_tenant, (select auth.uid()), 'invite.created', 'ok', null,
    pg_catalog.jsonb_build_object('invitation', v_id, 'role', p_role));
  return pg_catalog.jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role, 'expires_at', v_expires,
    'company', (select t.name from public.tenants t where t.id = p_tenant),
    'inviter', (select m.name from public.tenant_members m where m.tenant_id = p_tenant and m.id = v_me));
end
$$;

-- Open and recent invitations of a company, without the token hash.
create or replace function public.invite_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'users'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', i.id, 'email', i.email, 'name', i.name, 'role', i.role, 'invited_by', i.invited_by,
      'created_at', i.created_at, 'expires_at', i.expires_at,
      'status', case when i.used_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
                     when i.expires_at <= pg_catalog.now() then 'expired' else 'pending' end
    ) order by i.created_at desc)
    from app.invitations i
    where i.tenant_id = p_tenant and i.created_at > pg_catalog.now() - interval '90 days'), '[]'::jsonb);
end
$$;

create or replace function public.invite_revoke(p_tenant uuid, p_invitation uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform app.require_mfa(p_tenant);
  if not coalesce(app.can(p_tenant, 'users'), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update app.invitations i set revoked_at = pg_catalog.now(), revoked_by = app.current_member(p_tenant)
   where i.tenant_id = p_tenant and i.id = p_invitation and i.used_at is null and i.revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app.security_event(p_tenant, (select auth.uid()), 'invite.revoked', 'ok', null, pg_catalog.jsonb_build_object('invitation', p_invitation));
  end if;
  return v_n > 0;
end
$$;
revoke all on function public.invite_create(uuid, text, text, text, text, integer, uuid), public.invite_list(uuid), public.invite_revoke(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.invite_create(uuid, text, text, text, text, integer, uuid), public.invite_list(uuid), public.invite_revoke(uuid, uuid)
  to authenticated;

-- ---- Accepting: server only. The person has no account yet, so there is no token of theirs to call with. ----

-- Takes a valid, unused, unexpired invitation for two minutes and returns what the accept page needs.
-- NULL when the token is unknown, used, revoked, expired, or just taken by another request.
create or replace function public.invite_claim(p_token_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  update app.invitations i set claimed_at = pg_catalog.now()
   where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > pg_catalog.now()
     and (i.claimed_at is null or i.claimed_at < pg_catalog.now() - interval '2 minutes')
     and exists (select 1 from public.tenants t where t.id = i.tenant_id and t.status <> 'closed')
  returning i.id, i.tenant_id, i.email, i.name, i.role into r;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('id', r.id, 'tenant_id', r.tenant_id, 'email', r.email, 'name', r.name, 'role', r.role,
    'slug', (select t.slug from public.tenants t where t.id = r.tenant_id));
end
$$;

-- What the accept page shows before the person types a password: which company, and a masked form of the address.
-- Takes nothing: looking does not use the invitation up. NULL for anything that is not a usable invitation.
create or replace function public.invite_peek(p_token_hash text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'company', t.name,
    'email_hint', pg_catalog.left(i.email, 1) || '***@' || pg_catalog.split_part(i.email, '@', 2),
    'expires_at', i.expires_at)
  from app.invitations i join public.tenants t on t.id = i.tenant_id
  where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > pg_catalog.now()
    and t.status <> 'closed'
$$;

create or replace function public.invite_release(p_token_hash text) returns void
language sql security definer
set search_path = ''
as $$ update app.invitations i set claimed_at = null where i.token_hash = p_token_hash and i.used_at is null $$;

-- Adds the membership and uses the invitation up, in one transaction. The account's address must be the invited one.
create or replace function public.invite_complete(p_token_hash text, p_user uuid, p_name text default null, p_ip_hash text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  inv app.invitations%rowtype;
  v_email text;
  v_member uuid;
begin
  select * into inv from app.invitations i
   where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > pg_catalog.now()
     and i.claimed_at is not null
   for update;
  if not found then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is null or v_email <> inv.email then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  insert into public.tenant_members (tenant_id, user_id, role, worker_id, status, name, email)
  values (inv.tenant_id, p_user, inv.role, inv.worker_id, 'active',
          coalesce(nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 200), ''), inv.name), inv.email)
  on conflict (tenant_id, user_id) do update set role = excluded.role, worker_id = excluded.worker_id, status = 'active'
  returning id into v_member;
  update app.invitations i set used_at = pg_catalog.now(), used_by = p_user where i.id = inv.id;
  perform app.security_event(inv.tenant_id, p_user, 'invite.accepted', 'ok', p_ip_hash,
    pg_catalog.jsonb_build_object('invitation', inv.id, 'role', inv.role));
  return pg_catalog.jsonb_build_object('tenant_id', inv.tenant_id, 'member_id', v_member, 'role', inv.role,
    'slug', (select t.slug from public.tenants t where t.id = inv.tenant_id));
end
$$;
revoke all on function public.invite_claim(text), public.invite_peek(text), public.invite_release(text), public.invite_complete(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_claim(text), public.invite_peek(text), public.invite_release(text), public.invite_complete(text, uuid, text, text) to service_role;

-- The first owner of a company. Run by the platform operator in the SQL Editor (no application role can call it):
--   select public.invite_bootstrap('<tenant id>', 'owner@example.com');
-- It returns the token ONCE. The operator sends the address  https://<site>/invite/<token>  to the owner by a channel
-- they trust. Refused when the company already has an active owner: from then on, owners invite.
create or replace function public.invite_bootstrap(p_tenant uuid, p_email text, p_ttl_hours integer default 72) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_token text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.status <> 'closed') then
    raise exception 'Unknown company' using errcode = '22023';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.role = 'owner' and m.status = 'active') then
    raise exception 'This company already has an owner. Owners invite from the workspace.' using errcode = '42501';
  end if;
  v_token := pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  update app.invitations i set revoked_at = pg_catalog.now()
   where i.tenant_id = p_tenant and i.email = v_email and i.used_at is null and i.revoked_at is null;
  insert into app.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
  values (p_tenant, v_email, 'owner', pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex'), null,
          pg_catalog.now() + pg_catalog.make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 72), 336))));
  perform app.security_event(p_tenant, null, 'invite.bootstrap', 'ok', null, '{}'::jsonb);
  return v_token;
end
$$;
revoke all on function public.invite_bootstrap(uuid, text, integer) from public, anon, authenticated, service_role;
