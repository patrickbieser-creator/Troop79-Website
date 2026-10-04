'use client';

/**
 * The recipe library list (prototype concept-e-scout-workspace/shelf.html
 * "Recipe library"): a search box, a "Show" row of meal filters, then one quiet
 * row per recipe — its name is a disclosure that opens what each person gets
 * (IngredientList, read mode) and its right column says which meals it fits.
 *
 * Two homes: the hub's Recipe Library tab (the right column is plain text) and
 * a meal's "Browse all recipes…" popup (recipe-library-dialog.tsx), which passes
 * `actions` so the right column holds its Add button. A shared scout recipe says
 * "Recipe by Sam K."; the viewer's own draft (only theirs ever reaches the
 * client) says "Your draft recipe". What shows is
 * lib/menu-monster/menu-search.ts filterRecipes().
 */

import { useId, useState, type ReactNode, type Ref } from 'react';
import type { Catalog, MealSlot, Plan, Recipe } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import { filterRecipes, fitSlots } from '@/lib/menu-monster/menu-search';
import { ingredientRows } from '@/lib/menu-monster/ingredient-rows';
import { IngredientList } from './ingredient-list';
import { FilterChips, SearchBox } from './browse-controls';
import w from '../menus/_components/workspace.module.css';

const slotLabel = (slot: MealSlot) => MEALS.find((m) => m.key === slot)?.label ?? slot;

export function RecipeBrowser({
  catalog,
  plan,
  actions,
  footer,
  searchRef,
  initialFilter = null
}: {
  catalog: Catalog;
  /** Who eats, for the "Each person gets" rows (diet-only lines show when someone has that diet). */
  plan: Pick<Plan, 'headcount' | 'restrictions'>;
  /** The right column of a row; omitted = the meals it fits, as text. Gets the meal filter. */
  actions?: (recipe: Recipe, filter: MealSlot | null) => ReactNode;
  /** A line under the list, given the meal filter. */
  footer?: (filter: MealSlot | null) => ReactNode;
  searchRef?: Ref<HTMLInputElement>;
  /** The meal filter it opens on (the popup opened from a meal starts on that meal; All is one press away). */
  initialFilter?: MealSlot | null;
}) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MealSlot | null>(initialFilter);
  const [openId, setOpenId] = useState<string | null>(null);
  const recipes = filterRecipes(catalog, query, filter);
  const q = query.trim();

  return (
    <div className={w.browse}>
      <SearchBox inputRef={searchRef} label="Search" value={query} onChange={setQuery} />
      <FilterChips options={MEALS} value={filter} onChange={setFilter} />
      <p className={w.srOnly} aria-live="polite">
        {recipes.length === 1 ? '1 recipe' : `${recipes.length} recipes`}
      </p>
      <div className={w.libList}>
        <ul className={w.card} aria-label="Recipes">
          {recipes.length === 0 && <li className={w.empty}>{q ? `No recipes match “${q}”.` : 'No recipes for this meal yet.'}</li>}
          {recipes.map((r) => {
            const open = openId === r.id;
            const panel = `${uid}-r-${r.id}`;
            return (
              <li key={r.id} className={w.row}>
                <div className={w.rowMain}>
                  <button type="button" className={w.rowName} aria-expanded={open} aria-controls={open ? panel : undefined} onClick={() => setOpenId(open ? null : r.id)}>
                    {r.name}
                    <span className={w.chev} aria-hidden="true">
                      ›
                    </span>
                  </button>
                  {r.credit ? <span className={w.meta}>Recipe by {r.credit}</span> : r.status === 'draft' ? <span className={w.meta}>Your draft recipe</span> : null}
                </div>
                <div className={w.fitCol}>{actions ? actions(r, filter) : <span className={w.meta}>{fitSlots(r, null).map(slotLabel).join(', ')}</span>}</div>
                {open && (
                  <div id={panel} className={w.inset}>
                    <IngredientList mode="read" ariaLabel={`${r.name} ingredients`} rows={ingredientRows(r, catalog, plan, 'person')} emptyText="No ingredients on this recipe yet." />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {footer?.(filter)}
    </div>
  );
}
