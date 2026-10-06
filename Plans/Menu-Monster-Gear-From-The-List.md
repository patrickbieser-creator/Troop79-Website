# Menu Monster: gear picked from the master list; gear for a meal

**Status:** Active (release 1 in progress 2026-10-05; release 2 next)
**Opened:** 2026-10-05
**Priority:** High

## Overview

Gear stops being a comma-separated free-text field. Every place a leader or scout names gear — a recipe, a
single food, the whole menu — picks from the master list (the admin Gear tab), alphabetical, searchable, with
no adding on the fly. A meal gets its own standalone gear (cleaning supplies, soap, wash basins) that belongs
to the meal, not to any food. Design: tech-lead, 2026-10-05 (GO-WITH-CHANGES); spec: Patrick, same day.

## Problem / Opportunity

Patrick, 2026-10-05: "the gear is currently tied to individual food items and recipes. It also needs an
option to stand alone completely so that it can be added to a meal or a menu. Things like cleaning supplies,
soap, wash basins are not tied to a food item but to the overall meal. Retain the option to have gear
associated with individual food items or recipes, but it also need to be more than a comma-separated list.
Gear should be picked from the master list. We do not need the option to add items on the fly. The master
list is already sufficiently large and will not grow the same way that food items will. ... one other place
on the screen for additional gear picked from a searchable list. Those lists should be sorted in alphabetical
order."

Today free typing is allowed in five places (ensureGearWith's three callers, the admin comma fields, the
scout editor's "Something else…", the Gear tab's typed box, and GEAR_SUGGESTIONS which names things not on
the list). Menu-level standalone gear already exists (`mm_menus.gear_extras`); meal-level does not.

## Acceptance Criteria

Release 1 — pick only
- [ ] Recipe and single-food gear (admin and scout editors) is chosen from the master list, A→Z, searchable; no way to type a new item.
- [ ] The server drops any gear name not on the master list (`resolveGearWith`) and the UI says what was dropped.
- [ ] Menu-level "More gear for the whole menu" uses the same picker.
- [ ] The admin Gear tab's "+ New gear" is the only way onto the list; its hint says so.
- [ ] Styleguide specimen for the admin GearPicker in the same commit.

Release 2 — gear for a meal
- [ ] Each meal on the planner has "More gear for this meal", picked from the list, saved with the plan.
- [ ] The menu's Gear tab and the printed shopping sheet roll up recipe ∪ meal ∪ menu gear, de-duplicated by master item ("most, not sum" rule stays).
- [ ] A meal with no recipes can still carry gear.

## Test Plan

- [ ] `gearPickOptions_IsAToZ_ExcludesTakenAndRetired_MatchesQuery` (gear.test.ts)
- [ ] `resolveGearWith_MapsSpelling_DropsUnknown_KeepsStoredRetired` (gear-store-db)
- [ ] `GearExtras_RejectsAnUnknownName` (gear-extras-action)
- [ ] `GearPicker_NoCreate_CountStepper_Remove` (dom, admin and public)
- [ ] Release 2: `sanitizeMenu_KeepsMealGear`, `menuGearRows_MergesRecipeMealAndMenuGear`, `MealWithNoRecipes_CarriesGear`, print sheet includes meal/menu gear.

## Technical Approach

- Storage stays `mm_recipes.equipment text[]` of master names ("Name × n"); no id switch (renames, merges and the roll-up key on `gearKey`).
- `resolveGearWith(sb, entries, stored)` replaces `ensureGearWith` in all three write paths; validation is server-side.
- Meal gear: `MenuMeal.gear?: string[]` inside the meals JSON (rides the existing `updated_at` guard; copies/deletes with the meal). Must be added to `sanitizeMenu`, the plan-tab meal literal, and normalised against the master list on save.
- Roll-up: `menuGearRows` merges the three tiers; meal gear adds a `usedBy {mealId, recipes: []}`; `menuGear()` for the print sheet re-points at `menuGearRows`.
- One searchable picker per side (admin tokens / public kit) — the firewall forbids importing across; the pure option logic lives in `gear.ts`.
- No DDL. Deploy code-only. Before release 1 deploys: audit `equipment` and `gear_extras` for names with no `mm_gear` row and fix stragglers on the Gear tab.
- Gear tab (release 2): "Used in" and the delete guard count menus too; rename rewrites meal gear with a per-menu compare-and-set that does not bump `updated_at`.

## Implementation Steps

1. Release 1: pure gear.ts → store + server guard → admin picker + styleguide → public picker (scout editor, Gear tab) → Gear tab hint → gate.
2. Audit query on production data; fix stragglers.
3. Release 2: meal JSON + sanitize → meal panel picker → roll-up + print sheet → Gear tab counts/rename → gate.

## Open Questions

- Decided 2026-10-05 (Patrick): "one other place" = a meal-level picker on the meal panel; menu-level stays on the Gear tab. Two releases.
- Scout editor: a scout's old draft with off-list gear loses it on save — show a Notice naming what was dropped (release 1).
