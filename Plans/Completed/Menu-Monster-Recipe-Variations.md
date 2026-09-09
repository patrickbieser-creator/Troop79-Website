# Menu Monster — Recipe Variations (base recipe + per-restriction diffs)

**Status:** LIVE 2026-09-08 — v1.125.0 (df38d1d + 6272291; Migration A on prod, 16 variations / 32 lines backfilled). Migration B (drop `serves_restriction`) still to do in a later release.
**Started:** 2026-09-08
**Priority:** High
**Origin:** Patrick, 2026-09-08: "all of this information is merged into one giant recipe, which could be confusing for 11 year olds". Jenna MICRO review + Brad prototype `D:\Projects\Troop Menu Monster\prototypes\concept-d-recipe-variations\{admin,public}.html` (README there has the treatment-by-treatment rationale).

## Overview

Today a recipe is ONE line list with a per-line rule (everyone / everyone except X / only X). The engine sizes those lines correctly and must keep doing so. What changes is what leaders AUTHOR and what scouts READ: a **base recipe** ("Everyone") plus zero or more **variations**, one per restriction, each a small **diff** on the base (swap / leave out / add), with a review **state** per (recipe, restriction). A variation compiles down to today's `serves_rule` lines, so `buildLines` / `servingsFor` / `restrictionWarnings` stay untouched.

## What Jenna and Brad agreed (2026-09-08)

| Question | Recommendation |
|---|---|
| Mental model | Variation per restriction as a **tab on demand** ("+ Add a variation" lists the untouched restrictions with a "N need a look" badge) — not four always-present tabs (a wall of "Not needed" across 30 recipes). |
| States | Four, computed and shown as a chip on the tab and as dots in the item list: **Not reviewed** (nobody looked), **Nothing to change** (a leader confirmed), **Substituted** (a diff exists), **Not suitable** (no fix exists — Bacon for vegetarians). An empty tab must never be ambiguous between the first two. |
| Variation content | A **diff** on the base: each base line Same / Swap for … / Leave out, plus Add a line. Not a full second list — a copy drifts the first time the base changes and loses swap intent (Brad verified the round trip). |
| Leader preview | The existing per-person Preview takes a restriction filter so the GF tab shows the fully compiled GF recipe, not raw except/only rows. Plus a read-only "what the planner will compute" box. |
| Public card | **Count-gated**: GF = 0 → the plain recipe; GF = 1 → an added "1 gluten-free scout gets …" section (a one-line diff strip when the variation is a single change, the full list when several). VG > 0 → Bacon shows "Not for vegetarians — N need something else". Print sheet mirrors it. A "See all versions" link for browsing. No accordions (D-070). |
| Pills | The two-letter GF/NF/DF/VG codes stay (print sheet, admin flat list); the strike-through "except" pill and the legend leave the public card because no merged list is shown any more. |
| Warnings | `restrictionWarnings` extends to dairy and vegetarian via the "Not suitable" state (today only gluten and nuts warn, so Bacon-for-vegetarians passes silently). |

## Decisions (Patrick, 2026-09-08)

1. **"Nothing to change" is derived** from the base ingredients' `avoid` flags — fewer clicks. No flagged ingredient → *Nothing to change* with no row. A flagged ingredient and no variation row → *Needs a look*. A leader may still confirm *Nothing to change* explicitly (a row with state `nothing`) when the flag is a false alarm.
2. **A base line changed by two variations:** Patrick chose (c) "split into duplicate base lines". **That cannot be computed** — the engine sizes lines from restriction counts, so no set of single-restriction lines yields "everyone except DF or VG" (headcount − DF − VG). Forbidding was rejected, so the plan **widens the rule**: `mm_recipe_lines.serves_restrictions text[]` replaces `serves_restriction`; `except` serves headcount − Σ(listed counts), `only` serves Σ(listed counts). The compiler emits one line per (ingredient, rule, restriction set). Flagged to Patrick in the report.
3. **GF + nut-free on one person:** an editor-side cross-restriction warning is enough for v1 (almond flour in a GF swap when it carries the nut flag).
4. **Storage (my call):** `mm_recipe_variations` + `mm_variation_lines` are the authoring source; saving compiles them into `mm_recipe_lines` inside `mm_save_recipe` (one transaction). Every reader keeps the line model; the diff never has to be re-derived.
5. **"Not suitable"** is a state on the variation row.
6. **Keep the warnings**: the amber avoid-flag warning stays for gluten and nuts; *Not suitable* warns for all four restrictions when the count is above zero. Nothing is hidden.

## Acceptance Criteria (draft)

- [ ] Leader: a recipe shows an Everyone tab and only the variations added; "+ Add a variation" names the untouched restrictions and a badge counts the ones with a flagged ingredient.
- [ ] Each variation tab shows its state chip; Nothing to change and Not suitable are one click; a diff is Same / Swap for / Leave out / Add per line.
- [ ] Preview shows the compiled recipe for the selected tab; the compile box lists the engine lines and refuses the two-restrictions-on-one-line case (per Q2).
- [ ] Scout: the Step 2 card shows the base recipe; a variation section appears only when its Step 3 count is above zero; Not suitable shows as a sentence with the count; the print sheet matches.
- [ ] Engine tests unchanged and green; new tests for the compiler (diff → lines), the state rules, and the count-gated card.

## Test Plan

- [ ] `Variations_CompileDiff_ToServesRules()` — Pancakes GF diff → mix except-GF; almond flour, egg, banana only-GF. Sandwiches GF → bread except-GF + GF bread only-GF.
- [ ] `Variations_State_IsNeverAmbiguous()` — no diff + no confirmation = Not reviewed; confirmation = Nothing to change; diff = Substituted; unsuitable = Not suitable.
- [ ] `Variations_RefuseTwoRestrictionsOnOneBaseLine()` (or accept, per Q2).
- [ ] `Card_ShowsVariationOnlyWhenCountAboveZero()` — GF 0 → no GF section; GF 1 → section; VG 1 on Bacon → Not suitable sentence.
- [ ] `PrintSheet_ListsOnlyActiveVariations()`.

## Technical Approach

### Schema — one migration `20260909100000_menu_monster_variations.sql`

```
mm_recipe_lines      + serves_restrictions text[] not null default '{}'  (backfilled from serves_restriction, which is then dropped)
                     check ((serves_rule = 'everyone') = (cardinality(serves_restrictions) = 0)); elements ⊂ {gf,nut,dairy,veg}
mm_recipe_variations recipe_id fk, restriction (gf|nut|dairy|veg), state (nothing|substituted|unsuitable), note text, updated_at; pk (recipe_id, restriction)
mm_variation_lines   id identity, recipe_id, restriction, position, op (swap|leave_out|add),
                     base_ingredient_id text (swap/leave_out: which base line — base lines are unique per ingredient),
                     ingredient_id text, qty_per_person numeric, unit_key text (swap/add: what goes in)
                     fk (recipe_id, restriction) → mm_recipe_variations on delete cascade
Backfill: for every recipe, each restriction R that appears on a line → variation (R, 'substituted');
          each `except R` line → leave_out of that ingredient; each `only R` line → add. Compiled lines are left as they are (they already ARE the compiled form).
          A recipe with only `except R` lines (D001 chicken, D003 ground beef for vegetarians) backfills as substituted-with-leave-out — the
          round trip reproduces today's compiled lines and today's shopping math exactly; tech-lead suggested `unsuitable`, but that would
          drop the leave-out on the next save and start buying chicken for the vegetarians. A leader can flip it to Not suitable in one click.
Unique: mm_recipe_lines (recipe_id, ingredient_id, serves_rule, serves_restrictions) — one base line per ingredient is what makes
          base_ingredient_id an unambiguous reference (tech-lead change 2); saveRecipe also refuses a duplicate base ingredient.
mm_save_recipe(p_recipe, p_lines, p_variations) — replaces variations + variation lines too; p_lines is the COMPILED output the action computed;
          writes BOTH serves_restrictions and (first element, for the old readers) serves_restriction until Migration B.
RLS on, zero policies; EXECUTE revoked (unchanged posture).
```

**Deploy order (tech-lead change 1, the Event Logistics rule — code-first for tightenings, DB-first for additive columns the code selects):**
Migration A (additive: the array column + backfill + the two tables + RPC v2) → `db push` → deploy the code (reads the array only) → confirm live → Migration B drops `serves_restriction` in a later release. Admin recipe edits pause during the minutes between push and deploy.

### Code (`next-app/src`)

- `lib/menu-monster/types.ts` — `RecipeLine.servesRestrictions: RestrictionKey[]`; `Variation { restriction, state, lines: VariationLine[] }`; `Recipe.variations`.
- `lib/menu-monster/engine.ts` — `servingsFor` sums the listed counts; `ruleText` names them ("everyone except gluten-free or vegetarian"); `restrictionWarnings` adds *Not suitable* for any restriction with count > 0.
- `lib/menu-monster/variations.ts` (pure, new) — `variationState(recipe, restriction, catalog)`: not_needed | needs_look | nothing | substituted | unsuitable; `compileRecipe(baseLines, variations)` → engine lines (one per ingredient × rule × restriction set; a base ingredient left out or swapped by several restrictions → `except [R…]`; an ingredient added by several → `only [R…]`); `variationsFromLines()` (the backfill's inverse, for tests); `crossRestrictionWarnings()` (Q3).
- `lib/menu-monster/catalog.ts` — loads variations for both loaders.
- `authoring.ts` — `recipeIssues` runs on the compiled lines; adds the cross-restriction warning; publish gate unchanged.
- `admin/library/menu-monster/recipe-builder.tsx` — tab strip using the shared `_components/tab-strip.tsx` in button mode (tech-lead change 4) (Everyone + added variations; "+ Add a variation" with the needs-a-look badge); Everyone tab = base lines with no who-gets-it select; a variation tab = state chip, Nothing to change / Not suitable buttons, diff rows Same / Swap for… / Leave out, Add a line; Preview filtered to the tab; compile box. `actions.ts saveRecipe` takes the draft (base + variations), compiles, calls the RPC; the audit row's details carry one "Variations" field ("gf: substituted (3 changes) · veg: not suitable") and the editor's dirty snapshot is the whole draft, variations included (tech-lead change 5).
- `(public)/…/planner.tsx` — Step 2 card, **Brad's treatment (ii) (Patrick, 2026-09-08)**: the base list always shows what an unrestricted person gets (no pills, no legend); under it one **strip per variation** — a toggle button "For gluten-free scouts: 3 changes ▸" that reveals only the diff inline ("½ cup pancake mix → 1 cup almond flour", "+ 1 egg", "− cheese"); *Not suitable* shows as a static "✕ Not for vegetarians" pill on the strip row. Toggle buttons, never `<details>` (D-070). The count-based notices stay: *Not suitable* with a count above zero → the red notice with the count; flagged-and-unreviewed gluten/nut → today's amber warning. `print-sheet.tsx` prints each item's variations as one diff line each.
- Tests: `menu-monster-variations.test.ts` (compiler, states, cross warnings), engine tests for multi-restriction rules, db test for the RPC + backfill, dom tests for the tab strip and the count-gated card.

## Implementation Steps

1. **Model + compiler (TDD)** — types, engine widening, `variations.ts`, catalog; tests. Commit.
2. **Migration + RPC** — column swap with backfill, the two tables, `mm_save_recipe` v2; `migration up` locally; db tests. Commit.
3. **Admin** — recipe-builder tab strip + diff editor + actions; dom tests; browser check. Commit.
4. **Public** — planner card + warnings + print sheet; dom tests; browser check. Commit.
5. **Gate + release** — lint / typecheck / test / build; qa-lead; changelog v1.125.0; `db push` (DB-first: the column swap is read by old code as missing `serves_restriction` → deploy code immediately after); memory.
