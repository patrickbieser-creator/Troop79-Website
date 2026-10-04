-- Menu Monster stores Patrick asked for (2026-10-03): Metro Market, Pick 'n
-- Save, Trader Joe's, Aldi (Costco is already on the list). Data only and
-- idempotent: a name already present (any case, retired or not) is left alone.
-- New stores go after the existing ones; "Other" stays last. The list is then
-- maintained in Admin > Lookups & Admin > Menu Monster stores.
--
-- DEPLOY ORDER: none — no code depends on these rows.

insert into public.mm_stores (name, sort_order)
select v.name,
       (select coalesce(max(sort_order), 0) from public.mm_stores where lower(name) <> 'other') + 10 * v.ord
from (values ('Metro Market', 1), ('Pick ''n Save', 2), ('Trader Joe''s', 3), ('Aldi', 4), ('Costco', 5)) as v(name, ord)
where not exists (select 1 from public.mm_stores m where lower(m.name) = lower(v.name));

update public.mm_stores
set sort_order = (select max(sort_order) from public.mm_stores) + 10
where lower(name) = 'other'
  and sort_order < (select max(sort_order) from public.mm_stores);
