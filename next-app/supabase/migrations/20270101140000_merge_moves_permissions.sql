-- Merging two people: permissions follow, and two sets of initials no longer break the merge.
--
-- 1. Permissions (found 2026-11-12: Kara Pitt-D'Andrea's finance.manage / finance.view stayed on her merged-away
--    duplicate, person 120, so the record she signs in as had no finance access; fixed by hand that day).
--    merge_people moves sign-ups, money, emails and the meeting tables, but person_capabilities was never on its list.
--    Rather than re-issue that 300-line function, people_merge_followups finishes the job the moment a person is
--    marked merged, so every merge path gets it. A permission both held stays once (the kept person's grant).
--
-- 2. Initials (a regression from 20270101130000_sign_off_initials, which allows one leaders row per person):
--    merge_people moves the duplicate's leaders row to the person kept. When the person kept already has initials,
--    that move would now fail. leaders_merge_keeps_one_code releases the duplicate's row instead (or, when the kept
--    person's own initials are retired and the duplicate's are active, releases the kept person's retired row) — retired, its
--    person link moved to archived_person_id, is_person and can_login off, exactly like a reuse archive — so the
--    kept person keeps their own code and the duplicate's old ledger entries keep their text. Only merges move a
--    code between people (the initials RPCs never change person_id), so in practice this fires on merges only.

create or replace function public.people_merge_followups()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_survivor bigint := new.merged_into_person_id;
begin
  insert into person_capabilities (person_id, capability, granted_at, granted_by)
  select v_survivor, capability, granted_at, granted_by from person_capabilities where person_id = old.id
  on conflict (person_id, capability) do nothing;
  delete from person_capabilities where person_id = old.id;
  update person_capabilities set granted_by = v_survivor where granted_by = old.id;
  return new;
end;
$$;

drop trigger if exists people_merge_followups on public.people;
create trigger people_merge_followups
  after update of merged_into_person_id on public.people
  for each row
  when (old.merged_into_person_id is null and new.merged_into_person_id is not null)
  execute function public.people_merge_followups();

create or replace function public.leaders_merge_keeps_one_code()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- The person kept has only RETIRED initials and the moving row is active: the active code wins, and the kept
  -- person's retired row is the one released (its old entries keep their text).
  if new.retired_at is null
     and exists (select 1 from leaders where person_id = new.person_id and code <> new.code and retired_at is not null) then
    update leaders
       set archived_person_id = person_id, person_id = null, is_person = false, can_login = false
     where person_id = new.person_id and code <> new.code;
    return new;
  end if;
  if exists (select 1 from leaders where person_id = new.person_id and code <> new.code) then
    new.archived_person_id := old.person_id;
    new.person_id := null;
    new.retired_at := coalesce(old.retired_at, now());
    new.is_person := false;
    new.can_login := false;
  end if;
  return new;
end;
$$;

drop trigger if exists leaders_merge_keeps_one_code on public.leaders;
create trigger leaders_merge_keeps_one_code
  before update of person_id on public.leaders
  for each row
  when (new.person_id is not null and new.person_id is distinct from old.person_id)
  execute function public.leaders_merge_keeps_one_code();

revoke all on function public.people_merge_followups() from public, anon, authenticated;
revoke all on function public.leaders_merge_keeps_one_code() from public, anon, authenticated;
