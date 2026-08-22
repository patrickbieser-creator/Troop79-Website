# Event Logistics — the campout sheet, inside the site

**Status:** Active (planning complete 2026-08-22; tech-lead + qa-lead reviewed same day, both
go-with-changes — all changes folded in below; Patrick signed off the two qa-lead items same day —
READY TO ACTIVATE at Phase 0; no code yet)
**Created:** 2026-08-22
**Priority:** High
**Source of truth being replaced:** `Troop 79 Event Registration History and Roster.xlsx` — 24 tabs,
one per event (2022–2026), `Pinewoods 25` is the canonical shape; `BWCA 26` is the crews/installments
variant; `Tesomas 26` / `Summer Camp 25` the summer-camp variant (tents, health forms, registered).

## Overview

Make the event sign-up workspace the all-in-one logistics snapshot the campout spreadsheet is today —
before (who's in, who owes what, who drives, deposits and deadlines), during (patrols, tents, cars,
contact list, printed for the SPL), after (expenses, reimbursements, P&L, credits to scout accounts).
Most of the sheet's columns already have a home in the site (sign-ups, participant class, people spine,
roll call, finance ledger). This plan adds the four things that don't: **car assignment**, **per-event
groups** (patrols / crews / tents / teams — N configurable sets), **many-payments-per-person money with
per-event P&L, deposit schedules and deadlines**, and **leader-only per-person columns** — then ties them
together in one **printable snapshot**.

## Problem / Opportunity

The sheet is the real system for every campout and the site is not, so leaders keep two books. Concretely
(verified against the live schema 2026-08-22):

| Sheet | Site today | Gap |
|---|---|---|
| Type A/S/JL/AOL/Cub/Driver | `participant_class` + `participation='driver_only'` | none |
| Name, age, grade, email, phone (VLOOKUP from Roster) | `people`, households, derived grade | none |
| Dropped out / can't make it | `status` cancelled/no | none |
| Driver seats Out/Back | `seats_offered_out/back` (**besides** the driver) | sheet counts **including** the driver; nothing remembers a driver's usual car |
| **Car To / Car Back**, driver count (assigned/max), seats need vs. avail, Short/Over | only totals of seats offered | **no placement of riders in cars, per leg; no need-vs-avail; no "driving separately / meeting there"** |
| **Patrol / Crew / Tent / Meal** per event | `scouts.patrol` (roster-wide, free text, bulk editor v1.76) | **no per-event grouping of any kind**; a Webelos guest can't be put in Fire Quackers for the weekend |
| Ck / $$ / Venmo / Cans per person, payment notes ("Venmo 1/25, Check 6/11") | Record-payment dialog → ONE `financial_transactions` row per entry (`fin_tx_signup_entry_uq`) | **installments, split methods, refunds, "Patrick paid for Anjali", overpayment → credit are unrepresentable**; owed is tier price only, no per-person override |
| Expenses (date/amount/payee/how), reimbursements, income, P&L, credit for future campouts | Finance ledger + reimbursement requests + Activity Report by free-text `activity_label` | **transactions don't reference the event**; no event-level money view; expenses not enterable from the event |
| Health Forms, Registered?, Rental/Pass, Expected | slip + paid ticks; family-facing questions | **no leader-only per-person columns** |
| Deposit schedule, registration deadline (BWCA, Tesomas) | one `deadline` | **no milestones** |
| The tab itself | roster table + roll call + finance, three places | **no single snapshot, nothing printable for the SPL** |

## Decisions (Patrick, 2026-08-22 — asked and answered)

1. **Seats count INCLUDING the driver** (matches the sheet: "Patrick 4/4"). Families enter total vehicle
   seats; the board shows "1 of 4". A driver's usual capacity is **remembered on their person record**
   and prefills the next sign-up.
2. **Every attending non-driver defaults to "needs a ride"**, per leg, with the alternatives *assigned to
   a car / driving self / meeting there / not traveling this leg* — all of these happen.
3. **Drag-and-drop board** for placing people. Mostly for leaders, BUT on longer trips scouts negotiate
   who they ride with and it "causes havoc the day before" — so **scouts and families see their
   assignments** on the event page. Not every event uses cars.
4. **N configurable group sets per event** — cars, tents, patrols, crews, service-project teams, often
   several at once. Presets by event type, plus add-a-set on any event. The jobs/slots mechanism was
   raised as a possible vehicle for self-sign-up into tents/patrols/cars — considered below (§Technical
   Approach B); answer: reuse the *picker UI*, not the slots table.
5. **Per-event placement NEVER writes back to the roster** (`scouts.patrol` untouched).
6. **Per-person amount override** is required (Tesomas had many tiers; BWCA 840 vs 850; Lapham
   "Expected").
7. **Every trackable money item has a calendar entry** → `financial_transactions` gains a real
   `calendar_entry_id`. `activity_label` stays free text/cosmetic — the "no activities lookup" decision
   remains valid because the calendar entry *is* the lookup now. **Any leader with access may enter
   expenses**; everything is visible to leaders, which is the control.
8. Reimbursements: **workflow preferred, manual allowed**. Overpayments → **scout-account credit**
   (preferred) or a manual refund transaction.
9. **"Registered with council" and "Health form in hand" are leader-only columns.** When the Health
   Forms upload (parked, committee decision) ships, it must feed this column.
10. **Backfill two events as test/stress data** — history otherwise stays in the sheet.
11. **Snapshot page** is shared by everyone with access and **printed for the SPL**; scout online
    access is a later concern.
12. **Deposit schedules and registration deadlines are modeled** (milestones), not just noted.

## Acceptance Criteria

Transportation
- [ ] Family form asks "seats in your vehicle (including you)" per leg, prefilled from the driver's
      remembered capacity; the answer updates the remembered value.
- [ ] Every attending non-driver has a ride status per leg; new entries default to *needs a ride*.
- [ ] A car exists for every driver × leg they drive, sized by their seat count, with the driver counted
      in it; when the driver cancels or stops driving a leg, the car disappears and its riders return to
      *needs a ride*.
- [ ] Leader can drag a person into a car (or pick the car from a dropdown on the row); a full car
      refuses the drop; the board shows per leg: seats available, people needing a ride, unassigned,
      short/over — the sheet's Need/Avail/Short-Over block.
- [ ] A family signed in at the event page sees "Maya — riding with the Porters (there), Bieser (back)"
      for its OWN household only — driver family name, never the full manifest, never phone/email/
      address. (Safeguarding-adjacent: pairs a minor with a named adult — qa-lead; needs Patrick's
      explicit sign-off, see Open Questions.)
- [ ] Only `sync_car_groups` may create, resize or delete a `kind='car'` group — the builder and board
      never offer it (invariant + test, tech-lead).

Assignments (group sets)
- [ ] Builder "Assignments" block: event-type presets (Campout → Patrols, Cars there/back, Tents;
      High Adventure → Crews, Cars; Summer Camp → Tents, Cars; Service → Teams) each toggleable, plus
      "Add a set" with any label; per set: capacity default, family-may-pick, family-visible.
- [ ] Patrol set seeds groups and members from `scouts.patrol` for signed-up scouts; later sign-ups are
      auto-placed; leaders can move anyone (incl. guests and adults); nothing writes back to the roster.
- [ ] Same board component serves every set (cars are the only set with a driver and a leg).
- [ ] Counts per group (the sheet's "Patrol Count") on the board and the snapshot.

Money
- [ ] Many transactions per entry: installments, split methods, refunds; per-entry `owed` = override or
      tier × days; `paid` = sum of linked non-voided rows; `balance` shown on the roster and Money tab.
- [ ] Overpayment → one action credits the scout's account (linked transfer group); refund is a
      negative event-fee row.
- [ ] `financial_transactions.calendar_entry_id` set on every entry-linked row and on any row entered
      from the event's Money tab; Activity Report groups by entry when present, label otherwise.
- [ ] Event Money tab: income by method, expenses (add expense with payer → optional reimbursement
      request), reimbursements, P&L / trip cost to troop, credits issued — the sheet's bottom-right block.
- [ ] Milestones (deposit schedule, registration deadline, form due) on the public event page; a
      per-person "behind" indicator for payment milestones; a one-click "email those behind" using the
      existing reminder-email plumbing with editable copy.
- [ ] `payment_received` is RETIRED, not cached: its six readers (`events/actions.ts`,
      `finance/actions.ts`, `rosters/[id]/page.tsx`, `roster-table.tsx`, `event-signup.ts`,
      `rosters/page.tsx`) move to `signup_entry_balances`; the column is dropped afterwards. Balances are
      always derived — D-134 holds (tech-lead).
- [ ] The one-payment unique index is dropped IN THE SAME DEPLOY as the rewritten record/void actions —
      never a window where the DB no longer enforces the invariant and only the old app guard does
      (qa-lead critical #1).

Leader columns, snapshot, backfill
- [ ] Leader-only columns (checkbox / text / number) configurable per event, excluded from the family
      form, editable on the roster; presets "Health form in hand" (pre-suggested from
      `people.health_form_date` within 12 months of the event) and "Registered with council".
      **Free-text leader columns are excluded from the snapshot and CSV by default** — only checkbox
      and number columns print; a text column prints only if the leader explicitly flags it
      `print_allowed`, with an on-screen warning that the snapshot gets handed to scouts. This keeps the
      "no medical content on paper" guarantee from `roster-print` — a free-text "Meds" column is
      exactly the backdoor `20260713000000_demographics.sql` closed (qa-lead critical #2).
- [ ] `/admin/rosters/[id]/snapshot` prints: header, headcount tiles, roster by patrol set, car
      manifests per leg with driver phone, every other set, contact list, money status per person,
      expenses & P&L, milestones, special notes. Page-break per section, US Letter, no medical content.
- [ ] Pinewoods '25 and BWCA '26 imported end to end (entries, groups, cars, payments, expenses) with
      ZERO duplicate money: existing ledger rows are linked, not re-inserted; matching is exact amount
      + resolved `person_id` + date within ±7 days (expenses: exact amount + date ±7 + label token) —
      never amount-only; a **dry-run report** (matched / inserted / ambiguous) is reviewed before any
      write; re-running after a partial failure creates nothing new; new rows tagged `import_batch` for
      one-statement removal. qa-lead reviews the matching code before it touches production.
- [ ] Quality gate unchanged: lint + typecheck + test + build; every new test failing-first.

## Test Plan

`db` project unless noted. Stubs named for what they verify; fill in during each phase.

Transportation
- [ ] `Family_SeesVehicleSeatsPrefilled_WhenDriverHasRememberedCapacity()`
- [ ] `Signup_UpdatesRememberedCapacity_WhenDriverEntersSeats()`
- [ ] `NonDriverEntry_DefaultsToNeedsRide_OnBothLegs()`
- [ ] `DriverOnlyEntry_DefaultsNotTraveling_OnLegItDoesNotDrive()` — drives out only → `ride_back='not_traveling'`
- [ ] `DriverEntry_HasNoRideStatus_OnLegsTheyDrive()` — CHECK constraint
- [ ] `CarGroup_IsCreatedSizedAndDriverSeated_WhenEntryDrivesLeg()` — trigger
- [ ] `CarGroup_IsRetiredAndRidersReleased_WhenDriverCancels()`
- [ ] `CarGroup_CannotBeCreatedByLeaderAction_OnlyByTrigger()` — the invariant
- [ ] `PlaceRider_RejectsFullCar()` — RPC locks the group row `FOR UPDATE` before counting
- [ ] `PlaceRider_RejectsNthPlusOne_UnderConcurrentCalls()` — `Promise.all` into an N-capacity car
- [ ] `PlaceRider_ReturnsCarGone_WhenDriverCancelledConcurrently()`
- [ ] `PlaceRider_MovesRider_WhenAlreadyInAnotherCarOnSameLeg()` — one car per person per leg
- [ ] `TransportTiles_ComputeRidersPlacedUnplacedRoomShortOver_PerLeg()` — pure fn over entries +
      memberships (see §A for the exact definitions)
- [ ] `FamilyEventPage_ShowsOwnCars_WithoutContactInfo()` (dom)
- [ ] `OtherHousehold_CannotSeeOtherPartysPlacements_WhenSelfAssertedHouseholdSwitched()`
- [ ] `AnonKey_CannotReadSignupGroupTables_OrEventMilestones()` — RLS negative, all four new tables
- [ ] `NonCapabilityActor_CannotCallPlaceInGroup_OrRecordExpense_OrVoidPayment()`
- [ ] `RosterTable_SeatsColumn_ShowsIncludingDriver()` (dom)

Assignments
- [ ] `PresetSets_MatchCategory_WhenAssignmentsBlockEnabled()`
- [ ] `PatrolSet_SeedsFromRoster_ForSignedUpScoutsOnly()`
- [ ] `PatrolSet_AutoPlacesLateSignup_WhenScoutHasRosterPatrol()`
- [ ] `Placement_NeverWritesScoutsPatrol()` — the D-? guard
- [ ] `Member_IsUniquePerSet()` — one tent, one patrol, one car per leg
- [ ] `FamilyPick_RejectsWhenSetNotSelfSelect_OrGroupFull()`
- [ ] `Board_DropdownFallback_PlacesPerson()` (dom)

Money
- [ ] `SignupEntryBalance_SumsManyPayments_AndRefunds()` — view
- [ ] `SignupEntryBalance_UsesOverride_WhenPresent()`
- [ ] `SignupEntryBalance_ExcludesVoidedRows_AfterVoidingOneOfMany()`
- [ ] `RecordEventFeePayment_AllowsSecondPayment_AfterUniqueIndexDropped()` — replaces the old rejection test
- [ ] `RecordEventFeePayment_IsIdempotent_OnRetryWithSameKey()` — client idempotency key
- [ ] `VoidEventFeePayment_VoidsOnlySpecifiedTransaction_WhenManyPaymentsExist()`
- [ ] `LegacyReaders_UseBalancesView_NoReferenceToPaymentReceivedRemains()` — grep-style guard before the column drop
- [ ] `CreditOverpayment_WritesLinkedScoutAccountRow()`
- [ ] `EventExpense_CarriesCalendarEntryId_AndOptionalReimbursementRequest()`
- [ ] `ActivityReport_GroupsByCalendarEntry_FallsBackToLabel()`
- [ ] `MilestoneStatus_FlagsBehind_WhenCumulativeDueExceedsPaid()` — pure fn
- [ ] `EmailBehind_SelectsOnlyEntriesBehindOnDate()`
- [ ] `EventMoneyActions_AllowCalendarWriteOrFinanceManage_VoidStaysFinanceManage()`

Leader columns / snapshot / backfill
- [ ] `LeaderOnlyQuestion_IsExcludedFromFamilyForm()` (dom)
- [ ] `HealthFormColumn_PreSuggestsFromHealthFormDate_Within12Months()`
- [ ] `LeaderOnlyTextColumn_IsExcludedFromSnapshotAndCsv_UnlessPrintAllowed()`
- [ ] `Snapshot_ContainsEverySection_AndNoMedicalContent()` (dom)
- [ ] `Snapshot_RequiresCalendarWrite()`
- [ ] `ImportEventSheet_ParsesPinewoodsTab_IntoEntriesGroupsPayments()` — sanitized fixture
- [ ] `ImportEventSheet_LinksExistingLedgerRows_InsteadOfDuplicating()`
- [ ] `ImportEventSheet_DoesNotLink_WhenOnlyAmountMatches()` — false-positive guard
- [ ] `ImportEventSheet_ReRunAfterPartialFailure_CreatesNoDuplicates()`
- [ ] `ImportEventSheet_ReadsSeatsAsIncludingDriver()`

## Technical Approach

Everything hangs off `event_signups` (→ `calendar_entries`), same as the rest of the sign-up model.
RLS enabled, zero policies, admin client only — the project pattern. Every loader over
`financial_transactions` uses `fetchAllRows()`.

### A. Transportation

```sql
-- seats INCLUDING the driver (D-2026-08-22 #1). Additive → backfill → code swap → drop old.
alter table signup_entries add column vehicle_seats_out int check (vehicle_seats_out is null or vehicle_seats_out >= 1),
                           add column vehicle_seats_back int check (...);
update signup_entries set vehicle_seats_out  = seats_offered_out  + 1 where drives_out;
update signup_entries set vehicle_seats_back = seats_offered_back + 1 where drives_back;
-- (seats_offered_* dropped in a follow-up migration once no reader remains)

alter table people add column default_vehicle_seats int;   -- last value a driver gave; prefill only

-- ride status per leg, NULL when the person drives that leg
alter table signup_entries
  add column ride_out  text check (ride_out  in ('needs_ride','self','meeting_there','not_traveling')),
  add column ride_back text check (ride_back in ('needs_ride','self','meeting_there','not_traveling')),
  add constraint ride_out_xor_driver  check ((drives_out  and ride_out  is null) or (not drives_out  and ride_out  is not null) or status <> 'yes'),
  add constraint ride_back_xor_driver check ((drives_back and ride_back is null) or (not drives_back and ride_back is not null) or status <> 'yes');
-- backfill: status='yes' and not drives_x → 'needs_ride'; participation='driver_only' and not
-- drives_x → 'not_traveling' (a driver-only adult who drives out goes home; no return seat needed)
-- SAME migration: drop the old CHECKs signup_entries_seats_out / _seats_back (they require
-- seats_offered_* when driving) — otherwise Phase 1 inserts that stop writing seats_offered_* fail
-- until the columns are dropped in Phase 5 (tech-lead). The XOR CHECK pattern above is house style
-- (already used by _driver_only, _contributor, _seats_out/back).
```

Cars are **groups** (§B) in a set of kind `car` with `leg in ('out','back')`. A trigger on
`signup_entries` (`sync_car_groups`) creates/resizes/retires the car for each (entry, leg) where
`drives_<leg>` and `status='yes'`, seats the driver as member role `driver`, and deletes the car when the
driver cancels or stops driving — its riders simply lose membership and are *needs_ride + unassigned*
again. Capacity = `vehicle_seats_<leg>`; "room" = capacity − members (driver included, like the sheet).
Car `notes` carries "pulling trailer / arriving late". **Invariant:** only `sync_car_groups` creates,
resizes or deletes a `kind='car'` group — the builder and board never offer "add a car"; a car exists
because an entry drives (comment in the trigger + test). Placement does NOT change `ride_x` — it stays
`needs_ride` and the membership is what satisfies it. Tiles per leg, each defined over entries JOIN
memberships (pure fn, tested):
- `riders` = entries with `status='yes'` ∧ `ride_x='needs_ride'` (placed or not)
- `placed` = riders with a membership in that leg's car set; `unplaced = riders − placed`
- `room` = Σ(capacity − 1) over cars (passenger seats) ; `short/over = room − riders`
- plus `drivers`, `self`, `meeting_there` counts. Unassigned column on the board = `unplaced`.

Placement uses an RPC (`place_in_group(group_id, entry_id)`) that **locks the group row `FOR UPDATE`
before counting members** — literally the `claim_signup_slot` pattern
(`20260718100000_event_signup_phase1.sql:418-497`), not just "the same discipline": rejects full groups,
returns a distinct "group gone" result if the car was retired concurrently, and moves a person already
in another group of the same set (one car per person per leg; one tent; one patrol — the
`unique(set_id, entry_id)` is DB-enforced). Write actions take an idempotency key so a retried click
never double-places or double-records.

Family-facing: the event detail page (behind the existing family gate) shows the household's own
placements per family-visible set: "Maya — Porter (there), Bieser (back) · Tent 3 · Kraken". Minimum
exposure: **own household's entries only** (same `loadPartySignup` scoping), the car shown as the
driver's *family name*, never the full manifest, never phone/email/address. Drivers' phones appear on
the leader board and snapshot only. qa-lead's caveat stands: the Tier 1 gate's self-asserted household
picker means any family-password holder could switch households and see another party's placements —
an accepted risk for attendance data, but pairing a minor with a named adult driver is
safeguarding-adjacent, so this is an explicit Patrick decision (Open Questions), with Tier 2 identity
as the alternative gate.

### B. Assignments — group sets

The sheet's structure, literally: each grouping **column** is a set, each distinct **value** a group, each
**row** a membership.

```sql
create table signup_group_sets (
  id bigserial primary key,
  event_signup_id bigint not null references event_signups(id) on delete cascade,
  kind text not null check (kind in ('patrol','crew','tent','cabin','car','team','meal','custom')),
  label text not null,                      -- "Patrols", "Cars there", "Tents", "Service teams"
  leg text check (leg in ('out','back')),   -- cars only
  seed_from_roster boolean not null default false,   -- patrol: groups + members from scouts.patrol
  self_select boolean not null default false,        -- families may pick a group with room
  family_visible boolean not null default true,
  default_capacity int,
  sort int not null default 0,
  unique (event_signup_id, label),
  check (kind = 'car' or leg is null), check (kind <> 'car' or leg is not null)
);
create table signup_groups (
  id bigserial primary key,
  set_id bigint not null references signup_group_sets(id) on delete cascade,
  name text not null,                       -- "Kraken", "Tent 3", driver display name for cars
  capacity int,                             -- null = unlimited; cars: vehicle seats incl. driver
  driver_entry_id bigint references signup_entries(id) on delete cascade,   -- cars only
  notes text, sort int not null default 0,
  unique (set_id, name)
);
create table signup_group_members (
  group_id bigint not null references signup_groups(id) on delete cascade,
  entry_id bigint not null references signup_entries(id) on delete cascade,
  set_id   bigint not null references signup_group_sets(id) on delete cascade,  -- denormalized for the unique
  role text check (role in ('driver','leader')),
  placed_by text, placed_at timestamptz not null default now(),
  primary key (group_id, entry_id),
  unique (set_id, entry_id)                  -- one group per person per set
);
```

Presets live in code beside the existing preset matrix (`calendar_categories` → block defaults):
Campout → Patrols (seed), Cars there, Cars back, Tents · High Adventure → Crews, Cars there/back ·
Summer Camp → Tents, Cars up/back · Service Project → Teams, Cars · Day Outing → Cars. The builder's
Assignments block lists the preset sets as toggles and offers "Add a set" (label + kind + capacity +
self-select + family-visible). Enabling a car set also turns on `drivers_needed`.

**On the jobs/slots wrinkle (decision #4):** slots stay what they are. A slot is a *job* — it has shift
times, eligibility, `needed`, and claiming one is a commitment that counts toward coverage and drives
the slot-first fundraiser form. A group membership is a *placement* that a leader may overrule, with an
"unassigned" state that is normal, not a gap. Putting tents into `signup_slots` would render them as jobs
on fundraiser-style forms, count them in coverage, and tangle `attendance_required`. Instead, a set with
`self_select` renders on the person-first form as a per-person picker ("Tent preference · any with room",
"Ride with…") reusing the slot picker's *UI component* (capacity pills, lockout when full). Picking
creates a membership with `placed_by = family`; leaders can move it; blank = leader decides. The family
form already has `notes` for free-text wishes.

The board (`/admin/rosters/[id]/assignments`, tabs per set): group cards with `n/cap` pill and Full state,
an Unassigned column, drag-and-drop (dnd-kit or native HTML DnD — decide at build; no new heavy dep
without reason) with a per-row dropdown fallback for phones. Cars show driver + phone + notes. Roster
table gains one column per set (badge) and the CSV gains the same columns — the sheet's Car To / Car
Back / Patrol columns come back as columns.

### C. Money

```sql
-- Phase 0 (additive):
alter table signup_entries add column amount_override numeric(10,2) check (amount_override is null or amount_override >= 0);
alter table financial_transactions add column calendar_entry_id bigint references calendar_entries(id) on delete set null;
update financial_transactions t set calendar_entry_id = es.calendar_entry_id
  from signup_entries se join event_signups es on es.id = se.event_signup_id where t.signup_entry_id = se.id;
create index on financial_transactions (calendar_entry_id) where calendar_entry_id is not null;

create view signup_entry_balances as
  select se.id as entry_id,
         coalesce(se.amount_override, p.amount * coalesce(se.days, 1)) as owed,
         coalesce(sum(t.amount) filter (where t.voided_at is null and t.kind = 'event_fee'), 0) as paid
  from signup_entries se
  left join event_prices p on p.id = se.price_id
  left join financial_transactions t on t.signup_entry_id = se.id
  group by se.id, se.amount_override, p.amount, se.days;
-- balance = owed - paid; settled = owed > 0 and paid >= owed. NO cached boolean: payment_received
-- is retired (D-134 — balances are always derived). Its six readers move to this view in Phase 3.

-- Phase 3 (SAME deploy as the rewritten record/void actions — qa-lead critical #1):
drop index fin_tx_signup_entry_uq;                       -- many payments per entry
alter table signup_entries drop column payment_received; -- after the grep-guard test passes
```

Until Phase 3 deploys, the unique index stays and the DB keeps enforcing "one payment per entry" —
there is no window where only the app guard stands (the 2026-08-18 reimbursement near-miss in
`finance_core.sql:69-77` is exactly why).

- **Refunds** are negative `event_fee` rows — DECIDED, not open: `transaction_kinds`
  (20260820220000) documents that a kind carries "no direction/behavior of its own — the signed amount
  is the only thing that decides money in vs. out", so this is the consistent choice. **Overpayment → credit**:
  one action writes `scout_account +X` for the person with `transfer_group` = the fee row's — the
  finance plan's two-row pattern. **Someone else paid**: the transaction's `person_id` is the payer,
  `signup_entry_id` is whose fee it settles; memo "paid by Patrick".
- `recordEventFeePaymentAction` loses its "already recorded" guard, gains `calendar_entry_id` and an
  idempotency key; `voidEventFeePaymentAction` takes a transaction id, not an entry id (its
  `.maybeSingle()` lookup by entry is exactly what breaks once many rows exist). Capabilities
  unchanged: record = `calendar.write` OR `finance.manage`; void/edit = `finance.manage`; no new
  capability, nothing added to `LEGACY_EXCLUDED`. The Money tab route itself is gated
  `requireAnyOf(['calendar.write','finance.manage'])` so nobody sees a page whose actions 403 (the
  parent `/admin/rosters/[id]` is `calendar.write`; a `finance.manage`-only actor reaches Money by URL).
- **Event Money tab** (`/admin/rosters/[id]/money`): per-person owed / paid / balance / history +
  Record payment, Refund, Credit to scout account, per-person amount override; Expenses list + Add
  expense (date, amount, paid by: troop check/card/bank or a person → optional reimbursement request
  created in `submitted`); income by method; reimbursements; P&L = income − expenses (net of
  reimbursements) = the sheet's "Campout Profit / Loss" and "Trip Cost to Troop"; credits issued.
- **Activity Report** groups by `calendar_entry_id` when present (label = entry title), else by
  `activity_label`; `bulkReassignAction` gains `calendar_entry_id` so historical rows can be attached
  later by hand. `activity_label` remains free text (decision #7).
- **Milestones:**

```sql
create table event_milestones (
  id bigserial primary key,
  event_signup_id bigint not null references event_signups(id) on delete cascade,
  kind text not null check (kind in ('payment','registration','form','other')),
  label text not null,                       -- "Deposit", "Balance due", "Council registration", "AHMR due"
  due_on date not null,
  amount numeric(10,2) check (kind <> 'payment' or amount is not null),   -- per-milestone amount; "behind" = paid < Σ amounts of payment milestones due on/before today
  applies_to text not null default 'both' check (applies_to in ('scouts','adults','both')),
  sort int not null default 0
);
```
  Public event page lists milestones; per-person status = `paid < Σ amount of payment milestones due on
  or before today` → *behind*; roster/Money tab badge; `emailBehind` mirrors `emailNonResponders`
  (editable copy in Lookups & Admin → site_text); dashboard attention items for events with anyone
  behind or a registration milestone within 7 days.

### D. Leader-only columns

`signup_questions` gains `leader_only boolean not null default false` and `print_allowed boolean not
null default false`. Leader-only questions are never rendered on family forms and appear as editable
cells on the roster (checkbox/text/number per `input_type`). **Checkbox and number columns export to
CSV and print on the snapshot; free-text columns do not unless `print_allowed` is set**, and setting it
shows a warning ("this page is handed to scouts — no medical or personal content"). That is the
procedural+technical guard qa-lead asked for: the snapshot's no-medical-content test covers leader
text columns, not just `things_we_should_know`. Presets in the builder: **Health form in hand** (checkbox,
pre-suggested ✓ when `people.health_form_date` ≥ event date − 12 months, leader confirms) and
**Registered with council** (checkbox). When Health Forms upload exists, the preset reads `health_forms`
instead of the date — one column, better source. Other sheet columns (Tent plan, Meal, Rental, Pass, Year
at camp) are just leader-only questions a leader adds.

### E. Snapshot

`/admin/rosters/[id]/snapshot` — a print-first page like `/admin/roster-print` (inside `(workspace)`
this time; it is an event page). Sections, each starting a new page: header (event, dates, location,
leader, headcount tiles incl. class breakdown and two-deep), roster grouped by the patrol/crew set (or
flat) with class/grade/slip/paid/balance/leader columns, **car manifests** per leg (driver, phone, seats
n/cap, riders, notes) + Need/Avail/Short-Over, every other set, contact list (adults: phone/email;
scouts: guardian phone), money (by method, balances due), expenses & P&L, milestones, special notes.
Gate `calendar.write`. **No medical content** — same test as roster-print. Print = Chrome Save-as-PDF.

### F. Backfill two events

`next-app/scripts/import-event-sheet.ts <xlsx> <tab> <calendar_entry_id>`: parses the tab's row block
(type code, name, car to/back, patrol/crew, seats, payments by column, notes, email/phone) and summary
blocks (expenses with date/note, reimbursements, credits); matches people by name through the existing
roster-import normalizer; creates `event_signups` (if missing) with the matching sets; inserts entries,
groups, memberships, ride statuses, cars; **money: looks for an existing `financial_transactions` row and LINKS it
(`signup_entry_id`, `calendar_entry_id`) — match = exact amount + resolved `person_id` + date within
±7 days (expenses: exact amount + date ±7 + a label token), never amount alone; ambiguous = reported,
not linked — inserts only when nothing matches, tagged `import_batch='event-sheet-<tab>'`** so a
re-run or a rollback is one delete. The script runs `--dry-run` first and prints matched / inserted /
ambiguous per row; the write run is idempotent (re-running after a partial failure creates nothing).
qa-lead reviews the matching code before the production run. Seats are read as
including the driver. Fixture for tests is a sanitized excerpt (names/emails replaced), never the xlsx.
Events: **Pinewoods '25** (the exemplar: patrols, expenses, reimbursement, P&L, credits) and **BWCA '26**
(crews, installments, split methods, refund, dropped-out). Winter Camp '26 is the richest car-assignment
tab if a third is wanted. Both need a `calendar_entries` row (create if absent).

## Implementation Steps

**Phase 0 — schema (one migration per concern, additive first)**
1. Seats-including-driver columns + `people.default_vehicle_seats` + ride status columns + backfill;
   drop the old `signup_entries_seats_out/_seats_back` CHECKs in the same migration.
2. Group sets / groups / members (RLS on, zero policies) + `sync_car_groups` trigger +
   `place_in_group` / `unplace_from_group` RPCs (FOR UPDATE).
3. Money (additive only): `amount_override`, `calendar_entry_id` + backfill, `signup_entry_balances`
   view, `event_milestones`. The unique-index drop and `payment_received` removal wait for Phase 3.
4. `signup_questions.leader_only` + `print_allowed`.
5. qa-lead reviews the migrations (RLS negatives, trigger/RPC race tests) before they are pushed.

**Phase 1 — Transportation** (~1.5 sessions)
6. Family form: total seats incl. driver, prefill, ride status per leg; RPC `submit_household_signup`
   writes the new columns and updates `default_vehicle_seats`.
7. Board (cars only first) + tiles + roster Driving/Car columns + CSV; leader Add-a-person sets ride status.
8. Family-facing "your cars" on the event detail page.

**Phase 2 — Assignments** (~1.5 sessions)
9. Builder Assignments block with presets; patrol seeding + auto-place; board generalized to every set;
   self-select picker on the family form; family-visible placements; roster/CSV columns per set.

**Phase 3 — Money** (~2 sessions; depends only on Phase 0 — may run in parallel with 1–2)
10. ONE deploy: drop `fin_tx_signup_entry_uq`, rewrite record (many, idempotent) / void (by transaction
    id), move the six `payment_received` readers to the balances view, then drop the column; refund;
    credit to scout account; amount override; balance on roster.
11. Event Money tab: expenses (+ reimbursement hand-off), income by method, P&L; Activity Report by entry;
    bulk-reassign to an entry.
12. Milestones: builder block, public listing, behind status, email-those-behind, attention items.

**Phase 4 — Leader columns + Snapshot** (~1 session)
13. Leader-only questions + presets; snapshot page + print CSS; CSV parity.

**Phase 5 — Backfill + eyes-on** (~1 session)
14. Import script + sanitized fixture; import Pinewoods '25 and BWCA '26 locally, then production;
    side-by-side with the sheet tabs; fix what real data breaks.
15. Drop `seats_offered_*` once nothing reads them. Move this plan to Completed/.

Phases 1–4 each ship independently (each is a useful slice on its own); the snapshot grows a section
per phase rather than waiting for the end. Reviews done 2026-08-22 (tech-lead go-with-changes,
qa-lead go-with-changes — folded in). Still to come: qa-lead on the Phase 0 migrations before push,
on Phase 3 (money) and on the Phase 5 matching code before production; ux-lead before Phase 1's board.

## Open Questions

**Signed off by Patrick, 2026-08-22 (the two qa-lead items):**

- [x] **Family-visible car placements behind the Tier 1 shared family password — accepted.** Same
      risk posture the troop already accepts for attendance data; minimum exposure as designed (own
      household only, driver's family name, no manifest, no contact info). No Tier 2 requirement.
- [x] **Leader-only free-text columns — allowed.** Patrick: "not a concern." The print guard stays as
      designed (text columns off the snapshot/CSV unless `print_allowed`, with a warning) because it
      costs nothing, but it is a convenience, not a policy gate.

Defaults assumed — say so if any is wrong; none blocks Phase 0:

- [ ] Layout: `/admin/rosters/[id]` becomes tabs — Roster · Assignments · Money · Snapshot (assumed),
      rather than separate sub-nav entries.
- [ ] Drag-and-drop library: dnd-kit vs. native HTML5 DnD (touch support is the deciding factor; decide
      at build after a ux-lead look).
- [ ] Self-select placements land directly as memberships (assumed) rather than as "preferences" a
      leader must confirm.
- [ ] Does "Registered with council" ever need a date or confirmation number rather than a tick?
      (Assumed tick; a text leader column covers the rest.)

## Notes

- Ignore the stray `30` in Pinewoods col A next to Mindy (Patrick: unknown, ignore).
- Sheet formulas confirmed: Need = COUNTA(car column) (people placed), Avail = Σ seats, Short/Over =
  Avail − Need; Patrol Count = COUNTIF; Driver Count = COUNTIF(car col, driver) with Max = VLOOKUP of
  seats. The plan's *need* deliberately counts people who still need a seat, not people already placed
  (decision #2) — strictly more useful than the sheet.
- Related: `Plans/Event-Signup.md` (model), `Plans/Completed/Participant-Classification.md`,
  `Plans/Troop-Finances.md` (the one-payment unique index this plan removes, and the two-row credit
  pattern it reuses), `Plans/Roll-Call.md` (presence ≠ sign-up ≠ placement), `Plans/Health-Forms.md`
  (parked; feeds the health-form leader column when built), the bulk patrol screen (v1.76.0) and
  `lib/patrol-assign.ts` (normalizer reused for seeding).
- Money double-count risk in the backfill is the one place the import can do damage; link-first with a
  strict match, dry-run report, insert tagged, and diff against the Activity Report before and after.
- Review log 2026-08-22: tech-lead — go-with-changes (D-134 conflict on a cached `payment_received`
  → retired instead; seats CHECKs relaxed in Phase 0; refund question closed; car-group invariant;
  Phase 3 parallelizable). qa-lead — go-with-changes, test-quality 78 (unique-index drop resequenced
  into the Phase 3 deploy; free-text leader columns off the snapshot by default; FOR UPDATE lock
  literal; tile math defined over memberships; strict backfill matching; nine security/concurrency
  tests added; two Patrick sign-offs raised).
- Two concurrent sessions were editing the site when this was written (2026-08-22); this plan is the
  only file this session touched.
