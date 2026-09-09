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
  Catalog,
  Ingredient,
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

/** The shopping list: one line per ingredient across every selected recipe,
 *  in store order (meat, dairy, produce, bakery, dry) then by name. */
export function buildLines(plan: Plan, catalog: Catalog): ShoppingLine[] {
  const H = plan.headcount;
  const R = effectiveRestrictions(plan);
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const RCP = new Map(catalog.recipes.map((r) => [r.id, r]));

  const byIng = new Map<string, { ing: Ingredient; need: number; sources: LineSourceRef[] }>();
  for (const rid of plan.recipeIds) {
    const r = RCP.get(rid);
    if (!r) continue;
    for (const ln of r.lines) {
      const ing = ING.get(ln.ingredientId);
      if (!ing) continue;
      // No conversion path = a catalog bug (fix: a conversion row), never a crash.
      const f = conv(ln.unitKey, ing, catalog.conversions);
      if (f == null || !(ln.qtyPerPerson > 0)) continue;
      const people = servingsFor(ln, H, R);
      const amount = ln.qtyPerPerson * f * people;
      if (amount <= 0) continue;
      let e = byIng.get(ing.id);
      if (!e) {
        e = { ing, need: 0, sources: [] };
        byIng.set(ing.id, e);
      }
      e.need += amount;
      e.sources.push({ recipe: r, line: ln, amount, people });
    }
  }

  const lines: ShoppingLine[] = [];
  for (const e of byIng.values()) {
    const ing = e.ing;
    const all = catalog.packages.filter((p) => p.ingredientId === ing.id);
    // You can't buy half a banana: count units round up to whole before any math. (E6)
    if (ing.unit.kind === 'count') e.need = Math.ceil(e.need - EPS);
    const usable = all.filter(isUsable);
    const src = plan.lineSource[ing.id] ?? { source: 'buy' as const, note: '' };
    const base: ShoppingLine = {
      ing,
      need: e.need,
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

    if (ing.staple) {
      // Patrol box: nothing to buy, but Used stays honest.
      const p = usable[0] ?? null;
      lines.push({ ...base, status: 'staple', pkg: p, used: p ? (e.need / p.yield) * p.price : 0 });
      continue;
    }
    if (usable.length === 0) {
      // Unpriced, but if someone is bringing it we can still take it off the store list.
      lines.push({ ...base, status: src.source !== 'buy' ? 'bring' : 'unpriced' });
      continue;
    }

    const rec = recommendedPackage(usable, e.need);
    if (!rec) continue; // unreachable: usable is non-empty
    const chosenId = plan.packageChoice[ing.id];
    const chosen = chosenId ? usable.find((p) => p.id === chosenId) : undefined;
    const pkg = chosen ?? rec.p;
    if (!isUsable(pkg)) continue; // unreachable: both come from `usable`
    const y = pkg.yield;

    if (src.source !== 'buy') {
      // Needed but not bought this trip: Used stays honest, Spent is zero (same rule as staples).
      lines.push({ ...base, status: 'bring', rec: rec.p, pkg, used: (e.need / y) * pkg.price });
      continue;
    }

    const autoQty = Math.max(1, Math.ceil(e.need / y - EPS));
    const ov = plan.qtyOverride[ing.id];
    const qty = ov && ov.packageId === pkg.id ? ov.qty : autoQty;
    const spent = qty * pkg.price;
    const used = (Math.min(e.need, qty * y) / y) * pkg.price;
    let leftQty = qty * y - e.need;
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
      status
    });
  }

  lines.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.ing.section) - SECTION_ORDER.indexOf(b.ing.section) ||
      a.ing.name.localeCompare(b.ing.name)
  );
  return lines;
}

export function totalsOf(lines: readonly ShoppingLine[], plan: Plan): Totals {
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
        out.push({ kind: 'unsuitable', recipe: r, restriction: rs, count: R[rs.key], ingredients: [] });
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
          ingredients: bad.map((l) => ING.get(l.ingredientId)?.name ?? l.ingredientId)
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
        s.line.servesRule !== 'everyone' ? `${s.recipe.name} (${ruleText(s.line)}, ${s.people})` : s.recipe.name
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
export const MAX_HEADCOUNT = 16;
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
