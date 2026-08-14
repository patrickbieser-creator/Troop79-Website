-- Calendar unification, step 2 of 3: backfill and constrain.
--
-- WHY (Operator, 2026-08-14)
-- 20260814100000 added meetings.calendar_entry_id nullable. This links every
-- existing meeting to a calendar entry, makes the link mandatory, and drops the
-- one-meeting-per-date rule.
--
-- The backfill is exactly the join lib/meetings.ts getCalendarMeetingEntry()
-- has been doing at READ time since the Meetings system shipped: a meeting and
-- a calendar entry belong together when they share a date and the entry's
-- category carries a behavior flag. Making it a stored FK is the whole point —
-- the correlation stops being recomputed (and stops being wrong the moment
-- either side's date is edited).
--
-- Meetings whose date has no calendar entry get one created. Those are the
-- meetings that were invisible to the calendar page, the homepage sidebar and
-- /calendar.ics — the bug this plan exists to close. After this migration a
-- meeting that is not on the calendar cannot exist.
--
-- DROPPING THE UNIQUE CONSTRAINT (Patrick, 2026-08-14): several meetings may
-- share a date. A committee meeting and a troop meeting on one night is real,
-- and the date-keyed model could not express it. This is also what forces
-- /events/[id] to be the single public permalink — once a date can hold two
-- meetings, no date-keyed URL can address them, which is why /meetings/[date]
-- is being deleted rather than redirected.

-- ---------------------------------------------------------------------------
-- 1. Link meetings to the calendar entry they already implicitly belonged to
-- ---------------------------------------------------------------------------

-- Lowest id wins if a date somehow carries two behavior-category entries, so
-- the result is deterministic and a re-run is idempotent.
update public.meetings m
set calendar_entry_id = e.id
from (
  select distinct on (ce.entry_date) ce.entry_date, ce.id
  from public.calendar_entries ce
  join public.calendar_categories cc on cc.label = ce.category
  where cc.behavior is not null
  order by ce.entry_date, ce.id
) e
where m.calendar_entry_id is null
  and e.entry_date = m.meeting_date;

-- ---------------------------------------------------------------------------
-- 2. Create entries for meetings the calendar never knew about
-- ---------------------------------------------------------------------------

with created as (
  insert into public.calendar_entries (entry_date, category, title, location, on_calendar)
  select
    m.meeting_date,
    (select label from public.calendar_categories where behavior = 'meeting'),
    coalesce(nullif(btrim(m.title), ''), 'Troop Meeting'),
    m.location,
    true
  from public.meetings m
  where m.calendar_entry_id is null
  returning id, entry_date
)
update public.meetings m
set calendar_entry_id = created.id
from created
where m.calendar_entry_id is null
  and created.entry_date = m.meeting_date;

-- ---------------------------------------------------------------------------
-- 3. Verify before constraining — a silent partial backfill here would surface
--    much later as a meeting that cannot be opened.
-- ---------------------------------------------------------------------------

do $$
declare
  orphans int;
begin
  select count(*) into orphans from public.meetings where calendar_entry_id is null;
  if orphans > 0 then
    raise exception
      'Calendar unification backfill incomplete: % meeting(s) still have no calendar_entry_id. Refusing to add NOT NULL.',
      orphans;
  end if;
end;
$$;

alter table public.meetings
  alter column calendar_entry_id set not null;

-- ---------------------------------------------------------------------------
-- 4. One agenda layer per entry; many meetings per date
-- ---------------------------------------------------------------------------

-- The layer model: an entry has at most one agenda. Two meetings on one night
-- are two entries, each with its own agenda — not one entry with two.
create unique index meetings_calendar_entry_key
  on public.meetings (calendar_entry_id);

-- The rule that made a second meeting on a date impossible.
alter table public.meetings
  drop constraint meetings_meeting_date_key;

-- Dropping the unique constraint drops its index with it, and meeting_date is
-- still ordered and filtered on everywhere until 20260814120000 retires the
-- column. Keep a plain index for the transition.
create index meetings_meeting_date_idx
  on public.meetings (meeting_date);
