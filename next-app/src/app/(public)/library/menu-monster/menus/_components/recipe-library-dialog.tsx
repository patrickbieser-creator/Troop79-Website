'use client';

/**
 * The Food & Recipes popup a day's "Add to …" opens on the Plan tab
 * (prototype concept-e-scout-workspace/shelf.html "Recipe library", Patrick
 * 2026-10-02: a popup with the library's look, plus meal filters).
 *
 * A native modal <dialog> around the shared RecipeBrowser (the hub's Recipe
 * Library tab is the same list), whose right column here holds one button per
 * meal the recipe fits. Picking one drops the recipe onto that day's meal of that
 * slot (creating the meal when the day lacks it) and closes the popup; the Plan
 * tab announces what happened. Esc / Close cancel. What each meal button would
 * do is lib/menu-monster/menu-search.ts libraryTargets().
 */

import { useEffect, useId, useRef } from 'react';
import type { Catalog, MealSlot, Recipe } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import { MAX_MENU_MEALS, type Menu } from '@/lib/menu-monster/menus';
import { canPlanEmptyMeal, libraryTargets, type LibraryTarget } from '@/lib/menu-monster/menu-search';
import { RecipeBrowser } from '../../_components/recipe-browser';
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

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
    searchRef.current?.focus();
  }, []);

  const close = () => ref.current?.close();
  const pick = (recipeId: string, slot: MealSlot) => {
    onPick(recipeId, slot);
    close();
  };

  // With a meal filter on, the chip already names the meal: the button just says Add.
  const targetButton = (r: Recipe, t: LibraryTarget, filtered: boolean) => {
    const label = slotLabel(t.slot);
    const lower = label.toLowerCase();
    if (t.state === 'on') {
      return (
        <button key={t.slot} type="button" className={s.fitBtn} disabled aria-label={`${r.name} is already on ${lower}`} title={`Already on ${dayName} ${lower}`}>
          <span aria-hidden="true">✓ </span>
          {filtered ? 'Added' : label}
        </button>
      );
    }
    if (t.state === 'full') {
      return (
        <button key={t.slot} type="button" className={s.fitBtn} disabled aria-label={`Add ${r.name} to ${lower}`} title={`This menu already has ${MAX_MENU_MEALS} meals`}>
          {filtered ? 'Add' : label}
        </button>
      );
    }
    return (
      <button key={t.slot} type="button" className={s.fitBtn} aria-label={`Add ${r.name} to ${lower}`} title={t.state === 'adds' ? `Adds to ${dayName} ${lower}` : `New ${lower} on ${dayName}`} onClick={() => pick(r.id, t.slot)}>
        <span aria-hidden="true">+ </span>
        {filtered ? 'Add' : label}
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
          <p className={s.libFor}>For {dayName}</p>
        </div>
        <button type="button" className={s.libClose} onClick={close}>
          Close
        </button>
      </div>
      <RecipeBrowser
        catalog={catalog}
        plan={menu}
        searchRef={searchRef}
        actions={(r, filter) => libraryTargets(r, menu, day, filter).map((t) => targetButton(r, t, filter !== null))}
        footer={(filter) =>
          filter &&
          canPlanEmptyMeal(menu, day, filter) && (
            <p className={s.foot}>
              <button
                type="button"
                className={s.linkBtn}
                onClick={() => {
                  onPlanEmpty(filter);
                  close();
                }}
              >
                Plan {slotLabel(filter).toLowerCase()} empty
              </button>{' '}
              and add to it later.
            </p>
          )
        }
      />
    </dialog>
  );
}
