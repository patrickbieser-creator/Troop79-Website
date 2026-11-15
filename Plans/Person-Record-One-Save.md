# Person Record — One Form, One Save

**Status:** Ready to build
**Created:** 2026-11-15
**Priority:** High
**Spec:** Claude Design canvas "Roster person page" — https://claude.ai/artifact/BpEA89e8uhPJFUt9jNxfL6
(artboards *A · One form, one Save* for an adult, *A · Scout, with unsaved changes* for a scout; the two
orange developer notes on that canvas are copied into this plan below.)
**Supersedes:** the per-section Edit + "Takes effect immediately" model from `Person-Editor-Rethink.md`
(Direction A, built 2026-09-07) and its AGENTS.md amendment.

## Overview

Rebuild `/admin/advancement/roster/[personId]` as one numbered form with one dirty-gated Save, a sticky
record bar, a "To finish" checklist and a short Recent changes list. Everything a leader can change on
the page, including emails, household, relationships and roles, joins the same draft and commits in
one Save. Two data changes ride along: schools become a lookup table, and family links are built across
every related record, not just the one being edited.

## Problem / Opportunity

Patrick, 2026-11-15, looking at Adrian Baquero's record: "It's broken into too many pieces and too many
buttons and creates confusion."

What the current page does wrong:

- **The same fact shows three or four times.** Household: fact strip, side card, Household & family
  section. Status: header pill and Status card. YPT / health form: fact strip and Details. History:
  fact card and section. Email: header, Contact, Sign-in side card. "Where they appear" repeats the tab.
- **Two save models on one screen.** Per-section Edit → Save sits beside "Takes effect immediately"
  blocks for emails, relationships and roles, sometimes inside the same card. Seven "How this works"
  disclosures exist mostly to explain that split.
- **About 25 equal-weight controls** (7 Edit, 5 Remove, Add, Grant, Show, Add relationship…) and
  nothing says what is actually left to do on the record.
- **It breaks the design system's own rules:** one sticky record bar with one primary (rule 4),
  long forms as numbered FormSections (rule 6), "How this works" as the last resort (rule 7).
- **Schools are free text,** so the same school is spelled several ways.
- **Family links are one-sided.** Linking an adult to one scout does not link them to the household's
  other scouts, and edits from the adult's side do not reliably update the scouts' records.

## Acceptance Criteria

### Layout

- [ ] Header: back link (to the tab the leader came from), name, kind + status badges (+ rank badge for
      scouts, linking to Advancement), one line of contact facts (primary email · phone · BSA id ·
      "Parent of …" / "Signs in through …"). No fact strip.
- [ ] Sticky record bar under the header: **Saved / Save changes**, **Discard changes**, then a status
      line, then **Send sign-in link** (adults with an address) and **More actions ▾** on the right.
- [ ] Clean: status line reads "Last change Nov 15, 2026 by Patrick Bieser · History (5)".
- [ ] Dirty: status line names the changed fields ("2 unsaved changes: Patrol, Swim class"); changed
      fields get the navy outline; knock-on effects are spelled out before Save
      ("Saving will also link Jenna Scarpace as parent of Hadley Baquero.").
- [ ] Main column, numbered FormSections on `admin-form-bg`, fields always editable (no per-section Edit):
  - Adult: 1 Name & membership (incl. Status segmented control) · 2 Training & health · 3 Contact &
    sign-in (incl. email list) · 4 Family · 5 Roles (incl. sign-off initials).
  - Scout: 1 Name & troop (patrol, junior leader By position/Yes/No, Status) · 2 School & health ·
    3 Contact & sign-in · 4 Family. No Roles section.
- [ ] Status Active/Inactive is a SegmentedControl inside section 1. Choosing Inactive reveals the
      reason (scouts: the fixed `INACTIVE_REASON_LABEL` list, required; adults: optional text) and
      takes effect on Save. The "now appears under …" notice still shows after Save when the tab moves.
- [ ] Family section is ONE list: household select, then every other member as a row with name, kind
      and a relationship select ("Adrian is parent" / guardian / no relationship), then "+ Person to
      household". Replaces the separate Members list and Relationships box.
- [ ] Right rail: **To finish** checklist (derived: YPT missing/expired/expiring, health form missing,
      no verified address for an adult, no BSA id, no role (optional)), each item a link that scrolls
      to and focuses its field; **Recent changes** (latest 3 + "All N changes" opening the existing
      History dialog).
- [ ] **More actions ▾** holds: Move to adults (scouts, aged out), Merge with another person…,
      Mark as test record / Unmark, a divider, Delete <name>…. Danger zone, Test record card, Status
      card, Sign-in card, Sign-off initials card and Where they appear card are removed.
- [ ] "How this works" disclosures are gone; what's needed lives in one-line field hints.
- [ ] Webelos / crossed-over: the Crossover card stays at the top of the main column for those scouts.
- [ ] Family pending update (Phase 5 of the old plan): the banner renders at the top of the
      FormSection it touches; Approve / Reject unchanged. "Added by a family" notice stays at the top.
- [ ] Phone width: rail stacks under the form, record bar wraps, grids collapse to one column.

### One Save

- [ ] Every field on the page, including emails (add / remove / make primary), household, relationships,
      roles (grant / end) and initials, is part of the draft. Nothing commits until Save.
- [ ] Discard returns every field, list and select to the last saved state.
- [ ] Save runs as ONE server action in ONE database transaction: all of it lands or none of it does.
- [ ] Blocked save follows rule 3: button stays enabled, bad fields marked in place, focus to the first,
      "Can't save yet: <reason> (+N more)" beside the button.
- [ ] Leaving the page with unsaved changes warns (beforeunload + in-app nav guard).
- [ ] Send sign-in link acts immediately (it is not an edit) but is disabled with a hint while the
      email list has unsaved changes.

### Schools

- [ ] New table `schools`: `id`, `name` (unique, case-insensitive), `short_name` (nullable), `active`,
      `created_at`. RLS: leaders read/write, families read.
- [ ] `scouts.school` (text) → `scouts.school_id` (FK `schools.id`, nullable).
- [ ] Migration: collect distinct non-empty `scouts.school` values → a review list for Patrick to merge
      near-duplicates ("Shorewood HS" / "Shorewood High School") → insert the clean list → backfill
      `school_id` → drop `scouts.school` in a later migration once verified.
- [ ] School field is a combobox: type to filter, matching text bolded, × clears, last option
      "+ Add "<typed>" as a new school" opens a small dialog for the full name, inserts the row and
      selects it. Leaders only. Exact case-insensitive match never offers Add.
- [ ] Lookups & Admin gets a **Schools** list: rename, merge (repoints scouts), hide (`active = false`).
      A school in use can't be deleted.
- [ ] Every other place a school is entered uses the same combobox, in this plan (Patrick, 2026-11-15:
      "Add the school pick list now"): family sign-up, the family /profile editor (families pick from
      the list; their "+ Add" goes into the change request for a leader to approve, it does not insert
      the school directly), pending-update review, scout create form.
- [ ] Grade stays derived from `graduation_year`. No change.

### Family links built everywhere

- [ ] A relationship is stored once in `relationships` and shown from both sides: Adrian's page says
      "parent of Hadley", Hadley's says "Adrian is parent". Editing either side edits the same row.
- [ ] Adding an adult to a household **as parent or guardian** links them to every scout in that
      household (`parent_of` / `guardian_of` rows for each).
- [ ] Adding a scout to a household links them to every parent / guardian already in it.
- [ ] Adding an adult with "no relationship" (grandparent, another adult) links nothing automatically.
- [ ] Scouts in the same household are linked as siblings automatically (`sibling_of`, stored both
      directions). Adding a scout to a household links them to every other scout there; removing a
      scout from the household ends those sibling rows (named in the same remove question).
- [ ] Editing from an adult's record behaves exactly as editing from a scout's: adding, changing or
      removing a relationship or household updates every linked scout's record, the scout's
      "signs in through" line and the household on both sides.
- [ ] Removing someone from a household asks whether to also end the links that came with it, naming
      the scouts affected ("Also remove Adrian as parent of Hadley Baquero?").
- [ ] One History (`audit_log`) row per person touched, each saying what changed and from whose record.

## Test Plan

Write these first; they fail until the build lands.

- [ ] `Leader_SavesEveryChangeAtOnce_WhenFieldsAcrossSectionsEdited()` — name, email add, role grant
      and household change commit in one Save; reload shows all four.
- [ ] `Leader_LosesNothing_WhenSaveFailsMidway()` — force the role insert to fail; no other change is
      written (transaction rollback).
- [ ] `Leader_SeesSaved_WhenNothingChanged()` and `…SeesSaveChangesAndCount_WhenDirty()`.
- [ ] `Leader_GetsLastSavedState_WhenDiscarding()` — including a removed email and a changed relationship.
- [ ] `Leader_MustPickReason_WhenMarkingScoutInactive()`.
- [ ] `Leader_SeesToFinishItems_WhenYptAndHealthMissing()`; items link to the right field ids.
- [ ] `Leader_FindsMergeAndDelete_InMoreActionsMenu()`; old Danger zone / Status card gone.
- [ ] `Leader_PicksExistingSchool_WhenTypingPartOfName()`.
- [ ] `Leader_AddsSchoolOnce_WhenNameMatchesCaseInsensitively()` — "shorewood high school" selects the
      existing row, no Add offered, DB unique index enforces it.
- [ ] `Migration_BackfillsSchoolId_ForEveryScoutWithSchoolText()`.
- [ ] `Leader_LinksParentToAllScouts_WhenAddingParentToHousehold()` — household with two scouts → two rows.
- [ ] `Leader_LinksScoutToAllParents_WhenAddingScoutToHousehold()`.
- [ ] `Leader_LinksNothing_WhenAddingAdultWithNoRelationship()`.
- [ ] `Leader_LinksSiblings_WhenAddingScoutToHouseholdWithScouts()` — both directions, every scout.
- [ ] `Leader_EndsSiblingLinks_WhenRemovingScoutFromHousehold()`.
- [ ] `Leader_UpdatesScoutRecord_WhenEditingRelationshipFromAdult()` — and the reverse.
- [ ] `Leader_IsAskedAboutLinks_WhenRemovingPersonFromHousehold()`.
- [ ] `History_HasOneRowPerPersonTouched_WhenLinksCascade()`.
- [ ] Existing `tests/person-record-blocks.test.tsx` rewritten for the new structure (it asserts the
      old cards and "Takes effect immediately" blocks).

## Technical Approach

- **Draft state:** one `useReducer` draft in `person-record.tsx` holding scalar fields plus the email,
  relationship, household-member and role lists as arrays with `added` / `removed` / `changed`
  markers. Dirty = draft ≠ saved snapshot; the changed-field names drive the record bar's line.
  Reuse `save-state.tsx` (SaveButton / DiscardButton / SaveProblem) for the bar.
- **Save:** new server action `savePersonRecord(personId, diff)` that validates, then calls one
  Postgres function (`save_person_record(jsonb)`, SECURITY DEFINER, leader-gated) so the whole diff is
  one transaction. It applies demographics, status, emails, household, relationships, roles and
  initials in that order and writes the audit rows. The existing single-purpose actions in
  `person-actions.ts` (`setHousehold`, `addRelationship`, `addRole`, `addPersonEmailAction`, …) stay
  for other callers but the record page stops calling them.
- **Cascade rule lives in the database function**, not the client, so every caller (record page,
  family sign-up, change-request approval, imports) gets the same links. Put it in one helper,
  `link_household_relationships(household_id)`, called after any household membership or
  parent/guardian change. It builds parent/guardian → scout rows and scout ↔ scout `sibling_of` rows.
- **Preview of knock-on effects:** a read-only server action `previewPersonRecordSave(personId, diff)`
  returns the extra links the cascade would create or end, for the "Saving will also…" line and the
  remove-from-household question. Debounce on draft change.
- **Schools:** migration + `schools` RLS; a `SchoolCombobox` component built on the workspace
  combobox pattern (×, ▾, keyboard); `addSchool(name)` server action returning the row.
- **Removed components:** `status-card.tsx`, `danger-zone.tsx` (logic moves to the More actions menu
  + its dialogs), `immediate.tsx`, `section-card.tsx` per-section edit provider, `history-card.tsx`
  fact, `test-record-section.tsx`, the side cards. `send-sign-in-link.tsx`, `history-dialog.tsx`,
  `pending-banner.tsx`, `crossover-card.tsx` stay.
- **AGENTS.md:** replace the 2026-09-07 "Per-section Edit is a valid alternative…" amendment with:
  "A record page has one draft and one Save. Lists on the record (emails, relationships, roles) are
  part of that draft. One-click actions are reserved for things that are not edits (send a link,
  open history)."

## Implementation Steps

1. **Schools data** — migration (`schools`, `scouts.school_id`, backfill script writing a
   duplicates review CSV to `scratch/`), RLS, `addSchool`, Lookups & Admin › Schools list. Ship alone.
2. **Family link cascade** — `link_household_relationships` + tests; call it from the existing
   `setHousehold` / `addRelationship` / `linkAdultToScout` / change-request approval so the rule is
   live before the UI changes. One-off backfill to build the missing links for current households,
   with a dry-run report for Patrick first.
3. **`save_person_record` function + `savePersonRecord` / `previewPersonRecordSave` actions** with the
   transaction tests.
4. **New page shell** — header, sticky record bar, rail (To finish, Recent changes), More actions
   menu with Merge / Delete / Test / Move-to-adults dialogs moved over from `danger-zone.tsx`.
5. **Sections** — adult 1–5 and scout 1–4 on the shared draft; SchoolCombobox in scout section 2,
   family sign-up, /profile editor, pending-update review and scout create form;
   Family list with relationship selects; pending banners per section; crossover card.
6. **Remove the old cards**, rewrite `person-record-blocks.test.tsx`, update the styleguide specimen
   (`styleguide/admin/person-record-specimen.tsx`), AGENTS.md amendment, changelog entry.
7. **Quality gate:** full gate (logic + migration change): lint, typecheck, full Vitest, build.

## Open Questions

- [x] Adult added to a household with no relationship — auto-link as parent? **No** (default in this
      plan; Patrick may revise). Only parent / guardian links cascade.
- [x] Emails join the one Save with everything else. **Yes** (Patrick, 2026-11-15: "Saving emails is
      with the rest is just fine").
- [x] Siblings linked automatically? **Yes, stored** (Patrick, 2026-11-15: "Siblings should absolutely be
      linked automatically").
- [x] School pick list on the family /profile editor now or later? **Now**, in this plan (Patrick,
      2026-11-15).

## Notes

- Design system: Troop 79 leader workspace tokens (`admin-*`), Open Sans, rules 3, 4, 5, 6, 7.
- Relationship model: `relationships(person_id, related_person_id, type)` read as
  "<person> is <type> <related_person>"; types `parent_of`, `guardian_of`, `sibling_of`,
  `emergency_contact_for` (`20260720100000_people_identity_spine.sql`).
- Related plans: `Person-Editor-Rethink.md` (what this replaces), `People-Identity-Model.md`,
  `Unified-Identity-And-Capabilities.md`, `Verified-Signup.md` (sign-in / verification rules unchanged).
