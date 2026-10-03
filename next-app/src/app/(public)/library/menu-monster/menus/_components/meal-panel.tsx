'use client';

/**
 * One meal, open inline on the Plan tab (Plans/Menu-Monster-Scout-Workspace.md,
 * "Meals inline on the Plan tab" — Patrick, 2026-10-03: the separate meal page
 * was too many clicks). Clicking a meal's name on the Plan tab opens this panel
 * under it; it was the meal page:
 *
 *   - one quiet row per recipe: its name is a disclosure that opens the recipe's
 *     ingredient list — the menu's OWN version of it (IngredientList, menu-edit
 *     mode: change an amount, swap, leave out, add — typed-ins too), the recipe's
 *     share of the meal in the right column, a ⋯ with Swap recipe…, Back to the
 *     troop recipe, Share this version as a new recipe, and Remove;
 *   - a dashed search at the end adds a recipe that fits this slot (a combobox +
 *     listbox, fully keyboard-operable; "Swap X for…" while swapping);
 *   - a People dialer for this meal (Reset to the menu's number);
 *   - its own status line — what just happened, Undo after a remove or swap;
 *   - a quiet warning under a recipe that isn't for someone the menu counts
 *     (ported from the retired planner: unsuitable, or gluten / nuts with no swap).
 * The meal's cost is the Plan tab row's right column (Jenna, 2026-10-03: no
 * footer repeating it).
 *
 * Controlled: the meal lives in the Plan tab's ONE draft (one Save / Discard on
 * the title line, the save standard). Every change goes up through `onChange`
 * as the whole next meal; this panel keeps only its own UI state (which recipe
 * is open, the search, the swap). The Total to buy / Per person switch is the
 * Plan tab's, passed in as `view`.
 *
 * `readOnly`: People as text, recipes opening to plain ingredient rows, and no
 * ⋯ menus, search or Undo.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { priceText as money } from '@/lib/menu-monster/units';
import { Button } from '@/app/_components/button';
import { Stepper } from '@/app/_components/stepper';
import { Notice } from '@/app/_components/notice';
import type { Catalog, Plan, Recipe } from '@/lib/menu-monster/types';
import { MAX_HEADCOUNT, MIN_HEADCOUNT, recipesForMeal, restrictionWarnings } from '@/lib/menu-monster/engine';
import { isPickable } from '@/lib/menu-monster/scout-recipes';
import { RECIPES_HREF } from '../../recipes/_components/paths';
import { composePlan, mealCatalog, type EditOp, type Menu, type MenuMeal, type RecipeEdits } from '@/lib/menu-monster/menus';
import { mealTitle, recipeShares } from '@/lib/menu-monster/menu-view';
import {
  defaultSwapQty,
  menuEditRows,
  opsWithAdded,
  opsWithAmount,
  opsWithLeaveOut,
  opsWithSwap,
  opsWithoutAdded,
  opsWithoutOp,
  type AmountView
} from '@/lib/menu-monster/ingredient-rows';
import type { NewIngredient } from '@/lib/menu-monster/scout-ingredients';
import { MenuNewIngredient } from './menu-new-ingredient';
import { IngredientList, type RowAction } from '../../_components/ingredient-list';
import { RowMenu } from './row-menu';
import s from './workspace.module.css';

/** The part of a meal a remove, swap or "back to the troop recipe" can undo. */
type UndoPoint = Pick<MenuMeal, 'recipeIds' | 'recipeEdits'>;

interface Status {
  text: string;
  undoTo: UndoPoint | null;
  /** Hand focus to Undo: a remove leaves nothing else focused. */
  focusUndo?: boolean;
}

export interface MealPanelProps {
  /** The catalog the menu prices with (the Plan tab's, typed-ins added this visit included). */
  catalog: Catalog;
  /** The menu as drafted now (the meal's people and the diets come from it). */
  menu: Menu;
  meal: MenuMeal;
  view: AmountView;
  readOnly?: boolean;
  onChange: (next: MenuMeal) => void;
  /** A signed-in scout's saved menu: "Add “x” as a new ingredient" (release C). */
  canTypeIn?: boolean;
  onTyped?: (n: NewIngredient) => void;
  /** Set when "Share this version as a new recipe" may link out: a saved menu, no unsaved changes. */
  shareVersionMenuId?: string | null;
}

export function MealPanel({ catalog, menu, meal, view, readOnly = false, onChange, canTypeIn = false, onTyped, shareVersionMenuId = null }: MealPanelProps) {
  const uid = useId();
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ text: '', undoTo: null });
  const [swapId, setSwapId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status.focusUndo) undoRef.current?.focus();
  }, [status]);

  const people = meal.headcount ?? menu.headcount;
  const edits = meal.recipeEdits ?? {};
  const plan: Plan = composePlan(menu, meal);
  // Ported from the retired planner: a recipe that isn't for someone the menu counts says so. Measured
  // on the meal's own version (its edits applied), so leaving the ingredient out clears the warning.
  const warnings = restrictionWarnings(plan, mealCatalog(catalog, meal));
  const choices = catalog.ingredients.map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const recipeName = (id: string) => byId.get(id)?.name ?? id;
  // Each recipe's share of the meal (shared packages split), so the rows add up to the footer.
  const shares = recipeShares(menu, meal, catalog);
  const costOf = (id: string) => (view === 'total' ? (shares[id] ?? 0) : (shares[id] ?? 0) / plan.headcount);
  const overridden = people !== menu.headcount;
  const candidates = recipesForMeal(catalog, meal.slot).filter((r) => isPickable(r) && !meal.recipeIds.includes(r.id));
  const matches = candidates.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const act = Math.min(active, Math.max(0, matches.length - 1));
  const showList = listOpen && matches.length > 0;
  const swapping = swapId ? recipeName(swapId) : null;
  const addLabel = swapping ? `Swap ${swapping} for` : `Add a recipe to ${mealTitle(menu.startDate, meal.day, meal.slot)}`;
  const title = mealTitle(menu.startDate, meal.day, meal.slot);

  const change = (next: Partial<MenuMeal>) => onChange({ ...meal, ...next });
  const setPeople = (n: number) => {
    const v = Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT));
    change({ headcount: v === menu.headcount ? null : v });
  };

  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const clearSearch = () => {
    setQuery('');
    setListOpen(false);
    setActive(0);
  };

  const without = (e: RecipeEdits, rid: string): RecipeEdits => {
    const { [rid]: dropped, ...rest } = e;
    void dropped;
    return rest;
  };
  const undoPoint = (): UndoPoint => ({ recipeIds: meal.recipeIds, recipeEdits: edits });

  function remove(id: string) {
    const before = undoPoint();
    // A removed recipe takes this meal's edits to it along (sanitizeMenu would drop them anyway).
    change({ recipeIds: before.recipeIds.filter((x) => x !== id), recipeEdits: without(edits, id) });
    setStatus({ text: `${recipeName(id)} removed.`, undoTo: before, focusUndo: true });
  }

  function pick(r: Recipe) {
    const before = undoPoint();
    if (swapId) {
      change({ recipeIds: before.recipeIds.map((x) => (x === swapId ? r.id : x)), recipeEdits: without(edits, swapId) });
      setStatus({ text: `Swapped ${recipeName(swapId)} for ${r.name}.`, undoTo: before });
      setSwapId(null);
    } else {
      change({ recipeIds: [...before.recipeIds, r.id] });
      setStatus({ text: `${r.name} added.`, undoTo: null });
    }
    clearSearch();
    inputRef.current?.focus();
  }

  function undo() {
    if (!status.undoTo) return;
    change(status.undoTo);
    setStatus({ text: 'Undone.', undoTo: null });
    inputRef.current?.focus();
  }

  /* ---- This menu's version of a recipe ---- */
  const rowsFor = (rid: string) => {
    const recipe = byId.get(rid);
    return recipe ? menuEditRows(recipe, edits[rid] ?? [], catalog, plan, view) : [];
  };
  const setOps = (rid: string, next: EditOp[]) => {
    const rest = without(edits, rid);
    change({ recipeEdits: next.length > 0 ? { ...rest, [rid]: next } : rest });
  };

  function onIngredientAction(rid: string, a: RowAction) {
    const ops = edits[rid] ?? [];
    if (a.type === 'add') {
      setOps(rid, opsWithAdded(ops, a.ingredientId, 1));
      return;
    }
    const e = rowsFor(rid).find((r) => r.key === a.key)?.edit;
    if (!e) return;
    if (a.type === 'amount') setOps(rid, opsWithAmount(ops, e, a.qtyPerPerson));
    else if (a.type === 'swap') setOps(rid, opsWithSwap(ops, e, a.to, defaultSwapQty(e, a.to, catalog)));
    else if (a.type === 'leave_out') setOps(rid, opsWithLeaveOut(ops, e));
    else if (a.type === 'remove') setOps(rid, opsWithoutAdded(ops, e.ingredientId));
    else setOps(rid, opsWithoutOp(ops, e)); // put_back, reset
  }

  function backToTroop(rid: string) {
    const before = undoPoint();
    change({ recipeEdits: without(edits, rid) });
    setStatus({ text: `Back to the troop recipe for ${recipeName(rid)}.`, undoTo: before });
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!listOpen) setListOpen(true);
      else setActive(Math.min(act + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(act - 1, 0));
    } else if (e.key === 'Enter') {
      if (showList) {
        e.preventDefault();
        pick(matches[act]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      setSwapId(null);
    }
  }

  return (
    <div className={s.mealPanel}>
      {readOnly ? (
        // The menu's diets are on the line above this meal; only the meal's own count is repeated here.
        <p className={s.foot}>People: {people}</p>
      ) : (
        <div className={s.line}>
          <Stepper
            id={`${uid}-people`}
            label="People"
            value={people}
            min={MIN_HEADCOUNT}
            max={MAX_HEADCOUNT}
            onChange={setPeople}
            groupLabel={`People for ${title}`}
            lessLabel="One fewer person"
            moreLabel="One more person"
          />
          {overridden && (
            <Button variant="ghost" onClick={() => setPeople(menu.headcount)}>
              Reset to {menu.headcount}
            </Button>
          )}
        </div>
      )}

      <ul className={s.card} aria-label={`Recipes in ${title}`}>
        {meal.recipeIds.length === 0 && <li className={s.empty}>{readOnly ? 'Nothing picked yet.' : 'Nothing picked yet. Search below to add a recipe.'}</li>}
        {meal.recipeIds.map((id) => {
          const name = recipeName(id);
          const open = openIds.has(id);
          const edited = edits[id]?.length ?? 0;
          const panel = `${uid}-ing-${id}`;
          return (
            <li key={id} className={s.row}>
              <div className={s.rowMain}>
                <button type="button" className={s.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => toggle(id)}>
                  {name}
                  <span className={s.chev} aria-hidden="true">
                    ›
                  </span>
                </button>
                {edited > 0 && <span className={s.meta}>Your version · {edited}</span>}
              </div>
              <div className={s.cost}>{money(costOf(id))}</div>
              {warnings
                .filter((w) => w.recipe.id === id)
                .map((w) => (
                  <Notice key={w.restriction.key} tone="warning" className={s.mealWarn}>
                    <span aria-hidden="true">⚠ </span>
                    {w.count === 1 ? '1 person is' : `${w.count} people are`} {w.restriction.label.toLowerCase()} and this{' '}
                    {w.kind === 'unsuitable' ? 'isn’t for them' : `has ${w.ingredients.join(', ').toLowerCase()}`}. Plan something else for them.
                  </Notice>
                ))}
              {!readOnly && (
                <RowMenu
                  label={`More for ${name}`}
                  items={[
                    {
                      label: 'Swap recipe…',
                      onSelect: () => {
                        setSwapId(id);
                        inputRef.current?.focus();
                      }
                    },
                    ...(edited > 0 ? [{ label: 'Back to the troop recipe', onSelect: () => backToTroop(id) }] : []),
                    // Phase 4C: a scout's saved version of a recipe can become a recipe of its own.
                    ...(edited > 0 && shareVersionMenuId
                      ? [{ label: 'Share this version as a new recipe', href: `${RECIPES_HREF}/new?menu=${encodeURIComponent(shareVersionMenuId)}&meal=${encodeURIComponent(meal.id)}&recipe=${encodeURIComponent(id)}` }]
                      : []),
                    { label: 'Remove', danger: true, onSelect: () => remove(id) }
                  ]}
                />
              )}
              {open && (
                <div id={panel} className={s.inset}>
                  {readOnly ? (
                    <IngredientList mode="read" dense ariaLabel={`${name} ingredients`} rows={rowsFor(id)} emptyText="No ingredients on this recipe yet." />
                  ) : (
                    <>
                      <IngredientList
                        mode="menu-edit"
                        dense
                        ariaLabel={`${name} ingredients`}
                        rows={rowsFor(id)}
                        choices={choices}
                        emptyText="No ingredients on this recipe yet."
                        onAction={(a) => onIngredientAction(id, a)}
                        onAnnounce={(text) => setStatus({ text, undoTo: null })}
                        renderNew={
                          canTypeIn
                            ? (typedName, done) => (
                                <MenuNewIngredient
                                  name={typedName}
                                  catalog={catalog}
                                  onCancel={() => done(null)}
                                  onAdded={(n) => {
                                    onTyped?.(n);
                                    onIngredientAction(id, { type: 'add', ingredientId: n.key });
                                    setStatus({ text: `${n.name} added as a new ingredient. Set how much each person needs.`, undoTo: null });
                                    done(n.key);
                                  }}
                                />
                              )
                            : undefined
                        }
                      />
                      <p className={s.foot}>Only this menu changes. The troop’s {name} recipe stays the same.</p>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!readOnly && (
          <li className={s.addRow}>
            <div className={s.addWrap}>
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                className={s.addInput}
                value={query}
                autoComplete="off"
                aria-label={addLabel}
                aria-expanded={showList}
                aria-controls={`${uid}-results`}
                aria-autocomplete="list"
                aria-activedescendant={showList ? `${uid}-opt-${act}` : undefined}
                placeholder={swapping ? `Swap ${swapping} for…` : 'Add a recipe'}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setListOpen(true);
                  setActive(0);
                }}
                onFocus={() => setListOpen(true)}
                onClick={() => setListOpen(true)}
                onBlur={() => setListOpen(false)}
                onKeyDown={onSearchKey}
              />
              <ul id={`${uid}-results`} role="listbox" aria-label={`${addLabel} — matching recipes`} className={s.results} hidden={!showList}>
                {showList &&
                  matches.map((r, i) => (
                    <li
                      key={r.id}
                      id={`${uid}-opt-${i}`}
                      role="option"
                      aria-selected={i === act}
                      className={s.option}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(r)}
                    >
                      {r.name}
                    </li>
                  ))}
              </ul>
              {listOpen && matches.length === 0 && query.trim() !== '' && <p className={s.noMatch}>No recipe for this meal matches “{query.trim()}”.</p>}
            </div>
          </li>
        )}
      </ul>

      <p className={status.text ? s.statusLine : s.srOnly} role="status">
        {status.text}
        {status.undoTo && (
          <>
            {' '}
            <button type="button" ref={undoRef} className={s.linkBtn} onClick={undo}>
              Undo
            </button>
          </>
        )}
      </p>

    </div>
  );
}
