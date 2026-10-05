-- 0049 Module range: the closing check
-- Safe to run again at any time. Refuses to finish when a rule of this range is broken:
--   * every collection of the data model is built: no placeholder of 0018 is left ("connections" became a real,
--     read-only collection in 0048b)
--   * the protected functions are executable by signed-in people only, the server's functions by the server only
--     (the module functions, the public endpoints of 0041 to 0045, and the provider functions of 0046 to 0048)
--   * the ledgers keep their guards (credits, reveal requests, the access log, cash closes, closed cash days)
--   * the server tables of this range are closed like every server table: row level security enabled and forced,
--     no policy, no privilege for any application role
-- and then runs the general check of 0019 once more.
do $lockdown$
declare
  r record;
  for_people constant text[] := array[
    'grant_decide', 'grant_revoke', 'appt_mark_paid', 'appt_cancel', 'credit_apply', 'credit_void', 'credit_issue',
    'vault_set', 'vault_clear', 'vault_request', 'vault_decide', 'vault_reveal', 'vault_copied', 'cash_close',
    'member_set_role', 'member_disable', 'member_enable', 'export_request',
    -- public endpoints (0041 to 0045): the office side
    'envelope_send_check', 'review_send_check', 'intake_key_rotate', 'intake_key_state',
    -- finance (0047): what a person decides about payments and customers of a connected system
    'finance_unmatched', 'finance_payment_assign', 'finance_customer_approve'];
  server_only constant text[] := array['appt_release_unpaid', 'credits_expiring', 'vault_expire', 'link_issue', 'link_peek', 'link_use', 'link_revoke',
    -- public endpoints and server-side workflows (0041 to 0045)
    'envelope_commit', 'envelope_get', 'envelopes_due', 'envelopes_unfinished', 'sign_open', 'sign_commit', 'sign_finalize',
    'review_open', 'review_answer', 'review_send_commit', 'message_get', 'message_mark', 'messages_queued', 'intake_submit',
    'owner_summary_due', 'public_links_purge',
    -- Google links (0046)
    'gcal_link_get', 'gcal_link_by_event', 'gcal_link_put', 'gcal_link_delete', 'google_inbound_put', 'google_inbound_pending', 'google_inbound_mark',
    -- finance (0047)
    'fin_audit', 'fin_candidates', 'fin_clients', 'fin_context', 'fin_intent_put', 'fin_link_get', 'fin_link_put', 'fin_links_apply',
    'fin_payment_get', 'fin_payment_record', 'fin_push_source', 'fin_refund_record', 'fin_services',
    -- messaging (0048)
    'messaging_ingest', 'messaging_outbox_get', 'messaging_send_result', 'messaging_outbox_due', 'social_posts_due', 'social_post_claim', 'social_post_result'];
  server_tables constant text[] := array['public_links', 'intake_forms', 'gcal_links', 'google_inbound',
    'finance_links', 'finance_payments', 'finance_intents', 'finance_sync_log'];
  guards constant text[] := array[
    'credits_ledger_guard', 'credits_no_delete', 'reveal_requests_guard', 'reveal_requests_no_delete', 'secure_access_log_append_only',
    'secure_access_log_no_delete', 'cash_closes_guard', 'cash_closes_no_delete', 'cash_entries_lock', 'appointments_double_booking',
    'appointments_person_guard', 'envelopes_person_guard', 'envelope_signers_person_guard', 'envelope_fields_person_guard',
    'review_requests_person_guard', 'social_posts_person_guard'];
  g text;
begin
  for r in select w.name from app.ws_collections w where w.kind = 'pending' loop
    raise exception 'The collection "%" is still a placeholder: its table was not built', r.name;
  end loop;

  for r in
    select p.oid, p.oid::regprocedure as sig, p.proname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and (p.proname = any (for_people) or p.proname = any (server_only))
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if r.proname = any (for_people) and (not pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE')) then
      raise exception 'Function % is for signed-in people only', r.sig;
    end if;
    if r.proname = any (server_only) and (pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
        or not pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE')) then
      raise exception 'Function % is for the server only', r.sig;
    end if;
  end loop;
  if (select pg_catalog.count(distinct p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname = any (for_people) or p.proname = any (server_only)))
     <> pg_catalog.cardinality(for_people) + pg_catalog.cardinality(server_only) then
    raise exception 'A function of the module range is missing';
  end if;

  foreach g in array guards loop
    if not exists (select 1 from pg_catalog.pg_trigger t where t.tgname = g and not t.tgisinternal and t.tgenabled <> 'D') then
      raise exception 'The guard % is missing or switched off', g;
    end if;
  end loop;

  for r in
    select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relname = any (server_tables)
  loop
    execute format('revoke all on app.%I from public, anon, authenticated, service_role', r.relname);
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = r.oid) or not (r.relrowsecurity and r.relforcerowsecurity) then
      raise exception 'app.% must have row level security enabled and forced, and no policy', r.relname;
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r' and c.relname = any (server_tables)) <> pg_catalog.cardinality(server_tables) then
    raise exception 'A server table of the module range is missing from schema app';
  end if;
end
$lockdown$;

select app.lockdown_check();
