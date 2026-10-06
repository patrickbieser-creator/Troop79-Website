/**
 * Menu Monster — the rows an ingredient list shows (Plans/Menu-Monster-Scout-
 * Workspace.md, slice 4b). Pure: no React, no DB. The engine's own serves rules
 * (servingsFor) and the units helpers (conv, lineUnit, qtyText, fracText) do
 * all the arithmetic; this module only picks the words, so what a scout reads
 * here can never disagree with what the shopping list buys.
 *
 * Feed it a recipe whose lines already carry the meal's edits
 * (menus.ts mealCatalog / applyRecipeEdits) and the list shows the scout's
 * version with no extra work.
 */

import type { Catalog, Plan, Recipe, RecipeLine, RestrictionKey } from './types';
import { scopeOf, type EditOp } from './menus';
import { effectiveRestrictions, ruleText, servingsFor } from './engine';
import { RESTRICTION_BY_KEY, conv, fracText, lineUnit, qtyText } from './units';

/** 'total' = what to buy for the meal's headcount; 'person' = one person's share. */
export type AmountView = 'total' | 'person';

/** What happened to a row in a menu's version of the recipe (Phase 2). */
export type RowMarker = { kind: 'changed' | 'added' | 'swapped' | 'out'; was?: string };

/**
 * A row that is for one diet's scouts only (a menu's scoped op): 'only' = a line just for them
 * (swapped in or added), 'except' = the troop's line with them left out.
 */
export interface RowScope {
  mode: 'only' | 'except';
  restrictions: RestrictionKey[];
  /** Nobody on this meal is in the diet: the row stays (dimmed, so nothing is hidden) but feeds no one. */
  idle: boolean;
}

const dietName = (k: RestrictionKey) => RESTRICTION_BY_KEY[k].label.toLowerCase();
const dietList = (ks: readonly RestrictionKey[]) => ks.map(dietName).join(' or ');

/** The quiet marker words for a scoped row: 'Gluten-free scouts only' / 'except gluten-free'. Never colour alone. */
export function scopeLabel(scope: RowScope): string {
  const list = dietList(scope.restrictions);
  return scope.mode === 'only' ? `${list.charAt(0).toUpperCase()}${list.slice(1)} scouts only` : `except ${list}`;
}

/** Why an idle scoped row feeds no one: 'no gluten-free scouts on this meal'. */
export function idleLabel(scope: RowScope): string {
  return `no ${dietList(scope.restrictions)} scouts on this meal`;
}

export interface IngredientRow {
  /** Stable within the recipe: the line's index and ingredient. */
  key: string;
  /** 'Almond flour'. */
  name: string;
  /** The amount for the view, already worded: '3½ cups', '30 slices', '2'. */
  amount: string;
  /** Who a diet line is for: 'gluten-free only' / 'everyone else'; null for a plain line. */
  note: string | null;
  /** Menu-edit mode: Changed / Added / Swapped / Left out, with the struck old value. The read list shows it when present (a leader reading a scout's menu). */
  marker?: RowMarker;
  /** Menu-edit mode: set when the row is for one diet's scouts only (or leaves them out). */
  scope?: RowScope;
  /** Menu-edit mode: what the row's actions need to build an op (see menuEditRows). */
  edit?: RowEdit;
}

/** The facts a menu-edit row's actions (amount / swap / leave out / put back) work from. */
export interface RowEdit {
  /** 'base' = a line of the troop recipe; 'added' = an ingredient the scout added. */
  kind: 'base' | 'added';
  /** The ingredient ops target: the recipe line's own ingredient (base) or the added one. */
  ingredientId: string;
  /** The ingredient the row shows now: differs from ingredientId on a swapped row. */
  currentIngredientId: string;
  /** Per-person amount now, in the unit named by unitLabel. */
  qtyPerPerson: number;
  /** Plural unit name for labels: 'cups', 'slices', 'eggs'. */
  unitLabel: string;
  /** The troop recipe's per-person amount (base rows). */
  baseQty?: number;
  /** The unit key the troop line is written in (null = the ingredient's own). */
  baseUnitKey?: string | null;
  /** The troop recipe's ingredient name (base rows), for 'Back to Pancake mix'. */
  baseName?: string;
  /** The op currently on a base row; undefined = as the troop wrote it. */
  op?: 'amount' | 'swap' | 'leave_out';
  /** Set when this row IS a diet-scoped op (a swapped-in or added line for these scouts): its actions edit that op. */
  scope?: RestrictionKey;
  /** A troop line everyone eats: it may be swapped or left out for one diet's scouts. */
  scopable?: boolean;
  /** Diets the troop's own line already leaves out (its recipe says 'everyone except …'): nothing to add there. */
  recipeOut?: RestrictionKey[];
  /** Diets this base row is already left out for (a scoped leave_out), so "Put back for …" can be offered. */
  scopedOut?: RestrictionKey[];
}

export function ingredientRows(
  recipe: Pick<Recipe, 'lines'>,
  catalog: Catalog,
  plan: Pick<Plan, 'headcount' | 'restrictions'>,
  view: AmountView
): IngredientRow[] {
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const people = plan.headcount;
  const R = effectiveRestrictions(plan as Plan);
  const dietsInPlay = Object.values(R).some((n) => n > 0);
  const rows: IngredientRow[] = [];

  recipe.lines.forEach((line, i) => {
    const ing = ING.get(line.ingredientId);
    // The same lines buildLines() skips: unknown ingredient, no conversion path, no amount.
    if (!ing || !(line.qtyPerPerson > 0) || conv(line.unitKey, ing, catalog.conversions) == null) return;
    const fed = servingsFor(line, people, R);
    if (fed <= 0) return; // a diet swap nobody needs

    const unit = lineUnit(line.unitKey, ing);
    const qty = view === 'total' ? line.qtyPerPerson * fed : line.qtyPerPerson;
    const exact = view === 'person';
    // "Eggs · 2", not "Eggs · 2 eggs": the unit already names the ingredient.
    const amount = ing.name.toLowerCase().includes(unit.many)
      ? unit.kind === 'count' && !exact
        ? String(Math.ceil(qty - 1e-9))
        : fracText(qty)
      : qtyText(qty, unit, exact);

    let note: string | null = null;
    if (line.servesRule === 'only' && line.servesRestrictions.length > 0) note = `${ruleText(line).replace(/^only /, '')} only`;
    else if (line.servesRule === 'except' && fed < people) note = 'everyone else';
    // A scout's typed-in no leader has checked yet: its diet ticks are unverified (Phase 4B).
    if (ing.needsMatch && dietsInPlay) note = note ? `${note} · not checked for diets` : 'Not checked for diets';

    rows.push({ key: `${i}:${line.ingredientId}`, name: ing.name, amount, note });
  });
  return rows;
}

/* ---- Menu-edit mode: the troop recipe plus this menu's ops ------------------- */

/** One recipe line as the single row the read list would show (or undefined when it shows none). */
function oneRow(line: RecipeLine, catalog: Catalog, plan: Pick<Plan, 'headcount' | 'restrictions'>, view: AmountView): IngredientRow | undefined {
  return ingredientRows({ lines: [line] }, catalog, plan, view)[0];
}

/**
 * The rows of a recipe's list on a menu, WITH the menu's ops visible: a changed
 * amount keeps the troop's amount as marker.was, a swapped row the troop's
 * ingredient, a left-out row stays (dimmed) so it can be put back, and each add
 * op is a row at the end. `recipe` is the shared recipe (NOT already edited);
 * the arithmetic is ingredientRows' own, one line at a time, so the numbers
 * match the shopping list. Pure.
 */
export function menuEditRows(
  recipe: Pick<Recipe, 'lines'>,
  ops: readonly EditOp[],
  catalog: Catalog,
  plan: Pick<Plan, 'headcount' | 'restrictions'>,
  view: AmountView
): IngredientRow[] {
  const ING = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const R = effectiveRestrictions(plan as Plan);
  const target = new Map<string, Exclude<EditOp, { op: 'add' }>>();
  for (const o of ops) if (o.op !== 'add' && scopeOf(o) === undefined) target.set(o.ingredientId, o);
  const unitLabel = (unitKey: string | null, ingredientId: string) => {
    const ing = ING.get(ingredientId);
    return ing ? lineUnit(unitKey, ing).many : '';
  };
  // "gluten-free only" / "everyone else" say what the scope marker already says: keep only what follows.
  const stripRule = (note: string | null) => (note ? note.replace(/^(everyone else|.+ only)( · )?/, '') || null : null);
  const blank = (row: IngredientRow | undefined): IngredientRow | undefined => (row ? { ...row, amount: '' } : undefined);

  /** A line just for one diet's scouts: feeds none of them when the meal has none, but still shows. */
  const onlyRow = (ingredientId: string, qty: number, r: RestrictionKey): IngredientRow | undefined => {
    const line: RecipeLine = { ingredientId, qtyPerPerson: qty, unitKey: null, servesRule: 'only', servesRestrictions: [r] };
    const idle = !(R[r] > 0);
    const row = idle ? blank(oneRow({ ...line, servesRule: 'everyone', servesRestrictions: [] }, catalog, plan, view)) : oneRow(line, catalog, plan, view);
    return row && { ...row, note: stripRule(row.note), scope: { mode: 'only', restrictions: [r], idle } };
  };

  const rows: IngredientRow[] = [];
  recipe.lines.forEach((line, i) => {
    // This menu's "not for <diet> scouts" ops on the troop's line (a swap or a leave-out); a diet line of the recipe's own is not touched.
    const scopedOps =
      line.servesRule === 'only'
        ? []
        : ops.filter((o): o is Extract<EditOp, { op: 'swap' | 'leave_out' }> => (o.op === 'swap' || o.op === 'leave_out') && o.for !== undefined && o.ingredientId === line.ingredientId);
    const outKeys = [...new Set(scopedOps.map((o) => o.for as RestrictionKey))];
    // The line as the engine will read it: the troop's, minus those diets.
    const scoped = (l: RecipeLine): RecipeLine =>
      outKeys.length === 0
        ? l
        : { ...l, servesRule: 'except', servesRestrictions: [...new Set([...(l.servesRule === 'except' ? l.servesRestrictions : []), ...outKeys])] };

    const baseRow = oneRow(scoped(line), catalog, plan, view) ?? (outKeys.length > 0 ? blank(oneRow(line, catalog, plan, view)) : undefined);
    if (!baseRow) return;
    const key = `${i}:${line.ingredientId}`;
    const id = line.ingredientId;
    const plain: RowEdit = {
      kind: 'base',
      ingredientId: id,
      currentIngredientId: id,
      qtyPerPerson: line.qtyPerPerson,
      unitLabel: unitLabel(line.unitKey, id),
      baseQty: line.qtyPerPerson,
      baseUnitKey: line.unitKey,
      baseName: baseRow.name,
      scopable: line.servesRule !== 'only',
      ...(line.servesRule === 'except' ? { recipeOut: line.servesRestrictions } : {}),
      ...(outKeys.length > 0 ? { scopedOut: scopedOps.filter((o) => o.op === 'leave_out').map((o) => o.for as RestrictionKey) } : {})
    };
    const o = target.get(id);
    let row: IngredientRow;
    if (!o) {
      row = { ...baseRow, key, edit: plain };
    } else if (o.op === 'leave_out') {
      row = { ...baseRow, key, amount: '', marker: { kind: 'out' }, edit: { ...plain, op: 'leave_out' } };
    } else if (o.op === 'amount') {
      const edited = oneRow(scoped({ ...line, qtyPerPerson: o.qtyPerPerson }), catalog, plan, view) ?? baseRow;
      row = { ...edited, key, marker: { kind: 'changed', was: baseRow.amount }, edit: { ...plain, qtyPerPerson: o.qtyPerPerson, op: 'amount' } };
    } else {
      const swapped = oneRow(scoped({ ...line, ingredientId: o.to, qtyPerPerson: o.qtyPerPerson, unitKey: null }), catalog, plan, view);
      row = !swapped
        ? { ...baseRow, key, edit: plain }
        : {
            ...swapped,
            key,
            marker: { kind: 'swapped', was: baseRow.name },
            edit: { ...plain, currentIngredientId: o.to, qtyPerPerson: o.qtyPerPerson, unitLabel: unitLabel(null, o.to), op: 'swap' }
          };
    }
    if (outKeys.length > 0 && row.marker?.kind !== 'out') {
      row = { ...row, note: stripRule(row.note), scope: { mode: 'except', restrictions: outKeys, idle: outKeys.every((k) => !(R[k] > 0)) } };
    }
    rows.push(row);

    // A scoped swap's new ingredient is its own row, just for those scouts, right under the troop's.
    for (const s of scopedOps) {
      if (s.op !== 'swap') continue;
      const r = s.for as RestrictionKey;
      const to = onlyRow(s.to, s.qtyPerPerson, r);
      if (!to) continue;
      rows.push({
        ...to,
        key: `swap:${r}:${id}`,
        marker: { kind: 'swapped', was: baseRow.name },
        edit: { ...plain, scopedOut: undefined, scopable: false, scope: r, currentIngredientId: s.to, qtyPerPerson: s.qtyPerPerson, unitLabel: unitLabel(null, s.to), op: 'swap' }
      });
    }
  });

  for (const o of ops) {
    if (o.op !== 'add') continue;
    const r = o.for;
    const row = r
      ? onlyRow(o.ingredientId, o.qtyPerPerson, r)
      : oneRow({ ingredientId: o.ingredientId, qtyPerPerson: o.qtyPerPerson, unitKey: null, servesRule: 'everyone', servesRestrictions: [] }, catalog, plan, view);
    if (!row) continue;
    rows.push({
      ...row,
      key: r ? `add:${r}:${o.ingredientId}` : `add:${o.ingredientId}`,
      marker: { kind: 'added' },
      edit: { kind: 'added', ingredientId: o.ingredientId, currentIngredientId: o.ingredientId, qtyPerPerson: o.qtyPerPerson, unitLabel: unitLabel(null, o.ingredientId), ...(r ? { scope: r } : {}) }
    });
  }
  return rows;
}

/* ---- Op builders: each returns the recipe's NEW ops list (never mutates) ------ */
// A row's own op is told apart by its target AND its diet: "for everyone" and "for gluten-free scouts" can both sit on one ingredient.

const targetOf = (o: EditOp, id: string, scope: RestrictionKey | undefined) => o.op !== 'add' && o.ingredientId === id && scopeOf(o) === scope;
const withoutTarget = (ops: readonly EditOp[], id: string, scope?: RestrictionKey) => ops.filter((o) => !targetOf(o, id, scope));
const roundQty = (n: number) => Math.round(n * 10000) / 10000;
const withScope = (scope: RestrictionKey | undefined): { for?: RestrictionKey } => (scope ? { for: scope } : {});

/** A row's per-person amount set to qty: an added row's add op, a swapped row's swap op, else an amount op (none when it equals the troop's). */
export function opsWithAmount(ops: readonly EditOp[], edit: RowEdit, qty: number): EditOp[] {
  const q = roundQty(qty);
  if (edit.kind === 'added') return ops.map((o) => (o.op === 'add' && o.ingredientId === edit.ingredientId && scopeOf(o) === edit.scope ? { ...o, qtyPerPerson: q } : o));
  if (edit.op === 'swap') return ops.map((o) => (o.op === 'swap' && o.ingredientId === edit.ingredientId && scopeOf(o) === edit.scope ? { ...o, qtyPerPerson: q } : o));
  const rest = withoutTarget(ops, edit.ingredientId, undefined);
  if (edit.baseQty != null && Math.abs(q - edit.baseQty) < 1e-6) return rest;
  return [...rest, { op: 'amount', ingredientId: edit.ingredientId, qtyPerPerson: q }];
}

/** A base row swapped for another ingredient, at qty per person in the new ingredient's own unit. `scope`: for that diet's scouts only. */
export function opsWithSwap(ops: readonly EditOp[], edit: RowEdit, to: string, qty: number, scope: RestrictionKey | undefined = edit.scope): EditOp[] {
  return [...withoutTarget(ops, edit.ingredientId, scope), { op: 'swap', ingredientId: edit.ingredientId, to, qtyPerPerson: roundQty(qty), ...withScope(scope) }];
}

export function opsWithLeaveOut(ops: readonly EditOp[], edit: RowEdit, scope: RestrictionKey | undefined = edit.scope): EditOp[] {
  return [...withoutTarget(ops, edit.ingredientId, scope), { op: 'leave_out', ingredientId: edit.ingredientId, ...withScope(scope) }];
}

/** Put back / back to the troop amount / back to the troop ingredient: drop the row's own op (the one for its diet, if it has one). */
export function opsWithoutOp(ops: readonly EditOp[], edit: RowEdit, scope: RestrictionKey | undefined = edit.scope): EditOp[] {
  return withoutTarget(ops, edit.ingredientId, scope);
}

export function opsWithAdded(ops: readonly EditOp[], ingredientId: string, qty: number, scope?: RestrictionKey): EditOp[] {
  return [...ops.filter((o) => !(o.op === 'add' && o.ingredientId === ingredientId && scopeOf(o) === scope)), { op: 'add', ingredientId, qtyPerPerson: roundQty(qty), ...withScope(scope) }];
}

export function opsWithoutAdded(ops: readonly EditOp[], ingredientId: string, scope?: RestrictionKey): EditOp[] {
  return ops.filter((o) => !(o.op === 'add' && o.ingredientId === ingredientId && scopeOf(o) === scope));
}

/**
 * A starting per-person amount for a swap: the troop's own amount when the new
 * ingredient is counted in the same unit as the troop's line, else 1 (the scout
 * sets it next; a cup of flour is not a cup of eggs).
 */
export function defaultSwapQty(edit: RowEdit, to: string, catalog: Catalog): number {
  const from = catalog.ingredients.find((i) => i.id === edit.ingredientId);
  const next = catalog.ingredients.find((i) => i.id === to);
  if (!from || !next || edit.baseQty == null) return 1;
  return lineUnit(edit.baseUnitKey, from).key === next.unit.key ? edit.baseQty : 1;
}
