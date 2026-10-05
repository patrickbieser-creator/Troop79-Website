# Menu Monster — a single food is one entry

**Status:** Drafted, waiting for Patrick's answers to the open questions
**Parked:** 2026-10-05
**Priority:** High

## Overview

Make a single food (Cookies, an apple, bacon) one thing to a person: one form, one name, one place to
find it. Underneath, the two rows that exist today stay — the food in the Price book and the one-line menu
item that puts it on a menu — but the system ties them together with a stored link and keeps them in step,
so nobody creates, names or fixes them separately.

Reference for the levels and their attributes: `Plans/Menu-Monster-Hierarchy.md`.

## Problem / Opportunity

Patrick, 2026-10-05: "It has been a continuing source of confusion, and it's an abstraction that others
have had a hard time getting their head around, especially when working on the editor and having to make
two entries."

What goes wrong today:

- A single food needs two entries (a food, and a menu item around it), made on two tabs unless the leader
  happens to use the one-step "New food" form.
- Nothing stores that the two belong together. They are matched by name, so a rename covers both only while
  the names still happen to match.
- A menu item can exist with no food at all. Production had "Cookies" as an empty draft recipe (fixed by
  hand on 2026-10-05, v1.169.0).
- "Single food" is a classification worked out from the content, so it cannot be seen or set directly.

Why not truly merge the two rows into one (considered and set aside, 2026-10-05):

- A dish is not always the food. Production has "Eggs - Hard-boiled" (uses Eggs) and "Hot cider" (uses Hot
  cider mix). Eggs also goes into pancakes. One row per food allows one way of serving it.
- Saved menus list menu items by id. A merge means every reader of a menu (cost, shopping, gear, What we
  bought, the outing list, copying, sharing — about 17 files) handles two kinds of thing.
- A scout owns their recipes; foods are troop-wide. One row cannot follow both rules.
- "Retired from the menu" and "no longer bought" are different, and both are needed.

## Acceptance Criteria

- [ ] A leader adds a single food in one form and never has to make a second entry for it.
- [ ] From the Price book, a food shows whether it is on the menu by itself, and a leader can put it there
      or take it off without leaving the food.
- [ ] From Food & recipes, opening a single food shows the same information as the Price book does (it
      already shows brands and prices).
- [ ] Renaming a single food renames it everywhere, always, in one save.
- [ ] A single food cannot exist without its food, and a food can have at most one "by itself" menu item.
      The database refuses anything else.
- [ ] A one-ingredient dish with its own name ("Eggs - Hard-boiled") still works and is not forced to take
      the food's name.
- [ ] Adding a second ingredient or a diet swap to a single food turns it into a recipe, says so, and
      leaves the food in the Price book.
- [ ] Every saved menu opens and costs out exactly as before. Nothing that reads a menu changes.
- [ ] The eight existing single foods whose names match their food are linked; the two dishes are not.

## Test Plan

Database (`tests/menu-monster-food-link-db.test.ts`):

- [ ] `FoodLink_IsRefused_WhenTheMenuItemHasTwoIngredientLines()` — the link needs exactly one line.
- [ ] `FoodLink_IsRefused_WhenTheLineIsADifferentFood()` — the line must be the linked food.
- [ ] `FoodLink_IsRefused_ForASecondMenuItemOfTheSameFood()` — one "by itself" item per food.
- [ ] `RenamingTheFood_RenamesItsLinkedMenuItem()` — one write, both names.
- [ ] `RenamingAnUnlinkedDish_LeavesTheFoodAlone()` — "Eggs - Hard-boiled" stays its own name.
- [ ] `RetiringTheFood_TakesItsLinkedMenuItemOffTheMenu()`.
- [ ] `RetiringTheMenuItem_LeavesTheFoodInThePriceBook()`.
- [ ] `Backfill_LinksOnlyMenuItemsWhoseNameMatchesTheirOneFood()` — eight linked, two left alone, none by a scout.

Actions (`tests/menu-monster-food-actions-db.test.ts`):

- [ ] `Leader_PutsAFoodOnTheMenuByItself_FromThePriceBook()` — creates the linked item with amount and meals.
- [ ] `Leader_TakesAFoodOffTheMenu_AndTheFoodStays()`.
- [ ] `Leader_AddsASecondIngredient_AndTheLinkIsCleared()` — it becomes a recipe; the food is untouched.
- [ ] `Leader_CreatesAFoodInOneForm_AndTheTwoRowsAreLinked()` — the existing New food form.
- [ ] `Leader_MakesARecipeASingleFood_AndItIsLinked_WhenTheNamesMatch()` — the v1.169.0 button.
- [ ] `SavedMenu_CostsTheSame_BeforeAndAfterTheLinkIsAdded()` — a real menu fixture, priced twice.

Screens (`tests/menu-monster-price-book.test.tsx`, `tests/menu-monster-recipe-builder.test.tsx`):

- [ ] `Leader_SeesOnTheMenuByItself_OnAFoodInThePriceBook()`.
- [ ] `Leader_SetsHowManyEachAndWhichMeals_WithoutLeavingTheFood()`.
- [ ] `Leader_RenamesASingleFood_AndIsNotAskedTwice()`.
- [ ] `Leader_IsTold_WhenASingleFoodBecomesARecipe()`.
- [ ] `FoodAndRecipesList_ShowsASingleFoodOnce()`.

## Technical Approach

**The link.** `mm_recipes.food_ingredient_id` (nullable, references `mm_ingredients`). Set = "this menu
item is that food, served by itself". A unique index allows one per food.

**The database enforces it.** A menu item with the link set must have exactly one ingredient line, on that
food, and no diet-swap lines. Checked where recipes are written (`mm_save_recipe`) and by a constraint
trigger, so no code path can leave a linked item without its food. Renaming the food updates the linked
item's name in the same statement (trigger). Retiring the food retires the linked item.

**What does not change.** The engine, the menu's stored shape, the shopping list, gear, What we bought, the
outing list, scout recipes, sharing. A menu still holds menu-item ids and the engine still reads ingredient
lines.

**"Single food" stays worked out from content** (one line, no swap) for which form opens. The link governs
only naming, the one-entry flow, and what the Price book shows. So a one-line dish with its own name is
still edited in the short form but is not tied to the food's name.

**Screens.**

- Price book, on a food: a section "On the menu by itself" — off, with a "Put it on the menu" button; or
  on, showing how many each, which meals, food groups, draft or published, and a link to steps, gear and
  diets. It writes the linked menu item.
- Food & recipes, short form: the Name field renames both, always. A notice appears when an edit would make
  it a recipe.
- New food form and "Make it a single food": write the link.
- Food & recipes list: unchanged in layout; a single food appears once, as now.

**Backfill.** Link a menu item when it has one line, no swap lines, no scout author, and its name equals its
food's name (ignoring case). In production today: eight. The migration reports what it linked and what it
left.

## Implementation Steps

Three releases, each shippable on its own.

1. **R1 — the link, invisible.** Migration: column, unique index, the trigger rules, name sync, retire
   rule, backfill. `mm_save_recipe` accepts and checks the link. New food form and "Make it a single food"
   write it. No screen changes. Database-first (additive).
2. **R2 — the Price book shows it.** "On the menu by itself" section on a food; put on, take off, edit how
   many each and meals. Styleguide specimen in the same commit.
3. **R3 — Food & recipes tidy-up.** Rename covers both always (remove the "while the names still match"
   rule); the becomes-a-recipe notice; clear the link when a second ingredient or a swap is saved; the hint
   link between the two tabs reworded.
4. Before R1: tech-lead review of the trigger design against `Agents/Architect/Memory/` and troop79-specialist
   on the scout paths; qa-lead before each deploy. Confirm how a scout's typed-in food reaches a menu
   (`mm_submit_ingredient`) and that it is unaffected.
5. After R3: update `Plans/Menu-Monster-Hierarchy.md` (level 4's "differs from the outline" note) and close
   its open decision.

## Open Questions

- [ ] **Dishes keep their own name.** "Eggs - Hard-boiled" and "Hot cider" stay one-ingredient recipes, not
      linked to the food. Recommended: yes.
- [ ] **Retiring a food takes it off the menu too.** Recommended: yes, and the confirmation says so.
- [ ] **A new food in the Price book is not on the menu by itself unless asked.** Salt and flour should not
      appear as menu choices. Recommended: off by default in the Price book, on by default in the New food
      form under Food & recipes (as today).
- [ ] **Taking a food off the menu:** retire the menu item (it can be restored), or delete it? Recommended:
      retire, because saved menus may still use it.

## Notes

- Production on 2026-10-05: 34 menu items, 10 single foods (8 with steps or gear, 2 named differently from
  their food), 70 foods (4 used by no menu item), 2 saved menus, no scout recipes.
- Related, already shipped the same day: v1.165.0 conversions remembered from a package; v1.167.0–v1.168.0
  Price book as one list, opening under its row; v1.169.0 "Make it a single food" and the Cookies repair.
- Next after this plan: leaders get full edit rights on scout menus (Patrick, 2026-10-05). Separate plan.
- Patrick's standing preference is one source of truth over layered copies. This plan keeps two rows on
  purpose; the link, the trigger and the name sync are what stop them being two sources of truth.
