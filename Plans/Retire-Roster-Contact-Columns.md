# Retire the roster contact columns — `people` becomes the only place a human's contact details live

**Status:** Parked
**Parked:** 2026-08-26
**Priority:** High (data integrity; every sign-in and roster bug of 2026-08-26 traces to this)
**Source:** `Plans/People-Model-Audit-2026-08-26.md`; Patrick, 2026-08-26: "why do we have two places for so much of the same data?"

## Overview

`scouts` and `leaders` predate the `people` spine (D-042, 2026-07-20) and still carry their own
copies of contact/demographic fields — email, phone, address, birthdate, gender, BSA ID, health
form date, notes. The spine was added *additively* and bootstrapped from those columns; the
"now retire the old columns" phase was never scheduled. Since then adults are edited on `people`
(leader form retired 2026-08-17) while scouts are edited on `scouts` (mirrored to `people` only
since v1.106.3), and readers pick a side per screen. This plan finishes D-042: `people.*` is the
only place these facts are edited or read; `scouts` keeps rank/patrol/scout-only fields,
`leaders` keeps code/role/login fields, and the duplicate columns are dropped.

## Problem / Opportunity

- 33 scout addresses, 13 phones, 12 birthdates, 10 genders and 19 leader emails disagree between
  the two sides today (audit). Each disagreement is a screen showing a different truth.
- A leader fixing a scout's email in the roster did not change what sign-in used (v1.106.3 patched
  with a one-way mirror — a bandage, not the fix).
- The printed roster read `leaders.*` that nothing wrote (fixed 2026-08-26 by preferring `people.*`).
- Every new feature that touches "how do I reach this person" has to choose a side, and will
  choose wrong sometimes.

## Acceptance Criteria

- [ ] The scout Edit form's contact/demographic fields (email, phone, address, birthdate, gender,
      health form date, things-we-should-know, BSA ID) read from and write to `people.*` via the
      person link; `scouts.*` copies are no longer written by any code path.
- [ ] `person-mirror.ts` is deleted (no longer needed).
- [ ] Every reader of `scouts.email/phone/address*/birthdate/gender/bsa_member_id/health_form_date/things_we_should_know`
      and `leaders.email/phone/address*/birthdate/health_form_date/things_we_should_know/bsa_member_id/ypt_completed`
      reads `people.*` instead — audit list: `households.ts`, `roster-print-data.ts`, `authorized-adults.ts`,
      `signin-roster.ts`, `identity-challenge.ts`, roster tables, Scoutbook export, the audits checks
      (`advancement/audits/checks/*`), demographics report, `event-signup` party loaders. Grep is the
      acceptance test: zero references outside the drop migration.
- [ ] One-time resync migration BEFORE the drop: `people ← scouts` for scouts' contact fields (the
      scout form was the only editor), `people` already canonical for adults (no copy needed). Both
      directions logged as a count in the migration's `raise notice`.
- [ ] Drop migration removes the duplicate columns from `scouts` and `leaders` (list in Technical
      Approach), plus the dead columns from the audit (`households.notes`,
      `household_members.is_primary_contact`, `scouts.auth_user_id`, `scouts.last_activity`,
      `scouts.joined_date`, `*.address_line2` on all three, `leaders.scout_id` after its two readers
      move to the person_id join).
- [ ] `leaders.name` vs `people.display_name` (3 disagreements: Dan/Daniel, Mike/Michael ×2) —
      decision recorded: `people.first_name/last_name/display_name` is the name; `leaders.name`
      stays only as the login label (or is dropped if `authorized-adults` can use `people`).
- [ ] The Scoutbook export and the roster CSV import (`roster-import`) map to `people.*` for the
      moved fields.
- [ ] `Tests/CLAUDE.md` and `next-app/AGENTS.md` record the rule: contact/demographic facts live
      on `people` only.
- [ ] Deploy order: resync migration (DB-first, additive) → code that reads/writes `people` →
      drop migration (code-first for the tightening) — three pushes, each gated.

## Test Plan

- [ ] `ScoutForm_ReadsContactFields_FromPeople()` — db: person with email X, scouts row with stale
      email Y → the form's row model shows X.
- [ ] `UpdateScout_WritesContactFields_ToPeople_NotScouts()` — source-property on the action +
      db: after save, `people.primary_email` changed, `scouts` has no such column.
- [ ] `Households_BuildsAdultsAndScouts_FromPeopleContact()` — existing households tests extended.
- [ ] `RosterPrint_UsesPeople_Only()` — the fallback to `leaders.*` removed; existing
      `roster-print-adult-source.test.ts` tightened.
- [ ] `ResyncMigration_CopiesScoutContactOntoPeople_WhereTheyDisagree()` — db: run the migration's
      SQL body against fixtures.
- [ ] `NoCodeReadsTheDroppedColumns()` — source-property grep across `src/` for each dropped column
      name qualified by table (`from('scouts')…select(...email…)` etc.).
- [ ] Existing suite green (1450+), design-system census untouched.

## Technical Approach

- **Columns to move → drop.** `scouts`: address_line1, address_line2, city, state, zip, phone,
  email, health_form_date, birthdate, gender, bsa_member_id, things_we_should_know. Keep on
  `scouts`: id, names (business key + display), patrol, current_rank, active, inactive_reason,
  school, graduation_year, swim_class, household_id (or drop in favour of household_members —
  audit says 0 disagreements; decide), person_id, junior_leader_override. `leaders`: address*,
  phone, email, health_form_date, birthdate, bsa_member_id, ypt_completed, things_we_should_know.
  Keep: code, role, is_person, can_login, login_name, person_id (`name` dropped — derived from `people.display_name`; non-person org codes like "Troop 118" keep their label in `login_name`/`code` — verify before dropping).
- **`people` gains nothing** — it already has every moved column (`gender`, `ypt_completed`,
  `health_form_date`, `things_we_should_know`, `bsa_member_id` all exist).
- **Scout form**: the row model (`ScoutRow` in scouts-table) joins `people` by `person_id`;
  `readDemoFields` writes go to `people` via `person-actions.updatePersonDemographics` (already
  exists for adults) — one demographics writer for everyone.
- **Non-person leaders** (`is_person=false`, 11 org codes like "Troop 118") have no `people` row
  and no contact fields — nothing to move.
- **Import** (`roster-import`, `spreadsheet-import`): map the sheet's per-scout contact columns to
  the scout's `people` row; the sheet's parent email → the parent's `people` row (never the
  scout's — the 2026-08-26 cleanup was undoing exactly this).
- Tech-lead review of the reader list before code; qa-lead on the drop migration.

## Implementation Steps

1. Reader inventory (grep, confirm the audit's list; ~½ hour) → tech-lead sign-off.
2. Resync migration `people ← scouts` (+ counts) — ship alone, DB-first.
3. Scout form + `updateScout`/`createScout` onto `people` (delete `person-mirror.ts`); tests.
4. Move every reader to `people.*` (households, print, authorized-adults, signin-roster, audits
   checks, exports, signup party loaders); tests.
5. Import mapping.
6. Drop migration (dupes + dead columns + `leaders.scout_id`); `NoCodeReadsTheDroppedColumns` test;
   Supabase types regenerated.
7. AGENTS.md / Tests/CLAUDE.md rule; changelog; end-session decision D-xxx.

## Open Questions

- [x] `scouts.household_id` — **drop**; `household_members` is the spine join (scouts AND adults, movable). Patrick 2026-08-26. Repoint its 3 readers first: `lookups/household-actions.ts` delete guard, `rosters/[id]/roster-view.tsx`, `admin/snapshot/[id]/snapshot-document.tsx` fallback.
- [x] `leaders.name` — **derive from `people`** (`display_name`; `authorized-adults` builds its login labels from the person). Patrick 2026-08-26. `leaders.name` joins the drop list; the 3 name disagreements (Dan/Daniel, Mike/Michael ×2) resolve to `people` automatically.
- [x] Multiple emails per person — **in this plan**, as Phase 2 (Patrick, 2026-08-26).

## Phase 2 — Multiple emails per person

**Why now:** once `people` is the only home for contact details, a `person_emails` table has one
parent, and the legacy `scout_parent_emails` (keyed to the *scout*, holding the *parent's*
address — the shape that caused the 2026-08-26 mess) can be retired in the same drop migration.

**Model**
- New table `person_emails`: `id`, `person_id → people`, `email` (unique per person,
  case-insensitive), `label` ('home' | 'work' | 'other'), `is_primary` (exactly one per person —
  partial unique index), `verified_at` (set when this address completes a sign-in), `bounced_at`,
  `unsubscribed_at`, `created_at`. RLS zero-policy like the other spine tables (D-051).
- `people.primary_email` stays as a **denormalized cache** of the primary row, maintained by a
  trigger on `person_emails` — every existing reader keeps working unchanged; nothing reads
  `person_emails` directly except the editors, sign-in delivery, and the Bugle recipient list.
- Backfill: one `person_emails` row per non-null `people.primary_email` (primary); then
  `scout_parent_emails` rows re-homed onto the **parent's** person (match by lower(email) to an
  adult in the scout's household; unmatched rows go to a review list, never onto the scout);
  `scout_parent_emails` dropped.

**Behaviour**
- Sign-in: the code goes to the person's **primary** address; if a person has 2+ deliverable
  addresses the code screen offers "Send to a different address" listing the others masked. The
  name picker shows the primary masked (unchanged).
- `/profile`: a verified adult can add an address, set primary, remove one (never the last), and
  sees bounced/unsubscribed flags. Roster adult editor: same controls for leaders.
- Recipients (Bugle, confirmation emails, reminders): every non-bounced, non-unsubscribed address
  of every adult in the household (`lib/email-recipients`), de-duplicated across people.
- A scout's addresses are the scout's own; a parent's never appears on the scout row.

**Acceptance criteria**
- [ ] `person_emails` + trigger + backfill migration; `scout_parent_emails` dropped; counts logged.
- [ ] `people.primary_email` always equals the `is_primary` row (trigger; test).
- [ ] Profile + roster editors: add / set primary / remove (not last) / flags.
- [ ] Sign-in "send to a different address" for 2+ addresses; `deliverableEmailFor` = primary.
- [ ] `recipientsForScouts` / household recipients read `person_emails` of household adults.
- [ ] Roster "Send sign-in link" picks the primary; a leader can choose another on the row.

**Tests**
- `PersonEmails_ExactlyOnePrimary_PerPerson()`, `PrimaryEmailCache_FollowsThePrimaryRow()`,
  `Backfill_RehomesParentEmails_OntoTheParentNeverTheScout()`, `Profile_CannotRemoveTheLastAddress()`,
  `SignIn_OffersOtherAddresses_WhenTwoOrMore()`, `Recipients_UnionAllHouseholdAdultAddresses_Deduped()`.

**Steps** (after Phase 1 step 6): 8. migration + trigger + backfill; 9. editors; 10. sign-in +
send-link; 11. recipients; 12. drop `scout_parent_emails`; 13. docs.

## Notes

Done same day, outside this plan: `merge_people()` now deactivates the loser (migration
20260826150000); printed roster prefers `people.*`; `person-mirror.ts` bandage (v1.106.3) keeps
scouts in step until step 3 lands. Related: D-042, D-043 (domain fields off the spine — this plan
narrows that to *scout-only* facts like patrol/school/swim, not contact details).
