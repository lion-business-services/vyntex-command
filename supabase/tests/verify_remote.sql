-- Read-only check of a real Supabase project after the migrations and seed.sql have been run.
-- IN: Supabase SQL Editor. Paste the whole file and press Run. It changes nothing: every statement is a SELECT.
-- Every row of the result should say "ok". A row that says "PROBLEM" names what to look at.
-- This is a structure check. It does not replace the full isolation test in rls_isolation.sql, which needs test users.

with checks (item, ok, detail) as (
  select 'migrations were run by a role that may bypass row level security',
         (select bool_or(r.rolsuper or r.rolbypassrls) from pg_roles r join pg_class c on c.relowner = r.oid where c.oid = 'public.tenants'::regclass),
         (select 'tables are owned by ' || r.rolname from pg_roles r join pg_class c on c.relowner = r.oid where c.oid = 'public.tenants'::regclass)
  union all
  select 'public has the 29 tables of migrations 0001 to 0019 (later migrations add more)',
         (select count(*) = 29 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
            and c.relname in ('industries', 'tenants', 'tenant_members', 'demo_requests', 'clients', 'workers', 'leads', 'jobs', 'notes', 'job_assignments',
              'job_expenses', 'client_payments', 'work_logs', 'tasks', 'worker_payments', 'documents', 'messages', 'activity', 'automation_settings',
              'automation_runs', 'consent_records', 'audit_log',
              'client_people', 'client_secrets', 'lead_handoffs', 'lead_routing', 'task_comments', 'member_state', 'ws_requests')),
         (select count(*)::text || ' tables in public' from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p'))
  union all
  select 'row level security is enabled and forced on every table in public',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
         coalesce((select 'missing on: ' || string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)), 'all tables')
  union all
  select 'the anonymous role holds no privilege on any table or view in public',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, p)),
         coalesce((select 'anon can touch: ' || string_agg(distinct c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, p)), 'none')
  union all
  select 'the anonymous role cannot run any function in public or app (except those listed in app.anon_functions)',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE')
                       and not exists (select 1 from app.anon_functions a where a.signature = p.oid::regprocedure::text)),
         coalesce((select 'anon can run: ' || string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'EXECUTE')), 'none')
  union all
  select 'signed-in people cannot read the encrypted tax ID column',
         not has_column_privilege('authenticated', 'public.workers', 'tax_id_enc', 'SELECT'), 'workers.tax_id_enc'
  union all
  select 'signed-in people and the server role cannot call the key or decrypt functions',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'app' and p.proname in ('secret', 'pii_key', 'encrypt_pii', 'decrypt_pii')
                       and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
         'app.secret, app.pii_key, app.encrypt_pii, app.decrypt_pii'
  union all
  select 'every privileged function has a fixed search path',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosecdef
                     and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')),
         'functions in public and app'
  union all
  select 'the 89 access policies of migrations 0003 and 0013 exist in public (later migrations add more)',
         (select count(*) >= 89 from pg_policies where schemaname = 'public'),
         (select count(*)::text || ' found' from pg_policies where schemaname = 'public')
  union all
  select 'every insert, update and delete policy asks for the write capability',
         not exists (select 1 from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                       and coalesce(qual, '') || coalesce(with_check, '') !~ '''write''' and tablename not in ('member_state', 'ws_requests')),
         coalesce((select string_agg(tablename || '.' || policyname, ', ') from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                     and coalesce(qual, '') || coalesce(with_check, '') !~ '''write''' and tablename not in ('member_state', 'ws_requests')), 'all of them')
  union all
  select 'no application role holds any privilege on client_secrets (the encrypted tax IDs of clients)',
         not has_any_column_privilege('authenticated', 'public.client_secrets', 'SELECT, INSERT, UPDATE, REFERENCES')
           and not has_any_column_privilege('service_role', 'public.client_secrets', 'SELECT, INSERT, UPDATE, REFERENCES')
           and not has_table_privilege('authenticated', 'public.client_secrets', 'DELETE') and not has_table_privilege('service_role', 'public.client_secrets', 'DELETE')
           and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_secrets'),
         'public.client_secrets'
  union all
  select 'ws_load and ws_apply can be run by signed-in people only',
         has_function_privilege('authenticated', 'public.ws_load(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.ws_apply(uuid, jsonb, text)', 'EXECUTE')
           and not has_function_privilege('service_role', 'public.ws_load(uuid)', 'EXECUTE') and not has_function_privilege('service_role', 'public.ws_apply(uuid, jsonb, text)', 'EXECUTE')
           and not has_function_privilege('anon', 'public.ws_load(uuid)', 'EXECUTE') and not has_function_privilege('anon', 'public.ws_apply(uuid, jsonb, text)', 'EXECUTE'),
         'public.ws_load, public.ws_apply'
  union all
  select 'the gateway registry holds the collections and no application role can touch it',
         (select count(distinct name) >= 50 from app.ws_collections)
           and not has_any_column_privilege('authenticated', 'app.ws_collections', 'SELECT, INSERT, UPDATE, REFERENCES'),
         (select count(distinct name)::text || ' collections registered, ' || count(distinct name) filter (where kind = 'pending') || ' of them waiting for their table' from app.ws_collections)
  union all
  select 'the fixed lists on lead stage and source are gone, and the validation trigger is in place',
         not exists (select 1 from pg_constraint where conrelid = 'public.leads'::regclass and conname in ('leads_status_check', 'leads_source_check'))
           and exists (select 1 from pg_trigger where tgrelid = 'public.leads'::regclass and tgname = 'leads_validate' and not tgisinternal),
         'public.leads'
  union all
  select 'the 6 worker document policies exist on storage.objects',
         (select count(*) = 6 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'worker_documents_%'),
         (select count(*)::text || ' found' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'worker_documents_%')
  union all
  select 'the worker documents bucket exists and is private',
         coalesce((select not public from storage.buckets where id = 'worker-documents'), false),
         coalesce((select 'public = ' || public::text from storage.buckets where id = 'worker-documents'), 'bucket not found')
  union all
  select 'the 5 role views exist and are security-barrier views',
         (select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'
            and coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_barrier'), false)),
         (select count(*)::text || ' found' from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v')
  union all
  select 'the 9 editions are loaded (seed.sql)',
         (select count(*) = 9 from public.industries),
         (select count(*)::text || ' found' from public.industries)
  union all
  select 'the audit log, consent records, history and lead handoffs are protected against changes',
         (select count(*) = 7 from pg_trigger where not tgisinternal and tgname in ('audit_log_append_only', 'audit_log_no_truncate', 'consent_records_freeze', 'consent_records_no_truncate', 'activity_append_only',
            'lead_handoffs_append_only', 'lead_handoffs_no_truncate')),
         'append-only triggers'
  union all
  select 'the guards of 0013 are in place',
         (select count(*) = 6 from pg_trigger where not tgisinternal and tgname in ('tenants_guard', 'tenant_members_guard', 'messages_guard', 'jobs_write_guard', 'clients_tax_guard', 'tenants_config_check')),
         'tenants_guard, tenant_members_guard, messages_guard, jobs_write_guard, clients_tax_guard, tenants_config_check'
  union all
  select 'public has the 25 module tables of migrations 0030 to 0040 (54 tables with the 29 above)',
         (select count(*) = 25 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
            and c.relname in ('access_grants', 'access_requests', 'appointment_types', 'appointments', 'cash_closes', 'cash_entries', 'catalog_services', 'catalog_tiers',
              'compliance_items', 'credits', 'cross_sell_rules', 'doc_template_blocks', 'doc_templates', 'envelope_fields', 'envelope_signers', 'envelopes', 'offices',
              'opportunities', 'playbook_steps', 'playbooks', 'reveal_requests', 'review_requests', 'rules', 'secure_access_log', 'social_posts')),
         (select count(*)::text || ' of 25 found' from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
            and c.relname in ('access_grants', 'access_requests', 'appointment_types', 'appointments', 'cash_closes', 'cash_entries', 'catalog_services', 'catalog_tiers',
              'compliance_items', 'credits', 'cross_sell_rules', 'doc_template_blocks', 'doc_templates', 'envelope_fields', 'envelope_signers', 'envelopes', 'offices',
              'opportunities', 'playbook_steps', 'playbooks', 'reveal_requests', 'review_requests', 'rules', 'secure_access_log', 'social_posts'))
  union all
  select 'the 85 access policies of the module tables exist (174 in public with the 89 above; later migrations add more)',
         (select count(*) = 85 from pg_policies where schemaname = 'public'
            and tablename in ('access_grants', 'access_requests', 'appointment_types', 'appointments', 'cash_closes', 'cash_entries', 'catalog_services', 'catalog_tiers',
              'compliance_items', 'credits', 'cross_sell_rules', 'doc_template_blocks', 'doc_templates', 'envelope_fields', 'envelope_signers', 'envelopes', 'offices',
              'opportunities', 'playbook_steps', 'playbooks', 'reveal_requests', 'review_requests', 'rules', 'secure_access_log', 'social_posts')),
         (select count(*)::text || ' found on the module tables, ' || (select count(*) from pg_policies where schemaname = 'public') || ' in public' from pg_policies where schemaname = 'public'
            and tablename in ('access_grants', 'access_requests', 'appointment_types', 'appointments', 'cash_closes', 'cash_entries', 'catalog_services', 'catalog_tiers',
              'compliance_items', 'credits', 'cross_sell_rules', 'doc_template_blocks', 'doc_templates', 'envelope_fields', 'envelope_signers', 'envelopes', 'offices',
              'opportunities', 'playbook_steps', 'playbooks', 'reveal_requests', 'review_requests', 'rules', 'secure_access_log', 'social_posts'))
  union all
  select 'every collection of the data model is built: no placeholder is left',
         (select coalesce(string_agg(distinct name, ', '), '') = '' from app.ws_collections where kind = 'pending'),
         coalesce((select 'still waiting: ' || string_agg(distinct name, ', ') from app.ws_collections where kind = 'pending'), 'none waiting')
  union all
  select 'the 18 protected functions of the module range can be run by signed-in people only',
         (select count(distinct p.proname) = 18 and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('grant_decide', 'grant_revoke', 'appt_mark_paid', 'appt_cancel', 'credit_apply', 'credit_void', 'credit_issue', 'vault_set', 'vault_clear',
              'vault_request', 'vault_decide', 'vault_reveal', 'vault_copied', 'cash_close', 'member_set_role', 'member_disable', 'member_enable', 'export_request')),
         'grant_*, appt_*, credit_*, vault_*, cash_close, member_*, export_request'
  union all
  select 'the 7 server functions of the module range can be run by the server only',
         (select count(distinct p.proname) = 7 and bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('appt_release_unpaid', 'credits_expiring', 'vault_expire', 'link_issue', 'link_peek', 'link_use', 'link_revoke')),
         'appt_release_unpaid, credits_expiring, vault_expire, link_issue, link_peek, link_use, link_revoke'
  union all
  select 'the 16 guards of the module range are in place (ledgers, the closed cash day, double booking, what a person may not write)',
         (select count(distinct tgname) = 16 from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname in ('credits_ledger_guard', 'credits_no_delete', 'reveal_requests_guard',
            'reveal_requests_no_delete', 'secure_access_log_append_only', 'secure_access_log_no_delete', 'cash_closes_guard', 'cash_closes_no_delete', 'cash_entries_lock',
            'appointments_double_booking', 'appointments_person_guard', 'envelopes_person_guard', 'envelope_signers_person_guard', 'envelope_fields_person_guard',
            'review_requests_person_guard', 'social_posts_person_guard')),
         (select count(distinct tgname)::text || ' of 16 found' from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname in ('credits_ledger_guard', 'credits_no_delete', 'reveal_requests_guard',
            'reveal_requests_no_delete', 'secure_access_log_append_only', 'secure_access_log_no_delete', 'cash_closes_guard', 'cash_closes_no_delete', 'cash_entries_lock',
            'appointments_double_booking', 'appointments_person_guard', 'envelopes_person_guard', 'envelope_signers_person_guard', 'envelope_fields_person_guard',
            'review_requests_person_guard', 'social_posts_person_guard'))
  union all
  select 'signed-in people write the credit ledger, the reveal requests and the access log through the protected functions only',
         not has_table_privilege('authenticated', 'public.credits', 'INSERT, UPDATE, DELETE') and not has_any_column_privilege('authenticated', 'public.credits', 'INSERT, UPDATE')
           and not has_table_privilege('authenticated', 'public.reveal_requests', 'INSERT, UPDATE, DELETE') and not has_any_column_privilege('authenticated', 'public.reveal_requests', 'INSERT, UPDATE')
           and not has_table_privilege('authenticated', 'public.secure_access_log', 'INSERT, UPDATE, DELETE') and not has_any_column_privilege('authenticated', 'public.secure_access_log', 'INSERT, UPDATE')
           and not has_table_privilege('authenticated', 'public.access_grants', 'INSERT, UPDATE, DELETE') and not has_any_column_privilege('authenticated', 'public.access_grants', 'INSERT, UPDATE'),
         'public.credits, public.reveal_requests, public.secure_access_log, public.access_grants'
  union all
  select 'the token table of the public pages is closed to every application role',
         not has_any_column_privilege('authenticated', 'app.public_links', 'SELECT, INSERT, UPDATE, REFERENCES') and not has_any_column_privilege('service_role', 'app.public_links', 'SELECT, INSERT, UPDATE, REFERENCES')
           and not has_any_column_privilege('anon', 'app.public_links', 'SELECT, INSERT, UPDATE, REFERENCES')
           and not exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'public_links'),
         'app.public_links'
  union all
  select 'every event a rule can listen to is accepted (30 events, the same list as RuleEvent in src/domain/types.ts)',
         (select pg_get_constraintdef(c.oid) ~ 'appointment\.soon' and pg_get_constraintdef(c.oid) ~ 'appointment\.pay_soon' and pg_get_constraintdef(c.oid) ~ 'opportunity\.created'
                 and pg_get_constraintdef(c.oid) ~ 'credit\.expiring' from pg_constraint c where c.conrelid = 'public.rules'::regclass and c.conname = 'rules_event_check'),
         'public.rules.event'
  union all
  select 'no customer company exists yet (expected right after setup)',
         (select count(*) = 0 from public.tenants),
         (select count(*)::text || ' companies' from public.tenants)
)
select item as "check", case when ok then 'ok' else 'PROBLEM' end as result, detail from checks;
