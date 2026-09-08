/**
 * Menu Monster — leader-tools helpers (Plans/Menu-Monster-Leader-Tools.md).
 *
 * Everything the Price book and Recipe builder DECIDE lives here, pure and
 * unit-tested; the editors render what these return:
 *
 *   suggestYield     Option C — a package's yield in the recipe unit, suggested
 *                    from the label's size + unit, confirmed by a human.
 *   priceChange      the >25% "big change" flag on an edited price (advisory).
 *   staleDays/Text   the 90-day "check it" flag (advisory).
 *   recipeIssues     the publish gate — blocking errors + warnings, with the
 *                    prototype's copy. Runs on the client AND in the action.
 *   changeUnitPlan   what changing an ingredient's recipe unit does to every
 *                    package yield and recipe line, previewed before the RPC
 *                    applies it verbatim.
 */

import type {
  Catalog,
  Conversion,
  FoodGroup,
  Ingredient,
  MealSlot,
  Package,
  RecipeStatus,
  RestrictionKey,
  ServesRule,
  Unit
} from './types';
import { RESTRICTION_BY_KEY, UNITS, WARN_ALLERGENS, conv, lineUnit, parseQty, stepFactor, supportedUnits } from './units';
import { ruleText } from './engine';

export const STALE_DAYS = 90;
export const BIG_CHANGE = 0.25;

/** What a label says a package is sold by. `count` = the ingredient's own noun. */
export const SOLD_UNITS: readonly { key: string; one: string; many: string }[] = [
  { key: 'lb', one: 'lb', many: 'lb' },
  { key: 'ozw', one: 'oz', many: 'oz' },
  { key: 'oz', one: 'fl oz', many: 'fl oz' },
  { key: 'gallon', one: 'gallon', many: 'gallons' },
  { key: 'quart', one: 'quart', many: 'quarts' },
  { key: 'cup', one: 'cup', many: 'cups' },
  { key: 'each', one: 'each', many: 'each' },
  { key: 'count', one: 'count', many: 'count' },
  { key: 'dozen', one: 'dozen', many: 'dozen' },
  { key: 'pack', one: 'pack', many: 'packs' }
];

export const METHODS: readonly { key: string; label: string }[] = [
  { key: 'no-cook', label: 'No-cook' },
  { key: 'stove', label: 'Stove' },
  { key: 'dutch-oven', label: 'Dutch oven' },
  { key: 'foil', label: 'Foil packet' },
  { key: 'grill', label: 'Grill' },
  { key: 'other', label: 'Other' }
];

export const STORES: readonly string[] = ['Costco', 'Kroger', 'Target', 'Outpost', 'Other'];

function soldLabel(key: string, n: number, ingredient: Ingredient): string {
  if (key === 'count') return n === 1 ? ingredient.unit.one : ingredient.unit.many;
  const s = SOLD_UNITS.find((u) => u.key === key);
  if (s) return n === 1 ? s.one : s.many;
  const u = UNITS[key];
  return u ? (n === 1 ? u.one : u.many) : key;
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/* ---- Yield helper (Option C) ---------------------------------------------- */

export interface YieldSuggestion {
  /** Suggested yield in the recipe unit, rounded to 2 places; null when there is nothing to suggest. */
  value: number | null;
  via: 'family' | 'conversion' | null;
  text: string;
  sub: string | null;
}

/** The conversion row conv() would use to bridge `key` to the recipe unit, if any. */
function bridgeRow(key: string, ingredient: Ingredient, conversions: readonly Conversion[]): Conversion | null {
  for (const d of conversions) {
    if (d.ingredientId !== ingredient.id) continue;
    if (stepFactor(key, d.from) != null && stepFactor(d.to, ingredient.unit.key) != null) return d;
    if (stepFactor(key, d.to) != null && stepFactor(d.from, ingredient.unit.key) != null) return d;
  }
  return null;
}

export function suggestYield(
  ingredient: Ingredient,
  size: number | null,
  soldUnit: string | null,
  conversions: readonly Conversion[]
): YieldSuggestion {
  const many = ingredient.unit.many;
  if (size == null || !Number.isFinite(size) || size <= 0 || !soldUnit) {
    return { value: null, via: null, text: `Type the size on the label and the tool will suggest how many ${many} it makes.`, sub: null };
  }
  const key = soldUnit === 'count' ? ingredient.unit.key : soldUnit;
  const direct = stepFactor(key, ingredient.unit.key);
  if (direct != null) {
    const value = Math.round(size * direct * 100) / 100;
    return {
      value,
      via: 'family',
      text: `Suggested: ≈ ${num(value)} ${many} from ${num(size)} ${soldLabel(soldUnit, size, ingredient)}.`,
      sub: `Same unit family — 1 ${soldLabel(soldUnit, 1, ingredient)} = ${num(direct)} ${many}`
    };
  }
  const factor = conv(key, ingredient, conversions);
  const row = bridgeRow(key, ingredient, conversions);
  if (factor != null && row) {
    const value = Math.round(size * factor * 100) / 100;
    return {
      value,
      via: 'conversion',
      text: `Suggested: ≈ ${num(value)} ${many} from ${num(size)} ${soldLabel(soldUnit, size, ingredient)}.`,
      sub: `Suggested from the conversion on file — ${row.label ?? `1 ${row.from} = ${num(row.factor)} ${row.to}`}`
    };
  }
  return {
    value: null,
    via: null,
    text: `No conversion on file for ${ingredient.name} sold by the ${soldLabel(soldUnit, 1, ingredient)}. Type how many ${many} this package makes. Until then it can't be used.`,
    sub: null
  };
}

/** "Can't use yet: sold by the gallon, and nobody has said how many cups that makes." */
export function unusableText(pkg: Package, ingredient: Ingredient): string {
  const by = pkg.yieldUnitLabel ?? (pkg.soldUnit ? soldLabel(pkg.soldUnit, 1, ingredient) : 'label size');
  return `Can't use yet: sold by the ${by}, and nobody has said how many ${ingredient.unit.many} that makes.`;
}

/* ---- Price flags ------------------------------------------------------------ */

export interface PriceChange {
  /** Fraction of the saved price, signed; null when there was no saved price. */
  pct: number | null;
  big: boolean;
  text: string | null;
}

function pctText(pct: number): string {
  const n = Math.round(Math.abs(pct) * 100);
  return `${pct < 0 ? '−' : '+'}${n}%`;
}

export function priceChange(savedPrice: number, newPrice: number, dateChanged: boolean): PriceChange {
  if (!(savedPrice > 0)) return { pct: null, big: false, text: null };
  const pct = (newPrice - savedPrice) / savedPrice;
  if (Math.abs(pct) < 1e-9) {
    return { pct: 0, big: false, text: dateChanged ? "Same price — save to confirm it's still current." : null };
  }
  const big = Math.abs(pct) > BIG_CHANGE;
  return {
    pct,
    big,
    text: big ? `⚠ Big change (${pctText(pct)}) — flagged for a second look` : `${pctText(pct)} from $${savedPrice.toFixed(2)}`
  };
}

const dayMs = 86_400_000;
function utcDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days between an as-of date and today (both 'YYYY-MM-DD'); null with no date. */
export function staleDays(asOf: string | null, today: string): number | null {
  if (!asOf) return null;
  return Math.round((utcDay(today) - utcDay(asOf)) / dayMs);
}

export function staleText(asOf: string | null, today: string): string | null {
  const days = staleDays(asOf, today);
  if (days == null) return 'No price date — check it.';
  return days > STALE_DAYS ? `Price is ${days} days old — still used, but check it.` : null;
}

/* ---- Recipe draft + publish gate --------------------------------------------- */

export interface DraftLine {
  ingredientId: string;
  /** Raw text as typed — ½, 1/2, 0.5 all accepted (parseQty). */
  amount: string;
  unitKey: string | null;
  servesRule: ServesRule;
  servesRestriction: RestrictionKey | null;
}

export interface RecipeDraft {
  id: string;
  name: string;
  status: RecipeStatus;
  mealFit: MealSlot[];
  foodGroups: FoodGroup[];
  camp: boolean;
  trail: boolean;
  method: string | null;
  stepsMd: string;
  lines: DraftLine[];
}

export type IssueLevel = 'error' | 'warning';

export interface RecipeIssue {
  level: IssueLevel;
  /** 0-based line index, when the issue is about one line. */
  line?: number;
  text: string;
  /** The editor offers a link to the Price book for these. */
  fix?: 'price-book';
}

export const blockingIssues = (issues: readonly RecipeIssue[]): RecipeIssue[] => issues.filter((i) => i.level === 'error');

function hasUsablePackage(ingredientId: string, catalog: Catalog): boolean {
  return catalog.packages.some((p) => p.ingredientId === ingredientId && p.yield != null && !p.retiredAt);
}

export function recipeIssues(draft: RecipeDraft, catalog: Catalog): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  const err = (text: string, line?: number, fix?: 'price-book') => issues.push({ level: 'error', text, line, fix });
  const warn = (text: string, line?: number) => issues.push({ level: 'warning', text, line });

  if (!draft.name.trim()) err('Give the menu item a name.');
  if (draft.lines.length === 0) err('Add at least one ingredient line.');
  if (draft.mealFit.length === 0) err('Pick at least one meal it fits.');

  const byId = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const seen = new Set<string>();
  draft.lines.forEach((l, idx) => {
    const n = idx + 1;
    const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
    if (!ing) {
      err(`Line ${n}: pick an ingredient.`, idx);
      return;
    }
    if (!hasUsablePackage(ing.id, catalog)) {
      err(`Line ${n}: ${ing.name} has no priced package yet — add one in the Price book.`, idx, 'price-book');
    }
    const raw = l.amount.trim();
    if (!raw) err(`Line ${n}: type an amount per person.`, idx);
    else {
      const q = parseQty(raw);
      if (!Number.isFinite(q) || q <= 0) err(`Line ${n}: '${raw}' isn't a number. Type something like ½, 1/2 or 0.5.`, idx);
    }
    if (conv(l.unitKey, ing, catalog.conversions) == null) {
      const supported = supportedUnits(ing, catalog.conversions).map((k) => lineUnit(k, ing).many);
      const wanted = lineUnit(l.unitKey, ing).many;
      err(
        `Line ${n}: ${ing.name} can't be measured in ${wanted} — use ${supported.join(', ')}, or ask a leader to add a conversion in the Price book.`,
        idx
      );
    }
    const rule = ruleText(l);
    const key = `${ing.id}|${rule}`;
    if (seen.has(key)) err(`Line ${n}: ${ing.name} already has a line for ${rule} — combine them.`, idx);
    seen.add(key);
  });

  // Warnings — never block.
  const hasRule = (rule: ServesRule, r: RestrictionKey) =>
    draft.lines.some((l) => l.servesRule === rule && l.servesRestriction === r);
  draft.lines.forEach((l, idx) => {
    const n = idx + 1;
    const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
    if (!ing) return;
    if (l.servesRule === 'only' && l.servesRestriction && !hasRule('except', l.servesRestriction)) {
      const label = RESTRICTION_BY_KEY[l.servesRestriction].label.toLowerCase();
      warn(
        `Line ${n}: only ${label} people get ${ing.name}, but nothing is marked 'everyone except ${label}' — is this a swap? Add the line it replaces.`,
        idx
      );
    }
    if (l.servesRule === 'only') return;
    for (const r of WARN_ALLERGENS) {
      if (!ing.avoid.includes(r)) continue;
      if (l.servesRule === 'except' && l.servesRestriction === r) continue;
      if (hasRule('except', r)) continue;
      const label = RESTRICTION_BY_KEY[r].label.toLowerCase();
      warn(
        `Line ${n}: ${ing.name} isn't ${label} and everyone gets it — a ${label} scout will be warned. Add an 'everyone except ${label}' line and an 'only ${label}' swap if you want one.`,
        idx
      );
    }
  });

  return issues;
}

/* ---- Change unit ---------------------------------------------------------------- */

export interface UnitChangePackage {
  id: string;
  name: string;
  yield: number | null;
  yieldUnitLabel: string | null;
  converted: boolean;
}

export interface UnitChangeLine {
  recipeId: string;
  recipeName: string;
  unitKey: string | null;
}

export interface ChangeUnitPlan {
  kind: 'rename' | 'family' | 'cross';
  /** 1 old unit = factor new units; null when nothing converts. */
  factor: number | null;
  packages: UnitChangePackage[];
  /** The OLD unit key to pin on lines that relied on "no unit = recipe unit"; null = nothing to pin. */
  pinUnit: string | null;
  pinnedLines: { recipeId: string; recipeName: string }[];
  summary: string[];
}

const s = (n: number) => (n === 1 ? '' : 's');

export function changeUnitPlan(
  ingredient: Ingredient,
  newUnit: Unit,
  packages: readonly Package[],
  lines: readonly UnitChangeLine[],
  conversions: readonly Conversion[]
): ChangeUnitPlan {
  const old = ingredient.unit;
  const pkgOf = (p: Package, yield_: number | null, converted: boolean): UnitChangePackage => ({
    id: p.id,
    name: p.name,
    yield: yield_,
    yieldUnitLabel: yield_ == null ? old.one : null,
    converted
  });

  if (old.kind === 'count' && newUnit.kind === 'count') {
    return {
      kind: 'rename',
      factor: null,
      packages: packages.map((p) => pkgOf(p, p.yield, true)),
      pinUnit: null,
      pinnedLines: [],
      summary: ['Only the name of the unit changes. Packages and recipe lines keep their numbers.']
    };
  }

  const implicit = lines.filter((l) => l.unitKey == null || l.unitKey === old.key);
  const explicit = lines.length - implicit.length;
  const pinnedLines = implicit.map((l) => ({ recipeId: l.recipeId, recipeName: l.recipeName }));
  const round = (n: number) => Math.round(n * 10000) / 10000;

  const family = stepFactor(old.key, newUnit.key);
  if (family != null) {
    const n = packages.length;
    const linesText =
      `${implicit.length} recipe line${s(implicit.length)} keep${implicit.length === 1 ? 's' : ''} ${old.many} and still cost${implicit.length === 1 ? 's' : ''} out` +
      (explicit ? `; ${explicit} line${s(explicit)} already name${explicit === 1 ? 's' : ''} ${explicit === 1 ? 'its' : 'their'} own unit${s(explicit)}` : '') +
      '.';
    return {
      kind: 'family',
      factor: family,
      packages: packages.map((p) => pkgOf(p, p.yield == null ? null : round(p.yield * family), p.yield != null)),
      pinUnit: old.key,
      pinnedLines,
      summary: [`${n} package${s(n)} will convert automatically (1 ${old.one} = ${num(family)} ${newUnit.many}).`, linesText]
    };
  }

  // Across families: only a conversion row on file can bridge old → new.
  const bridge = conv(old.key, { ...ingredient, unit: newUnit }, conversions);
  const n = packages.length;
  if (bridge != null) {
    return {
      kind: 'cross',
      factor: bridge,
      packages: packages.map((p) => pkgOf(p, p.yield == null ? null : round(p.yield * bridge), p.yield != null)),
      pinUnit: old.key,
      pinnedLines,
      summary: [
        `${n} package${s(n)} will convert automatically through the conversion on file (1 ${old.one} = ${num(bridge)} ${newUnit.many}).`,
        `${lines.length} recipe line${s(lines.length)} keep${lines.length === 1 ? 's' : ''} ${old.many} and still cost${lines.length === 1 ? 's' : ''} out through that conversion.`
      ]
    };
  }
  return {
    kind: 'cross',
    factor: null,
    packages: packages.map((p) => pkgOf(p, null, false)),
    pinUnit: old.key,
    pinnedLines,
    summary: [
      `${n} package${s(n)} will need a new yield typed in ${newUnit.many} before ${n === 1 ? 'it' : 'they'} can be used again.`,
      `${lines.length} recipe line${s(lines.length)} will keep ${old.many} and show a unit problem until a conversion from ${old.many} to ${newUnit.many} exists.`
    ]
  };
}

/* ---- Ids ------------------------------------------------------------------------ */

/** 'Cinnamon rolls' → 'cinnamon-rolls', suffixed -2, -3… until unused. */
export function slugId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
