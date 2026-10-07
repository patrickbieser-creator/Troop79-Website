'use client';

/**
 * "+ Diet" under the Plan tab's People line (guideline 5, 2026-10-06: defaults do the work; Plans/Menu-Monster-Add-Pattern.md
 * Phase 2). Only the diets the menu counts show a number box; this lists the ones that don't, and picking one brings its box
 * in. One AddRow (link at rest, the pickable diets when tapped, a visible Cancel) — the same add pattern as every other list.
 */

import { useState } from 'react';
import type { RestrictionKey } from '@/lib/menu-monster/types';
import { RESTRICTION_BY_KEY } from '@/lib/menu-monster/units';
import { AddRow } from '../../_components/add-row';
import s from './workspace.module.css';

export function AddDietMenu({ id, diets, onPick }: { id: string; diets: readonly RestrictionKey[]; onPick: (key: RestrictionKey) => void }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div id={id}>
      <AddRow
        open={open}
        onOpenChange={(next) => setOpen(next)}
        actions={[
          {
            id: 'diet',
            label: 'Diet',
            content: (
              <div className={s.dietPicks} role="group" aria-label="Diets the menu does not count yet">
                {diets.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={s.menuItem}
                    onClick={() => {
                      setOpen(null);
                      onPick(key);
                    }}
                  >
                    {RESTRICTION_BY_KEY[key].label}
                  </button>
                ))}
              </div>
            )
          }
        ]}
      />
    </div>
  );
}
