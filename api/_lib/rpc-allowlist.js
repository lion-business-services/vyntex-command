// Which database functions the browser can reach through /api/ws/rpc/<name>, and what each one demands.
// A function that is not listed here cannot be called from the browser, whatever its name and whatever the database
// would allow. To expose a new protected function, add one line here.
/**
 * The allow-list. name -> { stepUp, tenantArg, read, special }.
 *   stepUp     needs a fresh identity check (within five minutes), checked here and again in the database
 *   tenantArg  the argument that receives the company id ('p_tenant' unless the function has none)
 *   read       the function changes nothing (no audit event is written by the server for it)
 *   special    the server does part of the work itself: 'invite' (makes the token and sends the email), 'office'
 *              (api/_lib/public/office.js: makes link tokens, hands emails to the provider, shows a key once)
 * Convention for functions added later: the first argument is p_tenant uuid.
 */
export const RPCS = {
  // the secure tax ID vault
  vault_set: { stepUp: false }, vault_request: { stepUp: false }, vault_decide: { stepUp: true }, vault_reveal: { stepUp: true },
  vault_clear: { stepUp: true }, vault_copied: { stepUp: false },
  // people and access
  member_invite: { stepUp: true, special: 'invite' }, member_set_role: { stepUp: true }, member_disable: { stepUp: true },
  invite_list: { stepUp: false, read: true }, invite_revoke: { stepUp: false }, session_revoke_member: { stepUp: true },
  grant_decide: { stepUp: false }, grant_revoke: { stepUp: false },
  member_enable: { stepUp: true }, member_update_profile: { stepUp: false },
  // appointments, credits, cash
  appt_mark_paid: { stepUp: false }, appt_cancel: { stepUp: false }, credit_apply: { stepUp: false }, credit_void: { stepUp: false },
  cash_close: { stepUp: false }, lead_assign_next: { stepUp: false }, credit_issue: { stepUp: false },
  // payments and customers of a connected payment or accounting system (0047): what a person decides about them
  finance_unmatched: { stepUp: false, read: true }, finance_payment_assign: { stepUp: false }, finance_customer_approve: { stepUp: false },
  // signature requests, review requests and the website form key (docs/SERVER.md section 17). The same operations
  // still answer under /api/public/office/<name>.
  envelope_send: { stepUp: false, special: 'office' }, envelope_remind: { stepUp: false, special: 'office' }, review_send: { stepUp: false, special: 'office' },
  intake_key_rotate: { stepUp: true, special: 'office' }, intake_key_state: { stepUp: false, special: 'office', read: true },
  // exports
  export_request: { stepUp: true }, export_1099_data: { stepUp: true },
  // worker tax IDs and consent (migrations 0005 to 0007; these functions take no company argument)
  set_worker_tax_id: { stepUp: true, tenantArg: null }, get_worker_tax_id: { stepUp: true, tenantArg: null },
  revoke_consent: { stepUp: false, tenantArg: null }, worker_set_task_done: { stepUp: false, tenantArg: null },
  // reading
  ws_session: { stepUp: false, read: true }, ws_hidden_clients: { stepUp: false, read: true },
  // duplicate search before a client or a lead is entered (migration 0017): reads only, and a client of another office
  // comes back with its name alone
  client_find_duplicate: { stepUp: false, read: true }, lead_find_duplicate: { stepUp: false, read: true },
  security_events_list: { stepUp: false, read: true }, security_summary: { stepUp: false, read: true },
  webhook_log: { stepUp: false, read: true }, jobs_log: { stepUp: false, read: true },
};

