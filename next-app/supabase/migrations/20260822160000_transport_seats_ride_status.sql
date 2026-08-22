-- Event Logistics, Phase 0 / A — transportation columns (Plans/Event-Logistics.md).
--
-- Patrick, 2026-08-22: "switch the seat count so that it says including the
-- driver" (the campout sheet's "Patrick 4/4"), "remember the driver's usual
-- capacity so it pre-fills", and every attending non-driver "should default to
-- needs a ride" with the alternatives driving self / meeting there / not
-- traveling this leg — "all of those happen".
--
-- ADDITIVE. `seats_offered_out/back` (seats BESIDES the driver) stays for one
-- more release so the deployed family form and admin roster keep working; a
-- BEFORE trigger keeps the two representations in step in BOTH directions, so
-- an old client writing seats_offered and a new client writing vehicle_seats
-- produce the same row. The old `signup_entries_seats_out/_seats_back` CHECKs
-- are dropped HERE (tech-lead): they required seats_offered when driving, and
-- Phase 1 code stops writing seats_offered. The legacy columns and the sync
-- are retired together once nothing reads them (plan step 15).

-- ── 1. columns ──────────────────────────────────────────────────────────────
alter table public.signup_entries
  add column if not exists vehicle_seats_out  int
    check (vehicle_seats_out  is null or vehicle_seats_out  >= 1),   -- a driver is always one seat
  add column if not exists vehicle_seats_back int
    check (vehicle_seats_back is null or vehicle_seats_back >= 1),
  -- Ride status per leg. NULL exactly when the person drives that leg.
  --   needs_ride     — must be placed in a car (placement lives in
  --                    signup_group_members; this value does NOT change when
  --                    placed — the membership is what satisfies it)
  --   self           — driving separately
  --   meeting_there  — arriving on their own / not riding with the troop
  --   not_traveling  — this leg doesn't apply (a driver-only adult who drives
  --                    out and goes home; someone leaving early)
  add column if not exists ride_out  text
    check (ride_out  in ('needs_ride', 'self', 'meeting_there', 'not_traveling')),
  add column if not exists ride_back text
    check (ride_back in ('needs_ride', 'self', 'meeting_there', 'not_traveling'));

comment on column public.signup_entries.vehicle_seats_out is
  'Seats in the vehicle INCLUDING the driver (the sheet''s convention). seats_offered_out = this - 1 for one more release.';
comment on column public.signup_entries.ride_out is
  'needs_ride | self | meeting_there | not_traveling; NULL when this entry drives the leg. Placement into a car is a signup_group_members row, not a value here.';

-- The driver's usual capacity, remembered so the next sign-up prefills. Last
-- value written wins; it is a prefill, never a constraint.
alter table public.people
  add column if not exists default_vehicle_seats int
    check (default_vehicle_seats is null or default_vehicle_seats >= 1);

-- ── 2. backfill ─────────────────────────────────────────────────────────────
update public.signup_entries
   set vehicle_seats_out = seats_offered_out + 1
 where drives_out and seats_offered_out is not null and vehicle_seats_out is null;
update public.signup_entries
   set vehicle_seats_back = seats_offered_back + 1
 where drives_back and seats_offered_back is not null and vehicle_seats_back is null;

update public.signup_entries
   set ride_out = case when participation = 'driver_only' then 'not_traveling' else 'needs_ride' end
 where not drives_out and ride_out is null;
update public.signup_entries
   set ride_back = case when participation = 'driver_only' then 'not_traveling' else 'needs_ride' end
 where not drives_back and ride_back is null;

-- Seed remembered capacities from history: the most recent seat offer per person.
update public.people p
   set default_vehicle_seats = s.seats
  from (
    select distinct on (person_id) person_id,
           coalesce(vehicle_seats_out, vehicle_seats_back) as seats
      from public.signup_entries
     where person_id is not null
       and (vehicle_seats_out is not null or vehicle_seats_back is not null)
     order by person_id, updated_at desc
  ) s
 where s.person_id = p.id and p.default_vehicle_seats is null;

-- ── 3. constraints: old out, new in ────────────────────────────────────────
alter table public.signup_entries drop constraint if exists signup_entries_seats_out;
alter table public.signup_entries drop constraint if exists signup_entries_seats_back;

-- ── 4. normalizer (BEFORE) — keeps both seat representations in step and
--       fills ride-status defaults, so the CHECKs below are assertions, not
--       traps for whichever client wrote the row.
create or replace function public.signup_entries_transport_normalize()
returns trigger
language plpgsql
as $$
begin
  -- Which seat column did the writer touch? On UPDATE, the one that changed
  -- leads; on INSERT, whichever is present. Then fill the other from it.
  if tg_op = 'UPDATE' then
    if new.vehicle_seats_out is distinct from old.vehicle_seats_out and new.vehicle_seats_out is not null then
      new.seats_offered_out := new.vehicle_seats_out - 1;
    elsif new.seats_offered_out is distinct from old.seats_offered_out and new.seats_offered_out is not null then
      new.vehicle_seats_out := new.seats_offered_out + 1;
    end if;
    if new.vehicle_seats_back is distinct from old.vehicle_seats_back and new.vehicle_seats_back is not null then
      new.seats_offered_back := new.vehicle_seats_back - 1;
    elsif new.seats_offered_back is distinct from old.seats_offered_back and new.seats_offered_back is not null then
      new.vehicle_seats_back := new.seats_offered_back + 1;
    end if;
  end if;

  if new.drives_out then
    if new.vehicle_seats_out is null and new.seats_offered_out is not null then
      new.vehicle_seats_out := new.seats_offered_out + 1;
    end if;
    if new.seats_offered_out is null and new.vehicle_seats_out is not null then
      new.seats_offered_out := new.vehicle_seats_out - 1;
    end if;
    new.ride_out := null;                                   -- drivers have no ride status
  else
    new.vehicle_seats_out := null;
    new.seats_offered_out := null;
    if new.ride_out is null then
      new.ride_out := case when new.participation = 'driver_only' then 'not_traveling' else 'needs_ride' end;
    end if;
  end if;

  if new.drives_back then
    if new.vehicle_seats_back is null and new.seats_offered_back is not null then
      new.vehicle_seats_back := new.seats_offered_back + 1;
    end if;
    if new.seats_offered_back is null and new.vehicle_seats_back is not null then
      new.seats_offered_back := new.vehicle_seats_back - 1;
    end if;
    new.ride_back := null;
  else
    new.vehicle_seats_back := null;
    new.seats_offered_back := null;
    if new.ride_back is null then
      new.ride_back := case when new.participation = 'driver_only' then 'not_traveling' else 'needs_ride' end;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists signup_entries_transport_normalize on public.signup_entries;
create trigger signup_entries_transport_normalize
  before insert or update on public.signup_entries
  for each row execute function public.signup_entries_transport_normalize();

-- Seats are present exactly when the leg is driven (the normalizer derives
-- them from either column, so this only fires for a driver who gave no count).
alter table public.signup_entries
  add constraint signup_entries_vehicle_seats_out check (
    (drives_out and vehicle_seats_out is not null) or (not drives_out and vehicle_seats_out is null)
  ),
  add constraint signup_entries_vehicle_seats_back check (
    (drives_back and vehicle_seats_back is not null) or (not drives_back and vehicle_seats_back is null)
  ),
  -- Ride status XOR driving, per leg. Same guard shape as _driver_only /
  -- _contributor; status <> 'yes' is the escape for declines and cancellations.
  add constraint signup_entries_ride_out check (
    (drives_out and ride_out is null) or (not drives_out and ride_out is not null) or status <> 'yes'
  ),
  add constraint signup_entries_ride_back check (
    (drives_back and ride_back is null) or (not drives_back and ride_back is not null) or status <> 'yes'
  );

-- ── 5. remember the driver's capacity (AFTER) ──────────────────────────────
create or replace function public.signup_entries_remember_vehicle_seats()
returns trigger
language plpgsql
as $$
declare
  v_seats int;
begin
  if new.person_id is null then return new; end if;
  v_seats := case
    when new.drives_out  and new.vehicle_seats_out  is not null then new.vehicle_seats_out
    when new.drives_back and new.vehicle_seats_back is not null then new.vehicle_seats_back
    else null end;
  if v_seats is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.vehicle_seats_out is not distinct from old.vehicle_seats_out
     and new.vehicle_seats_back is not distinct from old.vehicle_seats_back then
    return new;                                             -- nothing about seats changed
  end if;
  update public.people set default_vehicle_seats = v_seats
   where id = new.person_id and default_vehicle_seats is distinct from v_seats;
  return new;
end;
$$;

drop trigger if exists signup_entries_remember_vehicle_seats on public.signup_entries;
create trigger signup_entries_remember_vehicle_seats
  after insert or update on public.signup_entries
  for each row execute function public.signup_entries_remember_vehicle_seats();
