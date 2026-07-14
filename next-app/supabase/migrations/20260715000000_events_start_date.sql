-- Events get an optional start date so the Lookups list and the Fast Entry
-- picker can both surface the most recent events first instead of an
-- alphabetical list. Nullable — events created before this migration (or
-- without a specific date) just sort after every dated event.

alter table public.events
  add column start_date date;
