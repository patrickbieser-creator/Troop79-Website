/**
 * Menu Monster — recipe variations (Plans/Menu-Monster-Recipe-Variations.md).
 *
 * A recipe is authored as a BASE line list ("Everyone") plus zero or more
 * per-restriction DIFFS — swap this line for that, leave this out, add this —
 * and compiled here into the serves-rule lines the engine has always read.
 * The diff is the source of truth; the compiled lines are what buildLines()
 * sizes by the restriction counts. Pure TS, unit-tested.
 *
 *   compileRecipe        diff → engine lines (decision 2: a base line changed
 *                        by several restrictions is ONE "except A or B" line)
 *   variationsFromLines  the inverse, used by the backfill and to explain
 *                        legacy recipes
 *   variationView        the chip on a tab: not_needed / needs_look /
 *                        nothing / substituted / unsuitable (decision 1:
 *                        "nothing needed" is DERIVED from the avoid flags)
 *   crossRestrictionWarnings  decision 3: a swap that carries another flag
 */

import type { Catalog, Ingredient, RecipeLine, RestrictionKey, ServesRule, Variation, VariationLine, VariationOp, VariationState } from './types';
import { RESTRICTIONS, RESTRICTION_BY_KEY, lineUnit, perPersonText } from './units';

export type { Variation, VariationLine } from './types';

export type BaseLine = QtyLine<number>;

/** What a tab (or the item list's dots) shows for one restriction. */
export type VariationView = 'not_needed' | 'needs_look' | 'nothing' | 'substituted' | 'unsuitable';

export const VIEW_LABEL: Record<VariationView, string> = {
  not_needed: 'Nothing to change',
  needs_look: 'Needs a look',
  nothing: 'Nothing to change',
  substituted: 'Substituted',
  unsuitable: 'Not suitable'
};

const ORDER: Record<RestrictionKey, number> = { gf: 0, nut: 1, dairy: 2, veg: 3 };
const sortKeys = (keys: Iterable<RestrictionKey>): RestrictionKey[] => [...new Set(keys)].sort((a, b) => ORDER[a] - ORDER[b]);

const changes = (v: Variation): VariationLine[] => (v.state === 'substituted' ? v.lines : []);

/** A line with any quantity type: numbers for the engine, the raw text a
 *  leader typed for the editor (so "½" survives compilation and its error
 *  message can quote it). */
export interface QtyLine<Q> {
  ingredientId: string;
  qtyPerPerson: Q;
  unitKey: string | null;
}
export interface QtyVariationLine<Q> {
  op: VariationOp;
  baseIngredientId: string | null;
  ingredientId: string | null;
  qtyPerPerson: Q | null;
  unitKey: string | null;
}
export interface QtyVariation<Q> {
  restriction: RestrictionKey;
  state: VariationState;
  note: string | null;
  lines: QtyVariationLine<Q>[];
}
export interface CompiledLine<Q> extends QtyLine<Q> {
  servesRule: ServesRule;
  servesRestrictions: RestrictionKey[];
}

const qtyChanges = <Q,>(v: QtyVariation<Q>): QtyVariationLine<Q>[] => (v.state === 'substituted' ? v.lines : []);

/** Diff → the engine's lines: base lines in order (each "everyone", or
 *  "everyone except" the restrictions that leave it out or swap it), then the
 *  swapped-in and added lines as "only" lines, merged when two restrictions
 *  add the identical line. Generic over the quantity so the editor compiles
 *  raw text and the server compiles numbers with one function. */
export function compileRecipe<Q>(base: readonly QtyLine<Q>[], variations: readonly QtyVariation<Q>[]): CompiledLine<Q>[] {
  const out: CompiledLine<Q>[] = [];
  const outFor = new Map<string, Set<RestrictionKey>>();
  const adds = new Map<string, { line: QtyLine<Q>; keys: Set<RestrictionKey> }>();
  const addOrder: string[] = [];

  for (const v of variations) {
    for (const l of qtyChanges(v)) {
      if ((l.op === 'swap' || l.op === 'leave_out') && l.baseIngredientId) {
        const set = outFor.get(l.baseIngredientId) ?? new Set<RestrictionKey>();
        set.add(v.restriction);
        outFor.set(l.baseIngredientId, set);
      }
      if ((l.op === 'swap' || l.op === 'add') && l.ingredientId && l.qtyPerPerson != null) {
        const key = `${l.ingredientId}|${String(l.qtyPerPerson)}|${l.unitKey ?? ''}`;
        const entry = adds.get(key) ?? { line: { ingredientId: l.ingredientId, qtyPerPerson: l.qtyPerPerson, unitKey: l.unitKey }, keys: new Set<RestrictionKey>() };
        if (!adds.has(key)) addOrder.push(key);
        entry.keys.add(v.restriction);
        adds.set(key, entry);
      }
    }
  }

  for (const b of base) {
    const keys = outFor.get(b.ingredientId);
    out.push({
      ingredientId: b.ingredientId,
      qtyPerPerson: b.qtyPerPerson,
      unitKey: b.unitKey,
      servesRule: keys?.size ? 'except' : 'everyone',
      servesRestrictions: keys?.size ? sortKeys(keys) : []
    });
  }
  // Adds in restriction order, then in the order they were written.
  const addEntries = addOrder.map((k) => adds.get(k) as { line: QtyLine<Q>; keys: Set<RestrictionKey> });
  addEntries.sort((a, b) => Math.min(...[...a.keys].map((k) => ORDER[k])) - Math.min(...[...b.keys].map((k) => ORDER[k])));
  for (const e of addEntries) {
    out.push({ ...e.line, servesRule: 'only', servesRestrictions: sortKeys(e.keys) });
  }
  return out;
}

/** Compiled lines → base + diffs. Every "except" becomes a leave-out for each
 *  named restriction, every "only" an add — a swap comes back as leave-out +
 *  add (the relationship is not recorded in the lines). compileRecipe() of
 *  the result reproduces the lines. */
export function variationsFromLines(lines: readonly RecipeLine[]): { base: BaseLine[]; variations: Variation[] } {
  const base: BaseLine[] = [];
  const byRestriction = new Map<RestrictionKey, VariationLine[]>();
  const push = (r: RestrictionKey, l: VariationLine) => byRestriction.set(r, [...(byRestriction.get(r) ?? []), l]);

  for (const l of lines) {
    if (l.servesRule === 'only') {
      for (const r of l.servesRestrictions) {
        push(r, { op: 'add', baseIngredientId: null, ingredientId: l.ingredientId, qtyPerPerson: l.qtyPerPerson, unitKey: l.unitKey });
      }
      continue;
    }
    base.push({ ingredientId: l.ingredientId, qtyPerPerson: l.qtyPerPerson, unitKey: l.unitKey });
    if (l.servesRule === 'except') {
      for (const r of l.servesRestrictions) {
        push(r, { op: 'leave_out', baseIngredientId: l.ingredientId, ingredientId: null, qtyPerPerson: null, unitKey: null });
      }
    }
  }
  const variations: Variation[] = sortKeys(byRestriction.keys()).map((r) => ({
    restriction: r,
    state: 'substituted',
    note: null,
    lines: byRestriction.get(r) ?? []
  }));
  return { base, variations };
}

/** Which base ingredients carry this restriction's avoid flag. */
export function flaggedIngredients(base: readonly BaseLine[], restriction: RestrictionKey, catalog: Catalog): Ingredient[] {
  const byId = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const out: Ingredient[] = [];
  for (const b of base) {
    const i = byId.get(b.ingredientId);
    if (i && i.avoid.includes(restriction)) out.push(i);
  }
  return out;
}

export function variationView(
  base: readonly BaseLine[],
  /** The stored or drafted variation — only its state and whether it has any changes matter. */
  variation: { state: VariationState; lines: readonly unknown[]; restriction?: RestrictionKey; note?: string | null } | undefined,
  restriction: RestrictionKey,
  catalog: Catalog
): VariationView {
  if (variation) {
    if (variation.state === 'substituted') return variation.lines.length > 0 ? 'substituted' : 'needs_look';
    return variation.state;
  }
  return flaggedIngredients(base, restriction, catalog).length > 0 ? 'needs_look' : 'not_needed';
}

/** Decision 3: the engine counts people per restriction, not per person, so
 *  a gluten-free swap made with almond flour (a nut) can't be caught at
 *  planning time. Name it while the leader is authoring. */
export function crossRestrictionWarnings(variations: readonly Variation[], catalog: Catalog): string[] {
  const byId = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const v of variations) {
    const own = RESTRICTION_BY_KEY[v.restriction].label.toLowerCase();
    for (const l of changes(v)) {
      if (!(l.op === 'swap' || l.op === 'add') || !l.ingredientId) continue;
      const ing = byId.get(l.ingredientId);
      if (!ing) continue;
      for (const other of RESTRICTIONS) {
        if (other.key === v.restriction || !ing.avoid.includes(other.key)) continue;
        const theirs = other.label.toLowerCase();
        out.push(
          `${ing.name} in the ${own} version isn't ${theirs} — a scout who is both ${own} and ${theirs} gets nothing safe here.`
        );
      }
    }
  }
  return out;
}

/** "For gluten-free scouts: 3 changes" — the strip label on the public card. */
export function changeCount(v: Variation): number {
  return changes(v).length;
}

/** The diff as short phrases for the card strip and the print sheet:
 *  "½ cup pancake mix → 1 cup almond flour", "− butter", "+ 1 egg". */
export function diffText(v: Variation, base: readonly BaseLine[], catalog: Catalog): string[] {
  const byId = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const baseById = new Map(base.map((b) => [b.ingredientId, b]));
  const what = (ingredientId: string, qty: number | null, unitKey: string | null) => {
    const ing = byId.get(ingredientId);
    if (!ing) return ingredientId;
    return qty == null ? ing.name.toLowerCase() : perPersonText(qty, ing, lineUnit(unitKey, ing));
  };
  const out: string[] = [];
  for (const l of changes(v)) {
    if (l.op === 'leave_out' && l.baseIngredientId) {
      out.push(`− ${byId.get(l.baseIngredientId)?.name.toLowerCase() ?? l.baseIngredientId}`);
    } else if (l.op === 'swap' && l.baseIngredientId && l.ingredientId) {
      const b = baseById.get(l.baseIngredientId);
      out.push(`${what(l.baseIngredientId, b?.qtyPerPerson ?? null, b?.unitKey ?? null)} → ${what(l.ingredientId, l.qtyPerPerson, l.unitKey)}`);
    } else if (l.op === 'add' && l.ingredientId) {
      out.push(`+ ${what(l.ingredientId, l.qtyPerPerson, l.unitKey)}`);
    }
  }
  return out;
}

/** A recipe's variations, or — for one that predates them — the diffs its lines imply. */
export function variationsOf(recipe: { lines: readonly RecipeLine[]; variations?: Variation[] }): Variation[] {
  return recipe.variations && recipe.variations.length > 0 ? recipe.variations : variationsFromLines(recipe.lines).variations;
}

/** The base lines of a recipe: what an unrestricted person gets. */
export function baseOf(recipe: { lines: readonly RecipeLine[] }): BaseLine[] {
  return variationsFromLines(recipe.lines).base;
}
