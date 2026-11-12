-- Name suffixes (Patrick, 2026-11-12): "Gabe Helkowski Sr.", "Jr.", "III".
--
-- people.suffix holds it; the derived display name becomes
-- nickname-or-first + ' ' + last + ' ' + suffix. The suffix is trimmed and a
-- blank one is stored as null, like nickname. first_name / last_name stay
-- clean, so the Scoutbook export, the BSA Roster check and "First L." public
-- names are unaffected.
--
-- The three name triggers fire on an UPDATE OF column list; suffix joins each
-- list so a suffix-only change reaches display_name, leaders.name and the
-- scouts mirror (an UPDATE OF trigger does not see a column a BEFORE trigger
-- derived — see 20261127100000).
--
-- Additive: deploy DB-first. No existing display_name changes (no row has a
-- suffix yet).

alter table public.people
  add column suffix text,
  add constraint people_suffix_length check (suffix is null or char_length(suffix) <= 10);

comment on column public.people.suffix is
  'Name suffix such as Sr., Jr., III. display_name is nickname-or-first + last + suffix (trigger people_derive_display_name).';

create or replace function public.people_derive_display_name()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $$
declare
  v_first text := nullif(trim(coalesce(new.nickname, '')), '');
  v_last text := nullif(trim(coalesce(new.last_name, '')), '');
  v_suffix text := nullif(trim(coalesce(new.suffix, '')), '');
begin
  new.nickname := v_first;
  new.suffix := v_suffix;
  v_first := coalesce(v_first, nullif(trim(coalesce(new.first_name, '')), ''));
  if v_first is not null and v_last is not null then
    new.display_name := v_first || ' ' || v_last || coalesce(' ' || v_suffix, '');
  end if;
  return new;
end;
$$;

drop trigger if exists people_derive_display_name on public.people;
create trigger people_derive_display_name
  before insert or update of first_name, last_name, nickname, suffix, display_name on public.people
  for each row execute function public.people_derive_display_name();

drop trigger if exists people_sync_scout_name on public.people;
create trigger people_sync_scout_name
  after update of first_name, last_name, nickname, suffix, display_name on public.people
  for each row execute function public.people_sync_scout_name();

drop trigger if exists people_sync_leader_name on public.people;
create trigger people_sync_leader_name
  after update of first_name, last_name, nickname, suffix, display_name on public.people
  for each row execute function public.sync_leader_name_from_person();

revoke execute on function public.people_derive_display_name() from public, anon, authenticated;
