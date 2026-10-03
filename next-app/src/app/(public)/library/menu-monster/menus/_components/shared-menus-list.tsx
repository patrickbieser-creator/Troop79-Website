/**
 * Shared menus as quiet rows (Phase 3): the hub's "Shared with the troop", the
 * full /menus/shared list and an outing's "Menus for this outing". Name, then
 * "Sam K." (Decision 12), the outing and the meal count. No costs: they would
 * need every menu loaded, and the menu page has them one click away.
 */

import Link from 'next/link';
import type { SharedMenuRow } from '@/lib/menu-monster/menus-store';
import s from './workspace.module.css';

const MENUS_HREF = '/library/menu-monster/menus';

export function SharedMenusList({ rows, showOuting = true }: { rows: SharedMenuRow[]; showOuting?: boolean }) {
  return (
    <ul className={s.card}>
      {rows.map((r) => (
        <li key={r.id} className={s.row}>
          <div className={s.rowMain}>
            <Link className={s.rowName} href={`${MENUS_HREF}/${r.id}`}>
              {r.name}
            </Link>
            <span className={s.meta}>
              {[r.credit || null, showOuting ? r.outingTitle : null, `${r.mealCount} ${r.mealCount === 1 ? 'meal' : 'meals'}`].filter(Boolean).join(' · ')}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
