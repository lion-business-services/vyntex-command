-- Sample rows for the tables of 0035 (templates and their blocks, signature requests with signers and boxes).
-- One sample request (demo: nothing was sent) that is complete, and one real draft that nobody has sent yet.
create function test.seed_documents(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); tp uuid; e1 uuid; e2 uuid; s1 uuid; s2 uuid;
begin
  insert into public.doc_templates (tenant_id, kind, name, lang, source, approved, approved_by, approved_at)
    values (t, 'engagement_letter', 'Engagement letter ' || p, 'en', 'company', true, test.id(p || '.m_owner'), now()) returning id into tp;
  perform test.remember(p || '.tpl', tp);
  insert into public.doc_template_blocks (tenant_id, template_id, type, text, position) values
    (t, tp, 'h', 'Engagement letter', 0), (t, tp, 'p', 'This letter confirms the work for {{client.name}}.', 1), (t, tp, 'sign', 'Client', 2);

  insert into public.envelopes (tenant_id, doc_id, title, status, ordered, created_by, sent_at, completed_at, events, demo)
    values (t, test.id(p || '.d1'), 'Sample request ' || p, 'completed', false, test.id(p || '.m_staff'), now() - interval '2 days', now() - interval '1 day',
            '[{"at":"2026-01-05T10:00:00.000Z","kind":"created"},{"at":"2026-01-05T10:05:00.000Z","kind":"sent"}]', true) returning id into e1;
  insert into public.envelope_signers (tenant_id, envelope_id, name, email, role, sign_order, status, viewed_at, signed_at, typed_name, consent)
    values (t, e1, 'Client ' || p, p || '-client@example.com', 'client', 1, 'signed', now() - interval '1 day', now() - interval '1 day', 'Client ' || p, true) returning id into s1;
  insert into public.envelope_fields (tenant_id, envelope_id, signer_id, type, page, x, y, w, h, required, value, position)
    values (t, e1, s1, 'signature', 1, 0.1, 0.8, 0.3, 0.05, true, 'signed', 0);
  insert into public.envelopes (tenant_id, doc_id, title, status, ordered, created_by, remind_every, events)
    values (t, test.id(p || '.d1'), 'Draft request ' || p, 'draft', true, test.id(p || '.m_staff'), 3, '[{"at":"2026-01-06T09:00:00.000Z","kind":"created"}]') returning id into e2;
  insert into public.envelope_signers (tenant_id, envelope_id, name, email, sign_order) values (t, e2, 'Client ' || p, p || '-client@example.com', 1) returning id into s2;
  insert into public.envelope_fields (tenant_id, envelope_id, signer_id, type, page, x, y, w, h, label, position)
    values (t, e2, s2, 'date', 1, 0.5, 0.8, 0.2, 0.04, 'Date', 0);
  perform test.remember(p || '.env_demo', e1);
  perform test.remember(p || '.env_draft', e2);
  perform test.remember(p || '.signer_draft', s2);
end $$;
select test.seed_documents('a') \g /dev/null
select test.seed_documents('b') \g /dev/null
select test.seed_documents('c') \g /dev/null
