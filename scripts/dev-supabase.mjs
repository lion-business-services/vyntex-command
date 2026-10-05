// TEST DOUBLE of the Supabase HTTP surface. This is NOT Supabase and must never be used as one.
//
// It exists so the server in api/ can be run and tested on a computer with no Supabase project: it answers the few
// Supabase addresses the server calls, over the throwaway local PostgreSQL started by tests/server/pg_local.sh.
// Anything proved with it is "proved against the local stand-in", never "tested on Supabase".
//
//   /auth/v1/token?grant_type=password|refresh_token   sign-in and refresh, with refresh token rotation and reuse detection
//   /auth/v1/user  /auth/v1/logout                      the signed-in person, password change, sign-out (local, others, global)
//   /auth/v1/factors  .../challenge  .../verify         authenticator apps: real TOTP (RFC 6238), raises the session to aal2
//   /auth/v1/verify                                     one-time recovery tokens
//   /auth/v1/admin/users  .../factors  /admin/generate_link  /auth/v1/invite     admin calls (service key only)
//   /auth/v1/signup                                     always refused: sign-ups are off, as on the real projects
//   /rest/v1/rpc/<function>                             database functions, run as the role in the token, row level security on
//   /storage/v1/object/...                              upload, read and delete under the caller's role (storage policies apply)
//
// How it talks to the database: there is no database driver in this project, so every request starts one `psql`
// process. Values from the request never become part of the SQL text: they are handed over as data (COPY into a
// temporary table) and the SQL reads them from there. Function names for /rest/v1/rpc are looked up in the catalog.
//
// What it does NOT imitate: Supabase's own tables beyond the columns used here, email delivery, OAuth sign-in,
// rate limits, the dashboard settings, Vault, realtime, PostgREST tables and filters (only rpc), signed storage links.
// Tokens are HS256 JWTs signed with a secret made up at start. They are worthless anywhere else.
//
// Run:   node scripts/dev-supabase.mjs                 the double alone (expects the local PostgreSQL to be running)
//        node scripts/dev-supabase.mjs --stack         PostgreSQL + the double + scripts/serve.mjs   (npm run dev:stack)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------------------------------
// JWT (HS256) and TOTP (RFC 6238), with node:crypto only
// ---------------------------------------------------------------------------------------------------------------------
const b64u = (v) => Buffer.from(v).toString('base64url');
export function signJwt(claims, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
export function verifyJwt(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const want = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let got;
  try { got = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= now) return { ...claims, expired: true };
  return claims;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(text).toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
/** The six-digit code for a secret at a moment (30 second steps, HMAC-SHA1, as authenticator apps compute it). */
export function totp(secretBase32, atMs = Date.now(), stepOffset = 0) {
  const counter = Math.floor(atMs / 1000 / 30) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}
/** Accepts the code of the current step and of the one before and after it (clock drift). */
export const totpValid = (secret, code, atMs = Date.now()) => [-1, 0, 1].some((d) => totp(secret, atMs, d) === String(code));

// ---------------------------------------------------------------------------------------------------------------------
// The database side of the double: tables Supabase Auth would own, and its logic as functions in schema "devsb".
// Applied once at start, as the local superuser. Never part of supabase/migrations.
// ---------------------------------------------------------------------------------------------------------------------
const BOOTSTRAP_SQL = String.raw`
create schema if not exists devsb;
grant usage on schema devsb to anon, authenticated, service_role, authenticator;

alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  aal text not null default 'aal1',
  factor_id uuid
);
create table if not exists auth.refresh_tokens (
  token text primary key,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  user_id uuid not null,
  parent text,
  revoked boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null,
  status text not null default 'unverified',
  secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth.mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  factor_id uuid not null references auth.mfa_factors (id) on delete cascade,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create table if not exists auth.one_time_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_type text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
-- As on Supabase, the migration role can read these two (app.session_live and app.has_verified_factor rely on it).
grant select on auth.sessions, auth.mfa_factors to postgres;

create or replace function devsb.err(p_status integer, p_code text, p_msg text) returns jsonb language sql immutable as
$f$ select jsonb_build_object('__error', p_code, 'status', p_status, 'msg', p_msg) $f$;

create or replace function devsb.user_json(p_user uuid) returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'id', u.id, 'aud', 'authenticated', 'role', 'authenticated', 'email', u.email,
    'email_confirmed_at', u.email_confirmed_at, 'created_at', u.created_at, 'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb,
    'factors', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'friendly_name', f.friendly_name, 'factor_type', f.factor_type,
                 'status', f.status, 'created_at', f.created_at, 'updated_at', f.updated_at) order by f.created_at)
               from auth.mfa_factors f where f.user_id = u.id), '[]'::jsonb))
  from auth.users u where u.id = p_user
$f$;

-- A new refresh token for a session, and everything the HTTP layer needs to mint the access token.
create or replace function devsb.issue(p_user uuid, p_session uuid, p_parent text default null) returns jsonb language plpgsql as $f$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex'); s auth.sessions%rowtype;
begin
  select * into s from auth.sessions where id = p_session;
  insert into auth.refresh_tokens (token, session_id, user_id, parent) values (v_token, p_session, p_user, p_parent);
  return jsonb_build_object('user', devsb.user_json(p_user), 'session_id', p_session, 'aal', s.aal, 'refresh_token', v_token,
    'amr', case when s.aal = 'aal2' then '[{"method":"password"},{"method":"totp"}]'::jsonb else '[{"method":"password"}]'::jsonb end);
end $f$;

create or replace function devsb.token_password(p jsonb) returns jsonb language plpgsql as $f$
declare u auth.users%rowtype; v_sid uuid;
begin
  select * into u from auth.users where lower(email) = lower(p ->> 'email');
  -- the same answer for an unknown address and a wrong password
  if not found or u.encrypted_password is null or extensions.crypt(p ->> 'password', u.encrypted_password) <> u.encrypted_password then
    return devsb.err(400, 'invalid_credentials', 'Invalid login credentials');
  end if;
  if u.email_confirmed_at is null then return devsb.err(400, 'email_not_confirmed', 'Email not confirmed'); end if;
  insert into auth.sessions (user_id) values (u.id) returning id into v_sid;
  return devsb.issue(u.id, v_sid);
end $f$;

-- Rotation: a refresh token works once. Using it again after the reuse interval ends the whole session
-- (someone else may hold a copy). Inside the interval the newest token of the session is returned instead.
create or replace function devsb.token_refresh(p jsonb) returns jsonb language plpgsql as $f$
declare t auth.refresh_tokens%rowtype; v_child text; v_new jsonb;
begin
  select * into t from auth.refresh_tokens where token = p ->> 'refresh_token' for update;
  if not found then return devsb.err(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'); end if;
  if t.revoked then
    select c.token into v_child from auth.refresh_tokens c where c.parent = t.token and not c.revoked limit 1;
    if v_child is not null and t.revoked_at > now() - make_interval(secs => coalesce((p ->> 'reuse_interval')::integer, 10)) then
      v_new := devsb.issue(t.user_id, t.session_id, t.token);
      delete from auth.refresh_tokens where token = v_new ->> 'refresh_token';
      return v_new || jsonb_build_object('refresh_token', v_child);
    end if;
    delete from auth.sessions where id = t.session_id;
    return devsb.err(400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used');
  end if;
  update auth.refresh_tokens set revoked = true, revoked_at = now() where token = t.token;
  return devsb.issue(t.user_id, t.session_id, t.token);
end $f$;

create or replace function devsb.session_ok(p jsonb) returns boolean language sql stable as $f$
  select exists (select 1 from auth.sessions s where s.id = (p ->> 'session_id')::uuid and s.user_id = (p ->> 'sub')::uuid)
$f$;

create or replace function devsb.user_get(p jsonb) returns jsonb language plpgsql as $f$
begin
  if not devsb.session_ok(p) then return devsb.err(403, 'session_not_found', 'Session from session_id claim in JWT does not exist'); end if;
  return devsb.user_json((p ->> 'sub')::uuid);
end $f$;

create or replace function devsb.user_update(p jsonb) returns jsonb language plpgsql as $f$
begin
  if not devsb.session_ok(p) then return devsb.err(403, 'session_not_found', 'Session from session_id claim in JWT does not exist'); end if;
  if p ? 'password' then
    if length(p ->> 'password') < 6 then return devsb.err(422, 'weak_password', 'Password should be at least 6 characters'); end if;
    update auth.users set encrypted_password = extensions.crypt(p ->> 'password', extensions.gen_salt('bf', 4)) where id = (p ->> 'sub')::uuid;
  end if;
  return devsb.user_json((p ->> 'sub')::uuid);
end $f$;

create or replace function devsb.logout(p jsonb) returns jsonb language plpgsql as $f$
begin
  if p ->> 'scope' = 'global' then delete from auth.sessions where user_id = (p ->> 'sub')::uuid;
  elsif p ->> 'scope' = 'others' then delete from auth.sessions where user_id = (p ->> 'sub')::uuid and id <> (p ->> 'session_id')::uuid;
  else delete from auth.sessions where id = (p ->> 'session_id')::uuid and user_id = (p ->> 'sub')::uuid;
  end if;
  return '{}'::jsonb;
end $f$;

create or replace function devsb.factor_enroll(p jsonb) returns jsonb language plpgsql as $f$
declare v_id uuid;
begin
  if not devsb.session_ok(p) then return devsb.err(403, 'session_not_found', 'Session not found'); end if;
  -- with an authenticator in place, adding another needs the second step first
  if p ->> 'aal' <> 'aal2' and exists (select 1 from auth.mfa_factors f where f.user_id = (p ->> 'sub')::uuid and f.status = 'verified') then
    return devsb.err(403, 'insufficient_aal', 'AAL2 required to enroll a new factor');
  end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = (p ->> 'sub')::uuid and f.friendly_name = p ->> 'friendly_name') then
    return devsb.err(422, 'mfa_factor_name_conflict', 'A factor with that friendly name already exists');
  end if;
  insert into auth.mfa_factors (user_id, friendly_name, factor_type, secret) values ((p ->> 'sub')::uuid, p ->> 'friendly_name', 'totp', p ->> 'secret')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'type', 'totp', 'friendly_name', p ->> 'friendly_name');
end $f$;

create or replace function devsb.factor_challenge(p jsonb) returns jsonb language plpgsql as $f$
declare v_id uuid;
begin
  if not devsb.session_ok(p) then return devsb.err(403, 'session_not_found', 'Session not found'); end if;
  if not exists (select 1 from auth.mfa_factors f where f.id = (p ->> 'factor_id')::uuid and f.user_id = (p ->> 'sub')::uuid) then
    return devsb.err(404, 'mfa_factor_not_found', 'Factor not found');
  end if;
  insert into auth.mfa_challenges (factor_id) values ((p ->> 'factor_id')::uuid) returning id into v_id;
  return jsonb_build_object('id', v_id, 'type', 'totp', 'expires_at', extract(epoch from now() + interval '5 minutes')::bigint);
end $f$;

-- First half of verify: hands the secret to the HTTP layer, which computes the code. Only for a challenge that is
-- open, recent, and belongs to this person's factor.
create or replace function devsb.factor_secret(p jsonb) returns jsonb language plpgsql as $f$
declare v_secret text;
begin
  if not devsb.session_ok(p) then return devsb.err(403, 'session_not_found', 'Session not found'); end if;
  select f.secret into v_secret
  from auth.mfa_challenges c join auth.mfa_factors f on f.id = c.factor_id
  where c.id = (p ->> 'challenge_id')::uuid and f.id = (p ->> 'factor_id')::uuid and f.user_id = (p ->> 'sub')::uuid
    and c.verified_at is null and c.created_at > now() - interval '5 minutes';
  if v_secret is null then return devsb.err(422, 'mfa_challenge_expired', 'MFA challenge has expired or was not found'); end if;
  return jsonb_build_object('secret', v_secret);
end $f$;

-- Second half: the code was right. The challenge is used up, the factor is verified, the session becomes aal2,
-- and a new token pair replaces the old one.
create or replace function devsb.factor_verified(p jsonb) returns jsonb language plpgsql as $f$
declare v_n integer;
begin
  update auth.mfa_challenges set verified_at = now() where id = (p ->> 'challenge_id')::uuid and verified_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then return devsb.err(422, 'mfa_challenge_expired', 'MFA challenge has expired or was not found'); end if;
  update auth.mfa_factors set status = 'verified', updated_at = now() where id = (p ->> 'factor_id')::uuid;
  update auth.sessions set aal = 'aal2', factor_id = (p ->> 'factor_id')::uuid where id = (p ->> 'session_id')::uuid;
  update auth.refresh_tokens set revoked = true, revoked_at = now() - interval '1 hour' where session_id = (p ->> 'session_id')::uuid and not revoked;
  return devsb.issue((p ->> 'sub')::uuid, (p ->> 'session_id')::uuid);
end $f$;

create or replace function devsb.factor_delete(p jsonb) returns jsonb language plpgsql as $f$
declare f auth.mfa_factors%rowtype;
begin
  if not devsb.session_ok(p) then return devsb.err(403, 'session_not_found', 'Session not found'); end if;
  select * into f from auth.mfa_factors where id = (p ->> 'factor_id')::uuid and user_id = (p ->> 'sub')::uuid;
  if not found then return devsb.err(404, 'mfa_factor_not_found', 'Factor not found'); end if;
  if f.status = 'verified' and p ->> 'aal' <> 'aal2' then return devsb.err(403, 'insufficient_aal', 'AAL2 required to unenroll a verified factor'); end if;
  delete from auth.mfa_factors where id = f.id;
  if f.status = 'verified' then update auth.sessions set aal = 'aal1', factor_id = null where user_id = f.user_id; end if;
  return jsonb_build_object('id', f.id);
end $f$;

create or replace function devsb.admin_create_user(p jsonb) returns jsonb language plpgsql as $f$
declare v_id uuid;
begin
  if coalesce(p ->> 'email', '') !~ '^[^[:space:]@]+@[^[:space:]@]+$' then return devsb.err(422, 'validation_failed', 'Invalid email'); end if;
  if exists (select 1 from auth.users where lower(email) = lower(p ->> 'email')) then
    return devsb.err(422, 'email_exists', 'A user with this email address has already been registered');
  end if;
  insert into auth.users (email, encrypted_password, email_confirmed_at)
  values (lower(p ->> 'email'),
          case when p ? 'password' then extensions.crypt(p ->> 'password', extensions.gen_salt('bf', 4)) end,
          case when coalesce((p ->> 'email_confirm')::boolean, false) then now() end)
  returning id into v_id;
  return devsb.user_json(v_id);
end $f$;

create or replace function devsb.admin_update_user(p jsonb) returns jsonb language plpgsql as $f$
begin
  if not exists (select 1 from auth.users where id = (p ->> 'id')::uuid) then return devsb.err(404, 'user_not_found', 'User not found'); end if;
  if p ? 'password' then update auth.users set encrypted_password = extensions.crypt(p ->> 'password', extensions.gen_salt('bf', 4)) where id = (p ->> 'id')::uuid; end if;
  if coalesce((p ->> 'email_confirm')::boolean, false) then update auth.users set email_confirmed_at = now() where id = (p ->> 'id')::uuid; end if;
  return devsb.user_json((p ->> 'id')::uuid);
end $f$;

create or replace function devsb.admin_delete_user(p jsonb) returns jsonb language plpgsql as $f$
begin
  delete from auth.users where id = (p ->> 'id')::uuid;
  if not found then return devsb.err(404, 'user_not_found', 'User not found'); end if;
  return '{}'::jsonb;
end $f$;

create or replace function devsb.admin_factors(p jsonb) returns jsonb language sql stable as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'friendly_name', f.friendly_name, 'factor_type', f.factor_type, 'status', f.status) order by f.created_at), '[]'::jsonb)
  from auth.mfa_factors f where f.user_id = (p ->> 'id')::uuid
$f$;

create or replace function devsb.admin_factor_delete(p jsonb) returns jsonb language plpgsql as $f$
begin
  delete from auth.mfa_factors where id = (p ->> 'factor_id')::uuid and user_id = (p ->> 'id')::uuid;
  if not found then return devsb.err(404, 'mfa_factor_not_found', 'Factor not found'); end if;
  update auth.sessions set aal = 'aal1', factor_id = null where user_id = (p ->> 'id')::uuid;
  return jsonb_build_object('id', p ->> 'factor_id');
end $f$;

-- One-time tokens for password recovery and invitations. No email is sent: the caller gets the token.
create or replace function devsb.admin_generate_link(p jsonb) returns jsonb language plpgsql as $f$
declare u auth.users%rowtype; v_token text := encode(extensions.gen_random_bytes(28), 'hex');
begin
  select * into u from auth.users where lower(email) = lower(p ->> 'email');
  if not found then
    if p ->> 'type' <> 'invite' then return devsb.err(404, 'user_not_found', 'User with this email not found'); end if;
    insert into auth.users (email) values (lower(p ->> 'email')) returning * into u;
  end if;
  insert into auth.one_time_tokens (token_hash, user_id, token_type) values (v_token, u.id, p ->> 'type');
  return devsb.user_json(u.id) || jsonb_build_object('hashed_token', v_token, 'verification_type', p ->> 'type', 'email_otp', '', 'redirect_to', '',
    'action_link', (p ->> 'base') || '/auth/v1/verify?token=' || v_token || '&type=' || (p ->> 'type'));
end $f$;

create or replace function devsb.verify_token(p jsonb) returns jsonb language plpgsql as $f$
declare v_user uuid; v_sid uuid;
begin
  update auth.one_time_tokens set used_at = now()
   where token_hash = p ->> 'token_hash' and token_type = p ->> 'type' and used_at is null and created_at > now() - interval '1 hour'
  returning user_id into v_user;
  if v_user is null then return devsb.err(403, 'otp_expired', 'Email link is invalid or has expired'); end if;
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_user;
  insert into auth.sessions (user_id) values (v_user) returning id into v_sid;
  return devsb.issue(v_user, v_sid);
end $f$;

-- /rest/v1/rpc: calls public.<p_fn> with named arguments taken from a JSON object, the way the Data API does.
-- The function and its argument names come from the catalog; the JSON values are passed as a parameter, never as text.
create or replace function devsb.call(p_fn text, p_args jsonb) returns jsonb language plpgsql as $f$
declare
  f record; v_parts text[] := '{}'; v_sql text; v_out jsonb; k text; i integer; v_type text; v_state text; v_msg text;
  v_keys text[] := coalesce((select array_agg(x) from jsonb_object_keys(p_args) x), '{}');
begin
  select p.oid, p.proname, coalesce(p.proargnames, '{}') as names, p.proargtypes::oid[] as types, p.pronargs, p.pronargdefaults,
         p.proretset, p.prorettype
    into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_fn and p.prokind = 'f'
    and v_keys <@ coalesce(p.proargnames[1:p.pronargs], '{}')
    and coalesce(p.proargnames[1:(p.pronargs - p.pronargdefaults)], '{}') <@ v_keys
  order by p.pronargs
  limit 1;
  if not found then
    return jsonb_build_object('__error', 'PGRST202', 'message', 'Could not find the function public.' || p_fn || ' in the schema cache');
  end if;
  for i in 1 .. f.pronargs loop
    k := f.names[i];
    if not (p_args ? k) then continue; end if;
    -- an oidvector cast to an array starts at index 0
    v_type := format_type(f.types[i - 1], null);
    if v_type in ('json', 'jsonb') then
      v_parts := v_parts || format('%I => ($1 -> %L)::%s', k, k, v_type);
    elsif v_type like '%[]' then
      v_parts := v_parts || format('%I => (select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof($1 -> %L) = ''array'' then $1 -> %L else ''[]''::jsonb end) x)::%s', k, k, k, v_type);
    else
      v_parts := v_parts || format('%I => ($1 ->> %L)::%s', k, k, v_type);
    end if;
  end loop;
  begin
    if f.prorettype = 'void'::regtype then
      v_sql := format('select public.%I(%s)', f.proname, array_to_string(v_parts, ', '));
      execute v_sql using p_args;
      v_out := null;
    elsif f.proretset then
      v_sql := format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I(%s) t', f.proname, array_to_string(v_parts, ', '));
      execute v_sql into v_out using p_args;
    else
      v_sql := format('select to_jsonb(public.%I(%s))', f.proname, array_to_string(v_parts, ', '));
      execute v_sql into v_out using p_args;
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return jsonb_build_object('__error', v_state, 'message', v_msg);
  end;
  return jsonb_build_object('result', v_out);
end $f$;
grant execute on function devsb.call(text, jsonb) to anon, authenticated, service_role;

-- The Storage service reads a bucket's limits itself, whoever is calling. Signed-in people cannot read storage.buckets.
create or replace function devsb.bucket(p_id text) returns jsonb language sql stable security definer set search_path = '' as $f$
  select pg_catalog.jsonb_build_object('size', b.file_size_limit, 'types', pg_catalog.to_jsonb(b.allowed_mime_types)) from storage.buckets b where b.id = p_id
$f$;
grant execute on function devsb.bucket(text) to anon, authenticated, service_role;
`;

// ---------------------------------------------------------------------------------------------------------------------
// psql: one process per database call. Request values go in as COPY data, never as SQL text.
// ---------------------------------------------------------------------------------------------------------------------
const copyEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');

function makeDb({ psql, host, database }) {
  let active = 0; const waiting = [];
  const acquire = () => (active < 16 ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

  /** Runs a script. `data` (key -> text) is available to the script as  (select v from _in where k = '<key>'). */
  async function run(login, statements, data = {}) {
    for (const v of Object.values(data)) if (String(v).includes('\u0000')) throw Object.assign(new Error('nul byte'), { bad: true });
    const rows = Object.entries(data).map(([k, v]) => `${k}\t${copyEscape(v)}`);
    const script = ['begin;', 'create temp table _in (k text primary key, v text) on commit drop;', 'copy _in from stdin;', ...rows, '\\.', ...statements, 'commit;', ''].join('\n');
    await acquire();
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(psql, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', host, '-U', login, '-d', database, '-f', '-'],
          { env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) return reject(Object.assign(new Error('psql failed'), { stderr: err.slice(0, 2000) }));
          const line = out.split('\n').reverse().find((l) => l.startsWith('@@R@@'));
          if (line === undefined) return reject(Object.assign(new Error('no result'), { stderr: err.slice(0, 2000) }));
          try { resolve(JSON.parse(line.slice(5))); } catch (e) { reject(e); }
        });
        child.stdin.end(script);
      });
    } finally {
      release();
    }
  }

  /** One of the devsb.* functions above, as the local superuser. `fn` is always a name written in this file. */
  const admin = (fn, params) => run('supabase_admin', [`select '@@R@@' || coalesce(devsb.${fn}((select v::jsonb from _in where k = 'p'))::text, 'null');`], { p: JSON.stringify(params) });

  /** A statement as the role of the token, with the claims the Data API would set. `sql` is written in this file; values come from _in. */
  function asRole(role, claims, sql, data = {}) {
    if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('bad role');
    return run('authenticator', [
      "select set_config('request.jwt.claims', (select v from _in where k = 'claims'), true) \\g /dev/null",
      "select set_config('request.headers', coalesce((select v from _in where k = 'headers'), '{}'), true) \\g /dev/null",
      ...Object.keys(data).map((k) => `select set_config('devsb.${k}', (select v from _in where k = '${k}'), true) \\g /dev/null`),
      `set local role ${role};`,
      sql,
    ], { claims: JSON.stringify(claims), headers: data.headers || '{}', ...data });
  }

  return { run, admin, asRole };
}

// ---------------------------------------------------------------------------------------------------------------------
// The HTTP server
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Starts the double. Options: port, psql, host (socket folder), database, jwtExp (seconds an access token lives),
 * reuseInterval (seconds a used refresh token is still tolerated), filesDir. Returns { url, anonKey, serviceKey, stop }.
 */
export async function startDevSupabase(opts = {}) {
  const port = Number(opts.port || process.env.DEVSB_PORT || 4621);
  const psql = opts.psql || process.env.PSQL || '/usr/lib/postgresql/16/bin/psql';
  const host = opts.host || process.env.PGHOST || '/tmp/vx-pg-server/sock';
  const database = opts.database || process.env.PGDATABASE || 'vyntex_server';
  const jwtSecret = opts.jwtSecret || randomBytes(32).toString('hex');
  const state = { jwtExp: Number(opts.jwtExp || 3600), reuseInterval: Number(opts.reuseInterval ?? 10) };
  const filesDir = opts.filesDir || fs.mkdtempSync(path.join(os.tmpdir(), 'devsb-files-'));
  const url = `http://127.0.0.1:${port}`;
  const far = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
  const anonKey = signJwt({ iss: 'dev-supabase-test-double', role: 'anon', exp: far }, jwtSecret);
  const serviceKey = signJwt({ iss: 'dev-supabase-test-double', role: 'service_role', exp: far }, jwtSecret);
  const db = makeDb({ psql, host, database });

  // install the stand-in tables and functions
  const boot = spawnSync(psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', host, '-U', 'supabase_admin', '-d', database, '-f', '-'],
    { input: BOOTSTRAP_SQL, env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' }, encoding: 'utf8' });
  if (boot.status !== 0) throw new Error('dev-supabase: could not prepare the local database. Is it running? (bash tests/server/pg_local.sh start)\n' + String(boot.stderr).slice(0, 600));

  const send = (res, status, body, headers = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-test-double': 'dev-supabase', ...headers });
    res.end(text);
  };
  const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });
  const grantBody = (g) => {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({
      iss: url + '/auth/v1', sub: g.user.id, aud: 'authenticated', role: 'authenticated', email: g.user.email,
      iat: now, exp: now + state.jwtExp, aal: g.aal, amr: g.amr, session_id: g.session_id, app_metadata: {}, user_metadata: {}, is_anonymous: false,
    }, jwtSecret);
    return { access_token: access, token_type: 'bearer', expires_in: state.jwtExp, expires_at: now + state.jwtExp, refresh_token: g.refresh_token, user: g.user };
  };
  /** Sends a devsb.* result: the error it carries, or `ok(result)`. */
  const answer = (res, result, ok) => (result && result.__error ? authError(res, result.status || 400, result.__error, result.msg) : ok(result));

  async function readBody(req, limit = 12 * 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('too large'), { tooLarge: true }); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const parseJson = (buf) => { try { const v = JSON.parse(buf.toString('utf8') || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };

  /** Who is calling: checks the api key, then the bearer token. Returns { role, claims } or sends the refusal. */
  function caller(req, res, { userOnly = false, serviceOnly = false } = {}) {
    const apikey = req.headers.apikey || '';
    if (apikey !== anonKey && apikey !== serviceKey) { send(res, 401, { message: 'Invalid API key' }); return null; }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || apikey;
    const claims = verifyJwt(bearer, jwtSecret);
    if (!claims) { send(res, 401, { code: 'PGRST301', message: 'JWSError JWSInvalidSignature' }); return null; }
    if (claims.expired) { send(res, 401, { code: 'PGRST301', message: 'JWT expired', error_code: 'bad_jwt', msg: 'token is expired' }); return null; }
    if (serviceOnly && claims.role !== 'service_role') { authError(res, 403, 'not_admin', 'User not allowed'); return null; }
    if (userOnly && (claims.role !== 'authenticated' || !claims.sub)) { authError(res, 401, 'no_authorization', 'This endpoint requires a Bearer token'); return null; }
    return { role: claims.role, claims };
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, url);
    const p = u.pathname;
    try {
      // ---- auth ----
      if (p === '/auth/v1/signup') return authError(res, 422, 'signup_disabled', 'Signups not allowed for this instance');
      if (p === '/auth/v1/token' && req.method === 'POST') {
        if (!caller(req, res)) return;
        const body = parseJson(await readBody(req, 65536));
        if (!body) return authError(res, 400, 'bad_json', 'Could not parse request body as JSON');
        const type = u.searchParams.get('grant_type');
        if (type === 'password') return answer(res, await db.admin('token_password', { email: String(body.email || ''), password: String(body.password || '') }), (g) => send(res, 200, grantBody(g)));
        if (type === 'refresh_token') return answer(res, await db.admin('token_refresh', { refresh_token: String(body.refresh_token || ''), reuse_interval: state.reuseInterval }), (g) => send(res, 200, grantBody(g)));
        return authError(res, 400, 'unsupported_grant_type', 'unsupported_grant_type');
      }
      if (p === '/auth/v1/user') {
        const c = caller(req, res, { userOnly: true }); if (!c) return;
        if (req.method === 'GET') return answer(res, await db.admin('user_get', c.claims), (r) => send(res, 200, r));
        if (req.method === 'PUT') {
          const body = parseJson(await readBody(req, 65536)) || {};
          return answer(res, await db.admin('user_update', { ...c.claims, ...(typeof body.password === 'string' ? { password: body.password } : {}) }), (r) => send(res, 200, r));
        }
      }
      if (p === '/auth/v1/logout' && req.method === 'POST') {
        const c = caller(req, res, { userOnly: true }); if (!c) return;
        await db.admin('logout', { ...c.claims, scope: u.searchParams.get('scope') || 'global' });
        res.writeHead(204, { 'x-test-double': 'dev-supabase' }); return res.end();
      }
      if (p === '/auth/v1/verify' && req.method === 'POST') {
        if (!caller(req, res)) return;
        const body = parseJson(await readBody(req, 65536)) || {};
        return answer(res, await db.admin('verify_token', { type: String(body.type || ''), token_hash: String(body.token_hash || '') }), (g) => send(res, 200, grantBody(g)));
      }
      if (p === '/auth/v1/factors' && req.method === 'POST') {
        const c = caller(req, res, { userOnly: true }); if (!c) return;
        const body = parseJson(await readBody(req, 65536)) || {};
        if (body.factor_type !== 'totp') return authError(res, 422, 'validation_failed', 'Only totp is supported by the test double');
        const secret = base32Encode(randomBytes(20));
        const name = String(body.friendly_name || '');
        return answer(res, await db.admin('factor_enroll', { ...c.claims, friendly_name: name, secret }), (r) => {
          const issuer = String(body.issuer || 'dev-supabase');
          const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(c.claims.email || '')}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
          send(res, 200, { ...r, totp: { qr_code: '', secret, uri } });
        });
      }
      let m = /^\/auth\/v1\/factors\/([0-9a-f-]{36})(?:\/(challenge|verify))?$/.exec(p);
      if (m) {
        const c = caller(req, res, { userOnly: true }); if (!c) return;
        const body = req.method === 'DELETE' ? {} : parseJson(await readBody(req, 65536)) || {};
        if (!m[2] && req.method === 'DELETE') return answer(res, await db.admin('factor_delete', { ...c.claims, factor_id: m[1] }), (r) => send(res, 200, r));
        if (m[2] === 'challenge' && req.method === 'POST') return answer(res, await db.admin('factor_challenge', { ...c.claims, factor_id: m[1] }), (r) => send(res, 200, r));
        if (m[2] === 'verify' && req.method === 'POST') {
          if (!/^[0-9a-f-]{36}$/.test(String(body.challenge_id || ''))) return authError(res, 422, 'validation_failed', 'challenge_id is required');
          const s = await db.admin('factor_secret', { ...c.claims, factor_id: m[1], challenge_id: body.challenge_id });
          if (s.__error) return authError(res, s.status, s.__error, s.msg);
          if (!totpValid(s.secret, String(body.code || ''))) return authError(res, 422, 'mfa_verification_failed', 'Invalid TOTP code entered');
          return answer(res, await db.admin('factor_verified', { ...c.claims, factor_id: m[1], challenge_id: body.challenge_id }), (g) => send(res, 200, grantBody(g)));
        }
      }
      // ---- auth, admin (service key only) ----
      if (p === '/auth/v1/admin/users' && req.method === 'POST') {
        if (!caller(req, res, { serviceOnly: true })) return;
        const body = parseJson(await readBody(req, 65536)) || {};
        return answer(res, await db.admin('admin_create_user', body), (r) => send(res, 200, r));
      }
      m = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(p);
      if (m) {
        if (!caller(req, res, { serviceOnly: true })) return;
        if (req.method === 'PUT') return answer(res, await db.admin('admin_update_user', { ...(parseJson(await readBody(req, 65536)) || {}), id: m[1] }), (r) => send(res, 200, r));
        if (req.method === 'DELETE') return answer(res, await db.admin('admin_delete_user', { id: m[1] }), (r) => send(res, 200, r));
      }
      m = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})\/factors(?:\/([0-9a-f-]{36}))?$/.exec(p);
      if (m) {
        if (!caller(req, res, { serviceOnly: true })) return;
        if (!m[2] && req.method === 'GET') return answer(res, await db.admin('admin_factors', { id: m[1] }), (r) => send(res, 200, r));
        if (m[2] && req.method === 'DELETE') return answer(res, await db.admin('admin_factor_delete', { id: m[1], factor_id: m[2] }), (r) => send(res, 200, r));
      }
      if ((p === '/auth/v1/admin/generate_link' || p === '/auth/v1/invite') && req.method === 'POST') {
        if (!caller(req, res, { serviceOnly: true })) return;
        const body = parseJson(await readBody(req, 65536)) || {};
        const type = p === '/auth/v1/invite' ? 'invite' : String(body.type || '');
        if (!['recovery', 'invite'].includes(type)) return authError(res, 422, 'validation_failed', 'The test double supports recovery and invite links');
        return answer(res, await db.admin('admin_generate_link', { type, email: String(body.email || ''), base: url }), (r) => send(res, 200, r));
      }

      // ---- database functions ----
      m = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(p);
      if (m && req.method === 'POST') {
        const c = caller(req, res); if (!c) return;
        const args = parseJson(await readBody(req));
        if (!args) return send(res, 400, { code: 'PGRST102', message: 'Empty or invalid json' });
        const headers = JSON.stringify({ 'x-forwarded-for': req.headers['x-forwarded-for'] || '', 'x-real-ip': req.headers['x-real-ip'] || '' });
        const out = await db.asRole(c.role, c.claims,
          "select '@@R@@' || devsb.call(current_setting('devsb.fn'), current_setting('devsb.args')::jsonb)::text;",
          { fn: m[1], args: JSON.stringify(args), headers });
        if (out.__error) {
          const s = out.__error;
          const status = s === 'PGRST202' ? 404 : s === '42501' ? (c.role === 'anon' ? 401 : 403) : s === '23505' || s === '23503' ? 409 : s === '42883' ? 404 : 400;
          return send(res, status, { code: s, message: out.message, details: null, hint: null });
        }
        return send(res, 200, out.result === undefined ? null : out.result);
      }

      // ---- storage ----
      m = /^\/storage\/v1\/object\/(authenticated\/)?([a-z0-9][a-z0-9-]{1,62})\/(.+)$/.exec(p);
      if (m) {
        const c = caller(req, res); if (!c) return;
        const bucket = m[2];
        const name = decodeURIComponent(m[3]);
        if (name.includes('..') || name.startsWith('/')) return send(res, 400, { statusCode: '400', error: 'InvalidKey', message: 'Invalid key' });
        const file = path.join(filesDir, createHash('sha256').update(bucket + '/' + name).digest('hex'));
        if (req.method === 'POST' && !m[1]) {
          const bytes = await readBody(req);
          const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
          // The row is inserted as the caller, so the storage policies of the migrations decide. Bucket limits are checked the way the Storage service does.
          const out = await db.asRole(c.role, c.claims, String.raw`
            with b as (select devsb.bucket(current_setting('devsb.bucket')) as j),
            chk as (select case
                when (select j from b) is null then 'bucket_not_found'
                when (select j ->> 'size' from b) is not null and current_setting('devsb.size')::bigint > (select (j ->> 'size')::bigint from b) then 'too_large'
                when jsonb_typeof((select j -> 'types' from b)) = 'array' and not ((select j -> 'types' from b) ? current_setting('devsb.type')) then 'mime_not_allowed'
              end as problem),
            ins as (insert into storage.objects (bucket_id, name, owner, metadata)
              select current_setting('devsb.bucket'), current_setting('devsb.name'), nullif(current_setting('request.jwt.claims')::jsonb ->> 'sub', '')::uuid,
                     jsonb_build_object('size', current_setting('devsb.size')::bigint, 'mimetype', current_setting('devsb.type'))
              where (select problem from chk) is null
              returning id)
            select '@@R@@' || jsonb_build_object('problem', (select problem from chk), 'id', (select id from ins))::text;`,
          { bucket, name, size: String(bytes.length), type }).catch((e) => ({ dberror: String(e.stderr || '') }));
          if (out.dberror !== undefined) {
            if (/row-level security|permission denied/.test(out.dberror)) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
            if (/duplicate key/.test(out.dberror)) return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
            console.error('[dev-supabase] storage:', out.dberror.split('\n')[0]);
            return send(res, 500, { statusCode: '500', error: 'Internal', message: 'storage test double error' });
          }
          if (out.problem === 'bucket_not_found') return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
          if (out.problem === 'too_large') return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
          if (out.problem === 'mime_not_allowed') return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type not supported' });
          fs.writeFileSync(file, bytes);
          return send(res, 200, { Key: `${bucket}/${name}`, Id: out.id });
        }
        if (req.method === 'GET' && m[1]) {
          const out = await db.asRole(c.role, c.claims,
            "select '@@R@@' || coalesce((select jsonb_build_object('type', o.metadata ->> 'mimetype')::text from storage.objects o where o.bucket_id = current_setting('devsb.bucket') and o.name = current_setting('devsb.name')), 'null');",
            { bucket, name }).catch(() => null);
          if (!out || !fs.existsSync(file)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          res.writeHead(200, { 'content-type': out.type || 'application/octet-stream', 'x-test-double': 'dev-supabase' });
          return fs.createReadStream(file).pipe(res);
        }
        if (req.method === 'DELETE' && !m[1]) {
          const out = await db.asRole(c.role, c.claims,
            "with d as (delete from storage.objects o where o.bucket_id = current_setting('devsb.bucket') and o.name = current_setting('devsb.name') returning 1) select '@@R@@' || (select count(*) from d)::text;",
            { bucket, name }).catch(() => 0);
          if (!out) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          try { fs.unlinkSync(file); } catch { /* already gone */ }
          return send(res, 200, { message: 'Successfully deleted' });
        }
      }
      return send(res, 404, { message: 'Not found in the dev-supabase test double' });
    } catch (e) {
      if (e && e.tooLarge) return send(res, 413, { message: 'Payload too large' });
      if (e && e.bad) return send(res, 400, { message: 'Bad request' });
      console.error('[dev-supabase]', e && e.message ? e.message : 'error', e && e.stderr ? String(e.stderr).split('\n')[0] : '');
      return send(res, 500, { message: 'dev-supabase test double error' });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });

  return {
    url, anonKey, serviceKey, jwtSecret, db,
    /** For tests: change how long access tokens live and how long a used refresh token is tolerated. */
    set(next) { Object.assign(state, next); },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const stack = process.argv.includes('--stack');
  const pgEnv = { ...process.env, PGTEST_DIR: process.env.PGTEST_DIR || '/tmp/vx-pg-server' };
  if (stack) {
    console.log('== starting the local PostgreSQL and applying the migrations (tests/server/pg_local.sh)');
    const mode = process.argv.includes('--isolated') ? 'isolated' : 'all';
    const pg = spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'start'], { env: { ...pgEnv, MIGRATIONS_MODE: mode }, stdio: 'inherit' });
    if (pg.status !== 0) {
      console.error('The migrations did not apply. If a migration outside the server range is unfinished, try:  node scripts/dev-supabase.mjs --stack --isolated');
      process.exit(1);
    }
  }
  const sb = await startDevSupabase({ host: pgEnv.PGTEST_DIR + '/sock' });
  console.log('');
  console.log('  dev-supabase: TEST DOUBLE of the Supabase HTTP surface. This is not Supabase.');
  console.log('  For local development and tests only. Nothing proved here is proved on Supabase.');
  console.log('  listening on ' + sb.url);
  if (!stack) {
    console.log('  SUPABASE_URL=' + sb.url);
    console.log('  The two local keys are in the file named by DEVSB_ENV_FILE when that variable is set.');
    if (process.env.DEVSB_ENV_FILE) fs.writeFileSync(process.env.DEVSB_ENV_FILE, `SUPABASE_URL=${sb.url}\nSUPABASE_ANON_KEY=${sb.anonKey}\nSUPABASE_SERVICE_ROLE_KEY=${sb.serviceKey}\n`, { mode: 0o600 });
  } else {
    const port = process.env.PORT || '4620';
    const child = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], {
      stdio: 'inherit',
      env: {
        ...process.env, PORT: port, VX_ENV: 'local', VX_DEPLOY: process.env.VX_DEPLOY || 'vyntex', APP_ORIGIN: `http://localhost:${port}`,
        SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey,
        // made up for this run only
        SESSION_SECRET: randomBytes(32).toString('hex'), TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
        IP_HASH_SALT: randomBytes(24).toString('hex'), CRON_SECRET: randomBytes(24).toString('hex'),
      },
    });
    // A sample company with an invitation for its first owner, so there is something to sign in to.
    // The plan id is read from the pricing file (the first plan), never typed here.
    const plan = JSON.parse(fs.readFileSync(path.join(root, 'config/vyntex-build-pricing.json'), 'utf8')).plans[0].id;
    const invite = await sb.db.run('supabase_admin', [String.raw`
      insert into public.tenants (slug, name, industry_id, plan_id, status) values ('sample-company', 'Sample Company', 'build', (select v from _in where k = 'plan'), 'active') on conflict (slug) do nothing;`,
      String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select id from public.tenants where slug = 'sample-company'), 'owner@example.com'))::text;`], { plan }).catch(() => null);
    console.log('  the site with its api: http://localhost:' + port);
    if (typeof invite === 'string') console.log('  sample company, first owner invitation (fictional address owner@example.com): http://localhost:' + port + '/invite/' + invite);
    const stop = () => { child.kill(); spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'stop'], { env: pgEnv }); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    child.on('exit', () => stop());
  }
}
