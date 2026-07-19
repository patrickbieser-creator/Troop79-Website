-- Let each event name its own jobs block.
--
-- "Shifts & tasks" reads correctly for a pancake breakfast and badly for a
-- Court of Honor, where the same mechanism means "bring a dessert". The
-- underlying model (signup_slots) is genuinely the same; only the words need
-- to change, so this is two nullable label columns rather than a second
-- feature.
--
-- Null falls back to the generic wording in the UI, so existing events are
-- unaffected.

alter table public.event_signups
  add column if not exists slots_title text,
  add column if not exists slots_intro text;

comment on column public.event_signups.slots_title is
  'Heading for the jobs block, e.g. "What can you bring?" for a Court of Honor '
  'or "Jobs — who''s still needed" for a fundraiser. Null = generic default.';
comment on column public.event_signups.slots_intro is
  'Sentence under that heading explaining what is being asked of families.';

-- Give the potluck-style event types wording that fits them, where a leader
-- hasn''t already set their own.
update public.event_signups es
set slots_title = 'What can you bring?',
    slots_intro = 'Potluck-style — tell us what your family is bringing so we do not end up with fifteen desserts and no salad.'
from public.calendar_entries ce
where ce.id = es.calendar_entry_id
  and ce.category in ('Ceremony / Recognition', 'Social Event')
  and es.slots_title is null;

update public.event_signups es
set slots_title = 'Jobs — who''s still needed',
    slots_intro = 'Claiming a job is your signup; there is no separate RSVP.'
from public.calendar_entries ce
where ce.id = es.calendar_entry_id
  and ce.category in ('Fundraiser', 'Service Project', 'Recruiting / Outreach')
  and es.slots_title is null;
