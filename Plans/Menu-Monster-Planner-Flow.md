# Menu Monster: the scout planner as a stepped flow

**Status:** Active — (a) SHIPPED v1.183.0 (f9d3eac), (b) SHIPPED v1.184.0 (32aabdf); (c) remains
**Opened:** 2026-10-06
**Priority:** High

## Overview

Patrick, 2026-10-05: "These editors are complex. How do the best travel agencies (with the award-winning UX)
handle booking multistep flights that include hotel and car reservations? We have a similar challenge ...
scouts planning a meal for a campout that has to take a lot into consideration. If there's too many buttons
on the screen and too much confusion, they will get frustrated and not use the tool." Jenna's MACRO pass over
the scout planner (plan / meal panel / shopping / bought / gear / share / hub / recipe editor) is below.

## Problem / Opportunity

Audit, typical saved menu (3 days, 5 meals, 4 diet dialers), on a phone; controls counted from the JSX:

| Screen | Scout decides | Controls | Breaks guideline | Severity |
|---|---|---|---|---|
| New menu | Name, place, outing, patrol, headcount, 4 diets, budget — before one meal exists | ~24 | 4 | High |
| Plan tab | Who's eating, which meals, per-meal headcount, the food | ~60 | 1 2 3 4 5 | High |
| Meal panel | Food, swap, brand, amounts, extras | ~6 closed / ~26 with a food open | 3 5 | High |
| Shopping | Packages, quantity, source, brand per line | ~28 closed, +15 per open row | 3 5 6 | Medium |
| What we bought | Only what differed from the plan | ~54 | — (the best screen) | Medium |
| Gear | A packing tick | ~32, autosaves | — | Polish |
| Share | One yes/no | 7 | a whole tab for one button | Polish |
| Hub | Which menu, or a new one | ~24 | 5 (New vs Continue compete) | Medium |
| Recipe editor | Name, fit, groups, ingredients, steps, gear | ~50 | 1 2 | Medium |

Three defects under those rows: (1) the cost rail is at the BOTTOM of the page on a phone (the right column
only sits beside the meals at ≥ 900px) — the "surprise at the end"; (2) three badges ask for something and
have no control: "No price yet" (shopping-tab ~575, meal-panel ~417) and "N not priced" (plan-tab ~525) — the
answer exists only inside a closed shopping row; (3) a meal row's 3-part people stepper wraps on a phone.

## Acceptance Criteria

- [ ] Every badge that asks for something opens the control that answers it; informational tags are plain text.
- [ ] Cost per person and "N to fix" are visible on every step on a 390px phone.
- [ ] A saved menu's "Who's eating" is one summary line with Edit; the form opens only for a new menu.
- [ ] The steps are named with a done-state and never locked.

## Test Plan

- [ ] `NoPriceYet_OpensTheAddPackageForm` (shopping-tab, plan-tab, meal-panel)
- [ ] `WhosEating_IsOneLineWithEdit_OnASavedMenu` (plan-tab)
- [ ] `CostLine_ShowsAboveMeals_OnAPhone` (plan-tab)
- [ ] `planProgress_CountsEmptyMealsAndUnpriced` (menu-view, pure)
- [ ] `StepStrip_ShowsDoneTicks_NeverLocks`, `SummaryRail_ListsThingsToFix_AsLinks` (new public components)

## Technical Approach — the flow Jenna recommends

Steps: **Who's eating → Meals → Gear → Shopping** (Patrick: gear is packed days before the shopping trip);
**What we bought** appears once the outing has passed or shopping is marked done. Shopping's top is the review.
Overview with drill-down, NOT a locked wizard (patrol members plan out of order).

| Step | Shows | Done when |
|---|---|---|
| Who's eating | One line "Fall Camporee · 8 people · 1 gluten-free · Camp ✎"; the form only for a new menu | named, headcount set |
| Meals | Day/meal list, each row its foods or "Nothing yet"; "3 meals empty" opens the first | every meal has a food |
| Shopping | Totals + budget at the top, then lines — this is the review | no unpriced foods; budget shown |
| Gear | Packing list | always reachable |

Rail on a 390px screen: a sticky one-line strip under the site header (~44px): `8 people · $3.10/person/meal
· 3 to fix ›`; its right end is the one primary — Save when dirty, "Next: Shopping ›" when clean. Tapping the
text opens a bottom sheet with headcount, diets, total, budget and the "to fix" list, each row a link to its
control. The existing MenuTabs become a scrollable step strip with ticks on the same routes; Conversions
becomes a link in the Shopping footer; Share an end-of-flow action. On a phone a meal opens as a full-height
sheet with Done (one tap in, one out).

Do NOT change: the dirty-gated SaveBar and leave guard; the meal row's food summary; the one search combobox
per meal with "Browse all" and the Undo line; the merged-by-ingredient shopping list; the Bought tab's
prefilled checklist and Enter-to-next-price; gear autosave; read-only parity, print sheets, the empty-state
sentences that name the next action.

## Guidelines (for AGENTS.md — "Multistep planning flows (2026-10-06)")

1. Name the steps, show their done-state, never lock them — scouts plan out of order; a locked step is a stalled patrol.
2. A job with more than ~8 decisions shows a one-line summary with Edit once set — a 20-control open form is what a returning scout scrolls past.
3. Keep a one-line summary rail visible on every step (headcount, cost per person, things to fix; detail in a bottom sheet) — cost at the page bottom is a surprise at the end.
4. A badge is never a dead end — one that asks for something ("No price yet", "unfinished") is a button that opens the control that answers it; a tag that only informs is plain text.
5. Defaults do the work; a question is asked only when the answer cannot be inferred — pre-fill from the outing and the scout, and show the value to change, not a question.
6. Per-item exceptions live inside the item — a meal's own headcount, a brand, a package are details of that meal or line, not controls on every row.
7. One primary per screen — Save while dirty, Next when clean; section actions quiet; the save standard otherwise holds.
8. Reversible drafts get no separate Review step — the last step's header is the review; only irreversible actions (Share, Record) name their consequence beside the button.

## Implementation Steps

(a) This week, no new components: badges → answers (shopping-tab, plan-tab, meal-panel); Who's eating
collapses to a summary + Edit on a saved menu (use-disclosure); the cost/budget line renders above Meals
below 900px; per-meal People moves into the meal panel (row shows "6 people" only when it differs); the
Shopping totals card shows Spent and Budget with Used/Leftover in a disclosure; setOuting also sets context
to Camp; patrol defaults from the scout's own patrol (check with troop79-specialist).
(b) New shared public components, with styleguide specimens in the same commit: StepStrip, SummaryRail
(strip + bottom sheet), MealSheet, pure planProgress(menu, catalog) in menu-view.ts. Hand to tech-lead: the
rail must read the unsaved Plan draft (client state) yet appear on server pages; Plan and Shopping keep two
separate drafts of one menu.
(c) Later: prefill the weekend's standard meals when an outing is picked; a finishing state (Print, Share,
"Ready to shop"); surface What we bought once the date passes; apply guidelines 2 and 6 to the recipe editor;
settle the hub's New menu vs Continue emphasis.

## Decisions (Patrick, 2026-10-06)

1. A meal may open as its own page/sheet — with clear navigation for saving, cancelling and going back.
2. **Gear before Shopping.** "Typically, gear is packed many days before shopping. The order is: menus are planned,
   gear is selected based on the menus, then shopping occurs several days later." Steps: Who's eating → Meals →
   Gear → Shopping (→ What we bought after the trip). Shopping's top is still the review.
3. Save becomes "Next: …" when clean.
4. **Never prefill headcounts** from signups — "headcounts are often highly fluid"; the data as entered by hand.
   (Diets were never going to be prefilled.)
5. Demote the Conversions tab and Share to links/actions — "ok for now".
