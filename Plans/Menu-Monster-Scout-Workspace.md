# Menu Monster — Scout Workspace (saved menus, shared menus, scout recipes and prices)

**Status:** Parked, decisions complete (2026-10-02). Next: tech-lead + troop79-specialist schema review, then Phase 1.
**Parked:** 2026-10-01
**Priority:** High
**Origin:** Patrick, 2026-10-01. Scouts work individually and save menu plans behind a scout sign-in. Leaders and parents can see the plans. Scouts upload recipes that others use, with credit. Scouts correct prices after shopping and edit menu items on the fly. Works for home and troop cooking.
**Supersedes:** BACKLOG.md:31 items "saveable plans by share link (`mm_plans` + expiry)", "structured scout suggestions (new recipe / price)" and "actuals capture after shopping". Reverses D-266 ("plans … are not persisted").
**Prototypes:** `D:\Projects\Troop Menu Monster\prototypes\concept-e-scout-workspace\` (Brad; v5 reflects every decision below)

## Decisions

### Patrick, 2026-10-01

| # | Question | Decision |
|---|---|---|
| 1 | Retention | **None for now.** Menus stay available. Cleanup and archiving go on the BACKLOG for future consideration. |
| 2 | Who sees menus in admin | **Any adult with admin access** (`requireAnyCapability()`). No new capability. Menu actions get **high-level rows in the audit log**. |
| 3 | Parents | **Parents can see** their scout's menus (household identity, read-only). |
| 4 | Ownership | **Individual ownership.** Exactly one scout's name is on a menu. *(The optional patrol name was dropped on 2026-10-02.)* |
| 5 | Credit | **"Sam K."** (first name + last initial). Credits stay online. Archiving is a backlog item. |
| 6 | Scouts and the catalog | Scouts **update prices** after shopping and **edit menu items on the fly**. |
| 7 | Sequence | **Plan and prototypes first**, then build. |

### Patrick, 2026-10-02 (prototype review)

| # | Question | Decision |
|---|---|---|
| 8 | Advancement requirements | **Dropped.** No requirement tags, coverage checklist, requirement filter or BSA-text check. Advancement is tracked elsewhere (Fast Entry stays the sign-off path). |
| 9 | Patrol on a menu | **Dropped entirely.** No patrol field, picker, filter or public patrol byline. |
| 10 | Special diets | **Gluten-free, vegetarian, nut-free, dairy-free**, entered as counts on the menu. Diets are counts, not people: overlaps (one person both gluten-free and nut-free) are not modeled. |
| 11 | Navigation | **Tabs** under the menu title: Plan / Shopping / Share. Meals and recipes are drill-ins with a contextual back link. |
| 12 | Public name rule | **Everyone sees "Sam K."**, including anonymous visitors, on shared menus and recipe credits. No audience split. |
| 13 | Price band | **±50%** of the current price updates the book; outside waits for a leader. A scout-added package is band-checked per recipe unit against the cheapest existing package. |
| 14 | New scout recipes | **Go live when the scout shares them**, with the frozen "Recipe by Sam K." credit. A leader can retire one afterwards and matches typed-in ingredients to the price book. Allergen safety rests on the site's other safeguards. |
| 15 | Shelf window | Shared menus show on the shelf for **120 days** after their outing (always on the outing page). |
| 16 | Meal headcount | **Editable per meal** (e.g. Saturday dinner with parents), with Reset to the menu's number. |
| 17 | Typed-in ingredients | Need a **package size** as well as a price so the planner can scale them. |
| 18 | Review notes | **One per menu**, replaced on save. |
| 19 | Shared menus | **Keep updating** as the scout edits (no freeze until re-shared). |
| 20 | Copy a shared menu | **In scope now:** a scout can copy another scout's shared menu into My menus. |
| 21 | Browser draft | The anonymous planner's `localStorage` draft is **kept** after import. |

### Rules carried from the proposal (accepted)

- **Share step.** A scout clicks **Share with the troop** to publish a menu. It then appears on the Menu Monster shelf as **Shared with the troop** and on the linked calendar event's page as **Menus for this outing**. Drafts are never public.
- **Price updates go live immediately, inside the band.** The price paid is always kept on the menu. Inside ±50% it also updates the shared price book with "updated by Sam K., Oct 4". Every applied change is audited, and the price book keeps a history so a leader can revert.
- **On-the-fly edits are menu-local.** A scout can change an amount, swap, leave out or add an ingredient *inside their menu*, using the same diff ops as `mm_variation_lines`, stored on the meal. The shared recipe is untouched. **Share this version as a new recipe** turns the edited version into a new recipe.
- **Something not in the price book.** A scout can add a **package** to an existing ingredient (name, store, size, price), and it goes live like a price update. A brand-new **ingredient** is a free-text line priced from the scout's own entry; a leader maps it into the price book later.
- **After shopping, ask "What did you buy?"** (a package pick) before the price. `actuals` stores the package id with the price paid, which settles most different-size holds before a leader sees them.
- **Home menus** are family meals; context is Home / Camp / Trail.

### UI pattern of record (Patrick approved, 2026-10-01/02, D-288 / D-289)

`concept-e-scout-workspace/recipe-editor.html`, built from Patrick's Claude Design handoff, is the approved style for every scout page. `UX-BRIEF.md` (Jenna) carries it to the other pages, all built on shared `css/monster.css`, `js/monster.js` and `js/inglist.js`.
- **Look:** a cream page with borderless white list cards and tight ~38px rows.
- **Rows:** drag-and-drop reordering (step numbers follow); clicking an ingredient toggles its "What you'd buy" inset; row actions live in a ⋯ menu; a dashed search field adds to each list.
- **Amounts:** total to buy for the meal's headcount by default, with a Total / Per person switch on the heading line and a fixed right column. Prices show only the dollar amount: no "≈", no "each", no "N people" under them.
- **Counts:** compact dialers, label on the left ending in a colon: `People: [8] · Gluten-free: [1] · Vegetarian: [1] · Nut-free: [1]`. Read-only summaries use the same labels.
- **Basics:** where you're cooking and the outing are quiet **pulldowns**, not chip rows.
- **Plan page:** no requirements section and no hint line. The leader's note is the only notice box; **"Prices have changed — Update prices" lives as a quiet line on the Shopping page**, not on the Plan page.
- **Title line:** holds Save / Share.

Merges: one recipe editor; one ingredient-list component (recipe mode and menu-local mode); one Shopping page (what to buy, then what you paid); the leader's new-recipe list lives in admin.

## Overview

Today Menu Monster is an anonymous, single-meal planner whose draft lives in `localStorage` (`troop79.menuMonster.plan.v1`). This plan adds a **scout workspace**. A signed-in scout owns **menus**: one or more meals for a home meal or a troop outing, optionally linked to a calendar event, with a headcount and special-diet counts. Scouts save them on the server, shop from one merged list, and record what they paid, which keeps the troop price book current. They can share a finished menu with the troop and copy another scout's shared menu. Any admin adult and the scout's parents can read every menu. Scouts can also share recipes, which go live with a "Recipe by Sam K." credit.

The anonymous planner stays as it is, and signing in adds saving and sharing.

## Problem / Opportunity

- Cooking for a campout is multi-meal and multi-week. A plan is made at home, shopped days later and cooked weeks after that. A single-meal draft in one browser can't carry that.
- Before a campout, adults and other scouts can't see what each scout is cooking or buying, and scouts can't build on each other's menus.
- The price book goes stale. The scouts standing at the register know the real prices and have no way to record them.
- Scouts' own recipes have no way into the catalog.

## Acceptance Criteria

**Phase 1: saved menus**
- [ ] A verified scout (`requireVerifiedScoutIdentity()`, `lib/family-access.ts:238`) sees **My menus** on the shelf and can create, rename, edit, duplicate and delete menus. A menu has a name, a context (home / camp / trail), an optional calendar event, a headcount, diet counts (gluten-free / vegetarian / nut-free), a per-person budget, and 1–N meals (day × slot). Each meal is today's `Plan`, with an optional headcount override.
- [ ] Only the owning scout's name is stored on a menu; there is no patrol.
- [ ] Anonymous visitors, adults and leaders keep today's planner. "Save" shows "Scouts: sign in to save your menu".
- [ ] After sign-in, an existing `localStorage` draft is offered once as "Save this draft to My menus". The browser draft is kept.
- [ ] Every scout action derives the owner from the session `personId`. A scout can write only their own menus.
- [ ] Each save stores a priced snapshot (lines, totals, catalog `as_of`). When prices move, the **Shopping page** shows a quiet "Prices in the troop price book changed since you saved: $X → $Y. Update prices" line.
- [ ] Audit rows (new area `menus`) cover create / rename / delete / share / unshare / copy / review note, one line each (e.g. "Sam K. shared menu 'Fall Camporee'"). Edits to meal contents are **not** audited. Scout actors are recorded through `recordAuditAs` with the scout's person, because `recordAudit` resolves only admin actors.
- [ ] Tabs (Plan / Shopping / Share) under the menu title.

**Phase 2: on-the-fly edits + shopping actuals**
- [ ] Inside a menu, a scout can edit a meal's recipe locally (amount / swap / leave out / add). The row shows "Your version · 2", and the shared recipe never changes.
- [ ] A scout can add a package to an existing ingredient, and a free-text ingredient (name, package size, price) priced from their own entry.
- [ ] After shopping, each line takes **what you bought** (package), **how many** and **price paid each**. The Shopping page shows planned vs. paid in one heading line.
- [ ] Price paid within ±50% of the current price updates `mm_packages.price`/`as_of`, writes an `mm_price_history` row (who, menu, old → new) and an audit row. Outside the band it waits in a leader list. A leader can revert any history row. Scout-added packages are band-checked per recipe unit against the cheapest existing package.

**Phase 3: sharing, copying, leader + parent view**
- [ ] **Share with the troop / Stop sharing.** Shared menus appear on the shelf (newest first, outing within the last 120 days, filterable by outing) and on the linked event page. Everyone, including anonymous visitors, sees "Sam K.". A shared menu reflects the scout's later edits. The read-only menu page includes the shopping list and print sheet.
- [ ] **Copy to My menus.** A verified scout can copy another scout's shared menu. The copy is a new menu they own ("Copy of …"), with meals, days, headcount, diets, context and outing; it is not shared and has no actuals or review note. Audited ("Sam K. copied menu 'X' from Maya R.").
- [ ] Any admin adult opens `/admin/menu-monster/menus` (filters: scout, event, shared). They get a read-only view and can leave one review note per menu that the scout sees.
- [ ] A parent signed in to the scout's household sees that scout's menus read-only.
- [ ] The scout's admin record links to their menus.

**Phase 4: scout recipes** — SHIPPED v1.139.0–v1.140.0 (2026-10-02, 751cdeb / 7233a64)
- [x] A scout writes a recipe, either from scratch or from **Share this version as a new recipe**. It is usable in their own menus at once; **Share with the troop** publishes it immediately with the frozen "Recipe by Sam K." credit (editable by a leader).
- [x] Admin `/admin/library/menu-monster` gets a **New recipes** list: a leader matches typed-in ingredients to the price book and can **retire** a recipe. There is no publish gate.
- [x] Recipes gain `equipment text[]`, and a menu rolls it up into "Gear you'll need".

**Every phase:** quality gate green (`lint`, `typecheck`, `test`, `build`), changelog block, `mm_*` tables RLS on with zero policies, no client Supabase.

## Test Plan

Test names follow the project's `{Persona}_{CanAction}_{WhenCondition}` pattern.

Phase 1
- [ ] `Scout_CanSaveMenu_WhenVerifiedScoutSession()`
- [ ] `Adult_CannotSaveMenu_WhenSessionIsAdultIdentity()`
- [ ] `Anonymous_CannotSaveMenu_WhenPasswordOnly()`
- [ ] `Scout_CannotEditMenu_WhenOwnedByAnotherScout()`
- [ ] `Scout_CannotReadDraftMenu_WhenOwnedByAnotherScout()`
- [ ] `Menu_StoresOnlyOwnerName()`
- [ ] `Menu_ClampsDietCounts_ToHeadcount()`
- [ ] `Menu_StoresPricedSnapshot_OnEverySave()`
- [ ] `Menu_RendersFromSnapshot_WhenRecipeRetiredSinceSave()`
- [ ] `Audit_RecordsScoutActor_OnMenuCreateDeleteShare()`
- [ ] `Audit_SkipsMealContentEdits()`
- [ ] `Scout_IsOfferedDraftImport_OnceAfterSignIn()` (dom)
- [ ] `MmMenus_HasRlsEnabledWithZeroPolicies()`

Phase 2
- [ ] `LocalEdit_CompilesToLines_WithoutTouchingSharedRecipe()` (reuses `compileRecipe`)
- [ ] `DietCounts_ScaleExceptAndOnlyLines()` (gluten-free / vegetarian / nut-free swaps)
- [ ] `PricePaid_UpdatesPriceBook_WhenWithinBand()`
- [ ] `PricePaid_HeldForLeader_WhenOutsideBand()`
- [ ] `ScoutPackage_BandChecksPerUnit_AgainstCheapestPackage()`
- [ ] `Leader_CanRevertPriceHistoryRow()`
- [ ] `Menu_ShowsPlannedVsPaidTotals()`
- [ ] `ScoutPackage_IsPricedInPlanner_AfterAdd()`

Phase 3
- [ ] `SharedMenu_ShowsScoutName_ToAnonymousViewer()`
- [ ] `DraftMenu_NeverAppearsPublicly()`
- [ ] `Shelf_HidesSharedMenus_WhenOutingOver120DaysPast()`
- [ ] `EventPage_ListsSharedMenusLinkedToEvent()`
- [ ] `Scout_CanCopySharedMenu_IntoOwnMenus()`
- [ ] `Scout_CannotCopyDraftMenu_OfAnotherScout()`
- [ ] `CopiedMenu_IsUnsharedWithoutActualsOrReviewNote()`
- [ ] `AnyAdmin_CanListAllMenus()` / `NonAdmin_CannotListMenus()`
- [ ] `Parent_CanReadOwnScoutsMenus_ButNotOthers()`

Phase 4
- [ ] `Scout_CanUseOwnDraftRecipe_InOwnMenu()`
- [ ] `OtherScout_CannotSeeRecipe_UntilShared()`
- [ ] `SharedRecipe_IsLiveImmediately_WithFrozenCredit()`
- [ ] `Leader_CanRetireScoutRecipe()`
- [ ] `Menu_RollsUpEquipmentAcrossMeals()`

## Technical Approach

### Schema (additive; D-239 posture: RLS on, zero policies, service role on the server)

Revised after the tech-lead + troop79-specialist review (2026-10-02). Each phase adds only its own columns.

```
Phase 1
mm_menus          id uuid pk, owner_person_id fk people ON DELETE RESTRICT, name (length check),
                  context text check (home|camp|trail),
                  calendar_entry_id bigint fk calendar_entries ON DELETE SET NULL,   -- NOT public.events (ledger lookup)
                  start_date date null,                      -- day labels when no outing is linked
                  headcount int (engine MIN/MAX_HEADCOUNT = 2–50), restrictions jsonb,   -- RestrictionKey map, clamped on write
                  budget_per_person_meal numeric(6,2) not null default 4 check >= 0,
                  meals jsonb (array, capped ~30; each { id, day, slot, headcount|null, plan }),
                  snapshot jsonb ({ v:1, asOf, totals, perPerson, lines:[…names, pkgLabel, qty, unitPrice, spent] }; server-built),
                  created_at, updated_at                    -- updated_at set in the action; compared on save (no lost updates)
                  index (owner_person_id, updated_at desc); RLS on, zero policies
audit_log         CHECK area widened to include 'menus' (BLOCKER: recordAuditAs swallows the insert error)
Phase 2           meals[].recipe_edits, meals[].actuals; mm_price_history (id, package_id, old/new price,
                  reported_by_person_id, menu_id, status applied|held|reverted, decided_by/at); mm_packages + added_by_person_id
Phase 3           mm_menus + shared_at, review_note, reviewed_by_person_id, reviewed_at, copied_from_menu_id
Phase 4           mm_recipes + author_person_id, attribution_label, shared_at, equipment text[]; status draft|published|retired
```

- **Diets are a `restrictions` jsonb map**, not columns: the engine already has `RestrictionKey = gf|nut|dairy|veg` (`types.ts:21`) with nut-free and vegetarian swaps seeded, and scaling clamps to headcount (`engine.ts:55-58`). No engine work is needed for nut-free.
- **Meals are a jsonb array on `mm_menus`**, not a child table: nothing queries meals alone, and a save is one atomic row write. `restorePlan()` sanitizes stale ids per meal; `Plan.patrol` is composed as `''`.
- **Outing pulldown:** `calendar_entries` with `status='published'`, `on_calendar`, `end_date >= centralToday()`, category Campout / Overnight (plus High Adventure / Summer Camp). Shared menus on a draft entry must not leak.
- **Owner** comes only from `requireVerifiedScoutIdentity().personId` (`family-access.ts:238`). An aged-out scout can't write; their menus stay readable and are never cascade-deleted. People/calendar merge code must re-point `mm_menus`.
- **Layout:** `lib/menu-monster/menus.ts` (pure), `menus-data.ts` (`*With(supabase)` loaders, `createAdminClient`), `_tools/menu-monster/menu-actions.ts` (`'use server'`, async exports only), page `(public)/library/menu-monster/menus/[menuId]` with tabs. No caching of per-user data.
- **Phase 1 slices:** (1) migration + audit CHECK + RLS test, deployed first; (2) pure `menus.ts` + `AUDIT_AREAS`; (3) data + actions (create/rename/save/duplicate/delete) with ownership + audit tests; (4) My menus + Plan tab (extract the meal editor from `planner.tsx`); (5) Shopping tab + drift line + print; (6) draft import (may slip to 1.1).
- Local recipe edits reuse the variation diff ops and `compileRecipe`, so the engine still reads only lines.
- The menu-wide shopping list merges needs across meals before picking packages, so two egg meals buy one flat. That stays a pure engine function.
- Audit: add `'menus'` to `AUDIT_AREAS`. Scout-originated rows use `recordAuditAs(client, { personId, label: 'Sam K.' }, …)`.
- Backlog: add an entry for cleanup and archiving of old menus and departed scouts' credits.

## Implementation Steps

0. **Prototype + decisions (done 2026-10-02).** Next: tech-lead and troop79-specialist review of the schema above.
1. **Phase 1:** schema + menus lib + snapshot + audit area → My menus UI with tabs, combined list, draft import → qa-lead → release.
2. **Phase 2:** local recipe edits, diet swaps incl. nut-free, scout packages, actuals + price band + history/revert → release.
3. **Phase 3:** share + public list + event page section, copy to My menus, admin list/view/notes, parent view → jenna MICRO on sharing copy → release.
4. **Phase 4:** scout recipes (live on share), admin New recipes list with matching and retire, credit, equipment.
5. **Bookkeeping:** DECISIONS (reverse D-266; add the scout catalog-edit rule, the open name rule and recipes-go-live), BACKLOG (strike the replaced items, add archive/cleanup), plan → Completed.

### Meal page in Phase 1 (Patrick, 2026-10-02: "build it now and look for ways to optimize the work in Phase 2")

The meal drill-in is a port of the approved `meal.html`, not the reused anonymous planner:
- One quiet row per recipe (name, cost in the right column, ⋯ Swap recipe / Remove); a dashed search adds a recipe; a `People:` dialer with Reset to the menu's number; a Total / Per person switch; one footer line ("This meal: $X, $Y a person").
- A recipe's name opens its ingredient list (amounts as totals for the meal's headcount, diet swaps shown).
- **No shopping controls on the meal page.** Package choice, quantity overrides and "bringing from home" move to the Shopping tab (slice 5). The anonymous planner's controlled mode is removed again; the planner stays exactly what visitors use.

**Phase 2 savings built in now:**
1. **One shared ingredient-list component** (`IngredientList`) with a mode flag: `read` (Phase 1 meal page), `menu-edit` (Phase 2: amount / swap / leave out / add, "Your version · N"), `author` (Phase 4 recipe editor, the approved recipe-editor.html). Rows, layout, keyboard, insets and tests exist after Phase 1; Phase 2 adds the edit actions only.
2. **`meals[].recipeEdits` reserved now** in `sanitizeMenu` (validated, empty in Phase 1; ops amount / swap / leave_out / add keyed by recipe id) and applied by one pure function on every read, before `buildLines` — the hook exists in Phase 1, so Phase 2 needs no data migration. (`compileRecipe` in `variations.ts` compiles leader diet variations, a different shape; the new function sits beside it, it does not replace it.)
3. Diet swaps already come from the engine (`except` / `only` lines), so the list shows them with no Phase 2 work.

### IA correction (Patrick, 2026-10-02, after v1.136.0) — before release C

The prototype's functional IA did not fully reach production. Patrick's calls:
1. **The planning flow is the main Menu Monster experience for everyone.** Basics (name, where you're cooking, outing, People + diet dialers, budget) are the first thing on the page, then meals by day, then a separate page per meal. Signed-in scouts get a saved menu; visitors and leaders get the same screens as an **unsaved menu kept on this computer** ("sign in to save"). The old single-meal planner **retires** (its localStorage draft is folded into the new local menu once).
2. **Meals by day use the prototype's dashed search per day**: "Add to Friday — search a recipe, or type breakfast, lunch…" — picking a recipe drops it into that day's meal of the right slot (creating it); typing a slot name offers an empty meal. Replaces "+ Add a meal" (a combobox, not a `<select>`, so no arrow-key accidents).
3. **Keep the separate page per meal** (focus, little on screen).
4. **Shopping keeps the new merged list** and gains the old planner's **Spent / Used / Leftover / Budget** panel above it.
5. Release C (scout-added packages, typed-in ingredients) follows this.

### Phase 2 design (tech-lead review, 2026-10-02)

**Releases:** (A) P2.1 schema + people-merge fix + P2.2 menu-local edits → (B) P2.5 leader side + P2.4 "What you paid" together (auto-applied prices need revert from day one) → (C) P2.3a scout-added package, P2.3b typed-in ingredient.

- **Schema (one additive migration, DB-first):** `mm_price_history` (uuid id; package_id fk restrict; old_price + **old_as_of** (so a revert restores the date); new_price > 0; reported_by_person_id fk restrict; menu_id fk set null; status applied|held|reverted; created_at; decided_by_person_id, decided_at; check held ⇒ undecided; indexes (package_id, created_at desc) and partial held); `mm_packages` + `added_by_person_id`, `held_at` (both public loaders filter `held_at is null`; authoring sees them); `mm_menus` + `actuals jsonb '{}'` (per MENU, keyed by ingredient: packageId, qty, pricePaid) + `free_items jsonb '[]'`. RLS on, zero policies.
- **Band:** compare **unit price** (price ÷ yield per recipe unit) against the picked package's own current unit price; ±50% = `PRICE_BAND` in `lib/menu-monster/price-band.ts` (not authoring's 25% `BIG_CHANGE`). Unusable package / no usable package → always held. Price ≤ 0 rejected.
- **Concurrency:** one RPC `mm_report_price` (`select … for update` on the package; band passed in; inserts history; updates price/as_of). An unchanged price only touches `as_of`; re-saving an unchanged line calls nothing. Execute revoked from anon/authenticated (the `mm_save_recipe` precedent).
- **Revert:** only when the package's price still equals the row's new_price (also covers leader edits), else "superseded", no change. Reverting a held row = dismiss. The leader's `updatePackage` writes history too.
- **Actuals save:** its own action writing only `actuals` — no `updated_at` bump (no false conflict on an open Plan tab). Re-snapshot after the scout's own applied change so their drift line doesn't fire.
- **Free items:** live in `mm_menus.free_items`; one pure `menuCatalog(base, menu, ownerHeldPackages)` overlays synthetic `new:<8hex>` ingredients/packages (also shows the owner their held packages); `sanitizeRecipeEdits` accepts those ids. Optional avoid-flag ticks; with any diet count > 0 and no ticks, the row says "Not checked for diets".
- **Audit:** price changes under `library` (via `recordAuditAs` for scouts); menu actions stay `menus`. Read `mm_price_history` filtered/limited, never whole (1000-row cap).
- **Owed from Phase 1:** people-merge must re-point `mm_menus.owner_person_id` (and now `mm_price_history` people columns, `mm_packages.added_by_person_id`); today a merge of a person who owns a menu fails on RESTRICT.

### Phase 4 design (revised 2026-10-02 after tech-lead + troop79-specialist review)

Patrick, 2026-10-02: **typed-in ingredients and leader matching are IN Phase 4** (for recipes). Release C (typed-ins on *menus*, scout-added packages) stays separate.

**Where it lives:** the hub's **Recipe Builder** tab — a signed-in scout sees **My recipes** + **New recipe**; anyone else one line to sign in. Editor routes `(public)/library/menu-monster/recipes/new` and `/recipes/[recipeId]`, a port of the approved `recipe-editor.html`: name; **Good for** chips; **Food groups** chips; **Ingredients** (`IngredientList` mode `author`; People dialer + Total / Per person; ⋯ Move up / Move down / Remove); **Steps** (plain text); **Gear you'll need** (4C). Title line: dirty-gated **Save** / **Discard changes** + **Share with the troop**.

**Lifecycle**
- Save = private draft (`status='draft'`, `author_person_id` from the verified scout session — never from the client). Usable at once in the author's own menus; library shows "Your draft recipe".
- **Share with the troop** = `published` + `shared_at` + frozen `attribution_label` from `publicScoutName` (`lib/scout-name.ts`, read from `people`, ≤ 40 chars). Live at once. Library shows "Recipe by Sam K.".
- Author may keep editing after sharing; edits are live and audited. Leader list marks "edited since shared" (`updated_at > shared_at`). Credit never changes on edit, rename or people merge — the leader credit edit is the fix (duplicates allowed).
- Aged-out / inactive scouts: no new saves or shares (verified-scout identity already refuses them); their recipes stay.
- Retired: leaves the library and pickers; **menus keep it** (see engine fixes). Retired recipes are read-only to the author.
- Caps: 25 recipes per scout, 10 unmatched typed-ins per scout, enforced in the RPC under `pg_advisory_xact_lock(person)`.

**Engine / menu fixes (required before any recipe can retire — tech-lead #1)**
- `restorePlan` keeps only `recipesForMeal` ids (`engine.ts:457`) and the catalog is published-only (`catalog.ts:82`), so a retired recipe — or a draft read without its owner — silently drops from a menu on the next save. Fix: the **menu-side catalog carries published + retired (+ the owner's drafts)**; pickers filter to published (+ own drafts). `ownerPersonId` becomes a required argument wherever a menu is sanitized for save.
- A draft a menu references can't be deleted (deleting is "Remove from your menus first"). Phase 3: a menu holding unpublished recipes can't be shared.

**Typed-in ingredients (4B)**
- Real `mm_ingredients` + one `mm_packages` row (FK targets for shared lines), `added_by_person_id`, `needs_match_at`; **hidden from everyone but the author until a recipe using it is shared** (`shared_at` on the ingredient, set by the share). Price/size bounds; exact-name duplicates of a book ingredient refused; the package carries "unchecked price" while unmatched; a price-history row records the scout's entry.
- Diet: avoid ticks stay **unverified** — "Not checked for diets" on menus with diet counts; a recipe with an unmatched ingredient earns no diet label.
- **Matching:** `mm_match_ingredient(from, to, factor)` — locks both rows `for update`, rejects from=to / already-retired / chains; leader enters a factor prefilled from `mm_conversions` with a preview; stores a conversion on the target so lines keep their unit; re-points `mm_recipe_lines` and `mm_variation_lines` (`ingredient_id`, `base_ingredient_id`) merging duplicates; sets `merged_into_id` + `merge_factor` on the source and retires it. **Menus are NOT rewritten** (no false `updated_at` conflicts): `sanitizeMenu` resolves aliases first (rewrites keys, converts qty in recipeEdits / shopping / actuals). **Keep as new**: leader sets section / avoid, clears `needs_match_at`.
- `mm_save_scout_recipe` locks referenced ingredient rows `for share` and rejects retired ones.

**Public text safety:** recipe name, steps, ingredient / package / store names, gear: length caps, control characters and URLs stripped, validated **inside the RPC** as well as in `sanitize`; scout text renders as plain text only (never markdown, never article tokens).

**Schema**
```
4A  mm_recipes + author_person_id bigint fk people on delete restrict
               + attribution_label text (≤ 40), shared_at timestamptz, origin_recipe_id text fk set null
               + equipment text[] not null default '{}'   (column now; UI in 4C)
               check (author_person_id is null) = (id !~ '^S-[0-9a-f]{8}$')            -- both directions
               check status <> 'published' or author_person_id is null or (shared_at is not null and attribution_label is not null)
               index (author_person_id, updated_at desc)
    merge_people: full CREATE OR REPLACE from 20261003100100_merge_people_menus.sql + mm_recipes.author_person_id
    mm_save_scout_recipe(p_person, p_recipe, p_lines, p_expected_updated_at) security definer, EXECUTE revoked from anon/authenticated:
      advisory lock + cap; ownership (existing author = p_person) and not retired; updated_at compare; never touches status/credit;
      text validation; lock referenced ingredients for share, reject retired.
    mm_share_scout_recipe(p_person, p_id, p_label) — sets published/shared_at/label once.
4B  mm_ingredients + added_by_person_id, needs_match_at, shared_at, merged_into_id, merge_factor; merge_people adds added_by
    mm_match_ingredient(...); mm_save_scout_recipe v2 accepts p_new_ingredients
```
- Leader authoring load (`catalog.ts:272`) excludes scouts' unshared drafts.
- Audit: `library` area — scout save / share / delete via `recordAuditAs`; leader retire / credit (before-value) / match via `recordAudit`.

**Releases (tech-lead slicing)**
- **4A** migration + merge fix (DB-first) → engine/menu retire-and-draft fixes → `scout-recipes.ts` → data + actions (save / share / delete-draft) → editor (price-book ingredients only) → Recipe Builder tab (My recipes) → owner catalog in menus + library credit / "Your draft recipe" → admin **New recipes** list with retire, credit edit, edited-since-shared. qa-lead → release.
- **4B** typed-in ingredients + matching + alias resolution (one release).
- **4C** Share this version as a new recipe; Gear field + menu rollup on Shopping and print; gear in the leader builder.

**Test plan additions:** `Scout_CanSaveDraftRecipe_WhenVerifiedScoutSession`, `Scout_RecipeOwner_IgnoresClientSentPerson`, `Scout_CannotEditAnotherScoutsRecipe`, `Scout_CannotEditRetiredRecipe`, `Scout_CanUseOwnDraftRecipe_InOwnMenu`, `OtherScout_CannotSeeRecipe_UntilShared`, `SharedRecipe_IsLiveImmediately_WithFrozenCredit`, `Credit_Survives_EditAndPeopleMerge`, `Menu_KeepsRetiredRecipe_OnSave`, `Menu_KeepsOwnersDraft_WhenSanitizedWithOwner`, `Draft_CannotBeDeleted_WhileAMenuUsesIt`, `Leader_DoesNotSeeUnsharedDrafts`, `Leader_CanRetireScoutRecipe`, `Scout_RecipeCap_IsEnforced`, `ScoutText_IsStrippedAndCapped`; 4B: `TypedInIngredient_NeedsSizeAndPrice`, `TypedInIngredient_HiddenUntilShared`, `Leader_CanMatchTypedIn_RepointingLines`, `Menu_ResolvesMatchedAlias_WithoutRewrite`; 4C: `Menu_RollsUpEquipmentAcrossMeals`.

### Phase 3 design (2026-10-03; reviewed by tech-lead + troop79-specialist, changes below WIN over the draft that follows)

**Review outcome (binding):**
1. **Viewer order, one pure function** `menuAccess()`: owner (edit) → admin viewer (any, read-only, review note, take-down) → parent (adult identity ONLY, `resolveFamilyScope` at read time, no `household_members` fallback; sees unshared menus incl. aged-out children) → any other viewer incl. a non-owner scout and anonymous (read-only, only when shared AND linked entry, if any, is `status='published'` — `on_calendar` NOT required, off-calendar entries have public pages). `menuViewer()` gains a `parent` kind; a leader who is also a parent stays `leader` (superset) but still gets the "Your scouts' menus" list.
2. **The loader is the single redaction point.** Public/shared-scout views get the menu re-sanitized against the PUBLIC catalog (`loadMenuMonsterCatalog(null)`): unshared draft recipes, their edits and shopping refs drop out, and the Plan tab says "N recipes in this menu aren't shared yet". `actuals`, `snapshot`, `freeItems`, review note are removed (allowlist, not omission). Parents keep actuals + note; their catalog is also the public one. Leaders too (fixes today's owner-catalog read).
3. **Leader take-down:** "Hide from the shelf" (admin viewer) clears `shared_at`, audited. Menu names get the D-301 scout-text cleaning (control / zero-width / bidi stripped) in `sanitizeMenu`.
4. **Shelf query filters in SQL** (embed `calendar_entries`, published + end date), not take-N-then-filter. Hub shows 5 rows; ONE full list at `/library/menu-monster/menus/shared` with the outing filter. Re-sharing resets `shared_at` (the Share tab says so).
5. **Event page:** narrow select in its own loader (not `loadSignupContext`).
6. **Shared-menu pages are `noindex`.**
7. **Owner sees "Shared — but its outing isn't published yet"** when the linked entry is not published. A deleted entry nulls the link → the no-outing 120-day branch (accepted).
8. **Schema trimmed:** no partial indexes (≈30 scouts), no `copied_from_menu_id` (audit row records the copy), `reviewed_by_person_id` ON DELETE SET NULL (still re-pointed by `merge_people`, based on the 20261003160000 definition).
9. **Share is a third tab** (Plan / Shopping / Share, Decision 11). Copy tells the copier how many recipes didn't come across.
10. **No `/admin/menu-monster/menus` route** — filters (scout, outing, shared) on the existing leader list, SQL-side + paginated. *(Reverses this plan's Phase 3 criterion; both reviewers agree; flagged for Patrick.)*

**Original draft (superseded where the list above differs):**

**Already live (reuse, don't rebuild):** a leader's read-only "Scouts' menus" list (`/library/menu-monster/menus`, hub section) and read-only Plan/Shopping tabs (`loadViewableMenu`, `scout-menus.tsx`), Print sheet on Shopping, `duplicateMenuWith`.

- **Schema (one additive migration, DB-first):** `mm_menus` + `shared_at timestamptz null`, `review_note text null` (≤1000 chars), `reviewed_by_person_id bigint null fk people restrict`, `reviewed_at timestamptz null`, `copied_from_menu_id uuid null fk mm_menus on delete set null`. Partial indexes `(shared_at desc) where shared_at is not null` and `(calendar_entry_id) where shared_at is not null`. `merge_people` re-points `reviewed_by_person_id`.
- **Share / Stop sharing:** owner-only `shareMenuWith(sb, actor, id, on)`; sets/clears `shared_at` WITHOUT bumping `updated_at` (an open Plan tab keeps its version). Audit `share`/`unshare`. Shared menus keep updating as the scout saves (Decision 19).
- **Who may read a menu (`loadViewableMenu`):** owner → edit; admin viewer → any, read-only (+ review note); parent (adult identity whose `resolveFamilyScope` includes the owner) → read-only; anyone incl. anonymous → read-only only when `shared_at` is set AND the linked entry (if any) is published. Pages stop calling `notFound()` for "no viewer" and decide per menu. Public viewers never see actuals (what was paid) or the review note.
- **Catalog for non-owner views:** `loadMenuMonsterCatalog(null)` — an owner's unshared draft recipes / typed-in ingredients must not reach anyone else through a shared menu (Phase 4: drafts private until shared; leaders don't see unshared drafts). Such a line renders as "A recipe not shared yet" with no ingredients/cost. *(Today the leader's read-only view uses the owner's catalog — fix in this phase.)*
- **Shelf rule (pure, `menus.ts`):** `onShelf(sharedAt, entry, today)` = shared AND (linked published entry ending ≥ today − 120 days, OR no entry and shared ≥ today − 120 days). Draft/unpublished entry → never listed.
- **Hub "Shared with the troop"** on the Meal Planner tab for everyone: newest `shared_at` first, 10 rows, outing filter `?outing=<id>`, "All shared menus" → `/library/menu-monster/menus/shared`. Rows: name · "Sam K." · outing · meals.
- **Event page `/events/[id]`:** "Menus for this outing" section — every shared menu linked to that entry (no 120-day cut-off), name + "Sam K." links. Section absent when none.
- **Copy to My menus:** `copyMenuWith(sb, actor, sourceId)` — source must be shared (or the actor's own); re-sanitized against the COPIER's catalog (drops recipes they can't see), fresh snapshot; carries name ("Copy of …"), context, outing (same allowedOuting rule), headcount, diets, budget, days, meals + recipeEdits, shopping choices; NOT shared_at, actuals, free_items, review note. Sets `copied_from_menu_id`. Menu cap applies. Audit `copy` "Sam K. copied menu 'X' from Maya R.".
- **Review note:** `setReviewNoteWith(sb, leaderActor, id, note|null)` — any admin viewer; replaces; no `updated_at` bump; audit `review_note`. Shown to owner (the one notice box on the Plan tab), leaders, parents; never public.
- **Leader list — PROPOSAL: no new `/admin/menu-monster/menus` route.** The read-only leader list already exists on the public side; add filters (scout, outing, shared) there via query params rather than building a second surface (Patrick's simplify-don't-layer rule). The scout's admin record (`/admin/rosters/[id]`) links to `/library/menu-monster/menus?scout=<personId>`.
- **Parent list:** `/library/menu-monster/menus` for a parent shows "Your scouts' menus" (read-only rows for scouts in their family scope).
- **Order:** (A) migration + store fns + viewer matrix + catalog fix, (B) share UI + shelf + event section + copy, (C) review note + leader filters + parent view + roster link → jenna MICRO on sharing copy → qa-lead → release.
- **Tests (stubs):** `Scout_CanShareOwnMenu`, `Scout_CannotShareAnotherScoutsMenu`, `Share_DoesNotBumpUpdatedAt`, `Anonymous_CanReadSharedMenu`, `Anonymous_CannotReadUnsharedMenu`, `SharedMenu_OnDraftEntry_IsHidden`, `SharedView_HidesOwnersDraftRecipe`, `SharedView_HidesActualsAndReviewNote`, `OnShelf_Drops_After120Days`, `EventPage_ListsSharedMenusForEntry`, `Scout_CanCopySharedMenu_AsNewUnsharedMenu`, `Copy_DropsActualsNoteAndShare`, `Copy_RespectsMenuCap`, `Scout_CannotCopyUnsharedMenu`, `Leader_CanSetReviewNote`, `Scout_CannotSetReviewNote`, `Parent_CanReadOwnScoutsMenus`, `Parent_CannotReadOtherScoutsUnsharedMenu`, `Merge_RepointsReviewedBy`.

## Open Questions

- [x] Schema review: diets as a `jsonb` map (2026-10-02).
- [x] **Dairy-free** shows too (Patrick, 2026-10-02): four diets — gluten-free, vegetarian, nut-free, dairy-free.
- [x] Headcount 2–50 (Patrick, 2026-10-02: whole-troop meals run up to 50). `MAX_HEADCOUNT` raised for the planner, recipe builder and menus.

## Notes

- Related: `Plans/Completed/Menu-Monster*.md`; D-265/266/272/273/274; BACKLOG.md:23 (the submit path never writes `submitted_person_id`, which Phase 4 must not repeat).
- Deploy order: additive migration first, code second. `'use server'` files export async functions only.
- Test scout: Charlie Walters (person 39). Revert any browser-test rows.
