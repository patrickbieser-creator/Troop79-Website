# Menu Monster — Planned By (the scouts who planned a menu)

**Status:** COMPLETE — shipped v1.202.0 (2026-10-07): mm_menu_planners (migration 20261028100000, pushed to production DB-first, verified), Planned by pull-down + chips on Who's eating beside Patrol, read-only text, merge_people repoints planners. Informational only. Patrick's production eyes-on pending.
**Parked:** 2026-10-07
**Priority:** Medium

## Overview

Patrick 2026-10-07: "On the Who's eating tab also provide list of the scouts who planned the meal. This list does not have to be linked to any further logic or rules. It is informational only. But it will be helpful later when reviewing the menu and signing off scouts on advancement to see which scouts contributed to that meal. It should take the form of picking scouts from a pulldown list from our existing roster. It can be placed in the column currently open to the right of the Patrol line in that tab."

## Decisions

1. **Informational only.** No rule reads it (no rights, no gating, no headcount effect). A later advancement review reads it.
2. **Storage: a join table `mm_menu_planners (menu_id text → mm_menus on delete cascade, person_id bigint → people on delete cascade, added_at, added_by_person_id)`**, PK (menu_id, person_id), RLS like the other mm_ tables (service-role only), and the person-merge routine that repoints `mm_menus.owner_person_id` repoints planners too. Why a table and not a jsonb array: the review use case asks "which menus did scout X plan", FKs keep merged/removed people honest, and arrays can't carry FKs. DB-first: push the migration to production before the code.
3. **Picker: a pull-down of ACTIVE scouts from the roster** (scouts.active = true → people.display_name), one pick at a time; each pick becomes a chip with a remove ×, like GearChips. Already-picked scouts leave the list. Names only — no other PII reaches the page. Sits in the open right-hand column beside the Patrol line on Who's eating. Label: "Planned by" (sentence case, no colon, no helper prose).
4. **Save path:** part of the menu's dirty-gated Save (the Who's eating form's one Save), not a one-click action — planners are a detail of the plan, so they travel with it. The server action replaces the set for the menu (delete-and-insert inside the existing save, or a small RPC) and the read-only / leader views show "Planned by Anjali, Charlie" as text.
5. **Who may edit:** whoever may edit the menu today (owner, helper, leader). A visitor's local (unsaved) menu has no roster, so the field is hidden there.

## Acceptance Criteria

- [ ] Who's eating shows "Planned by" with a pull-down of active scouts in the right column beside Patrol; picking adds a chip, × removes it; Save is dirty-gated by the change.
- [ ] A saved menu reloads with its planners; the read-only view lists them as text.
- [ ] Merging two people repoints planners to the survivor; deleting a person or a menu drops the rows.
- [ ] No rule or total changes anywhere.

## Test Plan

- [ ] dom: `WhosEating_PlannedBy_IsAPullDownOfActiveScouts()`, `WhosEating_PickingAScout_AddsAChip_AndDirtiesSave()`, `WhosEating_RemovingAChip_DirtiesSave()`, `ReadOnly_ShowsPlannedByAsText()`, `LocalMenu_HasNoPlannedBy()`
- [ ] db: `SaveMenu_ReplacesThePlannerSet()`, `MergePeople_RepointsPlanners()`, `DeleteMenu_DropsPlanners()`

## Technical Approach

Migration `2026102810000_mm_menu_planners.sql` (next free timestamp after 20261027100000). `menus-store.ts`: load planners with the menu (ids + names), save them in `saveMenuWith`. Page loader passes `scoutOptions: {personId, name}[]` to Who's eating. Client state lives in the menu draft so the existing draftKey dirty gate covers it.

## Implementation Steps

1. Migration (table, RLS, merge repoint) — push to production first.
2. Store read/write + db tests.
3. Who's eating picker + chips + read-only text + dom tests.
4. Styleguide note if a new chip/picker class is introduced (reuse GearChips' look).

## Open Questions

None.
