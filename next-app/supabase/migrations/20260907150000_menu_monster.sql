-- Menu Monster — catalog schema + seed (Plans/Menu-Monster.md, step 1).
--
-- WHY (Patrick, 2026-09-07)
-- A meal planner for the Cooking merit badge (reqs 4b/5b/6b): a patrol picks a
-- meal and its menu items, sets headcount and restriction COUNTS (never names),
-- and gets a shopping list with Spent / Used / Leftover per person. This phase
-- ships the scout-facing planner as a Resource Library topic shelf; leader
-- tools (recipe builder, price book, suggestion review) come later, so the
-- catalog is edited by migration for now.
--
-- MODEL (decisions carried in from the Menu Monster discovery — don't re-litigate)
--   ingredient  counts in ONE recipe unit (unit_kind/key/one/many). All count
--               units are one family with a per-ingredient noun ('count' + banana).
--   conversion  Option C density rows: "1 from_unit = factor to_unit" per
--               ingredient, so a recipe line can say "1 tsp" of cinnamon that is
--               priced in grams, or "1 lb" of bacon priced in slices.
--   package     yield is stored IN THE RECIPE UNIT. yield null = unusable until a
--               human types it (yield_unit_label says why: "sold by the gallon").
--   recipe      one recipe per dish; diet variants are per-LINE serves rules
--               (everyone / everyone except X / only X), never duplicate recipes.
--   Units, restrictions, sections, meals and food groups are code constants in
--   lib/menu-monster/units.ts (PATTERNS.md: no lookup table for a fixed list).
--   Plans, purchases and suggestions are NOT persisted this phase (localStorage).
--
-- Retire, don't delete (retired_at), like library_topics. Text primary keys on
-- ingredients/packages/recipes are the seed slugs so recipe lines and plans in
-- localStorage can reference them stably.

-- ── Ingredients ─────────────────────────────────────────────────────────────
create table public.mm_ingredients (
  id text primary key,
  name text not null,
  unit_kind text not null check (unit_kind in ('volume', 'weight', 'count')),
  unit_key text not null,
  unit_one text not null,
  unit_many text not null,
  section text not null check (section in ('produce', 'dairy', 'meat', 'bakery', 'dry')),
  -- Patrol-box item: counts toward Used, never toward Spent.
  staple boolean not null default false,
  -- Restriction keys this ingredient conflicts with. Used only to WARN.
  avoid text[] not null default '{}'
    check (avoid <@ array['gf', 'nut', 'dairy', 'veg']::text[]),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

-- ── Conversions — per-ingredient unit bridges (Option C) ────────────────────
create table public.mm_conversions (
  id bigint generated always as identity primary key,
  ingredient_id text not null references public.mm_ingredients(id) on delete restrict,
  from_unit text not null,
  to_unit text not null,
  -- 1 from_unit = factor to_unit
  factor numeric not null check (factor > 0),
  label text
);

create index mm_conversions_ingredient_idx on public.mm_conversions (ingredient_id);

-- ── Packages — what the store sells, priced ─────────────────────────────────
create table public.mm_packages (
  id text primary key,
  ingredient_id text not null references public.mm_ingredients(id) on delete restrict,
  name text not null,
  store text,
  -- numeric(10,2) to match the repo's other money columns (event_prices.amount, D-186).
  price numeric(10,2) not null check (price >= 0),
  -- In the ingredient's recipe unit. null = unusable until someone types it.
  yield numeric check (yield is null or yield > 0),
  -- Why it's unusable: the unit the label is in ('gallon').
  yield_unit_label text,
  -- What one purchased unit is called: 'pack' | 'bag' | 'box' | 'dozen' | 'each'...
  noun text not null default 'pack',
  -- The label as printed ("10 lb", "1 dozen") so a yield helper can re-suggest later.
  sold_size numeric,
  sold_unit text,
  note text,
  -- Date the price was last confirmed; > 90 days is stale (warn, still usable).
  as_of date,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create index mm_packages_ingredient_idx on public.mm_packages (ingredient_id);

-- ── Recipes = menu items ────────────────────────────────────────────────────
create table public.mm_recipes (
  id text primary key,
  name text not null,
  -- Only 'published' rows reach the planner. 'retired' keeps history for old plans.
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  meal_fit text[] not null default '{}'
    check (meal_fit <@ array['breakfast', 'lunch', 'dinner', 'snack', 'dessert']::text[]),
  -- MyPlate tag only, no nutrition math.
  food_groups text[] not null default '{}'
    check (food_groups <@ array['grain', 'protein', 'fruit', 'veg', 'dairy']::text[]),
  camp boolean not null default true,
  trail boolean not null default false,
  -- 'no-cook' | 'stove' | 'dutch-oven' | 'foil' | 'grill' | 'other'; free text on purpose.
  method text,
  steps_md text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mm_recipes_status_idx on public.mm_recipes (status);

-- ── Recipe lines — per-person amounts with a serves rule ───────────────────
create table public.mm_recipe_lines (
  id bigint generated always as identity primary key,
  recipe_id text not null references public.mm_recipes(id) on delete restrict,
  position integer not null,
  ingredient_id text not null references public.mm_ingredients(id) on delete restrict,
  qty_per_person numeric not null check (qty_per_person >= 0),
  -- null = the ingredient's recipe unit; otherwise any key conv() can bridge.
  unit_key text,
  serves_rule text not null default 'everyone' check (serves_rule in ('everyone', 'except', 'only')),
  serves_restriction text check (serves_restriction in ('gf', 'nut', 'dairy', 'veg')),
  -- 'everyone' carries no restriction; 'except' / 'only' must name one.
  check ((serves_rule = 'everyone') = (serves_restriction is null)),
  unique (recipe_id, position)
);

create index mm_recipe_lines_ingredient_idx on public.mm_recipe_lines (ingredient_id);

-- ── RLS: enabled, zero policies — service-role only (D-051 / D-239 pattern). ─
-- The shelf page reads through createAdminClient() on the server; the anon key
-- gets nothing. Verified by tests/menu-monster-db.test.ts.
alter table public.mm_ingredients enable row level security;
alter table public.mm_conversions enable row level security;
alter table public.mm_packages enable row level security;
alter table public.mm_recipes enable row level security;
alter table public.mm_recipe_lines enable row level security;

-- ── Seed ─────────────────────────────────────────────────────────────────
-- Like the library_topics seed and the D-006 lookup tables, this seed is
-- migration-owned data: a future full prod restore needs
-- `truncate mm_ingredients, mm_conversions, mm_packages, mm_recipes, mm_recipe_lines restart identity cascade`
-- before re-running migrations, or the text-keyed inserts collide.
-- Generated from D:\Projects\Troop Menu Monster\data\menu-monster-seed.json
-- (37 ingredients, 59 packages, 13 conversions, 20 recipes)
-- plus 9 lunch/dinner/snack/dessert items so every meal slot has choices.

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid) values
  ('pancake-mix', 'Pancake mix', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{gf}'),
  ('almond-flour', 'Almond flour', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{nut}'),
  ('butter', 'Butter', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dairy', false, '{dairy}'),
  ('syrup', 'Syrup', 'volume', 'oz', 'fl oz', 'fl oz', 'dry', false, '{}'),
  ('bacon', 'Bacon', 'count', 'slice', 'slice', 'slices', 'meat', false, '{veg}'),
  ('sausage', 'Sausage links', 'count', 'link', 'link', 'links', 'meat', false, '{veg}'),
  ('eggs', 'Eggs', 'count', 'egg', 'egg', 'eggs', 'dairy', false, '{}'),
  ('bananas', 'Bananas', 'count', 'count', 'banana', 'bananas', 'produce', false, '{}'),
  ('bread', 'Bread', 'count', 'slice', 'slice', 'slices', 'bakery', false, '{gf}'),
  ('gf-bread', 'Gluten-free bread', 'count', 'slice', 'slice', 'slices', 'bakery', false, '{}'),
  ('cinnamon', 'Cinnamon', 'weight', 'gram', 'g', 'g', 'dry', false, '{}'),
  ('milk', 'Milk', 'volume', 'cup', 'cup', 'cups', 'dairy', false, '{dairy}'),
  ('oatmeal', 'Instant oatmeal', 'count', 'packet', 'packet', 'packets', 'dry', false, '{gf}'),
  ('gf-oatmeal', 'Gluten-free oatmeal', 'count', 'packet', 'packet', 'packets', 'dry', false, '{}'),
  ('cereal', 'Cold cereal', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{gf}'),
  ('gf-cereal', 'Gluten-free cereal', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{}'),
  ('coffee', 'Ground coffee', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', false, '{}'),
  ('cocoa', 'Hot cocoa', 'count', 'packet', 'packet', 'packets', 'dry', false, '{}'),
  ('cider', 'Hot cider mix', 'count', 'packet', 'packet', 'packets', 'dry', false, '{}'),
  ('apples', 'Apples', 'count', 'count', 'apple', 'apples', 'produce', false, '{}'),
  ('oranges', 'Oranges', 'count', 'count', 'orange', 'oranges', 'produce', false, '{}'),
  ('bagels', 'Bagels', 'count', 'count', 'bagel', 'bagels', 'bakery', false, '{gf}'),
  ('oj', 'Orange juice', 'volume', 'cup', 'cup', 'cups', 'dairy', false, '{}'),
  ('ketchup', 'Ketchup', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', true, '{}'),
  ('salt', 'Salt', 'volume', 'tsp', 'tsp', 'tsp', 'dry', true, '{}'),
  ('pepper', 'Black pepper', 'volume', 'tsp', 'tsp', 'tsp', 'dry', true, '{}'),
  ('tortillas', 'Flour tortillas', 'count', 'count', 'tortilla', 'tortillas', 'bakery', false, '{gf}'),
  ('cheese', 'Shredded cheddar', 'volume', 'cup', 'cup', 'cups', 'dairy', false, '{dairy}'),
  ('flour', 'All-purpose flour', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{gf}'),
  ('sugar', 'Sugar', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{}'),
  ('rice', 'Rice', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{}'),
  ('rolled-oats', 'Rolled oats', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{gf}'),
  ('chicken', 'Chicken thighs', 'weight', 'ozw', 'oz', 'oz', 'meat', false, '{veg}'),
  ('potatoes', 'Potatoes', 'count', 'count', 'potato', 'potatoes', 'produce', false, '{}'),
  ('peanuts', 'Peanuts', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{nut}'),
  ('raisins', 'Raisins', 'volume', 'cup', 'cup', 'cups', 'produce', false, '{}'),
  ('mms', 'M&M’s', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{}'),
  ('corn-chips', 'Corn chips', 'count', 'count', 'bag', 'bags', 'dry', false, '{}'),
  ('ground-beef', 'Ground beef', 'weight', 'ozw', 'oz', 'oz', 'meat', false, '{veg}'),
  ('taco-seasoning', 'Taco seasoning', 'count', 'packet', 'packet', 'packets', 'dry', false, '{}'),
  ('black-beans', 'Black beans', 'count', 'count', 'can', 'cans', 'dry', false, '{}'),
  ('salsa', 'Salsa', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', false, '{}'),
  ('carrots', 'Carrots', 'count', 'count', 'carrot', 'carrots', 'produce', false, '{}'),
  ('onions', 'Onions', 'count', 'count', 'onion', 'onions', 'produce', false, '{}'),
  ('spaghetti', 'Spaghetti', 'weight', 'ozw', 'oz', 'oz', 'dry', false, '{gf}'),
  ('gf-spaghetti', 'Gluten-free spaghetti', 'weight', 'ozw', 'oz', 'oz', 'dry', false, '{}'),
  ('pasta-sauce', 'Pasta sauce', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{}'),
  ('parmesan', 'Grated parmesan', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dairy', false, '{dairy}'),
  ('corn-tortillas', 'Corn tortillas', 'count', 'count', 'tortilla', 'tortillas', 'bakery', false, '{}'),
  ('canned-peaches', 'Sliced peaches', 'count', 'count', 'can', 'cans', 'dry', false, '{}'),
  ('cake-mix', 'Yellow cake mix', 'count', 'count', 'box', 'boxes', 'dry', false, '{gf}'),
  ('gf-cake-mix', 'Gluten-free yellow cake mix', 'count', 'count', 'box', 'boxes', 'dry', false, '{}'),
  ('graham-crackers', 'Graham crackers', 'count', 'count', 'sheet', 'sheets', 'dry', false, '{gf}'),
  ('gf-graham-crackers', 'Gluten-free graham crackers', 'count', 'count', 'sheet', 'sheets', 'dry', false, '{}'),
  ('marshmallows', 'Marshmallows', 'count', 'count', 'marshmallow', 'marshmallows', 'dry', false, '{}'),
  ('chocolate-bars', 'Chocolate bars', 'count', 'count', 'bar', 'bars', 'dry', false, '{}'),
  ('chocolate-chips', 'Chocolate chips', 'volume', 'cup', 'cup', 'cups', 'dry', false, '{}'),
  ('peanut-butter', 'Peanut butter', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', false, '{nut}'),
  ('sunflower-butter', 'Sunflower seed butter', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', false, '{}'),
  ('jelly', 'Grape jelly', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', false, '{}');

insert into public.mm_conversions (ingredient_id, from_unit, to_unit, factor, label) values
  ('pancake-mix', 'ozw', 'cup', 0.2222222222222222, 'pancake mix ≈ 4.5 oz per cup'),
  ('flour', 'ozw', 'cup', 0.23529411764705882, 'all-purpose flour ≈ 4.25 oz per cup'),
  ('almond-flour', 'ozw', 'cup', 0.29411764705882354, 'almond flour ≈ 3.4 oz per cup'),
  ('sugar', 'ozw', 'cup', 0.14285714285714285, 'granulated sugar ≈ 7 oz per cup'),
  ('butter', 'each', 'tbsp', 8, '1 stick = 8 Tbsp'),
  ('butter', 'lb', 'tbsp', 32, '1 lb = 32 Tbsp (4 sticks)'),
  ('bacon', 'lb', 'slice', 16, 'regular-cut bacon ≈ 16 slices per lb'),
  ('milk', 'gallon', 'cup', 16, '16 cups per gallon'),
  ('rolled-oats', 'ozw', 'cup', 0.3333333333333333, 'rolled oats ≈ 3 oz per cup'),
  ('cheese', 'ozw', 'cup', 0.25, 'shredded cheese ≈ 4 oz per cup'),
  ('rice', 'ozw', 'cup', 0.15384615384615385, 'dry rice ≈ 6.5 oz per cup'),
  ('eggs', 'dozen', 'egg', 12, '12 per dozen'),
  ('cinnamon', 'tsp', 'gram', 2.6, 'ground cinnamon ≈ 2.6 g per tsp'),
  ('parmesan', 'ozw', 'tbsp', 5.67, 'grated parmesan ≈ 5 g per Tbsp'),
  ('chocolate-chips', 'ozw', 'cup', 0.16666666666666666, 'chocolate chips ≈ 6 oz per cup'),
  ('peanut-butter', 'ozw', 'tbsp', 1.77, 'peanut butter ≈ 16 g per Tbsp'),
  ('sunflower-butter', 'ozw', 'tbsp', 1.77, 'sunflower butter ≈ 16 g per Tbsp'),
  ('jelly', 'ozw', 'tbsp', 1.42, 'jelly ≈ 20 g per Tbsp');

insert into public.mm_packages (id, ingredient_id, name, store, price, yield, yield_unit_label, noun, sold_size, sold_unit, note, as_of) values
  ('p-mix-10lb', 'pancake-mix', 'Krusteaz Pancake Mix, 10 lb', 'Costco', 15, 36, null, 'bag', 10, 'lb', '160 oz ÷ 4.5 oz per cup', '2026-07-12'),
  ('p-mix-krus', 'pancake-mix', 'Krusteaz Original, 32 oz', 'Kroger', 6.49, 7, null, 'box', 32, 'ozw', '1 cup = 4.5 oz', '2026-07-12'),
  ('p-mix-hj', 'pancake-mix', 'Hungry Jack, 32 oz', 'Kroger', 5.99, 7, null, 'box', 32, 'ozw', null, '2026-07-12'),
  ('p-mix-kodiak', 'pancake-mix', 'Kodiak Cakes, 30 oz', 'Target', 7.29, 7, null, 'box', 30, 'ozw', null, '2026-06-20'),
  ('p-alm-brm', 'almond-flour', 'Bob’s Red Mill Almond Flour, 1 lb', 'Kroger', 8, 3, null, 'bag', 1, 'lb', null, '2026-07-12'),
  ('p-alm-gv', 'almond-flour', 'Great Value Almond Flour, 2 lb', 'Other', 15, 6, null, 'bag', 2, 'lb', null, '2026-04-18'),
  ('p-alm-costco', 'almond-flour', 'Almond Flour, Blanched, 3 lb', 'Costco', 12.99, 12, null, 'bag', 3, 'lb', null, '2026-07-12'),
  ('p-but-kg', 'butter', 'Kerrygold Butter, 4 sticks (2 lb)', 'Costco', 15, 64, null, 'pack', 2, 'lb', null, '2026-07-12'),
  ('p-but-stick', 'butter', 'Salted butter, 1 stick', 'Kroger', 2, 8, null, 'stick', 1, 'each', null, '2026-08-22'),
  ('p-syr-aj', 'syrup', 'Aunt Jemima Original, 24 oz', 'Kroger', 3.1, 24, null, 'bottle', 24, 'oz', '710 ml', '2026-08-22'),
  ('p-bac-kirk', 'bacon', 'Kirkland Hickory Smoked Bacon, 4 x 1 lb', 'Costco', 18.15, 80, null, 'pack', 4, 'lb', null, '2026-07-12'),
  ('p-bac-om', 'bacon', 'Oscar Mayer Bacon, 16 oz', 'Kroger', 7.49, 16, null, 'pack', 1, 'lb', null, '2026-08-22'),
  ('p-bac-smith', 'bacon', 'Smithfield Thick Cut, 24 oz', 'Kroger', 11.19, 16, null, 'pack', 24, 'ozw', null, '2026-03-20'),
  ('p-sau-jv', 'sausage', 'Johnsonville Breakfast Links', 'Kroger', 5.25, 12, null, 'pack', 12, 'count', null, '2026-08-22'),
  ('p-sau-kro', 'sausage', 'Kroger Links', 'Kroger', 4.99, 12, null, 'pack', 12, 'count', null, '2026-08-22'),
  ('p-egg-mm', 'eggs', 'M&M Range Free Brown Eggs, dozen', 'Outpost', 4.59, 12, null, 'dozen', 1, 'dozen', null, '2026-08-22'),
  ('p-egg-store', 'eggs', 'Store Brand White Eggs, dozen', 'Kroger', 2.99, 12, null, 'dozen', 1, 'dozen', null, '2026-08-22'),
  ('p-egg-brown', 'eggs', 'Brown Eggs, dozen', 'Kroger', 4.29, 12, null, 'dozen', 1, 'dozen', null, '2026-05-30'),
  ('p-ban', 'bananas', 'Banana, each', 'Kroger', 0.25, 1, null, 'each', 1, 'each', null, '2026-08-22'),
  ('p-brd-bs', 'bread', 'Breadsmith Rustic Italian', 'Other', 4.89, 20, null, 'loaf', 1, 'each', null, '2026-06-28'),
  ('p-brd-kro', 'bread', 'Kroger White/Wheat', 'Kroger', 1.99, 20, null, 'loaf', 1, 'each', null, '2026-08-22'),
  ('p-brd-sl', 'bread', 'Sara Lee', 'Kroger', 4.99, 20, null, 'loaf', 1, 'each', null, '2026-04-10'),
  ('p-brd-ps', 'bread', 'Private Selection Artisan', 'Kroger', 4.49, 16, null, 'loaf', 1, 'each', null, '2026-08-22'),
  ('p-gfb-canyon', 'gf-bread', 'Canyon Bakehouse Mountain White', 'Target', 6.39, 20, null, 'loaf', 1, 'each', 'Sold at Target, Outpost', '2026-07-05'),
  ('p-cin-mc', 'cinnamon', 'McCormick Ground Cinnamon, 6 oz', 'Kroger', 4.79, 67, null, 'bottle', 6, 'ozw', null, '2026-07-12'),
  ('p-milk-whole', 'milk', 'Whole Milk, gallon (store brand)', 'Kroger', 5, 16, null, 'gallon', 1, 'gallon', null, '2026-08-22'),
  ('p-milk-2', 'milk', '2% Milk, gallon (store brand)', 'Kroger', 5, 16, null, 'gallon', 1, 'gallon', null, '2026-08-22'),
  ('p-milk-org', 'milk', 'Organic Whole Milk, gallon', 'Kroger', 7, 16, null, 'gallon', 1, 'gallon', null, '2026-08-22'),
  ('p-milk-half', 'milk', 'Whole Milk, half gallon', 'Kroger', 4, 8, null, 'jug', 2, 'quart', null, '2026-08-22'),
  ('p-oat-q', 'oatmeal', 'Quaker Instant Oatmeal, 10 ct', 'Kroger', 5, 10, null, 'box', 10, 'count', null, '2026-08-22'),
  ('p-gfo-q', 'gf-oatmeal', 'Quaker GF Instant Oatmeal, 8 ct', 'Target', 9, 8, null, 'box', 8, 'count', null, '2026-07-05'),
  ('p-cer-cheer', 'cereal', 'Cheerios, family size', 'Kroger', 6.77, 18, null, 'box', 18, 'ozw', null, '2026-08-22'),
  ('p-cer-hbo', 'cereal', 'Honey Bunches of Oats, family size', 'Kroger', 6.25, 18, null, 'box', 18, 'ozw', null, '2026-08-22'),
  ('p-cer-ff', 'cereal', 'Frosted Flakes, family size', 'Kroger', 6.5, 18, null, 'box', 19, 'ozw', null, '2026-02-01'),
  ('p-cer-fl', 'cereal', 'Froot Loops, family size', 'Kroger', 6.73, 18, null, 'box', 18, 'ozw', null, '2026-08-22'),
  ('p-gfc-chex', 'gf-cereal', 'Rice Chex, family size', 'Kroger', 6.77, 18, null, 'box', 18, 'ozw', null, '2026-08-22'),
  ('p-cof-folg', 'coffee', 'Folgers Classic Roast, 9.5 oz', 'Kroger', 6.59, 54, null, 'can', 9.5, 'ozw', 'about 27 cups of coffee', '2026-07-12'),
  ('p-coc-sm', 'cocoa', 'Swiss Miss, 20 packets', 'Kroger', 4, 20, null, 'box', 20, 'count', null, '2026-08-22'),
  ('p-cid-gv', 'cider', 'Great Value Instant Cider Mix, 10 ct', 'Other', 4.56, 10, null, 'box', 10, 'count', 'quick, inexpensive', '2026-08-22'),
  ('p-cid-spice', 'cider', 'Spiced Cider Mix, 10 ct', 'Other', 6, 10, null, 'box', 10, 'count', 'seasonal, sweeter', '2026-08-22'),
  ('p-cid-fresh', 'cider', 'Fresh Apple Cider, 1 gallon', 'Outpost', 9, null, 'gallon', 'gallon', 1, 'gallon', 'fresh', '2026-08-22'),
  ('p-app-fuji', 'apples', 'Fuji apple, each', 'Kroger', 0.8, 1, null, 'each', 1, 'each', null, '2026-08-22'),
  ('p-app-hc', 'apples', 'Honeycrisp apple, each', 'Kroger', 0.9, 1, null, 'each', 1, 'each', null, '2026-08-22'),
  ('p-ora', 'oranges', 'Orange, each', 'Kroger', 0.4, 1, null, 'each', 1, 'each', null, '2026-08-22'),
  ('p-bag-plain', 'bagels', 'Plain Bagels, 6 ct', 'Kroger', 5, 6, null, 'bag', 6, 'count', null, '2026-08-22'),
  ('p-bag-every', 'bagels', 'Everything Bagels, 6 ct', 'Kroger', 4.49, 6, null, 'bag', 6, 'count', null, '2026-08-22'),
  ('p-ket-heinz', 'ketchup', 'Heinz Tomato Ketchup, 32 oz', 'Costco', 4.47, 64, null, 'bottle', 32, 'ozw', null, '2026-07-12'),
  ('p-salt', 'salt', 'Iodized Salt', 'Kroger', 1.99, 300, null, 'box', 26, 'ozw', null, '2026-01-15'),
  ('p-pepper', 'pepper', 'Black Pepper', 'Kroger', 1.99, 300, null, 'can', 4, 'ozw', null, '2026-01-15'),
  ('p-chz-kraft', 'cheese', 'Kraft Shredded Cheddar, 8 oz', 'Kroger', 3.49, 2, null, 'bag', 8, 'ozw', null, '2026-08-22'),
  ('p-flr-gm', 'flour', 'Gold Medal All-Purpose, 5 lb', 'Kroger', 4.29, 19, null, 'bag', 5, 'lb', null, '2026-05-01'),
  ('p-sug-dom', 'sugar', 'Domino Granulated Sugar, 4 lb', 'Kroger', 3.99, 9, null, 'bag', 4, 'lb', null, '2026-08-22'),
  ('p-rice-kirk', 'rice', 'Kirkland Jasmine Rice, 25 lb', 'Costco', 22.99, 61, null, 'bag', 25, 'lb', null, '2026-07-12'),
  ('p-oats-q', 'rolled-oats', 'Quaker Old Fashioned Oats, 42 oz', 'Kroger', 5.49, 14, null, 'canister', 42, 'ozw', null, '2026-08-22'),
  ('p-chk-costco', 'chicken', 'Boneless chicken thighs, ~3 lb tray', 'Costco', 12.5, 48, null, 'tray', 3, 'lb', null, '2026-07-12'),
  ('p-pot-5', 'potatoes', 'Russet potatoes, 5 lb bag', 'Kroger', 3.99, 12, null, 'bag', 5, 'lb', 'about 12 medium', '2026-08-22'),
  ('p-pea-plant', 'peanuts', 'Planters Dry Roasted Peanuts, 16 oz', 'Kroger', 4.99, 3, null, 'jar', 16, 'ozw', null, '2026-08-22'),
  ('p-rai-sm', 'raisins', 'Sun-Maid Raisins, 20 oz', 'Kroger', 4.29, 4, null, 'box', 20, 'ozw', null, '2026-08-22'),
  ('p-mm-costco', 'mms', 'M&M’s Party Size, 38 oz', 'Costco', 9.99, 6, null, 'bag', 38, 'ozw', null, '2026-07-12'),
  ('p-chips-fritos-kro', 'corn-chips', 'Fritos Original, 10 × 1 oz bags', 'Kroger', 6.49, 10, null, 'box', 10, 'count', null, '2026-09-01'),
  ('p-chips-fritos-costco', 'corn-chips', 'Fritos Original, 30 × 1 oz bags', 'Costco', 14.99, 30, null, 'box', 30, 'count', null, '2026-09-01'),
  ('p-beef-kro', 'ground-beef', 'Kroger 80/20 Ground Beef, 1 lb', 'Kroger', 5.49, 16, null, 'pack', 1, 'lb', null, '2026-09-01'),
  ('p-beef-costco', 'ground-beef', 'Kirkland 88/12 Ground Beef, ~3 lb', 'Costco', 15.99, 48, null, 'tray', 3, 'lb', 'sold by weight; price is for about 3 lb', '2026-09-01'),
  ('p-taco-oep', 'taco-seasoning', 'Old El Paso Taco Seasoning, 1 oz packet', 'Kroger', 1.29, 1, null, 'packet', 1, 'each', 'gluten-free', '2026-09-01'),
  ('p-bbeans-bush', 'black-beans', 'Bush''s Black Beans, 15 oz can', 'Kroger', 1.49, 1, null, 'can', 15, 'ozw', null, '2026-09-01'),
  ('p-salsa-pace', 'salsa', 'Pace Chunky Salsa, 24 oz', 'Kroger', 4.29, 48, null, 'jar', 24, 'oz', '24 fl oz = 48 Tbsp', '2026-09-01'),
  ('p-carrot-2lb', 'carrots', 'Carrots, 2 lb bag', 'Kroger', 1.99, 12, null, 'bag', 2, 'lb', 'about 12 medium', '2026-09-01'),
  ('p-onion', 'onions', 'Yellow onion, each', 'Kroger', 0.89, 1, null, 'each', 1, 'each', null, '2026-09-01'),
  ('p-spag-barilla', 'spaghetti', 'Barilla Spaghetti, 1 lb', 'Kroger', 1.79, 16, null, 'box', 1, 'lb', null, '2026-09-01'),
  ('p-spag-costco', 'spaghetti', 'Garofalo Spaghetti, 6 × 1 lb', 'Costco', 10.99, 96, null, 'pack', 6, 'lb', null, '2026-09-01'),
  ('p-gfspag-barilla', 'gf-spaghetti', 'Barilla Gluten Free Spaghetti, 12 oz', 'Kroger', 2.99, 12, null, 'box', 12, 'ozw', null, '2026-09-01'),
  ('p-sauce-prego', 'pasta-sauce', 'Prego Traditional, 24 oz jar', 'Kroger', 2.99, 3, null, 'jar', 24, 'oz', '24 fl oz = 3 cups', '2026-09-01'),
  ('p-sauce-raos', 'pasta-sauce', 'Rao''s Marinara, 2 × 32 oz', 'Costco', 14.99, 8, null, 'pack', 64, 'oz', null, '2026-09-01'),
  ('p-parm-kraft', 'parmesan', 'Kraft Grated Parmesan, 8 oz', 'Kroger', 4.49, 45, null, 'can', 8, 'ozw', '8 oz ≈ 45 Tbsp', '2026-09-01'),
  ('p-tort-mission', 'tortillas', 'Mission Flour Tortillas, 10 ct', 'Kroger', 3.49, 10, null, 'bag', 10, 'count', null, '2026-09-01'),
  ('p-ctort-mission', 'corn-tortillas', 'Mission Corn Tortillas, 30 ct', 'Kroger', 2.99, 30, null, 'bag', 30, 'count', null, '2026-09-01'),
  ('p-peach-delmonte', 'canned-peaches', 'Del Monte Sliced Peaches, 29 oz can', 'Kroger', 2.99, 1, null, 'can', 29, 'ozw', null, '2026-09-01'),
  ('p-cake-dh', 'cake-mix', 'Duncan Hines Yellow Cake Mix, 15.25 oz', 'Kroger', 1.99, 1, null, 'box', 15.25, 'ozw', null, '2026-09-01'),
  ('p-gfcake-ka', 'gf-cake-mix', 'King Arthur Gluten-Free Yellow Cake Mix, 15 oz', 'Kroger', 6.99, 1, null, 'box', 15, 'ozw', null, '2026-09-01'),
  ('p-graham-hm', 'graham-crackers', 'Honey Maid Graham Crackers, 14.4 oz', 'Kroger', 4.29, 27, null, 'box', 14.4, 'ozw', '3 sleeves × 9 sheets', '2026-09-01'),
  ('p-gfgraham-kk', 'gf-graham-crackers', 'Kinnikinnick S''moreables, 8 oz', 'Kroger', 5.99, 16, null, 'box', 8, 'ozw', null, '2026-09-01'),
  ('p-marsh-jp', 'marshmallows', 'Jet-Puffed Marshmallows, 12 oz', 'Kroger', 2.29, 40, null, 'bag', 12, 'ozw', 'about 40 regular', '2026-09-01'),
  ('p-choc-hershey6', 'chocolate-bars', 'Hershey''s Milk Chocolate, 6 × 1.55 oz', 'Kroger', 6.49, 6, null, 'pack', 6, 'count', null, '2026-09-01'),
  ('p-choc-hershey36', 'chocolate-bars', 'Hershey''s Milk Chocolate, 36 × 1.55 oz', 'Costco', 32.99, 36, null, 'box', 36, 'count', null, '2026-09-01'),
  ('p-chips-nestle', 'chocolate-chips', 'Nestlé Toll House Semi-Sweet Morsels, 12 oz', 'Kroger', 3.99, 2, null, 'bag', 12, 'ozw', '12 oz = 2 cups', '2026-09-01'),
  ('p-pb-jif', 'peanut-butter', 'Jif Creamy Peanut Butter, 40 oz', 'Kroger', 7.49, 70, null, 'jar', 40, 'ozw', '40 oz ≈ 70 Tbsp', '2026-09-01'),
  ('p-sunb-sb', 'sunflower-butter', 'SunButter Creamy, 16 oz', 'Kroger', 6.99, 28, null, 'jar', 16, 'ozw', '16 oz ≈ 28 Tbsp', '2026-09-01'),
  ('p-jelly-smk', 'jelly', 'Smucker''s Concord Grape Jelly, 32 oz', 'Kroger', 3.99, 45, null, 'jar', 32, 'ozw', '32 oz ≈ 45 Tbsp', '2026-09-01');

insert into public.mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order) values
  ('B001', 'Pancakes', 'published', '{breakfast}', '{grain}', true, false, 'stove', 'Mix ½ cup mix with ⅓ cup water per person. Cook on a hot griddle until bubbles pop, then flip.', 10),
  ('B005', 'French toast', 'published', '{breakfast}', '{grain,protein}', true, false, 'stove', null, 20),
  ('B006', 'Scrambled eggs', 'published', '{breakfast}', '{protein}', true, false, 'stove', null, 30),
  ('B015', 'Hard-boiled eggs', 'published', '{breakfast,snack}', '{protein}', true, true, 'stove', null, 40),
  ('B014', 'Oatmeal', 'published', '{breakfast}', '{grain}', true, true, 'stove', null, 50),
  ('B011', 'Cold cereal', 'published', '{breakfast}', '{grain,dairy}', true, false, 'no-cook', null, 60),
  ('B003', 'Bacon', 'published', '{breakfast}', '{protein}', true, false, 'stove', null, 70),
  ('B002', 'Sausage', 'published', '{breakfast}', '{protein}', true, false, 'stove', null, 80),
  ('B013', 'Bagels', 'published', '{breakfast,snack}', '{grain}', true, true, 'no-cook', null, 90),
  ('B007', 'Bananas', 'published', '{breakfast,snack}', '{fruit}', true, true, 'no-cook', null, 100),
  ('B017', 'Apples', 'published', '{breakfast,snack}', '{fruit}', true, true, 'no-cook', null, 110),
  ('B016', 'Oranges', 'published', '{breakfast,snack}', '{fruit}', true, true, 'no-cook', null, 120),
  ('B008', 'Hot beverages', 'published', '{breakfast}', '{}', true, true, 'stove', null, 130),
  ('B021', 'Hot cider', 'published', '{breakfast,dessert}', '{}', true, true, 'stove', null, 140),
  ('B023', 'Orange juice', 'published', '{breakfast}', '{fruit}', true, false, 'no-cook', null, 150),
  ('B009', 'Condiments', 'published', '{breakfast,lunch,dinner}', '{}', true, true, 'no-cook', null, 160),
  ('C001', 'Cinnamon rolls', 'draft', '{breakfast,dessert}', '{grain}', true, false, 'dutch-oven', 'Roll the dough thin, spread butter, sugar and cinnamon, roll up and slice. Bake in a Dutch oven with 8 coals under and 16 on top, about 20 minutes.', 170),
  ('L001', 'Grilled cheese', 'published', '{lunch}', '{grain,dairy}', true, false, 'stove', null, 180),
  ('D001', 'Foil-pack chicken & potatoes', 'published', '{dinner}', '{protein,veg}', true, false, 'foil', 'One packet per person: chicken, sliced potato, butter, salt and pepper. Seal in heavy foil. 20–25 minutes on coals, turn once.', 190),
  ('S001', 'Trail mix', 'published', '{snack}', '{protein,fruit}', true, true, 'no-cook', null, 200),
  ('L002', 'Walking tacos', 'published', '{lunch,dinner}', '{grain,protein,dairy}', true, false, 'stove', 'Brown the beef with the seasoning packet and a splash of water. Crush the chips in the bag, cut the bag open along the side, and spoon in the meat (or beans), cheese and salsa. Eat it out of the bag with a fork.', 210),
  ('L003', 'Quesadillas', 'published', '{lunch}', '{grain,dairy}', true, false, 'stove', 'Butter the pan, lay down a tortilla, cover with cheese, top with a second tortilla. Flip when golden. Cut in wedges; salsa on the side.', 220),
  ('L004', 'PB&J sandwiches', 'published', '{lunch}', '{grain,protein}', true, true, 'no-cook', null, 230),
  ('D002', 'Hobo dinner foil packs', 'published', '{dinner}', '{protein,veg}', true, false, 'foil', 'Per person: a patty of ground beef, a sliced potato, a sliced carrot, a few onion rings, a pat of butter, salt and pepper. Double-wrap in heavy foil and seal the seams. 25–30 minutes on coals, turn at 15.', 240),
  ('D003', 'Spaghetti with meat sauce', 'published', '{dinner}', '{grain,protein}', true, false, 'stove', 'Boil a big pot of water with a spoon of salt. Brown the beef, stir in the sauce and keep it warm. Cook the pasta until just tender (gluten-free pasta in its own pot), drain, and serve with sauce and parmesan.', 250),
  ('X001', 'Dutch-oven peach cobbler', 'published', '{dessert}', '{fruit,grain}', true, false, 'dutch-oven', 'Pour the peaches (juice and all) into a lined Dutch oven. Sprinkle the dry cake mix evenly on top, dot with butter and dust with cinnamon. Lid on: 8 coals under, 16 on top, about 40 minutes until the top is golden.', 260),
  ('X002', 'S''mores', 'published', '{dessert}', '{grain}', true, true, 'other', 'Toast a marshmallow over coals until golden. Sandwich it with a few squares of chocolate between two graham squares. Two per person.', 270),
  ('X003', 'Banana boats', 'published', '{dessert}', '{fruit}', true, false, 'foil', 'Slit the banana lengthwise through the peel, not all the way through. Stuff with chocolate chips and marshmallows, wrap in foil, 5–8 minutes on coals.', 280),
  ('S002', 'Apples & peanut butter', 'published', '{snack}', '{fruit,protein}', true, true, 'no-cook', null, 290);

insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restriction) values
  ('B001', 1, 'pancake-mix', 0.5, null, 'except', 'gf'),
  ('B001', 2, 'almond-flour', 1, null, 'only', 'gf'),
  ('B001', 3, 'eggs', 1, null, 'only', 'gf'),
  ('B001', 4, 'bananas', 0.5, null, 'only', 'gf'),
  ('B001', 5, 'butter', 0.5, null, 'everyone', null),
  ('B001', 6, 'syrup', 1, null, 'everyone', null),
  ('B005', 1, 'bread', 2.5, null, 'except', 'gf'),
  ('B005', 2, 'gf-bread', 2, null, 'only', 'gf'),
  ('B005', 3, 'eggs', 2, null, 'everyone', null),
  ('B005', 4, 'milk', 0.125, null, 'everyone', null),
  ('B005', 5, 'cinnamon', 2.6, null, 'everyone', null),
  ('B005', 6, 'syrup', 1, null, 'everyone', null),
  ('B006', 1, 'eggs', 2.5, null, 'everyone', null),
  ('B015', 1, 'eggs', 2, null, 'everyone', null),
  ('B014', 1, 'oatmeal', 1, null, 'except', 'gf'),
  ('B014', 2, 'gf-oatmeal', 1, null, 'only', 'gf'),
  ('B011', 1, 'cereal', 1, null, 'except', 'gf'),
  ('B011', 2, 'gf-cereal', 1, null, 'only', 'gf'),
  ('B011', 3, 'milk', 0.5, null, 'everyone', null),
  ('B003', 1, 'bacon', 3, null, 'everyone', null),
  ('B002', 1, 'sausage', 2.5, null, 'everyone', null),
  ('B013', 1, 'bagels', 1, null, 'everyone', null),
  ('B007', 1, 'bananas', 0.5, null, 'everyone', null),
  ('B017', 1, 'apples', 0.25, null, 'everyone', null),
  ('B016', 1, 'oranges', 0.25, null, 'everyone', null),
  ('B008', 1, 'coffee', 2, null, 'everyone', null),
  ('B008', 2, 'cocoa', 1, null, 'everyone', null),
  ('B021', 1, 'cider', 1, null, 'everyone', null),
  ('B023', 1, 'oj', 1, null, 'everyone', null),
  ('B009', 1, 'ketchup', 0.25, null, 'everyone', null),
  ('B009', 2, 'salt', 0.25, null, 'everyone', null),
  ('B009', 3, 'pepper', 0.25, null, 'everyone', null),
  ('C001', 1, 'flour', 0, null, 'everyone', null),
  ('C001', 2, 'sugar', 2, 'tbsp', 'everyone', null),
  ('C001', 3, 'cinnamon', 0.5, 'tsp', 'everyone', null),
  ('C001', 4, 'butter', 1, null, 'everyone', null),
  ('L001', 1, 'bread', 2, null, 'except', 'gf'),
  ('L001', 2, 'gf-bread', 2, null, 'only', 'gf'),
  ('L001', 3, 'cheese', 0.25, null, 'everyone', null),
  ('L001', 4, 'butter', 1, null, 'everyone', null),
  ('D001', 1, 'chicken', 6, null, 'except', 'veg'),
  ('D001', 2, 'potatoes', 1, null, 'everyone', null),
  ('D001', 3, 'butter', 1, null, 'everyone', null),
  ('D001', 4, 'salt', 0.25, null, 'everyone', null),
  ('D001', 5, 'pepper', 0.25, null, 'everyone', null),
  ('S001', 1, 'peanuts', 0.25, null, 'everyone', null),
  ('S001', 2, 'raisins', 0.25, null, 'everyone', null),
  ('S001', 3, 'mms', 0.25, null, 'everyone', null),
  ('L002', 1, 'corn-chips', 1, null, 'everyone', null),
  ('L002', 2, 'ground-beef', 4, null, 'except', 'veg'),
  ('L002', 3, 'black-beans', 0.5, null, 'only', 'veg'),
  ('L002', 4, 'taco-seasoning', 0.25, null, 'everyone', null),
  ('L002', 5, 'cheese', 0.25, null, 'everyone', null),
  ('L002', 6, 'salsa', 2, null, 'everyone', null),
  ('L003', 1, 'tortillas', 2, null, 'except', 'gf'),
  ('L003', 2, 'corn-tortillas', 3, null, 'only', 'gf'),
  ('L003', 3, 'cheese', 0.5, null, 'everyone', null),
  ('L003', 4, 'salsa', 2, null, 'everyone', null),
  ('L003', 5, 'butter', 1, null, 'everyone', null),
  ('L004', 1, 'bread', 2, null, 'except', 'gf'),
  ('L004', 2, 'gf-bread', 2, null, 'only', 'gf'),
  ('L004', 3, 'peanut-butter', 2, null, 'except', 'nut'),
  ('L004', 4, 'sunflower-butter', 2, null, 'only', 'nut'),
  ('L004', 5, 'jelly', 1, null, 'everyone', null),
  ('D002', 1, 'ground-beef', 5, null, 'except', 'veg'),
  ('D002', 2, 'black-beans', 0.5, null, 'only', 'veg'),
  ('D002', 3, 'potatoes', 1, null, 'everyone', null),
  ('D002', 4, 'carrots', 1, null, 'everyone', null),
  ('D002', 5, 'onions', 0.25, null, 'everyone', null),
  ('D002', 6, 'butter', 1, null, 'everyone', null),
  ('D002', 7, 'salt', 0.25, null, 'everyone', null),
  ('D002', 8, 'pepper', 0.25, null, 'everyone', null),
  ('D003', 1, 'spaghetti', 4, null, 'except', 'gf'),
  ('D003', 2, 'gf-spaghetti', 4, null, 'only', 'gf'),
  ('D003', 3, 'ground-beef', 3, null, 'except', 'veg'),
  ('D003', 4, 'pasta-sauce', 0.5, null, 'everyone', null),
  ('D003', 5, 'parmesan', 1, null, 'everyone', null),
  ('D003', 6, 'salt', 0.5, null, 'everyone', null),
  ('X001', 1, 'canned-peaches', 0.25, null, 'everyone', null),
  ('X001', 2, 'cake-mix', 0.125, null, 'except', 'gf'),
  ('X001', 3, 'gf-cake-mix', 0.125, null, 'only', 'gf'),
  ('X001', 4, 'butter', 1, null, 'everyone', null),
  ('X001', 5, 'cinnamon', 0.25, 'tsp', 'everyone', null),
  ('X002', 1, 'graham-crackers', 2, null, 'except', 'gf'),
  ('X002', 2, 'gf-graham-crackers', 2, null, 'only', 'gf'),
  ('X002', 3, 'marshmallows', 2, null, 'everyone', null),
  ('X002', 4, 'chocolate-bars', 1, null, 'everyone', null),
  ('X003', 1, 'bananas', 1, null, 'everyone', null),
  ('X003', 2, 'chocolate-chips', 0.125, null, 'everyone', null),
  ('X003', 3, 'marshmallows', 3, null, 'everyone', null),
  ('S002', 1, 'apples', 0.5, null, 'everyone', null),
  ('S002', 2, 'peanut-butter', 2, null, 'except', 'nut'),
  ('S002', 3, 'sunflower-butter', 2, null, 'only', 'nut');

-- ── The shelf card on /library — TopicShelves() reads this row, no code change. ─
insert into public.library_topics (slug, title, blurb_md, icon, sort_order) values
  ('menu-monster', 'Menu Monster', 'Plan a patrol meal for the Cooking merit badge: pick the menu, set who''s eating, get a shopping list with the cost per person, and print it for the store.', '🍳', 60)
on conflict (slug) do nothing;
