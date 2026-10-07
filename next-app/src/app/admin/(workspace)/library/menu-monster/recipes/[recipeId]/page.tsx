/**
 * /admin/library/menu-monster/recipes/[recipeId] — one recipe's editor on its own page ('new' = a blank
 * one). Depth 3 under Resource Library → Menu Monster; the Menu Monster crumb returns to the Food & recipes
 * list with the filters it was opened from (?kind= &meal= &q=). A single food normally opens in that list;
 * it lands here only for the full editor ("Open the full editor"). Same gate and service-role read as the
 * parent page.
 */
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadAuthoringCatalogWith } from '@/lib/menu-monster/catalog';
import { menusUsingRecipeWith } from '@/lib/menu-monster/recipe-delete-store';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { listActiveStoreNamesWith } from '@/lib/menu-monster/stores';
import { foodListHref, parseFoodFilter } from '@/lib/menu-monster/food-list';
import { ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { centralToday } from '@/lib/dates';
import { PageTitle } from '../../../../_components/page-title';
import { RecipeScreen } from '../../recipe-screen';
import styles from '../../menu-monster.module.css';

export const metadata = {
  title: 'Recipe — Menu Monster — Troop 79 Admin'
};

export default async function MenuMonsterRecipePage({
  params,
  searchParams
}: {
  params: Promise<{ recipeId: string }>;
  searchParams: Promise<{ kind?: string; meal?: string; q?: string }>;
}) {
  await requireCapability('library.moderate');
  const [{ recipeId }, sp] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const [catalog, stores, gearList] = await Promise.all([loadAuthoringCatalogWith(admin, { forRecipe: recipeId }), listActiveStoreNamesWith(admin), listGearWith(admin)]);
  const recipe = recipeId === 'new' ? null : (catalog.recipes.find((r) => r.id === recipeId) ?? null);
  if (recipeId !== 'new' && !recipe) notFound();
  const menusUsing = recipe ? await menusUsingRecipeWith(admin, recipe.id) : undefined;
  // A scout's unshared draft: say so quietly, so a leader knows whose it is and that it is not the troop's yet.
  const draftOwner = recipe?.authorPersonId != null && !recipe.sharedAt ? ((await ownerCreditNamesWith(admin, [recipe.authorPersonId])).get(recipe.authorPersonId) ?? 'A scout') : null;
  const filter = parseFoodFilter(sp);
  const name = recipe?.name ?? 'New recipe';

  return (
    <div className={styles.wrap}>
      <PageTitle
        back={{
          crumbs: [
            { label: 'Resource Library', href: '/admin/library' },
            { label: 'Menu Monster', href: '/admin/library/menu-monster' },
            { label: 'Food & recipes', href: foodListHref(filter) }
          ],
          current: name
        }}
        title={name}
      />
      {draftOwner ? <p className={styles.hint}>{draftOwner}’s draft — not shared.</p> : null}
      <RecipeScreen catalog={catalog} recipeId={recipeId} filter={filter} stores={stores} today={centralToday()} gearList={gearList} menusUsing={menusUsing} />
    </div>
  );
}
