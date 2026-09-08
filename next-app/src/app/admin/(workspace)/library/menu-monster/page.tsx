/**
 * /admin/library/menu-monster — Menu Monster leader tools
 * (Plans/Menu-Monster-Leader-Tools.md).
 *
 * Two tabs: the Price book (ingredients, packages with prices, unit
 * conversions) and Recipes (menu items with per-line diet rules). Gated by
 * `library.moderate` here and again in every action; reads with the service
 * role because the mm_* tables have RLS on with zero policies (D-239).
 * Depth-2 under Resource Library — its own nav item rather than an eighth
 * Library tab (tech-lead, 2026-09-08).
 *
 * Scout suggestions are not reviewed here: "Suggest a change" on the planner
 * routes to /library/submit?target=topic:menu-monster and lands in the
 * Library Queue like any other submission.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireCapability } from '@/lib/require-capability';
import { loadAuthoringCatalogWith } from '@/lib/menu-monster/catalog';
import { centralToday } from '@/lib/dates';
import { PageTitle } from '../../_components/page-title';
import { TabStrip } from '../../_components/tab-strip';
import { PublicPageLink } from '../../../_components/public-page-link';
import { PriceBook } from './price-book';
import { RecipeBuilder } from './recipe-builder';
import styles from './menu-monster.module.css';

export const metadata = {
  title: 'Menu Monster — Troop 79 Admin'
};

type Tab = 'prices' | 'recipes';

export default async function MenuMonsterAdminPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string; ingredient?: string; recipe?: string }>;
}) {
  await requireCapability('library.moderate');
  const sp = await searchParams;
  const catalog = await loadAuthoringCatalogWith(createAdminClient());
  const today = centralToday();

  const unpriced = catalog.ingredients.filter(
    (i) => !i.retiredAt && !catalog.packages.some((p) => p.ingredientId === i.id && !p.retiredAt && p.yield != null)
  ).length;
  const drafts = catalog.recipes.filter((r) => r.status === 'draft').length;
  const tab: Tab = sp.tab === 'recipes' ? 'recipes' : 'prices';

  return (
    <div className={styles.wrap}>
      <PageTitle
        back={{ label: 'Resource Library', href: '/admin/library' }}
        title="Menu Monster"
        sub={
          <>
            Leaders keep the shared menu items and prices here; the planner shows only <strong>published</strong>{' '}
            items. Scouts can&rsquo;t change anything here — their ideas land in the{' '}
            <Link href="/admin/library?tab=queue">Library Queue</Link> for you to review.
          </>
        }
      >
        <PublicPageLink href="/library/topic/menu-monster" />
      </PageTitle>

      <TabStrip
        ariaLabel="Menu Monster sections"
        activeKey={tab}
        items={[
          { key: 'prices', label: 'Price book', href: '/admin/library/menu-monster?tab=prices', ...(unpriced > 0 ? { count: unpriced } : {}) },
          { key: 'recipes', label: 'Recipes', href: '/admin/library/menu-monster?tab=recipes', ...(drafts > 0 ? { count: drafts } : {}) }
        ]}
      />

      {tab === 'prices' ? (
        <PriceBook catalog={catalog} today={today} initialIngredientId={sp.ingredient} />
      ) : (
        <RecipeBuilder catalog={catalog} initialRecipeId={sp.recipe} />
      )}
    </div>
  );
}
