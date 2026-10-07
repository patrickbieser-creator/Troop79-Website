# Menu Monster — One Add Pattern Per Container

**Status:** COMPLETE — Phase 1 shipped v1.199.0 (0a2d74b), Phase 2 shipped v1.200.0 (5101b8e), both 2026-10-07. Every Menu Monster list, public and admin, ends in one quiet add row (links at rest, search on tap, Cancel in sight); every quantity is a plain number box; the admin side has its own AddRow and NumberBox twins. qa-lead reviewed both phases (PASS-WITH-WARNINGS then FAIL→fixed); all behaviour findings closed before commit. Still owed: Patrick's production eyes-on, incl. Decision 2's obviousness test for the removed hint. Follow-on, separate plan: brand detail at entry time (size / unit / price / store when a scout types a brand) — Brad's prototype 2026-10-07 in prototypes/menu-monster-add-pattern.
**Parked:** 2026-10-07 (activated the same day)
**Priority:** Medium
**Author of the exploration:** Jenna (UX), briefed from Patrick's screenshot of the Snack meal with Chips expanded

## Overview

Every list in Menu Monster ends in its own dashed "add" row. On a meal panel with a food expanded, four of them stack at three indents with nothing that says which container each one feeds. Patrick: "this pattern repeats everywhere in the menu monster. I am certain there's a better pattern… that could be a new design standard."

## Problem / Opportunity

The Snack panel as it reads today: meal header → People dialer → Hot Chocolate (collapsed) → Chips (expanded: ingredient line, "Add for [Everyone]" select, dashed "Add an ingredient" search, grey hint "Only this menu changes. The troop's Chips recipe stays the same.") → dashed "Add to snack" → dashed "More gear for this meal" → dashed "+ Add a meal".

### Inventory (from the code, 2026-10-07)

| Where | Adds | Level |
|---|---|---|
| `_components/ingredient-list-edit.tsx:452-491` ("Add for" select at 455-458) | an ingredient, optional diet scope | inside a food |
| `menus/_components/meal-panel.tsx:715-815` ("Add to {slot}") | a food, with "new food…" and "Browse all recipes…" tail | the meal |
| `menus/_components/meal-panel.tsx:821-843` (GearChips + GearPicker) | gear for this meal | the meal |
| `menus/_components/plan-tab.tsx:608-612` (AddMealMenu, `.addMealBtn` at `workspace.module.css:561`) | a meal | the day |
| `menus/_components/plan-tab.tsx:617-621` | a day | the menu |
| `menus/_components/add-diet-menu.tsx` | a diet group | Who's eating |
| `menus/_components/gear-tab.tsx:216` | gear for the whole menu | the menu |
| `_components/ingredient-list-author.tsx:182-186` | an ingredient on the recipe editor | inside a recipe |
| `_components/ingredient-browser.tsx:50-59` | an ingredient (a secondary button, the one outlier) | the troop's list |
| admin `recipe-builder.tsx:787` ("+ Add an ingredient") | an ingredient | the admin recipe |

### Diagnosis

- **Same look, different targets.** Ingredient, food, gear and meal adds all wear the dashed look; nothing says which container a row feeds.
- **Containment is invisible.** The expanded food sits in an `.inset` with no visible edge. When it ends, the meal-level "Add to snack" resumes at a different indent with no closing cue.
- **The scope select is orphaned.** "Add for" governs the search below it but renders above and outside the dashed box, defaulting to Everyone, so it reads as a separate control.
- **The hint is the only locality signal.** "Only this menu changes…" is small grey text below the add row (the kind Patrick has said gets missed; see problems-marked-in-place).
- **The ⋯ menus differ per level.** Meal ⋯ = Remove meal; food ⋯ = Swap / Back to the troop's version / Share / Remove; ingredient ⋯ = its own set. One glyph, a different verb set at each level.

## Options considered

| | Pattern | Snack after | Absorbs | Phone (390px) | Verdict |
|---|---|---|---|---|---|
| a | One "+ Add ▾" per container with a small menu (Food / Gear) | one ghost row per indent | food + gear | one tap then a menu; search inside a menu fights the keyboard | compliant; still does not name the container |
| b | Adds live only in the ⋯ menus; no ghost rows at rest | a clean list | all | cleanest | **reject** — an empty meal's first add is hidden; breaks D-332 item 3 and D-336 item 4 |
| c | The expanded food becomes a bordered sub-card | card holds ingredient line, scope, add-ingredient, footer hint; visibly closes before meal rows resume | nothing removed; fixes containment, scope, hint | ~16px padding, stays readable | compliant; low cost (one class + one wrapper); does not fix the four look-alikes |
| d | One quiet add row per list, verbs not container names | "+ Food · + Gear" after the foods; "+ Ingredient … for Everyone ▾" inside the open food | food + gear share a row; scope joins ingredient add | two links on one line need a 44px row | compliant with D-332 item 3; "Add a food to Snack" would restate the heading (no-redundant-text), so short verbs |
| e | View/edit toggle per meal | plain list at rest; Edit reveals everything | all, at rest | cleanest at rest | **reject** — an extra tap before every change on a screen that is edited most of the time; conflicts with D-336 item 6 and "obvious but not noisy"; high cost |

## Recommendation (Jenna)

Pair **(c) + (d)**: a bordered sub-card for the open food, and one grouped add row per meal.

Snack after:
1. `Snack ⌄ … $16.69 ⋯`
2. `People for this meal − 18 +`
3. `Hot Chocolate › $8.69 ⋯`
4. `Chips ⌄ $8.00 ⋯` with a bordered card beneath holding: the ingredient line `Chips · Choose a brand · 36 oz ⋯`; one quiet row `+ Ingredient` with `for Everyone ▾` at its right end (shown only when the meal has diets, as the code already does); the footer `Only this menu changes.` (the second sentence dropped as redundant)
5. After the card, one meal-level row: `+ Food  + Gear`
6. `+ Add a meal` stays at the day level, in its own visual tier, further from the panel

## Acceptance Criteria

- [ ] Every container in Menu Monster (recipe, food-on-a-menu, meal, day, menu) ends in exactly one add row at its own indent; the open food is visibly bounded.
- [ ] No add control names the container it sits under (no-redundant-text).
- [ ] The scope select travels with the add it governs.
- [ ] Rolled out to every row in the inventory above, both public and admin, with styleguide specimens in the same commit.

## Test Plan

- [ ] `Scout_SeesOneAddRow_PerContainer_OnAnOpenMeal()`
- [ ] `Scout_FindsTheScopeSelect_InsideTheIngredientAddRow()`
- [ ] `Scout_CanAddFoodAndGear_FromTheMealsOneRow()`
- [ ] `Leader_SeesTheSamePattern_OnTheAdminRecipeBuilder()`

## Technical Approach

TBD after Patrick's decisions. (c) is a wrapper + class in `meal-panel.tsx` / `workspace.module.css`; (d) replaces the food search and GearPicker ghost rows with one row whose links open them.

## Implementation Steps

1. TBD
2. TBD

## Decisions (Patrick, 2026-10-07)

1. **Scope select lives inside the `+ Ingredient` row.** Scouts don't realise they are about to violate a vegetarian, nut or gluten restriction until a food or recipe is already on the list, so the scope has to sit where the add happens.
2. **Remove the hints.** No "Only this menu changes…" line; the card edge alone says the edit is local. "If it fails the obviousness test, then we'll put them back."
3. **Normalise the ⋯ verb sets** across meal / food / ingredient in the same pass: same order (edit → swap/alternate → Share → Remove last), same words (always "Remove", "Swap for…", "Back to the troop's …"), destructive styled the same at every level.

4. **Link opens search (B).** At rest a container ends in quiet links ("+ Food  + Gear"; "+ Ingredient"); tapping one swaps the row for the dashed search. Patrick picked B from the prototype at `prototypes/menu-monster-add-pattern/index.html` (A, search always visible, rejected).
5. **An opened search has a visible Cancel** (Patrick: "Is the assumption that ESC is the only way out?"). A quiet "Cancel" link at the row's right end restores the links and returns focus to them; Esc and blur-when-empty also work. Closing is discarding, per the Save standard.
6. **"Leave out for <diet> scouts" keeps its own verb.** It is a diet-scoped omission, not removal; "Remove" is only for taking a line off. (Brad's first pass renamed it; reverted.)

7. **No "+ Ingredient" on a single food.** Patrick 2026-10-07: the add row and its scope select appear only when the food is a recipe. A single food's sub-card holds its one ingredient line (brand, ⋯ with Change amount / Swap for… / Swap for <diet> scouts… / Leave out for <diet> scouts / Back to the troop amount / Remove) and nothing else; another food goes on the meal through "+ Food". Matches `authoring.ts` isSingleFood: "a second ingredient makes it a recipe."
8. **Plain number inputs, not dialers.** Patrick: "the dialers for people and diets seem a bit too much." "People for this meal" and the diet counts become a 3-digit `type="number"` input on the row's title line (16px, min 1, clamp on blur).

9. **"Choose a brand" → "Choose brand(s)".** Patrick 2026-10-07: a scout may name several brands for one ingredient (cookies: three or four) and that must never be precluded. Label only — the model already allows it: `BrandPicks = Record<ingredientId, BrandPick[]>` (types.ts: "A menu may ask for an ingredient with any brand, or name one or several"). Production site: `meal-panel.tsx` ~364, the `verb` string. Existing fact worth keeping in mind: brand picks are per MENU per ingredient, not per line — choosing brands on Chips in Snack applies to Chips anywhere on that menu.

10. **Every quantity dialer in Menu Monster becomes a plain input** (Patrick 2026-10-07, after seeing Phase 1 live: "UX is better… Where these dialers appear through the menu for qty, change them all to simple inputs"): brand package quantities (brand-chooser), shopping-row quantity overrides (shopping-tab), gear counts (gear-picker). The shared Stepper stays for event sign-up only.

11. **Exception: the troop ingredient browser keeps its + Ingredient ABOVE the list** (it is long and searchable; the old button sat there) — a deliberate departure from D-332(3), qa-lead 2026-10-07.

## Open Questions

None.
