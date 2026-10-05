-- Sample rows for the tables of 0031 (playbooks and their steps, catalog services and their price tiers).
create function test.seed_catalog(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); pb uuid; s1 uuid; s2 uuid; x uuid;
begin
  insert into public.playbooks (tenant_id, name, welcome) values (t, 'Onboarding ' || p, 'Welcome') returning id into pb;
  perform test.remember(p || '.pb1', pb);
  insert into public.playbook_steps (tenant_id, playbook_id, title, due_in, for_role, type, pri, position)
    values (t, pb, '{"en":"Collect documents","es":"Reunir documentos"}', 2, 'assignee', 'todo', 'medium', 1),
           (t, pb, '{"en":"Welcome call","es":"Llamada de bienvenida"}', 0, 'manager', null, null, 0);
  insert into public.catalog_services (tenant_id, name, category, description, repeat, playbook_id, doc_kinds, i18n, external_ids)
    values (t, 'Sample service ' || p, 'sample', 'A sample service', 'yearly', pb, array['engagement_letter'],
            '{"es":{"name":"Servicio de muestra"}}', jsonb_build_object('square', 'sq-' || p || '-1')) returning id into s1;
  insert into public.catalog_services (tenant_id, name, active) values (t, 'Retired service ' || p, false) returning id into s2;
  perform test.remember(p || '.s1', s1);
  perform test.remember(p || '.s2', s2);
  insert into public.catalog_tiers (tenant_id, service_id, name, price, unit, position) values (t, s1, 'Standard', 180, 'flat', 0) returning id into x;
  perform test.remember(p || '.tier1', x);
  insert into public.catalog_tiers (tenant_id, service_id, name, price, unit, note, position) values (t, s1, 'Monthly', 95.50, 'month', 'Billed on the first', 1);
end $$;
select test.seed_catalog('a') \g /dev/null
select test.seed_catalog('b') \g /dev/null
select test.seed_catalog('c') \g /dev/null
