-- Module tests, part 2: the module collections through the gateway (ws_apply, ws_load), and the office scope.
-- Company N (field edition) for the gateway cases, company M (practice) for the office scope: there a senior
-- associate does not see every client, so the scope has someone to hide things from.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('32. module gateway') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- Every module collection loads in the shape of types.ts, with the sample rows
-- ---------------------------------------------------------------------------------------------------------------------
select test.load('n_owner', 'n') as lo \gset
select test.load('n_staff', 'n') as ls \gset
select test.load('n_readonly', 'n') as lr \gset
select test.load('n_w1', 'n') as lw \gset
do $$
declare
  lo jsonb := test.load('n_owner', 'n'); k text; want int;
begin
  for k, want in select * from (values ('offices', 2), ('grants', 1), ('accessRequests', 2), ('catalog', 2), ('playbooks', 1), ('apptTypes', 2), ('appointments', 3),
      ('credits', 3), ('crossSell', 1), ('opportunities', 2), ('reviews', 2), ('templates', 1), ('envelopes', 2), ('posts', 2), ('cash', 4), ('cashCloses', 1),
      ('complianceItems', 2), ('rules', 2), ('reveals', 2), ('secureLog', 6), ('connections', 0)) v(k, n) loop
    perform test.is(jsonb_array_length(lo -> k)::text, want::text, format('ws_load: the owner gets the %s sample rows of "%s"', want, k));
  end loop;
end $$;
select test.ok((select bool_and(jsonb_typeof(:'lw'::jsonb -> k) = 'array' and jsonb_array_length(:'lw'::jsonb -> k) = 0)
                from unnest(array['offices', 'grants', 'accessRequests', 'catalog', 'playbooks', 'apptTypes', 'appointments', 'credits', 'crossSell', 'opportunities',
                                  'reviews', 'templates', 'envelopes', 'posts', 'cash', 'cashCloses', 'complianceItems', 'rules', 'reveals', 'secureLog']) k),
  'ws_load: a field worker gets every module list empty') \g /dev/null
select test.ok(jsonb_array_length(:'ls'::jsonb -> 'cash') = 0 and jsonb_array_length(:'ls'::jsonb -> 'cashCloses') = 0 and jsonb_array_length(:'ls'::jsonb -> 'rules') = 0
           and jsonb_array_length(:'ls'::jsonb -> 'posts') = 0 and jsonb_array_length(:'ls'::jsonb -> 'secureLog') = 0 and jsonb_array_length(:'ls'::jsonb -> 'reveals') = 0
           and jsonb_array_length(:'ls'::jsonb -> 'appointments') = 3 and jsonb_array_length(:'ls'::jsonb -> 'catalog') = 2 and jsonb_array_length(:'ls'::jsonb -> 'grants') = 1
           and jsonb_array_length(:'ls'::jsonb -> 'accessRequests') = 1,
  'ws_load: office staff of a field edition get no cash, rules, posts or access log; their own grant and request; appointments and the catalog') \g /dev/null
select test.ok(:'lr'::jsonb -> 'appointments' = :'ls'::jsonb -> 'appointments' and :'lr'::jsonb -> 'catalog' = :'ls'::jsonb -> 'catalog' and :'lr'::jsonb -> 'envelopes' = :'ls'::jsonb -> 'envelopes',
  'ws_load: the read-only role reads what staff read') \g /dev/null

-- the shapes, field by field, on the sample rows
select test.ok((select o ->> 'name' = 'Main office n' and o ->> 'address' = '1 Sample Street' and (o -> 'main')::text = 'true' and o ->> 'timezone' = 'America/New_York' and o ? 'updatedAt'
                from jsonb_array_elements(:'lo'::jsonb -> 'offices') o where o ->> 'id' = test.id('n.o1')::text)
           and (select not o ? 'main' and not o ? 'phone' from jsonb_array_elements(:'lo'::jsonb -> 'offices') o where o ->> 'id' = test.id('n.o2')::text),
  'offices: Office, and a flag that is off is left out') \g /dev/null
select test.ok((select s ->> 'name' = 'Sample service n' and s ->> 'category' = 'sample' and s ->> 'repeat' = 'yearly' and s ->> 'playbookId' = test.id('n.pb1')::text
                   and s -> 'docKinds' = '["engagement_letter"]' and s ->> 'appointmentTypeId' = test.id('n.at1')::text and s -> 'externalIds' ->> 'square' = 'sq-n-1'
                   and s -> 'i18n' -> 'es' ->> 'name' = 'Servicio de muestra' and (s -> 'active')::text = 'true'
                   and jsonb_array_length(s -> 'tiers') = 2 and s -> 'tiers' -> 0 ->> 'name' = 'Standard' and (s -> 'tiers' -> 0 ->> 'price')::numeric = 180
                   and s -> 'tiers' -> 1 ->> 'unit' = 'month' and (s -> 'tiers' -> 1 ->> 'price')::numeric = 95.50 and s -> 'tiers' -> 1 ->> 'note' = 'Billed on the first'
                from jsonb_array_elements(:'lo'::jsonb -> 'catalog') s where s ->> 'id' = test.id('n.s1')::text),
  'catalog: CatalogService with its price tiers nested, in order') \g /dev/null
select test.ok((select p ->> 'name' = 'Onboarding n' and jsonb_array_length(p -> 'steps') = 2 and p -> 'steps' -> 0 -> 'title' ->> 'en' = 'Welcome call'
                   and p -> 'steps' -> 0 ->> 'for' = 'manager' and (p -> 'steps' -> 1 ->> 'dueIn')::int = 2 and p -> 'steps' -> 1 ->> 'type' = 'todo'
                from jsonb_array_elements(:'lo'::jsonb -> 'playbooks') p),
  'playbooks: Playbook with its steps nested, in order') \g /dev/null
select test.ok((select a ->> 'typeId' = test.id('n.at1')::text and a ->> 'clientId' = test.id('n.c1')::text and a ->> 'staffId' = test.id('n.m_staff')::text and a ->> 'time' = '10:00'
                   and a ->> 'date' = (current_date + 7)::text and (a ->> 'minutes')::int = 30 and a ->> 'status' = 'scheduled' and (a ->> 'fee')::numeric = 0
                   and a ->> 'createdBy' = test.id('n.m_staff')::text and not a ? 'paid' and a ->> 'officeId' = test.id('n.o1')::text
                from jsonb_array_elements(:'lo'::jsonb -> 'appointments') a where a ->> 'id' = test.id('n.ap1')::text)
           and (select a -> 'paid' ->> 'method' = 'credit' and (a -> 'paid' ->> 'amount')::numeric = 75 and a ->> 'creditId' = test.id('n.cr_used')::text
                   and a ->> 'rescheduledFrom' = test.id('n.ap2')::text and a -> 'externalIds' ->> 'gcal' = 'sample'
                from jsonb_array_elements(:'lo'::jsonb -> 'appointments') a where a ->> 'id' = test.id('n.ap3')::text),
  'appointments: Appointment, with the payment as { at, method, ref, amount } and the time as HH:MM') \g /dev/null
select test.ok((select c -> 'used' ->> 'apptId' = test.id('n.ap3')::text and c -> 'used' ? 'at' and not c ? 'void' and c ->> 'reason' = 'cancel_staff' and (c ->> 'amount')::numeric = 75
                   and c ->> 'fromApptId' = test.id('n.ap2')::text and c ->> 'by' = test.id('n.m_manager')::text
                from jsonb_array_elements(:'lo'::jsonb -> 'credits') c where c ->> 'id' = test.id('n.cr_used')::text)
           and (select c -> 'void' ->> 'reason' = 'Entered twice' and c -> 'void' ->> 'by' = test.id('n.m_owner')::text and not c ? 'used' and c ->> 'expires' = (current_date + 30)::text
                   and (c ->> 'amount')::numeric = 20.50
                from jsonb_array_elements(:'lo'::jsonb -> 'credits') c where c ->> 'id' = test.id('n.cr_void')::text),
  'credits: Credit, with "used" and "void" as small objects') \g /dev/null
select test.ok((select e ->> 'docId' = test.id('n.d1')::text and e ->> 'status' = 'completed' and (e -> 'demo')::text = 'true' and jsonb_array_length(e -> 'events') = 2
                   and jsonb_array_length(e -> 'signers') = 1 and e -> 'signers' -> 0 ->> 'status' = 'signed' and (e -> 'signers' -> 0 ->> 'order')::int = 1
                   and jsonb_array_length(e -> 'fields') = 1 and e -> 'fields' -> 0 ->> 'signerId' = e -> 'signers' -> 0 ->> 'id' and (e -> 'fields' -> 0 ->> 'x')::numeric = 0.1
                   and e -> 'fields' -> 0 ->> 'value' = 'signed' and e ->> 'createdBy' = test.id('n.m_staff')::text
                from jsonb_array_elements(:'lo'::jsonb -> 'envelopes') e where e ->> 'id' = test.id('n.env_demo')::text)
           and (select not e ? 'demo' and (e -> 'ordered')::text = 'true' and (e ->> 'remindEvery')::int = 3
                from jsonb_array_elements(:'lo'::jsonb -> 'envelopes') e where e ->> 'id' = test.id('n.env_draft')::text),
  'envelopes: Envelope with signers, boxes and events') \g /dev/null
select test.ok((select t ->> 'kind' = 'engagement_letter' and (t -> 'approved')::text = 'true' and t ->> 'approvedBy' = test.id('n.m_owner')::text and t ? 'approvedAt'
                   and jsonb_array_length(t -> 'blocks') = 3 and t -> 'blocks' -> 0 ->> 'type' = 'h' and t -> 'blocks' -> 2 ->> 'type' = 'sign'
                from jsonb_array_elements(:'lo'::jsonb -> 'templates') t),
  'templates: DocTemplate with its blocks, in order') \g /dev/null
select test.ok((select (e ->> 'amount')::numeric = 200 and e ->> 'dir' = 'in' and e ->> 'closeId' = test.id('n.close')::text and e ->> 'by' = test.id('n.m_owner')::text
                from jsonb_array_elements(:'lo'::jsonb -> 'cash') e where e ->> 'id' = test.id('n.cash_closed')::text)
           and (select (c ->> 'expected')::numeric = 181.55 and (c ->> 'counted')::numeric = 180.05 and (c ->> 'diff')::numeric = -1.50 and c ->> 'approvedBy' = test.id('n.m_owner')::text
                   and c ->> 'officeId' = test.id('n.o1')::text and c ->> 'date' = (current_date - 3)::text
                from jsonb_array_elements(:'lo'::jsonb -> 'cashCloses') c),
  'cash and cashCloses: CashEntry and CashClose, to the cent') \g /dev/null
select test.ok((select r ->> 'id' = 'lead-intake' and r -> 'when' ->> 'event' = 'lead.created' and r -> 'if' = '[]' and r -> 'then' -> 0 ->> 'do' = 'builtin' and (r -> 'shipped')::text = 'true'
                from jsonb_array_elements(:'lo'::jsonb -> 'rules') r where r ->> 'id' = 'lead-intake')
           and (select (r -> 'when' ->> 'days')::int = 5 and r -> 'if' -> 1 ->> 'op' = 'gt' and (r -> 'active')::text = 'false' and r -> 'about' ->> 'es' = 'Avisa al responsable'
                from jsonb_array_elements(:'lo'::jsonb -> 'rules') r where r ->> 'id' <> 'lead-intake'),
  'rules: RuleDef keyed by its own id, with when, if and then') \g /dev/null
select test.ok((select o ->> 'by' = 'automation' and o ->> 'ruleId' = test.id('n.cs')::text and (o ->> 'value')::numeric = 120
                from jsonb_array_elements(:'lo'::jsonb -> 'opportunities') o where o ->> 'id' = test.id('n.opp')::text)
           and (select r ->> 'status' = 'rated' and (r ->> 'rating')::int = 5 and r ->> 'by' = test.id('n.m_staff')::text
                from jsonb_array_elements(:'lo'::jsonb -> 'reviews') r where r ->> 'id' = test.id('n.review_rated')::text)
           and (select p -> 'channels' = '["instagram"]' and p ->> 'approvedBy' = test.id('n.m_owner')::text and p ? 'publishedAt' and jsonb_array_length(p -> 'media') = 1
                from jsonb_array_elements(:'lo'::jsonb -> 'posts') p where p ->> 'id' = test.id('n.post_published')::text)
           and (select c -> 'whenServiceIds' = jsonb_build_array(test.id('n.s1')) and c ->> 'clientKind' = 'business' and (c ->> 'delayDays')::int = 14
                from jsonb_array_elements(:'lo'::jsonb -> 'crossSell') c)
           and (select d ->> 'assignee' = test.id('n.m_staff')::text and d -> 'remind' = '[30, 7]' and d ->> 'kind' = 'filing'
                from jsonb_array_elements(:'lo'::jsonb -> 'complianceItems') d where d ->> 'id' = test.id('n.deadline')::text),
  'opportunities, reviews, posts, crossSell and complianceItems in their shapes') \g /dev/null
select test.ok((select r ->> 'status' = 'used' and r ->> 'requestedBy' = test.id('n.m_manager')::text and r ->> 'approverId' = test.id('n.m_owner')::text and r ? 'expiresAt' and r ->> 'field' = 'tax_id'
                from jsonb_array_elements(:'lo'::jsonb -> 'reveals') r where r ->> 'id' = test.id('n.rv_used')::text)
           and (select bool_or(l ->> 'userId' = 'system' and l ->> 'action' = 'expire') and bool_or(l ->> 'action' = 'reveal' and l ->> 'requestId' = test.id('n.rv_used')::text)
                from jsonb_array_elements(:'lo'::jsonb -> 'secureLog') l)
           and (select g ->> 'userId' = test.id('n.m_staff')::text and g ->> 'grantedBy' = test.id('n.m_owner')::text and g ->> 'expires' = (current_date + 30)::text
                from jsonb_array_elements(:'lo'::jsonb -> 'grants') g),
  'reveals, secureLog (with "system" for what the database did itself) and grants in their shapes') \g /dev/null
select test.ok(:'lo' !~ '900700001' and :'lo' !~ 'tax_id_enc', 'ws_load of the owner holds no tax ID in any module list') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- ws_apply: every writable module collection takes a new row from the owner; fields without a column are kept
-- ---------------------------------------------------------------------------------------------------------------------
select test.apply('n_owner', 'n', jsonb_build_array(
  test.op('offices', test.u(3001), '{"name":"Third office","address":"","phone":"609-555-0177","color":"teal"}'),
  test.op('playbooks', test.u(3002), jsonb_build_object('name', 'Year end', 'active', true, 'welcomeI18n', '{"es":"Bienvenido"}'::jsonb,
    'steps', jsonb_build_array(jsonb_build_object('id', test.u(3003), 'title', '{"en":"First","es":"Primero"}'::jsonb, 'dueIn', 1, 'for', 'owner'),
                               jsonb_build_object('id', test.u(3004), 'title', '{"en":"Second","es":"Segundo"}'::jsonb, 'dueIn', 3, 'for', 'assignee', 'pri', 'high')))),
  -- the service names an appointment type that arrives in the same request, and that type names the service back
  test.op('catalog', test.u(3005), jsonb_build_object('name', 'Quarterly filing', 'category', 'tax', 'active', true, 'repeat', 'quarterly', 'playbookId', test.u(3002),
    'appointmentTypeId', test.u(3008), 'code', 'QF-1', 'internalNote', 'For the team only',
    'tiers', jsonb_build_array(jsonb_build_object('id', test.u(3006), 'name', 'Standard', 'price', 75.25, 'unit', 'quarter'),
                               jsonb_build_object('id', test.u(3007), 'name', 'Rush', 'price', 120, 'unit', 'flat', 'note', 'Within two days')))),
  test.op('apptTypes', test.u(3008), jsonb_build_object('name', '{"en":"Filing review","es":"Revisión de declaración"}'::jsonb, 'minutes', 40, 'fee', 60, 'prepay', true,
    'mode', 'office', 'buffer', 20, 'active', true, 'serviceId', test.u(3005))),
  test.op('appointments', test.u(3009), jsonb_build_object('typeId', test.u(3008), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_staff'), 'officeId', test.u(3001),
    'date', (current_date + 20)::text, 'time', '13:30', 'minutes', 40, 'mode', 'office', 'status', 'awaiting_payment', 'fee', 60, 'payBy', '2031-01-01T10:00:00.000Z',
    'created', '2030-12-01T09:00:00.000Z', 'createdBy', test.id('n.m_manager'), 'notes', 'Bring the notice', 'color', 'amber',
    -- none of these three is a person's to write
    'paid', jsonb_build_object('at', '2030-12-01T09:00:00.000Z', 'method', 'cash', 'ref', 'forged', 'amount', 60), 'creditId', test.id('n.cr_open'), 'meetUrl', 'https://meet.example.com/x')),
  test.op('crossSell', test.u(3010), jsonb_build_object('name', 'Filing to bookkeeping', 'whenServiceIds', jsonb_build_array(test.u(3005)), 'suggestServiceId', test.id('n.s1'), 'active', true)),
  test.op('opportunities', test.u(3011), jsonb_build_object('clientId', test.id('n.c1'), 'serviceId', test.u(3005), 'ruleId', test.u(3010), 'status', 'open', 'created', current_date::text,
    'by', test.id('n.m_staff'), 'value', 75.25, 'followUp', (current_date + 3)::text)),
  test.op('reviews', test.u(3012), jsonb_build_object('clientId', test.id('n.c1'), 'jobId', test.id('n.j1'), 'at', '2030-12-01T09:00:00.000Z', 'channel', 'email', 'status', 'draft', 'by', 'automation')),
  test.op('complianceItems', test.u(3013), jsonb_build_object('title', 'Renewal (sample)', 'kind', 'renewal', 'clientId', test.id('n.c1'), 'due', (current_date + 90)::text, 'status', 'open',
    'assignee', test.id('n.m_manager'), 'remind', '[30, 7]'::jsonb, 'anchor', 31)),
  test.op('templates', test.u(3014), jsonb_build_object('kind', 'service_agreement', 'name', 'Service agreement', 'lang', 'es', 'source', 'starter', 'approved', true,
    'approvedBy', test.id('n.m_staff'), 'approvedAt', '2001-01-01T00:00:00.000Z', 'active', true,
    'blocks', jsonb_build_array(jsonb_build_object('id', test.u(3015), 'type', 'h', 'text', 'Acuerdo'), jsonb_build_object('id', test.u(3016), 'type', 'p', 'text', '')))),
  test.op('envelopes', test.u(3017), jsonb_build_object('docId', test.id('n.d1'), 'title', 'New request', 'status', 'draft', 'ordered', true, 'created', '2030-12-01T09:00:00.000Z',
    'createdBy', test.id('n.m_staff'), 'events', '[{"at":"2030-12-01T09:00:00.000Z","kind":"created"}]'::jsonb, 'message', 'Please sign',
    -- the boxes come before the signers in the row, and still point at them
    'fields', jsonb_build_array(jsonb_build_object('id', test.u(3020), 'signerId', test.u(3018), 'type', 'signature', 'page', 1, 'x', 0.25, 'y', 0.5, 'w', 0.3, 'h', 0.06, 'required', true),
                                jsonb_build_object('id', test.u(3021), 'signerId', test.u(3019), 'type', 'date', 'page', 2, 'x', 0.125, 'y', 0.75, 'w', 0.2, 'h', 0.04, 'required', false, 'label', 'Date')),
    'signers', jsonb_build_array(jsonb_build_object('id', test.u(3018), 'name', 'First Signer', 'email', 'first@example.com', 'order', 1, 'status', 'waiting', 'role', 'client'),
                                 jsonb_build_object('id', test.u(3019), 'name', 'Second Signer', 'email', 'second@example.com', 'order', 2, 'status', 'waiting')))),
  test.op('cash', test.u(3022), jsonb_build_object('date', current_date::text, 'officeId', test.id('n.o1'), 'dir', 'out', 'amount', 12.34, 'category', 'supplies', 'memo', 'Pens',
    'by', test.id('n.m_staff'), 'closeId', test.id('n.close'))),
  test.op('rules', test.u(3023), jsonb_build_object('name', '{"en":"Paid appointment","es":"Cita pagada"}'::jsonb, 'active', true, 'when', '{"event":"appointment.paid"}'::jsonb,
    'if', '[{"field":"appointment.fee","op":"gt","value":50}]'::jsonb, 'then', '[{"do":"task","params":{"title":"Prepare the file","dueIn":2}}]'::jsonb)),
  test.op('posts', test.u(3024), jsonb_build_object('text', 'Open on Saturday', 'channels', '["facebook"]'::jsonb, 'status', 'needs_approval', 'by', test.id('n.m_staff'), 'created', '2030-12-01T09:00:00.000Z'))
), 'mod-key-3000') as w1 \gset
select test.is(:'w1'::jsonb ->> 'applied' || '/' || jsonb_array_length(:'w1'::jsonb -> 'rejected'), '14/0',
  'the owner writes one new row into each of the 14 writable module collections in one request, whatever their order') \g /dev/null
select test.ok((select extra = '{"color":"teal"}' and address = '' from public.offices where id = test.u(3001))
           and (select extra = '{"code":"QF-1","internalNote":"For the team only"}' and appointment_type_id = test.u(3008) and playbook_id = test.u(3002) from public.catalog_services where id = test.u(3005))
           and (select extra ->> 'welcomeI18n' is not null from public.playbooks where id = test.u(3002))
           and (select extra = jsonb_build_object('followUp', (current_date + 3)::text) from public.opportunities where id = test.u(3011))
           and (select extra = '{"anchor":31}' and assignee_member_id = test.id('n.m_manager') and remind = array[30, 7] from public.compliance_items where id = test.u(3013))
           and (select extra = '{"message":"Please sign"}' from public.envelopes where id = test.u(3017)),
  'a field that has no column is kept in "extra" (a service code, an internal note, a follow-up day, a message to the signers)') \g /dev/null
select test.ok((select string_agg(name || ':' || price || ':' || position, ',' order by position) = 'Standard:75.25:1,Rush:120.00:2' from public.catalog_tiers where service_id = test.u(3005))
           and (select string_agg(for_role || due_in, ',' order by position) = 'owner1,assignee3' from public.playbook_steps where playbook_id = test.u(3002))
           and (select service_id = test.u(3005) and buffer = 20 and fee = 60.00 from public.appointment_types where id = test.u(3008)),
  'nested lists are stored in order, and the service and its appointment type point at each other') \g /dev/null
select test.ok((select paid_at is null and paid_amount is null and credit_id is null and meet_url is null and created_by = test.id('n.m_owner') and created_by_kind = 'member'
                   and status = 'awaiting_payment' and start_time = time '13:30' and extra = '{"color":"amber"}' from public.appointments where id = test.u(3009)),
  'appointments: the payment, the credit and the video link a person sent are ignored, and the row is booked in the name of the person signed in') \g /dev/null
select test.ok((select count(*) = 2 from public.envelope_signers where envelope_id = test.u(3017))
           and (select string_agg(signer_id::text, ',' order by position) = test.u(3018) || ',' || test.u(3019) from public.envelope_fields where envelope_id = test.u(3017))
           and (select client_id = test.id('n.c1') and created_by = test.id('n.m_owner') from public.envelopes where id = test.u(3017)),
  'envelopes: signers are stored before the boxes that point at them, the request follows its document''s client, and it is created by the person signed in') \g /dev/null
select test.ok((select approved and approved_by = test.id('n.m_owner') and approved_at > now() - interval '1 minute' from public.doc_templates where id = test.u(3014)),
  'templates: who approved the wording and when is the session''s word, not the row''s') \g /dev/null
select test.ok((select close_id is null and by_member_id = test.id('n.m_owner') and amount = 12.34 from public.cash_entries where id = test.u(3022))
           and (select by_kind = 'member' and by_member_id = test.id('n.m_owner') from public.opportunities where id = test.u(3011))
           and (select by_kind = 'automation' and by_member_id is null from public.review_requests where id = test.u(3012))
           and (select by_member_id = test.id('n.m_owner') and status = 'needs_approval' from public.social_posts where id = test.u(3024)),
  'cash, opportunities, reviews and posts are written in the name of the person signed in ("automation" stays automation); a close id a person sent is ignored') \g /dev/null
select test.ok((select rule_id = test.u(3023)::text and event = 'appointment.paid' and conditions -> 0 ->> 'op' = 'gt' and steps -> 0 -> 'params' ->> 'title' = 'Prepare the file' from public.rules where rule_id = test.u(3023)::text),
  'rules: a rule the company adds is stored under its own id, with its event, conditions and steps') \g /dev/null
select test.ok(:'w1'::jsonb -> 'server' ? 'appointments' and :'w1'::jsonb -> 'server' ? 'templates' and :'w1'::jsonb -> 'server' ? 'cash' and not :'w1'::jsonb -> 'server' ? 'offices'
           and :'w1'::jsonb -> 'versions' -> 'rules' ? test.u(3023)::text,
  '"server" in the answer returns the rows the database stored differently from what was sent, and "versions" the new version of each row') \g /dev/null
select test.is((test.apply('n_owner', 'n', '[]'::jsonb || jsonb_build_array(test.op('offices', test.u(3001), '{"name":"Third office","address":"","phone":"609-555-0177","color":"teal"}')), 'mod-key-3000b')) ->> 'applied', '1',
  'sending a row again unchanged is accepted and changes nothing') \g /dev/null
select test.ok((select count(*) = 1 from public.offices where id = test.u(3001)), 'and makes no second row') \g /dev/null

-- an edit, with the stale check; then nested lists: one element changed, one removed, one added
select test.row_of(test.load('n_owner', 'n'), 'catalog', test.u(3005)) as svc \gset
select test.apply('n_owner', 'n', jsonb_build_array(test.op('catalog', test.u(3005), (:'svc'::jsonb - 'tiers') || jsonb_build_object('description', 'Filed every quarter',
  'tiers', jsonb_build_array(jsonb_build_object('id', test.u(3007), 'name', 'Rush', 'price', 130, 'unit', 'flat'), jsonb_build_object('id', test.u(3025), 'name', 'Yearly', 'price', 280, 'unit', 'year')))))) as w2 \gset
select test.ok((:'w2'::jsonb ->> 'ok')::boolean and (select string_agg(name || ':' || price, ',' order by position) = 'Rush:130.00,Yearly:280.00' from public.catalog_tiers where service_id = test.u(3005))
           and (select description = 'Filed every quarter' from public.catalog_services where id = test.u(3005)),
  'catalog: an edit changes a tier, removes one and adds one, in one row') \g /dev/null
select test.is(test.reason(test.apply('n_owner', 'n', jsonb_build_array(test.op('catalog', test.u(3005), :'svc'::jsonb || '{"name":"Stale write"}'))), test.u(3005)::text), 'stale',
  'catalog: a copy of the row from before that edit is refused as stale') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('n') and table_name = 'catalog_tiers' and action = 'update' and actor = test.id('n_owner') and (old_data ->> 'price')::numeric = 120 and (new_data ->> 'price')::numeric = 130),
  'a price change is in the audit log with who made it, the old price and the new one') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- ws_apply: refusals
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  r jsonb; c text; who text; want text;
begin
  -- staff of a field edition: appointments yes; catalog, apptTypes, templates and offices are configuration; cash, rules and posts are not theirs at all
  r := test.apply('n_staff', 'n', jsonb_build_array(
    test.op('appointments', test.u(3101), jsonb_build_object('typeId', test.id('n.at1'), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_manager'), 'date', (current_date + 21)::text,
      'time', '09:00', 'minutes', 30, 'mode', 'phone', 'status', 'scheduled', 'fee', 0, 'created', '2030-12-01T09:00:00.000Z', 'createdBy', test.id('n.m_owner'))),
    test.op('catalog', test.u(3102), '{"name":"Staff service","category":"","active":true,"tiers":[]}'),
    test.op('apptTypes', test.u(3103), '{"name":{"en":"Staff type","es":"Tipo"},"minutes":30,"fee":0,"prepay":false,"mode":"phone","active":true}'),
    test.op('offices', test.u(3104), '{"name":"Staff office","address":""}'),
    test.op('templates', test.u(3105), '{"kind":"custom","name":"Staff template","lang":"en","source":"company","approved":false,"active":true,"blocks":[]}'),
    test.op('cash', test.u(3106), jsonb_build_object('date', current_date::text, 'dir', 'in', 'amount', 5, 'category', 'other', 'memo', '', 'by', test.id('n.m_staff'))),
    test.op('rules', test.u(3107), '{"name":{"en":"Staff rule","es":"Regla"},"active":true,"when":{"event":"daily"},"if":[],"then":[]}'),
    test.op('posts', test.u(3108), '{"text":"Staff post","channels":[],"status":"draft","by":"x","created":"2030-12-01T09:00:00.000Z"}'),
    test.op('crossSell', test.u(3109), jsonb_build_object('name', 'Staff rule', 'whenServiceIds', '[]'::jsonb, 'suggestServiceId', test.id('n.s1'), 'active', true)),
    test.op('opportunities', test.u(3110), jsonb_build_object('clientId', test.id('n.c1'), 'serviceId', test.id('n.s1'), 'status', 'dismissed', 'created', current_date::text, 'by', 'x')),
    test.del('appointments', test.id('n.ap1'))));
  perform test.is(test.reason(r, test.u(3101)::text) || '/' || test.reason(r, test.u(3110)::text), 'applied/applied', 'staff of a field edition books an appointment and records an opportunity');
  for c, want in select * from (values ('3102', 'forbidden'), ('3103', 'forbidden'), ('3104', 'forbidden'), ('3105', 'forbidden'), ('3106', 'forbidden'), ('3107', 'forbidden'),
                                       ('3108', 'forbidden'), ('3109', 'forbidden')) v(c, w) loop
    perform test.is(test.reason(r, test.u(c::int)::text), want, format('staff of a field edition cannot write %s', (select o ->> 'c' from jsonb_array_elements(r -> 'rejected') o where o ->> 'id' = test.u(c::int)::text)));
  end loop;
  perform test.is(test.reason(r, test.id('n.ap1')::text) || ':' || test.detail(r, test.id('n.ap1')::text), 'forbidden:delete', 'nor delete an appointment: that needs "delete"');
  perform test.ok((select created_by = test.id('n.m_staff') from public.appointments where id = test.u(3101)), 'the appointment staff booked carries staff as the person who booked it');

  -- the read-only role writes nothing, anywhere
  r := test.apply('n_readonly', 'n', jsonb_build_array(
    test.op('appointments', test.u(3120), jsonb_build_object('typeId', test.id('n.at1'), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_staff'), 'date', (current_date + 22)::text, 'time', '09:00', 'minutes', 30, 'mode', 'phone', 'status', 'requested', 'fee', 0)),
    test.op('opportunities', test.u(3121), jsonb_build_object('clientId', test.id('n.c1'), 'serviceId', test.id('n.s1'), 'status', 'dismissed', 'created', current_date::text, 'by', 'x')),
    test.op('accessRequests', test.u(3122), jsonb_build_object('userId', 'x', 'clientId', test.id('n.c1'), 'reason', 'r', 'at', '2030-12-01T09:00:00.000Z', 'status', 'pending')),
    test.op('complianceItems', test.u(3123), jsonb_build_object('title', 'x', 'kind', 'other', 'due', current_date::text, 'status', 'open')),
    test.del('reviews', test.id('n.review_draft'))));
  perform test.ok(r ->> 'applied' = '0' and (select bool_and(e ->> 'reason' = 'forbidden' and e ->> 'detail' = 'write') from jsonb_array_elements(r -> 'rejected') e) and jsonb_array_length(r -> 'rejected') = 5,
    'the read-only role is refused every change to a module collection: "forbidden", detail "write"');

  -- read-only collections: refused for everyone, the owner included (the protected functions write them)
  foreach c in array array['grants', 'credits', 'reveals', 'secureLog'] loop
    r := test.apply('n_owner', 'n', jsonb_build_array(test.op(c, test.u(3130), '{"clientId":"x","amount":999,"status":"approved","action":"reveal"}'), test.del(c, test.u(3131))));
    perform test.ok(r ->> 'applied' = '0' and (select bool_and(e ->> 'reason' = 'read_only') from jsonb_array_elements(r -> 'rejected') e) and jsonb_array_length(r -> 'rejected') = 2,
      format('%s cannot be written or deleted through ws_apply, even by the owner', c));
  end loop;
  r := test.apply('n_owner', 'n', jsonb_build_array(test.op('connections', test.u(3132), '{"state":"connected"}')));
  perform test.is(test.reason(r, test.u(3132)::text), 'read_only', 'connections is read only: a "connected" row cannot be planted through ws_apply');
  -- a daily close is created by cash_close only; a credit by the appointment functions only
  r := test.apply('n_owner', 'n', jsonb_build_array(test.op('cashCloses', test.u(3133), jsonb_build_object('date', current_date::text, 'expected', 0, 'counted', 0, 'diff', 0, 'by', test.id('n.m_owner'), 'at', '2030-12-01T09:00:00.000Z'))));
  perform test.is(test.reason(r, test.u(3133)::text), 'forbidden', 'a daily close cannot be created through ws_apply, even by the owner');
  perform test.ok((select count(*) = 1 from public.cash_closes where tenant_id = test.id('n')) and (select count(*) = 3 from public.credits where tenant_id = test.id('n'))
              and (select count(*) = 1 from public.access_grants where tenant_id = test.id('n')), 'and none of those attempts left a row behind');
end $$;

-- rows that are refused for what they say
do $$
declare r jsonb;
begin
  r := test.apply('n_owner', 'n', jsonb_build_array(
    test.op('appointments', test.u(3140), jsonb_build_object('typeId', test.u(3999), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_staff'), 'date', (current_date + 23)::text, 'time', '09:00', 'minutes', 30, 'mode', 'phone', 'status', 'requested', 'fee', 0)),
    test.op('appointments', test.u(3141), jsonb_build_object('typeId', test.id('n.at1'), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_staff'), 'date', (current_date + 23)::text, 'time', '09:00', 'minutes', 30, 'mode', 'phone', 'status', 'maybe', 'fee', 0)),
    test.op('appointments', test.u(3142), jsonb_build_object('typeId', test.id('n.at1'), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_staff'), 'date', (current_date + 23)::text, 'time', '23:50', 'minutes', 30, 'mode', 'phone', 'status', 'requested', 'fee', 0)),
    test.op('appointments', test.u(3143), jsonb_build_object('typeId', test.id('b.at1'), 'clientId', test.id('n.c1'), 'staffId', test.id('n.m_staff'), 'date', (current_date + 23)::text, 'time', '09:00', 'minutes', 30, 'mode', 'phone', 'status', 'requested', 'fee', 0)),
    test.op('catalog', test.u(3144), '{"name":"Bad tier","category":"","active":true,"tiers":[{"id":"00000000-0000-4000-9000-000000003145","name":"Negative","price":-1,"unit":"flat"}]}'),
    test.op('catalog', test.u(3146), '{"name":"Bad unit","category":"","active":true,"tiers":[{"id":"00000000-0000-4000-9000-000000003147","name":"Odd","price":1,"unit":"fortnight"}]}'),
    test.op('rules', test.u(3148), '{"name":{"en":"Bad event","es":"Evento"},"active":true,"when":{"event":"moon.full"},"if":[],"then":[]}'),
    test.op('rules', test.u(3149), '{"name":{"en":"Bad operator","es":"Operador"},"active":true,"when":{"event":"daily"},"if":[{"field":"lead.pri","op":"resembles","value":"x"}],"then":[]}'),
    test.op('rules', test.u(3150), '{"name":{"en":"Bad step","es":"Paso"},"active":true,"when":{"event":"daily"},"if":[],"then":[{"do":"teleport","params":{}}]}'),
    test.op('rules', test.u(3151), '{"name":{"en":"Only English"},"active":true,"when":{"event":"daily"},"if":[],"then":[]}'),
    test.op('posts', test.u(3152), '{"text":"x","channels":["tiktok"],"status":"draft","by":"x","created":"2030-12-01T09:00:00.000Z"}'),
    test.op('cash', test.u(3153), jsonb_build_object('date', current_date::text, 'dir', 'in', 'amount', 0, 'category', 'other', 'memo', '', 'by', 'x')),
    test.op('cash', test.u(3154), jsonb_build_object('date', current_date::text, 'dir', 'in', 'amount', 5, 'category', 'other', 'memo', '', 'by', 'x', 'receipt', '{"name":"r.png","size":10,"mime":"image/png","dataUrl":"data:image/png;base64,AAAA"}'::jsonb)),
    test.op('opportunities', test.u(3155), jsonb_build_object('clientId', test.id('n.c1'), 'serviceId', test.id('n.s2'), 'status', 'open', 'created', current_date::text, 'by', 'x')),
    test.op('complianceItems', test.u(3156), jsonb_build_object('title', 'x', 'kind', 'tax', 'due', current_date::text, 'status', 'open')),
    test.op('reviews', test.u(3157), jsonb_build_object('clientId', test.id('n.c1'), 'at', '2030-12-01T09:00:00.000Z', 'channel', 'email', 'status', 'draft', 'rating', 9, 'by', 'x')),
    test.op('offices', test.u(3158), jsonb_build_object('name', 'Other company', 'address', '', 'tenantId', test.id('b'))),
    test.del('offices', test.id('n.o1')),
    test.del('catalog', test.id('n.s2'))));
  perform test.is(test.reason(r, test.u(3140)::text), 'missing_reference', 'an appointment of a type that does not exist: missing_reference');
  perform test.is(test.reason(r, test.u(3141)::text) || ':' || test.detail(r, test.u(3141)::text), 'invalid:appointments_status_check', 'a status that does not exist: invalid, with the name of the rule');
  perform test.is(test.reason(r, test.u(3142)::text) || ':' || test.detail(r, test.u(3142)::text), 'invalid:appointments_within_day', 'an appointment that runs past midnight: invalid');
  perform test.is(test.reason(r, test.u(3143)::text), 'missing_reference', 'an appointment type of another company does not exist here');
  perform test.is(test.reason(r, test.u(3144)::text) || '/' || test.reason(r, test.u(3146)::text), 'invalid/invalid', 'a negative price and a unit that does not exist: invalid');
  perform test.ok(not exists (select 1 from public.catalog_services where id in (test.u(3144), test.u(3146))), 'and the service is not stored without its tiers: a row is applied whole or not at all');
  perform test.is(test.reason(r, test.u(3148)::text) || ':' || test.detail(r, test.u(3148)::text), 'invalid:rules_event_check', 'a rule for an event that does not exist: invalid');
  perform test.is(test.reason(r, test.u(3149)::text) || ':' || test.detail(r, test.u(3149)::text), 'invalid:rules_shape', 'a condition with an operator that does not exist: invalid');
  perform test.is(test.reason(r, test.u(3150)::text) || ':' || test.detail(r, test.u(3150)::text), 'invalid:rules_shape', 'a step that does something that does not exist: invalid');
  perform test.is(test.reason(r, test.u(3151)::text), 'invalid', 'a rule name without Spanish: invalid');
  perform test.is(test.reason(r, test.u(3152)::text) || '/' || test.reason(r, test.u(3153)::text), 'invalid/invalid', 'a network that does not exist and a cash entry of nothing: invalid');
  perform test.is(test.reason(r, test.u(3154)::text), 'invalid', 'a receipt is a path in storage: a file pasted into the row is refused');
  perform test.is(test.reason(r, test.u(3155)::text), 'duplicate', 'the same service is suggested to a client once while the suggestion is open: duplicate');
  perform test.is(test.reason(r, test.u(3156)::text) || '/' || test.reason(r, test.u(3157)::text), 'invalid/forbidden', 'a deadline kind that does not exist: invalid; a rating a person typed into a draft: forbidden');
  perform test.is(test.reason(r, test.u(3158)::text), 'wrong_tenant', 'a row that names another company: wrong_tenant');
  perform test.is(test.reason(r, test.id('n.o1')::text) || '/' || test.reason(r, test.id('n.s2')::text), 'in_use/in_use', 'an office with cash entries and a service a rule suggests cannot be removed: in_use');
  perform test.is(r ->> 'applied', '0', 'none of the 19 was applied');
end $$;

-- an outsider and a field worker do not get as far as a row
select test.is(test.as('b_owner', format($q$select public.ws_apply(%L, '[]', null)$q$, test.id('n'))), 'error:42501', 'the owner of another company cannot call ws_apply for this one') \g /dev/null
select test.is(test.as('n_w1', format($q$select public.ws_apply(%L, '[]', null)$q$, test.id('n'))), 'error:42501', 'nor a field worker') \g /dev/null
select test.is(test.as('anon', format('select public.ws_load(%L)', test.id('n'))), 'error:42501', 'nor the anonymous visitor read it') \g /dev/null

-- deletes, in the right order, by someone who may delete
select test.apply('n_owner', 'n', jsonb_build_array(test.del('offices', test.u(3001)), test.del('appointments', test.u(3009)), test.del('apptTypes', test.u(3008)), test.del('catalog', test.u(3005)),
  test.del('playbooks', test.u(3002)), test.del('crossSell', test.u(3010)), test.del('opportunities', test.u(3011)), test.del('envelopes', test.u(3017)), test.del('rules', test.u(3023)))) as w3 \gset
select test.is(:'w3'::jsonb ->> 'applied' || '/' || jsonb_array_length(:'w3'::jsonb -> 'rejected'), '9/0',
  'the owner removes nine of those rows in one request: what points at something goes before the thing it points at') \g /dev/null
select test.ok(not exists (select 1 from public.catalog_tiers where service_id = test.u(3005)) and not exists (select 1 from public.envelope_fields where envelope_id = test.u(3017))
           and not exists (select 1 from public.playbook_steps where playbook_id = test.u(3002)), 'and their nested lists went with them') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- Office scope: what belongs to a client of another office is hidden with the client, in every module table
-- ---------------------------------------------------------------------------------------------------------------------
select test.begin_section('33. module office scope') \g /dev/null
-- staff of M work from the main office; a new client belongs to the second office, with one row in every table that points at a client
update public.tenant_members set office_ids = array[test.id('m.o1')] where id = test.id('m.m_staff');
insert into public.clients (id, tenant_id, name, phone, email, office_id) values (test.u(3201), test.id('m'), 'Second Office Module Client', '609-555-0321', 'module-hidden@example.com', test.id('m.o2'));
insert into public.documents (id, tenant_id, kind, number, title, client_id) values (test.u(3202), test.id('m'), 'upload', 'M-U-3202', 'Hidden module document', test.u(3201));
insert into public.appointments (id, tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status, notes)
  values (test.u(3203), test.id('m'), test.id('m.at1'), test.u(3201), test.id('m.m_manager'), current_date + 30, '09:00', 30, 'scheduled', 'Hidden appointment');
insert into public.credits (id, tenant_id, client_id, amount, reason) values (test.u(3204), test.id('m'), test.u(3201), 33.33, 'goodwill');
insert into public.opportunities (id, tenant_id, client_id, service_id, status, note) values (test.u(3205), test.id('m'), test.u(3201), test.id('m.s1'), 'open', 'Hidden opportunity');
insert into public.review_requests (id, tenant_id, client_id, status, comment) values (test.u(3206), test.id('m'), test.u(3201), 'demo', 'Hidden review');
insert into public.compliance_items (id, tenant_id, title, client_id, due) values (test.u(3207), test.id('m'), 'Hidden deadline', test.u(3201), current_date + 5);
insert into public.envelopes (id, tenant_id, doc_id, title) values (test.u(3208), test.id('m'), test.u(3202), 'Hidden request');
insert into public.envelope_signers (id, tenant_id, envelope_id, name, email) values (test.u(3209), test.id('m'), test.u(3208), 'Hidden Signer', 'hidden-signer@example.com');
insert into public.envelope_fields (id, tenant_id, envelope_id, signer_id, type) values (test.u(3210), test.id('m'), test.u(3208), test.u(3209), 'signature');
insert into public.client_secrets (tenant_id, client_id, tax_id_enc, tax_id_type, last4) values (test.id('m'), test.u(3201), app.encrypt_pii('900700321'), 'ein', '0321');
insert into public.reveal_requests (id, tenant_id, client_id, requested_by, reason) values (test.u(3211), test.id('m'), test.u(3201), test.id('m.m_owner'), 'Hidden reveal request');
insert into public.secure_access_log (id, tenant_id, client_id, member_id, action) values (test.u(3212), test.id('m'), test.u(3201), test.id('m.m_owner'), 'set');

do $$
declare r record; res text;
begin
  for r in select * from (values
      ('appointments', format('id = %L', test.u(3203))), ('credits', format('id = %L', test.u(3204))), ('opportunities', format('id = %L', test.u(3205))),
      ('review_requests', format('id = %L', test.u(3206))), ('compliance_items', format('id = %L', test.u(3207))), ('envelopes', format('id = %L', test.u(3208))),
      ('envelope_signers', format('id = %L', test.u(3209))), ('envelope_fields', format('id = %L', test.u(3210)))) as t(rel, cond)
  loop
    res := test.as('m_staff', format('select 1 from public.%I where %s', r.rel, r.cond));
    perform test.is(res, 'rows:0', format('what belongs to a client of another office is hidden from staff of the first office: %s', r.rel));
    -- a senior associate of a practice does not see every client either, and works from no office
    res := test.as('m_manager', format('select 1 from public.%I where %s', r.rel, r.cond));
    perform test.is(res, 'rows:0', format('and from a senior associate who is not of that office: %s', r.rel));
    res := test.as('m_owner', format('select 1 from public.%I where %s', r.rel, r.cond));
    perform test.is(res, 'rows:1', format('control: the owner sees every client and does see it in %s', r.rel));
    res := test.as('m_staff', format('update public.%I set extra = extra where %s', r.rel, r.cond));
    perform test.ok(test.blocked(res), format('nor can staff of the first office change it: %s (%s)', r.rel, res));
  end loop;
  -- the two tables of the vault: the owner asked, so the senior associate (who decides requests) would see the row, if the client were theirs to see
  perform test.is(test.as('m_manager', format('select 1 from public.reveal_requests where id = %L', test.u(3211))), 'rows:0', 'a reveal request for a hidden client is hidden from someone who decides requests');
  perform test.is(test.as('m_manager', format('select 1 from public.secure_access_log where id = %L', test.u(3212))), 'rows:0', 'and so is its line in the access log');
  perform test.is(test.as('m_owner', format('select 1 from public.reveal_requests where id = %L', test.u(3211))), 'rows:1', 'control: the owner sees the request');
end $$;
select test.is(test.as('m_staff', format($q$insert into public.appointments (tenant_id, type_id, client_id, staff_id, date, start_time, minutes, status) values (%L, %L, %L, %L, current_date + 31, '09:00', 30, 'requested')$q$,
  test.id('m'), test.id('m.at1'), test.u(3201), test.id('m.m_staff'))), 'error:42501', 'staff cannot book an appointment for a client they cannot open') \g /dev/null
select test.is(test.as('m_staff', format($q$insert into public.opportunities (tenant_id, client_id, service_id, status) values (%L, %L, %L, 'dismissed')$q$, test.id('m'), test.u(3201), test.id('m.s2'))),
  'error:42501', 'nor record an opportunity for them') \g /dev/null
select test.is(test.as('m_staff', format($q$insert into public.envelopes (tenant_id, doc_id, title) values (%L, %L, 'Planted')$q$, test.id('m'), test.u(3202))),
  'error:42501', 'nor start a signature request on their document: the request follows the client of its document') \g /dev/null
select test.is(test.as('m_staff', format($q$insert into public.envelope_signers (tenant_id, envelope_id, name, email) values (%L, %L, 'Planted', 'planted@example.com')$q$, test.id('m'), test.u(3208))),
  'error:42501', 'nor add a signer to a request they cannot see') \g /dev/null
select test.load('m_staff', 'm')::text as scoped \gset
select test.ok(:'scoped' !~ 'Hidden (appointment|opportunity|review|deadline|request|Signer|module document)|module-hidden@example|hidden-signer@example|33\.33',
  'ws_load for staff of the first office holds nothing of the second office''s client, in any module list') \g /dev/null
select test.ok(test.load('m_owner', 'm')::text ~ 'Hidden appointment' and test.load('m_owner', 'm')::text ~ 'Hidden Signer', 'control: ws_load for the owner does hold them') \g /dev/null
select test.apply('m_staff', 'm', jsonb_build_array(
  test.op('appointments', test.u(3203), jsonb_build_object('typeId', test.id('m.at1'), 'clientId', test.u(3201), 'staffId', test.id('m.m_staff'), 'date', (current_date + 30)::text, 'time', '09:00', 'minutes', 30, 'mode', 'office', 'status', 'cancelled_client', 'fee', 0)),
  test.op('complianceItems', test.u(3207), jsonb_build_object('title', 'Taken over', 'kind', 'other', 'clientId', test.u(3201), 'due', current_date::text, 'status', 'done')))) as sc \gset
select test.ok(jsonb_array_length(:'sc'::jsonb -> 'rejected') = 2 and (select status = 'scheduled' from public.appointments where id = test.u(3203)) and (select title = 'Hidden deadline' from public.compliance_items where id = test.u(3207)),
  'the gateway refuses a write to an appointment and a deadline of a hidden client') \g /dev/null

-- staff ask for access through the gateway; the owner decides; the grant opens the client and everything attached to it
select test.apply('m_staff', 'm', jsonb_build_array(test.op('accessRequests', test.u(3220), jsonb_build_object('userId', test.id('m.m_owner'), 'clientId', test.u(3201), 'reason', 'Covering payroll next week',
  'at', '2030-12-01T09:00:00.000Z', 'status', 'approved', 'decidedBy', test.id('m.m_owner'), 'decidedAt', '2030-12-01T09:00:00.000Z')))) as ar \gset
select test.ok((:'ar'::jsonb ->> 'ok')::boolean and (select member_id = test.id('m.m_staff') and status = 'pending' and decided_by is null and decided_at is null from public.access_requests where id = test.u(3220)),
  'a request filed through the gateway is the person''s own and is pending, whatever name and decision the row carried') \g /dev/null
select test.is(test.j('m_staff', format('select public.grant_decide(%L, %L, true)', test.id('m'), test.u(3220))) ->> 'error', '42501', 'the person who asked cannot decide their own request: they do not hold "allClients"') \g /dev/null
select test.is(test.j('m_manager', format('select public.grant_decide(%L, %L, true)', test.id('m'), test.u(3220))) ->> 'error', '42501', 'nor can a senior associate of a practice, who does not see every client') \g /dev/null
select test.is(test.j('b_owner', format('select public.grant_decide(%L, %L, true)', test.id('m'), test.u(3220))) ->> 'error', '42501', 'nor the owner of another company') \g /dev/null
select test.is(test.j('m_owner', format('select public.grant_decide(%L, %L, true, %L)', test.id('m'), test.u(3220), current_date - 1)) ->> 'word', 'invalid', 'a grant cannot end on a day that has passed') \g /dev/null
select test.is(test.j('m_owner', format('select public.grant_decide(%L, %L, true)', test.id('m'), gen_random_uuid())) ->> 'word', 'not_found', 'a request that does not exist: not_found') \g /dev/null
select test.j('m_owner', format('select public.grant_decide(%L, %L, true, %L)', test.id('m'), test.u(3220), current_date + 10)) as gd \gset
select test.ok(:'gd'::jsonb ->> 'status' = 'approved' and :'gd'::jsonb ->> 'decidedBy' = test.id('m.m_owner')::text and :'gd'::jsonb ->> 'userId' = test.id('m.m_staff')::text and :'gd'::jsonb ? 'decidedAt',
  'the owner approves: grant_decide answers with the AccessRequest, decided') \g /dev/null
select test.ok((select granted_by = test.id('m.m_owner') and expires = current_date + 10 and reason = 'Covering payroll next week' and request_id = test.u(3220)
                from public.access_grants where tenant_id = test.id('m') and member_id = test.id('m.m_staff') and client_id = test.u(3201)), 'and the grant exists, with its end date and the reason') \g /dev/null
select test.is(test.j('m_owner', format('select public.grant_decide(%L, %L, false)', test.id('m'), test.u(3220))) ->> 'word', 'expired', 'a request is decided once: a second decision is refused') \g /dev/null
select test.ok(exists (select 1 from public.audit_log where tenant_id = test.id('m') and action = 'access.grant' and table_name = 'client' and row_id = test.u(3201) and actor = test.id('m_owner'))
           and exists (select 1 from app.security_events where tenant_id = test.id('m') and kind = 'access.grant' and user_id = test.id('m_owner')),
  'the decision is in the audit log and in the security events, with the client and who decided') \g /dev/null
do $$
declare r record; res text;
begin
  for r in select * from (values
      ('clients', format('id = %L', test.u(3201))), ('appointments', format('id = %L', test.u(3203))), ('credits', format('id = %L', test.u(3204))), ('opportunities', format('id = %L', test.u(3205))),
      ('review_requests', format('id = %L', test.u(3206))), ('compliance_items', format('id = %L', test.u(3207))), ('envelopes', format('id = %L', test.u(3208))),
      ('envelope_signers', format('id = %L', test.u(3209))), ('envelope_fields', format('id = %L', test.u(3210))), ('documents', format('id = %L', test.u(3202)))) as t(rel, cond)
  loop
    res := test.as('m_staff', format('select 1 from public.%I where %s', r.rel, r.cond));
    perform test.is(res, 'rows:1', format('with the grant, staff see the client and what belongs to it: %s', r.rel));
  end loop;
end $$;
select test.ok(test.load('m_staff', 'm')::text ~ 'Hidden appointment' and jsonb_array_length(test.load('m_staff', 'm') -> 'grants') = 2, 'ws_load for staff now holds the client''s appointment, and their two grants') \g /dev/null
select test.is(test.as('m_manager', format('select 1 from public.appointments where id = %L', test.u(3203))), 'rows:0', 'a grant is for one person: the senior associate still sees nothing') \g /dev/null
-- a grant runs out on its date
update public.access_grants set expires = current_date - 1 where tenant_id = test.id('m') and client_id = test.u(3201);
select test.is(test.as('m_staff', format('select 1 from public.appointments where id = %L', test.u(3203))), 'rows:0', 'a grant that ran out opens nothing') \g /dev/null
update public.access_grants set expires = null where tenant_id = test.id('m') and client_id = test.u(3201);
select test.is(test.as('m_staff', format('select 1 from public.appointments where id = %L', test.u(3203))), 'rows:1', 'a grant without an end date holds until it is taken back') \g /dev/null
select test.is(test.j('m_staff', format('select to_jsonb(public.grant_revoke(%L, (select id from public.access_grants where client_id = %L)))', test.id('m'), test.u(3201))) ->> 'error', '42501', 'the person it was granted to cannot take it back themselves') \g /dev/null
select test.is(test.j('m_owner', format('select to_jsonb(public.grant_revoke(%L, (select id from public.access_grants where client_id = %L)))', test.id('m'), test.u(3201)))::text, 'true', 'the owner takes the grant back') \g /dev/null
select test.is(test.as('m_staff', format('select 1 from public.clients where id = %L', test.u(3201))), 'rows:0', 'and the client is hidden again') \g /dev/null
-- a second request for the same client while one is waiting is a duplicate; a denied one leaves no grant
select test.apply('m_staff', 'm', jsonb_build_array(test.op('accessRequests', test.u(3221), jsonb_build_object('userId', 'x', 'clientId', test.u(3201), 'reason', 'Again', 'at', '2030-12-02T09:00:00.000Z', 'status', 'pending')))) as ar2 \gset
select test.apply('m_staff', 'm', jsonb_build_array(test.op('accessRequests', test.u(3222), jsonb_build_object('userId', 'x', 'clientId', test.u(3201), 'reason', 'And again', 'at', '2030-12-02T10:00:00.000Z', 'status', 'pending')))) as ar3 \gset
select test.is(test.reason(:'ar2'::jsonb, test.u(3221)::text) || '/' || test.reason(:'ar3'::jsonb, test.u(3222)::text), 'applied/duplicate', 'one open request per person and client: the second is a duplicate') \g /dev/null
select test.is(test.j('m_owner', format('select public.grant_decide(%L, %L, false)', test.id('m'), test.u(3221))) ->> 'status', 'denied', 'the owner denies it') \g /dev/null
select test.ok(not exists (select 1 from public.access_grants where tenant_id = test.id('m') and client_id = test.u(3201)), 'and a denial creates no grant') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section in ('32. module gateway', '33. module office scope') group by section order by section;
