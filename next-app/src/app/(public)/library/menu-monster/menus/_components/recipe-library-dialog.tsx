'use client';

/**
 * The recipe library popup a day's "Search recipes" opens on the Plan tab
 * (prototype concept-e-scout-workspace/shelf.html "Recipe library", Patrick
 * 2026-10-02: a popup with the library's look, plus meal filters).
 *
 * A native modal <dialog>: a search box, a "Show only" row of meal filters, then
 * the library list — each recipe's name is a disclosure that opens what each
 * person gets (IngredientList, read mode), and its right column holds one button
 * per meal it fits. Picking one drops the recipe onto that day's meal of that
 * slot (creating the meal when the day lacks it) and closes the popup; the Plan
 * tab announces what happened. Esc / Close cancel. What shows, and what each meal
 * button would do, is lib/menu-monster/menu-search.ts recipeLibrary().
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Catalog, MealSlot } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import { MAX_MENU_MEALS, type Menu } from '@/lib/menu-monster/menus';
import { canPlanEmptyMeal, recipeLibrary, type LibraryTarget } from '@/lib/menu-monster/menu-search';
import { ingredientRows } from '@/lib/menu-monster/ingredient-rows';
import { IngredientList } from '../../_components/ingredient-list';
import s from './workspace.module.css';

const slotLabel = (slot: MealSlot) => MEALS.find((m) => m.key === slot)?.label ?? slot;

export interface RecipeLibraryDialogProps {
  catalog: Catalog;
  menu: Menu;
  day: number;
  /** 'Fri, Oct 9' or 'Day 2' — the day the popup adds to. */
  dayName: string;
  onPick: (recipeId: string, slot: MealSlot) => void;
  /** An empty meal of the slot, its recipes picked on the meal page. */
  onPlanEmpty: (slot: MealSlot) => void;
  /** Fires once the dialog has closed, whether by a pick, Close or Esc. */
  onClose: () => void;
}

export function RecipeLibraryDialog({ catalog, menu, day, dayName, onPick, onPlanEmpty, onClose }: RecipeLibraryDialogProps) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MealSlot | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
    searchRef.current?.focus();
  }, []);

  const entries = recipeLibrary(catalog, menu, day, query, filter);
  const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
  const close = () => ref.current?.close();

  const pick = (recipeId: string, slot: MealSlot) => {
    onPick(recipeId, slot);
    close();
  };

  const targetButton = (name: string, recipeId: string, t: LibraryTarget) => {
    const label = slotLabel(t.slot);
    const lower = label.toLowerCase();
    if (t.state === 'on') {
      return (
        <button key={t.slot} type="button" className={s.fitBtn} disabled aria-label={`${name} is already on ${lower}`} title={`Already on ${dayName} ${lower}`}>
          <span aria-hidden="true">✓ </span>
          {filter ? 'Added' : label}
        </button>
      );
    }
    if (t.state === 'full') {
      return (
        <button key={t.slot} type="button" className={s.fitBtn} disabled aria-label={`Add ${name} to ${lower}`} title={`This menu already has ${MAX_MENU_MEALS} meals`}>
          {label}
        </button>
      );
    }
    return (
      <button key={t.slot} type="button" className={s.fitBtn} aria-label={`Add ${name} to ${lower}`} title={t.state === 'adds' ? `Adds to ${dayName} ${lower}` : `New ${lower} on ${dayName}`} onClick={() => pick(recipeId, t.slot)}>
        <span aria-hidden="true">+ </span>
        {filter ? 'Add' : label}
      </button>
    );
  };

  return (
    <dialog ref={ref} className={s.libDialog} aria-labelledby={`${uid}-h`} onClose={onClose}>
      <div className={s.libHead}>
        <div>
          <h2 id={`${uid}-h`} className={s.libTitle}>
            Recipe library
          </h2>
          <p className={s.libFor}>For {dayName}</p>
        </div>
        <button type="button" className={s.libClose} onClick={close}>
          Close
        </button>
      </div>

      <div className={s.libSearchWrap}>
        <span className={s.libSearchIcon} aria-hidden="true">
          ⌕
        </span>
        <input
          ref={searchRef}
          type="search"
          className={s.libSearch}
          value={query}
          autoComplete="off"
          aria-label="Search recipes"
          placeholder="Search recipes"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={s.libFilters} role="group" aria-label="Show only">
        <span className={s.choiceLabel} aria-hidden="true">
          Show
        </span>
        <div className={s.chips}>
          <button type="button" className={s.chip} aria-pressed={filter === null} onClick={() => setFilter(null)}>
            All
          </button>
          {MEALS.map((m) => (
            <button key={m.key} type="button" className={s.chip} aria-pressed={filter === m.key} onClick={() => setFilter(filter === m.key ? null : m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <p className={s.srOnly} aria-live="polite">
        {entries.length === 1 ? '1 recipe' : `${entries.length} recipes`}
      </p>

      <div className={s.libList}>
        <ul className={s.card} aria-label="Recipes">
          {entries.length === 0 && <li className={s.empty}>{query.trim() ? `No recipes match “${query.trim()}”.` : 'No recipes for this meal yet.'}</li>}
          {entries.map((e) => {
            const open = openId === e.recipeId;
            const panel = `${uid}-r-${e.recipeId}`;
            const recipe = byId.get(e.recipeId);
            return (
              <li key={e.recipeId} className={s.row}>
                <div className={s.rowMain}>
                  <button type="button" className={s.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpenId(open ? null : e.recipeId)}>
                    {e.name}
                    <span className={s.chev} aria-hidden="true">
                      ›
                    </span>
                  </button>
                </div>
                <div className={s.fitCol}>{e.targets.map((t) => targetButton(e.name, e.recipeId, t))}</div>
                {open && recipe && (
                  <div id={panel} className={s.inset}>
                    <h3 className={s.insetHead}>Each person gets</h3>
                    <IngredientList
                      mode="read"
                      ariaLabel={`${e.name} ingredients`}
                      rows={ingredientRows(recipe, catalog, { headcount: menu.headcount, restrictions: menu.restrictions }, 'person')}
                      emptyText="No ingredients on this recipe yet."
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {filter && canPlanEmptyMeal(menu, day, filter) && (
        <p className={s.foot}>
          <button
            type="button"
            className={s.linkBtn}
            onClick={() => {
              onPlanEmpty(filter);
              close();
            }}
          >
            Plan {slotLabel(filter).toLowerCase()} without a recipe
          </button>{' '}
          and pick on the meal page.
        </p>
      )}
    </dialog>
  );
}
