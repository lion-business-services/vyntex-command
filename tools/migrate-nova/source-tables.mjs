// What is read from NOVA, column by column. This list is the contract:
//   * a column that is not named here is never read, so a new or unknown column cannot slip into the target;
//   * the four tax ID columns of public.clients are on purpose NOT here. The audit found no tax ID stored in NOVA;
//     if one is ever found, it is re-entered by a person through the vault of the new platform, never copied;
//   * tables under COUNTED are counted only (so the report accounts for all 31 NOVA tables) and nothing is copied.
//
// Types are the staging types in the target database. Enum columns arrive as text.
const t = 'text'; const u = 'uuid'; const ts = 'timestamptz'; const b = 'boolean'; const i = 'integer'; const d = 'date';

export const CARRIED = {
  profiles: [['id', u], ['email', t], ['full_name', t], ['role', t], ['office_id', u], ['accepts_new_leads', b], ['created_at', ts]],
  offices: [['id', u], ['name', t], ['code', t], ['address_line1', t], ['address_line2', t], ['city', t], ['state', t], ['postal_code', t], ['country', t], ['phone', t], ['active', b], ['created_at', ts], ['updated_at', ts]],
  clients: [
    ['id', u], ['first_name', t], ['last_name', t], ['email', t], ['phone', t], ['address_line1', t], ['address_line2', t], ['city', t], ['state', t],
    ['postal_code', t], ['country', t], ['business_name', t], ['business_type', t], ['website', t], ['notes', t], ['status', t], ['created_by', u],
    ['created_at', ts], ['updated_at', ts], ['office_id', u], ['client_type', t], ['client_kind', t], ['partner_terms', t], ['assigned_to', u],
    ['last_contact_at', ts], ['date_of_birth', d], ['client_since_date', d], ['documents_folder_url', t], ['sms_opt_in', b], ['email_opt_in', b],
    ['whatsapp_phone', t], ['social_instagram_url', t], ['social_facebook_url', t], ['social_tiktok_url', t], ['social_linkedin_url', t],
    ['lifecycle_stage', t], ['lead_status', t], ['lead_source', t], ['lead_source_detail', t], ['original_assigned_to', u], ['converted_at', ts],
    ['lost_reason', t], ['lost_at', ts], ['next_action', t], ['next_action_due', d], ['deal_value_cents', i], ['square_customer_id', t],
    ['source', t], ['needs_review', b], ['preferred_language', t], ['source_created_at', ts], ['source_updated_at', ts],
  ],
  client_owners: [['id', u], ['client_id', u], ['full_name', t], ['title', t], ['phone', t], ['email', t], ['is_primary', b], ['created_at', ts], ['updated_at', ts]],
  services: [['id', u], ['name', t], ['description', t], ['default_price_cents', i], ['unit', t], ['active', b], ['created_at', ts], ['code', t], ['conversion_trigger', t], ['source', t], ['is_active', b], ['category', t], ['subcategory', t]],
  service_variations: [['id', u], ['service_id', u], ['square_variation_id', t], ['name', t], ['price_cents', i], ['pricing_type', t], ['sku', t], ['is_active', b], ['created_at', ts]],
  appointment_types: [['id', u], ['code', t], ['name_en', t], ['name_es', t], ['name_zh', t], ['default_duration_minutes', i], ['default_fee_cents', i], ['is_active', b], ['sort_order', i]],
  lead_assignments: [['id', u], ['client_id', u], ['from_user_id', u], ['to_user_id', u], ['assigned_by', u], ['reason', t], ['note', t], ['created_at', ts]],
  lead_activities: [['id', u], ['client_id', u], ['actor_user_id', u], ['activity_type', t], ['from_value', t], ['to_value', t], ['channel', t], ['note', t], ['created_at', ts]],
  client_comments: [['id', u], ['client_id', u], ['author_id', u], ['body', t], ['created_at', ts], ['updated_at', ts]],
  invoices: [['id', u], ['client_id', u], ['job_id', u], ['number', t], ['status', t], ['amount_cents', i], ['issued_at', ts], ['due_at', ts], ['created_at', ts]],
  payments: [['id', u], ['client_id', u], ['invoice_id', u], ['amount_cents', i], ['method', t], ['reference', t], ['paid_at', ts], ['created_at', ts]],
};

/** Counted, never copied. The reason is printed in the report next to the count. */
export const COUNTED = {
  client_services: 'services assigned to a client are re-created as engagements by the team; NOVA keeps the old list',
  jobs: 'only test rows existed at the time of the audit',
  estimates: 'only test rows existed at the time of the audit',
  estimate_line_items: 'only test rows existed at the time of the audit',
  client_credits: 'only test rows existed at the time of the audit',
  tickets: 'requests are re-created as tasks by the team; NOVA keeps the old list',
  client_office_access: 'access grants are given again in the new platform, with an end date',
  client_access_requests: 'requests for access are not history worth carrying',
  recommendation_dismissals: 'the cross-sell rules they refer to match no live service',
  audit_log: 'it stores hashes of old values, not the values: it stays readable in NOVA',
  sales_pitches: 'not carried in this version: listed for review when rows exist',
  review_requests: 'links expire after 30 days',
  reviews: 'not carried in this version: listed for review when rows exist',
  service_gap_rules: 'the rules match no live service; the practice edition brings its own',
  pii_access_log: 'the access log of the old system stays with the old system',
  tax_id_reveal_sessions: 'the access log of the old system stays with the old system',
  appointments: 'not carried in this version: listed for review when rows exist',
  consultation_credits: 'not carried in this version: listed for review when rows exist',
  contracts: 'scaffolding without signatures in NOVA',
};
// These hold work a client may still be owed. When one of them has rows, the report asks the owner what to do.
export const REVIEW_WHEN_NOT_EMPTY = ['client_services', 'jobs', 'estimates', 'client_credits', 'tickets', 'sales_pitches', 'reviews', 'appointments', 'consultation_credits', 'contracts'];

/** Columns of public.clients that are never read. 00-preflight only counts how many rows have one. */
export const NEVER_READ = { clients: ['tax_id', 'tax_id_vault_secret_id', 'tax_id_last4', 'tax_id_type', 'photo_url'] };

const ident = (name) => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('bad identifier'); return name; };
export const columnList = (table) => CARRIED[table].map(([c]) => ident(c)).join(', ');
/** The SELECT sent to the source for one table. Enum columns are cast to text so both sides print them the same way. */
export const selectFor = (table) => `select ${CARRIED[table].map(([c, ty]) => (ty === 'text' ? `${ident(c)}::text` : ident(c))).join(', ')} from public.${ident(table)} order by id`;
/** The same checksum expression on both sides: count, then a hash over every carried column of every row. */
export const checksumSql = (relation, table) => `select count(*)::text || ':' || coalesce(md5(string_agg(md5(row(${CARRIED[table].map(([c, ty]) => (ty === 'text' ? `${ident(c)}::text` : ident(c))).join(', ')})::text), '' order by id)), '-') from ${relation}`;
export const stagingDdl = () => Object.entries(CARRIED).map(([table, cols]) =>
  `drop table if exists migrate.src_${ident(table)} cascade;\ncreate table migrate.src_${table} (${cols.map(([c, ty]) => `${ident(c)} ${ty}`).join(', ')}, primary key (id));`).join('\n');
