-- Menu Monster scout workspace, slice 5 (Shopping tab): the menu-wide shopping
-- list merges every meal's needs before choosing packages, so the scout's
-- package picks, typed quantities and bring-from-home choices belong to the
-- MENU, not to a meal. They ride as one jsonb object
-- { packageChoice, qtyOverride, lineSource } (the planner's own Plan shapes).
--
-- Menus saved before this slice keep those fields inside meals[]; the app
-- folds them into `shopping` on read (first non-empty value per ingredient
-- wins) and stops writing them, so no data migration is needed.
--
-- DEPLOY ORDER: DB-first. Additive column with a default; the old code never
-- selects it, the new code selects and writes it.

alter table public.mm_menus
  add column shopping jsonb not null default '{}'::jsonb
    check (jsonb_typeof(shopping) = 'object');
