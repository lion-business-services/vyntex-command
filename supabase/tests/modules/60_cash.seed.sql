-- Sample rows for the tables of 0036 (cash entries and closes): the main office's drawer was counted three days
-- ago, 1.50 short; two entries are locked by that count, one is open, and one belongs to no office.
create function test.seed_cash(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); cl uuid; x uuid;
begin
  insert into public.cash_closes (tenant_id, date, office_id, expected, counted, diff, by_member_id, note, approved_by)
    values (t, current_date - 3, test.id(p || '.o1'), 181.55, 180.05, -1.50, test.id(p || '.m_staff'), 'A roll of coins was one short', test.id(p || '.m_owner')) returning id into cl;
  perform test.remember(p || '.close', cl);
  insert into public.cash_entries (tenant_id, date, office_id, dir, amount, category, memo, by_member_id, close_id)
    values (t, current_date - 4, test.id(p || '.o1'), 'in', 200, 'change_fund', 'Starting float', test.id(p || '.m_owner'), cl) returning id into x;
  perform test.remember(p || '.cash_closed', x);
  insert into public.cash_entries (tenant_id, date, office_id, dir, amount, category, memo, by_member_id, close_id)
    values (t, current_date - 3, test.id(p || '.o1'), 'out', 18.45, 'supplies', 'Printer paper', test.id(p || '.m_staff'), cl);
  insert into public.cash_entries (tenant_id, date, office_id, dir, amount, category, memo, by_member_id, receipt)
    values (t, current_date, test.id(p || '.o1'), 'in', 50, 'client_payment', 'Cash payment', test.id(p || '.m_staff'), '{"name":"receipt.pdf","size":1200,"mime":"application/pdf","path":"cash/receipt.pdf"}') returning id into x;
  perform test.remember(p || '.cash_open', x);
  insert into public.cash_entries (tenant_id, date, dir, amount, category, by_member_id) values (t, current_date, 'out', 5, 'postage', test.id(p || '.m_owner'));
end $$;
select test.seed_cash('a') \g /dev/null
select test.seed_cash('b') \g /dev/null
select test.seed_cash('c') \g /dev/null
