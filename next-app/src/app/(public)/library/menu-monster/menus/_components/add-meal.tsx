'use client';

/**
 * The dashed "Add a meal" row at the foot of a day (prototype
 * concept-e-scout-workspace/editor.html): one button that opens a short list of
 * the day's free slots. A disclosure of plain buttons, not a <select> — a
 * select adds on an arrow-key change in Chrome and Edge, which added meals the
 * scout never chose. Greyed, not hidden, when the day has every slot or the
 * menu is at its meal cap.
 */

import type { MealSlot } from '@/lib/menu-monster/types';
import { useDisclosure } from './use-disclosure';
import s from './workspace.module.css';

export function AddMeal({
  label,
  free,
  atCap,
  onAdd
}: {
  /** The button's accessible name, e.g. "Add a meal to Day 1". */
  label: string;
  free: readonly { key: MealSlot; label: string }[];
  /** The menu already holds the most meals it can. */
  atCap: boolean;
  onAdd: (slot: MealSlot) => void;
}) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();
  const off = atCap || free.length === 0;
  return (
    <div className={s.addWrap} ref={wrapRef} onBlur={onBlur}>
      <button
        type="button"
        ref={triggerRef}
        className={s.addBtn}
        aria-label={label}
        aria-expanded={open}
        disabled={off}
        title={atCap ? 'This menu has the most meals it can hold' : off ? 'Every meal is already on this day' : undefined}
        onClick={toggle}
      >
        + Add a meal
      </button>
      {open && !off && (
        <div className={s.addPop}>
          {free.map((m) => (
            <button
              key={m.key}
              type="button"
              className={s.menuItem}
              onClick={() => {
                close();
                onAdd(m.key);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
