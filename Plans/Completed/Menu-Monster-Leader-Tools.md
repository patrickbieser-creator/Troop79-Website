# Menu Monster Phase 2 — Leader Tools (Price Book + Recipe Builder)

**Status:** LIVE 2026-09-08 — v1.124.0 (cb961ce + 92ed8e2); phase 3 (suggestions) parked in BACKLOG
**Started:** 2026-09-08
**Priority:** High
**Parent:** `Plans/Menu-Monster.md` (phase 1, LIVE v1.123.0). Prototype: `D:\Projects\Troop Menu Monster\prototypes\concept-c-recipe-builder\index.html`. Discovery decisions: `D:\Projects\Troop Menu Monster\Plans\Discovery\00-Questions-and-Ideas.md` (A2, A4, C2–C5, E1, E4, G1–G4).

## Overview

Phase 1 shipped the scout-facing planner reading a catalog that only a migration can change. Phase 2 gives leaders the two editors the prototype validated — a **Price book** (ingredients, packages with prices, unit conversions) and a **Recipe builder** (menu items with per-line diet rules, draft → published → retired) — as one admin screen at `/admin/library/menu-monster`, gated by the existing `library.moderate` capability (the Librarian bundle; no new capability, no constraint migration). Every write is audited (area `library`). The public planner is `force-dynamic`, so a saved change is live on the next request.

**Suggestions stay where they are.** "Suggest a change" already routes to `/library/submit?target=topic:menu-monster` and lands in the Library Queue. Structured suggestions (a proposed recipe diff, a proposed price with the >25% flag, approve/edit-then-approve/decline with a reason) need an `mm_suggestions` table and a scout-facing form — that is **Phase 3**, parked below, and needs Patrick's call after leaders have used the editors.

## Problem / Opportunity

Every price and recipe correction is a hand-written migration today. The prototype's Price book and Menu items tabs were validated with Patrick on 2026-09-07; this ports them into the site's admin design system, on the shipped `mm_*` schema, with the site's save-button, audit, and RLS rules.

## Decisions carried in (do not re-litigate)

| Decision | Value |
|---|---|
| Who edits | Leaders with `library.moderate` edit directly. Scouts never edit; they propose (Phase 3). |
| Recipe unit is the source of truth (Option C) | A package's `yield` is stored in the ingredient's recipe unit. The yield **helper** suggests a number from the label size (same-family table or the ingredient's `mm_conversions` row); a human confirms. A package with no yield is unusable and excluded from costing. |
| Stale price | `as_of` older than 90 days → "Price is N days old — still used, but check it." Advisory, never a block. |
| Big change | A price edit that moves >25% from the saved price → "⚠ Big change (+N%) — flagged for a second look." Advisory, never a block. Editing the price defaults `as_of` to today. |
| Diet variants | One recipe; each line has `serves_rule` everyone / except X / only X. Duplicate ingredient+rule on one recipe is a blocking error. An `only X` line with no matching `except X` line (or vice versa) is a warning. Only gluten and nuts warn about allergens. |
| Status | draft → published → retired, plus Restore as draft. Publish is blocked while the recipe has any blocking issue. The planner shows published only. |
| Retire, don't delete | Recipes → `status = 'retired'`; ingredients and packages → `retired_at`. Conversions may be deleted (small, derived data). An ingredient in use by any non-retired recipe line cannot be retired. |
| Change unit | Changing an ingredient's recipe unit converts every package yield where a factor or conversion path exists (else the package becomes unusable), and pins the old unit explicitly on every recipe line that relied on "no unit = recipe unit" so no line's meaning shifts. One transaction (RPC). |
| Counts | Count units are one family with a per-ingredient noun pair (`unit_one` / `unit_many`). |
| Privacy | No names on restrictions anywhere (unchanged). |
| Where it lives | Under the Library (discovery grounding note): route `/admin/library/menu-monster`, nav item "Menu Monster" under News & Events beside Resource Library, back link to Resource Library. |

## Acceptance Criteria

- [ ] `/admin/library/menu-monster` renders for a `library.moderate` holder with two tabs — **Price book** and **Recipes** — plus a link to the Library Queue for suggestions. Absent the capability the page calls `requireCapability('library.moderate')` and every action re-checks it.
- [ ] **Price book:** searchable ingredient table (name, recipe unit, section, staple / avoid tags, package count, cheapest $/unit, newest as-of, status Unpriced / Stale / OK / Retired). Selecting one shows its packages (cards: name, store, price, size, yield, as-of, note; edit price + as-of inline with the stale and big-change readouts; retire), an **Add a package** form with the yield helper copy from the prototype, the ingredient's conversions (list + add "1 {from} = {factor} {to}" + delete), **Change unit** with the three-case consequence preview, and Retire ingredient (refused with the recipe names while any non-retired recipe uses it). **New ingredient** form: name, measured by (volume / weight / count → recipe unit or one/many nouns), section, patrol-box staple, avoid tags. "It starts unpriced — add a package below to make it usable."
- [ ] **Recipes:** list grouped by meal slot with status pill (Needs fixes / Draft / Published / Retired) computed live from `recipeIssues()`; editor with numbered sections (1 Basics: name, method, meal fit, food groups, camp/trail; 2 Ingredient lines: ingredient picker grouped by section, amount per person accepting ½ / 1/2 / 0.5, unit limited to `supportedUnits()`, who gets it; 3 Steps) and a live preview (what one person gets + Spent/Used per person at a 2–16 headcount, unpriced items called out). Actions: Save (dirty-gated per the save-button standard), Discard changes, Publish / Publish changes (disabled with the reason while blocked), Duplicate (→ "{name} (copy)", draft), Retire (double-click arm), Restore as draft.
- [ ] **Publish is enforced on the server:** `setRecipeStatus(id, 'published')` re-runs `recipeIssues()` against the saved recipe and refuses with the first blocking issue — the disabled client button is a convenience, not the gate. Retiring an ingredient is refused, naming the recipes, while any non-retired recipe line uses it.
- [ ] **Inline package edits are dirty-gated** (price, as-of, note, store): Save reads "Saved" until something differs, with Discard beside it — the save-button standard for already-saved data. Only the create-once forms (New ingredient, Add a package, Add a conversion) are exempt.
- [ ] Every write records to the content audit trail (area `library`, entity types `mm_recipe` / `mm_ingredient` / `mm_package` / `mm_conversion`) with field-level from → to for price and status changes; `tests/audit-coverage.test.ts` lists the new actions file.
- [ ] Saving a recipe (row + lines) and changing a unit are each one Postgres transaction (`security definer`, `search_path` pinned, EXECUTE revoked from anon/authenticated — service role only, D-239 posture).
- [ ] The public planner reflects a published change on the next request (no cache to bust; `force-dynamic`).
- [ ] Quality gate green: lint, typecheck, both vitest projects, build; design-system census unchanged (no raw hex, no new inline style); no new class family, so no styleguide change.
- [ ] `changelog.html` v1.124.0 (New); memory: D-271 (leader tools shape), BACKLOG updated, this plan → Completed when live.

## Test Plan

Pure helpers — `tests/menu-monster-authoring.test.ts` (db project, no DB):
- [ ] `Authoring_SuggestsYield_FromSameFamilyLabel()` — 1 gallon of milk (recipe unit cup) → 16; 10 lb pancake mix (cup) via the 4.5 oz/cup conversion → ≈35.6.
- [ ] `Authoring_ReturnsNoPath_WhenLabelUnitCannotBridge()` — bacon sold by the lb with no conversion → null with the "No conversion on file" reason.
- [ ] `Authoring_FlagsBigChange_Over25Percent()` — 4.99 → 6.49 flags; 4.99 → 5.99 does not; same price, new date → "Same price" note.
- [ ] `Authoring_FlagsStale_After90Days()` — 91 days → stale with the day count; 89 → not.
- [ ] `Authoring_RecipeIssues_BlocksPublish_ForEachRule()` — empty name; no lines; no meal fit; unpriced ingredient; unparseable amount; no unit path; duplicate ingredient+rule. Each yields exactly one blocking issue with the prototype's copy.
- [ ] `Authoring_RecipeIssues_WarnsOnLonelySwapLine()` — only-GF line with no except-GF line → warning, not blocking.
- [ ] `Authoring_ChangeUnitPlan_ConvertsPackages_AndPinsLines()` — cup → Tbsp: package yields ×16, lines with `unitKey: null` become `'cup'`; cup → gram with no conversion: packages flip to unusable, lines pinned; noun-only rename: nothing converts.

DB — `tests/menu-monster-authoring-db.test.ts` (db project, local stack; inserts under a `test-` prefix and cleans up):
- [ ] `Rpc_SaveRecipe_ReplacesLinesAtomically()` — save 3 lines, then save 2; exactly 2 remain, positions 1..2, `updated_at` moved. A malformed line rolls back the whole call (recipe row unchanged).
- [ ] `Rpc_ChangeIngredientUnit_UpdatesYieldsAndPinsLines_InOneTransaction()` — after the call every package yield and every line unit match the plan; RLS still zero policies.
- [ ] `Rpc_BothFunctions_RefuseAnonExecute()` — the anon key gets a permission error from `mm_save_recipe` AND `mm_change_ingredient_unit` (D-239 posture).
- [ ] `Catalog_AuthoringLoad_IncludesDraftsAndRetired()` — the authoring loader returns the draft recipe the public loader hides, with `retiredAt` populated; the public loader still hides it (the status filter moves from `mapCatalog` to the query — tech-lead change 1).
- [ ] `Action_Publish_RefusesBlockingRecipe()` — `setRecipeStatus` on a saved recipe with no lines returns `{ ok: false }` naming the issue and leaves it a draft (tests the action's validation with the auth guard mocked).
- [ ] `Action_RetireIngredient_RefusedWhileInUse()` — retiring an ingredient a published recipe uses returns the recipe name; retiring one only a retired recipe used succeeds.

DOM — `tests/menu-monster-price-book.test.tsx`, `tests/menu-monster-recipe-builder.test.tsx` (mock boundary = the actions module):
- [ ] `Leader_SeesYieldSuggestion_WhileAddingPackage()` — typing size 1 + gallon shows "Suggested: ≈ 16 cups from 1 gallon." and Save sends yield 16.
- [ ] `Leader_SeesBigChangeFlag_WhenEditingPrice()` — 4.99 → 6.99 shows the ⚠ pill; Save still enabled; action called with the new price and today's as-of.
- [ ] `Leader_CannotPublish_WhileRecipeHasBlockingIssue()` — Publish disabled with title "Add at least one ingredient line"; adding a priced line enables it; click calls `setRecipeStatus(id, 'published')`.
- [ ] `Leader_SeesDuplicateLineError_ForSameIngredientAndRule()` — two "everyone" lines of eggs → the error text and Save blocked.

## Technical Approach

### Schema — one migration `20260908120000_menu_monster_leader_tools.sql`

No new tables. Two functions, service-role only:

```
mm_save_recipe(p_recipe jsonb, p_lines jsonb) returns void
  -- upsert mm_recipes (id, name, status, meal_fit, food_groups, camp, trail, method, steps_md, sort_order, updated_at = now())
  -- delete mm_recipe_lines where recipe_id = id; insert p_lines with position 1..n
  -- raises on any check violation → whole call rolls back
mm_change_ingredient_unit(p_ingredient_id text, p_unit jsonb, p_package_yields jsonb, p_pin_unit text) returns void
  -- update mm_ingredients unit_kind/unit_key/unit_one/unit_many
  -- for each {id, yield, yield_unit_label} in p_package_yields: update mm_packages
  -- update mm_recipe_lines set unit_key = p_pin_unit where ingredient_id = p_ingredient_id and unit_key is null (p_pin_unit null = skip: noun-only rename)
```
`security definer set search_path = public`; `revoke execute on function … from public, anon, authenticated`. The **plan** (which yields become what, which lines pin) is computed in TypeScript (`changeUnitPlan`) so it is unit-tested and previewed to the leader before the RPC applies it verbatim.

### Code layout (`next-app/src/`)

```
lib/menu-monster/authoring.ts     pure: suggestYield, priceChange, staleDays/isStale, recipeIssues (errors + warnings), changeUnitPlan, newRecipeId/slug helpers, SOLD_UNITS, METHODS
lib/menu-monster/catalog.ts       + loadAuthoringCatalogWith(supabase): every recipe (any status), retired ingredients/packages included; Ingredient/Package gain retiredAt
lib/menu-monster/types.ts         Ingredient.retiredAt, Package.retiredAt (null on the public path)
lib/supabase/types.ts             unchanged (rows already carry retired_at / status)
app/admin/(workspace)/library/menu-monster/page.tsx        server: requireCapability('library.moderate'); loads authoring catalog; PageTitle back → Resource Library; TabStrip ?tab=prices|recipes (default prices when anything is unpriced, else recipes); "Suggestions land in the Library Queue" link
app/admin/(workspace)/library/menu-monster/actions.ts      'use server': createIngredient, updateIngredient, retireIngredient, changeIngredientUnit, addConversion, deleteConversion, createPackage, updatePackage, retirePackage, saveRecipe, setRecipeStatus, duplicateRecipe — each requireCapability + recordAudit + revalidatePath('/admin/library/menu-monster')
app/admin/(workspace)/library/menu-monster/price-book.tsx  'use client'
app/admin/(workspace)/library/menu-monster/recipe-builder.tsx 'use client'
app/admin/(workspace)/library/menu-monster/menu-monster.module.css   composes data-table card; tokens only
app/admin/(workspace)/_components/sub-nav.tsx              + { label: 'Menu Monster', href: '/admin/library/menu-monster', capability: 'library.moderate' } after Resource Library
tests/audit-coverage.test.ts                               + the actions file
```

### Rules this must follow (AGENTS.md)

Save-button standard (`useDraftSnapshot` / `SaveButton` / `DiscardButton` / `useSavePhase` + `SaveFeedback`); FormPanel + numbered FormSection for the recipe editor; `<Button>` only; `SearchField` + `useTableSearch` in the toolbar slot; `PageTitle` with `back`; Notice / Badge / HelpBadge for status and hints (status never color-only); no `confirm()` — double-click arm or `Dialog`; dates through `lib/format-date`, today via `centralToday()`; money via `lib/event-money` `money()`; admin tokens only; 16px inputs.

### Reuse

Costing preview = `buildLines()` + `totalsOf()` from `engine.ts` with a one-recipe plan. Unit options = `supportedUnits()`. Amount parsing = `parseQty()`. Warnings = `restrictionWarnings()` semantics reimplemented per-recipe in `recipeIssues()` (same rule: only gf/nut).

### Deferred (Phase 3 — Patrick to decide after first use)

`mm_suggestions` (new-recipe / change-recipe / price; first name + patrol only) with a scout-facing form at the planner, and the review cards (before/after diff, >25% pill, Approve / Edit then approve / Decline with a reason) in this screen's third tab. A "review all stale prices" batch view. Price history beyond the audit log. Plan persistence / share links.

## Implementation Steps

1. **Authoring helpers (TDD)** — `tests/menu-monster-authoring.test.ts` stubs → `lib/menu-monster/authoring.ts`; types `retiredAt`; `mapCatalog` stops filtering by status (the public query already does); `loadAuthoringCatalogWith` in `catalog.ts`.
2. **Migration + RPC tests** — migration file; `npx supabase migration up` locally (never reset); `tests/menu-monster-authoring-db.test.ts`.
3. **Actions** — `actions.ts` with audit; audit-coverage list.
4. **Price book UI** — `price-book.tsx` + dom test; page + nav; browser check on the local stack.
5. **Recipe builder UI** — `recipe-builder.tsx` + dom test; browser check.
6. **Gate + review** — lint / typecheck / test / build; qa-lead; fix.
7. **Release** — changelog v1.124.0; `npx supabase db push` (DB-first: additive functions), then commit + push; verify on production; memory.

Commit after step 3 (helpers + migration + actions, green) and after step 5, explicit paths only (multi-session repo).

## Open Questions

None blocking. Carried over from phase 1 for Patrick after first use: (1) whether anonymous plans should be saveable by link (needs an `mm_plans` table + expiry); (2) whether "Suggest a change" stays on the Library submit form or gets the structured Phase 3 queue above. Tech-lead review 2026-09-08: proceed with changes — all five folded in above (status filter out of `mapCatalog`; anon-EXECUTE test for both RPCs; server-side publish gate; retire-in-use test; dirty-gated inline package edits).
