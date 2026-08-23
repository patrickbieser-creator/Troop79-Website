-- Guests as People — Phase 3, the drops (Plans/Guests-As-People.md; Patrick,
-- 2026-08-23: "proceed with guests Phase 3").
--
-- v1.87.0 (20260823140000 + 150000) was deliberately additive: guest rows
-- gained a person_id, guest_mode replaced allow_guests, and the old columns
-- and CHECKs stayed so an already-deployed client kept working through the
-- deploy. The code that stops reading them ships FIRST (code → then this);
-- this migration then makes the tightened shape the only shape:
--   1. re-run the 0a backfill — any guest row the OLD client wrote between
--      the 0a db push and the v1.87.0 code deploy (person_id null +
--      guest_name) gets its people row now, loudly if it cannot;
--   2. signup_entries.person_id NOT NULL again (D-066's rule, no exception);
--   3. drop CHECKs signup_entries_identity / signup_entries_guest_class —
--      both are "person_id is not null OR (guest shape)", vacuous once
--      person_id is NOT NULL (values verified on prod before this ran);
--   4. drop signup_entries.guest_name (a guest's name is their people row);
--   5. drop the allow_guests ↔ guest_mode sync trigger, then allow_guests.
-- Nothing else in the schema reads them: no view, and the only functions
-- that did were the old CHECKs and the pre-0b RPC (already replaced).

-- ── 1. backfill, once more ───────────────────────────────────────────────
do $$
declare
  r record;
  v_hh bigint;
  v_pid bigint;
  v_twin bigint;
begin
  for r in
    select e.id, e.event_signup_id, e.guest_name, e.household_id,
           h.household_id as host_household_id, h.person_id as host_person_id
    from public.signup_entries e
    left join public.signup_entries h on h.id = e.host_entry_id
    where e.person_id is null
    order by e.id
  loop
    v_hh := coalesce(
      r.household_id,
      r.host_household_id,
      (select hm.household_id from public.household_members hm where hm.person_id = r.host_person_id order by hm.household_id limit 1)
    );
    if v_hh is null then
      raise exception 'GUEST_BACKFILL_NO_HOUSEHOLD: signup_entries % ("%") has no resolvable host household — assign one and re-run', r.id, r.guest_name;
    end if;
    if r.guest_name is null or length(trim(r.guest_name)) = 0 then
      raise exception 'GUEST_BACKFILL_NO_NAME: signup_entries % has neither a person nor a guest name', r.id;
    end if;

    select p.id into v_pid
    from public.people p
    where p.guest_host_household_id = v_hh
      and p.merged_into_person_id is null
      and lower(trim(p.display_name)) = lower(trim(r.guest_name))
    order by p.id
    limit 1;

    if v_pid is null then
      insert into public.people (display_name, guest_host_household_id, notes)
      values (trim(r.guest_name), v_hh, 'Guest — created from a named sign-up row by the Phase 3 backfill (2026-08-23)')
      returning id into v_pid;
    end if;

    select x.id into v_twin
    from public.signup_entries x
    where x.event_signup_id = r.event_signup_id and x.person_id = v_pid
      and x.status <> 'cancelled' and x.id <> r.id
    limit 1;
    if v_twin is not null then
      raise exception 'GUEST_BACKFILL_TWIN: signup_entries % and % would both be guest "%" (person %) on event % — cancel one first', r.id, v_twin, r.guest_name, v_pid, r.event_signup_id;
    end if;

    update public.signup_entries set person_id = v_pid, updated_at = now() where id = r.id;
  end loop;
end $$;

-- ── 2. person_id is the identity, always ─────────────────────────────────
alter table public.signup_entries alter column person_id set not null;

-- ── 3. the two CHECKs that only existed to let guest rows skip it ────────
alter table public.signup_entries drop constraint if exists signup_entries_identity;
alter table public.signup_entries drop constraint if exists signup_entries_guest_class;

-- ── 3b. sync_car_groups_for_entry named a driver's car from guest_name ───
-- Body identical to 20260822170000 except the one coalesce (plpgsql binds
-- late, so the drop below would otherwise surface as a runtime error the
-- first time a guest drove).
CREATE OR REPLACE FUNCTION public.sync_car_groups_for_entry(p_entry_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  e record;
  v_name text;
  v_leg text;
  v_drives boolean;
  v_seats int;
  v_set bigint;
  v_group bigint;
begin
  select se.*, p.display_name into e
    from public.signup_entries se left join public.people p on p.id = se.person_id
   where se.id = p_entry_id;
  if not found then return; end if;

  v_name := coalesce(e.display_name, 'Driver');   -- guest_name dropped in Phase 3; a guest has a people row

  perform set_config('app.car_sync', '1', true);   -- transaction-local; see signup_groups_car_guard

  foreach v_leg in array array['out', 'back'] loop
    v_drives := case v_leg when 'out' then e.drives_out else e.drives_back end;
    v_seats  := case v_leg when 'out' then e.vehicle_seats_out else e.vehicle_seats_back end;

    select id into v_set from public.signup_group_sets
     where event_signup_id = e.event_signup_id and kind = 'car' and leg = v_leg;
    if v_set is null then continue; end if;         -- event has no car set for this leg

    if e.status = 'yes' and v_drives and v_seats is not null then
      insert into public.signup_groups (set_id, name, capacity, driver_entry_id)
      values (v_set, v_name, v_seats, e.id)
      on conflict (set_id, driver_entry_id) where driver_entry_id is not null
        do update set capacity = excluded.capacity, name = excluded.name
      returning id into v_group;
      insert into public.signup_group_members (group_id, entry_id, set_id, role, placed_by)
      values (v_group, e.id, v_set, 'driver', 'system')
      on conflict (group_id, entry_id) do nothing;
    else
      delete from public.signup_groups where set_id = v_set and driver_entry_id = e.id;
    end if;
  end loop;

  perform set_config('app.car_sync', '', true);
end;
$function$;

-- ── 4. guest_name ────────────────────────────────────────────────────────
alter table public.signup_entries drop column if exists guest_name;

-- The default-class trigger's "person_id is null → leave it" arm is now
-- unreachable; harmless, left as-is (signup_entries_guest_class_guard still
-- enforces a guest class for a guest person).

-- ── 5. allow_guests ──────────────────────────────────────────────────────
drop trigger if exists event_signups_guest_mode_sync on public.event_signups;
drop function if exists public.event_signups_guest_mode_sync();
alter table public.event_signups drop column if exists allow_guests;

comment on column public.event_signups.guest_mode is
  'none | count | named — how this event takes guests (Plans/Guests-As-People.md). The only guest switch since Phase 3 (2026-08-23).';
comment on column public.signup_entries.host_entry_id is
  'Non-null ⇒ this row is a GUEST brought by that member''s entry (cascade-deletes with it). The guest''s name and contact live on their people row (guest_host_household_id).';
