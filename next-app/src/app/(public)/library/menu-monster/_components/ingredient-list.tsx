/**
 * IngredientList — the one ingredient-list component of the Menu Monster scout
 * workspace (Plans/Menu-Monster-Scout-Workspace.md, "UI pattern of record").
 * It lives here, not in src/app/_components/, because it is Menu Monster's own
 * pattern: its rows speak recipes and diets, and its only consumers are the
 * scout pages (meal inset, menu-local editing, the recipe editor in Phase 4).
 * Specimen: /admin/styleguide/public -> Ingredient list.
 *
 * It renders rows it is GIVEN (lib/menu-monster/ingredient-rows.ts builds them
 * from the engine), so it does no math and needs no catalog.
 *
 * Modes (one component, one row, so the keyboard and the layout are built once):
 *   'read'       name, quiet diet note, amount; and, when the rows carry one (a leader reading
 *                a scout's menu), the Added / Left out tags and the struck old value.
 *   'menu-edit'  a menu's own version of a recipe (ingredient-list-edit.tsx):
 *                a ⋯ per row (change amount / swap / leave out / put back /
 *                back to the troop's), a dashed "Add an ingredient" search, a
 *                struck old value, "Added" and "Left out" tags. Rows come from
 *                menuEditRows(); the parent turns each RowAction into ops.
 *   'author'     Phase 4, RESERVED: the recipe editor: drag reorder, a per-row
 *                menu, the "What you'd buy" inset. TODO(Phase 4): onReorder,
 *                renderInset, rowMenu.
 * A reserved mode renders the read rows until its phase fills it in, so a page
 * can already pass the final mode name.
 */

import type { IngredientRow } from '@/lib/menu-monster/ingredient-rows';
import { MenuEditList, type MenuEditProps, type RowAction } from './ingredient-list-edit';
import s from './ingredient-list.module.css';

export type { RowAction };

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

export type MenuEditListProps = MenuEditProps & { mode: 'menu-edit' };

/** Phase 4 stub: the recipe editor's extras. Not wired yet. */
export interface AuthorListProps extends ListBase {
  mode: 'author';
  // TODO(Phase 4): onReorder?: (keys: string[]) => void;  renderInset?: (key: string) => ReactNode;
}

export type IngredientListProps = ReadListProps | MenuEditListProps | AuthorListProps;

export function IngredientList(props: IngredientListProps) {
  if (props.mode === 'menu-edit') return <MenuEditList {...props} />;
  const { rows, ariaLabel, emptyText = 'No ingredients.' } = props;
  // 'author' shares the read row until Phase 4 branches on props.mode here.
  if (rows.length === 0) return <p className={s.empty}>{emptyText}</p>;
  return (
    <ul className={s.list} aria-label={ariaLabel}>
      {rows.map((r) => {
        // A leader reading a scout's menu sees the scout's own edits: struck old value, Added, Left out.
        const out = r.marker?.kind === 'out';
        const was = r.marker?.kind === 'swapped' || r.marker?.kind === 'changed' ? r.marker.was : null;
        return (
          <li key={r.key} className={`${s.row} ${out ? s.rowOut : ''}`}>
            <span className={s.main}>
              <span className={s.name}>{r.name}</span>
              {r.marker?.kind === 'swapped' && was && (
                <s className={s.was}>
                  <span className={s.srOnly}>was </span>
                  {was}
                </s>
              )}
              {r.marker?.kind === 'added' && <span className={s.tag}>Added</span>}
              {out && <span className={s.tag}>Left out</span>}
              {r.note && <span className={s.note}>{r.note}</span>}
            </span>
            <span className={s.amount}>
              {r.marker?.kind === 'changed' && was && (
                <s className={s.was}>
                  <span className={s.srOnly}>was </span>
                  {was}
                </s>
              )}
              {r.amount}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
