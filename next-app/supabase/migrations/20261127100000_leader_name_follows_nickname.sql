-- Leader names follow a nickname change (2026-10-20).
--
-- people_sync_leader_name fired only on UPDATE OF display_name. Since
-- 20261126100000 display_name is derived by a BEFORE trigger, so an update
-- that sets only nickname (or first/last) changes display_name without naming
-- it, and leaders.name went stale (Mike Black stayed "Michael Black"). Fire on
-- every column display_name is built from; the function already compares old
-- and new display_name, so nothing else changes. Then catch up any leader
-- name that drifted.

drop trigger if exists people_sync_leader_name on public.people;
create trigger people_sync_leader_name
  after update of first_name, last_name, nickname, display_name on public.people
  for each row execute function public.sync_leader_name_from_person();

update public.leaders l
   set name = p.display_name
  from public.people p
 where l.person_id = p.id
   and l.is_person
   and l.name is distinct from p.display_name;
