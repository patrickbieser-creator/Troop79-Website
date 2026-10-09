# Menu Monster — Receipt Reconciliation (planned vs bought)

**Status:** Active
**Started:** 2026-10-08
**Priority:** High

## Overview

A store receipt becomes data (`mm_receipts` + `mm_receipt_lines`), each line arrives with a proposed match
to the menu's shopping list, and a new step in the menu's tab set — **Receipt** ("Planned vs bought") —
lets the scouts confirm the lines one at a time, place the add-ons on a meal, and then see every meal in
two shapes side by side: **as planned** and **as bought**, with the cost per meal and per person and the
difference. Confirmed lines write into the existing "What we bought" model (`mm_menus.bought`), so the
Bought tab, the leaders' Purchases page and the price book stay the single record of what was paid.

Patrick, 2026-10-08: "take much of the drudgery and error-prone data entry out of their workflow, but leave
enough for the scouts to do to help them build awareness of pricing and shopping … learning what do meals
actually cost, and the effects of purchasing high priced items." Cooking merit badge: plan a budget, shop,
compare the actual cost with the plan.

First receipt: Aldi store #40, 10/08/26 7:03 PM, 93 items, $280.26 against a $368.43 plan for the High
Cliff Meal Plan (menu `f5daf829-8f48-4dba-a7c6-2022d3091f77`, Mindy S., 18 people). Transcribed to
`next-app/scripts/receipts/2026-10-08-aldi-high-cliff.json` (identical lines coalesced into a quantity; sum
checks to the printed subtotal and tax).

## Problem / Opportunity

- Today a scout retypes a receipt into the Bought tab row by row, and anything not on the list has nowhere
  to go (green beans, morsels, sunflower kernels): the receipt total can never reconcile.
- Substitutions (Aldi house brands for named brands) are the lesson, and today they vanish into "a
  different price".
- There is no view that puts a meal's plan next to what was actually bought for it.

## Acceptance Criteria

- [ ] A receipt and its lines are stored as printed (store code, name, unit price, quantity, tax code),
      with a proposed ingredient per line where one can be inferred, and `pending` until a scout confirms.
- [ ] The High Cliff receipt is imported into production with proposals; the import is a reusable script
      that takes a JSON file (`npm run import-receipt -- <file>`).
- [ ] The menu tab set shows **Receipt** whenever the menu has a receipt, to everyone who can open the menu;
      confirming needs `canRecord` (the same people who record What we bought).
- [ ] A scout works the lines one at a time: Confirm (writes the item onto the ingredient's bought line),
      pick a different food, or **Not on the plan** → choose the meal it joined (and a name, prefilled from
      the receipt). Done lines show who confirmed; a line can be reopened.
- [ ] The same page shows every meal twice, **As planned** and **As bought**: foods, the substitutions and
      quantities that differed, add-ons placed on that meal, planned lines not bought; the cost per meal and
      per person for each shape and the difference; a totals row for the menu against the receipt total.
- [ ] Quality gate: lint 0, typecheck, full suite, build; browser-checked; changelog per release.

## Test Plan

- [ ] `ReceiptImport_CoalescesIdenticalLines_AndSumsToTheSubtotal()`
- [ ] `Matcher_ProposesThePlannedIngredient_ForAnAbbreviatedAldiName()` (FC OJ No Pulp → Juice - Orange,
      Mrshmllw → nothing, Kraft American Chz → Cheese - Slices)
- [ ] `Matcher_LeavesALineUnidentified_BelowTheThreshold()`
- [ ] `Scout_CanConfirmALine_AndItLandsOnTheBoughtLine()`
- [ ] `Scout_CanPlaceAnExtra_OnAMeal()`
- [ ] `Reconcile_SplitsASharedLinesSpend_ByEachMealsShare()`
- [ ] `Reconcile_CountsAnExtra_OnlyOnItsMeal()`
- [ ] `Reconcile_ListsAPlannedLine_NotBought_UnderAsBought()`
- [ ] `TheReceiptStep_ShowsForEveryone_WhenAReceiptExists()`
- [ ] `TheReceiptStep_LetsOnlyRecorders_Confirm()`

## Technical Approach

- **Tables** (migration `20261030100000_mm_receipts.sql`, RLS on, zero policies, service-role only, per
  D-051/D-239): `mm_receipts(id uuid, menu_id → mm_menus cascade, store, bought_at, subtotal, tax, total,
  item_count, source photo|manual, note, created_by_person_id, created_at)`;
  `mm_receipt_lines(id identity, receipt_id cascade, position, raw_name, store_code, unit_price, qty 1..99,
  tax_code, proposed_ingredient_id → mm_ingredients set null, status pending|confirmed|extra|skipped,
  ingredient_id → mm_ingredients set null, meal_id, label, confirmed_by, confirmed_by_person_id,
  confirmed_at, note; unique(receipt_id, position))`.
- **Matcher** `lib/menu-monster/receipt-match.ts` (pure): tokenise the printed name through an Aldi
  abbreviation table (OJ, Chz, Bfast, Trky, Mushrm, Mrshmllw, Jce, Brries, Chrries, Rstd, Pnut, Chickn,
  PepJac, Ched …), score against the menu's shopping-list ingredients first (name + words), then the whole
  catalog; a proposal needs a clear margin, otherwise the line is unidentified. Price is a tiebreak only.
- **Confirm** writes `{brandId: null, packageId: null, qty, pricePaid}` onto `bought.lines[ingredient]`
  through `setBoughtLineWith` (append to an existing bought line, replace the virtual "as planned" default on
  the first confirm). No brand or package is created from a receipt abbreviation; the receipt row keeps the
  printed name. Price-book learning from receipts is a later plan.
- **Extras** stay on the receipt line (`status = 'extra'`, `meal_id`, `label`): the compare view adds them
  to that meal's "as bought"; `boughtTotals` is unchanged (its planned-line scope) and the compare view adds
  extras on top so the menu total meets the receipt total.
- **Compare** `lib/menu-monster/reconcile.ts` (pure): per meal, planned cost from `buildMenuList` lines
  allocated by `usedBy` amount share; bought cost = the ingredient's bought spend (items qty × price, or the
  planned spend while unconfirmed) allocated by the same shares, plus extras on the meal; not-bought lines
  listed; per person = the meal's own headcount.
- **Route** `menus/[menuId]/receipt`; step key `receipt`, label "Receipt"; `stepConfig` adds it when the menu
  has a receipt (one cheap existence read like `shoppingDone`).

## Implementation Steps

1. v1.207.0 — migration, `receipt-match.ts`, `receipt-store.ts`, `reconcile.ts`, import script + JSON,
   tests; push DB-first; import to production.
2. v1.208.0 — the Receipt step: header, lines to confirm one at a time, extras → meal, step strip, actions.
3. v1.209.0 — the As planned | As bought meal view, totals, compare prompts; browser check with the scouts'
   view.

## Open Questions

- "Gluten Free Mix" ×6 (one item code): the liveGfree pancake mix or the chocolate cake mix? Left
  unidentified for the scouts to settle from the bags.
- Should an extra be able to name a catalog ingredient (so the price book learns it)? Not in v1.
- Compare prompts: static questions first; a per-meal reflection note the scouts write is a candidate
  follow-up.
