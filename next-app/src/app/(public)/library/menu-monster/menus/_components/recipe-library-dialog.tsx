'use client';

/**
 * The Food & Recipes popup a meal's "Browse all recipes…" opens on the Plan tab
 * (prototype concept-e-scout-workspace/shelf.html "Recipe library", Patrick
 * 2026-10-02: a popup with the library's look, plus meal filters). Since
 * 2026-10-03 (one control per job, Jenna) it belongs to ONE meal: it opens
 * filtered to that meal (All is one press away — a scout may want a dinner
 * recipe for lunch) and each recipe has one Add, greyed "Added" when it is
 * already on the meal. While the meal is swapping, the button says Swap.
 *
 * A native modal <dialog> around the shared RecipeBrowser (the hub's Recipe
 * Library tab is the same list). Picking closes it; Esc / Close cancel. The
 * meal panel owns what a pick does and where focus goes back to.
 */

import { useEffect, useId, useRef } from 'react';
import type { Catalog, Recipe } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import type { Menu, MenuMeal } from '@/lib/menu-monster/menus';
import { mealTitle } from '@/lib/menu-monster/menu-view';
import { RecipeBrowser } from '../../_components/recipe-browser';
import s from './workspace.module.css';

export interface RecipeLibraryDialogProps {
  catalog: Catalog;
  menu: Menu;
  meal: MenuMeal;
  /** The name of the recipe being swapped out, or null when adding. */
  swapping: string | null;
  onPick: (recipe: Recipe) => void;
  /** Fires once the dialog has closed, whether by a pick, Close or Esc. */
  onClose: () => void;
}

export function RecipeLibraryDialog({ catalog, menu, meal, swapping, onPick, onClose }: RecipeLibraryDialogProps) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const slotWord = (MEALS.find((m) => m.key === meal.slot)?.label ?? meal.slot).toLowerCase();

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
    searchRef.current?.focus();
  }, []);

  const close = () => ref.current?.close();
  const pick = (r: Recipe) => {
    onPick(r);
    close();
  };

  const action = (r: Recipe) => {
    if (meal.recipeIds.includes(r.id)) {
      return (
        <button type="button" className={s.fitBtn} disabled aria-label={`${r.name} is already on ${slotWord}`}>
          <span aria-hidden="true">✓ </span>
          Added
        </button>
      );
    }
    return (
      <button type="button" className={s.fitBtn} aria-label={swapping ? `Swap ${swapping} for ${r.name}` : `Add ${r.name} to ${slotWord}`} onClick={() => pick(r)}>
        <span aria-hidden="true">+ </span>
        {swapping ? 'Swap' : 'Add'}
      </button>
    );
  };

  return (
    <dialog ref={ref} className={s.libDialog} aria-labelledby={`${uid}-h`} onClose={onClose}>
      <div className={s.libHead}>
        <div>
          <h2 id={`${uid}-h`} className={s.libTitle}>
            Food &amp; Recipes
          </h2>
          <p className={s.libFor}>For {mealTitle(menu.startDate, meal.day, meal.slot)}</p>
        </div>
        <button type="button" className={s.libClose} onClick={close}>
          Close
        </button>
      </div>
      <RecipeBrowser catalog={catalog} plan={menu} searchRef={searchRef} initialFilter={meal.slot} actions={action} />
    </dialog>
  );
}
