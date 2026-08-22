-- participant_class default trigger (Plans/Participant-Classification.md).
--
-- Every inserter of signup_entries — the submit_household_signup RPC (public
-- form), the leader's Add a person, tests — must produce a participant_class,
-- and the column is NOT NULL. Rather than touching the RPC (documented history
-- of breaking on signature changes), the DEFAULT is derived here, BEFORE
-- INSERT, from the same rule as lib/participant-class defaultClassFor():
--   adult (no scouts row)            → 'adult'
--   scout, override 'yes'/'no'        → 'junior_leader' / 'scout'
--   scout, grade 9–12 at event date   → 'junior_leader'   (June 15 rollover)
--   scout otherwise / unknown grade   → 'scout'
-- An inserter that SETS participant_class explicitly is left alone (the
-- trigger only fills NULL), so guest rows and per-event edits are unaffected.
-- The two must stay in lockstep: change one, change the other, and the
-- test in tests/participant-class.test.ts that compares them.

create or replace function public.default_participant_class(
  p_person_id bigint,
  p_event_signup_id bigint
) returns text
language sql
stable
as $$
  with ev as (
    select ce.entry_date
    from public.event_signups es
    join public.calendar_entries ce on ce.id = es.calendar_entry_id
    where es.id = p_event_signup_id
  ),
  sc as (
    select s.graduation_year, s.junior_leader_override
    from public.scouts s
    where s.person_id = p_person_id
    limit 1
  ),
  sye as (
    -- school-year end as of the event date: June 15 rollover
    select case
      when ev.entry_date >= make_date(extract(year from ev.entry_date)::int, 6, 15)
        then extract(year from ev.entry_date)::int + 1
      else extract(year from ev.entry_date)::int
    end as year_end
    from ev
  )
  select case
    when not exists (select 1 from sc) then 'adult'
    when (select junior_leader_override from sc) = 'yes' then 'junior_leader'
    when (select junior_leader_override from sc) = 'no' then 'scout'
    when (select graduation_year from sc) is null then 'scout'
    when (select year_end from sye) is null then 'scout'
    when (12 - ((select graduation_year from sc) - (select year_end from sye))) between 9 and 12
      then 'junior_leader'
    else 'scout'
  end;
$$;

create or replace function public.signup_entries_default_class()
returns trigger
language plpgsql
as $$
begin
  if new.participant_class is null then
    if new.person_id is null then
      -- A guest row without an explicit class is a caller bug; the
      -- signup_entries_guest_class CHECK will refuse it downstream. Leave
      -- null so the constraint message names the real problem.
      return new;
    end if;
    new.participant_class := public.default_participant_class(new.person_id, new.event_signup_id);
  end if;
  return new;
end;
$$;

drop trigger if exists signup_entries_default_class on public.signup_entries;
create trigger signup_entries_default_class
  before insert on public.signup_entries
  for each row execute function public.signup_entries_default_class();
