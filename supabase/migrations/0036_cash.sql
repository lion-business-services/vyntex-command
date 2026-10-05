-- 0036 Petty cash (the brief, sections 72 and 79)
--   CashEntry -> cash_entries     by = by_member_id (the person who recorded it), closeId = close_id
--   CashClose -> cash_closes      by = by_member_id, approvedBy = approved_by
-- A drawer is an office (or the one drawer of a company without offices: office_id NULL).
--
-- The daily close: public.cash_close counts a drawer for a day. It works out what the drawer should hold (the last
-- count before that day, plus what came in, minus what went out since), records the difference, and locks every
-- entry of that drawer up to that day. From then on, for every caller:
--   an entry that carries a close is never changed or removed
--   no entry can be added to, moved into or moved out of a day that is already counted
-- A person only creates a close through that function. Approving a count (a second pair of eyes) is the one thing
-- a person writes on a close afterwards, in their own name.

-- ---------------------------------------------------------------------------------------------------------------------
-- cash_closes
-- ---------------------------------------------------------------------------------------------------------------------
create table public.cash_closes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  date          date not null,
  office_id     uuid,
  expected      numeric(12,2) not null,
  counted       numeric(12,2) not null check (counted >= 0),
  diff          numeric(12,2) not null,
  by_member_id  uuid,
  at            timestamptz not null default now(),
  note          text check (length(note) <= 1000),
  approved_by   uuid,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint cash_closes_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint cash_closes_diff check (diff = counted - expected),
  foreign key (tenant_id, office_id) references public.offices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id),
  foreign key (tenant_id, approved_by) references public.tenant_members (tenant_id, id) on delete set null (approved_by)
);
create index cash_closes_office_idx on public.cash_closes (tenant_id, office_id, date);
create index cash_closes_by_idx on public.cash_closes (tenant_id, by_member_id);
create index cash_closes_approved_by_idx on public.cash_closes (tenant_id, approved_by);
-- a drawer is counted once per day
create unique index cash_closes_day_uidx on public.cash_closes (tenant_id, coalesce(office_id, '00000000-0000-0000-0000-000000000000'::uuid), date);
select app.module_table('cash_closes', 'select');
grant update (approved_by, extra) on public.cash_closes to authenticated;

create policy cash_closes_select on public.cash_closes for select to authenticated
  using (tenant_id = any ((select app.tenants_can('cash'))::uuid[]));
create policy cash_closes_update on public.cash_closes for update to authenticated
  using (tenant_id = any ((select app.tenants_can('cash', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('cash', 'write'))::uuid[]));
create trigger cash_closes_audit after insert or update or delete on public.cash_closes
  for each row execute function app.audit_row('note');

-- A close is a record of a count: for every caller only the approval can still be added, once.
create or replace function app.cash_closes_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.date, new.office_id, new.expected, new.counted, new.diff, new.at, new.note) is distinct from (old.date, old.office_id, old.expected, old.counted, old.diff, old.at, old.note)
     or (new.by_member_id is distinct from old.by_member_id and new.by_member_id is not null)
     or (new.approved_by is distinct from old.approved_by and old.approved_by is not null and new.approved_by is not null) then
    raise exception 'A cash close is a record of a count: it is never edited' using errcode = '42501', constraint = 'cash_closes_record';
  end if;
  return null;
end
$$;
revoke all on function app.cash_closes_guard() from public, anon;
create trigger cash_closes_guard after update on public.cash_closes for each row execute function app.cash_closes_guard();
create trigger cash_closes_no_delete before delete on public.cash_closes for each row execute function app.block_change();
create trigger cash_closes_no_truncate before truncate on public.cash_closes for each statement execute function app.block_change();

-- Approving a count: in the person's own name, by an owner or a manager, and not by whoever counted the drawer,
-- unless the company has nobody else to ask (a single owner or manager approves their own count).
create or replace function app.cash_closes_approve() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid;
begin
  if current_user <> 'authenticated' or new.approved_by is not distinct from old.approved_by then return new; end if;
  v_me := app.current_member(new.tenant_id);
  if old.approved_by is not null or new.approved_by is null or not coalesce(app.has_role(new.tenant_id, array['owner', 'manager']), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if old.by_member_id = v_me and app.other_senior_exists(new.tenant_id, v_me) then
    raise exception 'needs_other_person' using errcode = '42501';
  end if;
  new.approved_by := v_me;
  return new;
end
$$;
-- Is there another active owner or manager in the company? SECURITY DEFINER: a person may not read every member.
create or replace function app.other_senior_exists(p_tenant uuid, p_member uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.tenant_members m
                 where m.tenant_id = p_tenant and m.id <> p_member and m.status = 'active' and m.role in ('owner', 'manager'))
$$;
revoke all on function app.cash_closes_approve(), app.other_senior_exists(uuid, uuid) from public, anon;
grant execute on function app.other_senior_exists(uuid, uuid) to authenticated;
create trigger cash_closes_approve before update on public.cash_closes for each row execute function app.cash_closes_approve();

-- ---------------------------------------------------------------------------------------------------------------------
-- cash_entries
-- ---------------------------------------------------------------------------------------------------------------------
create table public.cash_entries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  date          date not null default current_date,
  office_id     uuid,
  dir           text not null check (dir in ('in', 'out')),
  amount        numeric(12,2) not null check (amount > 0),
  category      text not null check (length(btrim(category)) between 1 and 80),
  memo          text not null default '' check (length(memo) <= 1000),
  by_member_id  uuid,
  -- { name, size, mime, path }: the receipt is a file in private storage.
  receipt       jsonb check (jsonb_typeof(receipt) = 'object' and not (receipt ? 'dataUrl')),
  -- The close that counted this entry. Set by public.cash_close only.
  close_id      uuid,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint cash_entries_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, office_id) references public.offices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id),
  foreign key (tenant_id, close_id) references public.cash_closes (tenant_id, id) on delete restrict
);
create index cash_entries_drawer_idx on public.cash_entries (tenant_id, office_id, date);
create index cash_entries_by_idx on public.cash_entries (tenant_id, by_member_id);
create index cash_entries_close_idx on public.cash_entries (tenant_id, close_id);
select app.module_table('cash_entries', 'select, delete');
grant insert (id, tenant_id, date, office_id, dir, amount, category, memo, by_member_id, receipt, extra) on public.cash_entries to authenticated;
grant update (date, office_id, dir, amount, category, memo, receipt, extra) on public.cash_entries to authenticated;

create policy cash_entries_select on public.cash_entries for select to authenticated
  using (tenant_id = any ((select app.tenants_can('cash'))::uuid[]));
create policy cash_entries_insert on public.cash_entries for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('cash', 'write'))::uuid[]));
create policy cash_entries_update on public.cash_entries for update to authenticated
  using (tenant_id = any ((select app.tenants_can('cash', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('cash', 'write'))::uuid[]));
-- an entry is removed by someone who may delete, or by the person who recorded it (a slip of the hand, the same day)
create policy cash_entries_delete on public.cash_entries for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('cash', 'write', 'delete'))::uuid[])
    or (tenant_id = any ((select app.tenants_can('cash', 'write'))::uuid[]) and by_member_id = any ((select app.my_member_ids())::uuid[])));
create trigger cash_entries_stamp before insert on public.cash_entries for each row execute function app.stamp_member('by_member_id');
create trigger cash_entries_audit after insert or update or delete on public.cash_entries
  for each row execute function app.audit_row('memo', 'receipt');

-- Everything that touches a drawer waits for the same lock, so a count and an entry written at the same moment
-- cannot miss each other. Held until the transaction ends.
create or replace function app.cash_drawer_lock(p_tenant uuid, p_office uuid) returns void
language sql
set search_path = ''
as $$ select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vx.cash:' || p_tenant::text || ':' || coalesce(p_office::text, '-'), 0)) $$;

-- The last day that was counted for a drawer, or NULL when it was never closed.
create or replace function app.cash_locked_through(p_tenant uuid, p_office uuid) returns date
language sql stable security definer
set search_path = ''
as $$ select pg_catalog.max(c.date) from public.cash_closes c where c.tenant_id = p_tenant and c.office_id is not distinct from p_office $$;
revoke all on function app.cash_drawer_lock(uuid, uuid), app.cash_locked_through(uuid, uuid) from public, anon, authenticated, service_role;

-- The lock of a closed day, for every caller. An AFTER trigger: it runs once the row passed row level security and
-- its foreign keys, and still undoes the statement when it refuses.
create or replace function app.cash_entries_lock() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_through date;
begin
  if tg_op <> 'INSERT' then
    perform app.cash_drawer_lock(old.tenant_id, old.office_id);
    if old.close_id is not null then
      -- the one change a closed entry never sees again; being closed itself is the step below
      if tg_op = 'DELETE' or (pg_catalog.to_jsonb(new) - 'updated_at') is distinct from (pg_catalog.to_jsonb(old) - 'updated_at') then
        raise exception 'This entry was counted in a daily close and is locked' using errcode = '23514', constraint = 'cash_entry_closed';
      end if;
      return null;
    end if;
    if tg_op = 'UPDATE' and new.close_id is not null then
      -- an open entry being counted: nothing else about it may change in the same breath, and the close must be its drawer's
      if (pg_catalog.to_jsonb(new) - array['updated_at', 'close_id']) is distinct from (pg_catalog.to_jsonb(old) - array['updated_at', 'close_id'])
         or not exists (select 1 from public.cash_closes c where c.tenant_id = new.tenant_id and c.id = new.close_id
                          and c.office_id is not distinct from new.office_id and c.date >= new.date) then
        raise exception 'An entry is counted by the close of its own drawer, unchanged' using errcode = '23514', constraint = 'cash_entry_close_link';
      end if;
      return null;
    end if;
    v_through := app.cash_locked_through(old.tenant_id, old.office_id);
    if v_through is not null and old.date <= v_through then
      raise exception 'That day was already counted and closed' using errcode = '23514', constraint = 'cash_day_closed';
    end if;
    if tg_op = 'DELETE' then return null; end if;
  end if;
  if tg_op = 'UPDATE' and (new.office_id is distinct from old.office_id) then perform app.cash_drawer_lock(new.tenant_id, new.office_id); end if;
  if tg_op = 'INSERT' then perform app.cash_drawer_lock(new.tenant_id, new.office_id); end if;
  if new.close_id is not null then
    -- only the server brings in an entry that is already counted (an import of history): the close must match
    if not exists (select 1 from public.cash_closes c where c.tenant_id = new.tenant_id and c.id = new.close_id
                     and c.office_id is not distinct from new.office_id and c.date >= new.date) then
      raise exception 'An entry is counted by the close of its own drawer' using errcode = '23514', constraint = 'cash_entry_close_link';
    end if;
    return null;
  end if;
  v_through := app.cash_locked_through(new.tenant_id, new.office_id);
  if v_through is not null and new.date <= v_through then
    raise exception 'That day was already counted and closed' using errcode = '23514', constraint = 'cash_day_closed';
  end if;
  return null;
end
$$;
revoke all on function app.cash_entries_lock() from public, anon, authenticated, service_role;
create trigger cash_entries_lock after insert or update or delete on public.cash_entries for each row execute function app.cash_entries_lock();

-- ---------------------------------------------------------------------------------------------------------------------
-- public.cash_close: the end-of-day count of one drawer. Needs "cash" and "write". Answer: the CashClose.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.cash_close(p_tenant uuid, p_date date, p_office uuid, p_counted numeric, p_note text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me constant uuid := app.module_gate(p_tenant, 'cash', 'write');
  v_note constant text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_today date;
  v_through date;
  v_last numeric(12,2) := 0;
  v_expected numeric(12,2);
  v_diff numeric(12,2);
  v_id uuid;
begin
  -- "today" on the clock of the drawer's office, so an evening count is never refused as a future day
  v_today := (pg_catalog.now() at time zone app.office_timezone(p_tenant, p_office))::date;
  if p_date is null or p_date > v_today or p_counted is null or p_counted < 0 or p_counted <> pg_catalog.round(p_counted, 2) or p_counted > 9999999999.99
     or pg_catalog.length(coalesce(p_note, '')) > 1000
     or (p_office is not null and not exists (select 1 from public.offices o where o.tenant_id = p_tenant and o.id = p_office)) then
    perform app.module_refuse('invalid');
  end if;

  perform app.cash_drawer_lock(p_tenant, p_office);
  -- a day is counted once, and never a day before one that is already closed
  v_through := app.cash_locked_through(p_tenant, p_office);
  if v_through is not null and p_date <= v_through then perform app.module_refuse('locked'); end if;
  if v_through is not null then
    select c.counted into v_last from public.cash_closes c where c.tenant_id = p_tenant and c.office_id is not distinct from p_office and c.date = v_through;
  end if;
  select v_last + coalesce(pg_catalog.sum(case when e.dir = 'in' then e.amount else -e.amount end), 0) into v_expected
  from public.cash_entries e
  where e.tenant_id = p_tenant and e.office_id is not distinct from p_office and e.date <= p_date and e.close_id is null;
  v_diff := p_counted - v_expected;
  -- a difference has to be explained before the day can be closed
  if v_diff <> 0 and v_note is null then perform app.module_refuse('invalid'); end if;

  insert into public.cash_closes (tenant_id, date, office_id, expected, counted, diff, by_member_id, note)
  values (p_tenant, p_date, p_office, v_expected, p_counted, v_diff, v_me, v_note) returning id into v_id;
  -- every entry of this drawer up to that day is locked from here on
  update public.cash_entries e set close_id = v_id
   where e.tenant_id = p_tenant and e.office_id is not distinct from p_office and e.date <= p_date and e.close_id is null;
  perform app.module_event(p_tenant, 'cash.close', 'cash', v_id, pg_catalog.jsonb_build_object('date', p_date, 'office', p_office, 'diff', v_diff));
  return app.ws_read(p_tenant, 'cashCloses', app.my_permissions(p_tenant), v_id::text);
end
$$;
revoke all on function public.cash_close(uuid, date, uuid, numeric, text) from public, anon, service_role;
grant execute on function public.cash_close(uuid, date, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. An entry is written by the person who recorded it; "closeId" is read only. A close is created by
-- public.cash_close; the only field a person sends afterwards is the approval.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "cash", "ord": 110, "relation": "cash_entries",
  "read_caps": ["cash"], "write_caps": ["cash"], "delete_caps": [], "order_by": "t.date desc, t.created_at desc, t.id",
  "fields": { "id": "id", "date": "date", "officeId": "office_id", "dir": "dir", "amount": "amount", "category": "category",
              "memo": { "col": "memo", "empty": "" }, "by": { "col": "by_member_id", "stamp": "member" }, "receipt": "receipt",
              "closeId": { "col": "close_id", "ro": true } }
}$j$);
select app.ws_register($j${
  "name": "cashCloses", "ord": 111, "relation": "cash_closes",
  "read_caps": ["cash"], "write_caps": ["cash"], "order_by": "t.date desc, t.id",
  "fields": { "id": "id", "date": { "col": "date", "ro": true }, "officeId": { "col": "office_id", "ro": true },
              "expected": { "col": "expected", "ro": true }, "counted": { "col": "counted", "ro": true }, "diff": { "col": "diff", "ro": true },
              "by": { "col": "by_member_id", "ro": true }, "at": { "col": "at", "ro": true }, "note": { "col": "note", "ro": true },
              "approvedBy": "approved_by" }
}$j$);

select app.lockdown_check();
