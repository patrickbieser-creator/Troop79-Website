/**
 * Menu Monster — the planning engine. Pure: no React, no DB.
 *
 * Ported behaviour-for-behaviour from the validated Concept A prototype
 * (D:\Projects\Troop Menu Monster\prototypes\concept-a-headcount-dial) with
 * Concept C's unit conversion on recipe lines. The rules it encodes are the
 * discovery decisions in Plans/Menu-Monster.md — don't re-litigate them here:
 *
 *   servings   everyone = H; except X = H − R[X]; only X = R[X]   (no double count)
 *   need       Σ qtyPerPerson × conv(lineUnit → recipe unit) × people; count
 *              units round UP before packaging (you can't buy half a banana)
 *   package    default = lowest total spend that covers the need, tie → less
 *              leftover; single-select per ingredient; purchase qty editable
 *   Spent      Σ qty × price          (what the register charges)
 *   Used       Σ need ÷ yield × price (what the recipes actually consume)
 *   Leftover   Spent − Used
 *   staples    patrol-box items count in Used, never Spent
 *   bring      pantry/home lines count in Used, never Spent, and print separately
 *   unpriced   no usable package → excluded from every total and listed
 *   warnings   only gluten and nuts warn; a swap line ('only X') silences it
 */

import { centralToday } from '@/lib/dates';
import type {
  Brand,
  BrandPick,
  Catalog,
  Ingredient,
  LinePart,
  LineSourceRef,
  LineStatus,
  MealSlot,
  Package,
  Plan,
  Recipe,
  RecipeLine,
  RestrictionKey,
  RestrictionWarning,
  ShoppingLine,
  Totals
} from './types';
import { MEALS, RESTRICTIONS, RESTRICTION_BY_KEY, SECTION_ORDER, WARN_ALLERGENS, conv, qtyText } from './units';

const EPS = 1e-9;

/** A package can be priced only when its yield (in the recipe unit) is known. */
export function isUsable(p: Package): p is Package & { yield: number } {
  return p.yield != null && p.yield > 0;
}

/** Recipes that fit a meal slot, in catalog order. */
export function recipesForMeal(catalog: Catalog, meal: MealSlot): Recipe[] {
  return catalog.recipes.filter((r) => r.mealFit.includes(meal));
}

/** A restriction count can never exceed the headcount; if the dial drops below
 *  it we keep the typed value (so the error shows) but compute with the clamped one. */
export function effectiveRestrictions(plan: Plan): Record<RestrictionKey, number> {
  const out = {} as Record<RestrictionKey, number>;
  for (const r of RESTRICTIONS) {
    out[r.key] = Math.min(Math.max(0, plan.restrictions[r.key] || 0), plan.headcount);
  }
  return out;
}

/** How many times a line's amount is used on one meal row: per person = the people it feeds; for the whole
 *  meal = once, as long as the serves rule leaves anyone to feed. The ONE rule: the shopping math and the
 *  list's display math both read it. */
export function lineFeeds(
  line: Pick<RecipeLine, 'servesRule' | 'servesRestrictions' | 'scale'>,
  headcount: number,
  restrictions: Record<RestrictionKey, number>
): number {
  const fed = servingsFor(line, headcount, restrictions);
  return line.scale === 'meal' ? (fed > 0 ? 1 : 0) : fed;
}

/** How many of H people a line feeds under its serves rule. */
export function servingsFor(
  line: Pick<RecipeLine, 'servesRule' | 'servesRestrictions'>,
  headcount: number,
  restrictions: Record<RestrictionKey, number>
): number {
  if (line.servesRule === 'everyone' || line.servesRestrictions.length === 0) return headcount;
  // Counts are per restriction, not per person: "except A or B" assumes the
  // A people and the B people are different people (decision 2).
  const named = line.servesRestrictions.reduce((n, k) => n + (restrictions[k] || 0), 0);
  if (line.servesRule === 'except') return Math.max(0, headcount - named);
  return Math.min(headcount, named);
}

export interface PackagePick {
  p: Package;
  /** Packages needed to cover the need. */
  q: number;
  spend: number;
  /** Leftover in the recipe unit. */
  left: number;
}

/** Lowest total spend that covers the need; tie → less leftover. (decision E2) */
export function recommendedPackage(usable: readonly Package[], need: number): PackagePick | null {
  let best: PackagePick | null = null;
  for (const p of usable) {
    if (!isUsable(p)) continue;
    const q = Math.max(1, Math.ceil(need / p.yield - EPS));
    const spend = q * p.price;
    const left = q * p.yield - need;
    if (!best || spend < best.spend - EPS || (Math.abs(spend - best.spend) < EPS && left < best.left)) {
      best = { p, q, spend, left };
    }
  }
  return best;
}

/** What one ingredient needs, summed over every recipe line that uses it. */
export interface Need {
  ing: Ingredient;
  need: number;
  sources: LineSourceRef[];
}

/** The package choices a shopping list is priced with: a Plan's, or a menu's. */
export type ShoppingChoices = Pick<Plan, 'packageChoice' | 'qtyOverride' | 'lineSource' | 'brands'>;

export const MAX_BRANDS_PER_INGREDIENT = 8;

/**
 * A menu's stored picks for one ingredient → the live brands they name, in the order chosen: merged-away
 * brands follow their alias, a brand that is gone, retired or another ingredient's is dropped, and a brand
 * is listed once. Pure.
 */
export function livePicks(raw: readonly BrandPick[] | undefined, ingredientId: string, catalog: Pick<Catalog, 'brands' | 'brandAliases'>): { brand: Brand; qty: number | null }[] {
  if (!raw || raw.length === 0 || !catalog.brands) return [];
  const byId = new Map(catalog.brands.map((b) => [b.id, b]));
  const out: { brand: Brand; qty: number | null }[] = [];
  for (const pick of raw) {
    if (pick == null || typeof pick !== 'object' || typeof pick.brandId !== 'string') continue; // a hand-edited row
    const brand = byId.get(catalog.brandAliases?.[pick.brandId] ?? pick.brandId);
    if (!brand || brand.retiredAt || brand.ingredientId !== ingredientId || out.some((o) => o.brand.id === brand.id)) continue;
    out.push({ brand, qty: pick.qty });
    if (out.length >= MAX_BRANDS_PER_INGREDIENT) break;
  }
  return out;
}

/** Step 1 of a shopping list: one meal's raw needs by ingredient (count units
 *  NOT yet rounded up — rounding happens once, after any merging). `into`
 *  lets a caller add several meals to one map. */
export function gatherNeeds(plan: Plan, catalog: Catalog, into: Map<string, Need> = new Map()): Map<string, Need> {
  const H = plan.headcount;
  const R = effectiveRestrictions(plan);
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const RCP = new Map(catalog.recipes.map((r) => [r.id, r]));

  for (const rid of plan.recipeIds) {
    const r = RCP.get(rid);
    if (!r) continue;
    for (const ln of r.lines) {
      const ing = ING.get(ln.ingredientId);
      if (!ing) continue;
      // No conversion path = a catalog bug (fix: a conversion row), never a crash.
      const f = conv(ln.unitKey, ing, catalog.conversions);
      if (f == null || !(ln.qtyPerPerson > 0)) continue;
      const people = lineFeeds(ln, H, R);
      const amount = ln.qtyPerPerson * f * people;
      if (amount <= 0) continue;
      let e = into.get(ing.id);
      if (!e) {
        e = { ing, need: 0, sources: [] };
        into.set(ing.id, e);
      }
      e.need += amount;
      e.sources.push({ recipe: r, line: ln, amount, people });
    }
  }
  return into;
}

/** The shopping list: one line per ingredient across every selected recipe,
 *  in store order (meat, dairy, beverages, produce, bakery, dry) then by name. */
export function buildLines(plan: Plan, catalog: Catalog): ShoppingLine[] {
  return priceNeeds(gatherNeeds(plan, catalog), plan, catalog);
}

/** Step 2: choose packages and price the needs (staples, bring, unpriced and
 *  short rules live here, once, for one meal or a whole menu). */
export function priceNeeds(byIng: ReadonlyMap<string, Need>, plan: ShoppingChoices, catalog: Catalog): ShoppingLine[] {
  const lines: ShoppingLine[] = [];
  for (const e of byIng.values()) {
    const ing = e.ing;
    const all = catalog.packages.filter((p) => p.ingredientId === ing.id);
    // You can't buy half a banana: count units round up to whole before any math. (E6)
    const need = ing.unit.kind === 'count' ? Math.ceil(e.need - EPS) : e.need;
    const usable = all.filter(isUsable);
    const src = plan.lineSource[ing.id] ?? { source: 'buy' as const, note: '' };
    const base: ShoppingLine = {
      ing,
      need,
      sources: e.sources,
      all,
      usable,
      rec: null,
      pkg: null,
      autoQty: 0,
      qty: 0,
      overridden: false,
      spent: 0,
      used: 0,
      leftQty: 0,
      leftMoney: 0,
      shortQty: 0,
      status: 'ok',
      source: src.source,
      note: src.note || ''
    };

    // A staple comes from the troop's store room unless this menu says it is buying it (Patrick, 2026-10-03:
    // "often, but not always, in our kitchen store room") — an explicit 'buy' is the only way to say so.
    if (ing.staple && plan.lineSource[ing.id]?.source !== 'buy') {
      // Store room: nothing to buy, but Used stays honest.
      const p = usable[0] ?? null;
      lines.push({ ...base, status: 'staple', pkg: p, used: p ? (need / p.yield) * p.price : 0 });
      continue;
    }
    if (usable.length === 0) {
      // Unpriced, but if someone is bringing it we can still take it off the store list.
      lines.push({ ...base, status: src.source !== 'buy' ? 'bring' : 'unpriced' });
      continue;
    }

    const rec = recommendedPackage(usable, need);
    if (!rec) continue; // unreachable: usable is non-empty
    // Release 3: the menu named one or more brands. Each brand buys its share in its own cheapest package
    // (or, with no price of its own yet, the cheapest known — an estimate); the shares add up to the line.
    const picks = src.source === 'buy' ? livePicks(plan.brands?.[ing.id], ing.id, catalog) : [];
    if (picks.length > 0) {
      const share = need / picks.length;
      const parts: LinePart[] = picks.map(({ brand, qty }) => {
        const own = usable.filter((p) => p.brandId === brand.id);
        const best = recommendedPackage(own.length > 0 ? own : usable, share);
        const chosenPkg = own.find((p) => p.id === plan.packageChoice[ing.id]);
        const pkg = (chosenPkg ?? best?.p ?? rec.p) as Package & { yield: number };
        const autoQty = Math.max(1, Math.ceil(share / pkg.yield - EPS));
        const q = qty != null && qty >= 0 ? qty : autoQty;
        return { brand, pkg, qty: q, autoQty, spent: q * pkg.price, estimated: own.length === 0 };
      });
      const covered = parts.reduce((n, x) => n + x.qty * (x.pkg.yield as number), 0);
      const spent = parts.reduce((n, x) => n + x.spent, 0);
      const used = covered > 0 ? spent * Math.min(1, need / covered) : 0;
      const short = covered < need - EPS;
      lines.push({
        ...base,
        rec: rec.p,
        pkg: parts[0].pkg,
        autoQty: parts.reduce((n, x) => n + x.autoQty, 0),
        qty: parts.reduce((n, x) => n + x.qty, 0),
        overridden: parts.some((x) => x.qty !== x.autoQty),
        spent,
        used,
        leftQty: short ? 0 : covered - need,
        leftMoney: spent - used,
        shortQty: short ? need - covered : 0,
        status: short ? 'short' : 'ok',
        parts,
        estimated: parts.some((x) => x.estimated)
      });
      continue;
    }
    const chosenId = plan.packageChoice[ing.id];
    const chosen = chosenId ? usable.find((p) => p.id === chosenId) : undefined;
    const pkg = chosen ?? rec.p;
    if (!isUsable(pkg)) continue; // unreachable: both come from `usable`
    const y = pkg.yield;

    if (src.source !== 'buy') {
      // Needed but not bought this trip: Used stays honest, Spent is zero (same rule as staples).
      lines.push({ ...base, status: 'bring', rec: rec.p, pkg, used: (need / y) * pkg.price });
      continue;
    }

    const autoQty = Math.max(1, Math.ceil(need / y - EPS));
    const ov = plan.qtyOverride[ing.id];
    const qty = ov && ov.packageId === pkg.id ? ov.qty : autoQty;
    const spent = qty * pkg.price;
    const used = (Math.min(need, qty * y) / y) * pkg.price;
    let leftQty = qty * y - need;
    let shortQty = 0;
    let status: LineStatus = 'ok';
    if (leftQty < -EPS) {
      status = 'short';
      shortQty = -leftQty;
      leftQty = 0;
    }
    lines.push({
      ...base,
      rec: rec.p,
      pkg,
      autoQty,
      qty,
      overridden: qty !== autoQty,
      spent,
      used,
      leftQty,
      leftMoney: spent - used,
      shortQty,
      status,
      // Any brand will do, and there are brands to choose from: the cost is the cheapest known — "about".
      ...(!chosen && (catalog.brands ?? []).some((b) => b.ingredientId === ing.id && !b.retiredAt) ? { estimated: true } : {})
    });
  }

  lines.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.ing.section) - SECTION_ORDER.indexOf(b.ing.section) ||
      a.ing.name.localeCompare(b.ing.name)
  );
  return lines;
}

export function totalsOf(lines: readonly ShoppingLine[], plan: Pick<Plan, 'headcount'>): Totals {
  const t: Totals = {
    spent: 0,
    used: 0,
    left: 0,
    stapleUsed: 0,
    bringUsed: 0,
    bring: [],
    unpriced: [],
    short: [],
    perSpent: 0,
    perUsed: 0,
    perLeft: 0
  };
  for (const l of lines) {
    if (l.status === 'staple') {
      t.stapleUsed += l.used;
      continue;
    }
    if (l.status === 'bring') {
      t.bringUsed += l.used;
      t.bring.push(l.ing.name);
      continue;
    }
    if (l.status === 'unpriced') {
      t.unpriced.push(l.ing.name);
      continue;
    }
    if (l.status === 'short') t.short.push(l.ing.name);
    t.spent += l.spent;
    t.used += l.used;
    t.left += l.leftMoney;
  }
  const H = plan.headcount > 0 ? plan.headcount : 1;
  t.perSpent = t.spent / H;
  t.perUsed = t.used / H;
  t.perLeft = t.left / H;
  return t;
}

/** Warn (never block) when a selected recipe feeds a restricted person
 *  something they avoid and offers no swap line. Only gluten and nuts warn. */
export function restrictionWarnings(plan: Plan, catalog: Catalog): RestrictionWarning[] {
  const R = effectiveRestrictions(plan);
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const RCP = new Map(catalog.recipes.map((r) => [r.id, r]));
  const out: RestrictionWarning[] = [];
  for (const rid of plan.recipeIds) {
    const r = RCP.get(rid);
    if (!r) continue;
    for (const rs of RESTRICTIONS) {
      if (!R[rs.key]) continue;
      // A leader said so: Not suitable warns for every restriction (decision 6).
      const unsuitable = (r.variations ?? []).some((v) => v.restriction === rs.key && v.state === 'unsuitable');
      if (unsuitable) {
        out.push({ kind: 'unsuitable', recipe: r, restriction: rs, count: R[rs.key], ingredients: [], ingredientIds: [] });
        continue;
      }
      if (!WARN_ALLERGENS.includes(rs.key)) continue;
      const hasOnly = r.lines.some((l) => l.servesRule === 'only' && l.servesRestrictions.includes(rs.key));
      const bad = r.lines.filter((l) => {
        const ing = ING.get(l.ingredientId);
        if (!ing || !ing.avoid.includes(rs.key)) return false;
        return l.servesRule === 'everyone' || (l.servesRule === 'except' && !l.servesRestrictions.includes(rs.key));
      });
      if (bad.length && !hasOnly) {
        out.push({
          kind: 'allergen',
          recipe: r,
          restriction: rs,
          count: R[rs.key],
          ingredients: bad.map((l) => ING.get(l.ingredientId)?.name ?? l.ingredientId),
          ingredientIds: bad.map((l) => l.ingredientId)
        });
      }
    }
  }
  return out;
}

/* ---- Copy helpers (the prototype's sentences, verbatim) -------------------- */

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numWord = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function plural(n: number, noun: string): string {
  if (n === 1) return noun;
  if (noun === 'dozen' || noun === 'each') return noun;
  if (noun.endsWith('x')) return `${noun}es`;
  if (noun.endsWith('f')) return `${noun.slice(0, -1)}ves`;
  return `${noun}s`;
}

export const packNoun = (pkg: Package) => pkg.noun || 'pack';

/** "2 packs", "1 dozen", "3" (sold singly). */
export function packCount(n: number, pkg: Package): string {
  const noun = packNoun(pkg);
  return noun === 'each' ? `${n}` : `${n} ${plural(n, noun)}`;
}

/** "everyone", "everyone except gluten-free", "only gluten-free",
 *  "everyone except dairy-free or vegetarian". */
export function ruleText(line: Pick<RecipeLine, 'servesRule' | 'servesRestrictions'>): string {
  if (line.servesRule === 'everyone' || line.servesRestrictions.length === 0) return 'everyone';
  const label = line.servesRestrictions.map((k) => RESTRICTION_BY_KEY[k].label.toLowerCase()).join(' or ');
  return line.servesRule === 'except' ? `everyone except ${label}` : `only ${label}`;
}

/** "You'll use 30 slices. Two packs hold 32 slices. 2 slices left over." */
export function lineSentence(l: ShoppingLine): string {
  const pk = l.pkg;
  if (!pk || !isUsable(pk)) return '';
  const u = l.ing.unit;
  const need = qtyText(l.need, u);
  const holds = qtyText(l.qty * pk.yield, u);
  const count = packCount(l.qty, pk);
  const countWord = l.qty <= 12 ? count.replace(/^\d+/, (m) => cap(numWord(+m))) : count;
  if (packNoun(pk) === 'each' && pk.yield === 1) {
    if (l.status === 'short') {
      return `You'll use ${need}. You're buying ${l.qty}. That's ${qtyText(l.shortQty, u)} short.`;
    }
    return `You'll use ${need}. Buy ${l.qty}, sold one at a time. ${
      l.leftQty < EPS ? 'Nothing left over.' : `${qtyText(l.leftQty, u)} left over.`
    }`;
  }
  const holdVerb = l.qty === 1 ? 'holds' : 'hold';
  if (l.status === 'short') {
    return `You'll use ${need}. ${countWord} ${holdVerb} ${holds}. That's ${qtyText(l.shortQty, u)} short.`;
  }
  const leftTxt = l.leftQty < EPS ? 'Nothing left over.' : `${qtyText(l.leftQty, u)} left over.`;
  return `You'll use ${need}. ${countWord} ${holdVerb} ${holds}. ${leftTxt}`;
}

/** "30 slices ÷ 16 slices per pack = 1.88 → 2 packs" — the visible math. */
export function mathText(l: ShoppingLine): string {
  const pk = l.pkg;
  if (!pk || !isUsable(pk)) return '';
  const u = l.ing.unit;
  if (packNoun(pk) === 'each' && pk.yield === 1) return `sold one at a time → buy ${l.autoQty}`;
  const raw = l.need / pk.yield;
  const per = `${qtyText(pk.yield, u)} per ${packNoun(pk)}`;
  return `${qtyText(l.need, u)} ÷ ${per} = ${Math.round(raw * 100) / 100} → ${packCount(l.autoQty, pk)}`;
}

/** "for Pancakes (everyone except gluten-free, 9) + French toast" */
export function sourcesText(l: ShoppingLine): string {
  return (
    'for ' +
    l.sources
      .map((s) =>
        s.line.servesRule !== 'everyone' ? `${s.recipe.name} (${s.line.scale === 'meal' ? ruleText(s.line) : `${ruleText(s.line)}, ${s.people}`})` : s.recipe.name
      )
      .join(' + ')
  );
}

/** First-paint plan so the page is never empty: the prototype's breakfast for
 *  ten with one gluten-free scout. Recipes missing from the catalog are dropped. */
export function seedPlan(catalog: Catalog): Plan {
  // Patrick, 2026-09-08: the planner starts AGNOSTIC — no menu items ticked,
  // a six-person patrol, every restriction at zero. (It used to open on a
  // sample breakfast for ten with one gluten-free scout, which read as a
  // real plan someone had started.) The meal is the first slot that has
  // anything to pick — breakfast whenever the recipe book has one.
  return {
    meal: MEALS.find((m) => recipesForMeal(catalog, m.key).length > 0)?.key ?? 'breakfast',
    headcount: 6,
    restrictions: { gf: 0, nut: 0, dairy: 0, veg: 0 },
    recipeIds: [],
    packageChoice: {},
    qtyOverride: {},
    lineSource: {},
    budgetPerPerson: 4,
    date: centralToday(),
    patrol: ''
  };
}

/* ---- Plan edits the planner needs (pure, so they can be tested) ----------- */

export const MIN_HEADCOUNT = 2;
// Patrick, 2026-10-02: whole-troop meals run up to 50 (was 16, a patrol).
export const MAX_HEADCOUNT = 50;
export const MAX_QTY = 99;

const clampInt = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** Switch the meal slot. Headcount and restrictions stay (they're about the
 *  people, not the food); recipes that don't fit the new meal are dropped. */
export function withMeal(plan: Plan, meal: MealSlot, catalog: Catalog): Plan {
  const fits = new Set(recipesForMeal(catalog, meal).map((r) => r.id));
  return { ...plan, meal, recipeIds: plan.recipeIds.filter((id) => fits.has(id)) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored draft (localStorage, any age, possibly hand-edited) folded onto
 *  the seed plan: unknown keys dropped, numbers clamped, recipes and packages
 *  that no longer exist removed. Never throws — a bad draft is just the seed. */
export function restorePlan(raw: unknown, catalog: Catalog): Plan {
  const seed = seedPlan(catalog);
  if (!isRecord(raw)) return seed;
  const meal = MEALS.some((m) => m.key === raw.meal) ? (raw.meal as MealSlot) : seed.meal;
  const headcount = clampInt(raw.headcount, MIN_HEADCOUNT, MAX_HEADCOUNT, seed.headcount);
  const restrictions = { ...seed.restrictions };
  if (isRecord(raw.restrictions)) {
    for (const r of RESTRICTIONS) restrictions[r.key] = clampInt(raw.restrictions[r.key], 0, MAX_HEADCOUNT, 0);
  }
  const fits = new Set(recipesForMeal(catalog, meal).map((r) => r.id));
  const recipeIds = Array.isArray(raw.recipeIds)
    ? raw.recipeIds.filter((id): id is string => typeof id === 'string' && fits.has(id))
    : seed.recipeIds;
  const pkgIds = new Set(catalog.packages.map((p) => p.id));
  const packageChoice: Plan['packageChoice'] = {};
  if (isRecord(raw.packageChoice)) {
    for (const [ing, pid] of Object.entries(raw.packageChoice)) {
      if (typeof pid === 'string' && pkgIds.has(pid)) packageChoice[ing] = pid;
    }
  }
  const qtyOverride: Plan['qtyOverride'] = {};
  if (isRecord(raw.qtyOverride)) {
    for (const [ing, ov] of Object.entries(raw.qtyOverride)) {
      if (isRecord(ov) && typeof ov.packageId === 'string' && pkgIds.has(ov.packageId)) {
        qtyOverride[ing] = { packageId: ov.packageId, qty: clampInt(ov.qty, 0, MAX_QTY, 0) };
      }
    }
  }
  const lineSource: Plan['lineSource'] = {};
  if (isRecord(raw.lineSource)) {
    for (const [ing, ls] of Object.entries(raw.lineSource)) {
      if (isRecord(ls) && (ls.source === 'buy' || ls.source === 'pantry' || ls.source === 'home')) {
        lineSource[ing] = { source: ls.source, note: typeof ls.note === 'string' ? ls.note.slice(0, 120) : '' };
      }
    }
  }
  const budget = Number(raw.budgetPerPerson);
  return {
    meal,
    headcount,
    restrictions,
    recipeIds: [...new Set(recipeIds)],
    packageChoice,
    qtyOverride,
    lineSource,
    budgetPerPerson: Number.isFinite(budget) && budget >= 0 ? budget : seed.budgetPerPerson,
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : seed.date,
    patrol: typeof raw.patrol === 'string' ? raw.patrol.slice(0, 60) : ''
  };
}

/**
 * A recipe's suggested brands that can be used: the ingredient is one the recipe has, and the brand is a live
 * brand of it (a merged brand follows its alias). [ingredientId, brand] pairs, in the recipe's line order. Pure.
 */
export function recipeSuggestions(recipe: Pick<Recipe, 'lines' | 'brandSuggestions'>, catalog: Pick<Catalog, 'brands' | 'brandAliases'>): [string, Brand][] {
  const out: [string, Brand][] = [];
  for (const line of recipe.lines) {
    const brandId = recipe.brandSuggestions?.[line.ingredientId];
    if (!brandId || out.some(([id]) => id === line.ingredientId)) continue;
    const [live] = livePicks([{ brandId, qty: null }], line.ingredientId, catalog);
    if (live) out.push([line.ingredientId, live.brand]);
  }
  return out;
}
