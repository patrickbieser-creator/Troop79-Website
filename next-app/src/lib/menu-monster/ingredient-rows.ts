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

import type { Catalog, Plan, Recipe, RecipeLine } from './types';
import type { EditOp } from './menus';
import { effectiveRestrictions, ruleText, servingsFor } from './engine';
import { conv, fracText, lineUnit, qtyText } from './units';

/** 'total' = what to buy for the meal's headcount; 'person' = one person's share. */
export type AmountView = 'total' | 'person';

/** What happened to a row in a menu's version of the recipe (Phase 2). */
export type RowMarker = { kind: 'changed' | 'added' | 'swapped' | 'out'; was?: string };

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
  const target = new Map<string, Exclude<EditOp, { op: 'add' }>>();
  for (const o of ops) if (o.op !== 'add') target.set(o.ingredientId, o);
  const unitLabel = (unitKey: string | null, ingredientId: string) => {
    const ing = ING.get(ingredientId);
    return ing ? lineUnit(unitKey, ing).many : '';
  };

  const rows: IngredientRow[] = [];
  recipe.lines.forEach((line, i) => {
    const baseRow = oneRow(line, catalog, plan, view);
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
      baseName: baseRow.name
    };
    const o = target.get(id);
    if (!o) {
      rows.push({ ...baseRow, key, edit: plain });
    } else if (o.op === 'leave_out') {
      rows.push({ ...baseRow, key, amount: '', marker: { kind: 'out' }, edit: { ...plain, op: 'leave_out' } });
    } else if (o.op === 'amount') {
      const edited = oneRow({ ...line, qtyPerPerson: o.qtyPerPerson }, catalog, plan, view) ?? baseRow;
      rows.push({ ...edited, key, marker: { kind: 'changed', was: baseRow.amount }, edit: { ...plain, qtyPerPerson: o.qtyPerPerson, op: 'amount' } });
    } else {
      const swapped = oneRow({ ...line, ingredientId: o.to, qtyPerPerson: o.qtyPerPerson, unitKey: null }, catalog, plan, view);
      if (!swapped) rows.push({ ...baseRow, key, edit: plain });
      else
        rows.push({
          ...swapped,
          key,
          marker: { kind: 'swapped', was: baseRow.name },
          edit: { ...plain, currentIngredientId: o.to, qtyPerPerson: o.qtyPerPerson, unitLabel: unitLabel(null, o.to), op: 'swap' }
        });
    }
  });

  for (const o of ops) {
    if (o.op !== 'add') continue;
    const line: RecipeLine = { ingredientId: o.ingredientId, qtyPerPerson: o.qtyPerPerson, unitKey: null, servesRule: 'everyone', servesRestrictions: [] };
    const row = oneRow(line, catalog, plan, view);
    if (!row) continue;
    rows.push({
      ...row,
      key: `add:${o.ingredientId}`,
      marker: { kind: 'added' },
      edit: { kind: 'added', ingredientId: o.ingredientId, currentIngredientId: o.ingredientId, qtyPerPerson: o.qtyPerPerson, unitLabel: unitLabel(null, o.ingredientId) }
    });
  }
  return rows;
}

/* ---- Op builders: each returns the recipe's NEW ops list (never mutates) ------ */

const targetOf = (o: EditOp, id: string) => o.op !== 'add' && o.ingredientId === id;
const withoutTarget = (ops: readonly EditOp[], id: string) => ops.filter((o) => !targetOf(o, id));
const roundQty = (n: number) => Math.round(n * 10000) / 10000;

/** A row's per-person amount set to qty: an added row's add op, a swapped row's swap op, else an amount op (none when it equals the troop's). */
export function opsWithAmount(ops: readonly EditOp[], edit: RowEdit, qty: number): EditOp[] {
  const q = roundQty(qty);
  if (edit.kind === 'added') return ops.map((o) => (o.op === 'add' && o.ingredientId === edit.ingredientId ? { ...o, qtyPerPerson: q } : o));
  if (edit.op === 'swap') return ops.map((o) => (o.op === 'swap' && o.ingredientId === edit.ingredientId ? { ...o, qtyPerPerson: q } : o));
  const rest = withoutTarget(ops, edit.ingredientId);
  if (edit.baseQty != null && Math.abs(q - edit.baseQty) < 1e-6) return rest;
  return [...rest, { op: 'amount', ingredientId: edit.ingredientId, qtyPerPerson: q }];
}

/** A base row swapped for another ingredient, at qty per person in the new ingredient's own unit. */
export function opsWithSwap(ops: readonly EditOp[], edit: RowEdit, to: string, qty: number): EditOp[] {
  return [...withoutTarget(ops, edit.ingredientId), { op: 'swap', ingredientId: edit.ingredientId, to, qtyPerPerson: roundQty(qty) }];
}

export function opsWithLeaveOut(ops: readonly EditOp[], edit: RowEdit): EditOp[] {
  return [...withoutTarget(ops, edit.ingredientId), { op: 'leave_out', ingredientId: edit.ingredientId }];
}

/** Put back / back to the troop amount / back to the troop ingredient: drop the row's own op. */
export function opsWithoutOp(ops: readonly EditOp[], edit: RowEdit): EditOp[] {
  return withoutTarget(ops, edit.ingredientId);
}

export function opsWithAdded(ops: readonly EditOp[], ingredientId: string, qty: number): EditOp[] {
  return [...ops.filter((o) => !(o.op === 'add' && o.ingredientId === ingredientId)), { op: 'add', ingredientId, qtyPerPerson: roundQty(qty) }];
}

export function opsWithoutAdded(ops: readonly EditOp[], ingredientId: string): EditOp[] {
  return ops.filter((o) => !(o.op === 'add' && o.ingredientId === ingredientId));
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
