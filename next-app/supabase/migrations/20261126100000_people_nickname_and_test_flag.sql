-- Nicknames and test people (Patrick, 2026-10-20).
--
-- people.nickname: what a person goes by ("Becky" for Rebecca). The display
-- name is now DERIVED: nickname-or-first + ' ' + last, by the trigger below,
-- for every person with a first and last name. Nine app paths and several SQL
-- functions write names; deriving here keeps them all consistent (one of them,
-- change-request approval, never refreshed display_name). People without a
-- first AND last name (guests, "Chase's Mom") keep the display name they were
-- given. The scouts row's name mirror follows its person.
--
-- people.is_test: a person who exists only for testing (Charlie Walters, Todd
-- Manke). Left out of the EmailOctopus sync and the BSA Roster check.
--
-- Additive: deploy DB-first. The trigger only fires on a name write, so no
-- existing display_name changes until the nickname backfill touches it.

alter table public.people
  add column nickname text,
  add column is_test boolean not null default false;

comment on column public.people.nickname is
  'What the person goes by. display_name is nickname-or-first + last (trigger people_derive_display_name).';
comment on column public.people.is_test is
  'A test record: left out of the EmailOctopus sync and the BSA Roster check.';

create or replace function public.people_derive_display_name()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $$
declare
  v_first text := nullif(trim(coalesce(new.nickname, '')), '');
  v_last text := nullif(trim(coalesce(new.last_name, '')), '');
begin
  new.nickname := v_first;
  v_first := coalesce(v_first, nullif(trim(coalesce(new.first_name, '')), ''));
  if v_first is not null and v_last is not null then
    new.display_name := v_first || ' ' || v_last;
  end if;
  return new;
end;
$$;

drop trigger if exists people_derive_display_name on public.people;
create trigger people_derive_display_name
  before insert or update of first_name, last_name, nickname, display_name on public.people
  for each row execute function public.people_derive_display_name();

-- The scouts row carries a copy of the name (first/last/display) that some
-- screens still read; keep it the person's.
create or replace function public.people_sync_scout_name()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $$
begin
  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.display_name is distinct from old.display_name then
    update public.scouts
       set first_name = coalesce(new.first_name, first_name),
           last_name = coalesce(new.last_name, last_name),
           display_name = new.display_name
     where person_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists people_sync_scout_name on public.people;
create trigger people_sync_scout_name
  after update of first_name, last_name, nickname, display_name on public.people
  for each row execute function public.people_sync_scout_name();

revoke execute on function public.people_derive_display_name() from public, anon, authenticated;
revoke execute on function public.people_sync_scout_name() from public, anon, authenticated;
