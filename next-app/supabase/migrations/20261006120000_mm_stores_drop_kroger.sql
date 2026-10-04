-- Menu Monster: there is no Kroger near Milwaukee (Patrick, 2026-10-03). Every
-- package bought at Kroger moves to Metro Market and Kroger leaves the store
-- list. Data only and idempotent. Product names are left as typed ("Kroger
-- Links" is a brand on the label, sold at Metro Market and Pick 'n Save).
--
-- DEPLOY ORDER: none — no code names a store.

insert into public.mm_stores (name, sort_order)
select 'Metro Market', (select coalesce(max(sort_order), 0) + 10 from public.mm_stores)
where not exists (select 1 from public.mm_stores where lower(name) = 'metro market');

update public.mm_packages set store = 'Metro Market' where lower(btrim(store)) = 'kroger';

delete from public.mm_stores where lower(name) = 'kroger';
