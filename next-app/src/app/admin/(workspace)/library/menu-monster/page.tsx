/**
 * /admin/library/menu-monster — Menu Monster leader tools
 * (Plans/Menu-Monster-Leader-Tools.md).
 *
 * Six tabs. Needs attention comes first (release 6: one line per kind of thing waiting on a leader) and
 * Purchases last (each outing's planned vs paid). Between them: the Price book (ingredients, packages with prices, unit
 * conversions), Food & recipes (menu items: single foods and recipes, with per-line diet rules) and Scout
 * recipes (what scouts shared — live at once, Phase 4A — to retire or re-credit). Gated by
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
import { listHeldWith, listRecentChangesWith } from '@/lib/menu-monster/price-history';
import { listHeldPackagesWith } from '@/lib/menu-monster/scout-packages-store';
import { listActiveStoreNamesWith } from '@/lib/menu-monster/stores';
import { PageTitle } from '../../_components/page-title';
import { TabStrip } from '../../_components/tab-strip';
import { PublicPageLink } from '../../../_components/public-page-link';
import { PriceActivity } from './price-activity';
import { PriceBook } from './price-book';
import { RecipeBuilder } from './recipe-builder';
import { ScoutRecipes } from './scout-recipes';
import { listSharedScoutRecipesWith, listTypedInsWith } from '@/lib/menu-monster/scout-recipes-store';
import { ScoutIngredients } from './scout-ingredients';
import { GearAdmin } from './gear-admin';
import { listGearAdminWith } from '@/lib/menu-monster/gear-store';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listPurchasesWith, unfinishedPurchases } from '@/lib/menu-monster/purchases';
import { ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { recentTypedBrands } from '@/lib/menu-monster/brands-store';
import { Attention, type NewBrand } from './attention';
import { Purchases } from './purchases';
import styles from './menu-monster.module.css';

export const metadata = {
  title: 'Menu Monster — Troop 79 Admin'
};

type Tab = 'attention' | 'prices' | 'recipes' | 'scouts' | 'gear' | 'purchases';
const TABS: readonly Tab[] = ['attention', 'prices', 'recipes', 'scouts', 'gear', 'purchases'];
/** How far back "Brands typed in lately" looks. */
const NEW_BRAND_DAYS = 30;

export default async function MenuMonsterAdminPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string; ingredient?: string; recipe?: string }>;
}) {
  await requireCapability('library.moderate');
  const sp = await searchParams;
  const admin = createAdminClient();
  const [catalog, held, heldPackages, stores, shared, typedIns] = await Promise.all([
    loadAuthoringCatalogWith(admin),
    listHeldWith(admin),
    listHeldPackagesWith(admin),
    listActiveStoreNamesWith(admin),
    listSharedScoutRecipesWith(admin),
    listTypedInsWith(admin)
  ]);
  const today = centralToday();

  const unpriced = catalog.ingredients.filter(
    (i) => !i.retiredAt && !catalog.packages.some((p) => p.ingredientId === i.id && !p.retiredAt && p.yield != null)
  ).length;
  const drafts = catalog.recipes.filter((r) => r.status === 'draft').length;
  // An old link that names an ingredient or a recipe but no tab still lands on its editor.
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : sp.ingredient ? 'prices' : sp.recipe ? 'recipes' : 'attention';
  // The gear list only matters on its own tab.
  const gear = tab === 'gear' ? await listGearAdminWith(admin) : [];
  // Scout recipes worth a look: live ones changed after sharing, and typed-in ingredients to match.
  const edited = shared.filter((r) => r.editedSinceShared && r.status !== 'retired').length + typedIns.length;
  const book = catalog.ingredients
    .filter((i) => !i.retiredAt && !i.needsMatch)
    .map((i) => ({ id: i.id, name: i.name, unitKey: i.unit.key, unitMany: i.unit.many }));
  // Recent changes only matter on the Price book tab; the 50-row read skips Recipes.
  const changes = tab === 'prices' ? await listRecentChangesWith(admin, 50) : [];
  // Purchases are priced menu by menu: only for the two tabs that show them.
  const purchases = tab === 'purchases' || tab === 'attention' ? await listPurchasesWith(admin, await loadMenuMonsterCatalog(null)) : [];
  const unfinished = unfinishedPurchases(purchases, today).length;
  const editedRecipes = shared.filter((r) => r.editedSinceShared && r.status !== 'retired').length;
  const waiting = held.length + heldPackages.length + typedIns.length + editedRecipes + unfinished;
  let newBrands: NewBrand[] = [];
  if (tab === 'attention') {
    const typed = recentTypedBrands(catalog.brands ?? [], today, NEW_BRAND_DAYS);
    const who = await ownerCreditNamesWith(admin, typed.map((b) => b.addedBy as number));
    newBrands = typed.map((b) => ({
        id: b.id,
        name: b.name,
        ingredientId: b.ingredientId,
        ingredientName: catalog.ingredients.find((i) => i.id === b.ingredientId)?.name ?? b.ingredientId,
        addedBy: who.get(b.addedBy as number) ?? 'Someone',
        createdAt: b.createdAt ?? '',
        unpriced: !catalog.packages.some((p) => p.brandId === b.id && !p.retiredAt && p.yield != null)
      }));
  }

  return (
    <div className={styles.wrap}>
      <PageTitle
        back={{ label: 'Resource Library', href: '/admin/library' }}
        title="Menu Monster"
        sub={
          <>
            Leaders keep the shared menu items and prices here; the planner shows only <strong>published</strong>{' '}
            items. Recipes scouts share go live at once — find them under Scout recipes; other ideas land in the{' '}
            <Link href="/admin/library?tab=queue">Library Queue</Link>.
          </>
        }
      >
        <PublicPageLink href="/library/topic/menu-monster" />
      </PageTitle>

      <TabStrip
        ariaLabel="Menu Monster sections"
        activeKey={tab}
        items={[
          { key: 'attention', label: 'Needs attention', href: '/admin/library/menu-monster?tab=attention', ...(waiting > 0 ? { count: waiting } : {}) },
          { key: 'prices', label: 'Price book', href: '/admin/library/menu-monster?tab=prices', ...(unpriced + held.length + heldPackages.length > 0 ? { count: unpriced + held.length + heldPackages.length } : {}) },
          { key: 'recipes', label: 'Food & recipes', href: '/admin/library/menu-monster?tab=recipes', ...(drafts > 0 ? { count: drafts } : {}) },
          { key: 'scouts', label: 'Scout recipes', href: '/admin/library/menu-monster?tab=scouts', ...(edited > 0 ? { count: edited } : {}) },
          { key: 'gear', label: 'Gear', href: '/admin/library/menu-monster?tab=gear' },
          { key: 'purchases', label: 'Purchases', href: '/admin/library/menu-monster?tab=purchases', ...(unfinished > 0 ? { count: unfinished } : {}) }
        ]}
      />

      {tab === 'attention' ? (
        <Attention
          counts={{ heldPrices: held.length, heldPackages: heldPackages.length, ingredients: typedIns.length, editedRecipes, unpriced, drafts, unfinishedOutings: unfinished }}
          brands={newBrands}
        />
      ) : tab === 'purchases' ? (
        <Purchases outings={purchases} />
      ) : tab === 'prices' ? (
        <>
          <PriceActivity held={held} heldPackages={heldPackages} changes={changes} />
          <PriceBook catalog={catalog} today={today} stores={stores} initialIngredientId={sp.ingredient} />
        </>
      ) : tab === 'gear' ? (
        <GearAdmin items={gear} />
      ) : tab === 'recipes' ? (
        <RecipeBuilder catalog={catalog} initialRecipeId={sp.recipe} stores={stores} today={today} />
      ) : (
        <>
          <ScoutIngredients items={typedIns} book={book} />
          <ScoutRecipes recipes={shared} />
        </>
      )}
    </div>
  );
}
