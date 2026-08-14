-- Roll Call, step 1 of 3: additive only (Plans/Roll-Call.md).
--
-- WHY (Operator, 2026-08-14)
-- Three overlapping people-trackers exist and none of them sees the others:
-- `ledger_entries` (credit, scouts only), `meeting_attendance_leaders` (adults,
-- meetings only, DATE-keyed) and `signup_entries` (intent, signup events only).
-- There is no "who was at this event" screen for anything but a meeting, adults
-- are invisible outside meetings, and a verbal RSVP cannot be entered at all.
--
-- Attendance becomes the fourth LAYER on calendar_entries, after story, agenda
-- and signup.
--
-- IT DOES NOT BECOME THE STORE FOR ADVANCEMENT QUANTITIES. Measured before
-- deciding: the ledger is read by 32 code files, 24 migrations, 4 views and 3
-- triggers including ledger_auto_rank_award. Moving campout nights out means
-- re-pointing rank-award logic whose failure mode is silent — a scout does not
-- earn a rank and nobody notices for months. Roll Call WRITES ledger rows
-- instead, so everything that reads the ledger keeps working untouched.
--
-- Presence and credit are also genuinely different facts, not a duplication to
-- be collapsed: a scout can attend a campout and earn zero nights (came for the
-- day), a driver is present and earns nothing, and an adult is present with no
-- ledger at all.

-- ---------------------------------------------------------------------------
-- 1. event_attendance — presence only
-- ---------------------------------------------------------------------------

create table public.event_attendance (
  id                bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id         bigint not null references public.people(id) on delete cascade,
  -- Nights/hours/miles credited to THIS person. Null = take the category
  -- default (for campouts, the entry's own date span).
  qty               numeric,
  source            text not null default 'manual'
                      check (source in ('signup', 'manual', 'import')),
  note              text,
  recorded_by       text,
  recorded_at       timestamptz not null default now(),
  unique (calendar_entry_id, person_id)
);

comment on table public.event_attendance is
  'Who was at a calendar entry. A ROW MEANS "WAS THERE" — absence is the absence of a row (Patrick, 2026-08-14), so there is no status column and no absent rows. Consequence accepted: "roll call not taken" and "nobody came" are indistinguishable here; a signed-up no-show surfaces through the mismatch panel against signup_entries instead.';

comment on column public.event_attendance.person_id is
  'The people spine — scouts AND adults in one table. This is what retires meeting_attendance_leaders, the last adults-only, date-keyed people table left after the calendar unification.';

comment on column public.event_attendance.source is
  'How we know: seeded from a signup, added by a leader, or backfilled. Provenance, not permission — a signup-sourced row is edited and deleted exactly like a manual one.';

create index event_attendance_entry_idx on public.event_attendance (calendar_entry_id);
create index event_attendance_person_idx on public.event_attendance (person_id);

alter table public.event_attendance enable row level security;
-- Zero policies: service-role only, same posture as every other people-bearing
-- table (D-051). Attendance names minors.

-- ---------------------------------------------------------------------------
-- 2. ledger_entries.calendar_entry_id — the provenance link
-- ---------------------------------------------------------------------------
--
-- THE KEYSTONE. The ledger has no event link today, only a `code` string.
-- Without this column none of the three things automatic credit requires are
-- possible: cascade on uncheck (find the row this attendance created),
-- idempotency (recognise credit already granted), and reconciliation (the audit
-- has nothing to join on).

alter table public.ledger_entries
  add column calendar_entry_id bigint references public.calendar_entries(id) on delete set null;

comment on column public.ledger_entries.calendar_entry_id is
  'The calendar entry whose Roll Call granted this credit. NULL means "not from Roll Call" — ~9,700 historical rows have no event, and Fast Entry may legitimately record a scout who camped with another troop. The reconciliation audit MUST ignore null rows.';

create index ledger_entries_calendar_entry_idx
  on public.ledger_entries (calendar_entry_id)
  where calendar_entry_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Category rules: what an entry grants, and whether it is an activity
-- ---------------------------------------------------------------------------

alter table public.calendar_categories
  add column credit_kind text
    check (credit_kind in ('camping_nights', 'hiking_miles', 'service_hours',
                           'day_outing', 'fundraiser', 'meeting_attendance')),
  add column credit_unit text,
  add column counts_as_activity boolean not null default true;

comment on column public.calendar_categories.credit_kind is
  'The ledger kind Roll Call writes for this category, or null to write none. Only camping_nights / hiking_miles / service_hours carry a quantity.';

comment on column public.calendar_categories.counts_as_activity is
  'Counts toward the "N troop activities" in Second Class 1a and First Class 1a. The dividing line is MEETING vs EVENT (Patrick, 2026-08-14): meetings are excluded by BSA by name, and several things that sound like events are meetings in practice — a Court of Honor and an advancement night are meetings. Discretion for the odd case (an advancement event that was really an out-of-town clinic) is exercised by RECLASSIFYING the entry''s category, which needs no override column because the category already carries template, credit kind and this flag together.';

-- Seeded from the meeting-vs-event line. Everything not named here keeps the
-- permissive default (counts_as_activity = true, no credit).
update public.calendar_categories set credit_kind = 'meeting_attendance', counts_as_activity = false
  where label in ('Troop Meeting');

update public.calendar_categories set counts_as_activity = false
  where label in ('No Meeting', 'Ceremony / Recognition', 'Advancement Event', 'Leadership / Planning');

update public.calendar_categories set credit_kind = 'camping_nights', credit_unit = 'nights'
  where label in ('Campout / Overnight', 'Summer Camp', 'High Adventure');

update public.calendar_categories set credit_kind = 'service_hours', credit_unit = 'hours'
  where label = 'Service Project';

update public.calendar_categories set credit_kind = 'day_outing', credit_unit = 'each'
  where label = 'Day Activity / Outing';

update public.calendar_categories set credit_kind = 'fundraiser', credit_unit = 'each'
  where label = 'Fundraiser';

-- Training, Recruiting / Outreach and Social Event count as activities
-- (Patrick, 2026-08-14) but grant no ledger credit of their own — they are
-- covered by the default: counts_as_activity = true, credit_kind = null.
