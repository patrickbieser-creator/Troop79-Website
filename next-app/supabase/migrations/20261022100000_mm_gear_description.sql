-- A gear item can carry a description (Patrick, 2026-10-06: "Things like Chef Kit, Mess Kit, Cook Kit, Camp Stove
-- would benefit from a description of the items in those kits, a description of where it can be found, a
-- description of size. I'm not sure where this information will be displayed in MM, but we should start
-- capturing it"). Captured on the admin Gear tab; nothing else reads it yet.
--
-- DEPLOY ORDER: DB-first (additive; the new code selects it).

alter table public.mm_gear add column if not exists description text;
comment on column public.mm_gear.description is 'What is in it, where it is found, its size — free text from the Gear tab.';
