'use client';

/**
 * A day's "+ Add a meal" on the Plan tab (Patrick + Jenna, 2026-10-03: one
 * control per job — the day adds MEALS, a meal's own search adds food). A plain
 * disclosure (useDisclosure, like the ⋯ row menu) listing only the meals the day
 * lacks, in meal order; picking one creates it empty and the Plan tab opens it
 * with focus in its search. The Plan tab hides it when the day has every meal;
 * at the menu's meal cap it is greyed with the reason beside it (the save
 * standard: a control that will do nothing is greyed, not hidden).
 */

import type { MealSlot } from '@/lib/menu-monster/types';
import { MEALS } from '@/lib/menu-monster/units';
import { MAX_MENU_MEALS } from '@/lib/menu-monster/menus';
import { useDisclosure } from './use-disclosure';
import s from './workspace.module.css';

const slotLabel = (slot: MealSlot) => MEALS.find((m) => m.key === slot)?.label ?? slot;

export function AddMealMenu({ id, dayName, slots, full, onPick }: { id: string; dayName: string; slots: MealSlot[]; full: boolean; onPick: (slot: MealSlot) => void }) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();

  return (
    <div className={s.addMealWrap} ref={wrapRef} onBlur={onBlur}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={s.addMealBtn}
        aria-label={`Add a meal to ${dayName}`}
        aria-expanded={open}
        disabled={full}
        onClick={toggle}
      >
        <span aria-hidden="true">+</span>
        Add a meal
      </button>
      {full && <span className={s.meta}>Menu has {MAX_MENU_MEALS} meals</span>}
      {open && !full && (
        <div className={s.addMealPop} role="group" aria-label={`Meals not yet on ${dayName}`}>
          {slots.map((slot) => (
            <button
              key={slot}
              type="button"
              className={s.menuItem}
              onClick={() => {
                close();
                onPick(slot);
              }}
            >
              {slotLabel(slot)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
