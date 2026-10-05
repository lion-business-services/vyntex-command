// The load order (parents before children) and the SQL of one batch of each entity. Used by the dry run and by apply,
// so what is rehearsed is exactly what is applied.
import fs from 'node:fs';
import path from 'node:path';
import { here } from './lib.mjs';

export const LOADS = ['01-office', '02-client', '03-client-people', '04-service', '05-tier', '06-appointment-type', '07-lead', '08-handoff', '09-note', '10-activity'];
export const loadSql = (name) => fs.readFileSync(path.join(here, 'sql', 'load', `${name}.sql`), 'utf8').replace(/^--.*$/gm, '').trim();

// The load runs as service_role: the role behind the server key. It may insert into the company's tables, it holds no
// privilege at all on client_secrets, and it cannot change or delete history. No signed-in person is attached to the
// session (request.jwt.claims is empty), which is what makes the history triggers keep the original dates and authors.
export const AS_SERVER = `set local role service_role;\nset local request.jwt.claims = '';\nset local timezone = 'UTC';\nset local lock_timeout = '10s';`;
export const PLAN_HASH = `select md5(coalesce(string_agg(entity || '|' || source_id || '|' || outcome || '|' || coalesce(field, ''), ',' order by entity, source_id), ''))
  from migrate.outcomes where batch_id = :'batch'`;
export const TARGET_COUNTS = `select jsonb_build_object(
  'office', (select count(*) from public.offices where tenant_id = :'tenant'), 'client', (select count(*) from public.clients where tenant_id = :'tenant'),
  'client_people', (select count(*) from public.client_people where tenant_id = :'tenant'), 'service', (select count(*) from public.catalog_services where tenant_id = :'tenant'),
  'tier', (select count(*) from public.catalog_tiers where tenant_id = :'tenant'), 'appointment_type', (select count(*) from public.appointment_types where tenant_id = :'tenant'),
  'lead', (select count(*) from public.leads where tenant_id = :'tenant'), 'handoff', (select count(*) from public.lead_handoffs where tenant_id = :'tenant'),
  'note', (select count(*) from public.notes where tenant_id = :'tenant'), 'activity', (select count(*) from public.activity where tenant_id = :'tenant'))`;
// Which outcome entities land in which target table (for the count comparison).
export const TABLE_OF = { office: 'office', client: 'client', client_owner: 'client_people', client_contact: 'client_people', service: 'service', tier: 'tier', tier_default: 'tier',
  appointment_type: 'appointment_type', lead: 'lead', handoff: 'handoff', client_note: 'note', lead_note: 'note', comment: 'note', lead_contact: 'note', lead_activity: 'activity' };
