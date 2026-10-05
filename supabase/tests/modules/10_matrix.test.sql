-- Module tests, part 1: the role matrix of every module table, in a practice company (M) and a field company (N).
-- The table below says, for every module table, which capabilities read it, which write it and which remove a row.
-- It is written here by hand from the brief and the role matrices of the packs, on purpose: the migrations say the
-- same thing in their policies, and this test fails when the two stop agreeing.
-- For each table and each of eight people (owner, manager, staff, read only, a field worker, a disabled member, the
-- owner of another company, a person with no company) plus the anonymous visitor: read, insert, update and delete,
-- compared with what that person's capabilities allow. Isolation between companies for the same tables is proved by
-- rls_isolation.sql, which takes its list of tables from the catalog.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select test.begin_section('31. module role matrix') \g /dev/null

create table test.mod_spec (
  rel         text primary key,
  read_caps   text[],        -- NULL: not decided by capabilities alone (checked by hand further down)
  write_caps  text[],        -- NULL: no person writes this table
  del_caps    text[],        -- NULL: no person removes a row
  ins         text           -- one valid new row; {x} is replaced with the id of that sample record
);
insert into test.mod_spec values
  ('offices', '{}', '{settings}', '{settings,delete}',
   $$insert into public.offices (tenant_id, name) values ({t}, 'Matrix office')$$),
  ('playbooks', '{catalog}', '{catalog,config}', '{catalog,config,delete}',
   $$insert into public.playbooks (tenant_id, name) values ({t}, 'Matrix playbook')$$),
  ('playbook_steps', '{catalog}', '{catalog,config}', '{catalog,config}',
   $$insert into public.playbook_steps (tenant_id, playbook_id, title) values ({t}, {pb1}, '{"en":"Step","es":"Paso"}')$$),
  ('catalog_services', '{catalog}', '{catalog,config}', '{catalog,config,delete}',
   $$insert into public.catalog_services (tenant_id, name) values ({t}, 'Matrix service')$$),
  ('catalog_tiers', '{catalog}', '{catalog,config}', '{catalog,config}',
   $$insert into public.catalog_tiers (tenant_id, service_id, name, price) values ({t}, {s1}, 'Matrix tier', 10)$$),
  ('appointment_types', '{appointments}', '{appointments,config}', '{appointments,config,delete}',
   $$insert into public.appointment_types (tenant_id, name, minutes) values ({t}, '{"en":"Matrix","es":"Matriz"}', 30)$$),
  ('appointments', '{appointments}', '{appointments}', '{appointments,delete}',
   $$insert into public.appointments (tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status) values ({t}, {at1}, {c1}, {m_staff}, current_date + 40, '09:00', 30, 'requested')$$),
  ('credits', '{appointments}', null, null, null),
  ('doc_templates', '{documents}', '{documents,config}', '{documents,config,delete}',
   $$insert into public.doc_templates (tenant_id, kind, name) values ({t}, 'custom', 'Matrix template')$$),
  ('doc_template_blocks', '{documents}', '{documents,config}', '{documents,config}',
   $$insert into public.doc_template_blocks (tenant_id, template_id, type, text) values ({t}, {tpl}, 'p', 'Matrix block')$$),
  ('envelopes', '{esign}', '{esign}', '{esign,delete}',
   $$insert into public.envelopes (tenant_id, doc_id, title) values ({t}, {d1}, 'Matrix request')$$),
  ('envelope_signers', '{esign}', '{esign}', '{esign}',
   $$insert into public.envelope_signers (tenant_id, envelope_id, name, email, sign_order) values ({t}, {env_draft}, 'Second signer', 'second@example.com', 2)$$),
  ('envelope_fields', '{esign}', '{esign}', '{esign}',
   $$insert into public.envelope_fields (tenant_id, envelope_id, signer_id, type) values ({t}, {env_draft}, {signer_draft}, 'initials')$$),
  ('cash_entries', '{cash}', '{cash}', '{cash,delete}',
   $$insert into public.cash_entries (tenant_id, date, dir, amount, category) values ({t}, current_date, 'in', 1.25, 'other')$$),
  ('cash_closes', '{cash}', null, null, null),
  ('compliance_items', '{deadlines}', '{deadlines}', '{deadlines,delete}',
   $$insert into public.compliance_items (tenant_id, title, due) values ({t}, 'Matrix deadline (sample)', current_date + 60)$$),
  ('rules', '{automations}', '{automations}', '{automations,delete}',
   $$insert into public.rules (tenant_id, rule_id, name, event) values ({t}, gen_random_uuid()::text, '{"en":"Matrix","es":"Matriz"}', 'daily')$$),
  ('cross_sell_rules', '{opportunities}', '{opportunities,automations}', '{opportunities,automations,delete}',
   $$insert into public.cross_sell_rules (tenant_id, name, suggest_service_id) values ({t}, 'Matrix rule', {s1})$$),
  ('opportunities', '{opportunities}', '{opportunities}', '{opportunities,delete}',
   $$insert into public.opportunities (tenant_id, client_id, service_id, status) values ({t}, {c1}, {s1}, 'dismissed')$$),
  ('review_requests', '{reviews}', '{reviews}', '{reviews,delete}',
   $$insert into public.review_requests (tenant_id, client_id, channel) values ({t}, {c1}, 'email')$$),
  ('social_posts', '{social}', '{social}', '{social,delete}',
   $$insert into public.social_posts (tenant_id, text) values ({t}, 'Matrix post')$$),
  -- the consent switch per number (0048): read with "comms", written by the server only (a STOP is a fact a provider reports)
  ('messaging_consents', '{comms}', null, null, null),
  -- read by rules of their own (a person's own rows, or the people who decide): checked by hand below
  ('access_requests', null, null, null, null),
  ('access_grants', null, null, null, null),
  ('reveal_requests', null, null, null, null),
  ('secure_access_log', null, null, null, null);

select test.ok((select count(*) = 26 from test.mod_spec) and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in (select relname from test.core_tables) and c.relname not in (select rel from test.mod_spec)),
  'the matrix names every module table') \g /dev/null

-- The statement of a table with the ids of one company filled in.
create or replace function test.mod_sql(p_sql text, p text) returns text language plpgsql as $$
declare k text; s text := replace(p_sql, '{t}', quote_literal(test.id(p)));
begin
  foreach k in array array['c1', 'j1', 'l1', 'd1', 'm_owner', 'm_manager', 'm_staff', 'o1', 's1', 's2', 'at1', 'pb1', 'tpl', 'env_draft', 'signer_draft', 'cs', 'ap1'] loop
    s := replace(s, '{' || k || '}', quote_literal(test.id(p || '.' || k)));
  end loop;
  return s;
end $$;

do $$
declare
  p text; who text; r record; res text; perms text[]; sql text;
  can_read boolean; can_write boolean; can_del boolean; has_update boolean; t uuid; n int := 0; made uuid;
begin
  foreach p in array array['m', 'n'] loop
    t := test.id(p);
    for r in select * from test.mod_spec order by rel loop
      has_update := has_column_privilege('authenticated', ('public.' || r.rel)::regclass, 'extra', 'UPDATE');
      foreach who in array array[p || '_owner', p || '_manager', p || '_staff', p || '_readonly', p || '_w1', p || '_disabled', 'b_owner', 'nobody', 'anon'] loop
        perms := case when who = 'anon' then '{}'::text[] else test.perms(who, p) end;
        -- a worker, a disabled member and an outsider hold nothing, and "holding nothing" must read nothing
        can_read := r.read_caps is not null and r.read_caps <@ perms and exists (
          select 1 from public.tenant_members m where m.tenant_id = t and m.user_id = test.id(nullif(who, 'anon')) and m.status = 'active' and m.role <> 'worker');
        can_write := r.write_caps is not null and (r.write_caps || array['write']) <@ perms;
        can_del := r.del_caps is not null and (r.del_caps || array['write']) <@ perms;

        -- read
        if r.read_caps is not null then
          res := test.as(who, format('select 1 from public.%I where tenant_id = %L', r.rel, t));
          if who = 'anon' then perform test.is(res, 'error:42501', format('%s: anon cannot read (%s)', r.rel, p));
          elsif can_read then perform test.ok(res like 'rows:%' and res <> 'rows:0', format('%s: %s reads (%s)', r.rel, who, res));
          else perform test.is(res, 'rows:0', format('%s: %s reads nothing', r.rel, who));
          end if;
        end if;

        -- insert
        if r.ins is not null then
          res := test.as(who, test.mod_sql(r.ins, p));
          perform test.is(res, case when can_write then 'rows:1' else 'error:42501' end, format('%s: %s %s insert', r.rel, who, case when can_write then 'may' else 'cannot' end));
        elsif r.rel <> 'access_requests' then   -- (a person files their own request: checked by hand below)
          perform test.ok(not has_table_privilege('authenticated', ('public.' || r.rel)::regclass, 'INSERT') and not has_any_column_privilege('authenticated', ('public.' || r.rel)::regclass, 'INSERT'),
            format('%s: no signed-in person holds an insert privilege (%s as %s)', r.rel, p, who));
        end if;

        -- update (a change that changes nothing still has to pass the rule)
        if has_update then
          res := test.as(who, format('update public.%I set extra = extra where tenant_id = %L', r.rel, t));
          if can_write or (r.rel = 'cash_closes' and array['cash', 'write'] <@ perms) then
            perform test.ok(res like 'rows:%' and res <> 'rows:0', format('%s: %s may update (%s)', r.rel, who, res));
          else
            perform test.ok(test.blocked(res), format('%s: %s cannot update (%s)', r.rel, who, res));
          end if;
        end if;

        -- delete: one fresh row made by the test runner, then the person tries to remove exactly that row
        if r.ins is not null then
          execute test.mod_sql(r.ins, p) || ' returning id' into made;
          res := test.as(who, format('delete from public.%I where id = %L', r.rel, made));
          if can_del then perform test.is(res, 'rows:1', format('%s: %s may delete', r.rel, who));
          else perform test.ok(test.blocked(res), format('%s: %s cannot delete (%s)', r.rel, who, res));
          end if;
          execute format('delete from public.%I where id = %L', r.rel, made);
        end if;
        n := n + 1;
      end loop;
      -- what the people who may write left behind goes away again, so the later files start from the sample rows
      if r.ins is not null then
        execute format('delete from public.%I where tenant_id = %L and created_at >= $1 and id not in (select id from test.ids)', r.rel, t) using transaction_timestamp();
      end if;
    end loop;
  end loop;
  perform test.ok(n = 2 * 26 * 9, format('the matrix covered 26 tables, 9 people and 2 editions (%s passes)', n));
end $$;

-- Controls: the matrix above really tells roles apart in both editions.
select test.ok('cash' = any (test.perms('m_staff', 'm')) and not 'cash' = any (test.perms('n_staff', 'n'))
           and 'allClients' = any (test.perms('n_manager', 'n')) and not 'allClients' = any (test.perms('m_manager', 'm')),
  'control: the two editions give the same role different capabilities (cash for a practice associate, every client for a field manager)') \g /dev/null
select test.ok(test.perms('m_w1', 'm') = '{}' and test.perms('m_disabled', 'm') = '{}' and test.perms('b_owner', 'm') = '{}',
  'control: a field worker, a disabled member and the owner of another company hold nothing here') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- The four tables with a rule of their own
-- ---------------------------------------------------------------------------------------------------------------------
-- (sample rows: an approved request and a grant for the staff member, an open request of the read-only person;
--  two reveal requests of the manager; six lines in the access log)
select test.matrix('access requests of company N', format('select 1 from public.access_requests where tenant_id = %L', test.id('n')),
  'n_owner=rows:2 n_manager=rows:2 n_staff=rows:1 n_readonly=rows:1 n_w1=rows:0 n_disabled=rows:0 b_owner=rows:0 nobody=rows:0 anon=error:42501') \g /dev/null
-- in the practice edition a senior associate does not hold "allClients": only the owner sees every request
select test.matrix('access requests of company M', format('select 1 from public.access_requests where tenant_id = %L', test.id('m')),
  'm_owner=rows:2 m_manager=rows:0 m_staff=rows:1 m_readonly=rows:1 m_w1=rows:0 b_owner=rows:0 anon=error:42501') \g /dev/null
select test.matrix('access grants of company N', format('select 1 from public.access_grants where tenant_id = %L', test.id('n')),
  'n_owner=rows:1 n_manager=rows:1 n_staff=rows:1 n_readonly=rows:0 n_w1=rows:0 b_owner=rows:0 nobody=rows:0 anon=error:42501') \g /dev/null
select test.matrix('reveal requests of company N', format('select 1 from public.reveal_requests where tenant_id = %L', test.id('n')),
  'n_owner=rows:2 n_manager=rows:2 n_staff=rows:0 n_readonly=rows:0 n_w1=rows:0 b_owner=rows:0 nobody=rows:0 anon=error:42501') \g /dev/null
select test.matrix('the access log of company N', format('select 1 from public.secure_access_log where tenant_id = %L', test.id('n')),
  'n_owner=rows:6 n_manager=rows:6 n_staff=rows:0 n_readonly=rows:0 n_w1=rows:0 b_owner=rows:0 nobody=rows:0 anon=error:42501') \g /dev/null
-- a person files a request for themselves, and only for themselves
select test.matrix('filing an access request in one''s own name',
  format($q$insert into public.access_requests (tenant_id, member_id, client_id, reason) select %L, m.id, %L, 'Matrix' from public.tenant_members m where m.user_id = auth.uid() and m.tenant_id = %L$q$, test.id('n'), test.id('n.c1'), test.id('n')),
  'n_owner=rows:1 n_manager=rows:1 n_readonly=error:42501 b_owner=rows:0') \g /dev/null
select test.is(test.as('n_manager', format($q$insert into public.access_requests (tenant_id, member_id, client_id, reason) values (%L, %L, %L, 'In the name of someone else')$q$, test.id('n'), test.id('n.m_owner'), test.id('n.c1'))),
  'error:42501', 'a request cannot be filed in another person''s name') \g /dev/null
select test.is(test.as('n_owner', format($q$insert into public.access_requests (tenant_id, member_id, client_id, reason, status) values (%L, %L, %L, 'x', 'approved')$q$, test.id('n'), test.id('n.m_owner'), test.id('n.c1'))),
  'error:42501', 'nor can a person write the decision of a request: the column is not theirs') \g /dev/null
select test.is(test.as('n_owner', format($q$update public.access_requests set status = 'approved' where tenant_id = %L$q$, test.id('n'))), 'error:42501', 'nor change it afterwards') \g /dev/null
select test.matrix('taking back a request that is still waiting', format($q$delete from public.access_requests where tenant_id = %L and reason = 'Matrix' and member_id = %L$q$, test.id('n'), test.id('n.m_manager')),
  'n_staff=rows:0 n_readonly=rows:0 n_manager=rows:1') \g /dev/null
delete from public.access_requests where reason = 'Matrix';
select test.is(test.as('service', format('delete from public.credits where tenant_id = %L', test.id('n'))), 'error:42501', 'a credit is never removed, even by the server key') \g /dev/null
select test.is(test.as('service', format('delete from public.secure_access_log where tenant_id = %L', test.id('n'))), 'error:42501', 'nor a line of the access log') \g /dev/null
select test.is(test.as('service', format($q$update public.secure_access_log set reason = 'rewritten' where tenant_id = %L$q$, test.id('n'))), 'error:42501', 'which cannot be rewritten either') \g /dev/null
select test.is(test.as('service', format('delete from public.reveal_requests where tenant_id = %L', test.id('n'))), 'error:42501', 'nor a reveal request') \g /dev/null
select test.is(test.as('service', format('delete from public.cash_closes where tenant_id = %L', test.id('n'))), 'error:42501', 'nor a cash close') \g /dev/null

\pset tuples_only off
\pset format aligned
select count(*) as module_matrix_checks from test.results where section = '31. module role matrix';
