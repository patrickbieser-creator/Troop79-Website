-- Menu Monster "What we bought" (Plans/Menu-Monster-Brands-Gear.md, release 4). Replaces "What you paid".
--
-- After the trip, whoever has the receipt records what was really bought — up to a week later, and often
-- not the scout who planned (Patrick, 2026-10-03: "any signed-in scout can record, for menus linked to an
-- outing"). Several scouts may enter different receipts, so a line is written on its own, never as part of
-- a whole-menu save.
--
--   mm_menus.bought   { "lines": { "<ingredient id>": { "status": "bought" | "not_bought",
--                                    "items": [ { "brandId", "packageId", "qty", "pricePaid" } ],
--                                    "by", "personId", "at" } },
--                       "done": { "by", "personId", "at" } }
--                     A line with no entry has not been recorded: it reads "as planned, not confirmed" until
--                     someone ticks "We're done shopping", after which it counts as bought as planned.
--   mm_set_bought_line      one line set or cleared, merged atomically (two scouts, two receipts).
--   mm_set_shopping_done    the done tick, on or off.
-- Neither bumps updated_at: an open Plan tab's version token stays good. `actuals` (the old "What you paid")
-- is left in place and read as a fallback; nothing writes it any more.
--
-- DEPLOY ORDER: DB-first. Additive; the new code selects mm_menus.bought. EXECUTE revoked (D-239).

alter table public.mm_menus add column if not exists bought jsonb not null default '{}'::jsonb;

create or replace function public.mm_set_bought_line(p_menu uuid, p_ingredient text, p_line jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines jsonb;
begin
  if p_ingredient is null or p_ingredient !~ '^[A-Za-z0-9:_-]{1,64}$' then
    raise exception 'MM_BAD_BOUGHT: ingredient';
  end if;
  select coalesce(bought->'lines', '{}'::jsonb) into v_lines from mm_menus where id = p_menu for update;
  if not found then
    return false;
  end if;
  if p_line is null then
    v_lines := v_lines - p_ingredient;
  else
    if jsonb_typeof(p_line) <> 'object' or octet_length(p_line::text) > 4000 then
      raise exception 'MM_BAD_BOUGHT: line';
    end if;
    -- A menu's list is a few dozen lines; the cap stops anyone growing another scout's row without limit.
    if not (v_lines ? p_ingredient) and (select count(*) from jsonb_object_keys(v_lines)) >= 200 then
      raise exception 'MM_BAD_BOUGHT: too many lines';
    end if;
    v_lines := v_lines || jsonb_build_object(p_ingredient, p_line);
  end if;
  update mm_menus set bought = jsonb_set(coalesce(bought, '{}'::jsonb), '{lines}', v_lines, true) where id = p_menu;
  return true;
end;
$$;

revoke execute on function public.mm_set_bought_line(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.mm_set_shopping_done(p_menu uuid, p_done boolean, p_person bigint, p_label text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_done then
    update mm_menus
    set bought = jsonb_set(coalesce(bought, '{}'::jsonb), '{done}',
      jsonb_build_object('by', left(coalesce(p_label, ''), 60), 'personId', p_person, 'at', now()), true)
    where id = p_menu;
  else
    update mm_menus set bought = coalesce(bought, '{}'::jsonb) - 'done' where id = p_menu;
  end if;
  return found;
end;
$$;

revoke execute on function public.mm_set_shopping_done(uuid, boolean, bigint, text) from public, anon, authenticated;
