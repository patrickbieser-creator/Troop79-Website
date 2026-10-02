-- Menu Monster scout workspace, slice 4 second pass: a menu stores how many days
-- it spans, so "Add a day" is a saved, dirty-gated edit instead of page-local
-- state. The app keeps day_count >= (last meal's day + 1); existing menus read
-- back through that floor, so the default of 2 never hides a meal.
--
-- DEPLOY ORDER: DB-first. Additive column with a default; the old code never
-- selects it, the new code selects and writes it.

alter table public.mm_menus
  add column day_count integer not null default 2 check (day_count between 1 and 14);
