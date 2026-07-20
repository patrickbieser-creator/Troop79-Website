# People Identity Model

**Status:** Active
**Parked:** 2026-07-20
**Activated:** 2026-07-20
**Priority:** High

## Overview

Introduce an explicit `people` identity spine, with household membership, organizational
roles, and inter-person relationships as their own tables. Today a human's identity is
*inferred* at read time by normalizing names and emails across three unrelated tables
(`scouts`, `leaders`, `scout_parents`); this plan makes identity *declared* and enforced
by the database.

This also creates the landing zone for a 125-row roster import that cannot be loaded
into the current schema at all, and is a prerequisite for testing the family gate — the
gate must be verified against the new model, not the one being replaced.

## Problem / Opportunity

**Identity is inferred, and the inference has failed twice in one week.**

- v1.12.0 added leader/parent dedup matching on normalized name and email.
- v1.13.1 fixed it once for a name spelled two ways across siblings' records
  ("JamieLynn" / "Jamie Lynn"), and again for four adults recorded by nickname on one
  record and formal name on the other ("Dan" / "Daniel").
- Each failure listed a real person twice in the public signup picker and would have
  allowed a duplicate signup. A third failure mode is a when, not an if.

**16 of 42 leaders are also in `scout_parents`** — the same human in two tables, joined
by nothing but string comparison in `next-app/src/lib/households.ts`.

**`signup_entries` cannot express participant identity.** It carries three nullable FKs
(`scout_id`, `leader_code`, `scout_parent_id`), so no unique index can span them and the
database cannot enforce "this human signed up once." The dedup *must* live in
application code because the schema gives it nowhere else to live.

**An adult who is not a leader has no home.** `leaders` is the only table where an adult
can exist independently of a child, but 21 code paths treat membership in it as
"is a leader" — including the admin login pool (`authorized-adults.ts`), Roll Call,
the Meeting Plan teacher pool, the Roster's adult tab, and every sign-off initials
dropdown. The pending import contains ~30 adults whose only role is "parent."

**Both deferred cases are real, confirmed 2026-07-20:** the troop has adults with no
children in the program, and non-custodial guardians. Neither is representable today,
because guardianship, parentage, and household membership are currently the same fact.

## Acceptance Criteria

- [ ] One `people` row per human; no human appears twice in the signup picker under any
      name spelling
- [ ] An adult with no organizational role can exist, and appears in **no** leader-derived
      list (login pool, Roll Call, teacher pool, sign-off dropdowns, Roster adults)
- [ ] A non-custodial guardian can be recorded as guardian of a scout while belonging to
      a different household
- [ ] `signup_entries` references exactly one participant column with a real
      `UNIQUE (event_signup_id, person_id)` constraint
- [ ] The family gate picker is verified against the new model end to end
- [ ] The 125-row roster import lands via a review queue; nothing writes to live tables
      without an explicit human accept
- [ ] Every existing consumer of `scouts.id` / `leaders.code` keeps working unchanged
- [ ] `ledger_entries` (9,722 rows) is untouched

## Test Plan

First automated tests in this project. `submit_household_signup` is the highest-risk
migration target and earns real coverage before it is touched.

- [ ] `Picker_ListsPersonOnce_WhenNameSpelledTwoWaysAcrossSiblings()`
- [ ] `Picker_ListsPersonOnce_WhenKnownByNicknameOnLeaderRecord()`
- [ ] `Picker_OmitsAdult_WhenPersonHasNoOrganizationalRole()` — inverse: they appear in
      the *signup* picker but not in leader-derived lists
- [ ] `Signup_RejectsSecondEntry_WhenSamePersonAlreadyRegistered()` — DB constraint, not
      application code
- [ ] `Signup_HoldsCapacity_WhenTwoHouseholdsSubmitConcurrently()` — D-033 regression
- [ ] `Signup_PromotesFromWaitlist_WhenEntryCancelled()` — D-033 regression
- [ ] `Guardian_RetainsRelationship_WhenInDifferentHousehold()`
- [ ] `Merge_RequiresExplicitAccept_WhenEvidenceIsNameOnly()`
- [ ] `Merge_WritesNothing_WhenSuggestionPending()`

## Technical Approach

**Additive spine, not a table collapse.** `scouts`, `leaders`, and `scout_parents` keep
their shape and their primary keys. `scouts.id` ('A01') stays the business key that
9,722 ledger rows point at. `leaders.code` stays — touching it would drag in the D-019
rename-cascade machinery for no benefit.

```
people             (id, first_name, last_name, display_name, birthdate, gender,
                    primary_email, primary_phone, bsa_member_id, created_at)
household_members  (household_id, person_id, is_primary_contact)
person_roles       (person_id, role, start_date, end_date)
relationships      (person_id, related_person_id, type, is_guardian)

scouts.person_id        -> people.id   (nullable, additive)
leaders.person_id       -> people.id   (nullable, additive)
scout_parents.person_id -> people.id   (nullable, additive)
```

**Role vs. relationship is the key split.** *Role* is what someone does in the
organization — `adult_leader`, `merit_badge_counselor`, `committee_member`,
`youth_member`. *Relationship* is how someone relates to another person — `parent_of`,
`guardian_of`. **Parent is a relationship, not a role.** "Not a leader, not a counselor,
only a parent" is therefore a person with **zero role rows** and one `parent_of`
relationship. Absence of roles *is* the flag; no boolean is needed.

**Membership status is not a role either.** The import's role column mixes both
(`A`, `S`, `Inactive`, `Moved`, `Cub`). Status stays on the existing `active` /
`inactive_reason` columns; roles carry date ranges.

**`household_members` replaces derivation.** Today an adult's household is inferred
through their child (`scout_parents.scout_id` -> that scout's `household_id`), which is
why an adult with no scout cannot have one. Membership becomes an explicit row for
adults and scouts alike. Guardianship and household membership become independent, which
is what makes the non-custodial case expressible.

**`signup_entries`** collapses to `person_id NOT NULL` plus `person_kind` (scout|adult) —
the kind is still needed for D-025 pricing tiers. Legacy columns stay in place, unused,
per the D-031 precedent. This table is currently **empty (0 rows)**, so the change is
free now and expensive later — this is the single strongest argument for doing this work
before Event Signup content is entered.

**Import is staged, never auto-merged.**

```
import_batches     (id, source_label, imported_at, notes)
import_rows        (id, batch_id, line_no, raw jsonb, parsed fields)
merge_suggestions  (id, import_row_id, target_kind, target_id, confidence,
                    evidence jsonb, proposed_changes jsonb, status)
```

Confidence tiers from the 2026-07-20 analysis of the 125-row roster:

| Evidence | Rows | Treatment |
|---|---|---|
| BSA member ID | 54 | pre-checked, still reviewable |
| Email only | 20 | pre-checked, still reviewable |
| Name only | 9 | **requires explicit click** — this is the failing bug class |
| No match | 42 | create new person |

Conflicts are shown field-by-field, CSV value vs DB value, with a per-field choice.
"Newer file wins" is explicitly **not** the default — the source file is known to contain
stale values.

**Relationship free text is not parsed.** The CSV's `Relationship` column holds 56
distinct phrasings and points in two directions (adult rows say "Mom of X"; scout rows
say "Dad Patrick, Mom Jamie Lynn"). Auto-parsing it is where the next silent bug would
come from. It is surfaced verbatim in the review UI and entered by hand.

## Implementation Steps

1. **Migration: spine tables.** Create `people`, `household_members`, `person_roles`,
   `relationships`; add nullable `person_id` to `scouts`, `leaders`, `scout_parents`.
   Purely additive, zero behavior change. Apply to local dev first.
2. **Backfill.** One person per scout, per `is_person` leader, per distinct
   `scout_parents` human. Bootstrap-match on exact email only — never fuzzy. Populate
   `household_members` from existing `scouts.household_id` plus parent-derived adults.
   Seed `person_roles` for actual leaders and MB counselors; parents get none.
3. **Review the residue by hand.** ~16 known leader/parent overlaps plus whatever the
   email bootstrap cannot resolve. Small enough to eyeball.
4. **Migration: import staging + suggestions.** Tables only.
5. **Loader + matcher** for the roster CSV, producing `merge_suggestions` with evidence.
   Reuse the profiling script from 2026-07-20 as the matcher's first draft.
6. **Review UI** under Lookups & Admin (consistent with D-020 consolidation). Accept /
   reject per suggestion, per-field conflict resolution.
7. **Rewrite `households.ts`** to join on `person_id` instead of normalizing strings.
   Delete the `claimedEmails` / `claimedNames` sets entirely.
8. **Verify the family gate** end to end against the new model.
9. **`signup_entries.person_id`** — backfill (trivially empty), add NOT NULL + unique.
10. **Last, in a maintenance window:** migrate `submit_household_signup` (D-033) and
    remaining readers. Acceptance test stubs written *before* this step.
11. **qa-lead pass.** Mandatory — this is an identity and access-control change, which
    is a security mandate, not a proportionality skip.

## Open Questions

- Should `people` use a uuid or bigint PK? (bigint matches `households`; uuid matches
  `scouts.auth_user_id` and survives merges across environments.)
- Do merged-away records get soft-deleted or retained with a `merged_into_person_id`
  pointer? Retention is safer for audit but complicates every read.
- `cory.weber@scouting.org` in the import is a council contact, not a troop member —
  does the model need an `external_contact` role, or does he simply not get imported?
- Which spelling is correct: `Alfred` or `Aldred`? (DB has scout E04 as "Adi Alfred";
  the import's relationship text says "Michelle Aldred".)
- Jason Porter's record carries Michelle's email (`mkuchinsky@gmail.com`) on BSA
  13766813 — confirm before the import overwrites or preserves it.
- Summer Kimble / Summer Curtis share BSA `14522103` across two import rows and already
  exist three times in the DB (`leader:SK`, `parent:p3`, `parent:p17`). Confirm these are
  one human before merging.
- Piper Barry / Piper Kingston share BSA `13706001` with different surnames and emails —
  name change or data error?

## Out of Scope

- The "Event Registration History" sheet — substantial, deferred to its own effort.
- Per-family magic links / real auth (Event Signup Phase 4, deliberately deferred by D-027).
- Contact-point child tables for emails/phones — flat columns are adequate at this scale.
- Re-keying `scouts.id` or `leaders.code`.
- Custody/legal fields beyond the `is_guardian` flag.
- A confidence-scored MDM/merge engine — one reviewed table is sufficient for ~90 adults.
