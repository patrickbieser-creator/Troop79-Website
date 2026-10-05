'use client';

/**
 * Menu Monster leader tools — one recipe on its own page (Patrick, 2026-10-05). The Food & recipes list
 * opens a single food under its row; a recipe's editor (ingredient lines, a tab per diet, steps, the
 * preview) is too long for that, so it gets the whole page: recipes/[recipeId]/page.tsx renders this.
 *
 * `filter` is the list the leader came from (?kind= &meal= &q=). Previous / Next walk the recipes of that
 * same list without a trip back to it, and ask first when the editor has unsaved changes.
 */
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../_components/button';
import { useGuardedNav } from '../../_components/guarded-nav';
import { authoringOf } from '@/lib/menu-monster/authoring';
import { NO_FILTER, buildFoodRows, foodListHref, neighbours, recipeHref, type FoodFilter } from '@/lib/menu-monster/food-list';
import type { Catalog } from '@/lib/menu-monster/types';
import { NEW_ID, RecipeEditor, blankDraft } from './recipe-builder';
import styles from './menu-monster.module.css';

/** `recipeId` is a menu item's id, or 'new' for a blank recipe. */
export function RecipeScreen({
  catalog,
  recipeId,
  filter = NO_FILTER,
  stores = [],
  today = null
}: {
  catalog: Catalog;
  recipeId: string;
  filter?: FoodFilter;
  stores?: readonly string[];
  today?: string | null;
}) {
  const router = useRouter();
  const { navigate, dialog } = useGuardedNav();
  const isNew = recipeId === 'new';
  const recipe = isNew ? null : (catalog.recipes.find((r) => r.id === recipeId) ?? null);
  const rows = useMemo(() => buildFoodRows(catalog), [catalog]);
  if (!isNew && !recipe) return null;
  const { prev, next } = recipe ? neighbours(rows, filter, recipe.id) : { prev: null, next: null };

  return (
    <>
      {/* Close is the plain way out (Patrick, 2026-10-05: the breadcrumb alone was missed); it keeps the list's filters. */}
      <nav className={styles.toolbar} aria-label="Other recipes">
        {recipe && (
          <Button variant="quiet" size="sm" disabled={!prev} onClick={() => prev && navigate(recipeHref(prev.recipe.id, filter))}>
            {prev ? `← Previous: ${prev.recipe.name}` : '← Previous'}
          </Button>
        )}
        <span className={styles.spacer} />
        <Button variant="secondary" size="sm" onClick={() => navigate(foodListHref(filter))}>
          Close
        </Button>
        {recipe && (
          <Button variant="quiet" size="sm" disabled={!next} onClick={() => next && navigate(recipeHref(next.recipe.id, filter))}>
            {next ? `Next: ${next.recipe.name} →` : 'Next →'}
          </Button>
        )}
      </nav>
      <RecipeEditor
        key={recipe?.id ?? NEW_ID}
        mode="page"
        initial={recipe ? authoringOf(recipe) : blankDraft()}
        catalog={catalog}
        stores={stores}
        today={today}
        // A first save moves from the blank page to the recipe's own address; a duplicate is a new stop.
        onSelect={(id) => (isNew ? router.replace(recipeHref(id, filter)) : router.push(recipeHref(id, filter)))}
        onChanged={() => router.refresh()}
        onShortForm={recipe ? () => navigate(foodListHref(filter, recipe.id)) : undefined}
      />
      {dialog}
    </>
  );
}
