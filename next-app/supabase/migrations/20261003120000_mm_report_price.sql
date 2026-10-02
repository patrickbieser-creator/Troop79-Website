-- Menu Monster scout workspace, Phase 2 release B: the price-report and
-- price-decision functions (Plans/Menu-Monster-Scout-Workspace.md, "Phase 2
-- design": band, concurrency, revert rules).
--
--  * mm_report_price: a scout (or a leader) reports a package price. The
--    package row is locked FOR UPDATE, so two reports serialise and the
--    history chain stays intact (the second row's old_price is the first's
--    new_price). Unchanged price -> only as_of is bumped, no history row.
--    Inside the band -> applied now. Outside it, or the package has no usable
--    yield -> a 'held' history row and the package is left alone.
--  * mm_decide_price: a leader's decision on a history row. apply / dismiss
--    act on a held row; revert undoes an applied row only while the package
--    still carries that row's new_price (otherwise 'superseded', no change).
--    Reverting a held row is the same as dismissing it.
--
-- BAND RULE (mirrors lib/menu-monster/price-band.ts bandCheck):
--   unit price = price / yield (recipe unit); both prices are for the same
--   package, so yield cancels:  |new - cur| <= band * cur   (exact in numeric)
--   price <= 0 -> 'invalid'; new = cur -> 'same'; yield null/<=0 or cur <= 0
--   -> hold.
--
-- Return values are plain text: report -> same | applied | held | invalid |
-- missing; decide -> applied | dismissed | reverted | superseded | not_held |
-- not_applied | missing.
--
-- DEPLOY ORDER: DB-first; purely additive (two new functions). Both are
-- security definer and reachable only with the service role (EXECUTE revoked
-- from public/anon/authenticated), the mm_save_recipe precedent.

create or replace function public.mm_report_price(
  p_package_id text,
  p_new_price numeric,
  p_reported_by bigint,
  p_menu_id uuid,
  p_band numeric
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg mm_packages%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_new numeric := round(p_new_price, 2);
begin
  if p_new_price is null or v_new <= 0 then
    return 'invalid';
  end if;

  select * into v_pkg from mm_packages where id = p_package_id for update;
  if not found then
    return 'missing';
  end if;

  if v_new = v_pkg.price then
    update mm_packages set as_of = v_today where id = p_package_id;
    return 'same';
  end if;

  if v_pkg.yield is not null and v_pkg.yield > 0 and v_pkg.price > 0
     and abs(v_new - v_pkg.price) <= p_band * v_pkg.price then
    update mm_packages set price = v_new, as_of = v_today where id = p_package_id;
    insert into mm_price_history (package_id, old_price, old_as_of, new_price, reported_by_person_id, menu_id, status)
    values (p_package_id, v_pkg.price, v_pkg.as_of, v_new, p_reported_by, p_menu_id, 'applied');
    return 'applied';
  end if;

  insert into mm_price_history (package_id, old_price, old_as_of, new_price, reported_by_person_id, menu_id, status)
  values (p_package_id, v_pkg.price, v_pkg.as_of, v_new, p_reported_by, p_menu_id, 'held');
  return 'held';
end;
$$;

revoke execute on function public.mm_report_price(text, numeric, bigint, uuid, numeric) from public, anon, authenticated;

create or replace function public.mm_decide_price(
  p_history_id uuid,
  p_decision text,
  p_decided_by bigint
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg_id text;
  v_row mm_price_history%rowtype;
  v_pkg mm_packages%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if p_decision not in ('apply', 'dismiss', 'revert') then
    raise exception 'unknown decision: %', p_decision;
  end if;

  -- Lock order matches mm_report_price: package first, then the history row.
  select package_id into v_pkg_id from mm_price_history where id = p_history_id;
  if not found then
    return 'missing';
  end if;
  select * into v_pkg from mm_packages where id = v_pkg_id for update;
  select * into v_row from mm_price_history where id = p_history_id for update;

  if p_decision = 'apply' then
    if v_row.status <> 'held' then
      return 'not_held';
    end if;
    update mm_packages set price = v_row.new_price, as_of = v_today where id = v_pkg_id;
    update mm_price_history
       set status = 'applied', old_price = v_pkg.price, old_as_of = v_pkg.as_of,
           decided_by_person_id = p_decided_by, decided_at = now()
     where id = p_history_id;
    return 'applied';
  end if;

  if p_decision = 'dismiss' or (p_decision = 'revert' and v_row.status = 'held') then
    if v_row.status <> 'held' then
      return 'not_held';
    end if;
    update mm_price_history
       set status = 'reverted', decided_by_person_id = p_decided_by, decided_at = now()
     where id = p_history_id;
    return 'dismissed';
  end if;

  -- revert an applied row
  if v_row.status <> 'applied' then
    return 'not_applied';
  end if;
  if v_pkg.price <> v_row.new_price then
    return 'superseded';
  end if;
  update mm_packages set price = v_row.old_price, as_of = v_row.old_as_of where id = v_pkg_id;
  update mm_price_history
     set status = 'reverted', decided_by_person_id = p_decided_by, decided_at = now()
   where id = p_history_id;
  return 'reverted';
end;
$$;

revoke execute on function public.mm_decide_price(uuid, text, bigint) from public, anon, authenticated;
