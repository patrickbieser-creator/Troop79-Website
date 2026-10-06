/**
 * /admin/library/menu-monster — Menu Monster leader tools
 * (Plans/Menu-Monster-Leader-Tools.md).
 *
 * Seven tabs. Needs attention comes first (release 6: one line per kind of thing waiting on a leader) and
 * Purchases last (each outing's planned vs paid). Between them: the Price book (ingredients, packages with prices, unit
 * conversions), Food & recipes (menu items: single foods open in the list, a recipe on its own page under
 * recipes/[recipeId]), Scout recipes (every recipe a scout wrote — a shared one is live at once, Phase 4A —
 * to edit, copy, rename, re-credit or retire) and Menus (every saved menu, with the owner's controls; leaders
 * have full rights on any menu, D-327). Gated by
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
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { authoringOf, isSingleFood } from '@/lib/menu-monster/authoring';
import { parseFoodFilter, recipeHref } from '@/lib/menu-monster/food-list';
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
import { listScoutRecipesWith, listTypedInsWith } from '@/lib/menu-monster/scout-recipes-store';
import { listAllMenusWith, listMenuOwnerCandidatesWith, type MenuOwnerCandidate } from '@/lib/menu-monster/menus-store';
import { loadPatrolNamesWith } from '@/lib/menu-monster/menus-data';
import { MenusAdmin, type MenuAdminRow } from './menus-admin';
import { ScoutIngredients } from './scout-ingredients';
import { GearAdmin } from './gear-admin';
import { listGearAdminWith, listGearWith } from '@/lib/menu-monster/gear-store';
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

type Tab = 'attention' | 'prices' | 'recipes' | 'scouts' | 'menus' | 'gear' | 'purchases';
const TABS: readonly Tab[] = ['attention', 'prices', 'recipes', 'scouts', 'menus', 'gear', 'purchases'];
/** How far back "Brands typed in lately" looks. */
const NEW_BRAND_DAYS = 30;

export default async function MenuMonsterAdminPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string; ingredient?: string; recipe?: string; kind?: string; meal?: string; q?: string }>;
}) {
  await requireCapability('library.moderate');
  const sp = await searchParams;
  const admin = createAdminClient();
  const [catalog, held, heldPackages, stores, shared, typedIns] = await Promise.all([
    loadAuthoringCatalogWith(admin),
    listHeldWith(admin),
    listHeldPackagesWith(admin),
    listActiveStoreNamesWith(admin),
    listScoutRecipesWith(admin, (ids) => ownerCreditNamesWith(admin, ids)),
    listTypedInsWith(admin)
  ]);
  const today = centralToday();

  const unpriced = catalog.ingredients.filter(
    (i) => !i.retiredAt && !catalog.packages.some((p) => p.ingredientId === i.id && !p.retiredAt && p.yield != null)
  ).length;
  const drafts = catalog.recipes.filter((r) => r.status === 'draft').length;
  // An old link that names an ingredient or a recipe but no tab still lands on its editor.
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : sp.ingredient ? 'prices' : sp.recipe ? 'recipes' : 'attention';
  // Food & recipes: a single food opens under its row; a recipe has its own page, so a link that names one goes there.
  const foodFilter = parseFoodFilter(sp);
  if (tab === 'recipes' && sp.recipe) {
    const named = catalog.recipes.find((r) => r.id === sp.recipe);
    if (named && !isSingleFood(authoringOf(named))) redirect(recipeHref(named.id, foodFilter));
  }
  // The gear list only matters on its own tab.
  const gear = tab === 'gear' ? await listGearAdminWith(admin) : [];
  // The gear picker in the recipe editors offers the live master list, A to Z.
  const gearList = tab === 'recipes' ? await listGearWith(admin) : [];
  // Scout recipes worth a look: live ones changed after sharing, and typed-in ingredients to match.
  const edited = shared.filter((r) => r.editedSinceShared && r.status !== 'retired').length + typedIns.length;
  // Every saved menu, with its owner's name and its outing's title: only for the Menus tab.
  let menus: MenuAdminRow[] = [];
  let owners: MenuOwnerCandidate[] = [];
  let patrols: string[] = [];
  if (tab === 'menus') {
    const all = await listAllMenusWith(admin);
    [owners, patrols] = await Promise.all([listMenuOwnerCandidatesWith(admin), loadPatrolNamesWith(admin)]);
    const ownerNames = await ownerCreditNamesWith(admin, all.map((m) => m.ownerPersonId));
    const entryIds = [...new Set(all.map((m) => m.calendarEntryId).filter((id): id is number => id != null))];
    const { data: entries } = entryIds.length ? await admin.from('calendar_entries').select('id, title').in('id', entryIds) : { data: [] };
    const titles = new Map((entries ?? []).map((e) => [e.id as number, e.title as string]));
    menus = all.map((m) => ({ ...m, owner: ownerNames.get(m.ownerPersonId) ?? 'Someone', patrol: m.patrol, outing: m.calendarEntryId != null ? (titles.get(m.calendarEntryId) ?? null) : null }));
  }
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
          { key: 'menus', label: 'Menus', href: '/admin/library/menu-monster?tab=menus' },
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
      ) : tab === 'menus' ? (
        <MenusAdmin menus={menus} owners={owners} patrols={patrols} />
      ) : tab === 'gear' ? (
        <GearAdmin items={gear} />
      ) : tab === 'recipes' ? (
        <RecipeBuilder catalog={catalog} initialRecipeId={sp.recipe} initialFilter={foodFilter} stores={stores} today={today} gearList={gearList} />
      ) : (
        <>
          <ScoutIngredients items={typedIns} book={book} />
          <ScoutRecipes recipes={shared} />
        </>
      )}
    </div>
  );
}
