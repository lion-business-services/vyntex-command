-- Sample rows for the tables of 0038 (cross-sell rules, opportunities, review requests, social posts).
create function test.seed_sales(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); cs uuid; x uuid;
begin
  insert into public.cross_sell_rules (tenant_id, name, when_service_ids, suggest_service_id, unless_service_ids, client_kind, delay_days, note)
    values (t, 'Sample rule ' || p, array[test.id(p || '.s1')], test.id(p || '.s2'), array[test.id(p || '.s2')], 'business', 14, 'Ask who does this for them today') returning id into cs;
  perform test.remember(p || '.cs', cs);
  insert into public.opportunities (tenant_id, client_id, service_id, rule_id, status, by_kind, note, value)
    values (t, test.id(p || '.c1'), test.id(p || '.s2'), cs, 'open', 'automation', 'Ask who does this for them today', 120) returning id into x;
  perform test.remember(p || '.opp', x);
  insert into public.opportunities (tenant_id, client_id, service_id, status, by_kind, by_member_id, lead_id, value)
    values (t, test.id(p || '.c1'), test.id(p || '.s1'), 'won', 'member', test.id(p || '.m_staff'), test.id(p || '.l1'), 180);
  insert into public.review_requests (tenant_id, client_id, job_id, channel, status, rating, comment, by_kind, by_member_id)
    values (t, test.id(p || '.c1'), test.id(p || '.j1'), 'email', 'rated', 5, 'Quick and clear', 'member', test.id(p || '.m_staff')) returning id into x;
  perform test.remember(p || '.review_rated', x);
  insert into public.review_requests (tenant_id, client_id, channel, status, by_kind) values (t, test.id(p || '.c1'), 'text', 'draft', 'automation') returning id into x;
  perform test.remember(p || '.review_draft', x);
  insert into public.social_posts (tenant_id, text, channels, status, by_member_id)
    values (t, 'Office hours this week', array['facebook', 'gbp'], 'draft', test.id(p || '.m_staff')) returning id into x;
  perform test.remember(p || '.post_draft', x);
  insert into public.social_posts (tenant_id, text, media, channels, status, scheduled_for, published_at, by_member_id, approved_by)
    values (t, 'We moved', '[{"name":"door.jpg","size":20000,"mime":"image/jpeg","path":"social/door.jpg"}]', array['instagram'], 'published', now() - interval '2 days',
            now() - interval '2 days', test.id(p || '.m_staff'), test.id(p || '.m_owner')) returning id into x;
  perform test.remember(p || '.post_published', x);
end $$;
select test.seed_sales('a') \g /dev/null
select test.seed_sales('b') \g /dev/null
select test.seed_sales('c') \g /dev/null
