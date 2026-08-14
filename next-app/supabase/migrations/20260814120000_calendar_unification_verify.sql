-- Calendar unification, step 3 of 3: verify the backfill linked correctly.
--
-- WHY (Operator, 2026-08-14, from qa-lead review)
-- 20260814110000's backfill picks ONE calendar entry per date with
-- `distinct on (ce.entry_date) ... order by ce.entry_date, ce.id` — lowest id
-- wins. That tie-break is only reachable if a single date carries TWO
-- behavior-tagged entries, which is not true of the local dataset (checked: the
-- one date with two entries has neither on a behavior category). But "not true
-- locally" is not "not true on production", and a mislink would be invisible:
-- the meeting would open, render, and simply belong to the wrong entry.
--
-- So rather than trusting the local check, this asserts the invariant wherever
-- it runs. `meetings.meeting_date` still exists at this point precisely because
-- it has not been dropped yet — which makes it the perfect independent witness:
-- if the link is right, the linked entry's date must equal the meeting's own
-- recorded date. This migration is the last use of that column, and the reason
-- to keep it around one more deploy.
--
-- On production this runs BEFORE the application code (D-089 ordering). If it
-- raises, the deploy stops with the mislinked rows named, instead of shipping a
-- silently wrong calendar.

do $$
declare
  mismatched int;
  sample text;
begin
  select count(*) into mismatched
  from public.meetings m
  join public.calendar_entries e on e.id = m.calendar_entry_id
  where e.entry_date <> m.meeting_date;

  if mismatched > 0 then
    select string_agg(format('meeting %s: recorded %s, linked entry %s is %s',
                             m.id, m.meeting_date, e.id, e.entry_date), '; ')
      into sample
    from public.meetings m
    join public.calendar_entries e on e.id = m.calendar_entry_id
    where e.entry_date <> m.meeting_date;

    raise exception
      'Calendar unification backfill mislinked % meeting(s) — the entry a meeting points at does not fall on the meeting''s own date. Fix these before the application code ships. %',
      mismatched, sample;
  end if;
end;
$$;
