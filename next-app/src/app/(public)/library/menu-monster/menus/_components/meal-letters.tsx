import { MEALS } from '@/lib/menu-monster/units';
import type { MealSlot } from '@/lib/menu-monster/types';
import s from './workspace.module.css';

/** The one-or-two-letter mark for each meal slot. */
const LETTER: Record<MealSlot, string> = { breakfast: 'B', lunch: 'L', dinner: 'D', snack: 'S', dessert: 'Ds' };

/**
 * Which meals of the menu use a gear item (Patrick, 2026-10-08): a column of fixed-width slots, one per meal kind in
 * MEALS order, each showing its letter (B L D S Ds) or staying blank, so the letters line up down a list. The letters
 * are decoration for the eye; a screen reader gets one visually hidden sentence ("Used at Breakfast, Lunch").
 * Shared by the meal panel's Gear list and the Gear tab.
 */
export function MealLetters({ slots }: { slots: readonly MealSlot[] }) {
  const used = MEALS.filter((m) => slots.includes(m.key));
  return (
    <span className={s.mealLetters}>
      <span aria-hidden="true" className={s.mealLetterSlots}>
        {MEALS.map((m) => (
          <span key={m.key} className={s.mealLetter} data-slot={m.key} title={slots.includes(m.key) ? m.label : undefined}>
            {slots.includes(m.key) ? LETTER[m.key] : ''}
          </span>
        ))}
      </span>
      {used.length > 0 && <span className={s.srOnly}>Used at {used.map((m) => m.label).join(', ')}</span>}
    </span>
  );
}
