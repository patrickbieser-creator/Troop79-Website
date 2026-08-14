-- Roll Call, step 2 of 3: backfill existing attendance onto the spine.
--
-- WHY (Operator, 2026-08-14)
-- Meeting attendance already exists in two places — scouts as `ledger_entries`
-- rows (kind='meeting_attendance', code='MTG:<date>') and adults in the
-- date-keyed `meeting_attendance_leaders`. Both move onto event_attendance so
-- Roll Call opens on history rather than on an empty screen, and so
-- meeting_attendance_leaders can be retired.
--
-- The scout ledger rows STAY. They are advancement credit and everything from
-- the Clipboard to Scoutbook export reads them; what they gain is a
-- calendar_entry_id, so Roll Call can recognise the credit it would otherwise
-- grant twice.
--
-- Both halves are best-effort by necessity: a 2023 meeting may have no calendar
-- entry at all (the calendar does not reach that far back), and a leader_code
-- may have no person_id. Those rows are LEFT WHERE THEY ARE rather than
-- dropped, and the counts are raised at the end so the gap is visible instead
-- of silent.

-- ---------------------------------------------------------------------------
-- 1. Scouts' meeting attendance → event_attendance
-- ---------------------------------------------------------------------------
--
-- Matched by date to a calendar entry whose category carries the 'meeting'
-- BEHAVIOR — the same rule getMeetingCalendarContext() used before the calendar
-- unification, and the same one the meetings backfill used.

insert into public.event_attendance (calendar_entry_id, person_id, source, recorded_by, recorded_at)
select distinct on (ce.id, s.person_id)
  ce.id,
  s.person_id,
  'import',
  le.entered_by,
  le.entered_at
from public.ledger_active le
join public.scouts s on s.id = le.scout_id and s.person_id is not null
join public.calendar_entries ce on ce.entry_date = le.date
join public.calendar_categories cc on cc.label = ce.category and cc.behavior = 'meeting'
where le.kind = 'meeting_attendance'
order by ce.id, s.person_id, le.entered_at
on conflict (calendar_entry_id, person_id) do nothing;

-- Stamp those ledger rows so Roll Call knows the credit already exists and does
-- not grant it a second time.
update public.ledger_entries le
set calendar_entry_id = ce.id
from public.calendar_entries ce
join public.calendar_categories cc on cc.label = ce.category and cc.behavior = 'meeting'
where le.kind = 'meeting_attendance'
  and le.calendar_entry_id is null
  and ce.entry_date = le.date;

-- ---------------------------------------------------------------------------
-- 2. Adults' meeting attendance → event_attendance
-- ---------------------------------------------------------------------------
--
-- Only status='attended'. A 'committed' row is an intention to help, not a
-- record of presence, and this table means "was there".

insert into public.event_attendance (calendar_entry_id, person_id, source, note, recorded_at)
select distinct on (ce.id, l.person_id)
  ce.id,
  l.person_id,
  'import',
  mal.note,
  mal.created_at
from public.meeting_attendance_leaders mal
join public.leaders l on l.code = mal.leader_code and l.person_id is not null
join public.calendar_entries ce on ce.entry_date = mal.meeting_date
join public.calendar_categories cc on cc.label = ce.category and cc.behavior = 'meeting'
where mal.status = 'attended'
order by ce.id, l.person_id, mal.created_at
on conflict (calendar_entry_id, person_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Report what did NOT come across
-- ---------------------------------------------------------------------------
--
-- Deliberately a NOTICE, not an exception. Unlike the meetings backfill — where
-- an unlinked meeting would have been unopenable and so had to block — an
-- un-migrated attendance record is merely absent from a screen that did not
-- exist yesterday. Failing the deploy over a 2023 meeting with no calendar
-- entry would be the wrong trade. The numbers are raised so the gap is known.

do $$
declare
  moved_scouts   int;
  moved_adults   int;
  stamped        int;
  orphan_scouts  int;
  orphan_adults  int;
  no_person      int;
begin
  select count(*) into moved_scouts  from public.event_attendance where source = 'import';
  select count(*) into stamped       from public.ledger_entries
    where kind = 'meeting_attendance' and calendar_entry_id is not null;

  select count(*) into orphan_scouts
  from public.ledger_active le
  where le.kind = 'meeting_attendance'
    and not exists (
      select 1 from public.calendar_entries ce
      join public.calendar_categories cc on cc.label = ce.category and cc.behavior = 'meeting'
      where ce.entry_date = le.date
    );

  select count(*) into orphan_adults
  from public.meeting_attendance_leaders mal
  where mal.status = 'attended'
    and not exists (
      select 1 from public.calendar_entries ce
      join public.calendar_categories cc on cc.label = ce.category and cc.behavior = 'meeting'
      where ce.entry_date = mal.meeting_date
    );

  select count(*) into no_person
  from public.ledger_active le
  join public.scouts s on s.id = le.scout_id
  where le.kind = 'meeting_attendance' and s.person_id is null;

  select count(*) into moved_adults from public.meeting_attendance_leaders where status = 'attended';

  raise notice 'Roll Call backfill: % attendance rows created, % ledger rows stamped.',
    moved_scouts, stamped;
  raise notice '  left behind — % scout check-ins and % adult check-ins whose date has no meeting entry; % check-ins for scouts with no person_id.',
    orphan_scouts, orphan_adults, no_person;
  raise notice '  (adult rows considered: %)', moved_adults;
end;
$$;
