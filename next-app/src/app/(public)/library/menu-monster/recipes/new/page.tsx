/**
 * /library/menu-monster/recipes/new — a blank recipe editor. Nothing is stored
 * until the scout's first Save, which creates the draft and moves to its own URL.
 */
import type { Metadata } from 'next';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { PageShell } from '@/app/_components/page-shell';
import { scoutViewer } from '../../menus/_components/scout-menus';
import { RecipeEditor } from '../_components/recipe-editor';
import { RECIPES_HREF } from '../_components/paths';
import { RecipeHeader, RecipeLocked } from '../_components/recipe-pages';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New recipe — Menu Monster' };

const BLANK = { name: '', mealFit: [], foodGroups: [], steps: [], lines: [], originRecipeId: null };

export default async function NewRecipePage() {
  const viewer = await scoutViewer();
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
  const catalog = await loadMenuMonsterCatalog(viewer.personId);
  return (
    <>
      <RecipeHeader />
      <PageShell>
        <RecipeEditor catalog={catalog} id={null} initial={BLANK} status="draft" credit={null} updatedAt={null} />
      </PageShell>
    </>
  );
}
