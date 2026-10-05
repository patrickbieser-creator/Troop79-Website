-- Menu Monster — fill in the conversions nobody had typed.
--
-- Patrick, 2026-10-05: "I have to add one conversion at a time at the bottom of the price book …
-- is it possible to pre-populate it?" Same-family conversions (tsp/Tbsp/cup/fl oz/quart/gallon,
-- g/oz/lb, dozen) are code (lib/menu-monster/units.ts) and never rows. What needs a row is a food
-- sold by weight and measured by volume. Nine live ingredients were in that position with none on
-- file; these are standard household-measure weights, labelled with where the number comes from.
--
-- 1 from_unit = factor to_unit, so factor here is "recipe units per ounce of weight".
--
-- Data only, and careful about it: a row lands only where the ingredient exists, is still measured
-- in the unit the factor was worked out for, and has no conversion at all yet — so a conversion a
-- leader typed in production since the last local sync is never doubled or contradicted. Package
-- yields are NOT touched: each package keeps the figure a person typed for it.
insert into public.mm_conversions (ingredient_id, from_unit, to_unit, factor, label)
select v.ingredient_id, 'ozw', v.to_unit, v.factor, v.label
  from (values
    ('pepper',    'tsp',  12.3, 'ground black pepper ≈ 2.3 g per tsp'),
    ('salt',      'tsp',  4.7,  'table salt ≈ 6 g per tsp'),
    ('coffee',    'tbsp', 5.67, 'ground coffee ≈ 5 g per Tbsp'),
    ('ketchup',   'tbsp', 1.67, 'ketchup ≈ 17 g per Tbsp'),
    ('cereal',    'cup',  1,    'flake and O cereals ≈ 1 oz per cup — granola-style is heavier, check the box'),
    ('gf-cereal', 'cup',  1,    'flake and O cereals ≈ 1 oz per cup — granola-style is heavier, check the box'),
    ('mms',       'cup',  0.14, 'M&M’s ≈ 7 oz per cup'),
    ('peanuts',   'cup',  0.2,  'shelled peanuts ≈ 5 oz per cup'),
    ('raisins',   'cup',  0.19, 'raisins ≈ 5.25 oz per cup')
  ) as v(ingredient_id, to_unit, factor, label)
  join public.mm_ingredients i on i.id = v.ingredient_id and i.unit_key = v.to_unit
 where not exists (select 1 from public.mm_conversions c where c.ingredient_id = v.ingredient_id);
