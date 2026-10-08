-- Menu Monster gear: a fourth place gear lives, the Chef kit (Patrick, 2026-10-08).
-- Additive: widens the check on mm_gear.home; existing rows are untouched. Push DB-first, then the code.

alter table public.mm_gear drop constraint if exists mm_gear_home_check;
alter table public.mm_gear
  add constraint mm_gear_home_check check (home in ('patrol_box', 'trailer', 'chef_kit', 'home'));
