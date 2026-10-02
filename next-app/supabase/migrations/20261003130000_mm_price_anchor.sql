-- Menu Monster price release B, qa-lead fixes (Patrick, 2026-10-02): the +/-50%
-- band is anchored to the last price a LEADER set or approved, not to the
-- current price. Scouts may update a package as often as they like, but the
-- price can never drift more than 50% (unit price) from that baseline; beyond
-- it the report is held. Ships together with 20261003120000 (not yet in
-- production); this file only replaces what that one created.
--
--  * mm_packages.anchor_price / anchor_as_of: the leader-approved baseline.
--    Backfilled from the current price/as_of, then NOT NULL. A BEFORE INSERT
--    trigger fills a new package's anchor from its price, so every insert path
--    (leader create, scout-added package, test fixtures) keeps working with no
--    code change; the functions still coalesce(anchor_price, price) defensively.
--  * mm_price_history: status 'dismissed' (a held row nobody applied: a leader
--    dismissed it, or the same reporter's newer held report replaced it).
--    'reverted' now means only "an applied change that was undone".
--    old_anchor_price / old_anchor_as_of: set ONLY on a row that moved the
--    anchor (leader-set or leader-approved), so a revert knows to restore it.
--  * mm_report_price: band vs the anchor; a scout's applied change never moves
--    the anchor; a new held row dismisses the reporter's earlier held rows for
--    the same package.
--  * mm_decide_price: dismiss -> 'dismissed'; apply moves price AND anchor;
--    revert restores the anchor only when the reverted row had moved it.
--  * mm_leader_set_price: a leader's price edit, one transaction, package row
--    locked: price + anchor + the applied history row together.
--
-- DEPLOY ORDER: DB-first, additive (columns, a widened CHECK, replaced and new
-- functions). Functions are service-role only (EXECUTE revoked), as before.

alter table public.mm_packages
  add column anchor_price numeric(10, 2),
  add column anchor_as_of date;

update public.mm_packages set anchor_price = price, anchor_as_of = as_of;

alter table public.mm_packages alter column anchor_price set not null;

create or replace function public.mm_packages_default_anchor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.anchor_price is null then
    new.anchor_price := new.price;
    new.anchor_as_of := new.as_of;
  end if;
  return new;
end;
$$;

create trigger mm_packages_default_anchor
  before insert on public.mm_packages
  for each row execute function public.mm_packages_default_anchor();

alter table public.mm_price_history
  add column old_anchor_price numeric(10, 2),
  add column old_anchor_as_of date;

alter table public.mm_price_history drop constraint mm_price_history_status_check;
alter table public.mm_price_history
  add constraint mm_price_history_status_check
  check (status in ('applied', 'held', 'reverted', 'dismissed'));

-- BAND RULE (mirrors lib/menu-monster/price-band.ts bandCheck): measured against
-- the anchor. Unit price = price / yield and both prices are for the same
-- package, so yield cancels:  |new - anchor| <= band * anchor  (exact numeric).
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
  v_anchor numeric;
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

  v_anchor := coalesce(v_pkg.anchor_price, v_pkg.price);
  if v_pkg.yield is not null and v_pkg.yield > 0 and v_anchor > 0
     and abs(v_new - v_anchor) <= p_band * v_anchor then
    -- A scout's change moves the price, never the anchor.
    update mm_packages set price = v_new, as_of = v_today where id = p_package_id;
    insert into mm_price_history (package_id, old_price, old_as_of, new_price, reported_by_person_id, menu_id, status)
    values (p_package_id, v_pkg.price, v_pkg.as_of, v_new, p_reported_by, p_menu_id, 'applied');
    return 'applied';
  end if;

  -- One live held report per package and reporter: the newer one replaces it.
  update mm_price_history
     set status = 'dismissed', decided_by_person_id = null, decided_at = now()
   where package_id = p_package_id and reported_by_person_id = p_reported_by and status = 'held';
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
    -- A leader approved it: the price AND the anchor move.
    update mm_packages
       set price = v_row.new_price, as_of = v_today,
           anchor_price = v_row.new_price, anchor_as_of = v_today
     where id = v_pkg_id;
    update mm_price_history
       set status = 'applied', old_price = v_pkg.price, old_as_of = v_pkg.as_of,
           old_anchor_price = coalesce(v_pkg.anchor_price, v_pkg.price),
           old_anchor_as_of = case when v_pkg.anchor_price is null then v_pkg.as_of else v_pkg.anchor_as_of end,
           decided_by_person_id = p_decided_by, decided_at = now()
     where id = p_history_id;
    return 'applied';
  end if;

  if p_decision = 'dismiss' or (p_decision = 'revert' and v_row.status = 'held') then
    if v_row.status <> 'held' then
      return 'not_held';
    end if;
    update mm_price_history
       set status = 'dismissed', decided_by_person_id = p_decided_by, decided_at = now()
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
  -- The anchor goes back only if this row is the one that moved it.
  if v_row.old_anchor_price is not null then
    update mm_packages
       set anchor_price = v_row.old_anchor_price, anchor_as_of = v_row.old_anchor_as_of
     where id = v_pkg_id;
  end if;
  update mm_price_history
     set status = 'reverted', decided_by_person_id = p_decided_by, decided_at = now()
   where id = p_history_id;
  return 'reverted';
end;
$$;

revoke execute on function public.mm_decide_price(uuid, text, bigint) from public, anon, authenticated;

-- A leader's price-book edit. Returns applied | same | invalid | missing.
-- 'same' (cents equal) still sets as_of and re-anchors at the current price (a
-- leader confirming the price), but writes no history row.
create or replace function public.mm_leader_set_price(
  p_package_id text,
  p_new_price numeric,
  p_as_of date,
  p_leader bigint
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg mm_packages%rowtype;
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
    update mm_packages set as_of = p_as_of, anchor_price = v_new, anchor_as_of = p_as_of where id = p_package_id;
    return 'same';
  end if;

  update mm_packages
     set price = v_new, as_of = p_as_of, anchor_price = v_new, anchor_as_of = p_as_of
   where id = p_package_id;
  insert into mm_price_history (
    package_id, old_price, old_as_of, new_price, reported_by_person_id, status,
    decided_by_person_id, decided_at, old_anchor_price, old_anchor_as_of
  ) values (
    p_package_id, v_pkg.price, v_pkg.as_of, v_new, p_leader, 'applied',
    p_leader, now(), coalesce(v_pkg.anchor_price, v_pkg.price),
    case when v_pkg.anchor_price is null then v_pkg.as_of else v_pkg.anchor_as_of end
  );
  return 'applied';
end;
$$;

revoke execute on function public.mm_leader_set_price(text, numeric, date, bigint) from public, anon, authenticated;
revoke execute on function public.mm_packages_default_anchor() from public, anon, authenticated;
