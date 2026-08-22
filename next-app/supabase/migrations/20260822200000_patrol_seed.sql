-- Event Logistics, Phase 2 — patrol sets seed from the roster (Plans/Event-Logistics.md §B).
--
-- A set with seed_from_roster (kind='patrol') gets a group per roster patrol
-- and each signed-up scout placed in theirs; a scout who signs up later is
-- auto-placed. Leaders can move anyone afterwards, and a seed NEVER moves a
-- person a leader (or the family) already placed in that set. Placement
-- never writes back to scouts.patrol (Patrick: "agreed. never.").
--
-- Patrol spelling rules mirror lib/patrol-assign.ts normalizePatrolName /
-- NON_PATROL_VALUES: trim, collapse whitespace, blank = none, and the values
-- that sit in the column but are not patrols ("Junior Leader") are skipped.

create or replace function public.seed_patrol_groups_for_entry(p_entry_id bigint)
returns void
language plpgsql
as $$
declare
  e record;
  v_patrol text;
  s record;
  v_group bigint;
begin
  select se.id, se.event_signup_id, se.status, se.person_id into e
    from public.signup_entries se where se.id = p_entry_id;
  if not found or e.status <> 'yes' or e.person_id is null then return; end if;

  select nullif(regexp_replace(btrim(sc.patrol), '\s+', ' ', 'g'), '') into v_patrol
    from public.scouts sc where sc.person_id = e.person_id and sc.active
   limit 1;
  if v_patrol is null then return; end if;
  if lower(v_patrol) in ('junior leader', 'jr leader', 'jl') then return; end if;

  for s in select id from public.signup_group_sets
            where event_signup_id = e.event_signup_id and kind = 'patrol' and seed_from_roster
  loop
    -- Already placed in this set (by a leader, the family, or an earlier seed): leave it.
    if exists (select 1 from public.signup_group_members m where m.set_id = s.id and m.entry_id = e.id) then
      continue;
    end if;
    insert into public.signup_groups (set_id, name)
    values (s.id, v_patrol)
    on conflict (set_id, name) where driver_entry_id is null do nothing;
    select id into v_group from public.signup_groups where set_id = s.id and name = v_patrol and driver_entry_id is null;
    if v_group is null then continue; end if;
    insert into public.signup_group_members (group_id, entry_id, set_id, placed_by)
    values (v_group, e.id, s.id, 'roster')
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.seed_patrol_set(p_set_id bigint)
returns void
language plpgsql
as $$
declare
  r record;
  v_event bigint;
begin
  select event_signup_id into v_event from public.signup_group_sets
   where id = p_set_id and kind = 'patrol' and seed_from_roster;
  if v_event is null then return; end if;
  for r in select id from public.signup_entries where event_signup_id = v_event and status = 'yes' loop
    perform public.seed_patrol_groups_for_entry(r.id);
  end loop;
end;
$$;

-- Late sign-ups: when an entry becomes (or is inserted as) status='yes'.
create or replace function public.signup_entries_seed_patrol()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'yes' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.seed_patrol_groups_for_entry(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists signup_entries_seed_patrol on public.signup_entries;
create trigger signup_entries_seed_patrol
  after insert or update of status on public.signup_entries
  for each row execute function public.signup_entries_seed_patrol();

-- A seeded set seeds itself on creation (or when seeding is switched on).
create or replace function public.signup_group_sets_seed()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'patrol' and new.seed_from_roster
     and (tg_op = 'INSERT' or old.seed_from_roster is distinct from new.seed_from_roster) then
    perform public.seed_patrol_set(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists signup_group_sets_seed on public.signup_group_sets;
create trigger signup_group_sets_seed
  after insert or update of seed_from_roster on public.signup_group_sets
  for each row execute function public.signup_group_sets_seed();

revoke all on function public.seed_patrol_groups_for_entry(bigint) from public, anon, authenticated;
revoke all on function public.seed_patrol_set(bigint) from public, anon, authenticated;
