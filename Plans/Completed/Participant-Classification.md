# Participant Classification (event sign-ups)

**Status:** Shipped (v1.70.0, 2026-08-21) — move to Completed/ after production eyes-on
**Parked:** 2026-08-21 (activated and built same day)
**Priority:** High

## Overview

Every event sign-up attendee gets a **participant class** — Adult, Scout, Junior Leader (a scout in
high school, a subset of Scouts), Webelos, Cub Scout, Youth Guest, Adult Guest — so campout and
event planning can count and name who is coming by kind. Before this `signup_entries` carried only
`person_kind` (scout | adult) and a nameless "+N guests" count on an adult's entry.

## Problem / Opportunity

Patrick (2026-08-21): "We will need a distinction in the future between adults, scouts, webelos,
cub scouts, and junior leaders (scouts in high school) for many future events. This will be
information needed for campout and event planning." Tents, two-deep/YPT ratios, permission slips,
pricing audiences, and feeder-pack recruiting events all need exact, named counts by class — the
guest count can't give names or youth/adult split.

## Decisions (Patrick, 2026-08-21 — asked and answered)

1. **Where it lives:** on the sign-up ENTRY (`signup_entries.participant_class`), **defaulted from
   the person** when a roster person signs up (adult / scout / junior leader), editable per entry
   by a leader. Non-roster people (Webelos, Cubs, guests) are entries too.
2. **Junior Leader:** **derived from grade 9–12** (graduation_year, June 15 rollover — D-014 +
   2026-08-21 change), **with a per-scout override** stored on the scout's roster record
   (`scouts.junior_leader_override`: auto | yes | no), set in the Roster editor (Demographics).
   Per-event edits on the entry remain possible (roster Edit dialog → Class).
3. **Guests & feeder scouts:** **named entries, each with a class** — replaces the "+N guests"
   count for NEW sign-ups (legacy counts still display/count). `person_id` is nullable for guest
   rows, which carry `guest_name` + `host_entry_id` (the roster entry that brought them).
4. **Who adds guests:** families on the public sign-up form AND leaders in the admin roster.
5. **Pricing:** youth classes (Scout, Junior Leader, Webelos, Cub Scout, Youth Guest) use the
   `scouts` tier audience; Adult and Adult Guest use `adults`. No tier changes now.
6. **Roster table (shipped in the same release):** one line per name; adult/scout indicator
   dropped; participation / guests / answers / notes as columns; per-row Edit for jobs &
   commitments + class.

## Acceptance Criteria

- [x] `signup_entries.participant_class` exists (CHECK-constrained to the 7 codes), NOT NULL, every
      existing row backfilled: adults → adult; scouts → junior_leader when grade 9–12 **as of the
      event date**, else scout. (`20260822100000_participant_class.sql`)
- [x] A BEFORE INSERT trigger derives the class for any inserter that omits it (the public form's
      `submit_household_signup` RPC, tests, future callers) — SQL twin of `defaultClassFor()`,
      proven equal by a db test. (`20260822110000_participant_class_default_trigger.sql`)
- [x] Guest rows: `person_id` nullable; `guest_name` + `host_entry_id` required when `person_id`
      is null; guest rows must carry a guest class; cascade-delete with the host.
- [x] `scouts.junior_leader_override` (null = auto) editable in the admin Roster scout editor.
- [x] Leader "Add a person" sets the class via the trigger (and its insert payload is a tested
      builder — also fixed the `adult_name` schema-cache bug that broke Add entirely).
- [x] Admin roster: Class column (Badge), youth/adult tiles with per-class breakdown, class
      editable in the per-row Edit dialog, "Add a guest" (name + class + brought-by), CSV Type =
      class label, slip checkbox for every youth class.
- [x] Public sign-up forms (person-first + slot-first): "Bringing anyone else?" rows — name +
      class — stored as guest entries under the party's first attending entry (adult preferred);
      the legacy guest-count input is gone. Re-submit REPLACES the party's guest list (prefilled
      from existing rows, so nothing is lost unless the family removes it).
- [x] Pricing eligibility unchanged (person_kind follows the class); named guest rows count in
      the headcount RPC as rows; legacy `guest_count` still adds.
- [x] Tests failing-first: participant-class (14 incl. 2 db), event-signup-guests (4),
      guest-rows dom (3), roster-table dom (7), event-signup-admin (+7).
- [ ] Production eyes-on after deploy (migration pushed first, then code).

## Technical Approach (as built)

- Fixed vocabulary in code + CHECK (`src/lib/participant-class.ts`), mirrored by
  `public.default_participant_class()` in SQL; `tierAudienceFor` / `personKindFor` keep legacy
  readers right. Guests: `normalizeGuestRows()` in `lib/event-signup.ts` sanitizes the form JSON
  (trim, cap 80 chars, 4 guest classes only, dedupe, max 20).
- Admin actions: `setEntryClass`, `addGuestEntry` (inherits the host's household), `unclaimSlotFor`
  (+ `diffClaimEdits` for the jobs editor).

## Open Questions / Follow-ups

- [ ] Permission slips for Webelos/Cub/Youth-Guest rows: checkbox now offered for every youth
      class — confirm that's wanted (assumed yes).
- [ ] Legacy `guest_count` rows are NOT converted to unnamed guest rows (assumed no).
- [ ] Per-class pricing tiers (deferred by decision 5).
- [ ] Public event page headcount copy ("N signed up") now includes named guests; review wording.

## Notes

Related: Plans/Event-Signup.md (original model), D-048 (one entry per person per event), D-066
(person_id NOT NULL — relaxed here for guests only), D-014 (derived grade), roster rework
2026-08-21.
