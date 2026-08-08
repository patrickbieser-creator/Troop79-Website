-- Per-job description.
--
-- The signup already had ONE free-text field for the jobs block
-- (event_signups.slots_intro, rendered above the whole list), but the thing
-- leaders actually need to write varies per job, not per signup: "bring a
-- folding table, 6ft or larger", "sorting happens in the garage, park on the
-- street". A rummage sale with 30-40 jobs has 30-40 of these; one shared
-- paragraph at the top cannot carry them.
--
-- slots_intro is retired in the same change (its renderers and its builder
-- field are removed) because the event's own description already covers
-- "what is this signup for" — two overlapping intro fields is exactly the
-- kind of layering this project avoids. The COLUMN is deliberately left in
-- place rather than dropped: it holds text on live signups, and dropping it
-- is irreversible. Drop it in a later migration once nothing has read it for
-- a while.
alter table public.signup_slots
  add column if not exists description text;

comment on column public.signup_slots.description is
  'Optional per-job detail shown under the job name on the public event page. Plain text, no markup.';
