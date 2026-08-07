# Event Registration System

**Status:** Active — design approved for prototyping
**Created:** 2026-07-14
**Priority:** High

## Overview

A signup system so scouts, parents, adult volunteers, and drivers can register for troop events directly on troop-79.com — campouts, service projects, fundraisers, day outings, merit badge clinics, Courts of Honor, and long-lead trips (summer camp / high adventure). **No fee collection**: the system displays payment amounts and instructions ("$18 food money to the grubmaster by Friday") and lets leaders track offline payment status, but never touches cards or money.

Signups anchor to `calendar_entries` (the real public calendar), the event **category drives which questions appear** (no mega-form), and one parent responds for the **whole family in one pass** — the single biggest complaint about Scoutbook Plus is that it can't do this.

## Problem / Opportunity

Today "registration" is one external-link field (`articles.event_registration_url`) rendered as a "Register on Scoutbook" button. Everything else is email threads, parking-lot conversations, and a spreadsheet the grubmaster rebuilds per campout. There's no headcount, no driver/seat planning, no dietary list, no two-deep visibility, and no record of who committed. The old prototype (`prototypes/news-cms/template-event.html`) explicitly flagged internal-RSVP-vs-external-link as an open question — this plan answers it: **both** (internal signup is the default; the external URL remains for council-run events).

### Research grounding (2026-07 survey)

Patterns adopted from TroopTrack, TroopWebHost, Scoutbook Plus, ScoutManage, TentaRoo, SignUpGenius, and BSA policy docs (Guide to Safe Scouting, AHMR, Activity Consent Form 19-673):

1. **Household-scoped RSVP** — one parent registers the whole family + guests in one session (TroopTrack does this; Scoutbook's per-person-only flow is its most-complained-about gap).
2. **Three RSVP states** — Going / Not Going / **No Response** kept distinct. No "Maybe" (leaders universally hate it; Scoutbook auto-Maybe hides who hasn't answered).
3. **Driver signup on the event** — direction (to/from/both) + seat count per adult (TroopWebHost pattern); credentials stay on the profile, not the form.
4. **Category drives form shape** — campout asks driving + dietary; Court of Honor asks family headcount + potluck dish; meeting asks nothing but yes/no (TroopWebHost event types).
5. **Named slots with capacity** for volunteer shifts (SignUpGenius's core insight — "Saturday breakfast crew (2 needed)" fills; "let us know if you can help" doesn't).
6. **Capacity + auto-waitlist** with leader-controlled promotion (MB clinics, capped outings).
7. **Visible deadline with the reason** — "RSVP by Feb 20 so the grubmaster can shop." After deadline, self-service locks; leaders can still edit (late drops happen).
8. **Leader override** — record/edit any family's response on their behalf (some families will always answer by text).
9. **Flag, don't block** — health-form/YPT/permission-slip gaps show as warnings on the leader roster, never as signup blockers (blocking guarantees leaders bypass the tool).
10. **Two-deep computed, not enforced** — roster banner warns if <2 registered adults 21+, or no female adult 21+ when female youth are going (we have `birthdate` + `gender` on both tables).
11. **Printable roster is a first-class output** — campsite binders have no signal.
12. **Signups feed the ledger** — the RSVP list seeds post-event attendance → `camping_nights` / `service_hours` / `day_outing` / `fundraiser` ledger entries (kinds already exist).
13. **Two-stage commit for long-lead events** — summer camp/high adventure = binding commitment by deadline + displayed payment-milestone schedule with leader-ticked "paid" checkboxes.

Anti-patterns deliberately avoided: per-person-only RSVP, Maybe-as-default, one giant form, login-per-task friction, RSVP data that doesn't flow to grubmaster/driver/attendance outputs, no waitlist on capped events.

## Acceptance Criteria

- [ ] A parent can open an event page from the calendar and, in one pass, mark each family member Going/Not Going, add sibling/guest headcount where the event allows it, and submit — in under a minute on a phone.
- [ ] A family can return and edit their response any time before the deadline.
- [ ] Campout signups capture per-adult driver offers (direction + seats) and per-person dietary notes; Court of Honor signups capture family headcount; fundraiser signups claim shift slots with hard capacity; plain meetings show no extra questions.
- [ ] Events display fee amount and offline payment instructions; nothing in the system collects payment.
- [ ] Capped events auto-waitlist beyond capacity; a leader can promote from the waitlist.
- [ ] Leaders see a live roster: headcount grouped scout/adult/guest and by patrol, dietary list, driver/seat matrix vs. riders needing seats, non-responders list, and a two-deep/female-leader warning banner — and can print it.
- [ ] Leaders can enter or edit any response on a family's behalf.
- [ ] Anonymous visitors see event details and going-counts but no attendee names; signing up requires the family password.
- [ ] All new server loaders/actions use `createAdminClient()` + `requireRole()` per D-005; no anon-key reads of signup data.

## Test Plan

No automated suite exists yet (`npm run lint` + `next build` are the gate). When tests land, the acceptance stubs are:

- [ ] `Parent_CanRegisterWholeFamily_InOneSubmission()`
- [ ] `Parent_CanEditResponse_BeforeDeadline()`
- [ ] `Parent_CannotEditResponse_AfterDeadline()`
- [ ] `Visitor_SeesCountsOnly_WhenNotLoggedIn()`
- [ ] `Signup_BecomesWaitlisted_WhenCapacityReached()`
- [ ] `Leader_CanPromoteFromWaitlist_WhenSpotOpens()`
- [ ] `Roster_ShowsTwoDeepWarning_WhenFewerThanTwoAdults21Plus()`
- [ ] `Roster_ShowsFemaleLeaderWarning_WhenFemaleYouthGoingWithoutFemaleAdult21Plus()`
- [ ] `CampoutForm_ShowsDriverAndDietaryFields_WhenCategoryIsCampout()`
- [ ] `CoHForm_ShowsGuestHeadcount_WhenCategoryIsCourtOfHonor()`
- [ ] `SlotClaim_IsRejected_WhenShiftIsFull()`
- [ ] `LeaderOverride_CanRecordResponse_OnBehalfOfFamily()`

## Technical Approach

### Anchor: `calendar_entries`, not `articles`, not the `events` lookup

Signups attach to `calendar_entries` rows — the structured public calendar. Event-type articles keep their optional `event_registration_url` for external (council/camp) registration; a calendar entry links to its article for the write-up. The Fast Entry `events` lookup stays advancement-only (the migrations already warn about conflating these three).

### Signup configuration: columns on `calendar_entries`, defaults from category

Per D-002's spirit (category is already the classifier — don't add a lookup layer), a **code-level map** `CATEGORY_SIGNUP_DEFAULTS` in `lib/signup-shared.ts` defines per-category behavior; nullable per-event columns override it:

```sql
ALTER TABLE calendar_entries ADD COLUMN
  signup_mode text NOT NULL DEFAULT 'none'
    CHECK (signup_mode IN ('none','internal','external')),
  signup_url text,              -- external mode only
  signup_deadline date,         -- self-service lock; leaders can still edit
  signup_deadline_reason text,  -- "so the grubmaster can shop"
  capacity integer,             -- NULL = uncapped; beyond it → waitlist
  fee_amount numeric,           -- display only
  payment_instructions text,    -- display only ("cash/check to Mr. K by 3/1")
  ask_drivers boolean,          -- NULL = category default
  ask_dietary boolean,          -- NULL = category default
  allow_guests boolean;         -- NULL = category default (CoH: true)
```

Category defaults: **Campout/High Adventure/Summer Camp** → drivers ✓ dietary ✓ guests ✗ · **Outing/Service Project** → drivers ✓ dietary ✗ guests ✗ · **Court of Honor/Ceremony** → drivers ✗ dietary ✗ guests ✓ · **Fundraiser** → slots-driven · **Troop Meeting/Committee/No Meeting** → signup off.

### Signup data: two tables (a household response + its people)

```sql
CREATE TABLE event_signup_groups (           -- one per family per event
  id bigserial PRIMARY KEY,
  calendar_entry_id bigint NOT NULL REFERENCES calendar_entries(id) ON DELETE CASCADE,
  family_label text NOT NULL,                -- "Bieser family"
  contact_name text NOT NULL,                -- who submitted
  contact_phone text, contact_email text,
  note_to_organizer text,
  entered_by text,                           -- leader initials when entered on behalf
  created_at timestamptz DEFAULT now(), updated_at timestamptz
);

CREATE TABLE event_signup_people (           -- one row per attendee answer
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES event_signup_groups(id) ON DELETE CASCADE,
  person_type text NOT NULL CHECK (person_type IN ('scout','adult','guest')),
  scout_id text REFERENCES scouts(id),       -- person_type='scout'
  leader_code text REFERENCES leaders(code), -- registered adults with initials
  name text NOT NULL,                        -- denormalized display name; guests free-text
  guest_count integer,                       -- guest rows may carry >1 ("2 grandparents")
  rsvp text NOT NULL CHECK (rsvp IN ('going','not_going','waitlisted')),
  dietary text,
  logistics_note text,                       -- "arriving Sat morning"
  is_driver boolean DEFAULT false,
  driver_direction text CHECK (driver_direction IN ('to','from','both')),
  driver_seats integer,
  slot_id bigint,                            -- Phase 2: FK event_slots
  paid_at date, paid_note text,              -- leader-ticked offline payment tracking
  UNIQUE (group_id, scout_id), UNIQUE (group_id, leader_code)
);
```

"No response" = no row, which keeps the three RSVP states honest for free. The leader roster derives non-responders as *active scouts minus scouts with any row*.

Phase 2 adds `event_slots` (id, calendar_entry_id, title, description, starts/ends, capacity, role CHECK ('scout','adult','any')) for fundraiser shifts and volunteer jobs; a claim is just a person row with `slot_id` set — no fourth table.

RLS mirrors D-005: no anon policies on either table; all reads/writes go through service-role loaders and `requireRole()` server actions. Public event pages show **counts only** to anonymous visitors.

### Identity: extend the shared-password pattern (D-018), not per-user auth

Phase 4 per-user auth stays deferred. Add a third shared password — `FAMILY_PASSWORD` → role `'family'` in the existing cookie/role machinery (`leader-session.ts`, `require-role.ts`). The signup flow then identifies the household the same way leader login identifies adults (D-018 precedent):

1. Parent hits **Sign up** on an event page → if no session, a one-field password prompt (30-day cookie — one login per school year in practice).
2. **Pick your scout(s)** from the active roster (multi-select, searchable). The form then shows one row per selected scout, plus that scout's parents/guardians (from `scout_parents`) as pre-named adult rows, plus "add another adult/guest."
3. The chosen scout set defines the household — **no `families` table** (simplify, don't layer). A localStorage hint pre-selects the same scouts next time on that device.
4. Editing: the family re-opens the event and sees their group's response (matched by their scout selection); leaders can edit any group.

Roles that can write signups: `family`, `scout` (a scout can RSVP themself), `leader` (anyone, on-behalf-of with `entered_by` stamped).

### Public event detail page (new)

`/events/[id]` — currently no event detail page exists. NYT-editorial layout matching the news event template: date block + When/Where panel above the fold, description, fee + payment instructions, signup panel (or "Register on Scoutbook" external button, or "No registration required"), going-count, and — for logged-in members — the who's-going list (first name + last initial). Calendar rows link here instead of dead-ending.

### Leader roster view (new, admin)

`/admin/events/[id]/roster` — headcount tiles (scouts/adults/guests, by patrol), dietary rollup, driver matrix (seats offered vs. riders, to/from), waitlist with promote buttons, non-responder list, readiness flags (health-form date stale, adult YPT expired — data already on file), two-deep banner, per-person paid checkboxes, print stylesheet. Roll-call reuse: after the event, one click seeds the attendance/ledger conversion (Phase 3).

### What stays out

- **No payment processing** — display + offline tracking only (requirement).
- **No email yet** — no mail infra exists. Phase 1 ships without notifications (deep links shared via the Bugle/announcements as today); Phase 2 evaluates Resend for confirmations + deadline reminders to non-responders.
- **No Maybe state, no per-rank gating, no compliance blocking.**

## Implementation Steps

**Phase 1 — Core signups (MVP)**
1. Migration: `calendar_entries` signup columns + `event_signup_groups` + `event_signup_people` (+ RLS lockdown).
2. `lib/signup-shared.ts` — category defaults map, deadline logic, count helpers.
3. `FAMILY_PASSWORD` role in login/session/require-role.
4. Public `/events/[id]` detail page + signup flow (family pass: pick scouts → per-person RSVP → drivers/dietary per category → confirm; edit-until-deadline).
5. Calendar browser: link rows to detail pages; "Signup open" badge + going-count.
6. Admin: signup settings on the calendar editor (mode, deadline+reason, capacity, fee, overrides).
7. Admin roster view with print stylesheet, two-deep/readiness warnings, waitlist promote, on-behalf-of entry, paid checkboxes.

**Phase 2 — Slots, slips, notifications**
8. `event_slots` + shift claiming UI (fundraisers, volunteer jobs, potluck dishes).
9. Electronic permission slip (BSA 19-673 content): consent checkbox + typed-name signature per scout per event, status on roster, printable.
10. Email (Resend): signup confirmation with edit deep-link; deadline reminder to non-responders; logistics reminder to Going.

**Phase 3 — Advancement integration + long-lead events**
11. Roster → attendance conversion: post-event, seed `camping_nights` / `service_hours` / `hiking_miles` / `day_outing` / `fundraiser` ledger rows from the Going list (leader confirms per person, same replace-on-save spirit as Roll Call).
12. Summer camp / high adventure: commitment stage + payment-milestone schedule (display + leader-ticked paid status per milestone), MB class-choice capture with per-session caps.
13. Merit badge clinic session capacity (per-badge sub-capacity via slots).

## Open Questions

- [ ] **Family password vs. reusing SCOUT_PASSWORD** — a third password is cleaner (scout role has drafting rights family shouldn't inherit) but is one more thing to distribute. Recommend: separate `FAMILY_PASSWORD`, announced once in the Bugle.
- [ ] **Who's-going visibility** — recommend counts-only for anonymous, names (first + last initial) for any logged-in role, full detail for leaders. Confirm comfort level.
- [ ] **Guest rows at Courts of Honor** — free-text name + count per row vs. a single "how many total guests" number per family. Prototype shows per-row; a single number may be simpler.
- [ ] **Should Fast Entry's `events` lookup link to `calendar_entries`** for Phase-3 attendance conversion, or match by name/date at conversion time? (Leaning: match at conversion time; no new FK.)
- [ ] **Article ↔ calendar duplication** — event articles carry `event_start/event_location` independently of their calendar entry. Converge on calendar entry as the source when both exist?

## Notes

- Decisions honored: D-001 (ledger stays the single history store — signups are *intent*, ledger is *fact*; conversion is explicit), D-002 (category carries classification; defaults live in code, not a lookup table), D-005 (service-role loaders, anon lockdown), D-011 (sessions-as-rows was built as groundwork for signups — MB clinic sessions and meeting teaching signups can converge on slots later), D-018 (name-pick + shared password identity pattern extended to families).
- `meeting_attendance_leaders.status='committed'` was reserved for meeting teaching signups — that flow stays separate (meeting-plan Phase 3) but should adopt the same visual language.
- Prototypes: `prototypes/event-registration/` — public signup flow (campout, Court of Honor, fundraiser shift variants), and the leader roster view. Shared CSS copies the global palette per prototype convention.
- Research sources: TroopTrack, TroopWebHost help/enhancement docs, Scoutbook Plus + discussions.scouting.org pain-point threads, ScoutManage, TentaRoo, SignUpGenius, BSA GSS (two-deep, SAFE transportation), AHMR A/B/C, Activity Consent Form 19-673, Philmont fee/substitution policies.
