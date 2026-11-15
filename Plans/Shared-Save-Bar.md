# Shared Save Bar

**Status:** Step 1 shipped 2026-11-15 (v1.270.0); step 2 parked
**Parked:** 2026-11-15
**Priority:** High

## Overview

One sticky save bar for every admin edit screen: Save + Discard changes on the left, a status line
that always says whether there are unsaved changes, screen actions ("More actions…") on the right.
The bar also owns the leave-without-saving protection, so a screen that uses it can never lose a draft
silently.

## Problem / Opportunity

2026-11-15: Patrick reassigned scouts on Patrols, never pressed Save, and the roster "didn't update".
Patrols had a highlighted-rows draft, a pending count and a navy Save, but all of it sat at the bottom
of a 32-row table, the bulk "Assign" button was also navy (it looked like the commit), and the screen
kept its draft in its own useState, so the dirty guard never knew and leaving asked nothing.

Across the admin, ~43 screens have a Save; only 4 use a sticky bar, and ~14 keep drafts outside the
save-state hooks (no guard). AGENTS.md has required one sticky bar since 2026-10-05 (D-332); it was
never rolled out to older screens.

## Acceptance Criteria

Step 1:
- [x] `_components/edit-bar.tsx` — `EditBar`: sticky, Save + Discard, status line ("N unsaved changes —
      Save to keep them" / clean text), `right` slot, navy border while dirty.
- [x] While dirty, EditBar registers with the dirty guard (Back, sidebar, guarded tabs ask) and adds
      a `beforeunload` prompt (tab close / reload).
- [x] Patrols uses EditBar at the top; the bottom bar is gone; bulk Assign is secondary (one primary).
- [x] The person record's bar is EditBar (same look and behavior as today, own status content).
- [x] Styleguide specimen; AGENTS.md rule names EditBar.

Step 2 (later): UX sweep of the ~43 Save screens (draft vs saves-immediately), convert in batches
starting with the ~14 the guard cannot see; census test: a screen with SaveButton uses EditBar.

## Test Plan

- `EditBar_ShowsUnsavedCount_WhenDirty`
- `EditBar_ShowsCleanStatus_WhenNotDirty`
- `EditBar_PromptsOnUnload_WhenDirty` / `EditBar_DoesNotPrompt_WhenClean`
- `EditBar_RegistersWithDirtyGuard_WhenDirty`
- `PatrolScreen_ShowsPendingInTopBar_AfterAssign`
- `PatrolScreen_SaveBarIsAboveTable`
- Existing person-record bar tests still pass (region "Record actions").

## Technical Approach

EditBar renders SaveButton/DiscardButton itself; callers pass `dirty`, `pending`, `onSave`,
`onDiscard`, optional `blocked`/`onBlocked`, `changes` (count) or a full `status` node, `cleanStatus`,
and `right`. Styles move from record.module.css to `_components/edit-bar.module.css`.

## Implementation Steps

1. EditBar + tests.
2. Patrols onto it.
3. Person record onto it.
4. Specimen, AGENTS.md, changelog.

## Open Questions

None for step 1.
