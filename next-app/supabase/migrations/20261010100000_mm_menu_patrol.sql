-- Menu Monster: a menu belongs to a patrol (Plans/Menu-Monster-Brands-Gear.md, release 5). Patrick,
-- 2026-10-03: gear is planned per patrol, and the troop shops together — so an outing has one menu per patrol
-- and one shopping list merged across them. A small outing planned for everyone is one menu whose patrol
-- reads "Whole troop". Free text (the Plan tab suggests the troop's patrol names); null = not said.
--
-- DEPLOY ORDER: DB-first. Additive; the new code selects mm_menus.patrol.

alter table public.mm_menus add column if not exists patrol text;
do $$ begin
  alter table public.mm_menus add constraint mm_menus_patrol_check check (patrol is null or char_length(btrim(patrol)) between 1 and 40);
exception when duplicate_object then null; end $$;
