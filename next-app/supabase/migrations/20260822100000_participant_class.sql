-- Participant classification for event sign-ups
-- (Plans/Participant-Classification.md, Patrick 2026-08-21).
--
-- Every sign-up entry gets a participant_class — adult | scout | junior_leader
-- | webelos | cub_scout | youth_guest | adult_guest — stored per ENTRY and
-- defaulted from the roster person at sign-up time (lib/participant-class
-- defaultClassFor; the SQL backfill below is the same rule). Junior Leader =
-- a scout in grades 9–12 AS OF THE EVENT DATE (graduation_year, June 15
-- rollover), unless the scout's roster record overrides it.
--
-- Guests become NAMED rows: person_id is nullable for them; they carry
-- guest_name + host_entry_id (the roster entry that brought them) and one of
-- the four guest classes. The legacy guest_count/guest_note columns stay for
-- rows that already have them (displayed, no longer collected).

-- ── 1. Roster override for Junior Leader ─────────────────────────────────
alter table public.scouts
  add column if not exists junior_leader_override text
    check (junior_leader_override in ('yes', 'no'));
comment on column public.scouts.junior_leader_override is
  'Junior Leader override for event sign-ups: yes/no; null = derive from grade 9-12 (lib/participant-class).';

-- ── 2. The class column, nullable first so it can be backfilled ──────────
alter table public.signup_entries
  add column if not exists participant_class text
    check (participant_class in
      ('adult', 'scout', 'junior_leader', 'webelos', 'cub_scout', 'youth_guest', 'adult_guest'));

-- ── 3. Backfill — same rule as defaultClassFor(), evaluated at the event date
update public.signup_entries e
set participant_class = case
  when e.person_kind = 'adult' then 'adult'
  else coalesce((
    select case
      when s.junior_leader_override = 'yes' then 'junior_leader'
      when s.junior_leader_override = 'no' then 'scout'
      when s.graduation_year is null then 'scout'
      when (
        12 - (
          s.graduation_year - (
            -- school-year end as of the event date: June 15 rollover
            case
              when ce.entry_date >= make_date(extract(year from ce.entry_date)::int, 6, 15)
                then extract(year from ce.entry_date)::int + 1
              else extract(year from ce.entry_date)::int
            end
          )
        )
      ) between 9 and 12 then 'junior_leader'
      else 'scout'
    end
    from public.event_signups es
    join public.calendar_entries ce on ce.id = es.calendar_entry_id
    left join public.scouts s on s.person_id = e.person_id
    where es.id = e.event_signup_id
  ), 'scout')
end
where e.participant_class is null;

alter table public.signup_entries alter column participant_class set not null;

-- ── 4. Named guest rows ──────────────────────────────────────────────────
alter table public.signup_entries
  alter column person_id drop not null,
  add column if not exists guest_name text,
  add column if not exists host_entry_id bigint
    references public.signup_entries(id) on delete cascade;

-- D-066's identity rule relaxes ONLY for guests: a row is either a roster
-- person (person_id) or a named guest brought by a host entry.
alter table public.signup_entries drop constraint if exists signup_entries_identity;
alter table public.signup_entries add constraint signup_entries_identity check (
  person_id is not null
  or (guest_name is not null and length(trim(guest_name)) > 0 and host_entry_id is not null)
);

-- A guest row must carry a guest class (roster rows may carry any class).
alter table public.signup_entries drop constraint if exists signup_entries_guest_class;
alter table public.signup_entries add constraint signup_entries_guest_class check (
  person_id is not null
  or participant_class in ('webelos', 'cub_scout', 'youth_guest', 'adult_guest')
);

create index if not exists signup_entries_host_entry_idx
  on public.signup_entries (host_entry_id)
  where host_entry_id is not null;

comment on column public.signup_entries.participant_class is
  'adult | scout | junior_leader | webelos | cub_scout | youth_guest | adult_guest — defaulted from the roster person at sign-up (lib/participant-class), editable per event.';
comment on column public.signup_entries.guest_name is
  'Named guest (non-roster attendee): set with host_entry_id when person_id is null.';
comment on column public.signup_entries.host_entry_id is
  'The roster entry (household member) that brought this guest; cascade-deletes with it.';
