# Menu Monster — Cooking MB Meal Planner as a Library Topic Shelf

**Status:** Built 2026-09-07 — in the working tree, awaiting commit + deploy (v1.123.0)
**Started:** 2026-09-07
**Priority:** High
**Origin:** D:\Projects\Troop Menu Monster (discovery docs in `Plans/Discovery/`, prototypes in `prototypes/`, seed in `data/menu-monster-seed.json`)

## Overview

Menu Monster is a meal-planning tool for scouts working on the Cooking merit badge (requirements 4b, 5b, 6b). A patrol sits around one laptop, picks a meal and its menu items, sets how many people are eating and how many have gluten or nut restrictions, and gets a shopping list with the cost per person shown three ways: **Spent** (what the packages cost at the register), **Used** (what the recipes actually consume), and **Leftover** (the difference). The list prints as a store sheet with blank boxes for quantity bought and actual price, plus a counselor summary.

This phase ships the **scout-facing planner** as a new **Topic Shelf** in the Resource Library at `/library/topic/menu-monster`, available to everyone with no login, seeded with the troop's breakfast, lunch, dinner, snack and dessert items and Costco/Kroger prices. **Leader tools** (recipe builder, price book, suggestion review) are a later phase; until then the catalog is edited by migration.

## Problem / Opportunity

Menu planning is the hardest part of the Cooking badge: scaling per-person amounts to a patrol, converting recipe units to package sizes, honoring restrictions, and working out cost per person. Patrick's spreadsheet proved the calculation but is unusable by a 13-year-old (silent lookup failures, four jobs in one grid, restriction logic that double-counts the gluten-free scout). The prototypes in the Menu Monster repo validated the model with Patrick; this plan ports the validated Concept A planner into the site.

## Decisions carried in from discovery (do not re-litigate)

| Decision | Value |
|---|---|
| Headcount | One number: scouts and adults together. Adults are part of the cost. No adult split. |
| Restrictions | Counts, never names. First-class: gluten-free, nut-free, dairy-free, vegetarian. Only **gluten and nuts** raise allergen warnings. |
| Recipe variants | One recipe; each ingredient line has a `serves` rule: everyone / everyone except [restriction] / only [restriction]. |
| Units | Package yield is stored in the ingredient's recipe unit (Option C). Same-family units convert by table; cross-family units bridge through a per-ingredient conversion (density) table. All count units are one family with a per-ingredient noun. |
| Package choice | Default = lowest total spend that covers the need, single-select per ingredient, purchase quantity editable. |
| Costs | Spent = Σ packages × price. Used = Σ need ÷ yield × price. Leftover = Spent − Used. Headline = **Spent per person**; also show per meal. Staples (patrol box) count in Used, not Spent. |
| Where from | Each shopping line can be Buy at the store / From the troop pantry / Bringing from home, with a note. Non-buy lines count in Used, not Spent, and print in a "Bringing, not buying" table. |
| Store | Printouts are primary. The printed list captures qty bought and actual price. Phone view and price scanning are future. |
| Budget | Configurable target per person with a readout that is never color-only. |
| Scouts and recipes | Scouts cannot edit global recipes. "Suggest a change" exists as a path; review UI is deferred with leader tools. |
| Scope order | Camp (5b) first. Trail (6) and home (4) later. |
| Pancake mix | 10 lb bag = 36 cups (160 oz ÷ 4.5 oz per cup). |

## Acceptance Criteria

- [x] `/library` shows a **Menu Monster** shelf card (icon 🍳) among the topic shelves, with no change to `TopicShelves()` code — the card comes from a seeded `library_topics` row.
- [x] `/library/topic/menu-monster` renders the planner above the shelf's (initially empty) resource list, for an anonymous visitor, with `export const dynamic = 'force-dynamic'` (D-040) and no client-side Supabase access (D-051/D-239: RLS on, zero policies, service-role reads on the server only).
- [x] The planner works end-to-end with keyboard only: choose a meal (breakfast / lunch / dinner / snack / dessert) → tick menu items → set headcount (2–16) and restriction counts → shopping list with need, package, qty to buy with visible math, Spent / Used / Leftover per line and in a totals strip with per-person and per-meal figures → budget readout → "Where from" + note per line → **Print shopping list** produces the store sheet + counselor summary.
- [x] Restriction semantics are correct: with GF = 1 of 10, pancake mix is computed for 9 and almond flour for 1 (no double count). An item with a gluten or nut ingredient and no swap line shows an inline warning; vegetarian and dairy do not warn.
- [x] Draft autosaves to `localStorage` (key `troop79.menuMonster.plan.v1`), survives reload, and has a two-click "Start over" (no `confirm()`/`alert()`).
- [x] Only recipes with `status = 'published'` appear. Packages with a missing yield are excluded from pricing and the line shows "Not priced yet".
- [x] Seed: every ingredient, package, conversion and recipe in `D:\Projects\Troop Menu Monster\data\menu-monster-seed.json` is present after `npx supabase migration up` (37 ingredients, 59 packages, 13 conversions, 20 recipes), plus at least 6 additional lunch/dinner/snack/dessert items so every meal slot has choices.
- [x] Quality gate green: `npm run lint` (0), `npm run typecheck`, `npm test` (both vitest projects), `npm run build`.
- [x] `changelog.html` gains a `RELEASE v1.123.0` block (v1.122.0 was taken by library-mb phase 2 the same day) and the "Last updated" line moves.
- [x] Nothing in this work touches the in-flight Library-MB consolidation files (`library/mb/**`, `lib/mb-scout-progress.ts`, `tests/mb-scout-progress.test.ts`, `tests/library-mb-rows.test.tsx`) or the Fast Entry files behind B-005.

## Test Plan

Engine tests are pure TS in the `db`-agnostic style (no browser, no DB) so they run in the `db` vitest project without Postgres access — name them `tests/menu-monster-engine.test.ts`.

- [x] `Engine_ConvertsSameFamilyUnits_WhenLineUnitDiffersFromRecipeUnit()` — 2 Tbsp on a cup ingredient = 0.125 cup.
- [x] `Engine_BridgesCrossFamilyUnits_WhenConversionRowExists()` — 1 tsp cinnamon priced in grams = 2.6 g; 1 lb bacon priced in slices = 16; reverse direction works.
- [x] `Engine_RejectsUnit_WhenNoConversionPath()` — slice on an egg ingredient → null.
- [x] `Engine_SplitsServings_ByRestrictionRule()` — 10 people, GF 1: except-GF line serves 9, only-GF line serves 1, everyone line serves 10.
- [x] `Engine_RoundsCountNeedUp_BeforePackaging()` — 0.25 orange × 10 = 3 oranges.
- [x] `Engine_PicksLowestSpendThatCovers_WithLeftoverTiebreak()` — 30 slices: 2 × Oscar Mayer ($14.98) beats 1 × Kirkland ($18.15); at 16 people (48 slices) Kirkland wins.
- [x] `Engine_ComputesSpentUsedLeftover_PerLineAndTotals()` — known fixture totals; staples in Used only; "bring" lines in Used only; unpriced excluded and listed.
- [x] `Engine_WarnsOnlyForGlutenAndNuts()` — bacon with vegetarian count does not warn; bread with GF count and no only-GF line warns.
- [x] `Engine_FormatsQuantities_FractionsForVolumeWholeForCounts()` — ½ cup, 3 slices, 2.6 g.
- [x] `Catalog_LoadsPublishedRecipesOnly_WithPackagesAndConversions()` — `tests/menu-monster-db.test.ts`, db project, against the local stack: seed counts match, a draft recipe is excluded, RLS is enabled with zero policies on all `mm_*` tables (mirror `tests/resource-library.test.ts`).
- [x] `Planner_RendersSeedPlanAndUpdatesTotals_OnHeadcountChange()` — `tests/menu-monster-planner.test.tsx`, dom project: renders with a fixture catalog, changes headcount 10 → 16, asserts the bacon line switches package and the live region updates.

## Technical Approach

### Schema — one migration `next-app/supabase/migrations/20260907150000_menu_monster.sql`

All tables `mm_*`, RLS enabled with **zero policies** (D-239; the server reads with the service role). Retire, don't delete, like `library_topics`.

```
mm_ingredients   id text pk (slug), name, unit_kind (volume|weight|count), unit_key, unit_one, unit_many,
                 section (produce|dairy|meat|bakery|dry), staple bool, avoid text[] (restriction keys),
                 created_at, retired_at
mm_conversions   id bigint identity, ingredient_id fk, from_unit, to_unit, factor numeric, label   -- Option C density rows
mm_packages      id text pk, ingredient_id fk, name, store, price numeric(10,2), yield numeric (in recipe unit; null = unusable),
                 yield_unit_label (why unusable), noun, sold_size numeric, sold_unit, note, as_of date, created_at, retired_at
mm_recipes       id text pk, name, status (draft|published|retired), meal_fit text[], food_groups text[], camp bool, trail bool,
                 method, steps_md, sort_order, created_at, updated_at
mm_recipe_lines  id bigint identity, recipe_id fk, position int, ingredient_id fk, qty_per_person numeric, unit_key (null = recipe unit),
                 serves_rule (everyone|except|only), serves_restriction (gf|nut|dairy|veg|null)
```

Seed rows ship as INSERTs inside the migration (same mechanism as the `library_topics` shelf rows and the D-006 lookup tables), so a future full prod restore needs `TRUNCATE mm_* … RESTART IDENTITY CASCADE` before re-running migrations, exactly as D-006 notes for the existing lookup tables.

Units, restrictions, sections, meals and food groups are **code constants** (`lib/menu-monster/units.ts`), not tables — PATTERNS.md: don't add a lookup table for a fixed list. Plans, purchases and suggestions are **not** persisted this phase (localStorage); tables come with leader tools.

The migration also inserts the shelf row:
`('menu-monster', 'Menu Monster', 'Plan a patrol meal for the Cooking merit badge …', '🍳', 60)` into `library_topics`, and seeds all `mm_*` rows from `data/menu-monster-seed.json` (generate the INSERTs with a one-off node script; commit the SQL, not the script).

### Code layout (`next-app/src/`)

```
lib/menu-monster/units.ts        U table, families, stepFactor/famFactor, conv(lineUnit, ingredient, conversions), supportedUnits, qty parsing/formatting
lib/menu-monster/engine.ts       servingsFor, recommendedPackage, buildLines(plan, catalog), totalsOf, restrictionWarnings — pure, no React
lib/menu-monster/types.ts        Catalog, Ingredient, Package, Conversion, Recipe, RecipeLine, Plan, ShoppingLine, Totals
lib/menu-monster/data.ts         loadMenuMonsterCatalog(): server-only, createAdminClient(), fetchAllRows(), published recipes only
lib/supabase/types.ts            add MmIngredientRow, MmConversionRow, MmPackageRow, MmRecipeRow, MmRecipeLineRow (hand-maintained)
app/(public)/library/_tools/registry.tsx           TOPIC_TOOLS: Record<slug, async server component>  — the one hook the shelf page needs
app/(public)/library/_tools/menu-monster/shelf-tool.tsx   server: loads catalog → <MenuMonsterPlanner catalog />
app/(public)/library/_tools/menu-monster/planner.tsx      'use client': steps, headcount dial, restriction counters, list, totals, print button
app/(public)/library/_tools/menu-monster/print-sheet.tsx  the store sheet + counselor summary (rendered always, shown by @media print — D-017 fixed template)
app/(public)/library/_tools/menu-monster/planner.module.css
app/(public)/library/topic/[slug]/page.tsx        add: const Tool = TOPIC_TOOLS[slug]; render <Tool/> before the resource list; when a tool is present and there are no resources, skip the "waiting for its first item" EmptyState (keep the Suggest CTA)
```

### Porting rules (from `D:\Projects\Troop Menu Monster\prototypes\concept-a-headcount-dial\index.html`)

- Port the **behavior and copy**, not the prototype's CSS. Use the site's design system: `PageHeader` is already rendered by the shelf page; inside the tool use `PageShell`, `SectionDivider`, `Button`, `Badge`, `EmptyState`, `Notice`; tokens from `globals.css` only, no raw hex (design-system census test enforces); form inputs 16px; dates via `lib/format-date`; money via `lib/event-money` `money()`.
- Add a **meal step** the prototype lacked: meal slot picker (breakfast/lunch/dinner/snack/dessert) filters menu items by `meal_fit`; the plan stores `meal`.
- Keep the prototype's rules: no accordions for menu items or restrictions (D-070); package alternatives may sit behind a click on the line, directly under the line header; status never color-only; 44px targets; `aria-live` totals; two-click reset; autosave.
- Client state: hydrate from `localStorage` in one mount effect (pattern: `library/mb-grid.tsx`); render the seed plan on first paint so the page is never empty.
- Print: `@media print` in the module CSS hides the site chrome (see `globals.css:142-147` for the existing pattern) and shows `print-sheet.tsx`.

### What is deliberately deferred

Leader tools (recipe builder, price book, suggestion review, unit editor), plan persistence and share links, phone store mode, trail mode (weight, refrigeration, repackaging), MyPlate tagging UI, write-back to advancement. Each has a prototype or a discovery note in the Menu Monster repo.

## Implementation Steps

1. **Data + engine** — migration with seed and shelf row; `lib/supabase/types.ts` rows; `lib/menu-monster/{types,units,engine,data}.ts`; `tests/menu-monster-engine.test.ts`; `tests/menu-monster-db.test.ts`. Apply with `npx supabase migration up` (**never** `supabase:reset` — it replays a data-only backfill that asserts prod row counts and wipes local data; recovery is `refresh-local-from-prod.sh`), then `npm run typecheck`, `npm test`.
2. **Shelf tool UI** — registry hook in `[slug]/page.tsx`; `shelf-tool.tsx`, `planner.tsx`, `print-sheet.tsx`, `planner.module.css`; `tests/menu-monster-planner.test.tsx`. Run lint, typecheck, test, build; open `/library` and `/library/topic/menu-monster` on the local stack.
3. **Review** — qa-lead pass (a11y, RLS, no client Supabase, census test, print), fix findings.
4. **Release bookkeeping** — `changelog.html` v1.122.0; Agents memory (STATE, DECISIONS D-265+ for the tool-shelf registry and the `mm_*` schema); this plan → Completed when live.

## Open Questions

None blocking. Two items for Patrick after first use: (1) whether anonymous plans should be saveable by link (needs a table + expiry), (2) whether "Suggest a change" should route into the existing `/library/submit` flow with a `target=topic:menu-monster` until the leader review UI exists.
