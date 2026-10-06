'use client';

/**
 * "+ Add a diet…" under the Plan tab's People line (guideline 5, 2026-10-06: defaults do the work).
 * Only the diets the menu counts show a dialer; this lists the ones that don't, and picking one
 * brings its dialer in. Same plain disclosure as the day's "+ Add a meal" (useDisclosure, AddMealMenu).
 */

import type { RestrictionKey } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { useDisclosure } from './use-disclosure';
import s from './workspace.module.css';

export function AddDietMenu({ id, diets, onPick }: { id: string; diets: readonly RestrictionKey[]; onPick: (key: RestrictionKey) => void }) {
  const { open, wrapRef, triggerRef, onBlur, toggle, close } = useDisclosure();

  return (
    <div className={s.addMealWrap} ref={wrapRef} onBlur={onBlur}>
      <button type="button" id={id} ref={triggerRef} className={s.addMealBtn} aria-label="Add a diet" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true">+</span>
        Add a diet…
      </button>
      {open && (
        <div className={s.addMealPop} role="group" aria-label="Diets the menu does not count yet">
          {diets.map((key) => (
            <button
              key={key}
              type="button"
              className={s.menuItem}
              onClick={() => {
                close();
                onPick(key);
              }}
            >
              {RESTRICTION_BY_KEY[key].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
