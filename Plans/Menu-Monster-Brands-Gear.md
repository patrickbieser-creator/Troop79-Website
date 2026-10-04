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

### R1 — planner polish — LIVE v1.154.0 (0711b1a, 2026-10-03)
Dialer on the meal's line, A–Z add list, no "Each person gets". No schema.

### R2 — Gear — LIVE v1.155.0 (2026-10-04)
Migrations `20261007100000_mm_gear` (mm_gear, mm_menus.gear_extras / gear_packed, mm_set_gear_packed) and
`20261007110000_mm_recipe_gear_steps` (data: gear + steps on 29 recipes, six staples), both in production.
Decisions made on Patrick's behalf:
- **`crew` access** (menu-access.ts): any signed-in scout who is not the owner may open an outing's menu
  read-only, shared or not, and tick gear (and, from R4, record purchases). Leaders may tick too; parents
  read only. The outing's page lists every linked menu for signed-in scouts and leaders. Reason: his "any
  signed-in scout can record, for menus linked to an outing" needs the scout to be able to reach the menu.
- **A scout's practice menu linked to a real outing is now visible to other signed-in scouts.** Unlink the
  outing to keep it private. Worth telling scouts.
- **Gear state lives beside the plan** (not in the Menu draft): ticks and extras save at once and never bump
  the menu's version. A menu holds at most 100 ticks.
- **Where gear lives** (trailer / patrol box / home) is my guess for the 27 seeded items — leaders correct it
  in Admin › Menu Monster › Gear.
- **Staples** are `staple = true` ingredients (store room: in Used, never Spent) with ESTIMATED package prices
  (note on each package). They cannot yet be switched to "buy this time" — that comes with the Shopping work in R3.
- **Shopping tab's flat "Gear you'll need" line is gone** (one place: the Gear tab); the printed shopping sheet
  keeps its gear line.
- **Local (not signed in) menus have no Gear tab yet.**
- qa-lead reviewed: tick cap, crew reads epoch-checked, packers' names hidden from shared viewers, rename
  rewrite paginated and error-checked.

### R3 — Brands — LIVE v1.156.0 (2026-10-04)
Migration `20261008100000_mm_brands` in production (the split ran there). Decisions made on Patrick's behalf:
- **A brand pick is menu-wide and lives in `shopping.brands`** — set from the Plan tab or the Shopping tab,
  the same field. (Jenna's "a shopper's pick is only a note" is moot: only the owner edits these; the crew
  records what was really bought in R4.)
- **Several brands split the need evenly**, each in its own cheapest package; each brand's count is editable.
  Changing the set of brands resets the counts to the split.
- **"About"** = no brand chosen and brands exist, or a chosen brand has no price. An ingredient with no brands
  at all (bananas) is never "about".
- **Typed brands**: signed-in people only (a menu kept on this computer can choose known brands, not type
  one). Cap: 40 unpriced brands of your own. Matching ignores case and punctuation but not accents.
- **Removing a brand that has packages** retires it and leaves the packages in the price book with no brand.
- **Moving a brand** is only offered while it has no packages (a package's size is in its ingredient's unit).
- **Store-room staples** default to the store room; "Buying it" stores an explicit choice for the menu.
  The label "From the troop pantry" became "From the troop store room" everywhere.
- **"Check the label"** shows when the menu counts a diet that the ingredient (or one of its brands) is
  flagged for and the line is any-brand or names a New brand; always for an unreviewed typed-in ingredient.
- Not built yet: a "new brands" list on the admin home (R6), a recipe's suggested brand (R6).

### R4 — What we bought — LIVE v1.157.0 (2026-10-04)
Migration `20261009100000_mm_bought` in production. Decisions made on Patrick's behalf:
- **Recorded per MENU, one line at a time** (`mm_menus.bought`, mm_set_bought_line merges a line under a row
  lock). The outing-wide list (R5) reads these; it does not replace them.
- **A line nobody touched has no stored entry**: "not confirmed" until the done tick, then "as planned".
- **Only a price the recorder actually changed is reported to the price book** (the page sends the price each
  box first showed); a line confirmed with no brand named teaches the book nothing (his "a nod").
- **"Something else"** needs a brand, a size and a price; the brand joins at once and its package is banded
  against the troop's packages like any scout-added one (held when far out). At most two new brands per line.
- **±30%** (`PRICE_BAND`), from 50%.
- **A shared (public) viewer has no "What we bought" tab** — what was paid was never shown to them.
- **The old "What you paid"** section, its component and `paid-view.ts` are deleted; `mm_menus.actuals` and
  `saveActualsAction` stay (old entries read as a fallback until a line is recorded the new way).
- Prices are typed as dollars and cents only ("5,50" is refused, not read as 550).
- qa-lead reviewed: validate before creating a brand/package, no report for an untouched price, inputs wait
  while saving, legacy lines survive a save.

### R5 — v1.158.0, 2026-10-04 (patrols + the outing's shopping list)

Decisions made on Patrick's behalf:

- **Patrol is a free-text box with suggestions** (the active scouts' patrols + "Whole troop"), not a required
  pick: a menu that names no patrol still works, and the outing page then calls it by the menu's name.
- **The outing page lives at `/library/menu-monster/outings/[entryId]`**, linked from the event page's "Menus
  for this outing" for signed-in scouts and leaders only. Parents and the public do not get it. A draft outing
  is leaders-only; only overnight categories have one.
- **The merged list is read-only.** Needs are added across every menu and priced once. Brands = every brand any
  menu chose for the ingredient. A line is "not buying" only when every menu that needs it brings it; if one
  patrol brings and another buys, the list buys for both (a little over, never short).
- **A count changed on one menu's Shopping tab is NOT carried to the outing list** (two menus could disagree);
  the page says so. The "less than each patrol shopping alone" figure leaves those changes out on both sides.
- **Everyone sees the same page**: menus are read the crew's way, so a recipe its author has not shared is left
  off even for the author.
- **Recording stays per menu** ("What we bought" on each patrol's menu); the outing page adds them up and says
  "projected" until every menu has ticked "We're done shopping". Outing-level recording and Admin › Purchases
  moved to R6.
- qa-lead reviewed (ship): fixed the count-override skew, limited the page to overnight outings, labelled the
  planned column "on its own".
