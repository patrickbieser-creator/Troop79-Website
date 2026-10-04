-- Menu Monster: any signed-in person can ask for an ingredient to be added to
-- the price book from the public Ingredients tab (Patrick, 2026-10-03).
--
-- A request is a 4B typed-in (x- ingredient + xp- package, mm_create_typed_in:
-- one validator, one 10-unmatched cap) with `submitted_at` set. It stays
-- private to the person who asked — never in anyone else's catalog — until a
-- leader decides in admin (Scout recipes > New ingredients):
--   Keep as new   it joins the price book (needs_match_at cleared, shared_at set);
--   Match…        it becomes an alias of a book ingredient (mm_match_ingredient);
--   Reject        removed; or, if its author's own recipe or menu uses it, an
--                 ordinary private typed-in again (mm_reject_ingredient).
-- A leader's own request is kept at once by the action (no review).
--
--   1. mm_ingredients.submitted_at
--   2. mm_submit_ingredient      lock + mm_create_typed_in + submitted_at
--   3. mm_drop_orphan_typed_ins  never drops a request waiting for a leader
--   4. mm_reject_ingredient      a leader's Reject: stops waiting, removed when unused
--
-- DEPLOY ORDER: DB-first. Additive column + new function + a same-signature
-- replacement; the new code selects submitted_at. Posture (D-239): EXECUTE
-- revoked from anon/authenticated.

alter table public.mm_ingredients add column if not exists submitted_at timestamptz;

comment on column public.mm_ingredients.submitted_at is
  'Set when its author asked a leader to add it to the price book (public Ingredients tab). Cleared by a leader''s Reject.';

create or replace function public.mm_submit_ingredient(p_person bigint, p_new jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));
  v_id := mm_create_typed_in(p_person, p_new);
  update mm_ingredients set submitted_at = now() where id = v_id;
  return v_id;
end;
$$;

revoke execute on function public.mm_submit_ingredient(bigint, jsonb) from public, anon, authenticated;

-- The 20261005100000 body plus one condition: `i.submitted_at is null`.
create or replace function public.mm_drop_orphan_typed_ins(p_person bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[];
begin
  -- The scout's own saves already hold this lock (re-entrant); menu save / delete calls take it here.
  perform pg_advisory_xact_lock(hashtextextended('mm_scout_recipe', p_person));
  select coalesce(array_agg(i.id), '{}') into v_ids from mm_ingredients i
  where i.added_by_person_id = p_person and i.shared_at is null and i.needs_match_at is not null
    and i.submitted_at is null
    and i.created_at < now() - interval '24 hours'
    and not exists (select 1 from mm_recipe_lines l where l.ingredient_id = i.id)
    and not exists (select 1 from mm_variation_lines v where v.ingredient_id = i.id or v.base_ingredient_id = i.id)
    and not exists (select 1 from mm_conversions c where c.ingredient_id = i.id)
    and not exists (
      select 1 from mm_menus m
      where m.owner_person_id = p_person
        and position(('"' || i.id || '"') in (m.meals::text || m.shopping::text || m.actuals::text)) > 0
    );
  delete from mm_packages p
  where p.ingredient_id = any (v_ids)
    and not exists (select 1 from mm_price_history h where h.package_id = p.id);
  delete from mm_ingredients i
  where i.id = any (v_ids)
    and not exists (select 1 from mm_packages p where p.ingredient_id = i.id);
end;
$$;

revoke execute on function public.mm_drop_orphan_typed_ins(bigint) from public, anon, authenticated;

-- ── 4. mm_reject_ingredient ────────────────────────────────────────────────
-- A leader's Reject of a request nothing shared uses. The request stops
-- waiting; and when nothing of its author's uses it (no recipe line, no menu)
-- it is removed at once, so a rejected request never holds the author's
-- 10-waiting cap or its name (an adult has no menu save to run the orphan
-- cleanup). Returns its name, or null when it is no longer a pending request.

create or replace function public.mm_reject_ingredient(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row mm_ingredients%rowtype;
begin
  select * into v_row from mm_ingredients
  where id = p_id and needs_match_at is not null and submitted_at is not null and shared_at is null and retired_at is null
  for update;
  if not found then
    return null;
  end if;
  update mm_ingredients set submitted_at = null where id = p_id;
  if not exists (select 1 from mm_recipe_lines l where l.ingredient_id = p_id)
     and not exists (select 1 from mm_variation_lines v where v.ingredient_id = p_id or v.base_ingredient_id = p_id)
     and not exists (select 1 from mm_conversions c where c.ingredient_id = p_id)
     and not exists (
       select 1 from mm_menus m
       where m.owner_person_id = v_row.added_by_person_id
         and position(('"' || p_id || '"') in (m.meals::text || m.shopping::text || m.actuals::text)) > 0
     ) then
    delete from mm_packages p
    where p.ingredient_id = p_id
      and not exists (select 1 from mm_price_history h where h.package_id = p.id);
    delete from mm_ingredients i
    where i.id = p_id
      and not exists (select 1 from mm_packages p where p.ingredient_id = i.id);
  end if;
  return v_row.name;
end;
$$;

revoke execute on function public.mm_reject_ingredient(text) from public, anon, authenticated;
