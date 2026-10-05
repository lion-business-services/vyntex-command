-- 0038 Cross-sell, opportunities, review requests and social posts (the brief, sections 29, 33 and 37)
--   CrossSellRule -> cross_sell_rules
--   Opportunity   -> opportunities        by = by_kind + by_member_id (a person, or "automation" when a rule found it)
--   ReviewRequest -> review_requests      by = by_kind + by_member_id
--   SocialPost    -> social_posts         by = by_member_id (the person who wrote it)
--
-- The honesty rule of messages (0013) holds here too: a state that says something left the building, or that
-- someone outside answered, is a fact only the server writes.
--   review request   a person writes "draft" and "demo" (a sample: nothing was sent); sent, opened, rated and
--                    declined, and the rating itself, come from the server and the public review page
--   social post      a person writes draft, needs_approval, scheduled and demo; published and failed, the moment it
--                    went out and the provider's error come from the server. Approval is recorded in the name of
--                    the person signed in.

-- ---------------------------------------------------------------------------------------------------------------------
-- cross_sell_rules: IF a client has any of these services AND none of those THEN suggest this one
-- ---------------------------------------------------------------------------------------------------------------------
create table public.cross_sell_rules (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  name                text not null check (length(btrim(name)) between 1 and 200),
  -- Catalog services (0031). Arrays cannot carry a foreign key: an id of a service that is gone matches no client.
  when_service_ids    uuid[] not null default '{}'::uuid[] check (cardinality(when_service_ids) <= 100),
  suggest_service_id  uuid not null,
  unless_service_ids  uuid[] check (cardinality(unless_service_ids) <= 100),
  client_kind         text check (client_kind in ('individual', 'business')),
  -- Wait this many days after the engagement that triggers the rule starts.
  delay_days          integer check (delay_days between 0 and 3650),
  -- Approved talking points for the team.
  note                text check (length(note) <= 4000),
  active              boolean not null default true,
  extra               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  constraint cross_sell_rules_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  foreign key (tenant_id, suggest_service_id) references public.catalog_services (tenant_id, id) on delete restrict
);
create index cross_sell_rules_suggest_idx on public.cross_sell_rules (tenant_id, suggest_service_id);
select app.module_table('cross_sell_rules');

-- The rules are part of how the business sells: read by everyone who works opportunities, changed by the people
-- who may change automations.
create policy cross_sell_rules_select on public.cross_sell_rules for select to authenticated
  using (tenant_id = any ((select app.tenants_can('opportunities'))::uuid[]));
create policy cross_sell_rules_insert on public.cross_sell_rules for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('opportunities', 'automations', 'write'))::uuid[]));
create policy cross_sell_rules_update on public.cross_sell_rules for update to authenticated
  using (tenant_id = any ((select app.tenants_can('opportunities', 'automations', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('opportunities', 'automations', 'write'))::uuid[]));
create policy cross_sell_rules_delete on public.cross_sell_rules for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('opportunities', 'automations', 'write', 'delete'))::uuid[]));
create trigger cross_sell_rules_audit after insert or update or delete on public.cross_sell_rules for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------------------------------------------------
-- opportunities
-- ---------------------------------------------------------------------------------------------------------------------
create table public.opportunities (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  client_id         uuid not null,
  service_id        uuid not null,
  rule_id           uuid,
  status            text not null default 'open' check (status in ('open', 'contacted', 'won', 'dismissed')),
  created           date not null default current_date,
  by_kind           text not null default 'member' check (by_kind in ('member', 'automation')),
  by_member_id      uuid,
  note              text check (length(note) <= 4000),
  lead_id           uuid,
  value             numeric(12,2) check (value >= 0),
  dismissed_reason  text check (length(dismissed_reason) <= 1000),
  extra             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  constraint opportunities_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint opportunities_by_pair check (by_kind = 'member' or by_member_id is null),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.catalog_services (tenant_id, id) on delete restrict,
  foreign key (tenant_id, rule_id) references public.cross_sell_rules (tenant_id, id) on delete set null (rule_id),
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null (lead_id)
);
create index opportunities_client_idx on public.opportunities (tenant_id, client_id);
create index opportunities_service_idx on public.opportunities (tenant_id, service_id);
create index opportunities_rule_idx on public.opportunities (tenant_id, rule_id);
create index opportunities_by_idx on public.opportunities (tenant_id, by_member_id);
create index opportunities_lead_idx on public.opportunities (tenant_id, lead_id);
-- the same service is suggested to a client once while the suggestion is still open (the brief, section 90):
-- running the rules again never piles up copies
create unique index opportunities_open_uidx on public.opportunities (tenant_id, client_id, service_id) where status in ('open', 'contacted');
select app.module_table('opportunities');

create policy opportunities_select on public.opportunities for select to authenticated
  using (tenant_id = any ((select app.tenants_can('opportunities'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('opportunities', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy opportunities_update on public.opportunities for update to authenticated
  using (tenant_id = any ((select app.tenants_can('opportunities', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()))
  with check (tenant_id = any ((select app.tenants_can('opportunities', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy opportunities_delete on public.opportunities for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('opportunities', 'write', 'delete'))::uuid[]) and client_id not in (select app.hidden_clients()));
create trigger opportunities_audit_delete after delete on public.opportunities for each row execute function app.audit_row('note');

-- Who found it is the session's word: a person in their own name, or "automation" for a rule that ran while they worked.
create or replace function app.stamp_actor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.by_kind := case when new.by_kind = 'automation' then 'automation' else 'member' end;
    new.by_member_id := case when new.by_kind = 'member' then app.current_member(new.tenant_id) end;
  end if;
  return new;
end
$$;
revoke all on function app.stamp_actor() from public, anon;
create trigger opportunities_stamp before insert on public.opportunities for each row execute function app.stamp_actor();

-- ---------------------------------------------------------------------------------------------------------------------
-- review_requests
-- ---------------------------------------------------------------------------------------------------------------------
create table public.review_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  client_id     uuid not null,
  job_id        uuid,
  at            timestamptz not null default now(),
  channel       text not null default 'email' check (channel in ('email', 'text', 'whatsapp', 'facebook', 'instagram', 'call', 'system')),
  status        text not null default 'draft' check (status in ('draft', 'demo', 'sent', 'opened', 'rated', 'declined')),
  rating        smallint check (rating between 1 and 5),
  comment       text check (length(comment) <= 4000),
  by_kind       text not null default 'member' check (by_kind in ('member', 'automation')),
  by_member_id  uuid,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  constraint review_requests_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint review_requests_by_pair check (by_kind = 'member' or by_member_id is null),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete set null (job_id),
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id)
);
create index review_requests_client_idx on public.review_requests (tenant_id, client_id);
create index review_requests_job_idx on public.review_requests (tenant_id, job_id);
create index review_requests_by_idx on public.review_requests (tenant_id, by_member_id);
select app.module_table('review_requests');

create policy review_requests_select on public.review_requests for select to authenticated
  using (tenant_id = any ((select app.tenants_can('reviews'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy review_requests_insert on public.review_requests for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('reviews', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy review_requests_update on public.review_requests for update to authenticated
  using (tenant_id = any ((select app.tenants_can('reviews', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()))
  with check (tenant_id = any ((select app.tenants_can('reviews', 'write'))::uuid[]) and client_id not in (select app.hidden_clients()));
create policy review_requests_delete on public.review_requests for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('reviews', 'write', 'delete'))::uuid[]) and client_id not in (select app.hidden_clients()));
create trigger review_requests_audit_delete after delete on public.review_requests for each row execute function app.audit_row('comment');
create trigger review_requests_stamp before insert on public.review_requests for each row execute function app.stamp_actor();

create or replace function app.review_requests_person_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'demo') or (new.status = 'draft' and (new.rating is not null or new.comment is not null)) then
      raise exception 'Only the server records a review request as sent, opened, rated or declined' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status in ('draft', 'demo') then
    if new.status not in ('draft', 'demo') or (new.status = 'draft' and (new.rating is not null or new.comment is not null)) then
      raise exception 'Only the server records a review request as sent, opened, rated or declined' using errcode = '42501';
    end if;
  elsif (new.status, new.rating, new.comment, new.client_id, new.job_id, new.channel, new.at)
        is distinct from (old.status, old.rating, old.comment, old.client_id, old.job_id, old.channel, old.at) then
    -- what a client was sent and what they answered is a record of what happened
    raise exception 'A review request that was sent can no longer be changed by a person' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.review_requests_person_guard() from public, anon;
create trigger review_requests_person_guard before insert or update on public.review_requests
  for each row execute function app.review_requests_person_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- social_posts
-- ---------------------------------------------------------------------------------------------------------------------
create table public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  text           text not null default '' check (length(text) <= 70000),
  -- [{ name, size, mime, path }]: files in private storage.
  media          jsonb check (jsonb_typeof(media) = 'array' and media::text not like '%"dataUrl"%'),
  channels       text[] not null default '{}'::text[] check (channels <@ array['facebook', 'instagram', 'gbp']::text[]),
  status         text not null default 'draft' check (status in ('draft', 'needs_approval', 'scheduled', 'demo', 'published', 'failed')),
  scheduled_for  timestamptz,
  published_at   timestamptz,
  by_member_id   uuid,
  approved_by    uuid,
  error          text check (length(error) <= 1000),
  created        timestamptz not null default now(),
  extra          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  constraint social_posts_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint social_posts_published check (status <> 'published' or published_at is not null),
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id),
  foreign key (tenant_id, approved_by) references public.tenant_members (tenant_id, id) on delete set null (approved_by)
);
create index social_posts_by_idx on public.social_posts (tenant_id, by_member_id);
create index social_posts_approved_by_idx on public.social_posts (tenant_id, approved_by);
create index social_posts_due_idx on public.social_posts (scheduled_for) where status = 'scheduled';
select app.module_table('social_posts');

create policy social_posts_select on public.social_posts for select to authenticated
  using (tenant_id = any ((select app.tenants_can('social'))::uuid[]));
create policy social_posts_insert on public.social_posts for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('social', 'write'))::uuid[]));
create policy social_posts_update on public.social_posts for update to authenticated
  using (tenant_id = any ((select app.tenants_can('social', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('social', 'write'))::uuid[]));
create policy social_posts_delete on public.social_posts for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('social', 'write', 'delete'))::uuid[]));
create trigger social_posts_audit after insert or update or delete on public.social_posts
  for each row execute function app.audit_row('text', 'media');
create trigger social_posts_stamp before insert on public.social_posts for each row execute function app.stamp_member('by_member_id');

create or replace function app.social_posts_person_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status in ('published', 'failed') or new.published_at is not null or new.error is not null then
      raise exception 'Only the server records a post as published or failed' using errcode = '42501';
    end if;
    -- an approval is given in the person's own name, and only by an owner or a manager
    if new.approved_by is not null then
      if not coalesce(app.has_role(new.tenant_id, array['owner', 'manager']), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
      new.approved_by := app.current_member(new.tenant_id);
    end if;
    return new;
  end if;
  if old.status = 'published' then
    if (pg_catalog.to_jsonb(new) - array['updated_at', 'extra']) is distinct from (pg_catalog.to_jsonb(old) - array['updated_at', 'extra']) then
      raise exception 'A post that was published is a record of what went out' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.status in ('published', 'failed') and new.status <> old.status)
     or new.published_at is distinct from old.published_at
     or (new.error is distinct from old.error and new.error is not null) then
    raise exception 'Only the server records a post as published or failed' using errcode = '42501';
  end if;
  new.by_member_id := old.by_member_id;
  if new.approved_by is distinct from old.approved_by and new.approved_by is not null then
    if not coalesce(app.has_role(new.tenant_id, array['owner', 'manager']), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
    new.approved_by := app.current_member(new.tenant_id);
  end if;
  return new;
end
$$;
revoke all on function app.social_posts_person_guard() from public, anon;
create trigger social_posts_person_guard before insert or update on public.social_posts
  for each row execute function app.social_posts_person_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. Cross-sell rules (46) after the catalog; opportunities (47) and reviews (48) after clients, leads, jobs.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "crossSell", "ord": 46, "relation": "cross_sell_rules",
  "read_caps": ["opportunities"], "write_caps": ["opportunities", "automations"], "delete_caps": ["delete"], "order_by": "t.created_at, t.name, t.id",
  "fields": { "id": "id", "name": "name", "whenServiceIds": { "col": "when_service_ids", "empty": [] }, "suggestServiceId": "suggest_service_id",
              "unlessServiceIds": "unless_service_ids", "clientKind": "client_kind", "delayDays": "delay_days", "note": "note", "active": "active" }
}$j$);
select app.ws_register($j${
  "name": "opportunities", "ord": 47, "relation": "opportunities",
  "read_caps": ["opportunities"], "write_caps": ["opportunities"], "delete_caps": ["delete"], "order_by": "t.created desc, t.created_at desc, t.id",
  "fields": { "id": "id", "clientId": "client_id", "serviceId": "service_id", "ruleId": "rule_id", "status": "status", "created": "created",
              "by": { "kind": "actor", "kind_col": "by_kind", "id_col": "by_member_id" }, "note": "note", "leadId": "lead_id", "value": "value",
              "dismissedReason": "dismissed_reason" }
}$j$);
select app.ws_register($j${
  "name": "reviews", "ord": 48, "relation": "review_requests",
  "read_caps": ["reviews"], "write_caps": ["reviews"], "delete_caps": ["delete"], "order_by": "t.at desc, t.id",
  "fields": { "id": "id", "clientId": "client_id", "jobId": "job_id", "at": "at", "channel": "channel", "status": "status", "rating": "rating",
              "comment": "comment", "by": { "kind": "actor", "kind_col": "by_kind", "id_col": "by_member_id" } }
}$j$);
select app.ws_register($j${
  "name": "posts", "ord": 112, "relation": "social_posts",
  "read_caps": ["social"], "write_caps": ["social"], "delete_caps": ["delete"], "order_by": "t.created desc, t.id",
  "fields": { "id": "id", "text": { "col": "text", "empty": "" }, "media": "media", "channels": { "col": "channels", "empty": [] },
              "status": "status", "scheduledFor": "scheduled_for", "publishedAt": { "col": "published_at", "ro": true },
              "by": { "col": "by_member_id", "stamp": "member" }, "approvedBy": "approved_by", "error": { "col": "error", "ro": true },
              "created": "created" }
}$j$);

select app.lockdown_check();
