/**
 * Menu Monster on the /library/topic/menu-monster shelf — server half, and the
 * hub of the scout workspace. Loads the published catalog with the service role
 * (the mm_* tables have RLS on and zero policies, D-051/D-239). The one
 * per-visitor read is the identity cookie. The shelf page is `dynamic =
 * 'force-dynamic'` (D-040), so a catalog edit by migration shows on the next load.
 *
 * The planning flow is the main experience for everyone (IA correction,
 * 2026-10-02):
 *   - visitors: the page IS the Plan tab of an unsaved menu kept on this computer
 *     (the same component a saved menu uses), under one quiet "Sign in to save
 *     your menus" strip.
 *   - anyone signed in — scouts, and since 2026-10-04 parents and leaders too
 *     (Patrick: "adults do need to get access to saved menus also"): My menus + New menu, a "Continue <latest menu>" link
 *     (the hub never opens it for them), and, when this browser holds an unsaved
 *     local menu, a row offering to save it to My menus.
 * The old anonymous planner is no longer rendered here.
 *
 * Tabs (Patrick, 2026-10-02): Meal Planner (the above, the default) | Recipe
 * Library | Ingredients | Recipe Builder, as `?tab=` links so each is shareable.
 * The browse tabs need only the catalog; the planner's loads run on its tab only.
 */
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { centralToday } from '@/lib/dates';
import { resolveAdminActor } from '@/lib/admin-actor';
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listAllMenusWith, listMenusWith, listSharedMenusWith, ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { Button } from '@/app/_components/button';
import { TabStrip } from '@/app/_components/tab-strip';
import type { Catalog, Plan } from '@/lib/menu-monster/types';
import { RecipeBrowser } from '../../menu-monster/_components/recipe-browser';
import { IngredientBrowser } from '../../menu-monster/_components/ingredient-browser';
import { listMyRecipesWith } from '@/lib/menu-monster/scout-recipes-store';
import { MyRecipesList } from '../../menu-monster/recipes/_components/my-recipes-list';
import { RECIPES_HREF } from '../../menu-monster/recipes/_components/paths';
import { DraftOffer } from '../../menu-monster/menus/_components/draft-offer';
import { listGearWith } from '@/lib/menu-monster/gear-store';
import { listDraftItemsWith } from '@/lib/menu-monster/draft-items';
import { LocalPlan } from '../../menu-monster/menus/_components/local-menu-shells';
import { loadMenuRows } from '../../menu-monster/menus/_components/menu-rows';
import { MenusList } from '../../menu-monster/menus/_components/menus-list';
import { MENUS_HREF, MENU_HUB_HREF, SHARED_HREF, menuViewer, type MenuViewer } from '../../menu-monster/menus/_components/scout-menus';
import { SharedMenusList } from '../../menu-monster/menus/_components/shared-menus-list';
import w from '../../menu-monster/menus/_components/workspace.module.css';

const RECENT = 5;
const LEADER_RECENT = 10;
/** Shared menus on the hub; the rest are one link away (tech-lead review: one full list). */
const SHARED_RECENT = 5;

const TABS = [
  { key: 'planner', label: 'Meal Planner' },
  // Food & Recipes (Patrick, 2026-10-03): most entries are single foods (apples, bacon), not recipes.
  { key: 'recipes', label: 'Food & Recipes' },
  { key: 'ingredients', label: 'Ingredients' },
  { key: 'builder', label: 'Recipe Builder' }
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** One person of every diet, so the library shows each recipe's diet swaps ("gluten-free only", "everyone else"). */
const EVERY_DIET: Pick<Plan, 'headcount' | 'restrictions'> = { headcount: 8, restrictions: { gf: 1, nut: 1, dairy: 1, veg: 1 } };

export async function MenuMonsterShelfTool({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const asked = typeof searchParams.tab === 'string' ? searchParams.tab : '';
  const tab: TabKey = TABS.some((x) => x.key === asked) ? (asked as TabKey) : 'planner';
  const viewer = await menuViewer();
  // The signed-in person's own draft recipes and requested ingredients join every tab.
  const catalog = await loadMenuMonsterCatalog(viewer?.personId ?? null);
  const planner = tab === 'planner' ? await mealPlanner(catalog, viewer) : null;
  return (
    <>
      <div className={w.tabs}>
        <TabStrip
          ariaLabel="Menu Monster"
          activeKey={tab}
          items={TABS.map((x) => ({ key: x.key, label: x.label, href: x.key === 'planner' ? MENU_HUB_HREF : `${MENU_HUB_HREF}?tab=${x.key}` }))}
        />
      </div>
      {planner}
      {tab === 'recipes' && <RecipeBrowser catalog={catalog} plan={EVERY_DIET} />}
      {tab === 'ingredients' && <IngredientBrowser catalog={catalog} adder={await ingredientAdder(viewer)} signInHref={`/signin?next=${encodeURIComponent(`${MENU_HUB_HREF}?tab=ingredients`)}`} />}
      {tab === 'builder' && (await recipeBuilder(viewer))}
    </>
  );
}

/** Who may add an ingredient from the Ingredients tab: a leader who keeps the price book adds it at once ('live');
 *  any other signed-in person sends it to a leader ('review'); a visitor is asked to sign in (null). */
async function ingredientAdder(viewer: MenuViewer | null): Promise<'live' | 'review' | null> {
  if (viewer == null || viewer.personId == null) return null;
  if (viewer.kind !== 'leader') return 'review';
  const actor = await resolveAdminActor();
  return actor?.capabilities.has('library.moderate') ? 'live' : 'review';
}

/** Recipe Builder: the signed-in person's own recipes + New recipe (scout, leader or parent); anyone else one line to sign in. */
async function recipeBuilder(viewer: MenuViewer | null) {
  if (!viewer || viewer.personId == null) {
    return (
      <p className={w.foot}>
        <Link className={w.link} href={`/signin?next=${encodeURIComponent(`${MENU_HUB_HREF}?tab=builder`)}`}>
          Sign in
        </Link>{' '}
        to write a recipe.
      </p>
    );
  }
  const mine = await listMyRecipesWith(createAdminClient(), viewer.personId);
  return (
    <section className={w.hubSection}>
      <div className={w.listHead}>
        <h2 className={w.heading}>My recipes</h2>
        <Button variant="primary" size="sm" href={`${RECIPES_HREF}/new`}>
          New recipe
        </Button>
      </div>
      <MyRecipesList rows={mine.map((r) => ({ id: r.id, name: r.name, status: r.status, credit: r.credit }))} />
    </section>
  );
}

/** A plain async function, not a nested component: the tab is awaited here, so tests can render the tool. */
async function mealPlanner(catalog: Catalog, viewer: MenuViewer | null) {
  if (viewer && viewer.personId != null) {
    const sb = createAdminClient();
    // Below a parent's own menus, their scouts'; below a leader's, everyone's (both read-only).
    const others = viewer.kind === 'parent' ? await parentsScouts(catalog, viewer.familyIds.filter((id) => id !== viewer.personId)) : viewer.kind === 'leader' ? await everyonesMenus(catalog, viewer.personId) : null;
    const summaries = await listMenusWith(sb, viewer.personId);
    const rows = await loadMenuRows(sb, summaries.slice(0, RECENT), catalog);
    const latest = summaries[0];
    return (
      <>
      <section className={w.hubSection}>
        <div className={w.listHead}>
          <h2 className={w.heading}>My menus</h2>
          {latest ? (
            <div className={w.hubActions}>
              <Button variant="primary" size="sm" href={`${MENUS_HREF}/${latest.id}/people`}>
                Continue {latest.name}
              </Button>
              <Button variant="secondary" size="sm" href={`${MENUS_HREF}/new`}>
                New menu
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" href={`${MENUS_HREF}/new`}>
              New menu
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className={w.foot}>No menus yet. Start one to save meals, people and a shopping list.</p>
        ) : (
          <MenusList rows={rows} />
        )}
        {summaries.length > RECENT && (
          <p className={w.foot}>
            <Link className={w.link} href={MENUS_HREF}>
              All my menus
            </Link>
          </p>
        )}
        <DraftOffer catalog={catalog} />
      </section>
      {others}
      {await sharedWithTroop()}
      </>
    );
  }

  // Not signed in as one person: a visitor, or a leader on the old shared password (nobody to save for).
  // Gear list and draft food names are troop-public; the kept-here menu's meals use them like a saved menu's.
  const sbHub = createAdminClient();
  const [outings, identity, gearList, draftItems] = await Promise.all([loadOutingsWith(sbHub, centralToday()), getIdentitySessionIfValid(), listGearWith(sbHub), listDraftItemsWith(sbHub)]);
  const signedIn = viewer?.kind === 'leader' || identity != null;
  const scoutsMenus = viewer?.kind === 'leader' ? await everyonesMenus(catalog) : null;

  return (
    <>
      {signedIn ? (
        // Already signed in as an adult or leader: a sign-in link would be a dead end.
        <p className={w.foot}>Your menu stays on this computer. To save menus, sign in as yourself.</p>
      ) : (
        <p className={w.foot}>
          <Link className={w.link} href={`/signin?next=${encodeURIComponent(MENU_HUB_HREF)}`}>
            Sign in to save your menus
          </Link>
          . Until then, your menu stays on this computer.
        </p>
      )}
      <LocalPlan catalog={catalog} outings={outings} hub gearList={gearList} draftItems={draftItems} />
      {scoutsMenus}
      {await sharedWithTroop()}
    </>
  );
}

/** A leader's read-only list of the menus everyone else has saved — scouts and adults (their own are in My menus). */
async function everyonesMenus(catalog: Catalog, selfPersonId: number | null = null) {
  const sb = createAdminClient();
  const all = (await listAllMenusWith(sb)).filter((m) => m.ownerPersonId !== selfPersonId);
  const shown = all.slice(0, LEADER_RECENT);
  const owners = await ownerCreditNamesWith(sb, shown.map((m) => m.ownerPersonId));
  const rows = await loadMenuRows(sb, shown, catalog, owners);
  return (
    <section className={w.hubSection}>
      <div className={w.listHead}>
        <h2 className={w.heading}>Everyone’s menus</h2>
      </div>
      <MenusList rows={rows} readOnly emptyText="Nobody else has saved a menu yet." />
      {all.length > LEADER_RECENT && (
        <p className={w.foot}>
          <Link className={w.link} href={MENUS_HREF}>
            All saved menus
          </Link>
        </p>
      )}
    </section>
  );
}

/** A parent's read-only list of their scouts' menus (Phase 3), under their own menus like a leader's. */
async function parentsScouts(catalog: Catalog, scouts: number[]) {
  if (scouts.length === 0) return null;
  const sb = createAdminClient();
  const summaries = await listMenusWith(sb, scouts);
  const shown = summaries.slice(0, RECENT);
  const owners = await ownerCreditNamesWith(sb, shown.map((m) => m.ownerPersonId));
  const rows = await loadMenuRows(sb, shown, catalog, owners);
  return (
    <section className={w.hubSection}>
      <div className={w.listHead}>
        <h2 className={w.heading}>Your scouts’ menus</h2>
      </div>
      <MenusList rows={rows} readOnly emptyText="Your scouts haven’t saved a menu yet." />
      {summaries.length > RECENT && (
        <p className={w.foot}>
          <Link className={w.link} href={MENUS_HREF}>
            All your scouts’ menus
          </Link>
        </p>
      )}
    </section>
  );
}

/** "Shared with the troop" (Phase 3): the newest shared menus on the shelf, for everyone. Absent when there are none. */
async function sharedWithTroop() {
  const rows = await listSharedMenusWith(createAdminClient(), centralToday(), { limit: SHARED_RECENT + 1 });
  if (rows.length === 0) return null;
  return (
    <section className={w.hubSection}>
      <div className={w.listHead}>
        <h2 className={w.heading}>Shared with the troop</h2>
      </div>
      <SharedMenusList rows={rows.slice(0, SHARED_RECENT)} />
      {rows.length > SHARED_RECENT && (
        <p className={w.foot}>
          <Link className={w.link} href={SHARED_HREF}>
            All shared menus
          </Link>
        </p>
      )}
    </section>
  );
}
