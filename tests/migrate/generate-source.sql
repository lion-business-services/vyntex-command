-- TEST ONLY. Fills the throwaway copy of the NOVA schema with a generated, obviously fictional data set that has the
-- size and the shape the database audit describes (about 600 clients nearly all from Square and nearly all without an
-- office, 153 services of which 5 are the demo firm's, 244 price tiers, 11 appointment types, 2 staff, 1 office).
-- Every person and company here is made up: surnames such as "Ficticio" and "Inventado", the mail domains
-- correo-ficticio.invalid and equipo-ficticio.invalid (.invalid can never exist), telephone area code 555.
-- The demo firm's rows use the fixed ids of NOVA's own demo seed and the reserved sample values (example.com, 555-01xx)
-- because recognising them is exactly what is being tested.
-- This file is run by tests/migrate/run.mjs as the superuser of a local throwaway server. It is never run on NOVA.
begin;

-- The catalog that NOVA's schema file seeds is the firm's real price list. The test does not use it.
truncate public.service_variations, public.services cascade;
-- The audit records that the live table holds two pairs of services with the same name, which means the unique index
-- on the name was removed by hand there. The test source mirrors that.
drop index if exists public.services_name_unique;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'duena.ficticia@equipo-ficticio.invalid', '{"full_name": "Dueña Ficticia"}'),
  ('11111111-0000-0000-0000-000000000002', 'asociado.inventado@equipo-ficticio.invalid', '{"full_name": "Asociado Inventado"}');
insert into public.offices (id, name, code, address_line1, city, state, postal_code, phone)
  values ('22222222-0000-0000-0000-000000000001', 'Oficina Ficticia Principal', 'OFP', '1 Calle Inventada', 'Villa Ficticia', 'NJ', '00000', '(555) 300-0001');
update public.profiles set accepts_new_leads = (id = '11111111-0000-0000-0000-000000000002');

-- ---- services: 148 "from Square" and the 5 of the demo firm ----
insert into public.services (id, name, description, default_price_cents, unit, active, is_active, source, conversion_trigger, created_at)
select ('33333333-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid,
       case k when 147 then 'ITIN Application' when 148 then 'Payroll Service' else 'Servicio ficticio ' || lpad(k::text, 3, '0') end,
       case when k % 5 = 0 then 'Descripción inventada del servicio ' || k end, 0, 'each', k % 40 <> 0, true, 'square',
       (array['engagement', 'quick', 'manual'])[1 + k % 3], timestamptz '2024-02-01 12:00+00' + k * interval '1 minute'
from generate_series(1, 148) k;
insert into public.services (id, name, default_price_cents, unit, source, conversion_trigger, created_at) values
  ('33333333-9999-0000-0000-000000000001', 'Individual Tax Return (1040)', 35000, 'return', 'legacy', 'engagement', '2023-06-01 12:00+00'),
  ('33333333-9999-0000-0000-000000000002', 'ITIN Application', 25000, 'filing', 'legacy', 'quick', '2023-06-01 12:00+00'),
  ('33333333-9999-0000-0000-000000000003', 'Business Formation (LLC)', 75000, 'formation', 'legacy', 'engagement', '2023-06-01 12:00+00'),
  ('33333333-9999-0000-0000-000000000004', 'Monthly Bookkeeping', 45000, 'month', 'legacy', 'engagement', '2023-06-01 12:00+00'),
  ('33333333-9999-0000-0000-000000000005', 'Payroll Service', 27500, 'month', 'legacy', 'engagement', '2023-06-01 12:00+00');
-- 244 tiers: one per service, a second one for the first 96; 16 priced per engagement; 160 with a Square id
insert into public.service_variations (id, service_id, square_variation_id, name, price_cents, pricing_type, sku, created_at)
select ('44444444-0000-0000-0000-' || lpad(j::text, 12, '0'))::uuid,
       ('33333333-0000-0000-0000-' || lpad((1 + (j - 1) % 148)::text, 12, '0'))::uuid,
       case when j <= 160 then 'SQVARFICT' || lpad(j::text, 8, '0') end,
       case when j <= 148 then (array['Regular', 'Básico', 'Estándar'])[1 + j % 3] else (array['Premium', 'Exprés', 'Completo'])[1 + j % 3] end,
       case when j % 15 = 0 then 0 else (25 + (j * 37) % 1500) * 100 end,
       case when j % 15 = 0 then 'VARIABLE_PRICING' else 'FIXED_PRICING' end,
       case when j % 50 = 0 then 'FICT-SKU-' || j end, timestamptz '2024-02-01 13:00+00' + j * interval '1 minute'
from generate_series(1, 244) j;

-- ---- clients from Square: 596 ----
insert into public.clients (id, first_name, last_name, business_name, business_type, email, phone, address_line1, city, state, postal_code,
                            client_kind, client_type, lifecycle_stage, status, preferred_language, source, square_customer_id, needs_review,
                            source_created_at, source_updated_at, created_at, updated_at, client_since_date, notes, sms_opt_in, email_opt_in,
                            date_of_birth, office_id, assigned_to, whatsapp_phone, social_facebook_url, website)
select ('55555555-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       case when i % 97 = 0 then '虚构' else (array['José', 'María', 'Ángel', 'Zoë', 'Åsa', 'Ñuño', 'Lucía', 'Andrés', 'Inés', 'Raúl'])[1 + i % 10] end,
       case when i % 97 = 0 then '李' else (array['Ficticio', 'Inventado', 'Imaginario', 'Nadie', 'Quimera', 'Fabulado', 'Irreal', 'Supuesto', 'Ilusorio', 'Simulado', 'O''Inventado'])[1 + i % 11] end || ' ' || i,
       case when i % 100 < 28 then 'Empresa Ficticia ' || lpad(i::text, 3, '0') || (array[' LLC', ' Inc', ' Corp', ''])[1 + i % 4] end,
       case when i % 100 < 28 then (array['LLC', 'S Corp', 'C-Corp', 'Partnership', null, 'Sole proprietor', 'Restaurant'])[1 + i % 7] end,
       case when i % 17 = 0 then null else 'persona' || i || '@correo-ficticio.invalid' end,
       case when i % 11 = 0 then null else '(555) ' || (200 + i / 1000) || '-' || lpad((1000 + i)::text, 4, '0') end,
       case when i % 4 = 0 then i || ' Avenida Inventada' end, case when i % 4 = 0 then 'Villa Ficticia' end, case when i % 4 = 0 then 'NJ' end, case when i % 4 = 0 then '00000' end,
       (case when i % 100 < 28 then 'business' else 'individual' end)::public.client_kind,
       (case when i % 75 = 0 and i % 100 < 28 then 'wholesale' when i % 60 = 0 then 'vip' when i % 100 < 28 then 'business' else 'individual' end)::public.client_type,
       case when i % 10 < 3 then 'inactive_client' else 'active_client' end, 'active',
       case when i % 150 = 0 then 'zh' when i % 9 = 0 then 'en' else 'es' end, 'square', 'SQFICT' || lpad(i::text, 10, '0'), i % 190 = 0,
       timestamptz '2019-03-01 15:00+00' + i * interval '3 days 7 hours', timestamptz '2025-01-01 15:00+00' + i * interval '5 hours',
       timestamptz '2026-03-10 14:00+00' + i * interval '13 seconds', timestamptz '2026-03-11 14:00+00' + i * interval '13 seconds',
       case when i % 3 = 0 then date '2019-03-01' + i * 3 end,
       case when i % 8 = 0 then 'Nota ficticia del cliente ' || i || E'\ncon dos líneas, una coma, y "comillas"' end,
       i % 5 = 0, i % 13 <> 0, case when i % 6 = 0 and i % 100 >= 28 then date '1960-01-01' + i * 31 end,
       case when i in (5, 6) then '22222222-0000-0000-0000-000000000001'::uuid end,
       case when i % 45 = 0 then '11111111-0000-0000-0000-000000000002'::uuid when i % 20 = 0 then '11111111-0000-0000-0000-000000000001'::uuid end,
       case when i % 25 = 0 then '(555) 400-' || lpad(i::text, 4, '0') end,
       case when i % 50 = 0 then 'https://facebook.invalid/ficticio' || i end, case when i % 100 < 28 and i % 9 = 0 then 'https://empresa-ficticia-' || i || '.invalid' end
from generate_series(1, 596) i;

-- duplicates: same email (12; six with the same name, six with another name, like relatives who share an address),
-- same telephone (6), same name and address (4)
update public.clients d set email = upper(s.email),
       first_name = case when (right(d.id::text, 3)::int) % 2 = 0 then s.first_name else d.first_name end,
       last_name = case when (right(d.id::text, 3)::int) % 2 = 0 then s.last_name else d.last_name end, business_name = case when (right(d.id::text, 3)::int) % 2 = 0 then s.business_name else d.business_name end
  from public.clients s where right(d.id::text, 3)::int between 301 and 312 and d.id::text like '55555555-%' and s.id = ('55555555-0000-0000-0000-' || lpad((right(d.id::text, 3)::int - 300)::text, 12, '0'))::uuid;
update public.clients d set phone = '+1 ' || regexp_replace(s.phone, '[^0-9]', '', 'g'), email = 'otro' || right(d.id::text, 3) || '@correo-ficticio.invalid'
  from public.clients s where right(d.id::text, 3)::int between 323 and 328 and d.id::text like '55555555-%' and s.id = ('55555555-0000-0000-0000-' || lpad((right(d.id::text, 3)::int - 300)::text, 12, '0'))::uuid;
update public.clients d set first_name = s.first_name, last_name = s.last_name, business_name = s.business_name, client_kind = s.client_kind, client_type = s.client_type, email = null, phone = null,
       address_line1 = s.address_line1, city = s.city, state = s.state, postal_code = s.postal_code
  from (values (331, 4), (332, 8), (333, 12), (334, 16)) v(dup, orig), public.clients s
 where d.id = ('55555555-0000-0000-0000-' || lpad(v.dup::text, 12, '0'))::uuid and s.id = ('55555555-0000-0000-0000-' || lpad(v.orig::text, 12, '0'))::uuid;
-- addresses that cannot be mail addresses, records with no name at all, telephones that are not numbers
update public.clients set email = (array['sin-arroba.correo-ficticio.invalid', 'a@b', 'dos@@correo-ficticio.invalid', 'con espacio@correo-ficticio.invalid', '@correo-ficticio.invalid',
                                         'persona@', 'persona@correo-ficticio', 'pendiente', 'n/a'])[right(id::text, 3)::int - 400]
 where id::text like '55555555-%' and right(id::text, 3)::int between 401 and 409;
update public.clients set first_name = ' ', last_name = null, business_name = '', client_kind = 'individual', client_type = 'individual' where id::text like '55555555-%' and right(id::text, 3)::int between 411 and 413;
update public.clients set phone = (array['n/a', '12'])[right(id::text, 3)::int - 420] where id::text like '55555555-%' and right(id::text, 3)::int in (421, 422);
-- test markers on records that did come from Square
update public.clients set first_name = 'Test', last_name = 'Ficticio 431' where id = '55555555-0000-0000-0000-000000000431';
update public.clients set business_name = 'Prueba Demo LLC', client_kind = 'business', client_type = 'business' where id = '55555555-0000-0000-0000-000000000432';
update public.clients set email = 'alguien@example.com' where id = '55555555-0000-0000-0000-000000000433';

-- ---- not from Square: the demo firm's two clients (fixed ids of NOVA's demo seed), one more office client ----
insert into public.clients (id, first_name, last_name, email, phone, client_kind, client_type, lifecycle_stage, source, office_id, created_at, updated_at, notes) values
  ('dddddddd-2000-0000-0000-000000000001', 'Muestra', 'Individual', 'muestra.uno@example.com', '201-555-0101', 'individual', 'vip', 'active_client', 'manual', '22222222-0000-0000-0000-000000000001', '2025-11-01 12:00+00', '2025-11-01 12:00+00', 'Registro de muestra');
insert into public.clients (id, business_name, business_type, email, phone, client_kind, client_type, lifecycle_stage, source, office_id, created_at, updated_at, partner_terms) values
  ('dddddddd-2000-0000-0000-000000000002', 'Construcciones de Muestra LLC', 'LLC', 'oficina@construcciones-muestra.example', '201-555-0200', 'business', 'wholesale', 'active_client', 'manual', '22222222-0000-0000-0000-000000000001', '2025-11-01 12:00+00', '2025-11-01 12:00+00', 'Condiciones inventadas');
insert into public.clients (id, first_name, last_name, email, phone, client_kind, client_type, lifecycle_stage, source, office_id, created_at, updated_at, documents_folder_url) values
  ('66666666-0000-0000-0000-000000000001', 'Clienta', 'Inventada Manual', 'manual.uno@correo-ficticio.invalid', '(555) 250-0001', 'individual', 'individual', 'active_client', 'manual', '22222222-0000-0000-0000-000000000001', '2026-01-05 12:00+00', '2026-01-06 12:00+00', 'https://carpeta-ficticia.invalid/uno');

-- ---- leads: the one sample lead the audit names, and four more so every branch of the lead mapping is used ----
insert into public.clients (id, first_name, last_name, business_name, email, phone, client_kind, client_type, lifecycle_stage, lead_status, lead_source, lead_source_detail, status, source,
                            assigned_to, original_assigned_to, deal_value_cents, next_action, next_action_due, lost_reason, lost_at, last_contact_at, created_at, updated_at, converted_at, notes) values
  ('77777777-0000-0000-0000-000000000001', 'Prospecto', 'De Muestra', null, 'prospecto@example.com', '201-555-0150', 'individual', 'individual', 'lead', 'new', 'website', null, 'prospect', 'manual',
   '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', null, null, null, null, null, null, '2026-02-01 12:00+00', '2026-02-01 12:00+00', null, null),
  ('77777777-0000-0000-0000-000000000002', 'Prospecta', 'Imaginaria Uno', null, 'prospecta.uno@correo-ficticio.invalid', '(555) 260-0002', 'individual', 'individual', 'lead', 'contacted', 'referral', 'La recomendó un cliente inventado', 'prospect', 'web',
   '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 45000, 'Llamar otra vez', '2026-11-02', null, null, '2026-02-10 16:00+00', '2026-02-02 12:00+00', '2026-02-10 16:00+00', null, 'Nota ficticia de la prospecta'),
  ('77777777-0000-0000-0000-000000000003', null, null, 'Negocio Inventado Tres LLC', 'negocio.tres@correo-ficticio.invalid', '(555) 260-0003', 'business', 'business', 'lead', 'proposal_sent', 'Google', null, 'prospect', 'web',
   '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 120000, null, null, null, null, null, '2026-02-03 12:00+00', '2026-02-12 12:00+00', null, null),
  ('77777777-0000-0000-0000-000000000004', 'Prospecto', 'Irreal Cuatro', null, null, '(555) 260-0004', 'individual', 'individual', 'lead', 'lost', 'radio ad', null, 'prospect', 'manual',
   '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', null, null, null, 'Precio', '2026-02-20 18:00+00', '2026-02-15 18:00+00', '2026-02-04 12:00+00', '2026-02-20 18:00+00', null, null),
  ('77777777-0000-0000-0000-000000000005', 'Prospecta', 'Supuesta Cinco', null, 'prospecta.cinco@correo-ficticio.invalid', null, 'individual', 'individual', 'lead', 'new', null, null, 'prospect', 'manual',
   null, null, null, null, null, null, null, null, '2026-02-05 12:00+00', '2026-02-05 12:00+00', null, null);

insert into public.lead_assignments (id, client_id, from_user_id, to_user_id, assigned_by, reason, note, created_at) values
  ('88888888-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', null, '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'initial', null, '2026-02-01 12:00+00'),
  ('88888888-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', null, '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'initial', null, '2026-02-02 12:00+00'),
  ('88888888-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Vacaciones', 'Traspaso inventado', '2026-02-08 09:30+00'),
  ('88888888-0000-0000-0000-000000000004', '77777777-0000-0000-0000-000000000003', null, '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'initial', null, '2026-02-03 12:00+00'),
  ('88888888-0000-0000-0000-000000000005', '77777777-0000-0000-0000-000000000004', null, '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'initial', null, '2026-02-04 12:00+00'),
  ('88888888-0000-0000-0000-000000000006', '55555555-0000-0000-0000-000000000050', null, '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'initial', null, '2025-09-01 12:00+00'),
  ('88888888-0000-0000-0000-000000000007', '55555555-0000-0000-0000-000000000051', null, '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'initial', null, '2025-09-02 12:00+00');
insert into public.lead_activities (id, client_id, actor_user_id, activity_type, from_value, to_value, channel, note, created_at) values
  ('99999999-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'assignment', null, '11111111-0000-0000-0000-000000000001', null, null, '2026-02-01 12:00+00'),
  ('99999999-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'assignment', null, '11111111-0000-0000-0000-000000000002', null, null, '2026-02-02 12:00+00'),
  ('99999999-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'contact_attempt', null, null, 'call', 'Llamada inventada, sin respuesta', '2026-02-05 15:00+00'),
  ('99999999-0000-0000-0000-000000000004', '77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'stage_change', 'new', 'contacted', null, null, '2026-02-05 15:00+01'),
  ('99999999-0000-0000-0000-000000000005', '77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'note', null, null, null, 'Nota inventada del seguimiento', '2026-02-10 16:00+00'),
  ('99999999-0000-0000-0000-000000000006', '77777777-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'stage_change', 'contacted', 'proposal_sent', null, null, '2026-02-12 12:00+00'),
  ('99999999-0000-0000-0000-000000000007', '77777777-0000-0000-0000-000000000003', null, 'contact_attempt', null, null, 'whatsapp', null, '2026-02-11 12:00+00'),
  ('99999999-0000-0000-0000-000000000008', '77777777-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'stage_change', 'negotiating', 'lost', null, 'Precio', '2026-02-20 18:00+00'),
  ('99999999-0000-0000-0000-000000000009', '77777777-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'lost', null, null, null, 'Precio', '2026-02-20 18:00+00'),
  ('99999999-0000-0000-0000-000000000010', '55555555-0000-0000-0000-000000000050', '11111111-0000-0000-0000-000000000001', 'stage_change', 'negotiating', 'won', null, null, '2025-09-10 12:00+00'),
  ('99999999-0000-0000-0000-000000000011', '55555555-0000-0000-0000-000000000050', '11111111-0000-0000-0000-000000000001', 'conversion', 'lead', 'active_client', null, null, '2025-09-10 12:05+00'),
  ('99999999-0000-0000-0000-000000000012', '55555555-0000-0000-0000-000000000051', '11111111-0000-0000-0000-000000000001', 'conversion', 'lead', 'active_client', null, null, '2025-09-12 12:05+00');

-- ---- owners of some businesses, staff comments ----
insert into public.client_owners (id, client_id, full_name, title, phone, email, is_primary, created_at, updated_at)
select ('aaaaaaaa-1111-0000-0000-' || lpad((i * 10 + n)::text, 12, '0'))::uuid, c.id,
       (array['Dueño', 'Socia'])[n] || ' Inventado ' || i, (array['Propietario', 'Socia'])[n], '(555) 270-' || lpad((i * 2 + n)::text, 4, '0'),
       'socio' || i || '.' || n || '@correo-ficticio.invalid', n = 1, c.created_at, c.created_at
from generate_series(1, 596) i join public.clients c on c.id = ('55555555-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
cross join generate_series(1, 2) n
where i % 100 < 28 and i % 7 = 0 and (n = 1 or i % 14 = 0);
insert into public.client_owners (id, client_id, full_name, is_primary) values ('aaaaaaaa-1111-9999-0000-000000000001', 'dddddddd-2000-0000-0000-000000000002', 'Dueño De Muestra', true);
insert into public.client_comments (id, client_id, author_id, body, created_at, updated_at)
select ('bbbbbbbb-1111-0000-0000-' || lpad(i::text, 12, '0'))::uuid, ('55555555-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       case when i % 40 = 1 then '11111111-0000-0000-0000-000000000002'::uuid else '11111111-0000-0000-0000-000000000001'::uuid end,
       'Comentario ficticio número ' || i || ': el cliente trajo sus documentos inventados.', timestamptz '2026-04-01 13:00+00' + i * interval '1 hour', timestamptz '2026-04-01 13:00+00' + i * interval '1 hour'
from generate_series(1, 596) i where i % 20 = 1;

-- ---- invoices and payments: the demo firm's (6 and 4), and a few on other clients so the "ask the owner" path is used ----
insert into public.invoices (id, client_id, number, status, amount_cents, issued_at, created_at)
select ('cccccccc-1111-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       case when n <= 6 then (array['dddddddd-2000-0000-0000-000000000001', 'dddddddd-2000-0000-0000-000000000002'])[1 + n % 2]::uuid else ('55555555-0000-0000-0000-' || lpad((n * 10)::text, 12, '0'))::uuid end,
       'FICT-INV-' || lpad(n::text, 4, '0'), (case when n % 2 = 0 then 'paid' else 'sent' end)::public.invoice_status, n * 10000, timestamptz '2026-01-15 12:00+00' + n * interval '1 day', timestamptz '2026-01-15 12:00+00' + n * interval '1 day'
from generate_series(1, 8) n;
insert into public.payments (id, client_id, invoice_id, amount_cents, method, reference, paid_at, created_at)
select ('cccccccc-2222-0000-0000-' || lpad(n::text, 12, '0'))::uuid, i.client_id, i.id, i.amount_cents, 'check', 'FICT-CHK-' || n, i.issued_at + interval '3 days', i.issued_at + interval '3 days'
from generate_series(1, 8) n join public.invoices i on i.id = ('cccccccc-1111-0000-0000-' || lpad(n::text, 12, '0'))::uuid where n in (2, 4, 6, 1, 8);

-- ---- rows in tables that are counted and not carried ----
insert into public.tickets (client_id, subject) values ('dddddddd-2000-0000-0000-000000000001', 'Solicitud de muestra 1'), ('dddddddd-2000-0000-0000-000000000002', 'Solicitud de muestra 2'), ('55555555-0000-0000-0000-000000000010', 'Solicitud ficticia');
insert into public.client_services (client_id, service_id, price_cents) select 'dddddddd-2000-0000-0000-000000000001', id, default_price_cents from public.services where source = 'legacy';
commit;
analyze;
