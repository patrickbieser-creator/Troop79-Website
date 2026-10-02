/**
 * IngredientList — the one ingredient-list component of the Menu Monster scout
 * workspace (Plans/Menu-Monster-Scout-Workspace.md, "UI pattern of record").
 * It lives here, not in src/app/_components/, because it is Menu Monster's own
 * pattern: its rows speak recipes and diets, and its only consumers are the
 * scout pages (meal inset now, menu-local editing in Phase 2, the recipe editor
 * in Phase 4). Specimen: /admin/styleguide/public -> Ingredient list.
 *
 * It renders rows it is GIVEN (lib/menu-monster/ingredient-rows.ts builds them
 * from the engine), so it does no math and needs no catalog.
 *
 * Modes (one component, one row, so the keyboard and the layout are built once):
 *   'read'       Phase 1, implemented: name, quiet diet note, amount.
 *   'menu-edit'  Phase 2, RESERVED: amount / swap / leave out / add on a menu's
 *                version of a recipe, a "Your version - N" tag, struck old values
 *                (row.marker). TODO(Phase 2): onAmount, onSwap, onLeaveOut, onAdd.
 *   'author'     Phase 4, RESERVED: the recipe editor: drag reorder, a per-row
 *                menu, the "What you'd buy" inset. TODO(Phase 4): onReorder,
 *                renderInset, rowMenu.
 * A reserved mode renders the read rows until its phase fills it in, so a page
 * can already pass the final mode name.
 */

import type { IngredientRow } from '@/lib/menu-monster/ingredient-rows';
import s from './ingredient-list.module.css';

interface ListBase {
  rows: readonly IngredientRow[];
  /** Names the list for screen readers: 'Pancakes ingredients'. */
  ariaLabel: string;
  /** Shown instead of the list when there are no rows. */
  emptyText?: string;
}

export interface ReadListProps extends ListBase {
  mode: 'read';
}

/** Phase 2 stub: the handlers the menu-local editor will add. Not wired yet. */
export interface MenuEditListProps extends ListBase {
  mode: 'menu-edit';
  // TODO(Phase 2): onAmount?: (key: string, qtyPerPerson: number) => void;
  // TODO(Phase 2): onSwap?: (key: string) => void;  onLeaveOut?: (key: string) => void;  onAdd?: () => void;
}

/** Phase 4 stub: the recipe editor's extras. Not wired yet. */
export interface AuthorListProps extends ListBase {
  mode: 'author';
  // TODO(Phase 4): onReorder?: (keys: string[]) => void;  renderInset?: (key: string) => ReactNode;
}

export type IngredientListProps = ReadListProps | MenuEditListProps | AuthorListProps;

export function IngredientList({ rows, ariaLabel, emptyText = 'No ingredients.' }: IngredientListProps) {
  // Every mode shares the read row today; menu-edit and author branch on
  // props.mode here (and add their cells) when their phases land.
  if (rows.length === 0) return <p className={s.empty}>{emptyText}</p>;
  return (
    <ul className={s.list} aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.key} className={s.row}>
          <span className={s.main}>
            <span className={s.name}>{r.name}</span>
            {r.note && <span className={s.note}>{r.note}</span>}
          </span>
          <span className={s.amount}>{r.amount}</span>
        </li>
      ))}
    </ul>
  );
}
