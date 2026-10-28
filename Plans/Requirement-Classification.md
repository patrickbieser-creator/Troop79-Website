# Requirement Classification

**Status:** Ready (all open questions answered 2026-10-28)
**Parked:** 2026-10-28
**Priority:** High (feeds Build a Plan → Suggestions)

## Overview

A **Requirement classes** lookup on Admin › Lookups. It holds eight one-letter classes: **M** Troop meeting,
**C** Campout, **O** Outdoor event, **A** Aquatics, **S** Service project, **H** Home / independent,
**E** Expert / external visit, and **L** Leadership / administrative. A class is a tag that says where a
requirement can be done. A requirement may carry any number of tags, or none; there is no rule about how many or
which one wins. Each kind of gathering holds some classes: a troop meeting holds M today, and a campout
will hold more later. Suggestions lists a requirement when it shares at least one tag with the gathering being
planned. The tags only shape what Suggestions offers. Grouping, focus sets and adding a requirement by hand stay
completely free.

## Problem / Opportunity

Two mechanisms decide "can this happen at a meeting?" today. Both are coarse, and neither can be edited:

1. **`venue`** on both requirement tables (`meeting | outing | either`, migration `20260711000000`). Only rank
   requirements and a targeted pass over the Eagle-required merit badges were curated. Every other merit badge
   requirement is `either`, so Suggestions offers merit badge requirements that need a lake, a hike, a city council
   visit or 30 days of tracking.
2. **`NOT_PLANNABLE`**, a hard-coded set in `lib/rank-calculus.ts` that covers tenure, Scout spirit, positions of
   responsibility, the merit badge counts and the Eagle project. A leader can't see it or change it.

`venue` also lumps every reason for "outing" together. So "Needs a campout" (`build-plan-suggest.ts`) shows a swim
test, a 5-mile hike and a service project under one heading. And there is no way to say which requirements a
campout or a day hike could hold.

## Acceptance Criteria

- [ ] A **Requirement classes** card on Admin › Lookups lists the eight seeded classes with code, name and
      description, and has Add, Edit and Retire. A class that requirements use can't be deleted; it can only be
      retired. An unused class can be deleted, after a confirm that names it.
- [ ] Every rank requirement and every merit badge requirement can carry any number of class tags, or none. A child
      requirement with no tags of its own takes its parent's tags. A requirement with no tags after that behaves as
      **M**, which matches today's `either`. The classifying screen counts the untagged ones so they can be found.
- [ ] Admin › Lookups › Req codes has a Classes column that can be edited on each row (letter chips that toggle
      on and off), the same way Teach minutes is edited today, and a filter for class (including Untagged).
- [ ] Suggestions for a troop meeting lists a requirement when it shares at least one tag with the meeting (its own
      tags, else its parent's, else M). A requirement tagged only with A, O, C, S, H, E or L never appears in Group
      Sessions, By Scout or Teaching. One tagged M and E does appear.
- [ ] The tags never block a leader: + Requirement, focus sets and manual grouping still accept any requirement.
- [ ] The "Needs a campout" footer becomes **Needs another setting**, grouped by tag: Campout, Outdoor event,
      Aquatics, Service project, Expert visit, Home. A requirement with two of those tags shows under both. L items
      stay out of it, as `NOT_PLANNABLE` items are today.
- [ ] `venue` and `NOT_PLANNABLE` are retired. Their meaning moves into class data, so no requirement's suggestion
      behaviour changes on the day of the switch.
- [ ] Which classes a gathering holds lives in one place, so planning for a campout or another event later is data or one line of code, not
      engine work.

## Test Plan

- [ ] `Admin_CanAddEditRetireARequirementClass()`
- [ ] `Admin_CannotDeleteAClass_WhileARequirementUsesIt()`. The refusal names how many requirements use it.
- [ ] `Admin_CanDeleteAnUnusedClass()`
- [ ] `NonLeader_CannotChangeClasses_OrClassifyRequirements()`: server-side capability check.
- [ ] `Requirement_InheritsItsParentsTags_WhenItHasNone()`
- [ ] `Requirement_Untagged_BehavesAsTroopMeeting()`
- [ ] `Suggest_LeavesOutAMeritBadgeRequirement_TaggedOnlyAquatics()`
- [ ] `Suggest_ListsARequirement_TaggedMeetingAndExpert()`: one shared tag is enough.
- [ ] `Leader_CanAddAnyRequirementByHand_WhateverItsTags()`
- [ ] `Admin_CannotSaveAnUnknownOrRetiredTag_OnARequirement()`
- [ ] `Suggest_LeavesOutLeadershipItems_AsNotPlannableDidBefore()`. The parity test: every key in today's
      `NOT_PLANNABLE` is tagged L and nothing else.
- [ ] `Suggest_OutingVenueRows_MapToANonMeetingClass()`. The parity test: every row that is `venue = 'outing'` at
      migration time is non-M afterwards.
- [ ] `NeedsAnotherSetting_GroupsItemsByTag()`
- [ ] `Gathering_Campout_HoldsCampoutAndOutdoorClasses()`. The acceptance map is data-driven.
- [ ] `MeritBadgeEditorSave_KeepsEachRequirementsClass()`. `replace_merit_badge_requirements` carries the class
      through the rewrite by code, as it already does for venue and teach_minutes.
- [ ] `ScoutmasterConference_StillSuggestedAt95Percent()`: tagged M, with the 95% gate kept in code.

## Technical Approach

- **Lookup table** `requirement_classes`:
  - Columns: `code char(1) primary key`, `name`, `description`, `sort_order`, `retired_at timestamptz`.
  - Seeded with the eight classes above.
  - The code can't be changed once created. Keeping it fixed makes the foreign keys and saved filters safe; the name
    and description can be edited freely.
  - RLS on, readable by service role only, like every other table (see the Supabase security posture).
- **Column** `class_codes char(1)[] not null default '{}'` on `rank_requirements` and `merit_badge_requirements`:
  - An empty list means "inherit from the parent", and an empty list all the way up means M.
  - A trigger refuses a code that isn't in `requirement_classes`. Codes can't be renamed, so an array is safe without
    a join table, and the "in use" count for delete is `where code = any(class_codes)`.
  - The effective tags are resolved in one pure helper, `lib/requirement-class.ts` → `effectiveClasses(tree, node)`,
    which the engine, the board supply and the Req codes table all share.
- **No rules about tags** (Patrick, 2026-10-28): any number, in any combination, no "most limiting" convention and no
  precedence. The only logic is "shares at least one tag with the gathering".
- **What each gathering holds**:
  - `GATHERING_HOLDS: Record<'meeting' | 'campout' | …, ReadonlySet<ClassCode>>` in `lib/requirement-class.ts`.
  - Meeting = {M}. Campout = {M, C, O}. A, S and E stay off the campout list until a campout says it has water or a
    visitor.
  - A requirement shows when its effective tags and the gathering's set overlap.
  - This starts as a constant because there is exactly one gathering kind to plan today. It becomes a column or a
    table only when campout planning gives a leader something to choose.
- **Migration in two phases**, deployed DB first, as the worktree-builds recipe describes:
  1. **Additive.** Create the table, seed it, add the columns, and backfill:
     - `venue = 'outing'` rows get C, O, A or S (one or more), mapped by hand from the curation comments in `20260711000000`
       (tenting and cooking are C; the hike, orienteering and geocaching are O; the swim test, rescues and
       watercraft are A; service hours are S).
     - The `NOT_PLANNABLE` keys get L.
     - Everything else stays empty, which reads as M.
     - `replace_merit_badge_requirements` is updated to carry `class_codes` through a rewrite.
  2. **Code switch, then drop.** The engine reads the class, and `NOT_PLANNABLE` and `venue` reads are removed. A
     later migration drops `venue` once nothing reads it.
- **Classifying merit badges at scale**:
  - About 140 badges with thousands of rows can't be classified one row at a time.
  - Claude drafts a first pass from `requirement_official_text` into a review CSV (badge, code, text, proposed
    tags, one-line reason). Patrick reviews and corrects it, and the approved file is seeded by migration.
  - The Eagle-required badges come first, then the badges the troop actually works on (from the ledger), then the
    rest.
- **Admin UI**: the Requirement classes card uses the existing `use-lookup-table` / `name-lookup-editor` pattern
  (Add, Edit, Delete-or-Retire, dirty-gated Save). The tag chips live in `req-codes-table.tsx` beside Teach
  minutes.

## Implementation Steps

1. Answer the Open Questions.
2. Migration A (additive): table, seed, columns, backfill from `venue` and `NOT_PLANNABLE`, function update. Write
   the parity tests first.
3. `lib/requirement-class.ts`: `effectiveClasses`, `GATHERING_HOLDS` and the unit tests.
4. Admin: the Requirement classes card with CRUD and retire, and the Class column and filter on Req codes.
   Styleguide in the same commit if a new pattern appears.
5. Engine switch: `rank-calculus`, `meeting-suggest/engine` and `meeting-board-supply` read the effective class.
   "Needs a campout" becomes "Needs another setting" grouped by class.
6. Merit badge first pass: Claude draft → Patrick's review → seed migration, in batches (Eagle-required first).
7. Migration B: drop `venue` and delete `NOT_PLANNABLE`.
8. Changelog, plus a BRAND or Help note for the Lookups card.

## Open Questions

- [x] **1. How many classes per requirement?** No rule (Patrick, 2026-10-28): "The purpose of the planner, focus sets,
      and suggestions is to allow groupings and class assignments to be done dynamically and flexibly." Any number
      of tags, no precedence; a requirement is suggested when one of its tags fits the gathering.
- [x] **2. Untagged = M?** Yes (Patrick, 2026-10-28).
- [x] **3. Scoutmaster conferences and boards of review.** Option (a) (Patrick, 2026-10-28): tagged M, the 95% gate
      stays in code, and L is for tenure, Scout spirit, positions of responsibility, Eagle project and badge counts.
- [x] **4. H (Home / independent) at meetings.** Under Needs another setting only, for now (Patrick, 2026-10-28).
- [x] **5. "Kambat".** Dictation for **campout** (Patrick, 2026-10-28). Already covered: Campout = {M, C, O} in
      `GATHERING_HOLDS`. Campout planning in Suggestions is a later step; nothing extra ships for it here.
- [x] **6. Who may edit classes?** The same leaders who edit Req codes and Teach minutes (Patrick, 2026-10-28).

## Notes

- Raised by Patrick on 2026-10-28 while building Build a Plan Suggestions (`Plans/Build-A-Plan.md`, archived;
  `lib/build-plan-suggest.ts`).
- Precedent for "a property on every requirement, edited at Req codes": `teach_minutes` (migration
  `20261128100000`, Plans/Matcher-Tune-Up.md T-3).
- `skills.youth_teachable` is unrelated and stays: it says who may teach, while the class says where the
  requirement can be done.
- The PostgREST 1000-row cap applies: the merit badge requirement reads already paginate with `fetchAllRows`, and the
  class column rides along with them.
