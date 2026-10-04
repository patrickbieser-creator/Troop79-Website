-- Menu Monster brands (Plans/Menu-Monster-Brands-Gear.md, release 3).
--
-- Ingredient → BRANDS → packages. A brand is a brand or a varietal (Chips Ahoy, Fuji, Whole, Thick cut); a
-- package is a size of it at a store, with a price. A meal plan can ask for an ingredient with any brand, or
-- name one or several; the shopper may override; what was bought is recorded against a brand.
--
--   1. mm_brands            (ingredient, name, optional diet override, who added it, retired / merged)
--   2. mm_packages.brand_id / size_label
--   3. the one-time split of today's packages into brand + size — Patrick, 2026-10-03: "make a reasonable
--      guess as to the split and apply. It's just as easy to correct it after you're done."
--      (D:\Projects\Troop Menu Monster\data\package-brand-split.json; corrections happen in Admin › Catalog.)
--   4. mm_add_brand         a brand anyone signed in types joins the troop's list AT ONCE (no review —
--                           Patrick). Case and punctuation are ignored when matching, so "chips ahoy!" finds
--                           "Chips Ahoy". An adult can remove it in admin.
--   5. mm_merge_brand       one brand into another on the same ingredient: its packages move, it is retired
--                           and remembered as an alias, so menus that chose it now show the kept brand.
--
-- DEPLOY ORDER: DB-first. Additive; the new code selects mm_brands and the two new package columns.
-- Posture (D-239): RLS on with zero policies; EXECUTE revoked from anon / authenticated.

create table if not exists public.mm_brands (
  id text primary key,
  ingredient_id text not null references public.mm_ingredients(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Lower case, letters and digits only: what "the same brand" means when someone types one.
  match_key text generated always as (regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')) stored,
  -- null = the ingredient's own diet flags; otherwise this brand's (Rice Chex is gluten-free, cereal is not). Leaders only.
  avoid text[] check (avoid is null or avoid <@ array['gf', 'nut', 'dairy', 'veg']),
  added_by_person_id bigint references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  merged_into_id text references public.mm_brands(id) on delete set null,
  constraint mm_brands_merged_chk check (merged_into_id is null or (retired_at is not null and merged_into_id <> id))
);
create unique index if not exists mm_brands_ingredient_match_key on public.mm_brands (ingredient_id, match_key) where retired_at is null;
create index if not exists mm_brands_ingredient_idx on public.mm_brands (ingredient_id);
alter table public.mm_brands enable row level security;

alter table public.mm_packages
  add column if not exists brand_id text references public.mm_brands(id) on delete set null,
  add column if not exists size_label text check (size_label is null or char_length(size_label) <= 60);
create index if not exists mm_packages_brand_idx on public.mm_packages (brand_id);

-- ── 3. The split ───────────────────────────────────────────────────────────
-- Idempotent: a brand is inserted once per (ingredient, name); a package takes its brand and size only while
-- it has none, so a leader's later correction is never overwritten by re-running this.

insert into public.mm_brands (id, ingredient_id, name)
select 'b-all-purpose-flour-gold-medal', i.id, 'Gold Medal' from public.mm_ingredients i
where lower(i.name) = lower('All-purpose flour') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-all-purpose-flour-gold-medal')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Gold Medal'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-almond-flour-kirkland', i.id, 'Kirkland' from public.mm_ingredients i
where lower(i.name) = lower('Almond flour') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-almond-flour-kirkland')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kirkland'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-almond-flour-bob-s-red-mill', i.id, 'Bob''s Red Mill' from public.mm_ingredients i
where lower(i.name) = lower('Almond flour') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-almond-flour-bob-s-red-mill')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Bob''s Red Mill'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-almond-flour-great-value', i.id, 'Great Value' from public.mm_ingredients i
where lower(i.name) = lower('Almond flour') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-almond-flour-great-value')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Great Value'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-apples-fuji', i.id, 'Fuji' from public.mm_ingredients i
where lower(i.name) = lower('Apples') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-apples-fuji')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Fuji'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-apples-honeycrisp', i.id, 'Honeycrisp' from public.mm_ingredients i
where lower(i.name) = lower('Apples') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-apples-honeycrisp')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Honeycrisp'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bacon-kirkland-hickory-smoked', i.id, 'Kirkland Hickory Smoked' from public.mm_ingredients i
where lower(i.name) = lower('Bacon') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bacon-kirkland-hickory-smoked')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kirkland Hickory Smoked'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bacon-oscar-mayer', i.id, 'Oscar Mayer' from public.mm_ingredients i
where lower(i.name) = lower('Bacon') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bacon-oscar-mayer')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Oscar Mayer'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bacon-smithfield-thick-cut', i.id, 'Smithfield Thick Cut' from public.mm_ingredients i
where lower(i.name) = lower('Bacon') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bacon-smithfield-thick-cut')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Smithfield Thick Cut'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bagels-everything', i.id, 'Everything' from public.mm_ingredients i
where lower(i.name) = lower('Bagels') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bagels-everything')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Everything'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bagels-plain', i.id, 'Plain' from public.mm_ingredients i
where lower(i.name) = lower('Bagels') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bagels-plain')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Plain'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-black-beans-bush-s', i.id, 'Bush''s' from public.mm_ingredients i
where lower(i.name) = lower('Black beans') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-black-beans-bush-s')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Bush''s'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bread-breadsmith-rustic-italian', i.id, 'Breadsmith Rustic Italian' from public.mm_ingredients i
where lower(i.name) = lower('Bread') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bread-breadsmith-rustic-italian')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Breadsmith Rustic Italian'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bread-kroger-white-wheat', i.id, 'Kroger White/Wheat' from public.mm_ingredients i
where lower(i.name) = lower('Bread') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bread-kroger-white-wheat')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kroger White/Wheat'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bread-private-selection-artisan', i.id, 'Private Selection Artisan' from public.mm_ingredients i
where lower(i.name) = lower('Bread') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bread-private-selection-artisan')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Private Selection Artisan'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-bread-sara-lee', i.id, 'Sara Lee' from public.mm_ingredients i
where lower(i.name) = lower('Bread') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-bread-sara-lee')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Sara Lee'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-butter-kerrygold', i.id, 'Kerrygold' from public.mm_ingredients i
where lower(i.name) = lower('Butter') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-butter-kerrygold')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kerrygold'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-butter-salted', i.id, 'Salted' from public.mm_ingredients i
where lower(i.name) = lower('Butter') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-butter-salted')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Salted'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-chicken-thighs-boneless', i.id, 'Boneless' from public.mm_ingredients i
where lower(i.name) = lower('Chicken thighs') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-chicken-thighs-boneless')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Boneless'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-chocolate-bars-hershey-s-milk-chocolate', i.id, 'Hershey''s Milk Chocolate' from public.mm_ingredients i
where lower(i.name) = lower('Chocolate bars') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-chocolate-bars-hershey-s-milk-chocolate')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Hershey''s Milk Chocolate'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-chocolate-chips-nestle-toll-house-semi-sweet', i.id, 'Nestlé Toll House Semi-Sweet' from public.mm_ingredients i
where lower(i.name) = lower('Chocolate chips') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-chocolate-chips-nestle-toll-house-semi-sweet')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Nestlé Toll House Semi-Sweet'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-cinnamon-mccormick', i.id, 'McCormick' from public.mm_ingredients i
where lower(i.name) = lower('Cinnamon') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-cinnamon-mccormick')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('McCormick'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-cold-cereal-cheerios', i.id, 'Cheerios' from public.mm_ingredients i
where lower(i.name) = lower('Cold cereal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-cold-cereal-cheerios')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Cheerios'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-cold-cereal-froot-loops', i.id, 'Froot Loops' from public.mm_ingredients i
where lower(i.name) = lower('Cold cereal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-cold-cereal-froot-loops')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Froot Loops'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-cold-cereal-frosted-flakes', i.id, 'Frosted Flakes' from public.mm_ingredients i
where lower(i.name) = lower('Cold cereal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-cold-cereal-frosted-flakes')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Frosted Flakes'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-cold-cereal-honey-bunches-of-oats', i.id, 'Honey Bunches of Oats' from public.mm_ingredients i
where lower(i.name) = lower('Cold cereal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-cold-cereal-honey-bunches-of-oats')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Honey Bunches of Oats'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-corn-chips-fritos-original', i.id, 'Fritos Original' from public.mm_ingredients i
where lower(i.name) = lower('Corn chips') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-corn-chips-fritos-original')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Fritos Original'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-corn-tortillas-mission', i.id, 'Mission' from public.mm_ingredients i
where lower(i.name) = lower('Corn tortillas') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-corn-tortillas-mission')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Mission'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-eggs-brown', i.id, 'Brown' from public.mm_ingredients i
where lower(i.name) = lower('Eggs') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-eggs-brown')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Brown'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-eggs-m-m-range-free-brown', i.id, 'M&M Range Free Brown' from public.mm_ingredients i
where lower(i.name) = lower('Eggs') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-eggs-m-m-range-free-brown')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('M&M Range Free Brown'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-eggs-store-brand-white', i.id, 'Store brand white' from public.mm_ingredients i
where lower(i.name) = lower('Eggs') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-eggs-store-brand-white')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Store brand white'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-flour-tortillas-mission', i.id, 'Mission' from public.mm_ingredients i
where lower(i.name) = lower('Flour tortillas') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-flour-tortillas-mission')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Mission'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-bread-canyon-bakehouse-mountain-white', i.id, 'Canyon Bakehouse Mountain White' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free bread') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-bread-canyon-bakehouse-mountain-white')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Canyon Bakehouse Mountain White'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-cereal-nature-s-path-mesa-sunrise', i.id, 'Nature''s Path Mesa Sunrise' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free cereal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-cereal-nature-s-path-mesa-sunrise')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Nature''s Path Mesa Sunrise'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-cereal-rice-chex', i.id, 'Rice Chex' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free cereal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-cereal-rice-chex')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Rice Chex'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-graham-crackers-kinnikinnick-s-moreables', i.id, 'Kinnikinnick S''moreables' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free graham crackers') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-graham-crackers-kinnikinnick-s-moreables')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kinnikinnick S''moreables'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-oatmeal-quaker', i.id, 'Quaker' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free oatmeal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-oatmeal-quaker')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Quaker'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-spaghetti-barilla', i.id, 'Barilla' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free spaghetti') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-spaghetti-barilla')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Barilla'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-gluten-free-yellow-cake-mix-king-arthur', i.id, 'King Arthur' from public.mm_ingredients i
where lower(i.name) = lower('Gluten-free yellow cake mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-gluten-free-yellow-cake-mix-king-arthur')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('King Arthur'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-graham-crackers-honey-maid', i.id, 'Honey Maid' from public.mm_ingredients i
where lower(i.name) = lower('Graham crackers') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-graham-crackers-honey-maid')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Honey Maid'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-grape-jelly-smucker-s', i.id, 'Smucker''s' from public.mm_ingredients i
where lower(i.name) = lower('Grape jelly') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-grape-jelly-smucker-s')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Smucker''s'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-grated-parmesan-kraft', i.id, 'Kraft' from public.mm_ingredients i
where lower(i.name) = lower('Grated parmesan') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-grated-parmesan-kraft')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kraft'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-ground-beef-kirkland-88-12', i.id, 'Kirkland 88/12' from public.mm_ingredients i
where lower(i.name) = lower('Ground beef') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-ground-beef-kirkland-88-12')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kirkland 88/12'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-ground-beef-kroger-80-20', i.id, 'Kroger 80/20' from public.mm_ingredients i
where lower(i.name) = lower('Ground beef') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-ground-beef-kroger-80-20')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kroger 80/20'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-ground-coffee-folgers-classic-roast', i.id, 'Folgers Classic Roast' from public.mm_ingredients i
where lower(i.name) = lower('Ground coffee') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-ground-coffee-folgers-classic-roast')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Folgers Classic Roast'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-hot-cider-mix-fresh-apple-cider', i.id, 'Fresh apple cider' from public.mm_ingredients i
where lower(i.name) = lower('Hot cider mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-hot-cider-mix-fresh-apple-cider')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Fresh apple cider'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-hot-cider-mix-great-value', i.id, 'Great Value' from public.mm_ingredients i
where lower(i.name) = lower('Hot cider mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-hot-cider-mix-great-value')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Great Value'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-hot-cider-mix-spiced', i.id, 'Spiced' from public.mm_ingredients i
where lower(i.name) = lower('Hot cider mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-hot-cider-mix-spiced')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Spiced'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-hot-cocoa-swiss-miss', i.id, 'Swiss Miss' from public.mm_ingredients i
where lower(i.name) = lower('Hot cocoa') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-hot-cocoa-swiss-miss')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Swiss Miss'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-instant-oatmeal-quaker', i.id, 'Quaker' from public.mm_ingredients i
where lower(i.name) = lower('Instant oatmeal') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-instant-oatmeal-quaker')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Quaker'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-ketchup-heinz', i.id, 'Heinz' from public.mm_ingredients i
where lower(i.name) = lower('Ketchup') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-ketchup-heinz')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Heinz'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-marshmallows-jet-puffed', i.id, 'Jet-Puffed' from public.mm_ingredients i
where lower(i.name) = lower('Marshmallows') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-marshmallows-jet-puffed')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Jet-Puffed'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-milk-2', i.id, '2%' from public.mm_ingredients i
where lower(i.name) = lower('Milk') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-milk-2')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('2%'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-milk-organic-whole', i.id, 'Organic whole' from public.mm_ingredients i
where lower(i.name) = lower('Milk') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-milk-organic-whole')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Organic whole'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-milk-whole', i.id, 'Whole' from public.mm_ingredients i
where lower(i.name) = lower('Milk') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-milk-whole')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Whole'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-onions-yellow', i.id, 'Yellow' from public.mm_ingredients i
where lower(i.name) = lower('Onions') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-onions-yellow')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Yellow'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-pancake-mix-hungry-jack', i.id, 'Hungry Jack' from public.mm_ingredients i
where lower(i.name) = lower('Pancake mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-pancake-mix-hungry-jack')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Hungry Jack'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-pancake-mix-kodiak-cakes', i.id, 'Kodiak Cakes' from public.mm_ingredients i
where lower(i.name) = lower('Pancake mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-pancake-mix-kodiak-cakes')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kodiak Cakes'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-pancake-mix-krusteaz', i.id, 'Krusteaz' from public.mm_ingredients i
where lower(i.name) = lower('Pancake mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-pancake-mix-krusteaz')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Krusteaz'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-pasta-sauce-prego-traditional', i.id, 'Prego Traditional' from public.mm_ingredients i
where lower(i.name) = lower('Pasta sauce') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-pasta-sauce-prego-traditional')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Prego Traditional'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-pasta-sauce-rao-s-marinara', i.id, 'Rao''s Marinara' from public.mm_ingredients i
where lower(i.name) = lower('Pasta sauce') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-pasta-sauce-rao-s-marinara')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Rao''s Marinara'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-peanut-butter-jif-creamy', i.id, 'Jif Creamy' from public.mm_ingredients i
where lower(i.name) = lower('Peanut butter') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-peanut-butter-jif-creamy')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Jif Creamy'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-peanuts-planters-dry-roasted', i.id, 'Planters Dry Roasted' from public.mm_ingredients i
where lower(i.name) = lower('Peanuts') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-peanuts-planters-dry-roasted')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Planters Dry Roasted'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-potatoes-russet', i.id, 'Russet' from public.mm_ingredients i
where lower(i.name) = lower('Potatoes') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-potatoes-russet')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Russet'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-raisins-sun-maid', i.id, 'Sun-Maid' from public.mm_ingredients i
where lower(i.name) = lower('Raisins') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-raisins-sun-maid')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Sun-Maid'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-rice-kirkland-jasmine', i.id, 'Kirkland Jasmine' from public.mm_ingredients i
where lower(i.name) = lower('Rice') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-rice-kirkland-jasmine')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kirkland Jasmine'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-rolled-oats-quaker-old-fashioned', i.id, 'Quaker Old Fashioned' from public.mm_ingredients i
where lower(i.name) = lower('Rolled oats') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-rolled-oats-quaker-old-fashioned')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Quaker Old Fashioned'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-salsa-pace-chunky', i.id, 'Pace Chunky' from public.mm_ingredients i
where lower(i.name) = lower('Salsa') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-salsa-pace-chunky')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Pace Chunky'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-sausage-links-johnsonville', i.id, 'Johnsonville' from public.mm_ingredients i
where lower(i.name) = lower('Sausage links') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-sausage-links-johnsonville')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Johnsonville'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-sausage-links-kroger', i.id, 'Kroger' from public.mm_ingredients i
where lower(i.name) = lower('Sausage links') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-sausage-links-kroger')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kroger'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-shredded-cheddar-kraft', i.id, 'Kraft' from public.mm_ingredients i
where lower(i.name) = lower('Shredded cheddar') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-shredded-cheddar-kraft')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Kraft'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-sliced-peaches-del-monte', i.id, 'Del Monte' from public.mm_ingredients i
where lower(i.name) = lower('Sliced peaches') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-sliced-peaches-del-monte')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Del Monte'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-spaghetti-barilla', i.id, 'Barilla' from public.mm_ingredients i
where lower(i.name) = lower('Spaghetti') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-spaghetti-barilla')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Barilla'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-spaghetti-garofalo', i.id, 'Garofalo' from public.mm_ingredients i
where lower(i.name) = lower('Spaghetti') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-spaghetti-garofalo')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Garofalo'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-sugar-domino', i.id, 'Domino' from public.mm_ingredients i
where lower(i.name) = lower('Sugar') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-sugar-domino')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Domino'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-sunflower-seed-butter-sunbutter-creamy', i.id, 'SunButter Creamy' from public.mm_ingredients i
where lower(i.name) = lower('Sunflower seed butter') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-sunflower-seed-butter-sunbutter-creamy')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('SunButter Creamy'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-syrup-aunt-jemima-original', i.id, 'Aunt Jemima Original' from public.mm_ingredients i
where lower(i.name) = lower('Syrup') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-syrup-aunt-jemima-original')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Aunt Jemima Original'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-taco-seasoning-old-el-paso', i.id, 'Old El Paso' from public.mm_ingredients i
where lower(i.name) = lower('Taco seasoning') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-taco-seasoning-old-el-paso')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Old El Paso'), '[^a-z0-9]+', '', 'g'));
insert into public.mm_brands (id, ingredient_id, name)
select 'b-yellow-cake-mix-duncan-hines', i.id, 'Duncan Hines' from public.mm_ingredients i
where lower(i.name) = lower('Yellow cake mix') and i.added_by_person_id is null
  and not exists (select 1 from public.mm_brands x where x.id = 'b-yellow-cake-mix-duncan-hines')
  and not exists (select 1 from public.mm_brands x where x.ingredient_id = i.id and x.retired_at is null
                  and x.match_key = regexp_replace(lower('Duncan Hines'), '[^a-z0-9]+', '', 'g'));

update public.mm_packages set size_label = coalesce(size_label, '5 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-all-purpose-flour-gold-medal')) where id = 'p-flr-gm';
update public.mm_packages set size_label = coalesce(size_label, '3 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-almond-flour-kirkland')) where id = 'p-alm-costco';
update public.mm_packages set size_label = coalesce(size_label, '1 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-almond-flour-bob-s-red-mill')) where id = 'p-alm-brm';
update public.mm_packages set size_label = coalesce(size_label, '2 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-almond-flour-great-value')) where id = 'p-alm-gv';
update public.mm_packages set size_label = coalesce(size_label, 'each'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-apples-fuji')) where id = 'p-app-fuji';
update public.mm_packages set size_label = coalesce(size_label, 'each'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-apples-honeycrisp')) where id = 'p-app-hc';
update public.mm_packages set size_label = coalesce(size_label, '4 × 1 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bacon-kirkland-hickory-smoked')) where id = 'p-bac-kirk';
update public.mm_packages set size_label = coalesce(size_label, '16 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bacon-oscar-mayer')) where id = 'p-bac-om';
update public.mm_packages set size_label = coalesce(size_label, '24 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bacon-smithfield-thick-cut')) where id = 'p-bac-smith';
update public.mm_packages set size_label = coalesce(size_label, '6 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bagels-everything')) where id = 'p-bag-every';
update public.mm_packages set size_label = coalesce(size_label, '6 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bagels-plain')) where id = 'p-bag-plain';
update public.mm_packages set size_label = coalesce(size_label, 'each') where id = 'p-ban';
update public.mm_packages set size_label = coalesce(size_label, '15 oz can'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-black-beans-bush-s')) where id = 'p-bbeans-bush';
update public.mm_packages set size_label = coalesce(size_label, '4 oz') where id = 'p-pepper';
update public.mm_packages set size_label = coalesce(size_label, 'loaf'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bread-breadsmith-rustic-italian')) where id = 'p-brd-bs';
update public.mm_packages set size_label = coalesce(size_label, 'loaf'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bread-kroger-white-wheat')) where id = 'p-brd-kro';
update public.mm_packages set size_label = coalesce(size_label, 'loaf'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bread-private-selection-artisan')) where id = 'p-brd-ps';
update public.mm_packages set size_label = coalesce(size_label, 'loaf'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-bread-sara-lee')) where id = 'p-brd-sl';
update public.mm_packages set size_label = coalesce(size_label, '4 sticks (2 lb)'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-butter-kerrygold')) where id = 'p-but-kg';
update public.mm_packages set size_label = coalesce(size_label, '1 stick'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-butter-salted')) where id = 'p-but-stick';
update public.mm_packages set size_label = coalesce(size_label, '2 lb bag') where id = 'p-carrot-2lb';
update public.mm_packages set size_label = coalesce(size_label, 'about 3 lb tray'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-chicken-thighs-boneless')) where id = 'p-chk-costco';
update public.mm_packages set size_label = coalesce(size_label, '36 × 1.55 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-chocolate-bars-hershey-s-milk-chocolate')) where id = 'p-choc-hershey36';
update public.mm_packages set size_label = coalesce(size_label, '6 × 1.55 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-chocolate-bars-hershey-s-milk-chocolate')) where id = 'p-choc-hershey6';
update public.mm_packages set size_label = coalesce(size_label, '12 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-chocolate-chips-nestle-toll-house-semi-sweet')) where id = 'p-chips-nestle';
update public.mm_packages set size_label = coalesce(size_label, '6 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-cinnamon-mccormick')) where id = 'p-cin-mc';
update public.mm_packages set size_label = coalesce(size_label, 'family size (18 oz)'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-cold-cereal-cheerios')) where id = 'p-cer-cheer';
update public.mm_packages set size_label = coalesce(size_label, 'family size (18 oz)'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-cold-cereal-froot-loops')) where id = 'p-cer-fl';
update public.mm_packages set size_label = coalesce(size_label, 'family size (19 oz)'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-cold-cereal-frosted-flakes')) where id = 'p-cer-ff';
update public.mm_packages set size_label = coalesce(size_label, 'family size (18 oz)'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-cold-cereal-honey-bunches-of-oats')) where id = 'p-cer-hbo';
update public.mm_packages set size_label = coalesce(size_label, '10 × 1 oz bags'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-corn-chips-fritos-original')) where id = 'p-chips-fritos-kro';
update public.mm_packages set size_label = coalesce(size_label, '30 × 1 oz bags'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-corn-chips-fritos-original')) where id = 'p-chips-fritos-costco';
update public.mm_packages set size_label = coalesce(size_label, '30 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-corn-tortillas-mission')) where id = 'p-ctort-mission';
update public.mm_packages set size_label = coalesce(size_label, 'dozen'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-eggs-brown')) where id = 'p-egg-brown';
update public.mm_packages set size_label = coalesce(size_label, 'dozen'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-eggs-m-m-range-free-brown')) where id = 'p-egg-mm';
update public.mm_packages set size_label = coalesce(size_label, 'dozen'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-eggs-store-brand-white')) where id = 'p-egg-store';
update public.mm_packages set size_label = coalesce(size_label, '10 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-flour-tortillas-mission')) where id = 'p-tort-mission';
update public.mm_packages set size_label = coalesce(size_label, 'loaf'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-bread-canyon-bakehouse-mountain-white')) where id = 'p-gfb-canyon';
update public.mm_packages set size_label = coalesce(size_label, '26.4 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-cereal-nature-s-path-mesa-sunrise')) where id = 'p-nature-s-path-mesa-sunrise';
update public.mm_packages set size_label = coalesce(size_label, 'family size (18 oz)'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-cereal-rice-chex')) where id = 'p-gfc-chex';
update public.mm_packages set size_label = coalesce(size_label, '8 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-graham-crackers-kinnikinnick-s-moreables')) where id = 'p-gfgraham-kk';
update public.mm_packages set size_label = coalesce(size_label, '8 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-oatmeal-quaker')) where id = 'p-gfo-q';
update public.mm_packages set size_label = coalesce(size_label, '12 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-spaghetti-barilla')) where id = 'p-gfspag-barilla';
update public.mm_packages set size_label = coalesce(size_label, '15 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-gluten-free-yellow-cake-mix-king-arthur')) where id = 'p-gfcake-ka';
update public.mm_packages set size_label = coalesce(size_label, '14.4 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-graham-crackers-honey-maid')) where id = 'p-graham-hm';
update public.mm_packages set size_label = coalesce(size_label, '32 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-grape-jelly-smucker-s')) where id = 'p-jelly-smk';
update public.mm_packages set size_label = coalesce(size_label, '8 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-grated-parmesan-kraft')) where id = 'p-parm-kraft';
update public.mm_packages set size_label = coalesce(size_label, 'about 3 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-ground-beef-kirkland-88-12')) where id = 'p-beef-costco';
update public.mm_packages set size_label = coalesce(size_label, '1 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-ground-beef-kroger-80-20')) where id = 'p-beef-kro';
update public.mm_packages set size_label = coalesce(size_label, '9.5 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-ground-coffee-folgers-classic-roast')) where id = 'p-cof-folg';
update public.mm_packages set size_label = coalesce(size_label, '1 gallon'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-hot-cider-mix-fresh-apple-cider')) where id = 'p-cid-fresh';
update public.mm_packages set size_label = coalesce(size_label, '10 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-hot-cider-mix-great-value')) where id = 'p-cid-gv';
update public.mm_packages set size_label = coalesce(size_label, '10 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-hot-cider-mix-spiced')) where id = 'p-cid-spice';
update public.mm_packages set size_label = coalesce(size_label, '20 packets'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-hot-cocoa-swiss-miss')) where id = 'p-coc-sm';
update public.mm_packages set size_label = coalesce(size_label, '10 ct'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-instant-oatmeal-quaker')) where id = 'p-oat-q';
update public.mm_packages set size_label = coalesce(size_label, '32 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-ketchup-heinz')) where id = 'p-ket-heinz';
update public.mm_packages set size_label = coalesce(size_label, 'party size (38 oz)') where id = 'p-mm-costco';
update public.mm_packages set size_label = coalesce(size_label, '12 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-marshmallows-jet-puffed')) where id = 'p-marsh-jp';
update public.mm_packages set size_label = coalesce(size_label, 'gallon'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-milk-2')) where id = 'p-milk-2';
update public.mm_packages set size_label = coalesce(size_label, 'gallon'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-milk-organic-whole')) where id = 'p-milk-org';
update public.mm_packages set size_label = coalesce(size_label, 'gallon'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-milk-whole')) where id = 'p-milk-whole';
update public.mm_packages set size_label = coalesce(size_label, 'half gallon'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-milk-whole')) where id = 'p-milk-half';
update public.mm_packages set size_label = coalesce(size_label, 'each'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-onions-yellow')) where id = 'p-onion';
update public.mm_packages set size_label = coalesce(size_label, 'each') where id = 'p-ora';
update public.mm_packages set size_label = coalesce(size_label, '32 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-pancake-mix-hungry-jack')) where id = 'p-mix-hj';
update public.mm_packages set size_label = coalesce(size_label, '30 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-pancake-mix-kodiak-cakes')) where id = 'p-mix-kodiak';
update public.mm_packages set size_label = coalesce(size_label, '32 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-pancake-mix-krusteaz')) where id = 'p-mix-krus';
update public.mm_packages set size_label = coalesce(size_label, '10 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-pancake-mix-krusteaz')) where id = 'p-mix-10lb';
update public.mm_packages set size_label = coalesce(size_label, '24 oz jar'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-pasta-sauce-prego-traditional')) where id = 'p-sauce-prego';
update public.mm_packages set size_label = coalesce(size_label, '2 × 32 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-pasta-sauce-rao-s-marinara')) where id = 'p-sauce-raos';
update public.mm_packages set size_label = coalesce(size_label, '40 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-peanut-butter-jif-creamy')) where id = 'p-pb-jif';
update public.mm_packages set size_label = coalesce(size_label, '16 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-peanuts-planters-dry-roasted')) where id = 'p-pea-plant';
update public.mm_packages set size_label = coalesce(size_label, '5 lb bag'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-potatoes-russet')) where id = 'p-pot-5';
update public.mm_packages set size_label = coalesce(size_label, '20 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-raisins-sun-maid')) where id = 'p-rai-sm';
update public.mm_packages set size_label = coalesce(size_label, '25 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-rice-kirkland-jasmine')) where id = 'p-rice-kirk';
update public.mm_packages set size_label = coalesce(size_label, '42 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-rolled-oats-quaker-old-fashioned')) where id = 'p-oats-q';
update public.mm_packages set size_label = coalesce(size_label, '24 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-salsa-pace-chunky')) where id = 'p-salsa-pace';
update public.mm_packages set size_label = coalesce(size_label, '26 oz') where id = 'p-salt';
update public.mm_packages set size_label = coalesce(size_label, '12 links'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-sausage-links-johnsonville')) where id = 'p-sau-jv';
update public.mm_packages set size_label = coalesce(size_label, '12 links'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-sausage-links-kroger')) where id = 'p-sau-kro';
update public.mm_packages set size_label = coalesce(size_label, '8 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-shredded-cheddar-kraft')) where id = 'p-chz-kraft';
update public.mm_packages set size_label = coalesce(size_label, '29 oz can'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-sliced-peaches-del-monte')) where id = 'p-peach-delmonte';
update public.mm_packages set size_label = coalesce(size_label, '1 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-spaghetti-barilla')) where id = 'p-spag-barilla';
update public.mm_packages set size_label = coalesce(size_label, '6 × 1 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-spaghetti-garofalo')) where id = 'p-spag-costco';
update public.mm_packages set size_label = coalesce(size_label, '4 lb'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-sugar-domino')) where id = 'p-sug-dom';
update public.mm_packages set size_label = coalesce(size_label, '16 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-sunflower-seed-butter-sunbutter-creamy')) where id = 'p-sunb-sb';
update public.mm_packages set size_label = coalesce(size_label, '24 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-syrup-aunt-jemima-original')) where id = 'p-syr-aj';
update public.mm_packages set size_label = coalesce(size_label, '1 oz packet'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-taco-seasoning-old-el-paso')) where id = 'p-taco-oep';
update public.mm_packages set size_label = coalesce(size_label, '15.25 oz'), brand_id = coalesce(brand_id, (select id from public.mm_brands where id = 'b-yellow-cake-mix-duncan-hines')) where id = 'p-cake-dh';

-- ── 4. mm_add_brand ────────────────────────────────────────────────────────
-- Returns { id, created }: the live brand that already matches, or a new xb-<hex> one. A person may have at
-- most 40 brands of their own that nobody has priced yet (a typo storm stops there, not the troop's list).
-- The ingredient must be one the caller can see: the troop's own, one a share revealed, or their own typed-in.

create or replace function public.mm_add_brand(p_person bigint, p_ingredient text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_key text := regexp_replace(lower(v_name), '[^a-z0-9]+', '', 'g');
  v_id text;
  v_count integer;
begin
  if p_person is null then
    raise exception 'MM_SIGN_IN_REQUIRED';
  end if;
  if char_length(v_name) < 1 or char_length(v_key) < 1 or not mm_scout_text_ok(v_name, 60) then
    raise exception 'MM_BAD_TEXT: brand';
  end if;
  if not exists (select 1 from mm_ingredients i where i.id = p_ingredient and i.retired_at is null
                 and (i.added_by_person_id is null or i.shared_at is not null or i.added_by_person_id = p_person)) then
    raise exception 'MM_BAD_BRAND: ingredient';
  end if;
  -- One person's adds run one at a time (the cap), and so do adds to one ingredient (the match).
  perform pg_advisory_xact_lock(hashtextextended('mm_brand_person', p_person));
  perform pg_advisory_xact_lock(hashtextextended('mm_brand', hashtext(p_ingredient)));
  select id into v_id from mm_brands where ingredient_id = p_ingredient and match_key = v_key and retired_at is null;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;
  select count(*) into v_count from mm_brands b
  where b.added_by_person_id = p_person and b.retired_at is null
    and not exists (select 1 from mm_packages p where p.brand_id = b.id and p.retired_at is null);
  if v_count >= 40 then
    raise exception 'MM_BRAND_CAP';
  end if;
  v_id := 'xb-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  insert into mm_brands (id, ingredient_id, name, added_by_person_id) values (v_id, p_ingredient, v_name, p_person);
  return jsonb_build_object('id', v_id, 'created', true);
end;
$$;

revoke execute on function public.mm_add_brand(bigint, text, text) from public, anon, authenticated;

-- ── 5. mm_merge_brand ──────────────────────────────────────────────────────
-- p_from into p_to (same ingredient, both live): packages move, p_from is retired and points at p_to.
-- Returns how many packages moved.

create or replace function public.mm_merge_brand(p_from text, p_to text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from mm_brands%rowtype;
  v_to mm_brands%rowtype;
  v_moved integer;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'MM_BAD_MERGE: same brand';
  end if;
  perform 1 from mm_brands where id in (p_from, p_to) order by id for update;
  select * into v_from from mm_brands where id = p_from;
  select * into v_to from mm_brands where id = p_to;
  if v_from.id is null or v_to.id is null or v_from.retired_at is not null or v_to.retired_at is not null
     or v_from.ingredient_id <> v_to.ingredient_id then
    raise exception 'MM_BAD_MERGE: brands';
  end if;
  update mm_packages set brand_id = p_to where brand_id = p_from;
  get diagnostics v_moved = row_count;
  update mm_brands set retired_at = now(), merged_into_id = p_to where id = p_from;
  -- An earlier merge INTO p_from now follows it to p_to.
  update mm_brands set merged_into_id = p_to where merged_into_id = p_from;
  return v_moved;
end;
$$;

revoke execute on function public.mm_merge_brand(text, text) from public, anon, authenticated;
