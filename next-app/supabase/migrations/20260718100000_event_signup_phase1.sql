-- Event Signup & RSVP — Phase 1 schema (Plans/Event-Signup.md).
--
-- Families sign up for calendar events: who's coming, what they owe, what jobs
-- they've claimed, who's driving. No online payment is ever collected — events
-- publish a price and instructions, and leaders tick "payment received".
--
-- Two shapes of signup share these tables, decided by `attendance_enabled`:
--   * attendance-driven (campout, ski, summer camp): the PERSON is the unit —
--     each person RSVPs, picks a price tier, offers driver seats.
--   * slot-driven (pancake breakfast, rummage sale): the JOB is the unit —
--     `attendance_enabled = false`, and claiming a slot IS the signup. The
--     family form is organized by job, not by person.
-- Both write the same rows; only the input surface differs.
--
-- Everything hangs off `calendar_entries` (the public calendar), NOT the
-- `events` lookup, which is an unrelated ledger-classification table.
--
-- RLS: signup tables get RLS enabled and NO select policy — the anon key
-- (shipped to every browser via NEXT_PUBLIC_*) must never read family names or
-- RSVP data. All loaders use the service-role client, which bypasses RLS,
-- gated by app-level role checks. `event_resources` is public event content
-- and keeps an open read, matching calendar_entries.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CALENDAR CATEGORY TAXONOMY → the 13 signup event types (+ No Meeting)
-- ═══════════════════════════════════════════════════════════════════════════
-- `category` seeds the signup block PRESET for an event (which blocks default
-- on), so the list has to cover the shapes the troop actually runs. Renames
-- below are label changes only — no row is reclassified except the merge.
--
-- SUPERSEDES 20260712010000, which split 'Ceremony' from 'Court of Honor'
-- ("a Cub Scout Cross Over is a distinct occasion ... not a rename of it").
-- Patrick's call 2026-07-18: collapse both into 'Ceremony / Recognition'. The
-- two take identical signup presets (attendance + guests), so the distinction
-- earned its own category on the calendar but not in this feature. Recorded
-- here so the reversal reads as deliberate rather than as drift.

alter table public.calendar_entries drop constraint calendar_entries_category_check;

update public.calendar_entries set category = 'Campout / Overnight'    where category = 'Campout';
update public.calendar_entries set category = 'Day Activity / Outing'  where category = 'Outing';
update public.calendar_entries set category = 'Leadership / Planning'  where category = 'Committee Meeting';
update public.calendar_entries set category = 'Ceremony / Recognition' where category in ('Court of Honor', 'Ceremony');

alter table public.calendar_entries add constraint calendar_entries_category_check check (category in (
  'Troop Meeting',
  'Campout / Overnight',
  'Day Activity / Outing',
  'High Adventure',
  'Summer Camp',
  'Service Project',
  'Fundraiser',
  'Advancement Event',
  'Training',
  'Ceremony / Recognition',
  'Leadership / Planning',
  'Recruiting / Outreach',
  'Social Event',
  'No Meeting'          -- calendar-only; signup never applies
));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EVENT CONTENT (public — no gate)
-- ═══════════════════════════════════════════════════════════════════════════

-- Markdown event details, rendered with the same renderer as the News CMS.
alter table public.calendar_entries add column if not exists details_md text;

-- Attachments and links shown on the event page: packing lists, permission
-- slips, trail maps. Files upload through the existing Bunny CDN pipeline and
-- are stored here as URLs; directions are plain links.
create table if not exists public.event_resources (
  id bigserial primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  label text not null,
  url text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_resources_entry_idx
  on public.event_resources (calendar_entry_id, sort);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. EVENT SIGNUPS — presence of a row means "signup is enabled on this event"
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.event_signups (
  id bigserial primary key,
  calendar_entry_id bigint not null unique references public.calendar_entries(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),

  -- Hard lock, enforced server-side. Defaults to event start − 5 days (applied
  -- by the app, not here, since it needs the calendar entry's date).
  deadline timestamptz not null,

  capacity int check (capacity is null or capacity > 0),
  waitlist_enabled boolean not null default false,

  -- Which blocks this event composes. Pricing / slots / questions are implied
  -- by the presence of their rows; these three need explicit flags.
  attendance_enabled boolean not null default true,   -- false ⇒ slot-first form
  drivers_needed boolean not null default false,
  allow_guests boolean not null default false,

  -- Who the attendance block offers (adult training, PLC, scout-only clinics).
  audience text not null default 'both' check (audience in ('scouts', 'adults', 'both')),

  payment_instructions text,
  needs_permission_slip boolean not null default false,
  needs_ahmr_c boolean not null default false,
  notes_prompt text,
  guest_prompt text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A waitlist with no capacity has nothing to queue behind.
  constraint event_signups_waitlist_needs_capacity
    check (waitlist_enabled = false or capacity is not null)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PRICING TIERS — zero rows = free event
-- ═══════════════════════════════════════════════════════════════════════════
-- Costs differ by participant class: scouts vs. adults, skiing adult vs. $0
-- chaperone, summer-camp adults charged per DAY. Each attendee picks one tier.
-- Amount owed is always DERIVED (Σ tier × days), never stored.

create table if not exists public.event_prices (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,
  label text not null,                                -- "Scout", "Adult — chaperone/driver"
  amount numeric(10,2) not null check (amount >= 0),
  per text not null default 'event' check (per in ('event', 'day')),
  applies_to text not null default 'both' check (applies_to in ('scouts', 'adults', 'both')),
  sort int not null default 0,
  unique (event_signup_id, label)
);
create index if not exists event_prices_signup_idx
  on public.event_prices (event_signup_id, sort);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. SHIFTS AND TASKS — one mechanism (a task is a shift without times)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.signup_slots (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,
  kind text not null check (kind in ('shift', 'task')),
  label text not null,

  -- Which day this slot falls on. Multi-day events need it (a rummage sale has
  -- a Friday sorting night and a Saturday sale day), and it drives the day
  -- grouping in the slot-first form. Null on untimed tasks, which group as
  -- "anytime before the event".
  slot_date date,
  starts_at time,
  ends_at time,

  -- false ⇒ donation-style task ("donate 10 lb pancake mix"), claimable by a
  -- contributor who isn't attending at all.
  attendance_required boolean not null default true,

  eligibility text not null default 'both' check (eligibility in ('scouts', 'adults', 'both')),
  needed int check (needed is null or needed > 0),     -- null = unlimited
  sort int not null default 0,

  -- Shifts are timed, tasks are not.
  constraint signup_slots_times_match_kind check (
    (kind = 'shift' and starts_at is not null and ends_at is not null)
    or (kind = 'task' and starts_at is null and ends_at is null)
  ),
  -- You cannot work a shift without being there.
  constraint signup_slots_shift_requires_attendance
    check (kind <> 'shift' or attendance_required = true)
);
create index if not exists signup_slots_signup_idx
  on public.signup_slots (event_signup_id, slot_date, sort);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SIGNUP ENTRIES — one row per person (or per explicit decline)
-- ═══════════════════════════════════════════════════════════════════════════
-- Edited IN PLACE, not replace-on-save (the first departure from the
-- scout_parents pattern): entries need stable identity so leader-managed
-- slip/payment checkboxes and slot claims survive a family editing their RSVP.

create table if not exists public.signup_entries (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,

  -- Identity: exactly one of these four, consistent with person_kind.
  person_kind text not null check (person_kind in ('scout', 'adult')),
  scout_id text references public.scouts(id),
  scout_parent_id bigint references public.scout_parents(id),
  leader_code text references public.leaders(code),
  adult_name text,                                    -- fallback for other adults

  status text not null check (status in ('yes', 'no', 'waitlist', 'cancelled')),

  -- Chosen tier. RESTRICT so the builder can't delete a tier households have
  -- already picked and silently orphan the owed math.
  price_id bigint references public.event_prices(id) on delete restrict,
  days int check (days is null or days > 0),          -- required iff tier is per-day

  -- full         — attending
  -- driver_only  — adult providing transportation without attending: never
  --                charged, excluded from headcount, capacity, and two-deep
  -- contributor  — donates items / claims non-attendance tasks without
  --                attending: owes nothing, counts toward nothing
  participation text not null default 'full'
    check (participation in ('full', 'driver_only', 'contributor')),

  -- Driving is per-leg: an adult may drive up, drive back, or both, and may
  -- offer different seat counts each way (different vehicle, different riders).
  drives_out boolean not null default false,
  drives_back boolean not null default false,
  seats_offered_out int,                              -- seats BESIDES the driver
  seats_offered_back int,

  volunteer_note text,

  -- Guests are counted, never named. An Eagle Court of Honor family may bring
  -- 30+; guest_note is an optional free-form "who are they" ("grandparents,
  -- 2 aunts, neighbors") so the roster can show the count with context.
  guest_count int not null default 0 check (guest_count >= 0 and guest_count <= 200),
  guest_note text,

  notes text,
  permission_slip_received boolean not null default false,   -- leader-managed
  payment_received boolean not null default false,           -- leader-managed

  household_scout_id text references public.scouts(id),
  entered_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,

  -- Exactly one identity column, matching person_kind.
  constraint signup_entries_identity check (
    (person_kind = 'scout'
      and scout_id is not null
      and scout_parent_id is null and leader_code is null and adult_name is null)
    or (person_kind = 'adult'
      and scout_id is null
      and (scout_parent_id is not null)::int
        + (leader_code is not null)::int
        + (adult_name is not null)::int = 1)
  ),
  -- Driver-only is an adult concept, must actually drive a leg, is never
  -- charged, and can't be waitlisted (it doesn't consume capacity).
  constraint signup_entries_driver_only check (
    participation <> 'driver_only'
    or (person_kind = 'adult'
        and (drives_out or drives_back)
        and price_id is null
        and status <> 'waitlist')
  ),
  -- Contributors owe nothing and can't be waitlisted for the same reason.
  constraint signup_entries_contributor check (
    participation <> 'contributor' or (price_id is null and status <> 'waitlist')
  ),
  -- A seat count is present exactly when its leg is offered, and is positive.
  constraint signup_entries_seats_out check (
    (drives_out and seats_offered_out is not null and seats_offered_out > 0)
    or (not drives_out and seats_offered_out is null)
  ),
  constraint signup_entries_seats_back check (
    (drives_back and seats_offered_back is not null and seats_offered_back > 0)
    or (not drives_back and seats_offered_back is null)
  )
);

-- Real upsert keys. Partial so a cancelled entry doesn't block signing up
-- again — this is the constraint that makes the D-023 duplicate-row failure
-- mode impossible by construction rather than by application discipline.
create unique index if not exists signup_entries_scout_uniq
  on public.signup_entries (event_signup_id, scout_id)
  where scout_id is not null and status <> 'cancelled';
create unique index if not exists signup_entries_parent_uniq
  on public.signup_entries (event_signup_id, scout_parent_id)
  where scout_parent_id is not null and status <> 'cancelled';
create unique index if not exists signup_entries_leader_uniq
  on public.signup_entries (event_signup_id, leader_code)
  where leader_code is not null and status <> 'cancelled';
create unique index if not exists signup_entries_adultname_uniq
  on public.signup_entries (event_signup_id, lower(adult_name))
  where adult_name is not null and status <> 'cancelled';

create index if not exists signup_entries_signup_status_idx
  on public.signup_entries (event_signup_id, status);
create index if not exists signup_entries_household_idx
  on public.signup_entries (event_signup_id, household_scout_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. SLOT CLAIMS
-- ═══════════════════════════════════════════════════════════════════════════
-- Deliberately NO status cascade: entries are soft-status by design, and a
-- claim must survive waitlist → yes round-trips. Coverage counts and the claim
-- RPC filter to status='yes' instead, so a cancelled entry releases its slot
-- without the row being destroyed. A future hard-delete script must clean
-- claims explicitly.

create table if not exists public.signup_slot_claims (
  slot_id bigint not null references public.signup_slots(id) on delete cascade,
  signup_entry_id bigint not null references public.signup_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slot_id, signup_entry_id)
);
create index if not exists signup_slot_claims_entry_idx
  on public.signup_slot_claims (signup_entry_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PER-PARTICIPANT QUESTIONS (schema now; family/admin UI in Phase 2)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.signup_questions (
  id bigserial primary key,
  event_signup_id bigint not null references public.event_signups(id) on delete cascade,
  prompt text not null,
  input_type text not null check (input_type in ('text', 'number', 'choice')),
  choices text[],
  applies_to text not null default 'both' check (applies_to in ('scouts', 'adults', 'both')),
  required boolean not null default false,
  sort int not null default 0,
  -- A choice question needs choices; the others must not carry them.
  constraint signup_questions_choices_match_type check (
    (input_type = 'choice' and choices is not null and array_length(choices, 1) > 0)
    or (input_type <> 'choice' and choices is null)
  )
);

create table if not exists public.signup_answers (
  signup_entry_id bigint not null references public.signup_entries(id) on delete cascade,
  question_id bigint not null references public.signup_questions(id) on delete cascade,
  value text not null,
  primary key (signup_entry_id, question_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. CONCURRENCY — capacity/waitlist and slot claims must be atomic
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase JS can't run multi-statement transactions from a Server Action, so
-- the two places where two families can race are RPCs that lock a row FIRST.

-- Headcount = every status='yes', participation='full' entry plus its guests.
-- driver_only and contributor rows never count toward capacity.
create or replace function public.event_signup_headcount(p_event_signup_id bigint)
returns int
language sql
stable
as $$
  select coalesce(sum(1 + guest_count), 0)::int
  from public.signup_entries
  where event_signup_id = p_event_signup_id
    and status = 'yes'
    and participation = 'full';
$$;

-- ADVISORY ONLY — read this before using it.
--
-- Returns 'yes' | 'waitlist' | 'full' for a prospective signup of p_seats.
-- It takes FOR UPDATE on the event_signups row, but that lock is released
-- when the function RETURNS. Supabase-js issues an RPC and a subsequent
-- insert as separate round trips, so a caller that does
--     verdict = rpc(...);  then  insert(...)
-- is NOT atomic: two families can both be told 'yes' and both insert,
-- overbooking capacity. The lock only protects the read.
--
-- Safe uses: rendering "22 of 30 spots taken · waitlist is open" on a page.
-- UNSAFE use: deciding the status you are about to write.
--
-- When the signup form is built (Phase 1 step 4), the write path needs a
-- function that holds one lock across BOTH the decision and the insert —
-- the shape claim_signup_slot() below already uses. Named "verdict" rather
-- than "claim" so nobody wires it up expecting it to reserve anything.
create or replace function public.signup_capacity_verdict(
  p_event_signup_id bigint,
  p_seats int default 1
)
returns text
language plpgsql
as $$
declare
  v_capacity int;
  v_waitlist boolean;
  v_used int;
begin
  select capacity, waitlist_enabled
    into v_capacity, v_waitlist
  from public.event_signups
  where id = p_event_signup_id
  for update;                                    -- serializes racing signups

  if not found then
    raise exception 'event_signup % not found', p_event_signup_id;
  end if;

  if v_capacity is null then
    return 'yes';                                -- uncapped (campouts never turn a scout away)
  end if;

  v_used := public.event_signup_headcount(p_event_signup_id);

  if v_used + p_seats <= v_capacity then
    return 'yes';
  elsif v_waitlist then
    return 'waitlist';
  else
    return 'full';
  end if;
end;
$$;

-- Claim a slot under a row lock on the slot. Enforces eligibility, capacity,
-- and the attendance rule server-side — the UI hides these, but hiding is not
-- enforcing. Returns 'claimed', 'already', or 'full'.
create or replace function public.claim_signup_slot(
  p_slot_id bigint,
  p_signup_entry_id bigint
)
returns text
language plpgsql
as $$
declare
  v_needed int;
  v_elig text;
  v_attend_req boolean;
  v_slot_signup bigint;
  v_filled int;
  v_kind text;
  v_part text;
  v_status text;
  v_entry_signup bigint;
begin
  select needed, eligibility, attendance_required, event_signup_id
    into v_needed, v_elig, v_attend_req, v_slot_signup
  from public.signup_slots
  where id = p_slot_id
  for update;                                    -- serializes racing claims

  if not found then
    raise exception 'signup_slot % not found', p_slot_id;
  end if;

  select person_kind, participation, status, event_signup_id
    into v_kind, v_part, v_status, v_entry_signup
  from public.signup_entries
  where id = p_signup_entry_id;

  if not found then
    raise exception 'signup_entry % not found', p_signup_entry_id;
  end if;

  -- A claim may never cross events.
  if v_entry_signup <> v_slot_signup then
    raise exception 'entry % does not belong to the same event as slot %',
      p_signup_entry_id, p_slot_id;
  end if;

  if v_status = 'cancelled' then
    raise exception 'cannot claim a slot for a cancelled entry';
  end if;

  -- Eligibility: scouts-only / adults-only slots.
  if v_elig <> 'both'
     and v_elig <> (case when v_kind = 'scout' then 'scouts' else 'adults' end) then
    raise exception 'entry % (%) is not eligible for an %-only slot', p_signup_entry_id, v_kind, v_elig;
  end if;

  -- Non-attending participants may only claim donation-style tasks.
  if v_attend_req and v_part in ('driver_only', 'contributor') then
    raise exception 'a % entry may only claim tasks that do not require attendance', v_part;
  end if;

  if exists (select 1 from public.signup_slot_claims
             where slot_id = p_slot_id and signup_entry_id = p_signup_entry_id) then
    return 'already';
  end if;

  -- Coverage counts only live entries, so cancelling releases a spot.
  if v_needed is not null then
    select count(*) into v_filled
    from public.signup_slot_claims c
    join public.signup_entries e on e.id = c.signup_entry_id
    where c.slot_id = p_slot_id and e.status = 'yes';

    if v_filled >= v_needed then
      return 'full';
    end if;
  end if;

  insert into public.signup_slot_claims (slot_id, signup_entry_id)
  values (p_slot_id, p_signup_entry_id);
  return 'claimed';
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════
-- Signup tables: RLS on, NO select policy — anon reads nothing. Service-role
-- loaders bypass RLS; app-level role checks are the real gate.

alter table public.event_signups      enable row level security;
alter table public.event_prices       enable row level security;
alter table public.signup_slots       enable row level security;
alter table public.signup_entries     enable row level security;
alter table public.signup_slot_claims enable row level security;
alter table public.signup_questions   enable row level security;
alter table public.signup_answers     enable row level security;

-- Public event content, same posture as calendar_entries.
alter table public.event_resources enable row level security;
create policy event_resources_read_all on public.event_resources for select using (true);
