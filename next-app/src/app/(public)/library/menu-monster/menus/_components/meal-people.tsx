'use client';

/**
 * A meal's own People box (Patrick, 2026-10-07: "move the people for this meal into the same line as that meal
 * label"). It lives on the meal's row beside the slot name on the Plan tab, and at the top of the panel on the
 * meal's own page, where there is no row. One component, so the rule is written once: the menu's number is stored
 * as null, so going back to it is not a change.
 */

import { Button } from '@/app/_components/button';
import { NumberBox } from '@/app/_components/stepper';
import { MAX_HEADCOUNT, MIN_HEADCOUNT } from '@/lib/menu-monster/engine';
import type { Menu, MenuMeal } from '@/lib/menu-monster/menus';
import { mealTitle } from '@/lib/menu-monster/menu-view';
import s from './workspace.module.css';

export function MealPeople({ menu, meal, onChange }: { menu: Menu; meal: MenuMeal; onChange: (next: MenuMeal) => void }) {
  const people = meal.headcount ?? menu.headcount;
  const title = mealTitle(menu.startDate, meal.day, meal.slot);
  const set = (n: number) => {
    const v = Math.min(MAX_HEADCOUNT, Math.max(MIN_HEADCOUNT, Math.round(n) || MIN_HEADCOUNT));
    onChange({ ...meal, headcount: v === menu.headcount ? null : v });
  };
  return (
    <span className={s.mealPeople}>
      <span className={s.peopleBox}>
        <NumberBox id={`mm-people-${meal.id}`} value={people} min={MIN_HEADCOUNT} max={MAX_HEADCOUNT} onCommit={set} ariaLabel={`${title} people`} />
      </span>
      <span className={s.meta} aria-hidden="true">
        people
      </span>
      {people !== menu.headcount && (
        <Button variant="ghost" aria-label={`Reset ${title} to ${menu.headcount} people`} onClick={() => set(menu.headcount)}>
          Reset to {menu.headcount}
        </Button>
      )}
    </span>
  );
}
