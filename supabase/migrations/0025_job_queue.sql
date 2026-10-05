-- 0025 Job queue
-- Work that must not be lost and must not run twice: refreshing a provider token, a sync, processing a webhook,
-- reminders. The scheduled function /api/cron/tick (api/cron.js) claims due jobs, runs them, and reports back.
--
--   retry        a failed job goes back to the queue with a growing wait (30 s, 60 s, 2 min ... up to 1 hour)
--   lock         a claimed job is locked for a time. "for update skip locked" means two runners never get the same job
--   lock expiry  a runner that died holds nothing: once the lock time passes the job can be claimed again
--   idempotency  (kind, idem_key) is unique: queueing the same work twice returns the first job
--   dead letter  after max_attempts the job stops with status "dead" and stays in the table for a person to look at
--
-- The error kept on a job is a short code chosen by the server, never a provider's message.

create table app.jobs (
  id            uuid primary key default gen_random_uuid(),
  -- NULL for platform work that belongs to no company (the nightly sweep).
  tenant_id     uuid references public.tenants (id) on delete cascade,
  kind          text not null check (kind ~ '^[a-z][a-z0-9_.]{2,60}$'),
  payload       jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(payload) = 'object' and pg_catalog.pg_column_size(payload) < 65536),
  idem_key      text check (pg_catalog.length(idem_key) between 1 and 200),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  run_at        timestamptz not null default now(),
  attempts      integer not null default 0 check (attempts >= 0),
  max_attempts  integer not null default 5 check (max_attempts between 1 and 20),
  locked_by     text check (pg_catalog.length(locked_by) <= 80),
  locked_until  timestamptz,
  last_error    text check (pg_catalog.length(last_error) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  constraint jobs_lock_shape check ((status = 'running') = (locked_by is not null and locked_until is not null))
);
create unique index jobs_idem_uidx on app.jobs (kind, idem_key) where idem_key is not null;
create index jobs_due_idx on app.jobs (run_at) where status in ('queued', 'running');
create index jobs_tenant_idx on app.jobs (tenant_id, created_at desc);
alter table app.jobs enable row level security;
alter table app.jobs force row level security;
revoke all on app.jobs from public, anon, authenticated, service_role;
create trigger jobs_touch before update on app.jobs for each row execute function app.touch_updated_at();

create or replace function app.job_enqueue(
  p_kind text, p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default null,
  p_tenant uuid default null, p_idem text default null, p_max_attempts integer default 5
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into app.jobs (tenant_id, kind, payload, idem_key, run_at, max_attempts)
  values (p_tenant, p_kind, coalesce(p_payload, '{}'::jsonb), p_idem, coalesce(p_run_at, pg_catalog.now()), greatest(1, least(coalesce(p_max_attempts, 5), 20)))
  on conflict (kind, idem_key) where idem_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select j.id into v_id from app.jobs j where j.kind = p_kind and j.idem_key = p_idem;
  end if;
  return v_id;
end
$$;

-- Claims up to p_limit due jobs for one runner. A job whose runner disappeared (lock time passed) is claimed again,
-- unless it has no attempts left: then it is moved to the dead letter state here.
create or replace function app.job_claim(p_worker text, p_limit integer default 10, p_lock_seconds integer default 120) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  update app.jobs j set status = 'dead', finished_at = pg_catalog.now(), last_error = 'lock_expired', locked_by = null, locked_until = null
   where j.status = 'running' and j.locked_until < pg_catalog.now() and j.attempts >= j.max_attempts;

  with due as (
    select j.id from app.jobs j
    where (j.status = 'queued' and j.run_at <= pg_catalog.now())
       or (j.status = 'running' and j.locked_until < pg_catalog.now())
    order by j.run_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  ), taken as (
    update app.jobs j
       set status = 'running', attempts = j.attempts + 1, locked_by = pg_catalog.left(p_worker, 80),
           locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(5, least(coalesce(p_lock_seconds, 120), 900)))
      from due where j.id = due.id
    returning j.id, j.tenant_id, j.kind, j.payload, j.attempts, j.max_attempts, j.run_at
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.run_at), '[]'::jsonb) into v_out from taken t;
  return v_out;
end
$$;

-- The runner finished the job. Only the runner that holds the lock can say so.
create or replace function app.job_finish(p_id uuid, p_worker text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  update app.jobs j set status = 'done', finished_at = pg_catalog.now(), locked_by = null, locked_until = null, last_error = null
   where j.id = p_id and j.status = 'running' and j.locked_by = pg_catalog.left(p_worker, 80);
  return found;
end
$$;

-- The runner failed. Back to the queue with a growing wait, or to the dead letter state when no attempt is left.
create or replace function app.job_fail(p_id uuid, p_worker text, p_error text, p_base_seconds integer default 30) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  j app.jobs%rowtype;
  v_wait integer;
begin
  select * into j from app.jobs x where x.id = p_id and x.status = 'running' and x.locked_by = pg_catalog.left(p_worker, 80) for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_held');
  end if;
  -- A negative wait means "do not try again": the handler knows the failure is permanent (unknown kind, bad payload).
  if j.attempts >= j.max_attempts or coalesce(p_base_seconds, 30) < 0 then
    update app.jobs x set status = 'dead', finished_at = pg_catalog.now(), locked_by = null, locked_until = null,
           last_error = pg_catalog.left(coalesce(p_error, 'failed'), 200)
     where x.id = p_id;
    return pg_catalog.jsonb_build_object('status', 'dead', 'attempts', j.attempts);
  end if;
  v_wait := least(3600, greatest(1, coalesce(p_base_seconds, 30)) * (2 ^ least(j.attempts - 1, 12))::integer);
  update app.jobs x set status = 'queued', locked_by = null, locked_until = null,
         run_at = pg_catalog.now() + pg_catalog.make_interval(secs => v_wait),
         last_error = pg_catalog.left(coalesce(p_error, 'failed'), 200)
   where x.id = p_id;
  return pg_catalog.jsonb_build_object('status', 'queued', 'attempts', j.attempts, 'retry_in', v_wait);
end
$$;

-- Puts a dead job back in the queue with a fresh set of attempts (after a person fixed the cause).
create or replace function app.job_requeue(p_id uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  update app.jobs j set status = 'queued', attempts = 0, run_at = pg_catalog.now(), finished_at = null, last_error = null
   where j.id = p_id and j.status = 'dead';
  return found;
end
$$;

revoke all on function app.job_enqueue(text, jsonb, timestamptz, uuid, text, integer), app.job_claim(text, integer, integer),
  app.job_finish(uuid, text), app.job_fail(uuid, text, text, integer), app.job_requeue(uuid) from public, anon, authenticated, service_role;

-- Server doors (service role only).
create or replace function public.job_enqueue(p_kind text, p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default null,
  p_tenant uuid default null, p_idem text default null, p_max_attempts integer default 5)
returns uuid language sql security definer set search_path = ''
as $$ select app.job_enqueue(p_kind, p_payload, p_run_at, p_tenant, p_idem, p_max_attempts) $$;

create or replace function public.job_claim(p_worker text, p_limit integer default 10, p_lock_seconds integer default 120)
returns jsonb language sql security definer set search_path = ''
as $$ select app.job_claim(p_worker, p_limit, p_lock_seconds) $$;

create or replace function public.job_finish(p_id uuid, p_worker text)
returns boolean language sql security definer set search_path = ''
as $$ select app.job_finish(p_id, p_worker) $$;

create or replace function public.job_fail(p_id uuid, p_worker text, p_error text, p_base_seconds integer default 30)
returns jsonb language sql security definer set search_path = ''
as $$ select app.job_fail(p_id, p_worker, p_error, p_base_seconds) $$;

create or replace function public.job_requeue(p_id uuid)
returns boolean language sql security definer set search_path = ''
as $$ select app.job_requeue(p_id) $$;

-- Numbers for the health answer: how much is waiting, how much is stuck.
create or replace function public.job_stats() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'queued', pg_catalog.count(*) filter (where j.status = 'queued'),
    'due', pg_catalog.count(*) filter (where j.status = 'queued' and j.run_at <= pg_catalog.now()),
    'running', pg_catalog.count(*) filter (where j.status = 'running'),
    'dead', pg_catalog.count(*) filter (where j.status = 'dead'),
    'oldest_due', pg_catalog.min(j.run_at) filter (where j.status = 'queued' and j.run_at <= pg_catalog.now()))
  from app.jobs j
$$;

revoke all on function public.job_enqueue(text, jsonb, timestamptz, uuid, text, integer), public.job_claim(text, integer, integer),
  public.job_finish(uuid, text), public.job_fail(uuid, text, text, integer), public.job_requeue(uuid), public.job_stats() from public, anon, authenticated;
grant execute on function public.job_enqueue(text, jsonb, timestamptz, uuid, text, integer), public.job_claim(text, integer, integer),
  public.job_finish(uuid, text), public.job_fail(uuid, text, text, integer), public.job_requeue(uuid), public.job_stats() to service_role;

-- A company's own job log (sync runs, token refreshes, failures), for the diagnostics part of the Integrations screen.
create or replace function public.jobs_log(p_tenant uuid, p_limit integer default 50) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_mfa(p_tenant);
  if not (coalesce(app.can(p_tenant, 'integrations'), false) or coalesce(app.has_role(p_tenant, array['owner']), false)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.created_at desc)
    from (
      select j.id, j.kind, j.status, j.attempts, j.max_attempts, j.run_at, j.last_error, j.created_at, j.finished_at
      from app.jobs j where j.tenant_id = p_tenant
      order by j.created_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x), '[]'::jsonb);
end
$$;
revoke all on function public.jobs_log(uuid, integer) from public, anon, service_role;
grant execute on function public.jobs_log(uuid, integer) to authenticated;
