# Roll Call — Centralized Attendance for Every Event

**Status:** Active
**Started:** 2026-08-14
**Priority:** High — the last of the three people-trackers to join the calendar spine

## Overview

One Roll Call surface for every kind of event — meetings, campouts, service
projects, fundraisers, outings — replacing a meetings-only screen and a scatter
of after-the-fact Fast Entry. Attendance becomes a **layer on
`calendar_entries`**, the fourth after story, agenda and signup.

Roll Call does **not** become the store for advancement quantities. It is the
entry surface that **writes ledger rows**, stamped with the entry they came
from. Everything that reads the ledger today — Clipboard, audits, rank-award
triggers, Scoutbook export, `scout_summary` — keeps working untouched.

## Problem / Opportunity

**Three overlapping people-trackers, none of which sees the others.**

| | Records | Keyed by | Covers |
|---|---|---|---|
| `ledger_entries` | **Credit** — nights, hours, miles, meeting attendance | `scout_id` + date | Scouts only |
| `meeting_attendance_leaders` | Adults at meetings | `leader_code` + **date** | Adults, meetings only |
| `signup_entries` / `signup_slot_claims` | **Intent** — yes/no/waitlist, jobs, money owed | `person_id` | Anyone, signup events only |

Consequences today:

- **There is no "who was at this event" screen** for anything but a meeting.
  Campout attendance exists only as scattered `camping_nights` rows entered
  through Fast Entry days later.
- **Adults are invisible outside meetings.** `meeting_attendance_leaders` is
  adults-only, meetings-only and date-keyed — the last date-keyed people table
  after the calendar unification.
- **Signups can't be corrected.** `events/actions.ts` has `cancelEntry` (remove a
  person) but **no action to add one**. A verbal or emailed RSVP genuinely
  cannot be entered, and neither can a walk-up. Confirmed by reading the file,
  not assumed.
- **Double entry.** A leader who ran a campout signup then types the same names
  into Fast Entry a week later.

**Why not just move quantities out of the ledger:** measured, the ledger is the
spine of advancement — 32 code files, 24 migrations, 4 views (`ledger_active`,
`mb_progress`, `scout_summary`, `meeting_attendance_counts`) and **3 triggers**
including `ledger_auto_rank_award`. Moving campout nights out means re-pointing
rank-award logic whose failure mode is silent: a scout doesn't earn a rank and
nobody notices for months. Write-through gets the same product at a fraction of
the risk (see Notes).

**And presence ≠ credit is a real distinction, not an accident.** A scout can
attend a campout and earn zero nights (came Saturday for the day). A driver is
present and earns nothing. An adult is present and has no ledger at all.

## Decisions Locked (Patrick, 2026-08-14)

1. **Write-through, not migration.** Roll Call writes ledger rows; the ledger
   stays the source of truth for advancement quantity.
2. **Absences are INFERRED, never stored.** `event_attendance` holds only people
   who attended. No `status` column, no absent rows.
3. **Credit is AUTOMATIC** on marking someone attended — no separate "grant
   credit" step — **provided** check/uncheck cascades to every other table
   needed for integrity.
4. **`leadership` is out of scope.** It is a term marker, not an event —
   `rank-por.ts:24` records that a leadership row has one date, not a term
   range, and it has no calendar entry to hang off. Likewise
   `rank_requirement`, `merit_badge_requirement`, `rank_award`,
   `merit_badge_award` and `award`: Fast Entry and the requirement editors keep
   those.
5. **A reconciliation audit is added** (see its own section — decisions 2 and 3
   are what make it load-bearing).

## Scope: the six event-linked kinds

| Kind | Event category | Credit Roll Call grants |
|---|---|---|
| `meeting_attendance` | Troop Meeting | none — presence *is* the record |
| `camping_nights` | Campout / Summer Camp / High Adventure | nights |
| `hiking_miles` | outings that log miles | miles |
| `service_hours` | Service Project | hours |
| `day_outing` | Day Activity / Outing | none |
| `fundraiser` | Fundraiser | none |

Only three carry a quantity, each with one unit — small enough to live as a
per-category rule beside `template` on `calendar_categories`.

Audit surface is correspondingly small: of the six audit checks, only
`activity-thresholds.ts` and `duplicate-records.ts` read these kinds.
`rank-por.ts`, `rank-time-in-grade.ts`, `rank-merit-badges.ts` and
`bor-requirements.ts` are untouched.

## Acceptance Criteria

- [ ] Roll Call opens on any calendar entry, not just meetings.
- [ ] Its roster arrives **pre-checked from the signup** (`status='yes'`) where
      one exists, and empty-but-searchable where none does.
- [ ] Any active person — scout or adult — can be added by hand in one step.
- [ ] Un-checking someone removes their credit; the **signup row is untouched**
      (they still owe money, still hold their job claim).
- [ ] Marking a scout attended at a campout grants nights automatically, with a
      per-person override for partial attendance.
- [ ] Re-saving roll call is idempotent — no duplicate credit.
- [ ] Adults appear in the same table as scouts; `meeting_attendance_leaders` is
      retired.
- [ ] All 1,249 historical meeting check-ins are reachable from their entry.
- [ ] A leader can add a person to a signup and claim a job on their behalf.
- [ ] The reconciliation audit reports zero discrepancies on clean data.
- [ ] Clipboard, activity thresholds, rank-award triggers and Scoutbook export
      produce **identical output** before and after — verified by diff.

## Technical Approach

### 1. `event_attendance` — presence only

```sql
create table public.event_attendance (
  id                bigint generated always as identity primary key,
  calendar_entry_id bigint not null references public.calendar_entries(id) on delete cascade,
  person_id         bigint not null references public.people(id) on delete cascade,
  qty               numeric,          -- nights/hours/miles for THIS person; null = category default
  source            text not null default 'manual'
                      check (source in ('signup', 'manual', 'import')),
  note              text,
  recorded_by       text,
  recorded_at       timestamptz not null default now(),
  unique (calendar_entry_id, person_id)
);
```

**A row means "was there". There is no absent row** (decision 2). Absence is the
absence of a row — which also means "roll call not taken" and "everyone was
absent" look identical, and that is accepted: the mismatch panel below is where
a signed-up no-show actually surfaces.

`person_id` unifies scouts and adults in one table, retiring the adults-only,
date-keyed `meeting_attendance_leaders` — the same move `calendar_entry_id` made
for meetings.

### 2. `ledger_entries.calendar_entry_id` — the provenance link

```sql
alter table public.ledger_entries
  add column calendar_entry_id bigint references public.calendar_entries(id) on delete set null;
```

**This is the keystone.** The ledger has no event link today — only a `code`
string. Without this column, none of the three things decision 3 requires are
possible:

- **Cascade on uncheck** — find the exact row this attendance created
- **Idempotency** — recognise credit already granted for this entry+person
- **Reconciliation** — the audit has nothing to join on

Nullable and `on delete set null` on purpose: ~9,700 historical rows have no
event, and Fast Entry may legitimately record a scout who camped with another
troop. **Null means "not from Roll Call", which the audit must not flag.**

### 3. Cascade rules (decision 3's other half)

| Action | Effect |
|---|---|
| Check a scout at a credit-bearing event | Insert `event_attendance`; insert `ledger_entries` with `calendar_entry_id` + category qty |
| Check an adult | Insert `event_attendance` only — adults have no ledger |
| Change one person's qty | Update both rows |
| **Uncheck** | Delete `event_attendance`; **SOFT-delete** the ledger row (`deleted_at`/`deleted_by`/`deleted_reason`), never a hard delete |
| Delete the calendar entry | `event_attendance` cascades; ledger rows survive with `calendar_entry_id` nulled |

Soft delete matches how the Universal Ledger's own delete works and preserves
the audit trail — an unchecked box must not erase history, and a mistaken
uncheck must be recoverable.

**Ordering:** write attendance first, then credit. If credit fails, the audit
catches an attendance row with no ledger — visible and fixable. The reverse
(credit with no attendance) is the harder one to notice, which is why it is the
second thing the audit checks.

### 4. Seeded from signups, never merged with them

Opening Roll Call on an entry with a signup pre-checks everyone at
`status='yes'`, marked `source='signup'`. From there the two records diverge
freely and permanently — the signup keeps its money, job claims and guest
counts no matter what roll call says.

The screen shows a **mismatch panel**, which is worth building for its own sake:

- *Signed up, not marked attended* — owes money and didn't come
- *Attended, never signed up* — came and was never invoiced

### 5. Adding people to signups and jobs

The confirmed gap. Alongside the existing `cancelEntry`, add:
`addSignupEntry(signupId, personId, participation)` and
`claimSlotFor(slotId, personId, comment)`.

Same person-picker component as Roll Call, so a verbal RSVP is entered once and
lands wherever the leader is standing.

## The Reconciliation Audit

**Yes — and decisions 2 and 3 are exactly why it is needed, not optional.**

Automatic cascading credit across two tables with no transaction boundary is the
textbook setup for silent drift. And inferring absence removes the redundancy
that would otherwise let you spot a half-written roll call: with no absent rows,
a roll call that failed halfway through looks exactly like a small event.

New check, `attendance-reconciliation.ts`, joining on `calendar_entry_id`:

| Finding | Means |
|---|---|
| Attendance row, no ledger row (credit-bearing kind) | Credit write failed — scout is short |
| Ledger row with `calendar_entry_id`, no attendance row | Uncheck didn't cascade — scout has credit for an event they were removed from |
| qty mismatch between the pair | An edit hit one side only |
| Ledger row whose date ≠ its entry's date | Entry moved, credit didn't follow |
| Attendance for a person not in the active directory | Merged or deleted person left an orphan |

Deliberately **not** flagged: ledger rows with a null `calendar_entry_id`. Those
are historical or hand-entered and are correct as they stand.

This mirrors `duplicate-records.ts`, which found ~436 real duplicate groups in
production — precedent that this class of audit earns its keep here.

## Test Plan

Vitest against local Postgres, `Subject_Behavior_WhenCondition` convention.

**Attendance and cascade**
- [ ] `Attending_GrantsCredit_WhenTheCategoryCarriesAQuantity()`
- [ ] `Attending_GrantsNoCredit_WhenTheCategoryCarriesNone()`
- [ ] `Attending_GrantsNoLedgerRow_WhenThePersonIsAnAdult()`
- [ ] `Unchecking_SoftDeletesTheCredit_AndLeavesTheSignupIntact()`
- [ ] `Resaving_GrantsNoSecondCredit_WhenTheScoutIsAlreadyMarked()`
- [ ] `PerPersonQty_OverridesTheCategoryDefault_ForPartialAttendance()`
- [ ] `DeletingTheEntry_CascadesAttendance_AndNullsTheLedgerLink()`

**Seeding and divergence**
- [ ] `RollCall_PrechecksTheSignupYesList_WhenASignupExists()`
- [ ] `RollCall_StartsEmpty_WhenTheEntryHasNoSignup()`
- [ ] `Unchecking_DoesNotCancelTheSignupEntry_NorReleaseItsJobClaim()`

**Reconciliation audit**
- [ ] `Audit_FlagsAttendanceWithNoCredit_WhenTheLedgerWriteFailed()`
- [ ] `Audit_FlagsCreditWithNoAttendance_WhenTheUncheckDidNotCascade()`
- [ ] `Audit_IgnoresLedgerRows_WhenCalendarEntryIdIsNull()`
- [ ] `Audit_ReportsNothing_OnCleanData()`

**Regression — the whole point of write-through**
- [ ] `ActivityThresholds_ProduceIdenticalCounts_AfterTheBackfill()`
- [ ] `MeetingAttendanceCounts_MatchTheOldView_AfterTheBackfill()`

## Implementation Steps

Migrations reach production **before** the code (D-089).

1. **Migration A (additive):** `event_attendance`; `ledger_entries.calendar_entry_id`;
   `calendar_categories.credit_kind` + `credit_unit` + `default_qty`.
2. **Migration B (backfill):** meeting attendance → `event_attendance`, joining
   `ledger_active` (kind='meeting_attendance', code='MTG:<date>') to entries by
   date and resolving `scout_id` → `person_id`; stamp those ledger rows'
   `calendar_entry_id`. Then `meeting_attendance_leaders` → `event_attendance`
   via `leader_code` → `person_id`. **Guard before constraining**, and report
   counts — 1,249 check-ins must all land.
3. **Roll Call route** — `/admin/calendar/[id]/roll-call`, linked from the
   workbench panel. Person picker, signup seeding, mismatch panel.
4. **Cascade actions** with the soft-delete rule and idempotency.
5. **Signup add-person / claim-job-for actions**, sharing the picker.
6. **Reconciliation audit** in the existing Audits section.
7. **Retire** `meeting_attendance_leaders` reads; `meeting_attendance_counts`
   re-pointed at `event_attendance`.
8. **qa-lead review** — new write path into the advancement ledger.
9. **Migration C (guarded drop):** `meeting_attendance_leaders`, after soak.

## Open Questions

- [ ] Does a **campout's default night count** come from the category, the entry's
      date span (`end_date - entry_date`), or a field on the entry? The span is
      the most honest default; a Friday–Sunday campout is two nights.
- [ ] Should Roll Call be **reachable from the Meeting Plan** so a leader can
      take attendance and see the agenda's requirements side by side? That is
      the advancement-alignment payoff, but it is a second screen's worth of
      work.
- [ ] `day_outing` and `fundraiser` grant no quantity — should they write a
      **zero-qty ledger row** for the activity-count audits, or nothing at all?
      `activity-thresholds.ts:11` says they already don't count toward
      thresholds, which argues for nothing.

## Notes

**Why write-through rather than moving quantities out of the ledger** — measured
blast radius: 32 code files, 24 migrations, 4 views, 3 triggers including
`ledger_auto_rank_award` and `ledger_auto_scout_rank_award`; plus
`lib/ledger-dedup.ts` shared by Fast Entry and the library proof queue, a
Scoutbook export verified byte-for-byte against a real upload, and
`scout_summary.last_activity_date`'s deliberate exclusion of meeting attendance.
The failure mode of getting it wrong is silent and slow. Write-through delivers
the same screens and touches none of it.

If a single store is still wanted later, the safe order is: ship write-through,
run a season, then decide from evidence about where the two actually disagree.
Write-through is a prerequisite for that migration anyway.

**Related decisions:** D-008 (`meeting_attendance` ledger kind +
`meeting_attendance_leaders`), D-023 (duplicate-records audit precedent), D-041
(Fast Entry dedup), D-079/D-080/D-081 (layers on one spine), D-089 (migration
before code). The calendar unification (`Plans/Calendar-Unification.md`) is what
makes this possible — attendance can only be an entry layer because meetings
became one.
