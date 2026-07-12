-- The Bugle calendar's real source data (a Google Sheet feeding a custom
-- Apps Script .ics generator) carries a genuine per-entry time-of-day that
-- varies row to row — the original calendar_entries migration assumed
-- routine categories had an institutionally-known, unstored time, which
-- turned out to be wrong once the actual sheet was reviewed. Adding it here
-- rather than redesigning: both columns stay nullable, so entries authored
-- without a specific time (e.g. an all-day fundraiser) still work.
--
-- 'Ceremony' is added as its own category — a Cub Scout Cross Over is a
-- distinct occasion from 'Court of Honor' (rank/Eagle recognition), not a
-- rename of it.

alter table public.calendar_entries
  add column start_time time,
  add column end_time time;

alter table public.calendar_entries drop constraint calendar_entries_category_check;
alter table public.calendar_entries add constraint calendar_entries_category_check check (category in (
  'Troop Meeting', 'No Meeting', 'Campout', 'High Adventure', 'Summer Camp',
  'Service Project', 'Outing', 'Fundraiser', 'Court of Honor', 'Committee Meeting', 'Ceremony'
));
