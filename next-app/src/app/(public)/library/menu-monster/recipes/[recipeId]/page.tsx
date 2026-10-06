/**
 * /library/menu-monster/recipes/[recipeId] — one of the signed-in scout's own
 * recipes in the editor. Someone else's recipe, or a missing one, is notFound();
 * anyone who isn't a signed-in scout gets the one-line sign-in state.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { loadMyRecipeWith } from '@/lib/menu-monster/scout-recipes-store';
import { PageShell } from '@/app/_components/page-shell';
import { recipeAuthor } from '../../menus/_components/scout-menus';
import { RecipeEditor } from '../_components/recipe-editor';
import { RECIPES_HREF } from '../_components/paths';
import { RecipeHeader, RecipeLocked } from '../_components/recipe-pages';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Recipe — Menu Monster' };

export default async function RecipePage({ params }: { params: Promise<{ recipeId: string }> }) {
  const { recipeId } = await params;
  const viewer = await recipeAuthor();
  if (!viewer) {
    return (
      <>
        <RecipeHeader />
        <PageShell width="narrow">
          <RecipeLocked next={`${RECIPES_HREF}/${recipeId}`} />
        </PageShell>
      </>
    );
  }
  const [stored, catalog] = await Promise.all([loadMyRecipeWith(createAdminClient(), viewer.personId, recipeId), loadMenuMonsterCatalog(viewer.personId)]);
  if (!stored) notFound();
  const gearList = await listGearWith(createAdminClient());
  return (
    <>
      <RecipeHeader />
      <PageShell>
        <RecipeEditor gearList={gearList} catalog={catalog} id={stored.recipe.id} initial={stored.recipe} status={stored.status} credit={stored.credit} updatedAt={stored.updatedAt} />
      </PageShell>
    </>
  );
}
