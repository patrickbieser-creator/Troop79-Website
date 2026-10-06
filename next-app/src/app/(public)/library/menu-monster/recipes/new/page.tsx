/**
 * /library/menu-monster/recipes/new — a blank recipe editor. Nothing is stored
 * until the scout's first Save, which creates the draft and moves to its own URL.
 *
 * ?menu=&meal=&recipe= (Phase 4C, "Share this version as a new recipe" on a meal
 * page): the editor starts from the scout's own saved version of that recipe on
 * that meal (versionDraft). Only the scout's own menu is read; anything that
 * doesn't resolve falls back to a blank recipe.
 */
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { mealTitle } from '@/lib/menu-monster/menu-view';
import { resolveMenuAliases } from '@/lib/menu-monster/menus';
import { versionDraft } from '@/lib/menu-monster/scout-recipes';
import { PageShell } from '@/app/_components/page-shell';
import { loadOwnMenu, recipeAuthor } from '../../menus/_components/scout-menus';
import { RecipeEditor } from '../_components/recipe-editor';
import { RECIPES_HREF } from '../_components/paths';
import { RecipeHeader, RecipeLocked } from '../_components/recipe-pages';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New recipe — Menu Monster' };

const BLANK = { name: '', mealFit: [], foodGroups: [], steps: [], lines: [], originRecipeId: null, equipment: [] };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await recipeAuthor();
  if (!viewer) {
    return (
      <>
        <RecipeHeader />
        <PageShell width="narrow">
          <RecipeLocked next={`${RECIPES_HREF}/new`} />
        </PageShell>
      </>
    );
  }
  const sp = await searchParams;
  const catalog = await loadMenuMonsterCatalog(viewer.personId);
  const gearList = await listGearWith(createAdminClient());

  let initial: Parameters<typeof RecipeEditor>[0]['initial'] = BLANK;
  let fromNote: string | null = null;
  const [menuId, mealId, recipeId] = [one(sp.menu), one(sp.meal), one(sp.recipe)];
  if (menuId && mealId && recipeId) {
    const stored = await loadOwnMenu(menuId, viewer);
    const menu = stored ? resolveMenuAliases(stored.menu, catalog.aliases) : null;
    const meal = menu?.meals.find((m) => m.id === mealId);
    const recipe = meal?.recipeIds.includes(recipeId) ? catalog.recipes.find((r) => r.id === recipeId) : undefined;
    if (menu && meal && recipe) {
      initial = versionDraft(recipe, meal.recipeEdits[recipe.id] ?? []);
      fromNote = `Started from your version of ${recipe.name} in ${mealTitle(menu.startDate, meal.day, meal.slot)}. Lines only for one diet were left out.`;
    }
  }

  return (
    <>
      <RecipeHeader />
      <PageShell>
        <RecipeEditor gearList={gearList} catalog={catalog} id={null} initial={initial} status="draft" credit={null} updatedAt={null} fromNote={fromNote} />
      </PageShell>
    </>
  );
}
