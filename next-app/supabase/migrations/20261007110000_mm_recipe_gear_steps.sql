-- Menu Monster data: gear and steps on the troop's 29 recipes, and six store-room staples
-- (Plans/Menu-Monster-Brands-Gear.md, release 2). Drafted 2026-10-03 and reviewed by Patrick
-- (D:\Projects\Troop Menu Monster\data\recipe-gear-steps-draft.md): griddles for pancakes / French toast /
-- grilled cheese, a kettle for hot water, the charcoal chimney only with the Dutch oven, foil packs on the
-- campfire. Gear names are the troop gear list's own (mm_gear), so the Gear tab adds them up.
--
-- Consumables are NOT gear (Patrick): heavy foil, charcoal, paper towels, cooking oil, zip bags and Dutch
-- oven liners become ingredients flagged staple (the troop's store room: counted in Used, never Spent) with
-- one package each, and a line on the recipes that use them. Their prices are ESTIMATES (the package note
-- says so) until a leader corrects them.
--
-- Data only and idempotent: a recipe is matched by id and only the troop's own (author_person_id is null);
-- a staple, its package and its recipe line are added only when missing. Cinnamon rolls (C001) stays a draft.
--
-- DEPLOY ORDER: after 20261007100000_mm_gear (the gear list). No code depends on these rows.

update public.mm_recipes set equipment = array['Camp stove', 'Griddle', 'Mixing bowl', 'Whisk', 'Measuring cups', 'Spatula']::text[], steps_md = 'Mix ½ cup mix with ⅓ cup water per person.
Heat the griddle and wipe it with a little butter.
Pour, and cook until the bubbles pop, then flip.
Gluten-free: mash the banana with the egg and almond flour, and cook it first on a clean griddle.', updated_at = now()
  where id = 'B001' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Griddle', 'Mixing bowl', 'Whisk', 'Spatula', 'Measuring cups']::text[], steps_md = 'Whisk the eggs, milk and cinnamon in the bowl.
Heat the griddle and butter it.
Dip each slice on both sides and let the extra drip off.
Cook until golden, about 2 minutes a side.
Gluten-free bread: dip and cook it first, before the regular bread touches the bowl or griddle.', updated_at = now()
  where id = 'B005' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Skillet', 'Mixing bowl', 'Whisk', 'Spatula']::text[], steps_md = 'Crack the eggs into the bowl and whisk with a pinch of salt.
Melt a little butter in the skillet over medium heat.
Pour in the eggs and stir slowly until just set. Take them off the heat while still a little shiny.', updated_at = now()
  where id = 'B006' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Large pot', 'Long tongs', 'Cooler']::text[], steps_md = 'Put the eggs in the pot and cover with cold water.
Bring to a boil, then turn off the stove and cover for 12 minutes.
Move the eggs to cold water. Peel when cool. Keep leftovers in the cooler.', updated_at = now()
  where id = 'B015' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Kettle']::text[], steps_md = 'Boil water in the kettle.
Empty a packet into your bowl and add about ⅔ cup hot water.
Stir and wait one minute.', updated_at = now()
  where id = 'B014' and author_person_id is null;
update public.mm_recipes set equipment = array['Cooler']::text[], steps_md = 'Keep the milk in the cooler until serving.
Pour cereal, then milk. Gluten-free cereal is served from its own box.', updated_at = now()
  where id = 'B011' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Skillet', 'Long tongs', 'Cooler']::text[], steps_md = 'Lay the slices in a cold skillet, then turn the stove to medium.
Turn with tongs until crisp, 8–10 minutes.
Drain on paper towels. Pour the grease into a can, never on the ground or the fire.', updated_at = now()
  where id = 'B003' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Skillet', 'Long tongs', 'Cooler']::text[], steps_md = 'Cook the links over medium heat, turning often, 10–12 minutes.
Cut one open: no pink in the middle.
Drain on paper towels.', updated_at = now()
  where id = 'B002' and author_person_id is null;
update public.mm_recipes set equipment = array['Cutting board', 'Knife', 'Butter knife']::text[], steps_md = 'Slice the bagels in half on the cutting board.
Set out with butter or peanut butter.', updated_at = now()
  where id = 'B013' and author_person_id is null;
update public.mm_recipes set equipment = array[]::text[], steps_md = 'Half a banana each. Cut them in half in the peel.', updated_at = now()
  where id = 'B007' and author_person_id is null;
update public.mm_recipes set equipment = array['Cutting board', 'Knife']::text[], steps_md = 'Wash the apples.
Cut into quarters and cut out the core.', updated_at = now()
  where id = 'B017' and author_person_id is null;
update public.mm_recipes set equipment = array['Cutting board', 'Knife']::text[], steps_md = 'Wash the oranges.
Cut into quarters with the peel on.', updated_at = now()
  where id = 'B016' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Kettle', 'Coffee pot']::text[], steps_md = 'Boil water in the kettle for cocoa: one packet per cup.
Coffee for the adults: 2 tablespoons of grounds per cup in the coffee pot.', updated_at = now()
  where id = 'B008' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Kettle']::text[], steps_md = 'Boil water in the kettle.
One packet per cup. Stir.', updated_at = now()
  where id = 'B021' and author_person_id is null;
update public.mm_recipes set equipment = array['Cooler']::text[], steps_md = 'Keep it in the cooler until serving. Shake before pouring.', updated_at = now()
  where id = 'B023' and author_person_id is null;
update public.mm_recipes set equipment = array[]::text[], steps_md = 'Set out ketchup, salt and pepper with the meal. Put them back in the patrol box after.', updated_at = now()
  where id = 'B009' and author_person_id is null;
update public.mm_recipes set equipment = array['Dutch oven (12 in)', 'Charcoal chimney', 'Long tongs', 'Lid lifter', 'Leather gloves', 'Mixing bowl', 'Measuring cups', 'Cutting board', 'Knife']::text[], steps_md = 'Roll the dough thin.
Spread butter, sugar and cinnamon. Roll up and slice.
Bake in a Dutch oven with 8 coals under and 16 on top, about 20 minutes.', updated_at = now()
  where id = 'C001' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Griddle', 'Spatula', 'Butter knife']::text[], steps_md = 'Butter one side of each slice of bread.
Put a slice butter-side down on a medium griddle, add cheese, top with a second slice butter-side up.
Flip when golden. Done when the cheese melts.
Gluten-free bread: cook it first on a clean griddle.', updated_at = now()
  where id = 'L001' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Skillet', 'Spatula', 'Serving spoon', 'Can opener', 'Cooler']::text[], steps_md = 'Brown the beef with the seasoning packet and a splash of water.
Vegetarian: warm the black beans in their own pot.
Crush the chips in the bag and cut the bag open along the side.
Spoon in the meat (or beans), cheese and salsa. Eat it out of the bag with a fork.', updated_at = now()
  where id = 'L002' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Skillet', 'Spatula', 'Cutting board', 'Knife', 'Cooler']::text[], steps_md = 'Butter the pan and lay down a tortilla.
Cover with cheese and top with a second tortilla.
Flip when golden.
Cut in wedges. Salsa on the side.', updated_at = now()
  where id = 'L003' and author_person_id is null;
update public.mm_recipes set equipment = array['Butter knife', 'Cutting board']::text[], steps_md = 'Spread peanut butter on one slice and jelly on the other. Use a different knife for each jar.
Nut-free: make those sandwiches first with sunflower seed butter, on a clean board with a clean knife.', updated_at = now()
  where id = 'L004' and author_person_id is null;
update public.mm_recipes set equipment = array['Long tongs', 'Leather gloves', 'Cutting board', 'Knife', 'Cooler']::text[], steps_md = 'One packet per person: chicken, sliced potato, butter, salt and pepper.
Seal in heavy foil.
20–25 minutes on campfire coals, turning once.
Open one packet and check: the chicken is white all the way through, with no pink.
Wash the board, the knife and your hands after cutting raw chicken.', updated_at = now()
  where id = 'D001' and author_person_id is null;
update public.mm_recipes set equipment = array['Long tongs', 'Leather gloves', 'Cutting board', 'Knife', 'Can opener', 'Cooler']::text[], steps_md = 'Per person: a patty of ground beef, a sliced potato, a sliced carrot, a few onion rings, a pat of butter, salt and pepper.
Double-wrap in heavy foil and seal the seams.
25–30 minutes on campfire coals, turning at 15.', updated_at = now()
  where id = 'D002' and author_person_id is null;
update public.mm_recipes set equipment = array['Camp stove', 'Large pot', 'Skillet', 'Colander', 'Long tongs', 'Spatula', 'Ladle', 'Can opener', 'Cooler']::text[], steps_md = 'Boil a big pot of water with a spoon of salt.
Brown the beef, stir in the sauce and keep it warm.
Cook the pasta until just tender (gluten-free pasta in its own pot), then drain.
Serve with sauce and parmesan.', updated_at = now()
  where id = 'D003' and author_person_id is null;
update public.mm_recipes set equipment = array['Mixing bowl', 'Measuring cups', 'Serving spoon']::text[], steps_md = 'Mix equal parts peanuts, raisins and M&M’s in the bowl.
Scoop about ¾ cup into a bag for each person.', updated_at = now()
  where id = 'S001' and author_person_id is null;
update public.mm_recipes set equipment = array['Cutting board', 'Knife', 'Butter knife']::text[], steps_md = 'Wash and quarter the apples and cut out the cores.
Two tablespoons of peanut butter each, for dipping.
Nut-free: sunflower seed butter, with its own knife.', updated_at = now()
  where id = 'S002' and author_person_id is null;
update public.mm_recipes set equipment = array['Dutch oven (12 in)', 'Charcoal chimney', 'Long tongs', 'Lid lifter', 'Leather gloves', 'Can opener', 'Serving spoon']::text[], steps_md = 'Pour the peaches, juice and all, into a lined Dutch oven.
Sprinkle the dry cake mix evenly on top. Do not stir.
Dot with butter and dust with cinnamon.
Lid on: 8 coals under, 16 on top, about 40 minutes until the top is golden.', updated_at = now()
  where id = 'X001' and author_person_id is null;
update public.mm_recipes set equipment = array['Roasting sticks']::text[], steps_md = 'Toast a marshmallow over coals until golden.
Sandwich it with a few squares of chocolate between two graham squares.
Two per person.', updated_at = now()
  where id = 'X002' and author_person_id is null;
update public.mm_recipes set equipment = array['Long tongs', 'Leather gloves', 'Knife']::text[], steps_md = 'Slit the banana lengthwise through the peel, not all the way through.
Stuff with chocolate chips and marshmallows.
Wrap in foil. 5–8 minutes on coals.', updated_at = now()
  where id = 'X003' and author_person_id is null;

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid)
select 'heavy-foil', 'Heavy foil', 'count', 'count', 'sheet', 'sheets', 'dry', true, '{}'::text[]
where not exists (select 1 from public.mm_ingredients where id = 'heavy-foil' or lower(name) = lower('Heavy foil'));
insert into public.mm_packages (id, ingredient_id, name, price, anchor_price, yield, noun, as_of, note)
select 'p-heavy-foil', 'heavy-foil', 'Heavy duty foil, 50 sq ft', 6.49, 6.49, 30, 'pack', current_date, 'Estimated price — check at the store.'
where exists (select 1 from public.mm_ingredients where id = 'heavy-foil')
  and not exists (select 1 from public.mm_packages where ingredient_id = 'heavy-foil');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'D001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'D001'), 0) + 1, 'heavy-foil', 1, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'D001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'heavy-foil')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'D001' and ingredient_id = 'heavy-foil');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'D002', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'D002'), 0) + 1, 'heavy-foil', 2, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'D002' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'heavy-foil')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'D002' and ingredient_id = 'heavy-foil');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'X003', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'X003'), 0) + 1, 'heavy-foil', 1, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'X003' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'heavy-foil')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'X003' and ingredient_id = 'heavy-foil');

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid)
select 'charcoal', 'Charcoal', 'count', 'count', 'briquette', 'briquettes', 'dry', true, '{}'::text[]
where not exists (select 1 from public.mm_ingredients where id = 'charcoal' or lower(name) = lower('Charcoal'));
insert into public.mm_packages (id, ingredient_id, name, price, anchor_price, yield, noun, as_of, note)
select 'p-charcoal', 'charcoal', 'Charcoal briquettes, 16 lb', 12.99, 12.99, 250, 'pack', current_date, 'Estimated price — check at the store.'
where exists (select 1 from public.mm_ingredients where id = 'charcoal')
  and not exists (select 1 from public.mm_packages where ingredient_id = 'charcoal');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'C001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'C001'), 0) + 1, 'charcoal', 3, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'C001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'charcoal')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'C001' and ingredient_id = 'charcoal');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'X001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'X001'), 0) + 1, 'charcoal', 3, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'X001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'charcoal')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'X001' and ingredient_id = 'charcoal');

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid)
select 'paper-towels', 'Paper towels', 'count', 'count', 'sheet', 'sheets', 'dry', true, '{}'::text[]
where not exists (select 1 from public.mm_ingredients where id = 'paper-towels' or lower(name) = lower('Paper towels'));
insert into public.mm_packages (id, ingredient_id, name, price, anchor_price, yield, noun, as_of, note)
select 'p-paper-towels', 'paper-towels', 'Paper towels, 6 rolls', 8.99, 8.99, 600, 'pack', current_date, 'Estimated price — check at the store.'
where exists (select 1 from public.mm_ingredients where id = 'paper-towels')
  and not exists (select 1 from public.mm_packages where ingredient_id = 'paper-towels');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'B001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'B001'), 0) + 1, 'paper-towels', 0.25, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'B001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'paper-towels')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'B001' and ingredient_id = 'paper-towels');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'B003', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'B003'), 0) + 1, 'paper-towels', 0.5, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'B003' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'paper-towels')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'B003' and ingredient_id = 'paper-towels');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'B002', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'B002'), 0) + 1, 'paper-towels', 0.5, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'B002' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'paper-towels')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'B002' and ingredient_id = 'paper-towels');

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid)
select 'cooking-oil', 'Cooking oil', 'volume', 'tbsp', 'Tbsp', 'Tbsp', 'dry', true, '{}'::text[]
where not exists (select 1 from public.mm_ingredients where id = 'cooking-oil' or lower(name) = lower('Cooking oil'));
insert into public.mm_packages (id, ingredient_id, name, price, anchor_price, yield, noun, as_of, note)
select 'p-cooking-oil', 'cooking-oil', 'Vegetable oil, 48 oz', 4.49, 4.49, 96, 'pack', current_date, 'Estimated price — check at the store.'
where exists (select 1 from public.mm_ingredients where id = 'cooking-oil')
  and not exists (select 1 from public.mm_packages where ingredient_id = 'cooking-oil');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'B001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'B001'), 0) + 1, 'cooking-oil', 0.25, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'B001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'cooking-oil')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'B001' and ingredient_id = 'cooking-oil');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'B005', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'B005'), 0) + 1, 'cooking-oil', 0.25, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'B005' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'cooking-oil')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'B005' and ingredient_id = 'cooking-oil');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'B006', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'B006'), 0) + 1, 'cooking-oil', 0.25, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'B006' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'cooking-oil')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'B006' and ingredient_id = 'cooking-oil');

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid)
select 'zip-bags', 'Zip bags', 'count', 'count', 'bag', 'bags', 'dry', true, '{}'::text[]
where not exists (select 1 from public.mm_ingredients where id = 'zip-bags' or lower(name) = lower('Zip bags'));
insert into public.mm_packages (id, ingredient_id, name, price, anchor_price, yield, noun, as_of, note)
select 'p-zip-bags', 'zip-bags', 'Sandwich zip bags, 100 ct', 3.99, 3.99, 100, 'pack', current_date, 'Estimated price — check at the store.'
where exists (select 1 from public.mm_ingredients where id = 'zip-bags')
  and not exists (select 1 from public.mm_packages where ingredient_id = 'zip-bags');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'S001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'S001'), 0) + 1, 'zip-bags', 1, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'S001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'zip-bags')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'S001' and ingredient_id = 'zip-bags');

insert into public.mm_ingredients (id, name, unit_kind, unit_key, unit_one, unit_many, section, staple, avoid)
select 'dutch-oven-liners', 'Dutch oven liners', 'count', 'count', 'liner', 'liners', 'dry', true, '{}'::text[]
where not exists (select 1 from public.mm_ingredients where id = 'dutch-oven-liners' or lower(name) = lower('Dutch oven liners'));
insert into public.mm_packages (id, ingredient_id, name, price, anchor_price, yield, noun, as_of, note)
select 'p-dutch-oven-liners', 'dutch-oven-liners', 'Dutch oven liners, 3 ct', 7.99, 7.99, 3, 'pack', current_date, 'Estimated price — check at the store.'
where exists (select 1 from public.mm_ingredients where id = 'dutch-oven-liners')
  and not exists (select 1 from public.mm_packages where ingredient_id = 'dutch-oven-liners');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'C001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'C001'), 0) + 1, 'dutch-oven-liners', 0.125, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'C001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'dutch-oven-liners')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'C001' and ingredient_id = 'dutch-oven-liners');
insert into public.mm_recipe_lines (recipe_id, position, ingredient_id, qty_per_person, unit_key, serves_rule, serves_restrictions)
select 'X001', coalesce((select max(position) from public.mm_recipe_lines where recipe_id = 'X001'), 0) + 1, 'dutch-oven-liners', 0.125, null, 'everyone', '{}'::text[]
where exists (select 1 from public.mm_recipes where id = 'X001' and author_person_id is null)
  and exists (select 1 from public.mm_ingredients where id = 'dutch-oven-liners')
  and not exists (select 1 from public.mm_recipe_lines where recipe_id = 'X001' and ingredient_id = 'dutch-oven-liners');

