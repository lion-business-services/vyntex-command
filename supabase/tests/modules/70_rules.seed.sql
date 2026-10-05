-- Sample rows for the tables of 0037 (deadlines, rule definitions).
create function test.seed_rules(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); x uuid;
begin
  insert into public.compliance_items (tenant_id, title, kind, client_id, job_id, due, repeat, status, assignee_member_id, authority, note, remind)
    values (t, 'Annual report (sample)', 'filing', test.id(p || '.c1'), test.id(p || '.j1'), current_date + 12, 'yearly', 'open', test.id(p || '.m_staff'), 'State agency (sample)', 'Sample item', array[30, 7])
    returning id into x;
  perform test.remember(p || '.deadline', x);
  insert into public.compliance_items (tenant_id, title, kind, due, status, done_at) values (t, 'Insurance renewal (sample)', 'insurance', current_date - 20, 'done', current_date - 22);
  insert into public.rules (tenant_id, rule_id, name, active, event, conditions, steps, shipped)
    values (t, 'lead-intake', '{"en":"New lead intake","es":"Entrada de prospectos"}', true, 'lead.created', '[]', '[{"do":"builtin","params":{"rule":"lead-intake"}}]', true);
  insert into public.rules (tenant_id, rule_id, name, about, active, event, days, conditions, steps)
    values (t, gen_random_uuid()::text, '{"en":"Idle lead reminder","es":"Recordatorio de prospecto inactivo"}', '{"en":"Nudges the owner","es":"Avisa al responsable"}', false, 'lead.idle', 5,
            '[{"field":"lead.pri","op":"is","value":"high"},{"field":"lead.value","op":"gt","value":500}]',
            '[{"do":"task","params":{"title":"Call back","dueIn":1}},{"do":"notify","params":{"to":["owner","manager"]}}]');
end $$;
select test.seed_rules('a') \g /dev/null
select test.seed_rules('b') \g /dev/null
select test.seed_rules('c') \g /dev/null
