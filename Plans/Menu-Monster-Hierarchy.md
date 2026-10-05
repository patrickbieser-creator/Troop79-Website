# Menu Monster — the hierarchy and what each level holds

Written 2026-10-05 from the live system (v1.169.0), in answer to Patrick's outline of how he thinks about
Menu Monster. It describes what exists today, level by level, and marks the places where today's structure
differs from that outline. It is a reference, not a plan: nothing here is a proposed change except the one
open decision at the end.

## The shape in one picture

```
SUPPLY — what the troop can buy                 DEMAND — what the troop will eat

Food  (Salt, Flour, Cookies)                    Menu  (High Cliff, Eagle patrol)
 ├─ Conversions  (1 cup = 4.25 oz)               └─ Meal  (Day 1 breakfast, 8 people)
 └─ Brand  (Morton, Store brand)                     └─ Menu item  (Pancakes, Bacon, Cookies)
     └─ Package  (26 oz · Metro Market · $1.99)           └─ Ingredient line  (½ cup pancake mix each)
                                                               └─ points at a Food
```

The two sides meet at one point: an **ingredient line** on a menu item names a **food** and says how much
of it one person gets. Everything a menu knows about cost, shopping and diets is worked out by following
that link.

Three small supporting lists sit beside the hierarchy: **Stores**, the troop's **Gear list**, and the
built-in **unit ladders** (3 tsp = 1 Tbsp, 16 oz = 1 lb).

---

## Supply side

### Level 1 — Food

*In the system this is called an "ingredient". Admin: Price book.*

One thing the troop buys: salt, flour, bacon, cookies. It may be used inside recipes, served on its own,
or both.

| Attribute | Example | Notes |
|---|---|---|
| Name | Salt | |
| Measured in | tsp · cups · slices · "cookies" | ONE unit per food: the unit recipes are written in. It is not the unit it is sold in. A counted food names its own unit (cookie / cookies). |
| Store section | Dry goods & pantry | Groups the shopping list in store order. |
| Patrol-box staple | yes / no | A staple comes from the store room: it counts as Used, never Spent. |
| Diet flags | not gluten-free, not vegetarian | Where a diet warning starts. Gluten and nuts raise warnings; dairy and vegetarian only inform. |
| Conversions | 1 cup = 4.25 oz | See below. Belongs to the food, not to a recipe. |
| Status | live · retired | |
| Who added it | a leader, or a scout | A scout's typed-in food waits for a leader to keep it, match it to an existing food, or reject it. |

**Differs from the outline:** "unit of measure as purchased" is not on the food. The same food is sold by
the pound, the ounce and the half gallon, so the purchased unit is on each package (level 3).

### Level 1a — Conversion (belongs to a food)

How a food gets from the store's unit to the recipe's unit when they are different kinds of measure
(weight to volume, or weight to a count).

| Attribute | Example |
|---|---|
| From unit → to unit | oz → cups |
| The number | 1 cup = 4.25 oz |
| Where it comes from | "all-purpose flour ≈ 4.25 oz per cup", or "20 oz made 4 cups — Sun-Maid Raisins" |

Same-kind conversions (tsp ↔ cups, oz ↔ lb, dozen) are built in and never entered. A conversion is
remembered automatically the first time a leader types how much a package makes.

**Differs from the outline:** conversion was listed under recipes. A cup of flour weighs the same in every
recipe, so it is a fact about the food.

### Level 2 — Brand

*Admin: a heading under the food in the Price book.*

A brand or a variety of a food: Morton, Chips Ahoy, Fuji, Whole. This is the level a scout chooses on a
menu ("any brand" is the default).

| Attribute | Example | Notes |
|---|---|---|
| Name | Morton | |
| Diet flags of its own | Rice Chex is gluten-free though cereal is not | Blank = same as the food. |
| Priced or not | "No price yet" | A brand with no package under it is a name only. |
| Who added it | a leader, or anyone signed in | A brand typed on a menu joins the list at once. |
| Status | live · removed · merged into another | A merge carries its packages and the menus that chose it. |

A food does not need brands. Packages with no brand sit under "No brand yet".

### Level 3 — Package

*Admin: one line under a brand. On screen it is described by what it is — size · store · price — and the
word "package" is not shown to leaders.*

One specific thing on a shelf. This is the only level that has a price.

| Attribute | Example | Notes |
|---|---|---|
| Brand | Morton | Optional. |
| Product name | Morton Iodized Salt | Optional when adding; made from brand + food + size. |
| Size on the label | 26 oz | The purchased unit lives here. |
| Store | Metro Market | From the troop's store list. |
| Price | $1.99 | |
| Price as of | Jan 15, 2026 | Older than 90 days is flagged "check it" but still used. |
| How much it makes | 122 tsp | In the food's own unit. Suggested from the size when a conversion exists; a package with none cannot be used on a menu. |
| What one is called | box · bag · dozen · stick | |
| Note | | |
| Status | live · retired · waiting for a leader | A scout-added package is held until a leader approves it. |
| Price history | $1.79 → $1.99 | Every change, who reported it, and whether a leader applied it. A scout's price outside ±30% is held for a leader. |

---

## Demand side

### Level 4 — Menu item (a recipe or a single food)

*Admin: Food & recipes. This is what a scout picks when planning a meal.*

Anything that can go on a plate. The system stores one kind of thing here. What it is called follows from
what it holds:

- **Single food** — exactly one ingredient line and no diet swap (Cookies, an apple, bacon).
- **Recipe** — two or more ingredient lines, or a diet swap (Pancakes).

| Attribute | Example | Notes |
|---|---|---|
| Name | Pancakes | |
| Ingredient lines | see level 4a | |
| Diet swaps | see level 4b | |
| Steps | "Mix, pour, flip." | A single food can have them too (bacon is cooked). |
| Gear | Griddle, spatula | From the troop's gear list. Gear belongs here, not on the food. |
| Cooking method | stove · Dutch oven · foil · grill · no-cook | |
| Meal fit | breakfast, snack | Which meals it is offered under. Required to publish. |
| Food groups | grain, protein | MyPlate. |
| Where it works | camp · trail | Trail = no fridge, light. |
| Suggested brand | Krusteaz for the pancake mix | A menu that adds the recipe starts with it and can change it. |
| Status | draft · published · retired | Only published items are offered to planners. |
| Author and credit | a leader, or a scout ("Leo B.") | A scout's recipe is theirs to edit; a leader can retire it or change the credit. |
| Shared | private · shared with the troop | For scout recipes. |
| Copied from | another recipe | |

**Differs from the outline (less than it did):** the outline treats a single food as one thing that is both
an ingredient and a menu item. Underneath there are still two records — a food (level 1) and a one-line
menu item (level 4) — but since v1.172.0 they are **tied** and behave as one entry: the Price book's "On
the menu by itself" section creates and edits the menu item, the two share one name, and retiring the food
takes it off the menu. A one-ingredient *dish* with its own name ("Eggs - Hard-boiled") is not tied.

### Level 4a — Ingredient line (belongs to a menu item)

| Attribute | Example | Notes |
|---|---|---|
| Food | Pancake mix | The link to the supply side. |
| Amount **per person** | ½ | Everything is written per person; headcount does the multiplying. |
| Unit | cups | Blank = the food's own unit. Any unit a conversion can reach is allowed. |
| Who gets it | everyone · everyone except gluten-free · only gluten-free | Written by the diet swaps, not by hand. |

**Missing from the outline:** amount per person. It is the number the whole planner turns on.

### Level 4b — Diet swap (belongs to a menu item)

One per diet (gluten-free, nut-free, dairy-free, vegetarian) that the item has an answer for.

| Attribute | Example |
|---|---|
| Diet | Gluten-free |
| Answer | nothing changes · substituted · not suitable |
| The changes | swap pancake mix for almond flour · leave out the bacon · add fruit |
| Note | |

**Differs from the outline:** diet restrictions were listed under recipes. The warning comes from the food
(level 1) or its brand (level 2); the recipe holds only what to do about it.

### Level 5 — Menu

*Scouts: Menu Monster → My menus. A saved menu has tabs: Plan, Shopping, Gear, What we bought,
Conversions, Share.*

A plan for feeding a group across one or more days.

| Attribute | Example | Notes |
|---|---|---|
| Name | High Cliff campout | |
| Owner | the scout or adult who saved it | Ownership is on the menu, not on each meal. |
| Where you're cooking | home · camp · trail | Filters which items are offered. |
| Outing | High Cliff (calendar) | Optional. An outing's menu is open to its crew. |
| Patrol | Screaming Eagles · Whole troop | Several patrol menus merge into one outing shopping list. |
| Start date and days | Oct 16, 2 days | |
| People | 8 | The default for every meal. |
| Diet counts | 1 gluten-free, 2 vegetarian | These switch on the recipes' diet swaps. |
| Budget | $4.00 a person, per meal | What the cost is judged against. |
| Meals | see level 5a | |
| Shopping choices | which brand and size · quantity override · bring from home / patrol box | Per food, for the whole menu. |
| Gear | extras added · what is packed and by whom | The list itself is worked out from the menu items. |
| What we bought | brand, size, quantity, price paid, by whom | Feeds prices back to the Price book. |
| Sharing | private · shared with the troop | |
| Leader's review | a note, who, when | |

**Worked out, not stored:** the merged shopping list, cost per meal and per person, over or under budget,
the gear packing list, and the diet warnings.

**Who can do what on a menu**

| Who | Can |
|---|---|
| Owner | everything |
| Crew of the outing (any signed-in scout on that outing) | read; tick gear; record what was bought |
| Parent of the owner | read |
| Anyone the troop shared it with | read (no prices paid, no names on ticks) |
| Leader | read; review note; hide from the shelf |

**Differs from the outline:** "meal owner(s) and permissions" — ownership and permissions are per menu.

### Level 5a — Meal (belongs to a menu)

| Attribute | Example | Notes |
|---|---|---|
| Day | Day 1 | |
| Slot | breakfast · lunch · dinner · snack · dessert | The meal's name is the day and the slot; there is no free-text meal name. |
| People | 8 | Blank = the menu's count. |
| Menu items | Pancakes, Bacon, Orange juice | Recipes and single foods together. |
| Changes for this menu only | "use 1 cup instead of ½" | A menu can adjust a recipe without changing the recipe. |

**Differs from the outline:** "meal name" — a meal is identified by day and slot.

---

## Supporting lists

| List | Holds | Used by |
|---|---|---|
| Stores | name, order, retired | every package |
| Gear list | name, where it lives (troop trailer · patrol box · home), one per person or shared | menu items and the menu's Gear tab |
| Unit ladders | tsp → Tbsp → fl oz → cup → quart → gallon; g → oz → lb; dozen | built in, never edited |
| Diets | gluten-free, nut-free, dairy-free, vegetarian | foods, brands, diet swaps, menus |

---

## The outline, corrected

| The outline said | As it is |
|---|---|
| Single foods: standalone on a menu or an ingredient in recipes | True of a **food**, but standing alone needs a one-line menu item around it (two records today). |
| Single foods: brands, packages and prices. Sometimes gear | Brands, packages and prices: yes. Gear is on the menu item. |
| Single foods: unit of measure as purchased | The food has one "measured in" unit. The purchased unit is on each package. |
| Recipes: one or more ingredients. Instructions and gear | Yes, plus an **amount per person** on every line. |
| Recipes: allergy / sensitivity restrictions | The flag is on the food or brand. The recipe holds the swap. |
| Recipes: conversion from purchased unit to recipe unit | On the food. |
| Menus: meal name, people count, recipes, single foods | Day + slot, people (menu default, meal override), menu items; plus diet counts, budget, outing, patrol. |
| Menus: meal costs | Worked out from the lines, the chosen packages and the people count. |
| Menus: meal owner(s) and permissions | Per menu, not per meal. |

## Open decision

**Should a single food be one record instead of two?**

Today Cookies is a food in the Price book *and* a one-line menu item in Food & recipes. That is the source
of several confusions: Cookies could exist as a "recipe" with no ingredient; renaming has to cover both;
"single food" is a classification nobody stores.

The outline's model is simpler: a food with a switch for "can be served on its own", carrying how many each
person gets, its meal fit, and any steps and gear for serving it. Salt and flour would have the switch off.

**Decided 2026-10-05:** one entry to people, two tied rows underneath. Shipped as v1.172.0; the reasons a
true merge was set aside and what was built are in `Plans/Completed/Menu-Monster-Single-Food-Entry.md`.
