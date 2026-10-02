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
 * Save model (the public save-button standard): an explicit, dirty-gated Save +
 * Discard changes on the title line. Only this page's two edits — the recipe
 * list and People — are in the draft. Save writes them into menu.meals[i] and
 * sends every other field of the meal (package choice, quantities, sources,
 * recipe edits) and every other meal back exactly as loaded; those belong to the
 * Shopping tab and to Phase 2. A People equal to the menu's is stored as null.
 *
 * No shopping controls here. Costs are derived on every render by the pure
 * engine from the meal's own catalog (menus.ts mealCatalog applies its recipe
 * edits), so nothing on this page can disagree with the shopping list.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { money } from '@/lib/event-money';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { Stepper } from '@/app/_components/stepper';
import type { Catalog, Plan, Recipe } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { MAX_HEADCOUNT, MIN_HEADCOUNT, buildLines, recipesForMeal, totalsOf } from '@/lib/menu-monster/engine';
import { composePlan, mealCatalog, type Menu, type MenuMeal } from '@/lib/menu-monster/menus';
import { DIET_ORDER, mealTitle, recipeShares } from '@/lib/menu-monster/menu-view';
import { ingredientRows, type AmountView } from '@/lib/menu-monster/ingredient-rows';
import { saveMenuAction } from '../../../_tools/menu-monster/menu-actions';
import { IngredientList } from '../../_components/ingredient-list';
import { RowMenu } from './row-menu';
import { SaveBar } from './save-bar';
import s from './workspace.module.css';

/** What this page edits: the people eating and the recipes on the plate. */
interface Draft {
  people: number;
  recipeIds: string[];
}
const keyOf = (d: Draft) => JSON.stringify(d);

/** The line under the list: what just happened, and the way back from a remove or swap. */
interface Status {
  text: string;
  /** The recipe list to restore, when the change can be undone. */
  undoIds: string[] | null;
  /** Hand focus to Undo: a remove leaves nothing else focused. */
  focusUndo?: boolean;
}

export function MealEditor({
  catalog,
  menuId,
  menu,
  mealId,
  updatedAt
}: {
  catalog: Catalog;
  menuId: string;
  menu: Menu;
  mealId: string;
  updatedAt: string;
}) {
  const meal = menu.meals.find((m) => m.id === mealId) as MenuMeal;
  const start = (): Draft => ({ people: meal.headcount ?? menu.headcount, recipeIds: [...meal.recipeIds] });
  const [draft, setDraft] = useState<Draft>(start);
  const [saved, setSaved] = useState<Draft>(start);
  const [version, setVersion] = useState(updatedAt);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<AmountView>('total');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ text: '', undoIds: null });
  const [swapId, setSwapId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  const dirty = keyOf(draft) !== keyOf(saved);

  // Reloads, tab closes and in-app links ask before dropping unsaved changes.
  useLeaveGuard(dirty);

  // A remove or swap hands focus to Undo (its row, and the ⋯ that was focused, are gone).
  useEffect(() => {
    if (status.focusUndo) undoRef.current?.focus();
  }, [status]);

  /* ---- Derived: this meal as the engine sees it ---- */
  const mealNow: MenuMeal = { ...meal, headcount: draft.people === menu.headcount ? null : draft.people, recipeIds: draft.recipeIds };
  const plan: Plan = composePlan(menu, mealNow);
  const cat = mealCatalog(catalog, meal);
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const recipeName = (id: string) => byId.get(id)?.name ?? id;
  // Each recipe's share of the meal (shared packages split), so the rows add up to the footer.
  const shares = recipeShares(menu, mealNow, catalog);
  const costOf = (id: string) => (view === 'total' ? shares[id] ?? 0 : (shares[id] ?? 0) / plan.headcount);
  const whole = totalsOf(buildLines(plan, cat), plan);
  const diets = DIET_ORDER.filter((k) => (menu.restrictions[k] || 0) > 0);
  const overridden = draft.people !== menu.headcount;
  const candidates = recipesForMeal(catalog, meal.slot).filter((r) => !draft.recipeIds.includes(r.id));
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

  function remove(id: string) {
    const before = draft.recipeIds;
    change({ ...draft, recipeIds: before.filter((x) => x !== id) });
    setStatus({ text: `${recipeName(id)} removed.`, undoIds: before, focusUndo: true });
  }

  function pick(r: Recipe) {
    const before = draft.recipeIds;
    if (swapId) {
      change({ ...draft, recipeIds: before.map((x) => (x === swapId ? r.id : x)) });
      setStatus({ text: `Swapped ${recipeName(swapId)} for ${r.name}.`, undoIds: before });
      setSwapId(null);
    } else {
      change({ ...draft, recipeIds: [...before, r.id] });
      setStatus({ text: `${r.name} added.`, undoIds: null });
    }
    clearSearch();
    inputRef.current?.focus();
  }

  function undo() {
    if (!status.undoIds) return;
    change({ ...draft, recipeIds: status.undoIds });
    setStatus({ text: 'Undone.', undoIds: null });
    inputRef.current?.focus();
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
    // Only the two fields this page edits change; everything else rides through as loaded.
    const next: Menu = {
      ...menu,
      meals: menu.meals.map((m) => (m.id === mealId ? { ...m, headcount: sent.people === menu.headcount ? null : sent.people, recipeIds: sent.recipeIds } : m))
    };
    let res: Awaited<ReturnType<typeof saveMenuAction>>;
    try {
      res = await saveMenuAction(menuId, next, version);
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

  const statusText = dirty ? 'Unsaved changes to this meal' : justSaved ? `Saved to ${menu.name}` : '';
  const perPerson = whole.perSpent;

  return (
    <div>
      <div className={s.titleLine}>
        <h1 className={s.menuTitle}>{mealTitle(menu.startDate, meal.day, meal.slot)}</h1>
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
              setStatus({ text: '', undoIds: null });
              setSwapId(null);
              clearSearch();
            }}
          />
        </span>
      </div>

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

        <ul className={s.card} aria-label="Recipes in this meal">
          {draft.recipeIds.length === 0 && <li className={s.empty}>Nothing picked yet. Search below to add a recipe.</li>}
          {draft.recipeIds.map((id) => {
            const name = recipeName(id);
            const open = openIds.has(id);
            const recipe = cat.recipes.find((r) => r.id === id);
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
                </div>
                <div className={s.cost}>{money(costOf(id))}</div>
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
                    { label: 'Remove', danger: true, onSelect: () => remove(id) }
                  ]}
                />
                {open && (
                  <div id={panel} className={s.inset}>
                    <IngredientList
                      mode="read"
                      ariaLabel={`${name} ingredients`}
                      rows={recipe ? ingredientRows(recipe, cat, plan, view) : []}
                      emptyText="No ingredients on this recipe yet."
                    />
                  </div>
                )}
              </li>
            );
          })}
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
        </ul>

        <p className={s.statusLine} role="status">
          {status.text}
          {status.undoIds && (
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
