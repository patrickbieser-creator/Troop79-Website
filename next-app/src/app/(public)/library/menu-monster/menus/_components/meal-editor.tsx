'use client';

/**
 * The meal page (Plans/Menu-Monster-Scout-Workspace.md, "Meal page in Phase 1";
 * prototype concept-e-scout-workspace/meal.html). One meal of a saved menu:
 *
 *   - one quiet row per recipe: its name is a disclosure that opens the recipe's
 *     ingredient list (shared IngredientList, read mode), the meal's cost in the
 *     right column, a ⋯ with Swap recipe… and Remove (Undo in the status line);
 *   - a dashed search at the end of the list adds a recipe that fits this slot —
 *     a combobox + listbox, fully keyboard-operable; "Swap X for…" while swapping;
 *   - a compact People dialer fed from the menu (Reset to the menu's number) and
 *     a quiet note of the menu's diets; a Total to buy / Per person switch;
 *   - one footer line, "This meal: $X, $Y a person."
 *
 * A recipe's open list is the menu's OWN version of it (IngredientList,
 * menu-edit mode): change an amount, swap an ingredient, leave one out, add one.
 * Those edits are meal.recipeEdits; the shared recipe never changes. The recipe
 * row says "Your version · N" and its ⋯ has "Back to the troop recipe".
 *
 * Save model (the public save-button standard): an explicit, dirty-gated Save +
 * Discard changes on the title line. This page's three edits — the recipe list,
 * People and the recipe edits — are in the draft. Save writes them into
 * menu.meals[i] and sends every other field of the meal and every other meal
 * back exactly as loaded; package choices and quantities belong to the Shopping
 * tab. A People equal to the menu's is stored as null.
 *
 * `readOnly` (a leader looking at a scout's meal): the same page with People as
 * text, recipes opening to plain ingredient rows (IngredientList, read mode), and
 * no Save / Discard, ⋯ menus, recipe search, Undo or leave guard.
 *
 * No shopping controls here. Costs are derived on every render by the pure
 * engine from the meal's own catalog (menus.ts mealCatalog applies its recipe
 * edits), so nothing on this page can disagree with the shopping list.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { priceText as money } from '@/lib/menu-monster/units';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Stepper } from '@/app/_components/stepper';
import type { Catalog, Plan, Recipe } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT, buildLines, recipesForMeal, totalsOf } from '@/lib/menu-monster/engine';
import { isPickable } from '@/lib/menu-monster/scout-recipes';
import { RECIPES_HREF } from '../../recipes/_components/paths';
import { composePlan, mealCatalog, type EditOp, type Menu, type MenuMeal, type RecipeEdits } from '@/lib/menu-monster/menus';
import { DIET_ORDER, mealTitle, recipeShares } from '@/lib/menu-monster/menu-view';
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
import type { MenuStore, SaveResult } from '@/lib/menu-monster/menu-store';
import { serverMenuStore } from './server-menu-store';
import { IngredientList, type RowAction } from '../../_components/ingredient-list';
import { ReadOnlyLine } from './read-only-line';
import { RowMenu } from './row-menu';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

/** What this page edits: the people eating, the recipes on the plate and this menu's edits to them. */
interface Draft {
  people: number;
  recipeIds: string[];
  edits: RecipeEdits;
}
/** Order-insensitive: the same edits made in another order are not a change. */
const keyOf = (d: Draft) =>
  JSON.stringify({
    people: d.people,
    recipeIds: d.recipeIds,
    edits: Object.keys(d.edits)
      .sort()
      .map((rid) => [rid, d.edits[rid].map((o) => JSON.stringify(o)).sort()])
  });

/** The part of the draft a remove, swap or "back to the troop recipe" can undo. */
type UndoPoint = Pick<Draft, 'recipeIds' | 'edits'>;

/** The line under the list: what just happened, and the way back from a remove or swap. */
interface Status {
  text: string;
  /** The recipe list and edits to restore, when the change can be undone. */
  undoTo: UndoPoint | null;
  /** Hand focus to Undo: a remove leaves nothing else focused. */
  focusUndo?: boolean;
}

export function MealEditor({
  catalog,
  menuId,
  menu,
  mealId,
  updatedAt,
  readOnly = false,
  plannedBy = null,
  store: storeProp
}: {
  catalog: Catalog;
  /** The saved menu's id (server store). A local menu passes `store` instead. */
  menuId?: string;
  menu: Menu;
  mealId: string;
  updatedAt: string | null;
  readOnly?: boolean;
  plannedBy?: string | null;
  /** Where the menu is kept. Omitted = the signed-in scout's saved menu (server). */
  store?: MenuStore;
}) {
  const store = useMemo(() => storeProp ?? serverMenuStore(menuId ?? null), [storeProp, menuId]);
  const meal = menu.meals.find((m) => m.id === mealId) as MenuMeal;
  const start = (): Draft => ({ people: meal.headcount ?? menu.headcount, recipeIds: [...meal.recipeIds], edits: { ...(meal.recipeEdits ?? {}) } });
  const [draft, setDraft] = useState<Draft>(start);
  const [saved, setSaved] = useState<Draft>(start);
  const [version, setVersion] = useState<string | null>(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<AmountView>('total');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ text: '', undoTo: null });
  const [swapId, setSwapId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  const dirty = keyOf(draft) !== keyOf(saved);

  // Reloads, tab closes and in-app links ask before dropping unsaved changes.
  useLeaveGuard(dirty && !readOnly);

  // A remove or swap hands focus to Undo (its row, and the ⋯ that was focused, are gone).
  useEffect(() => {
    if (status.focusUndo) undoRef.current?.focus();
  }, [status]);

  /* ---- Derived: this meal as the engine sees it ---- */
  const mealNow: MenuMeal = { ...meal, headcount: draft.people === menu.headcount ? null : draft.people, recipeIds: draft.recipeIds, recipeEdits: draft.edits };
  const plan: Plan = composePlan(menu, mealNow);
  const cat = mealCatalog(catalog, mealNow);
  const choices = catalog.ingredients.map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const recipeName = (id: string) => byId.get(id)?.name ?? id;
  // Each recipe's share of the meal (shared packages split), so the rows add up to the footer.
  const shares = recipeShares(menu, mealNow, catalog);
  const costOf = (id: string) => (view === 'total' ? shares[id] ?? 0 : (shares[id] ?? 0) / plan.headcount);
  const whole = totalsOf(buildLines(plan, cat), plan);
  const diets = DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0);
  const overridden = draft.people !== menu.headcount;
  const candidates = recipesForMeal(catalog, meal.slot).filter((r) => isPickable(r) && !draft.recipeIds.includes(r.id));
  const matches = candidates.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const act = Math.min(active, Math.max(0, matches.length - 1));
  const showList = listOpen && matches.length > 0;
  const swapping = swapId ? recipeName(swapId) : null;
  const addLabel = swapping ? `Swap ${swapping} for` : 'Add a recipe';

  const change = (next: Draft) => {
    setDraft(next);
    setJustSaved(false);
    setError(null);
  };
  const setPeople = (n: number) => change({ ...draft, people: Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT)) });

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

  const without = (edits: RecipeEdits, rid: string): RecipeEdits => {
    const { [rid]: dropped, ...rest } = edits;
    void dropped;
    return rest;
  };
  const undoPoint = (): UndoPoint => ({ recipeIds: draft.recipeIds, edits: draft.edits });

  function remove(id: string) {
    const before = undoPoint();
    // A removed recipe takes this meal's edits to it along (sanitizeMenu would drop them anyway).
    change({ ...draft, recipeIds: before.recipeIds.filter((x) => x !== id), edits: without(draft.edits, id) });
    setStatus({ text: `${recipeName(id)} removed.`, undoTo: before, focusUndo: true });
  }

  function pick(r: Recipe) {
    const before = undoPoint();
    if (swapId) {
      change({ ...draft, recipeIds: before.recipeIds.map((x) => (x === swapId ? r.id : x)), edits: without(draft.edits, swapId) });
      setStatus({ text: `Swapped ${recipeName(swapId)} for ${r.name}.`, undoTo: before });
      setSwapId(null);
    } else {
      change({ ...draft, recipeIds: [...before.recipeIds, r.id] });
      setStatus({ text: `${r.name} added.`, undoTo: null });
    }
    clearSearch();
    inputRef.current?.focus();
  }

  function undo() {
    if (!status.undoTo) return;
    change({ ...draft, ...status.undoTo });
    setStatus({ text: 'Undone.', undoTo: null });
    inputRef.current?.focus();
  }

  /* ---- This menu's version of a recipe ---- */
  const rowsFor = (rid: string) => {
    const recipe = byId.get(rid);
    return recipe ? menuEditRows(recipe, draft.edits[rid] ?? [], catalog, plan, view) : [];
  };
  const setOps = (rid: string, next: EditOp[]) => {
    const edits = without(draft.edits, rid);
    change({ ...draft, edits: next.length > 0 ? { ...edits, [rid]: next } : edits });
  };

  function onIngredientAction(rid: string, a: RowAction) {
    const ops = draft.edits[rid] ?? [];
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
    change({ ...draft, edits: without(draft.edits, rid) });
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

  async function save() {
    setSaving(true);
    setError(null);
    const sent = draft;
    // Only the three fields this page edits change; everything else rides through as loaded.
    const next: Menu = {
      ...menu,
      meals: menu.meals.map((m) =>
        m.id === mealId ? { ...m, headcount: sent.people === menu.headcount ? null : sent.people, recipeIds: sent.recipeIds, recipeEdits: sent.edits } : m
      )
    };
    let res: SaveResult;
    try {
      res = await store.save(next, version);
    } catch {
      res = { ok: false, error: 'Something went wrong saving your meal. Try again.' };
    }
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(sent);
    setVersion(res.updatedAt);
    setJustSaved(true);
  }

  const statusText = dirty ? 'Unsaved changes to this meal' : justSaved ? (store.caps.canSave ? `Saved to ${menu.name}` : `Saved on this computer in ${menu.name}`) : '';
  const perPerson = whole.perSpent;

  return (
    <div>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{mealTitle(menu.startDate, meal.day, meal.slot)}</h1>
        {!readOnly && (
        <span className={s.actions}>
          {statusText && <span className={s.muted}>{statusText}</span>}
          <SaveBar
            isNew={false}
            dirty={dirty}
            saving={saving}
            saved={justSaved}
            onSave={() => void save()}
            onDiscard={() => {
              setDraft(saved);
              setError(null);
              setStatus({ text: '', undoTo: null });
              setSwapId(null);
              clearSearch();
            }}
          />
        </span>
        )}
      </div>
      {readOnly && <ReadOnlyLine plannedBy={plannedBy} />}

      {error && (
        <Notice tone="error" className={s.notice}>
          {error}
        </Notice>
      )}

      <section aria-labelledby={`${uid}-cook-h`}>
        <div className={s.secHead}>
          <h2 id={`${uid}-cook-h`} className={s.heading}>
            What you’re cooking
          </h2>
          <div className={s.seg} role="group" aria-label="Show amounts as">
            {(
              [
                ['total', 'Total to buy'],
                ['person', 'Per person']
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={s.segBtn} aria-pressed={view === k} onClick={() => setView(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {readOnly ? (
          <p className={s.foot}>
            {[`People: ${draft.people}`, ...diets.map((k) => `${RESTRICTION_BY_KEY[k].label}: ${menu.restrictions[k]}`)].join(' · ')}
          </p>
        ) : (
        <div className={s.line}>
          <Stepper
            id="mm-meal-people"
            label="People"
            value={draft.people}
            min={MIN_HEADCOUNT}
            max={MAX_HEADCOUNT}
            onChange={setPeople}
            describedBy={`${uid}-src`}
            groupLabel="People for this meal"
            lessLabel="One fewer person"
            moreLabel="One more person"
          />
          <span id={`${uid}-src`} className={s.muted}>
            {overridden ? `· your menu says ${menu.headcount}` : '· same as the menu'}
          </span>
          {overridden && (
            <Button variant="ghost" onClick={() => setPeople(menu.headcount)}>
              Reset to {menu.headcount}
            </Button>
          )}
          {diets.length > 0 && (
            <span className={s.muted}>· {diets.map((k) => `${RESTRICTION_BY_KEY[k].label}: ${menu.restrictions[k]}`).join(' · ')} (from the menu)</span>
          )}
        </div>
        )}

        <ul className={s.card} aria-label="Recipes in this meal">
          {draft.recipeIds.length === 0 && <li className={s.empty}>{readOnly ? 'Nothing picked yet.' : 'Nothing picked yet. Search below to add a recipe.'}</li>}
          {draft.recipeIds.map((id) => {
            const name = recipeName(id);
            const open = openIds.has(id);
            const edited = draft.edits[id]?.length ?? 0;
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
                    ...(edited > 0 && store.caps.canSave && menuId && !dirty
                      ? [{ label: 'Share this version as a new recipe', href: `${RECIPES_HREF}/new?menu=${encodeURIComponent(menuId)}&meal=${encodeURIComponent(meal.id)}&recipe=${encodeURIComponent(id)}` }]
                      : []),
                    { label: 'Remove', danger: true, onSelect: () => remove(id) }
                  ]}
                />
                )}
                {open && (
                  <div id={panel} className={s.inset}>
                    {readOnly ? (
                      <IngredientList mode="read" ariaLabel={`${name} ingredients`} rows={rowsFor(id)} emptyText="No ingredients on this recipe yet." />
                    ) : (
                      <>
                        <IngredientList
                          mode="menu-edit"
                          ariaLabel={`${name} ingredients`}
                          rows={rowsFor(id)}
                          choices={choices}
                          emptyText="No ingredients on this recipe yet."
                          onAction={(a) => onIngredientAction(id, a)}
                          onAnnounce={(text) => setStatus({ text, undoTo: null })}
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
                placeholder={swapping ? `Swap ${swapping} for… search the recipe library` : 'Add a recipe — search the recipe library'}
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

        <p className={s.statusLine} role="status">
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

        {draft.recipeIds.length > 0 && (
          <p className={s.foot}>
            This meal: <strong>{money(whole.spent)}</strong>, {money(perPerson)} a person.
          </p>
        )}
      </section>
    </div>
  );
}
