-- Event Logistics, Phase 0 / B — per-event group sets (Plans/Event-Logistics.md).
--
-- The campout sheet's structure, literally: each grouping COLUMN (Patrol,
-- Car To, Car Back, Crew, Tent, Team) is a set, each distinct VALUE a group,
-- each ROW a membership. Patrick, 2026-08-22: "N configurable groups …
-- predetermined sets, but the ability to add a new one for any given event";
-- "per-event placement NEVER writes back to the roster".
--
-- Cars are groups too — a set with a leg and a driver — so one board, one CSV
-- column family and one placement RPC serve cars, tents, patrols and teams.
-- Car groups are SYSTEM-OWNED: only sync_car_groups creates, resizes or
-- retires them, from signup_entries.drives_* / vehicle_seats_* / status
-- (tech-lead invariant). A car exists because an entry drives; when the
-- driver cancels, the car goes and its riders are simply unplaced again.
--
-- RLS on, zero policies, admin client only — the house posture.

-- ── 1. tables ───────────────────────────────────────────────────────────────
create table if not exists public.signup_group_sets (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,
  kind text not null check (kind in ('patrol', 'crew', 'tent', 'cabin', 'car', 'team', 'meal', 'custom')),
  label text not null,                         -- "Patrols", "Cars there", "Tents", "Service teams"
  leg text check (leg in ('out', 'back')),     -- cars only
  seed_from_roster boolean not null default false,   -- patrol: groups + members from scouts.patrol
  self_select boolean not null default false,        -- families may pick a group with room
  family_visible boolean not null default true,      -- shown (own household only) on the event page
  default_capacity int check (default_capacity is null or default_capacity > 0),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (event_signup_id, label),
  constraint signup_group_sets_car_leg check ((kind = 'car') = (leg is not null))
);
-- One car set per leg per event.
create unique index if not exists signup_group_sets_car_leg_uq
  on public.signup_group_sets (event_signup_id, leg) where kind = 'car';

create table if not exists public.signup_groups (
  id bigserial primary key,
  set_id bigint not null references public.signup_group_sets(id) on delete cascade,
  name text not null,                          -- "Kraken", "Tent 3"; cars: the driver's display name
  capacity int check (capacity is null or capacity > 0),   -- null = unlimited; cars: seats incl. driver
  driver_entry_id bigint references public.signup_entries(id) on delete cascade,   -- cars only
  notes text,                                  -- "pulling trailer", "arriving late"
  sort int not null default 0,
  created_at timestamptz not null default now()
);
-- Leader-named groups are unique by name within a set; cars by driver.
create unique index if not exists signup_groups_name_uq
  on public.signup_groups (set_id, name) where driver_entry_id is null;
create unique index if not exists signup_groups_driver_uq
  on public.signup_groups (set_id, driver_entry_id) where driver_entry_id is not null;

create table if not exists public.signup_group_members (
  group_id bigint not null references public.signup_groups(id) on delete cascade,
  entry_id bigint not null references public.signup_entries(id) on delete cascade,
  set_id   bigint not null references public.signup_group_sets(id) on delete cascade,   -- filled by trigger
  role text check (role in ('driver', 'leader')),
  placed_by text,
  placed_at timestamptz not null default now(),
  primary key (group_id, entry_id),
  unique (set_id, entry_id)                    -- one tent, one patrol, one car per leg
);
create index if not exists signup_group_members_entry_idx on public.signup_group_members (entry_id);

alter table public.signup_group_sets    enable row level security;
alter table public.signup_groups        enable row level security;
alter table public.signup_group_members enable row level security;

-- ── 2. membership integrity (BEFORE INSERT) ────────────────────────────────
-- set_id is denormalized only so the one-group-per-set UNIQUE can exist; the
-- writer never supplies it. An entry may only be placed within its own event.
create or replace function public.signup_group_members_fill()
returns trigger
language plpgsql
as $$
declare
  v_set bigint;
  v_set_event bigint;
  v_entry_event bigint;
begin
  select g.set_id, s.event_signup_id into v_set, v_set_event
    from public.signup_groups g join public.signup_group_sets s on s.id = g.set_id
   where g.id = new.group_id;
  if v_set is null then raise exception 'GROUP_NOT_FOUND: %', new.group_id; end if;
  select event_signup_id into v_entry_event from public.signup_entries where id = new.entry_id;
  if v_entry_event is null then raise exception 'ENTRY_NOT_FOUND: %', new.entry_id; end if;
  if v_entry_event <> v_set_event then
    raise exception 'ENTRY_NOT_IN_THIS_EVENT: entry % is not signed up for the event of group %', new.entry_id, new.group_id;
  end if;
  new.set_id := v_set;
  return new;
end;
$$;

drop trigger if exists signup_group_members_fill on public.signup_group_members;
create trigger signup_group_members_fill
  before insert on public.signup_group_members
  for each row execute function public.signup_group_members_fill();

-- ── 3. car groups are system-managed (BEFORE INSERT/UPDATE on groups) ──────
-- sync_car_groups_for_entry sets a transaction-local flag while it writes;
-- anything else touching a car group's structure is a client statement and
-- is refused. (Not pg_trigger_depth(): that is already 1 inside this guard,
-- and a direct repair call to the sync function would otherwise be refused.)
create or replace function public.signup_groups_car_guard()
returns trigger
language plpgsql
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.signup_group_sets where id = new.set_id;
  if v_kind = 'car' and coalesce(current_setting('app.car_sync', true), '') <> '1' then
    if tg_op = 'INSERT' then
      raise exception 'CAR_GROUPS_ARE_SYSTEM_MANAGED: a car exists because an entry drives — set drives_out/back on the signup entry';
    end if;
    if new.capacity is distinct from old.capacity
       or new.driver_entry_id is distinct from old.driver_entry_id
       or new.set_id is distinct from old.set_id then
      raise exception 'CAR_GROUPS_ARE_SYSTEM_MANAGED: change the driver''s seats on the signup entry, not the car';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists signup_groups_car_guard on public.signup_groups;
create trigger signup_groups_car_guard
  before insert or update on public.signup_groups
  for each row execute function public.signup_groups_car_guard();

-- ── 4. sync cars from the entry (the one owner of kind='car' groups) ───────
create or replace function public.sync_car_groups_for_entry(p_entry_id bigint)
returns void
language plpgsql
as $$
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

  v_name := coalesce(e.display_name, e.guest_name, 'Driver');

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
$$;

create or replace function public.signup_entries_sync_groups()
returns trigger
language plpgsql
as $$
begin
  -- A cancelled person holds no placement of any kind.
  if new.status = 'cancelled' then
    delete from public.signup_group_members where entry_id = new.id;
  end if;
  perform public.sync_car_groups_for_entry(new.id);
  return new;
end;
$$;

drop trigger if exists signup_entries_sync_groups on public.signup_entries;
create trigger signup_entries_sync_groups
  after insert or update of status, drives_out, drives_back, vehicle_seats_out, vehicle_seats_back, participation
  on public.signup_entries
  for each row execute function public.signup_entries_sync_groups();

-- drivers_needed ⇒ the two car sets exist (create-only; a leader may delete
-- them if an event turns out not to need cars). Existing drivers get cars.
create or replace function public.event_signups_ensure_car_sets()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if not new.drivers_needed then return new; end if;
  if not exists (select 1 from public.signup_group_sets where event_signup_id = new.id and kind = 'car' and leg = 'out') then
    insert into public.signup_group_sets (event_signup_id, kind, label, leg, sort) values (new.id, 'car', 'Cars there', 'out', 90);
  end if;
  if not exists (select 1 from public.signup_group_sets where event_signup_id = new.id and kind = 'car' and leg = 'back') then
    insert into public.signup_group_sets (event_signup_id, kind, label, leg, sort) values (new.id, 'car', 'Cars back', 'back', 91);
  end if;
  for r in select id from public.signup_entries
            where event_signup_id = new.id and status = 'yes' and (drives_out or drives_back) loop
    perform public.sync_car_groups_for_entry(r.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists event_signups_ensure_car_sets on public.event_signups;
create trigger event_signups_ensure_car_sets
  after insert or update of drivers_needed on public.event_signups
  for each row execute function public.event_signups_ensure_car_sets();

-- Backfill: every live event that already asks for drivers gets its car sets
-- and a car per current driver.
update public.event_signups set drivers_needed = true where drivers_needed;

-- ── 5. placement RPCs ──────────────────────────────────────────────────────
-- Locks the GROUP row FOR UPDATE before counting members — literally the
-- claim_signup_slot pattern (qa-lead). Returns:
--   placed  — new membership
--   moved   — was in another group of the same set; moved here
--   already — already a member of this group
--   full    — capacity reached (the driver counts, capacity includes them)
--   gone    — the group no longer exists (a car whose driver cancelled
--             while the leader was dragging)
create or replace function public.place_in_group(
  p_group_id bigint,
  p_entry_id bigint,
  p_actor text default null
)
returns text
language plpgsql
as $$
declare
  v_set bigint;
  v_capacity int;
  v_set_event bigint;
  v_entry_event bigint;
  v_entry_status text;
  v_current_group bigint;
  v_count int;
  v_result text := 'placed';
begin
  select g.set_id, g.capacity, s.event_signup_id into v_set, v_capacity, v_set_event
    from public.signup_groups g join public.signup_group_sets s on s.id = g.set_id
   where g.id = p_group_id
   for update of g;                                  -- serializes racing placements
  if not found then return 'gone'; end if;

  select event_signup_id, status into v_entry_event, v_entry_status
    from public.signup_entries where id = p_entry_id;
  if not found then raise exception 'ENTRY_NOT_FOUND: %', p_entry_id; end if;
  if v_entry_event <> v_set_event then
    raise exception 'ENTRY_NOT_IN_THIS_EVENT: entry % is not signed up for this event', p_entry_id;
  end if;
  if v_entry_status = 'cancelled' then
    raise exception 'ENTRY_CANCELLED: a cancelled entry cannot be placed';
  end if;

  select group_id into v_current_group from public.signup_group_members
   where set_id = v_set and entry_id = p_entry_id;
  if v_current_group = p_group_id then return 'already'; end if;

  if v_capacity is not null then
    select count(*) into v_count from public.signup_group_members where group_id = p_group_id;
    if v_count >= v_capacity then return 'full'; end if;
  end if;

  if v_current_group is not null then
    delete from public.signup_group_members where group_id = v_current_group and entry_id = p_entry_id;
    v_result := 'moved';
  end if;

  insert into public.signup_group_members (group_id, entry_id, set_id, placed_by)
  values (p_group_id, p_entry_id, v_set, p_actor);
  return v_result;
end;
$$;

-- Removes a placement. A driver cannot be removed from their own car — stop
-- driving on the entry instead, and the car retires with its riders released.
create or replace function public.unplace_from_group(
  p_group_id bigint,
  p_entry_id bigint
)
returns void
language plpgsql
as $$
declare
  v_role text;
begin
  select role into v_role from public.signup_group_members
   where group_id = p_group_id and entry_id = p_entry_id;
  if v_role = 'driver' then
    raise exception 'DRIVER_STAYS_WITH_CAR: clear drives_out/back on the entry to retire the car';
  end if;
  delete from public.signup_group_members where group_id = p_group_id and entry_id = p_entry_id;
end;
$$;

revoke all on function public.place_in_group(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.unplace_from_group(bigint, bigint) from public, anon, authenticated;
revoke all on function public.sync_car_groups_for_entry(bigint) from public, anon, authenticated;
