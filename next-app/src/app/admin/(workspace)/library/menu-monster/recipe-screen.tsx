'use client';

/**
 * Menu Monster leader tools — one recipe on its own page (Patrick, 2026-10-05). The Food & recipes list
 * opens a single food under its row; a recipe's editor (ingredient lines, a tab per diet, steps, the
 * preview) is too long for that, so it gets the whole page: recipes/[recipeId]/page.tsx renders this.
 *
 * `filter` is the list the leader came from (?kind= &meal= &q=): Close returns to it, and asks first when
 * the editor has unsaved changes.
 */
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { useGuardedNav } from '../../_components/guarded-nav';
import { authoringOf } from '@/lib/menu-monster/authoring';
import { NO_FILTER, foodListHref, recipeHref, type FoodFilter } from '@/lib/menu-monster/food-list';
import type { GearItem } from '@/lib/menu-monster/gear';
import type { Catalog } from '@/lib/menu-monster/types';
import { NEW_ID, RecipeEditor, blankDraft } from './recipe-builder';
import styles from './menu-monster.module.css';

/** `recipeId` is a menu item's id, or 'new' for a blank recipe. */
export function RecipeScreen({
  catalog,
  recipeId,
  filter = NO_FILTER,
  stores = [],
  today = null,
  gearList = []
}: {
  catalog: Catalog;
  recipeId: string;
  filter?: FoodFilter;
  stores?: readonly string[];
  today?: string | null;
  /** The master gear list (active items), for the gear picker. */
  gearList?: readonly GearItem[];
}) {
  const router = useRouter();
  const { navigate, dialog } = useGuardedNav();
  const isNew = recipeId === 'new';
  const recipe = isNew ? null : (catalog.recipes.find((r) => r.id === recipeId) ?? null);
  if (!isNew && !recipe) return null;

  return (
    <>
      {/* Close is the way out (Patrick, 2026-10-05: the breadcrumb alone was missed); it keeps the list's filters.
          Previous / Next were tried and removed the same day: one more pair of links at the top of a long form. */}
      <nav className={styles.toolbar} aria-label="Recipe page">
        <span className={styles.spacer} />
        <Button variant="secondary" size="sm" onClick={() => navigate(foodListHref(filter))}>
          Close
        </Button>
      </nav>
      <RecipeEditor
        key={recipe?.id ?? NEW_ID}
        mode="page"
        initial={recipe ? authoringOf(recipe) : blankDraft()}
        catalog={catalog}
        stores={stores}
        today={today}
        gearList={gearList}
        // A first save moves from the blank page to the recipe's own address; a duplicate is a new stop.
        onSelect={(id) => (isNew ? router.replace(recipeHref(id, filter)) : router.push(recipeHref(id, filter)))}
        onChanged={() => router.refresh()}
        onShortForm={recipe ? () => navigate(foodListHref(filter, recipe.id)) : undefined}
      />
      {dialog}
    </>
  );
}
