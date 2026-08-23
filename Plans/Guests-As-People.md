# Guests as People — per-event guest mode (none · count · named)

**Status:** BUILT 2026-08-23 through Phase 2 (v1.87.0, local gate green: lint / typecheck / 1226 tests /
build; browser-verified on the dev server — Builder mode control, family named + count forms end to end,
roster "guest of", People → Guests tab). qa-lead on the code: **go-with-changes, 82/100** — its two
missing security tests were added (`tests/guest-actions-gate.test.ts`, re-pick-of-another-household in
`tests/guests-as-people.test.ts`). **Phase 3 DONE 2026-08-23 (Patrick: "proceed"):** `20260823170000_guests_phase3_drops.sql` — backfill re-run,
`person_id NOT NULL`, CHECKs `signup_entries_identity`/`_guest_class` dropped, `guest_name` dropped (readers
derive the name from the people row; `sync_car_groups_for_entry` re-created without it), `allow_guests` + sync
trigger dropped. Deploy order for the tightening: code first (`git push`, Vercel Ready) then `db push`.
Reviews: tech-lead + qa-lead (PII of non-members) — see the Review section at the end.

**What shipped (2026-08-23):** migrations `20260823140000_guest_mode_and_guest_people.sql` (guest_mode
+ two-way allow_guests sync, `people.guest_host_household_id` + the member/guest guard triggers,
person_directory filter, guest-class guard on signup_entries, backfill, merge_people promotion) and
`20260823150000_submit_household_signup_guests.sql` (`ensure_guest_person` with the 25/household cap +
80-char names; guests INSIDE the RPC payload, host/mode/class validation, 20/event cap, re-pick only by
person_id validated against the household, dropped guests → 'no', **and the Remove → re-register revive
for members and guests** — Patrick chose (a)). Code: `lib/guest-mode.ts` (presets, labels), `lib/
guest-payload.ts` (client-safe normalize/payload helpers), `lib/guest-people.ts` (Guests tab shaping),
Builder radiogroup + prompt + priced-event warning, both family forms by mode (`GuestRowsEditor` with
"add again" picks + typed-name confirm + adult phone; `GuestCountField`), leader Add a guest with known
guests, People → Guests tab (Merge into… / Forget / 12-month nudge), pickers filtered, snapshot "+N
guests". Prod had 0 legacy guest rows at build time, so the backfill is a no-op there.

**Open questions — resolved by default (Patrick to override):** name match → pick-list only + confirm
(tech-lead); adult phone collected, optional; counted guests take capacity seats; Guests tab under People.
Still open: stating "the host adult is responsible" on the form (not added).

**Phase 3 checklist — EXECUTED 2026-08-23 (kept for the record):** re-run the §5 backfill block (the OLD client may have written
`person_id null + guest_name` rows in the minutes between db push and the code deploy), then
`person_id SET NOT NULL`, drop `guest_name`, `allow_guests`, the sync trigger, and CHECKs
`signup_entries_identity` / `signup_entries_guest_class` (verify their values first — qa-lead); the
readers' `guest_name` fallbacks go with them. qa-lead warning to carry: a family re-submit now revives
a leader-Removed row silently — worth a note on the roster's Remove.
**Parked:** 2026-08-22 (Plans/Roster-Status-Tab.md item 5) → own plan 2026-08-23
**Priority:** Medium-High (first real need: Fall Campout Oct 9 — siblings/parents as named guests with
rides and money; Court of Honor — a count)
**Depends on:** people spine (Plans/People-Identity-Model.md, live), Event Logistics Phases 0–4 (live),
participant classes (`20260822100000`, live)

## Overview

Patrick, 2026-08-22: *"the concept of guests is misplaced … we need to know who they are, their
ride, etc."* — then, the same day: *"mature guest support — BOTH modes are real."* For a Court of
Honor or a service project only the **count** matters; for a campout, anything with a payment, or
any overnight, the **names** matter — one line per person with a ride, money and a health form.

So guests are a **per-event builder setting**, not a retirement of the count: a Guests block with
mode **none / count only / named**, defaulted by category the way the other Event Logistics presets
are, and flippable by a leader. In *named* mode every guest becomes a **`people` row** — short-lived,
host-linked, invisible to the directory and pickers — so a guest has contact info, a remembered car,
a health-form date and money like anyone else, and a recurring guest (Grandma, a sibling) is the same
person across events. In *count* mode the host's entry keeps the `+N guests` number and nothing else.

## What exists today (facts, verified 2026-08-23)

| Piece | Today |
|---|---|
| Count | `signup_entries.guest_count` / `guest_note` on the host's entry (`20260718100000`:225); `event_signups.allow_guests` gates it in the RPC (`GUESTS_NOT_ALLOWED`); `event_signup_headcount` and the RPC's capacity check count `1 + guest_count`. **The family form no longer sends a count** — both forms send `guest_count: 0` (`person-first-form.tsx:390,424`, `slot-first-form.tsx:196`), so count mode is dormant in the UI. |
| Named | One `signup_entries` row per guest: `person_id NULL` + `guest_name` + `host_entry_id` + a guest `participant_class` (`20260822100000`:63–82, CHECKs `signup_entries_identity`, `signup_entries_guest_class`). Written by the family form's "Bringing anyone else?" (`guest-rows.tsx`, delete-then-replace by `host_entry_id` in `(public)/events/[id]/actions.ts:186–223`, cap 20, NOT checked against `allow_guests` server-side) and by the leader's Add a guest (`addGuestEntry`, `events/actions.ts:941`). **No `people` row is created** — so no phone, no remembered seats, no health-form date, no scout-account, and `add-person.tsx` can't pick them. |
| Builder | Blocks → Guests toggle = `allow_guests` (hint still says "a counted number of guests"); `guest_prompt` has no editor. Presets: `PRESETS` in `events/actions.ts:38–58` — `guests: true` for Service Project, Fundraiser, Ceremony / Recognition, Recruiting / Outreach, Social Event. |
| People | `people` has no guest concept; `people.active` / `inactive_reason` govern adults; `household_members` is a real membership row; `person_directory` decides tabs/pickers; merges keep the loser via `merged_into_person_id`. |
| Counts | Roster page headcount = going rows + Σ guest_count; signup index sums guest_count; **snapshot `buildCounts` ignores guest_count**; CSV has Guests / Guest note columns. |
| Money | A guest row can take cash/check/Venmo payments (person_id null is allowed); scout_account is blocked by CHECK; credit-to-account explicitly refused ("A guest has no scout account"). |

## Problem / Opportunity

- Named guests are rows without identity: no ride memory, no contact, no history; a guest who
  comes twice is two unrelated rows; a Webelos who crosses over can't be promoted.
- Count mode exists in the schema and the capacity math but not in the form — a Court of Honor
  can't ask "how many are you bringing?"; a leader who enables Guests gets named rows for a ceremony.
- The rules are split across three writers (RPC, family action, leader action) with different checks.

## Acceptance Criteria

- [ ] Builder Guests block is a three-way mode (**none / count / named**), defaulted by category,
      with an editable family-facing prompt; the old `allow_guests` toggle is gone from the UI.
- [ ] Defaults: Court of Honor (Ceremony / Recognition), Service Project, Recruiting / Outreach,
      Social Event → **count**; Campout / Overnight, Summer Camp, High Adventure → **named**; any event
      with a price tier → **named** (the Builder warns if a leader picks count on a priced event —
      "guests can't be charged as a count"). Everything else → none.
- [ ] **Count mode:** family form shows a number + note on the host's row (the dormant `guest_count`
      UI, back); named rows hidden; headcount = 1 + N; snapshot counts show "+N guests"; CSV keeps
      Guests / Guest note.
- [ ] **Named mode:** family form's "Bringing anyone else?" creates one row per guest **with a
      `people` row**; count hidden; guest rows behave like members on roster, rides, assignments,
      money, snapshot, CSV; Guests / Guest note columns are not shown.
- [ ] A guest is a `people` row flagged as a guest of a host household; **not** in
      `household_members`, **not** in the directory tabs or pickers (except a new People → Guests
      tab), **not** signup-able except through the host household's form or a leader.
- [ ] Re-using a guest: the family form offers the household's previous guests as one-click picks
      (the ONLY automatic path); a typed name that matches a previous guest of the same household
      (case-insensitive) gets a confirm ("Use Grandma Pat again?") — never a silent merge
      (tech-lead: People-Identity-Model's "merge requires explicit accept when evidence is
      name-only"; the backfill in §3 keys on exact name within a household and is reported, not
      silent).
- [ ] Promotion: a guest who joins the troop is merged into their new scout/adult `people` row with
      the existing Who-edit merge (history carries; guest flag clears) — no new mechanism.
- [ ] Server enforces the mode in one place: count > 0 only in count mode; named rows only in
      named mode; a guest `people` row can only be created by the host household's form or a leader,
      with a **per-household lifetime cap** (say 25 live guest rows) and the existing per-event cap
      (20), name length ≤ 80 (qa-lead: Tier-1 shared-password submissions must not be able to
      create unbounded people rows).
- [ ] DB guarantee (tech-lead): a person can't hold `guest_host_household_id` AND a
      `household_members` row at once — CHECK/trigger, not convention; promotion clears the flag
      explicitly.
- [ ] The People → Guests tab is gated by `requireCapability` like every admin surface; adult guest
      phone appears only on leader surfaces (roster/snapshot/CSV are already leader-only).
- [ ] `signup_entries.person_id` becomes NOT NULL again; `guest_name` is dropped after backfill;
      the per-event unique (event, person) index now covers guests (no twin rows).
- [ ] Privacy: guests carry name + class by default; an **adult** guest may carry a phone (for
      carpools — optional on the form); a youth guest never carries contact info (the host household
      is the contact); a "forget this guest" action exists; the Guests tab shows last-event date.

## Test Plan

- `Builder_GuestMode_DefaultsByCategory_AndPricedEventsDefaultNamed()` — lib (presets)
- `Rpc_RejectsGuestCount_UnlessCountMode()` / `Rpc_RejectsNamedGuestRows_UnlessNamedMode()` — db
- `Headcount_CountMode_Is1PlusN_NamedMode_IsRows()` — db (`event_signup_headcount` + roster summary)
- `NamedGuest_CreatesAPeopleRow_FlaggedGuestOfHostHousehold_NotAHouseholdMember()` — db
- `NamedGuest_SameNameSameHousehold_ReusesThePersonAcrossEvents()` — db
- `GuestPerson_IsAbsentFromDirectoryTabsAndPickers_PresentOnGuestsTab()` — db (view)
- `GuestPerson_CannotBeSignedUpByAnotherHousehold()` — db (RPC `p_allowed_person_ids` negative)
- `FamilyForm_CountMode_ShowsNumber_HidesNamedRows()` / `FamilyForm_NamedMode_ShowsRows_HidesNumber()`
  / `FamilyForm_NamedMode_OffersPreviousGuestsAsPicks()` — dom
- `Snapshot_Counts_IncludeGuestCount_InCountMode()` — pure
- `ForgetGuest_DeletesWhenUnreferenced_ElseDeactivates()` — db
- RLS negatives for any new table/column (guest `people` rows are admin-client only, as today)
- qa-lead required: `Rpc_RejectsGuestCreation_WhenHouseholdExceedsCap()`,
  `Rpc_RejectsGuestName_ExceedingLengthLimit()`, `FamilyReadBack_GuestRow_NotVisibleToOtherHousehold()`,
  `GuestsTab_RequiresLeaderCapability()`, `Merge_ClearsGuestHostHousehold_OnPromotion()`,
  `CSV_Export_ExcludesAdultGuestPhone_ForUnauthorizedRole()` (or proves it leader-only)
- tech-lead: `GuestPerson_CannotAlsoBeAHouseholdMember()` (the DB guard)

## Technical Approach

### Schema (one migration per concern, additive first — the house pattern)

1. `event_signups.guest_mode text not null default 'none' check (guest_mode in ('none','count','named'))`.
   Backfill: `allow_guests = true` → `'named'` (that IS what the forms have been writing); keep
   `allow_guests` for one release as a generated/synced column (trigger: `allow_guests :=
   guest_mode <> 'none'`) so the deployed RPC keeps working; drop it in the follow-up migration
   after the RPC moves to `guest_mode` (same two-step as step 15).
2. `people.guest_host_household_id bigint references households(id) on delete set null` (+ index).
   Non-null ⇒ this person is a guest of that household. Deliberately a column, not a
   `household_members` row: membership means "on the family's party, signs up for anything, appears
   in /profile"; a guest must not. `person_directory` (and every picker) adds
   `and guest_host_household_id is null`; a new People → **Guests** tab lists them (name, class,
   host household, last signup date).
3. Backfill existing named guest rows: for each `signup_entries` with `person_id is null`, create or
   re-use a `people` row keyed on (host household, lower(trim(guest_name))) with `display_name =
   guest_name`, `guest_host_household_id = host's household`; set `person_id`. Then
   `alter column person_id set not null`, drop CHECKs `signup_entries_identity` /
   `signup_entries_guest_class` (replace with `participant_class in guest classes ⇔ person is a
   guest` if wanted — optional), drop `guest_name` one release later.
4. RPC `submit_household_signup`: read `guest_mode`; `GUESTS_NOT_ALLOWED` when count > 0 and mode ≠
   count; **named guest rows move INTO the RPC payload** (entries with `person_kind: 'guest'`,
   `guest_of_key` → host entry, `participant_class`) so the party validation, capacity math and the
   delete-then-replace happen in one transaction instead of `actions.ts` after the fact. The RPC
   creates/re-uses the `people` row (security definer, host household from `p_household_id`).
   `p_allowed_person_ids` gains the household's existing guest ids so a re-pick passes.
5. `event_signup_headcount`: unchanged (still `1 + guest_count`; in named mode guest_count is 0 and
   the rows count themselves).

### Builder

- Blocks → **Guests**: segmented control none / count / named (replaces the toggle); a family-prompt
  field (`guest_prompt`, finally editable: count → "How many guests are you bringing?", named →
  "Bringing anyone else?"); a one-line warning when count is chosen on a priced event.
- Presets: `PRESETS[...]` in `events/actions.ts` gains `guestMode` (replace `guests: boolean`);
  `enableSignup` seeds `guest_mode`; adding the first price tier to a count-mode event notes
  "guests can't be charged as a count — switch to named?" (note, not a block).

### Family form (both forms)

- Count mode: restore the host-row number + note (the component still exists behind
  `allow_guests`; re-gate on mode). Named mode: keep `guest-rows.tsx`, add (a) a pick-list of the
  household's previous guests ("Add Grandma Pat again"), (b) optional phone for an **adult** guest,
  (c) class select as today. Serialize into the RPC payload (§4) instead of the side write.
- Leader Add a guest: same path — creates/re-uses the `people` row; host select as today.

### People admin

- **Guests** tab on the roster/people page (host household, class, last event, phone if adult);
  actions: **Merge into…** (existing Who-edit merge — promotion when a Webelos crosses over),
  **Forget** (delete the `people` row when no `signup_entries` reference it — FK is RESTRICT — else
  `active=false, inactive_reason='guest-forgotten'`).
- Retention nudge (qa-lead): the Guests tab flags guests with no signup in 12 months as "forget?"
  — a prompt, not an automatic delete.

### Roster / snapshot / CSV

- Named mode: nothing new — guest rows already render everywhere (class pill G, "guest of X").
  Guests / Guest note columns hidden (grid already hides them? — today the grid shows `+N`; hide the
  column when mode ≠ count, item 7's rule).
- Count mode: roster Guests column as today; snapshot `buildCounts` adds "+N guests" (fix the gap).

## Implementation Steps

**Phase 0a — schema** (~0.5 session): steps 1–3 (guest_mode + sync, people column + guard,
backfill, NOT NULL) + tests (RLS negatives, backfill idempotence, the guard). Deploy: DB first
(additive), then code.
**Phase 0b — RPC** (~0.5 session, its own test pass — tech-lead: the RPC is the highest-risk
target, D-048/D-049/D-050 precedent): named-guest rows into the payload, people-row creation with
the caps, mode enforcement. qa-lead reviews before push.
**Phase 1 — Builder + family form + leader add** (~1 session): mode control, presets, both forms by
mode, leader Add a guest creates people rows; dom tests.
**Phase 2 — People → Guests tab, merge/promote, forget** (~0.5 session).
**Phase 3 — drops**: `allow_guests`, `guest_name`, the two old CHECKs, after one soak.

## Open Questions (for Patrick)

- [ ] Re-use by name match within the host household — automatic (recommended; a twin is worse
      than a wrong merge, which the Who-edit can split) or ask the family?
- [ ] Adult guest phone on the family form — collect (recommended, optional field, carpools) or not?
- [ ] Do counted guests keep taking capacity seats (today yes)? Recommended yes.
- [ ] Youth guest responsibility: the host adult is the responsible adult — state it on the form?
- [ ] Should the Guests tab live under People or under Events? (Recommended: People — it IS a
      people list — with a "guest of" column.)

## Review

**tech-lead (2026-08-23) — go-with-changes, folded in:** (1) `people.guest_host_household_id`
column is right (mirrors `merged_into_person_id`; membership ≠ guest status) — add a DB guard so a
person can't be both; (2) named-guest writes INTO the RPC payload is consistent with D-048 and
removes today's two-round-trip delete-then-insert race; (3) the allow_guests → guest_mode two-step
reuses the step-15 `seats_offered_*` pattern (Plans/Completed/Event-Logistics.md); (4) **automatic
name-match re-use conflicts with People-Identity-Model's merge rule** — pick-list only, typed
matches confirm; (5) split Phase 0 into schema vs RPC sub-phases with separate test passes.

**qa-lead (2026-08-23, PII of non-members) — go-with-changes, 7/10, folded in:** name + class
(youth) / optional phone (adult) is the right line; family read-back is already household-scoped;
**critical:** cap/rate-limit guest people-row creation per household (shared-password Tier-1
abuse) and gate the Guests tab with `requireCapability`; merge must clear the guest flag and never
auto-match on name across households; verify CSV/export never carries adult guest phone beyond
leader surfaces; backlog an auto-cleanup path for one-off guests (the 12-month nudge is enough to
ship).
