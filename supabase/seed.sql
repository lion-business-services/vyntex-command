-- Reference data: the industry editions. Run once after the migrations, and again whenever an edition is added.
-- Safe to repeat. No customer data, no sample data: the public demo runs in the browser and never uses this database.
-- The ids match IndustryId in src/domain/types.ts and the product names match `product` in src/packs/<id>/pack.ts
-- and, for the editions that have a price, config/vyntex-build-pricing.json (supabase/tests/parity.mjs checks this).
-- "practice" is the professional-services edition. It is quoted on request, so it is absent from the pricing file.

insert into public.industries (id, product_name, sort_order) values
  ('build',     'VYNTEX BUILD',     1),
  ('clean',     'VYNTEX CLEAN',     2),
  ('landscape', 'VYNTEX LANDSCAPE', 3),
  ('wash',      'VYNTEX WASH',      4),
  ('haul',      'VYNTEX HAUL',      5),
  ('snow',      'VYNTEX SNOW',      6),
  ('turnover',  'VYNTEX TURNOVER',  7),
  ('events',    'VYNTEX EVENTS',    8),
  ('practice',  'VYNTEX PRACTICE',  9)
on conflict (id) do update
  set product_name = excluded.product_name,
      sort_order = excluded.sort_order;
