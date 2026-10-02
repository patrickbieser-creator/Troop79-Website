# Menu Monster — Scout Workspace (saved menus, shared menus, scout recipes and prices)

**Status:** Parked. Plan + prototypes ready for Patrick's review; nav model and open rules pending (D-287–D-289)
**Parked:** 2026-10-01
**Priority:** High
**Origin:** Patrick, 2026-10-01. Scouts work individually and save menu plans behind a scout sign-in. Leaders and parents can see the plans. Scouts upload recipes that others use, with credit. Scouts correct prices after shopping and edit menu items on the fly. Covers Second Class, First Class and the Cooking MB, for both home and troop cooking.
**Supersedes:** BACKLOG.md:31 items "saveable plans by share link (`mm_plans` + expiry)", "structured scout suggestions (new recipe / price)" and "actuals capture after shopping". Reverses D-266 ("plans … are not persisted").
**Prototypes:** `D:\Projects\Troop Menu Monster\prototypes\concept-e-scout-workspace\` (Brad)

## Decisions (Patrick, 2026-10-01)

| # | Question | Decision |
|---|---|---|
| 1 | Retention | **None for now.** Menus stay available. Cleanup and archiving go on the BACKLOG for future consideration. |
| 2 | Who sees menus in admin | **Any adult with admin access** (`requireAnyCapability()`). No new capability. Menu actions get **high-level rows in the audit log**. |
| 3 | Parents | **Parents can see** their scout's menus (household identity, read-only). |
| 4 | Patrol menus | **Individual ownership.** Exactly one scout's name is on a menu. An optional **patrol name** acknowledges the kids around the laptop. |
| 5 | Credit | **"Sam K."** (first name + last initial). Credits stay online. Archiving is a backlog item. |
| 6 | Scouts and the catalog | Scouts **update prices** after shopping and **edit menu items on the fly**. |
| 7 | Sequence | **Plan and prototypes first**, then build. |

### Proposed answers to what Patrick raised (confirm on the prototype)

- **Public shared menus: yes, with an explicit Share step.** A scout clicks **Share with the troop** to publish a menu. It then appears (a) on the Menu Monster shelf as **Recently shared menus** and (b) on the linked calendar event's page as **Menus for this outing**, which is the communication benefit Patrick described. Drafts are never public.
  - **Name rule:** the library is open to the internet. Anonymous visitors see the patrol name and the menu, with no scout name. Viewers with the troop password or a sign-in also see "Sam K." This reuses `gateAudience()`, the audience split the site already has.
- **Price updates go live immediately, with a sanity band.** After shopping, the scout enters what they actually paid on their menu's shopping list. That price is always kept on the menu. It also updates the shared price book with "updated by Sam K., Oct 4", unless it is more than ±50% away from the current price. Those prices wait in a short leader list, since they are usually typos or a different package size. Every applied change is audited, and the price book keeps a history so a leader can revert.
- **On-the-fly edits are menu-local by default.** A scout can change a recipe *inside their menu*: change an amount, swap an ingredient, leave one out, or add one. This is the same swap / leave out / add diff the leader variation editor already uses (`mm_variation_lines` ops), stored on the meal. The shared recipe is untouched. A **Share this version as a new recipe** button turns the edited version into a recipe submission.
- **Something not in the price book.** A scout can add a **package** to an existing ingredient (name, store, size, price), and it goes live like a price update. A brand-new **ingredient** (it needs units, a section and allergen flags) is a free-text line the planner prices from the scout's own entry. A leader maps it into the price book later.
- **New shared recipes still pass a leader.** A scout's recipe works in their own menus at once. It reaches the shared catalog when a leader publishes it, because ingredient flags drive allergen warnings for everyone. *(Confirm. The alternative is live immediately with a leader revert, matching the price rule.)*

### UI pattern of record (Patrick approved, 2026-10-01, D-288 / D-289)

`concept-e-scout-workspace/recipe-editor.html`, built from Patrick's Claude Design handoff, is the approved style for every scout page. `UX-BRIEF.md` (Jenna) next to it carries the style to the other pages, and all pages were rebuilt on shared `css/monster.css`, `js/monster.js` and `js/inglist.js`. The pattern:
- **Look:** a cream page with borderless white list cards and tight ~38px rows.
- **Rows:**
  - Drag-and-drop reordering; step numbers follow the drag.
  - Clicking an ingredient toggles its "What you'd buy" inset.
  - Row actions live in a ⋯ menu, and a dashed search field adds to each list.
- **Amounts:**
  - **Total to buy for the meal's headcount** is the default, so the list reads as a rough shopping list. The headcount comes from the meal, can be changed, and offers Reset to N.
  - A Total/Per person switcher sits on the Ingredients heading line, and amounts stay in a fixed right column.
- **Title line:** holds Save / Submit.

Merges:
- One recipe editor.
- One ingredient-list component, used in recipe mode and in a menu-local mode.
- One Shopping page: what to buy, then what you paid.
- The leader recipe queue lives in admin.

**Navigation is still open.** Breadcrumb, tabs and stepper are all built behind `?nav=`; Jenna recommends tabs. The back link changes with where you came from.

**Still open:**
- Should changing the headcount in the recipe editor update the menu's meal, or stay view-only (the current behavior)?

### Prototype refinements (Brad, concept-e, 2026-10-01; adopt unless Patrick objects)

- The patrol defaults only for Camp and Trail menus. A Home menu is a family meal and starts with no patrol.
- A scout-added package has no old price to compare against, so the ±50% band compares its price per recipe unit with the cheapest existing package.
- A typed-in ingredient needs a package size as well as a price, or the planner can't scale it.
- Recipe credits follow the public name rule: outsiders see "Recipe by a Troop 79 scout".
- After shopping, ask "What did you buy?" (a package pick) before the price. `actuals` stores the package id with the price paid, which settles most different-size holds before a leader sees them.

## Overview

Today Menu Monster is an anonymous, single-meal planner whose draft lives in `localStorage` (`troop79.menuMonster.plan.v1`). This plan adds a **scout workspace**. A signed-in scout owns **menus**: one or more meals for a home meal or a troop outing, optionally linked to a calendar event and tagged with a patrol. Scouts save them on the server, tag the requirements they cover, and get a coverage checklist. After shopping they record what they paid, which keeps the troop price book current. They can share a finished menu with the troop. Any admin adult and the scout's parents can read every menu. Scouts can also submit recipes, which carry a "Recipe by Sam K." credit once published.

The anonymous planner stays as it is, and signing in adds saving and sharing.

## Problem / Opportunity

- The cooking requirements are multi-meal and multi-week. A plan is made at home, shopped days later and cooked at a campout weeks after that. A single-meal draft in one browser can't carry that.
- Leaders and counselors sign off from what a scout tells them. Budget, MyPlate balance and diet adjustments go unchecked.
- Before a campout, adults and patrol members can't see what each patrol is cooking or buying.
- The price book goes stale. The scouts standing at the register know the real prices and have no way to record them.
- Scouts' own recipes have no way into the catalog.

## Requirements this serves (verify the wording in Step 0)

Codes come from `data/advancement.json`. That tree is condensed, and the Cooking MB text may lag the current BSA text.

| Requirement | Stored label | Workspace support |
|---|---|---|
| Second Class 2e | Plan & cook campout hot breakfast | Camp menu with a breakfast or lunch, plus food groups |
| First Class 2a | Meal plan & cook campout BLD | Camp menu with B + L + D, food-group readout |
| First Class 2b | Budget & buy for 10 | Headcount, budget, shopping list, **actual prices paid** |
| First Class 2c | Pots, pans, utensils | Equipment roll-up from recipes |
| Cooking 2a / 2a.3 / 2a.5 | Balanced day; 3 meals + snack; special diets | Day menu, food groups, restriction variations |
| Cooking 4a / 4b | Home menu B/L/D + snack; shopping list within budget | **Home** menu (headcount = family) |
| Cooking 5a | Camp menu for two days | Camp menu, 2 days |
| Cooking 6a | One-day trail menu | Trail menu (tag only until trail mode exists) |

## Acceptance Criteria

**Phase 1: saved menus**
- [ ] A verified scout (`requireVerifiedScoutIdentity()`, `lib/family-access.ts:238`) sees **My menus** on the shelf and can create, rename, edit, duplicate and delete menus. A menu has a name, a context (home / camp / trail), an optional calendar event, an optional patrol, and 1–N meals (day × slot). Each meal is today's `Plan`.
- [ ] The patrol is optional and comes from a pick list of current patrols (`scouts.patrol`), defaulting to the scout's own. Only the owning scout's name is stored.
- [ ] Anonymous visitors, adults and leaders keep today's planner. "Save" shows "Scouts: sign in to save your menu".
- [ ] After sign-in, an existing `localStorage` draft is offered once as "Save this draft to My menus".
- [ ] Every scout action derives the owner from the session `personId`. A scout can read and write only their own menus.
- [ ] Each save stores a priced snapshot (lines, totals, catalog `as_of`). When prices move, the menu shows "Prices have changed since you saved — Update prices".
- [ ] Audit rows (new area `menus`) cover create / rename / delete / share / unshare / review note, one line each (e.g. "Sam K. shared menu 'Fall Camporee — Eagle patrol'"). Edits to meal contents are **not** audited (too chatty). Scout actors are recorded through `recordAuditAs` with the scout's person, because `recordAudit` resolves only admin actors.

**Phase 2: on-the-fly edits + shopping actuals**
- [ ] Inside a menu, a scout can edit a meal's recipe locally (amount / swap / leave out / add). The card shows "Your version: 2 changes", and the shared recipe never changes.
- [ ] A scout can add a package to an existing ingredient, and a free-text ingredient priced from their own entry.
- [ ] After shopping, each shopping line takes **qty bought** and **price paid** (the printed sheet already has the blanks). The menu shows planned vs. actual totals.
- [ ] Price paid within ±50% of the current price updates `mm_packages.price`/`as_of`, writes an `mm_price_history` row (who, menu, old → new) and an audit row. Outside the band it waits in a leader list. A leader can revert any history row.

**Phase 3: requirements, sharing, leader + parent view**
- [ ] A scout tags a menu with requirements and sees an advisory checklist (e.g. "First Class 2a: ✓ Breakfast ✓ Lunch ✗ Dinner · 3 of 5 food groups").
- [ ] **Share with the troop / Stop sharing.** Shared menus appear on the shelf (newest first) and on the linked event page. Anonymous visitors see the patrol only, and audience-gated viewers also see "Sam K.". The read-only menu page includes the shopping list and print sheet.
- [ ] Any admin adult opens `/admin/menu-monster/menus` (filters: scout, patrol, event, requirement, shared). They get a read-only view and can leave a review note the scout sees.
- [ ] A parent signed in to the scout's household sees that scout's menus read-only.
- [ ] The scout's admin record links to their menus. Reviewing never writes the ledger; Fast Entry stays the sign-off path.

**Phase 4: scout recipes**
- [ ] A scout submits a recipe, either from scratch or from **Share this version as a new recipe**. It is usable in their own menus at once and goes to a **Submitted** filter in `/admin/library/menu-monster`. The leader publishes through `mm_save_recipe` or returns it with a reason.
- [ ] A published scout recipe shows "Recipe by Sam K." on the card and print sheet. The credit is frozen at publish time and editable by a leader.
- [ ] Recipes gain `equipment text[]`, and a menu rolls it up into "Pots, pans & utensils" (FC 2c).

**Every phase:** quality gate green (`lint`, `typecheck`, `test`, `build`), changelog block, `mm_*` tables RLS on with zero policies, no client Supabase.

## Test Plan

Test names follow the project's `{Persona}_{CanAction}_{WhenCondition}` pattern.

Phase 1
- [ ] `Scout_CanSaveMenu_WhenVerifiedScoutSession()`
- [ ] `Adult_CannotSaveMenu_WhenSessionIsAdultIdentity()`
- [ ] `Anonymous_CannotSaveMenu_WhenPasswordOnly()`
- [ ] `Scout_CannotReadOrEditMenu_WhenOwnedByAnotherScout()`
- [ ] `Menu_StoresOnlyOwnerName_WhenPatrolSet()`
- [ ] `Menu_StoresPricedSnapshot_OnEverySave()`
- [ ] `Menu_RendersFromSnapshot_WhenRecipeRetiredSinceSave()`
- [ ] `Audit_RecordsScoutActor_OnMenuCreateDeleteShare()`
- [ ] `Audit_SkipsMealContentEdits()`
- [ ] `Scout_IsOfferedDraftImport_OnceAfterSignIn()` (dom)
- [ ] `MmMenus_HasRlsEnabledWithZeroPolicies()`

Phase 2
- [ ] `LocalEdit_CompilesToLines_WithoutTouchingSharedRecipe()` (reuses `compileRecipe`)
- [ ] `PricePaid_UpdatesPriceBook_WhenWithinBand()`
- [ ] `PricePaid_HeldForLeader_WhenOutsideBand()`
- [ ] `Leader_CanRevertPriceHistoryRow()`
- [ ] `Menu_ShowsPlannedVsActualTotals()`
- [ ] `ScoutPackage_IsPricedInPlanner_AfterAdd()`

Phase 3
- [ ] `Coverage_FirstClass2a_RequiresBreakfastLunchDinner()`
- [ ] `Coverage_Cooking4a_RequiresSnackOrDessert()`
- [ ] `SharedMenu_HidesScoutName_FromAnonymousViewer()`
- [ ] `SharedMenu_ShowsScoutName_ToFamilyAudience()`
- [ ] `DraftMenu_NeverAppearsPublicly()`
- [ ] `EventPage_ListsSharedMenusLinkedToEvent()`
- [ ] `AnyAdmin_CanListAllMenus()` / `NonAdmin_CannotListMenus()`
- [ ] `Parent_CanReadOwnScoutsMenus_ButNotOthers()`

Phase 4
- [ ] `Scout_CanUseOwnSubmittedRecipe_InOwnMenu()`
- [ ] `OtherScout_CannotSeeRecipe_UntilPublished()`
- [ ] `Leader_PublishesScoutRecipe_ViaMmSaveRecipe()`
- [ ] `PublishedRecipe_ShowsFrozenCredit()`
- [ ] `Menu_RollsUpEquipmentAcrossMeals()`

## Technical Approach

### Schema (additive; D-239 posture: RLS on, zero policies, service role on the server)

```
mm_menus          id uuid pk, owner_person_id fk people, name, context (home|camp|trail),
                  event_id fk events null, patrol text null, requirement_tags text[],
                  shared_at timestamptz null, review_note, reviewed_by_person_id, reviewed_at,
                  snapshot jsonb, snapshot_as_of, created_at, updated_at
mm_menu_meals     id, menu_id fk cascade, day int, slot, position, plan jsonb,
                  recipe_edits jsonb      -- { recipeId: [ {op: swap|leave_out|add, ...} ] }, same ops as mm_variation_lines
                  actuals jsonb           -- per package: qty_bought, price_paid
mm_price_history  id, package_id fk, old_price, new_price, reported_by_person_id, menu_id, status (applied|held|reverted),
                  created_at, decided_by_person_id, decided_at
mm_packages       + added_by_person_id null (scout-added packages)
mm_recipes        (Phase 4) + author_person_id, attribution_label, submitted_at, review_note, equipment text[];
                  status widens to draft|submitted|returned|published|retired
```

- Meals stay `jsonb Plan`. `restorePlan()` already sanitizes stale ids.
- Local recipe edits reuse the variation diff ops and `compileRecipe`, so the engine still reads only lines.
- The menu-wide shopping list merges needs across meals before picking packages, so two egg meals buy one flat. That stays a pure engine function.
- Audit: add `'menus'` to `AUDIT_AREAS`. Scout-originated rows use `recordAuditAs(client, { personId, label: 'Sam K.' }, …)`.
- Backlog: add an entry for cleanup and archiving of old menus and departed scouts' credits.

## Implementation Steps

0. **Prototype (now).** Brad builds concept-e. Patrick reviews and confirms the proposed answers above. Verify requirement text against current BSA. Run a tech-lead and troop79-specialist review of the schema.
1. **Phase 1:** schema + menus lib + snapshot + audit area → My menus UI, menu grid, combined list, draft import → qa-lead → release.
2. **Phase 2:** local recipe edits, scout packages, actuals + price band + history/revert → release.
3. **Phase 3:** coverage rules, share + public list + event page section, admin list/view/notes, parent view → jenna MICRO on the checklist and sharing copy → release.
4. **Phase 4:** scout recipe submission, Submitted filter, credit, equipment.
5. **Bookkeeping:** DECISIONS (reverse D-266, add the scout catalog-edit rule and the public name rule), BACKLOG (strike the replaced items, add archive/cleanup), plan → Completed.

## Open Questions

- [ ] Public name rule: anonymous visitors see the patrol only, and audience-gated viewers see "Sam K." OK?
- [ ] Price band ±50%: right threshold? Should scout-added packages also be held for review, or go live?
- [ ] Should new shared recipes be leader-published (proposed) or live with a revert?
- [ ] Should a shared menu with an outing date in the past drop off the shelf list (it stays on its event page)? Proposed: the shelf shows the last 90 days.

## Notes

- Related: `Plans/Completed/Menu-Monster*.md`; D-265/266/272/273/274; BACKLOG.md:23 (the submit path never writes `submitted_person_id`, which Phase 4 must not repeat).
- Deploy order: additive migration first, code second. `'use server'` files export async functions only.
- Test scout: Charlie Walters (person 39). Revert any browser-test rows.
