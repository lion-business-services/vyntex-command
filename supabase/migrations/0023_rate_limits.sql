-- 0023 Rate limits and lockouts, kept in the database
-- A server function on Vercel has no memory between requests and runs in many copies, so counting in memory limits
-- nothing. The counters live here instead; api/_lib/ratelimit.js calls them with the server key and only falls back
-- to memory when the database cannot be reached.
--
-- Keys are never an address or an email: the server passes a keyed hash (hex), and the tables refuse anything else.
--
--   app.rate_hit(bucket, key, limit, window_seconds)   counts one hit in a fixed window; says whether it is allowed
--   app.lock_fail / lock_state / lock_clear             counts failures; after a threshold the key is locked for a
--                                                       time that doubles with every repeat, up to a maximum
-- Sign-in uses both (public.signin_gate / public.signin_result): a limit per address, a lock per account and
-- address together after 5 failures, and a short lock per account after 20, so one address cannot lock a person
-- out for long and many addresses cannot guess without end.

create table app.rate_limits (
  bucket        text not null check (bucket ~ '^[a-z][a-z0-9_.:-]{1,60}$'),
  key_hash      text not null check (key_hash ~ '^[0-9a-f]{16,128}$'),
  window_start  timestamptz not null,
  count         integer not null default 0 check (count >= 0),
  primary key (bucket, key_hash, window_start)
);
create index rate_limits_window_idx on app.rate_limits (window_start);
alter table app.rate_limits enable row level security;
alter table app.rate_limits force row level security;
revoke all on app.rate_limits from public, anon, authenticated, service_role;

create table app.rate_locks (
  bucket        text not null check (bucket ~ '^[a-z][a-z0-9_.:-]{1,60}$'),
  key_hash      text not null check (key_hash ~ '^[0-9a-f]{16,128}$'),
  failures      integer not null default 0 check (failures >= 0),
  -- How many times this key has been locked recently. Each one doubles the next lock.
  strikes       integer not null default 0 check (strikes >= 0),
  last_fail     timestamptz not null default now(),
  locked_until  timestamptz,
  primary key (bucket, key_hash)
);
create index rate_locks_last_idx on app.rate_locks (last_fail);
alter table app.rate_locks enable row level security;
alter table app.rate_locks force row level security;
revoke all on app.rate_locks from public, anon, authenticated, service_role;

create or replace function app.rate_hit(p_bucket text, p_key text, p_limit integer, p_window_seconds integer) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 60), 86400));
  v_start timestamptz := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / v_window) * v_window);
  v_count integer;
begin
  insert into app.rate_limits (bucket, key_hash, window_start, count) values (p_bucket, p_key, v_start, 1)
  on conflict (bucket, key_hash, window_start) do update set count = app.rate_limits.count + 1
  returning count into v_count;
  return pg_catalog.jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'retry_after', case when v_count <= p_limit then 0
      else greatest(1, pg_catalog.ceil(extract(epoch from (v_start + pg_catalog.make_interval(secs => v_window) - pg_catalog.clock_timestamp())))::integer) end);
end
$$;

create or replace function app.lock_state(p_bucket text, p_key text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select pg_catalog.jsonb_build_object(
      'locked', l.locked_until is not null and l.locked_until > pg_catalog.clock_timestamp(),
      'retry_after', case when l.locked_until is not null and l.locked_until > pg_catalog.clock_timestamp()
        then greatest(1, pg_catalog.ceil(extract(epoch from (l.locked_until - pg_catalog.clock_timestamp())))::integer) else 0 end,
      'failures', l.failures)
    from app.rate_locks l where l.bucket = p_bucket and l.key_hash = p_key),
    pg_catalog.jsonb_build_object('locked', false, 'retry_after', 0, 'failures', 0))
$$;

-- One failure. Failures older than the window are forgotten; strikes are forgotten after a quiet day.
create or replace function app.lock_fail(
  p_bucket text, p_key text, p_threshold integer, p_window_seconds integer, p_base_seconds integer, p_max_seconds integer
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  l app.rate_locks%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_lock integer;
begin
  insert into app.rate_locks (bucket, key_hash, failures, strikes, last_fail) values (p_bucket, p_key, 0, 0, v_now)
  on conflict (bucket, key_hash) do nothing;
  select * into l from app.rate_locks x where x.bucket = p_bucket and x.key_hash = p_key for update;
  if l.last_fail < v_now - pg_catalog.make_interval(secs => greatest(1, p_window_seconds)) then l.failures := 0; end if;
  if l.last_fail < v_now - interval '24 hours' then l.strikes := 0; end if;
  l.failures := l.failures + 1;
  l.last_fail := v_now;
  if l.failures >= greatest(1, p_threshold) then
    l.strikes := l.strikes + 1;
    v_lock := least(greatest(1, p_max_seconds), greatest(1, p_base_seconds) * (2 ^ least(l.strikes - 1, 16))::integer);
    l.locked_until := v_now + pg_catalog.make_interval(secs => v_lock);
    l.failures := 0;
  end if;
  update app.rate_locks x set failures = l.failures, strikes = l.strikes, last_fail = l.last_fail, locked_until = l.locked_until
   where x.bucket = p_bucket and x.key_hash = p_key;
  return pg_catalog.jsonb_build_object(
    'locked', l.locked_until is not null and l.locked_until > v_now,
    'retry_after', case when l.locked_until is not null and l.locked_until > v_now
      then greatest(1, pg_catalog.ceil(extract(epoch from (l.locked_until - v_now)))::integer) else 0 end,
    'failures', l.failures);
end
$$;

-- A success forgets the failures. The strikes stay for a day, so guessing right after a lock does not reset the backoff.
create or replace function app.lock_clear(p_bucket text, p_key text) returns void
language sql security definer
set search_path = ''
as $$ update app.rate_locks l set failures = 0, locked_until = null where l.bucket = p_bucket and l.key_hash = p_key $$;

revoke all on function app.rate_hit(text, text, integer, integer), app.lock_state(text, text),
  app.lock_fail(text, text, integer, integer, integer, integer), app.lock_clear(text, text) from public, anon, authenticated, service_role;

-- Server doors (service role only). A signed-in person must not be able to spend or reset anybody's counters.
create or replace function public.rate_hit(p_bucket text, p_key text, p_limit integer, p_window_seconds integer) returns jsonb
language sql security definer set search_path = ''
as $$ select app.rate_hit(p_bucket, p_key, p_limit, p_window_seconds) $$;

create or replace function public.rate_lock_state(p_bucket text, p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select app.lock_state(p_bucket, p_key) $$;

create or replace function public.rate_lock_fail(
  p_bucket text, p_key text, p_threshold integer, p_window_seconds integer, p_base_seconds integer, p_max_seconds integer
) returns jsonb
language sql security definer set search_path = ''
as $$ select app.lock_fail(p_bucket, p_key, p_threshold, p_window_seconds, p_base_seconds, p_max_seconds) $$;

create or replace function public.rate_lock_clear(p_bucket text, p_key text) returns void
language sql security definer set search_path = ''
as $$ select app.lock_clear(p_bucket, p_key) $$;

-- Before a sign-in attempt: may it go ahead? One call instead of three.
create or replace function public.signin_gate(p_addr text, p_acct text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_addr jsonb := app.rate_hit('signin.addr', p_addr, 30, 600);
  v_pair jsonb := app.lock_state('signin.pair', pg_catalog.encode(extensions.digest(p_acct || ':' || p_addr, 'sha256'), 'hex'));
  v_acct jsonb := app.lock_state('signin.acct', p_acct);
  v_wait integer;
begin
  v_wait := greatest(
    case when (v_addr ->> 'allowed')::boolean then 0 else (v_addr ->> 'retry_after')::integer end,
    (v_pair ->> 'retry_after')::integer, (v_acct ->> 'retry_after')::integer);
  return pg_catalog.jsonb_build_object('allowed', v_wait = 0, 'retry_after', v_wait);
end
$$;

-- After a sign-in attempt: count the failure (and lock when it is one too many) or forget earlier failures.
-- The email is used only to find the account so the event lands in the right company's trail. It is not stored.
create or replace function public.signin_result(p_addr text, p_acct text, p_ok boolean, p_email text, p_ip_hash text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pair_key text := pg_catalog.encode(extensions.digest(p_acct || ':' || p_addr, 'sha256'), 'hex');
  v_user uuid;
  v_pair jsonb;
  v_acct jsonb;
  v_locked boolean;
begin
  select u.id into v_user from auth.users u where pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))) limit 1;
  if p_ok then
    perform app.lock_clear('signin.pair', v_pair_key);
    perform app.security_event(null, v_user, 'signin.password_ok', 'ok', p_ip_hash, '{}'::jsonb, p_acct);
    return pg_catalog.jsonb_build_object('locked', false, 'retry_after', 0);
  end if;
  v_pair := app.lock_fail('signin.pair', v_pair_key, 5, 900, 60, 1800);
  v_acct := app.lock_fail('signin.acct', p_acct, 20, 900, 300, 900);
  v_locked := (v_pair ->> 'locked')::boolean or (v_acct ->> 'locked')::boolean;
  perform app.security_event(null, v_user, 'signin.failed', 'failed', p_ip_hash, '{}'::jsonb, p_acct);
  if v_locked then
    perform app.security_event(null, v_user, 'signin.locked', 'locked', p_ip_hash,
      pg_catalog.jsonb_build_object('scope', case when (v_acct ->> 'locked')::boolean then 'account' else 'account_and_address' end), p_acct);
  end if;
  return pg_catalog.jsonb_build_object('locked', v_locked,
    'retry_after', greatest((v_pair ->> 'retry_after')::integer, (v_acct ->> 'retry_after')::integer));
end
$$;

revoke all on function public.rate_hit(text, text, integer, integer), public.rate_lock_state(text, text),
  public.rate_lock_fail(text, text, integer, integer, integer, integer), public.rate_lock_clear(text, text),
  public.signin_gate(text, text), public.signin_result(text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.rate_hit(text, text, integer, integer), public.rate_lock_state(text, text),
  public.rate_lock_fail(text, text, integer, integer, integer, integer), public.rate_lock_clear(text, text),
  public.signin_gate(text, text), public.signin_result(text, text, boolean, text, text) to service_role;
