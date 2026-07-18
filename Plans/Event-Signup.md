# Event Signup & RSVP

**Status:** Active
**Created:** 2026-07-14 (v3 same day — composable blocks, pricing tiers)
**Priority:** High

## Overview

A signup system on www.troop-79.com for families (scouts + parents), leaders, adult volunteers, and drivers, attached to the existing public calendar (`calendar_entries`). No online payment collection: events display cost and payment instructions; leaders check off payment received.

**Core design principle (Patrick, 2026-07-14): composable blocks, not per-event-type templates.** The troop runs many event shapes — campouts, fundraisers (Pancake Breakfast, rummage sale), ski outings, merit badge clinics, summer camp — and more will appear. There is no template per type. Instead, every event composes the same small set of independent blocks:

| Block | What it adds | Example use |
|---|---|---|
| **Content** | markdown details + resources/attachments | packing list, directions, trail map |
| **Attendance** | who's coming (Yes / Can't make it) per household | every event |
| **Pricing** | labeled price tiers (per-event or per-day) + payment instructions | $30 flat; adult skiing $45 vs. chaperone $0; summer camp adult $40/day |
| **Capacity + waitlist** | headcount cap, optional waitlist | MB clinics; never campouts |
| **Drivers** | "I can drive, N seats besides me" | outings, campouts |
| **Shifts & tasks** | time-slotted shifts and claimable tasks, per-slot eligibility + capacity | Pancake Breakfast shifts; rummage sale sorting/pricing/cashier tasks |
| **Questions** | per-participant custom fields (text / number / choice) | ski: height, weight, shoe size, ski/snowboard/XC |
| **Compliance flags** | permission slip required, AHMR-C banner, guests allowed | campouts vs. family-friendly events |

`calendar_entries.category` seeds a **preset** — default toggles only, fully editable per event. New event shapes need zero new code, just a different block combination.

### Preset matrix (Patrick's 13 event types, 2026-07-14)

Defaults when a leader enables signup on an event of each type. ✓ = block on, — = off, every cell editable. "Audience" scopes who the attendance block offers (scouts / adults / both).

| Event type | Attend | Pricing | Cap+WL | Drivers | Shifts/Tasks | Questions | Slip | AHMR-C | Guests | Audience |
|---|---|---|---|---|---|---|---|---|---|---|
| Troop Meeting | *signup off by default* — Roll Call already captures attendance after the fact | | | | | | | | | |
| Campout / Overnight | ✓ | ✓ | — | ✓ | — | — | ✓ | — | — | both |
| Day Activity / Outing | ✓ | ✓ | — | ✓ | — | — | ✓ | — | — | both |
| High Adventure | ✓ | ✓ | ✓ +WL (crew-size limits) | ✓ | — | ✓ (gear/shirt/dietary) | ✓ | ✓ | — | both |
| Summer Camp | ✓ | ✓ (scout flat, adult per-day) | — | ✓ | — | ✓ | ✓ | ✓ | — | both |
| Service Project | ✓ | — | — | ✓ | ✓ | — | ✓ | — | ✓ | both |
| Fundraiser | ✓ | — | — | — | ✓ | — | — | — | ✓ | both |
| Advancement Event (MB clinic) | ✓ | — (materials fee when needed) | ✓ +WL | ✓ | — | ✓ (badge/session choice) | — | — | — | scouts |
| Training | ✓ | — | — | — | — | — | — | — | — | per event (often adults- or scouts-only) |
| Ceremony / Recognition | ✓ | — | — | — | — (toggle on for CoH dessert/setup) | — | — | — | ✓ (families/guests counted) | both |
| Leadership / Planning | *signup off by default* — PLC/committee rarely needs one; when on: attendance only, scoped audience | | | | | | | | | |
| Recruiting / Outreach | ✓ | — | — | — | ✓ (greeters, demo stations) | — | — | — | ✓ (Webelos/visitor counts) | both |
| Social Event | ✓ | — (add tier when needed) | — | — | ✓ (potluck items) | — | — | — | ✓ | both |

(The existing "No Meeting" calendar category is calendar-only — signup never applies.) Potluck items, greeter stations, rummage-sale crews, and grubmaster lists are all the same `signup_slots` mechanism — the matrix needs no per-type code.

## Problem / Opportunity

Today headcounts are chased by email/GroupMe. Research across scouting platforms (TroopTrack, TroopWebHost, Scoutbook, SOAR, TroopMaster) and commercial tools (SignUpGenius, Evite, Eventbrite) shows two gaps **no scouting platform fills well** — both recurring troop pain points:

1. **Driver coordination as a first-class signup** (seats offered vs. seats needed) — every platform punts to spreadsheets.
2. **Waitlists with auto-promotion** — only SignUpGenius (paid tier) does this.

Other validated pain points this solves: grubmaster food-buying counts (per-patrol rollups), permission-slip chasing (slip status per attendee, separate from RSVP), soft deadlines causing last-minute scrambles (hard gate: "no slip + no money = no trip"), login walls killing response rates, and fundraiser shift staffing living in disconnected SignUpGenius sheets.

### BSA program rules the model must respect

- **Two-deep leadership:** ≥2 registered adults per outing; adult-count indicator on the roster.
- **Drivers:** adults with seat counts ("seats besides you"); insurance/licensing stays offline; seats offered vs. riders needed must be visible.
- **Permission slips (Activity Consent):** per-event, per-scout; status tracked separately from RSVP.
- **Health forms:** AHMR A/B assumed annual; events ≥72 hrs flag "Part C required" as an informational banner.
- **No generic guests on overnights:** non-registered siblings/adults generally may not attend campouts. Guests (including Webelos/Cub Scout visitors at recruiting events) allowed only when the event enables them.
- **Patrol rollups:** headcounts subtotal by patrol (grubmaster budgeting), reusing Roll Call's patrol grouping.

### Decisions made (2026-07-14, Patrick)

- **Composable blocks, not per-type templates** (above) — the defining v3 decision.
- **Pricing tiers per event, not one cost:** costs differ by participant class (scouts, Webelos/Cubs, adults), some events price everyone the same, some discount adults, some charge adults **per day** (summer camp: adult 2 days = $80), and non-participating adults (driver/chaperone only) may have their own price point, often $0. Modeled as labeled tiers; each attendee picks one.
- **Waitlist is optional per event** — useful for MB clinics; campouts never turn a scout away (they set no capacity). Toggle, default off.
- **Shifts/tasks always show numbers** — "3 of 6 filled — 3 more needed", and full shows "Full (6/6)", never a bare "Full".
- **Driver seats = "besides you"** — confirmed.
- **Driver-only adults (2026-07-14, Patrick):** some adults only provide transportation — drive up, return home, optionally come back Sunday to drive kids home. They are not attendees: never charged (no tier), excluded from headcount/capacity and the two-deep count, but fully visible in the driver plan. Driving is therefore **per-leg**: an adult (attending or driver-only) can offer seats on the outbound leg, the return leg, or both.
- **Default signup deadline: 5 days before event start** (configurable).
- **No "Maybe"** — Yes / No / silence; silence is what the non-responder chase list is for.
- **Scouts may sign themselves up** through the same gate + household picker.
- **Item donations are IN scope; money donations are not (revised 2026-07-14):** donating pancake mix or orange juice is part of event signup — a household member can claim a donation-style task **without attending** (participation `contributor`, mirroring `driver_only`: owes nothing, counts toward nothing, holds task claims). Money donations remain separate — a future Donate button/landing page, unrelated to signup.

## Acceptance Criteria

- [ ] A leader can enable signup on any calendar entry and compose it from blocks: deadline (default start − 5 days), attendance, pricing tiers, capacity (+ optional waitlist), drivers, shifts/tasks, questions, compliance flags, guests. Category presets pre-toggle blocks; everything remains editable.
- [ ] A leader can define pricing tiers: label, amount, per-event or per-day, and which participant kinds may pick them. The event page shows the tier table and payment instructions prominently; no payment data is ever collected.
- [ ] A leader can author event content: markdown details + resources list (files via the existing Bunny pipeline).
- [ ] A leader can define shifts (label, time range, eligibility scouts/adults/both, needed count) and tasks (same, untimed) — with coverage always shown as filled/needed numbers.
- [ ] A leader can define per-participant questions (short text / number / single choice; applies to scouts/adults/both; required or not).
- [ ] A family can pass the shared troop password gate once (cookie), pick their household, and in one submission: RSVP scouts and adults, pick each person's price tier (and days, when per-day), claim shifts/tasks per person, answer questions per person, and offer driver seats per leg (outbound / return / both).
- [ ] An adult can sign up as **driver only** — not attending, never charged, excluded from headcount and two-deep, listed in the driver plan for the legs they drive.
- [ ] A household member can claim a **donation-style task** (e.g., "donate 10 lb pancake mix") **without attending** — a contributor: owes nothing, counts toward nothing, appears on the task coverage list. Shifts and work tasks still require attendance.
- [ ] A family sees their computed amount owed (tiers × people × days) with payment instructions — and can return to view, edit, or cancel until the deadline; after it, the form locks.
- [ ] "Can't make it" is recorded as an explicit *No*, distinct from not responding.
- [ ] Capacity reached: waitlist-enabled events queue new signups visibly; otherwise "Full — contact the Scoutmaster." Individual shifts close at their needed count (showing "Full (6/6)").
- [ ] Leader roster view: totals, per-patrol subtotals, two-deep indicator, driver seat math, shift coverage grid (filled/needed), question answers, amount owed vs. payment received per household, non-responders, waitlist, per-attendee slip/payment checkboxes, print + CSV.
- [ ] Public (un-gated) pages never expose scout or family names; event content is public, signup data is gated.
- [ ] `npm run lint` and `next build` pass.

## Test Plan

No automated suite exists yet (project constraint); acceptance stubs to write when the suite lands, verified manually until then:

- [ ] `Family_CanSignUpScoutsAndAdults_WhenSignupOpen()`
- [ ] `Family_CanEditOrCancel_WhenBeforeDeadline()`
- [ ] `Family_CannotModify_WhenDeadlinePassed()`
- [ ] `Family_OwedAmountComputesFromTiersAndDays_WhenPricingEnabled()`
- [ ] `Family_LandsOnWaitlist_WhenCapacityReachedAndWaitlistEnabled()`
- [ ] `Family_SeesEventFull_WhenCapacityReachedAndWaitlistDisabled()`
- [ ] `Family_CanClaimShift_WhenEligibleAndShiftOpen()`
- [ ] `Scout_CannotClaimAdultOnlyShift_WhenSigningUp()`
- [ ] `Family_MustAnswerRequiredQuestions_WhenEventDefinesThem()`
- [ ] `Attendee_MustPickEligibleTier_WhenPricingEnabled()`
- [ ] `CancelledEntry_ReleasesSlotCapacity_WhenStatusLeavesYes()`
- [ ] `Anonymous_CannotReadRosterNames_WhenNotGateAuthenticated()`
- [ ] `Anonymous_CanReadEventContent_WhenPagePublic()`
- [ ] `Leader_SeesPatrolSubtotalsAndPerLegDriverSeatMath_WhenViewingRoster()`
- [ ] `DriverOnlyAdult_ExcludedFromHeadcountTwoDeepAndOwed_WhenSignedUp()`
- [ ] `Contributor_CanClaimDonationTask_WithoutAttending()`
- [ ] `Contributor_CannotClaimShiftOrAttendanceRequiredTask_WhenNotAttending()`
- [ ] `Leader_SeesShiftCoverageNumbers_WhenViewingRoster()`
- [ ] `Leader_CanTogglePermissionSlipAndPayment_WhenManagingRoster()`
- [ ] `NonResponderList_ShowsActiveScoutsWithoutEntries_WhenRosterViewed()`

## Technical Approach

### Data model (hangs off `calendar_entries`)

```
-- event page content (on the calendar entry itself — public)
calendar_entries + details_md text null            -- markdown, same renderer as News CMS

event_resources          -- attachments/links shown on the event page (public)
  id, calendar_entry_id FK, label, url, sort
  -- files (packing list PDF, permission slip) upload via the existing Bunny CDN
  -- pipeline and are stored as URLs; maps/directions are plain links

event_signups            -- 1:0..1 with calendar_entries; presence = signup enabled
  id, calendar_entry_id (unique FK), status (open|closed),
  deadline timestamptz,                            -- default event start − 5 days
  capacity int null, waitlist_enabled bool default false,
  audience (scouts|adults|both) default 'both',    -- who the attendance block offers
                                                   -- (adult training, PLC, MB clinics)
  payment_instructions text null,
  needs_permission_slip bool, needs_ahmr_c bool,
  allow_guests bool, drivers_needed bool,
  notes_prompt text null, created_at, updated_at

event_prices             -- pricing tiers (the Pricing block); zero rows = free event
  id, event_signup_id FK,
  label,                                           -- "Scout", "Webelos guest", "Adult — skiing",
                                                   -- "Adult — chaperone/driver", "Adult (per day)"
                                                   -- UNIQUE (event_signup_id, label)
  amount numeric(10,2) CHECK (amount >= 0),
  per (event|day),                                 -- per-day: attendee also records days
  applies_to (scouts|adults|both),
  sort

signup_entries           -- one row per attending person (or explicit decline)
  id, event_signup_id FK,
  person_kind (scout|adult),
  scout_id text null FK scouts,
  scout_parent_id bigint null FK scout_parents,
  leader_code text null FK leaders,
  adult_name text null,                            -- fallback for other registered adults
  status (yes|no|waitlist|cancelled),
  price_id bigint null FK event_prices ON DELETE RESTRICT,  -- chosen tier; builder blocks
                                                   -- deleting a tier households already picked
                                                   -- (or forces re-selection), never orphans owed math
  days int null,                                   -- required iff tier is per-day
  participation (full|driver_only|contributor) default 'full',
                                                     -- driver_only: adults providing transportation
                                                     -- without attending; contributor: donates items /
                                                     -- claims non-attendance tasks without attending
  drives_out bool default false,                     -- offers seats on the outbound leg
  drives_back bool default false,                    -- offers seats on the return leg
  seats_offered_out int null,                        -- seats besides driver, outbound
  seats_offered_back int null,                       -- seats besides driver, return
                                                     -- (may differ: different vehicle/riders per leg)
  volunteer_note text null,
  guest_count int default 0,                       -- only when allow_guests
  notes text null,
  permission_slip_received bool default false,     -- leader-managed
  payment_received bool default false,             -- leader-managed
  household_scout_id text null FK scouts,
  entered_by text null, updated_by text null,      -- audit trail (D-018/D-019/D-023)
  created_at, updated_at, cancelled_at

signup_slots             -- shifts AND tasks: one mechanism (a task is a shift without times)
  id, event_signup_id FK, kind (shift|task),
  label, starts_at time null, ends_at time null,   -- shifts only
  attendance_required bool default true,           -- false = donation-style task, claimable
                                                   -- by contributor entries (CHECK: shifts always true)
  eligibility (scouts|adults|both),
  needed int null,                                 -- null = unlimited; UI shows filled/needed
  sort

signup_slot_claims
  slot_id FK, signup_entry_id FK, UNIQUE (slot_id, signup_entry_id)

signup_questions         -- per-event custom fields, asked per attendee
  id, event_signup_id FK, prompt,
  input_type (text|number|choice),
  choices text[] null,
  applies_to (scouts|adults|both), required bool, sort

signup_answers
  signup_entry_id FK, question_id FK, value text,
  UNIQUE (signup_entry_id, question_id)
```

Amount owed is **derived, never stored**: Σ over a household's yes-entries of `tier.amount × (per = 'day' ? days : 1)`. Leaders see owed vs. `payment_received` on the roster.

**Integrity constraints (tech-lead required, v1 + v2 + v3):**
- CHECK: exactly one identity column populated (`scout_id`/`scout_parent_id`/`leader_code`/`adult_name`) and consistent with `person_kind`.
- Partial unique indexes — `UNIQUE (event_signup_id, scout_id) WHERE status <> 'cancelled'` and adult-identity equivalents — real upsert keys; duplicates impossible by construction (the D-023 failure mode).
- **Capacity semantics:** capacity counts total headcount — every `status='yes'` row with `participation='full'` plus its `guest_count`. Driver-only and contributor rows never count toward capacity, two-deep, or owed amounts (`price_id` stays null for both).
- CHECK on `signup_entries`: `participation='contributor'` implies `price_id IS NULL` and `status <> 'waitlist'`; action-enforced: contributor entries may claim only `attendance_required=false` slots and must hold ≥1 claim (a contributor with no claims is meaningless).
- CHECK on `signup_slots`: `kind='shift'` implies `attendance_required=true`.
- CHECK on `signup_entries`: `participation='driver_only'` only for `person_kind='adult'`, and implies `drives_out OR drives_back`, `price_id IS NULL`, and `status <> 'waitlist'` (driver-only is excluded from capacity, so waitlist is meaningless for it).
- CHECK on `signup_entries` seats: each `seats_offered_*` is `> 0` and NOT NULL exactly when its `drives_*` flag is true, null otherwise.
- **Tier-match enforcement on every write path:** the applies_to-vs-person_kind and same-event checks on `price_id` run in *every* Server Action that writes it — initial signup, family edit, and any future admin override — not only the capacity RPC. No shortcut path may bypass it.
- **Capacity/waitlist assignment is a Postgres RPC** (`SELECT ... FOR UPDATE` on the `event_signups` row) assigning `yes` vs. `waitlist` (or rejecting as full when waitlist disabled) atomically. **Shift claims use the same pattern** on the slot row. Supabase JS has no multi-statement transactions from Server Actions.
- **Cancelled entries release slots:** slot counts, coverage displays, and the claim RPC filter claims to entries with `status='yes'`. Claims/answers for non-yes entries are hidden, not deleted (idempotent across waitlist→yes).
- CHECK on `signup_slots`: shifts have both times, tasks have neither.
- CHECK on `event_signups`: `waitlist_enabled = false OR capacity IS NOT NULL`.
- CHECK on `signup_entries`: `days IS NOT NULL` iff the chosen tier is per-day; `price_id` tier must belong to the same `event_signup_id` (enforced in the RPC/action) and match `applies_to` vs. `person_kind`.
- Slot eligibility and answer validation server-side (required present, choice ∈ choices, number parses), not just hidden in UI.
- Migration comment: claims/answers deliberately have no status-cascade; entries are soft-status by design — a future hard-delete script must clean claims/answers explicitly.

No new lookup tables, no event-type layering (per the `event_types` removal decision) — `calendar_entries.category` only seeds preset toggles.

### Identity: shared-password gate + household picker (Phase 1)

There is no per-family auth yet. Mint a **separate `FAMILY_PASSWORD` env var and `family` role** (same signed-cookie mechanism as `admin/login`; distinct from `SCOUT_PASSWORD` so each rotates independently). Enter the shared password once, then pick your scout(s); household adults auto-populate from `scout_parents`, leaders from `leaders`. No-login friction stays low (the #1 response-rate factor); nothing name-bearing renders without the cookie (anon-PII lockdown).

**Accepted risk (explicit):** the shared password doesn't bind a session to a household — any family-password holder could edit another household's signup. Accepted consciously for a ~25-family trusted troop; mitigated by `entered_by`/`updated_by` audit columns; closed properly by per-family magic links in Phase 4.

### Surfaces

- **Public:** `/events` rows get a "Signup open" badge; **one generic event detail page** `/events/[id]` renders whichever blocks the event enables — content (public) + signup module (gated). Server components via `createAdminClient()`.
- **Family form:** client component + Server Actions with the `family` role; RSVP, tier picks, shift claims, and answers submitted per household in one flow; hard deadline enforced server-side.
- **Admin — the event builder:** `/admin/events/signups` — per-event config is a **block checklist** (preset from category, then toggle freely), with sub-editors for pricing tiers, shifts/tasks, and questions; roster view with checklists, coverage, answers, owed-vs-paid, and export. House pattern: `'use server'` → `requireRole(['leader'])` → `createAdminClient()` → `revalidatePath()`.

### Email

None exists in the app. Phases 1–2 ship without email (on-screen confirmation; non-responder list powers manual chasing). Phase 3 adds Resend: confirmations, deadline reminders, missing-slip nags.

## Implementation Steps

**Phase 1 — Core: attendance + content + pricing**
1. Migration: `event_signups`, `event_prices`, `signup_entries`, `calendar_entries.details_md`, `event_resources`, all CHECKs + partial unique indexes, capacity RPC, RLS (anon: no read on signup tables; content public; service-role loaders only). Same migration: reconcile `calendar_entries.category` with the 13-type taxonomy — add Advancement Event, Training, Recruiting / Outreach, Social Event; map Court of Honor → Ceremony / Recognition and Committee Meeting → Leadership / Planning (pending Patrick's confirmation); update the calendar CSV import's category list and the public calendar filter to match.
2. Family gate: `FAMILY_PASSWORD`, `family` role, `t79_family_session` cookie, gate component.
3. Generic event detail page `/events/[id]`: content blocks, signup module states (open / closed / full / full→waitlist / deadline passed), tier table + owed math + payment instructions, AHMR-C banner.
4. Household signup form + Server Actions (create/edit/cancel, tier + days selection, capacity/waitlist/deadline enforcement, explicit No).
5. Admin: event builder (block checklist + presets + pricing editor + content/resources) and roster view (totals, patrol subtotals, two-deep, driver seats, owed vs. paid, non-responders, slip/payment checkboxes, print + CSV).
6. Lint + build; manual acceptance walkthrough on dev; deploy.

**Phase 2 — Shifts, tasks, questions** (fundraisers, ski outing, MB clinics)
7. Migration: `signup_slots` + `signup_slot_claims` (claim RPC, eligibility enforcement), `signup_questions` + `signup_answers`.
8. Family flow: shift/task claiming with filled/needed counts, per-attendee question forms.
9. Admin: shift & question sub-editors in the builder; coverage grid + answer columns/export in the roster.

**Phase 3** — Resend email (confirmations, reminders, slip nags), waitlist auto-promotion, signup badge in iCal feed.
**Phase 4** — per-family magic-link identity on per-user Supabase Auth; SMS reminders if wanted.

## Open Questions

- [ ] Should per-participant questions be scopeable to price tiers, not just scouts/adults (ski gear questions skip the $0 chaperone tier)? Option: nullable `signup_questions.tier_ids`.
- [ ] May a driver-only adult also claim donation tasks (drive up AND donate the OJ)? Simplest rule: any non-attending entry (driver_only or contributor) may claim `attendance_required=false` tasks.
- [ ] Guests: per-household count (prototype) vs. per-entry `guest_count` (schema) — pick one before Phase 1.

- [ ] Should question answers be summarized publicly in aggregate (e.g., "12 skiers / 5 snowboarders"), or family-visible + admin roster only? (Plan: the latter.)
- [ ] Preset matrix defaults (see Overview) — proposed from the 13-type list; confirm the cells with Patrick before the builder ships.
- [ ] Category renames: keep existing labels "Court of Honor" / "Committee Meeting" / "Outing" on the public calendar, or adopt the broader names (Ceremony / Recognition, Leadership / Planning, Day Activity / Outing)? Renames touch existing rows, the CSV import list, and the public filter.

## Notes

- Research sources: TroopTrack, TroopWebHost, Scoutbook, SOAR, TroopMaster; SignUpGenius/Eventbrite UX; Guide to Safe Scouting (transportation, camping), YP FAQs, AHMR FAQ; grubmaster guides, no-show discussions. Driver signup + waitlist are the two competitive gaps.
- Anchors: single-source event classification (no type layers), `createAdminClient()` loaders, anon-key PII lockdown, Bunny CDN uploads, News CMS markdown renderer reused for `details_md`. Replace-on-save is **not** used (entries need stable identity for slip/payment checkboxes — edit in place).
- **Donations:** explicitly out of scope; future Donate button → separate landing page, unrelated to signup.
- Tech-lead reviews 2026-07-14: v1, v2, and v3 deltas all approve-with-changes; every required change folded in (v3: per-leg seat columns, price_id ON DELETE RESTRICT, amount/seat value CHECKs, tier-match on every write path, driver-only never waitlisted). No memory conflicts across all three reviews. When built, record the edit-in-place divergence from replace-on-save as a DECISIONS.md entry.
- Prototypes: `prototypes/event-signup/` — v1/v2 pages (index, admin-roster, fundraiser-shifts, ski-outing) validated the individual flows; v3 adds the **composable** pair: one generic event page driven by a block config (demoed across campout / pancake breakfast / ski outing / rummage sale / summer camp), and an admin event-builder showing presets + block toggles + tier/shift/question editors.

## Phase 1 Kickoff — Grounding & Pending Decisions (2026-07-18)

Context grounded against **prod** (`qyovupepjdxikyepieps`) before starting Phase 1:

- **No signup schema exists** — none of `event_signups / event_prices / signup_entries / signup_slots / signup_questions / event_resources` are present. (The `events` table in the DB is the unrelated ledger lookup, not this feature.) Clean slate.
- **`calendar_entries.details_md` does not exist yet** — Phase 1 migration adds it. Current `calendar_entries` columns: id, entry_date, end_date, day_note, category, title, description, location, article_id, start_time, end_time, created_at, updated_at.
- **Categories currently in use (10, with counts):** Troop Meeting (17), Campout (5), Fundraiser (3), Service Project (2), Committee Meeting (2), No Meeting (2), Summer Camp (1), Court of Honor (1), **Ceremony (1)**, High Adventure (1). Note "Ceremony" and "Court of Honor" already coexist as separate categories — the rename decision must merge/resolve them. `category` is free-text (no enum), so renames are plain `UPDATE`s + updating the CSV-import allowed list + the public calendar filter.

**Proposed category mapping → 13-type taxonomy (awaiting Patrick's confirm/edit):**

| Today (count) | Proposed |
|---|---|
| Troop Meeting (17) | keep (signup off by default) |
| Campout (5) | keep, or rename **Campout / Overnight**? |
| Fundraiser (3) | keep |
| Service Project (2) | keep |
| Committee Meeting (2) | → **Leadership / Planning**? |
| No Meeting (2) | keep (calendar-only, never signup) |
| Summer Camp (1) | keep |
| Court of Honor (1) + Ceremony (1) | **merge → Ceremony / Recognition**? |
| High Adventure (1) | keep |
| *(none yet)* | add empty types: **Day Activity / Outing, Advancement Event, Training, Recruiting / Outreach, Social Event** |

**Two decisions that gate the Phase 1 migration (must resolve before writing it):**
1. **Category mapping** — confirm/edit the table above (touches real rows + CSV import + calendar filter).
2. **Guests model** — per-household count (prototype) vs. per-entry `guest_count` (schema). Pick one before the `signup_entries` table is written.

**Needed before the builder ships (Phase 1 step 5, not the migration):** confirm the preset matrix default cells (plan §"Preset matrix").

**Parked — Phase 2, not blocking:** tier-scoped questions (`signup_questions.tier_ids`), driver_only-may-claim-donation-tasks rule, public aggregate answer summaries.
