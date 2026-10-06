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
 *   'author'     a scout's own recipe (ingredient-list-author.tsx, Phase 4): a
 *                reorder grip, the name toggles "What you'd buy", a ⋯ (change
 *                amount / move / remove) and a dashed price-book search.
 */

import type { ReactNode } from 'react';
import { idleLabel, scopeLabel, type IngredientRow } from '@/lib/menu-monster/ingredient-rows';
import { MenuEditList, type MenuEditProps, type RowAction } from './ingredient-list-edit';
import { AuthorList, type AuthorListProps } from './ingredient-list-author';
import s from './ingredient-list.module.css';

export type { RowAction };

interface ListBase {
  rows: readonly IngredientRow[];
  /** Names the list for screen readers: 'Pancakes ingredients'. */
  ariaLabel: string;
  /** Shown instead of the list when there are no rows. */
  emptyText?: string;
  /** Compact rows with no rule between them (a meal open on the Plan tab — Patrick, 2026-10-03). */
  dense?: boolean;
}

export interface ReadListProps extends ListBase {
  mode: 'read';
  /** Release 3: the brand chosen for the ingredient a row shows (quiet text), when the menu has one. */
  brandText?: (ingredientId: string) => ReactNode;
}

export type MenuEditListProps = MenuEditProps & { mode: 'menu-edit' };

export type AuthorModeProps = AuthorListProps & { mode: 'author' };

export type IngredientListProps = ReadListProps | MenuEditListProps | AuthorModeProps;

export function IngredientList(props: IngredientListProps) {
  if (props.mode === 'menu-edit') return <MenuEditList {...props} />;
  if (props.mode === 'author') return <AuthorList {...props} />;
  const { rows, ariaLabel, emptyText = 'No ingredients.', dense = false, brandText } = props;
  if (rows.length === 0) return <p className={s.empty}>{emptyText}</p>;
  return (
    <ul className={`${s.list} ${dense ? s.dense : ''}`} aria-label={ariaLabel}>
      {rows.map((r) => {
        // A leader reading a scout's menu sees the scout's own edits: struck old value, Added, Left out.
        const out = r.marker?.kind === 'out';
        const was = r.marker?.kind === 'swapped' || r.marker?.kind === 'changed' ? r.marker.was : null;
        return (
          <li key={r.key} className={`${s.row} ${out || r.scope?.idle ? s.rowOut : ''}`}>
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
              {r.scope && <span className={s.tag}>{scopeLabel(r.scope)}</span>}
              {r.scope?.idle && <span className={s.note}>{idleLabel(r.scope)}</span>}
              {r.note && <span className={s.note}>{r.note}</span>}
              {!out && r.edit && brandText?.(r.edit.currentIngredientId)}
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
