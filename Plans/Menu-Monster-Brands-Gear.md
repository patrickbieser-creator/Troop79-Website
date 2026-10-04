# Menu Monster — brands, gear, and "What we bought"

**Status:** IN BUILD (started 2026-10-03, overnight, on Patrick's go-ahead: "build the plan and build and deploy the
updates while I sleep making reasonable decisions on my behalf. I need to see a live working version with real data").
**Design of record:** `D:\Projects\Troop Menu Monster\prototypes\concept-f-kinds\` — `BRIEF.md` (every decision,
dated), `JENNA-NOTES.md`, `ADMIN-CONSIDERATIONS.md`, and the clickable prototype (Brad). Approved look: concept-e.
**Data drafts:** `D:\Projects\Troop Menu Monster\data\recipe-gear-steps-draft.md`, `package-brand-split.json`.

## Why

A meal is planned big picture first ("Pancakes and bacon with oatmeal, cereal, milk, orange juice"), then in detail
only where the planner cares (Aunt Jemima, thick-sliced bacon), then overridden at the store by whoever shops, then
recorded up to a week later by whoever has the receipt. Today the plan cannot say "any brand", brand and package are
one thing, recording is line-by-line and owner-only, and the gear list is a flat list of words with no data behind it.

## The model

- **Ingredient → brands → packages.** `mm_brands` (ingredient, name, optional diet override, who added it, retired /
  merged). `mm_packages.brand_id` (null = no brand) and `size_label`. A brand a scout types joins at once.
- **A menu's brand choice** is per ingredient for the whole menu: `shopping.brands[ingredientId] = [{ brandId,
  qty? }]`. Empty = any brand (estimate from the cheapest known package, "about"). Several brands split the packages.
- **What we bought** replaces "What you paid": per line a list of purchases (package or brand, how many, price each,
  who, when) or "not bought"; a "We're done shopping" tick. Recorded per OUTING when the menu is linked to one (the
  troop shops together), otherwise per menu. Any signed-in scout can record on an outing's menus.
- **Gear.** `mm_gear` — the troop's gear list (name, where it lives, one-per-person). Recipes keep `equipment text[]`
  (names; "× 2" in the name is a count). A menu keeps its extras and its Packed ticks. Reusable gear counts the most
  any one food / meal needs, never the sum. Consumables are shopping-list staples from the troop store room.
- **Patrols.** A menu belongs to a patrol (text; "Whole troop" is one). An outing has several menus; the outing
  shopping list merges them.

## Releases (each: tests first, gate green, DB-first migration, commit, push, changelog)

| # | Release | What ships |
|---|---|---|
| R1 | Planner polish | Add list A–Z; People dialer on the meal's line; foods stay open when another opens; no "Each person gets" heading. No schema. |
| R2 | Gear | `mm_gear` + menu gear state; **Gear tab** (grouped, Packed ticks with names, Add gear, mess kits follow People, change marker, print); "Steps · Gear" line on an open food; recipe editor's gear chips from the troop list; Admin › Gear. Then DATA: gear + steps on the 29 recipes, six store-room staples. |
| R3 | Brands | `mm_brands`, package split applied; engine prices a brand set; Plan brand chooser (chips, Any brand, type a brand, per-brand counts); Shopping shows brands, "about", **Updated** pill, "check the label"; Admin › Catalog brand management (rename, retire, remove, merge, move, diets). |
| R4 | What we bought | The checklist (prefilled, accordion, Didn't buy it / Different brand / Add another brand inline), per-line recorder, done tick, ±30% band, any signed-in scout on an outing's menus. Replaces "What you paid". |
| R5 | Patrols + outing | Patrol on the menu; outing shopping list merged across its menus; outing-level recording; Admin › Purchases. |
| R6 | Admin + recipes | "Needs attention" home; compact single-food editor; anyone signed in can write recipes; a recipe's suggested brand ("Suggest this for the recipe"). |

Deploy-order rule stands: additive DB objects first, code second, drops later.

## Decisions made on Patrick's behalf during the build

Logged here as they are made, each with the reason, so he can reverse any of them.

(see "Build log" below)

## Test plan (written before each release's code)

- **Pure (db project, no DB):** engine pricing with brand sets (one brand, several, unpriced brand, short, any
  brand = today's result exactly); gear roll-up (max not sum, × N in the name, per-person, extras, change marker);
  purchases → totals (projected vs done, not bought, several brands); band at ±30%.
- **DB:** migrations (brand split idempotent, every package keeps its price and id); RPCs (add brand, merge, move,
  remove → menus fall back to any brand; record purchase → price history + band); access (owner, any signed-in scout
  on an outing menu, anonymous refused, unlinked menu refused); gear list writes.
- **DOM:** Plan (dialer on the line does not toggle the meal, A–Z list, multi-open, brand chooser states), Shopping
  (brands, Updated pill appears / clears), Gear tab, What we bought (prefill, Tab / Enter price to price, inline
  choices, done tick), admin screens.
- **Regression:** every existing Menu Monster test stays green; a menu saved before this reads and prices the same.

## Build log

(appended per release)
