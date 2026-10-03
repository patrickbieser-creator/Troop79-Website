/**
 * Menu Monster on the /library/topic/menu-monster shelf — server half, and the
 * hub of the scout workspace. Loads the published catalog with the service role
 * (the mm_* tables have RLS on and zero policies, D-051/D-239). The one
 * per-visitor read is the identity cookie. The shelf page is `dynamic =
 * 'force-dynamic'` (D-040), so a catalog edit by migration shows on the next load.
 *
 * The planning flow is the main experience for everyone (IA correction,
 * 2026-10-02):
 *   - visitors and leaders: the page IS the Plan tab of an unsaved menu kept on
 *     this computer (the same component a scout's saved menu uses), under one
 *     quiet "Sign in to save your menus" strip. A leader also gets a read-only
 *     "Scouts' menus" section BELOW the plan: the plan is what the page is for,
 *     and the list is a reference, so it stays out of the way.
 *   - signed-in scouts: My menus + New menu, a "Continue <latest menu>" link
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
import { loadMenuMonsterCatalog } from '@/lib/menu-monster/data';
import { listAllMenusWith, listMenusWith, ownerCreditNamesWith } from '@/lib/menu-monster/menus-store';
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
import { LocalPlan } from '../../menu-monster/menus/_components/local-menu-shells';
import { loadMenuRows } from '../../menu-monster/menus/_components/menu-rows';
import { MenusList } from '../../menu-monster/menus/_components/menus-list';
import { MENUS_HREF, MENU_HUB_HREF, menuViewer, type MenuViewer } from '../../menu-monster/menus/_components/scout-menus';
import w from '../../menu-monster/menus/_components/workspace.module.css';

const RECENT = 5;
const LEADER_RECENT = 10;

const TABS = [
  { key: 'planner', label: 'Meal Planner' },
  { key: 'recipes', label: 'Recipe Library' },
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
  // A signed-in scout's own draft recipes join their planner and library.
  const catalog = await loadMenuMonsterCatalog(viewer?.kind === 'scout' ? viewer.personId : null);
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
      {tab === 'ingredients' && <IngredientBrowser catalog={catalog} />}
      {tab === 'builder' && (await recipeBuilder(viewer))}
    </>
  );
}

/** Recipe Builder: a scout's own recipes + New recipe; anyone else one line to sign in. */
async function recipeBuilder(viewer: MenuViewer | null) {
  if (viewer?.kind !== 'scout') {
    return (
      <p className={w.foot}>
        Scouts:{' '}
        <Link className={w.link} href={`/signin?next=${encodeURIComponent(`${MENU_HUB_HREF}?tab=builder`)}`}>
          sign in
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

  if (viewer?.kind === 'scout') {
    const sb = createAdminClient();
    const summaries = await listMenusWith(sb, viewer.personId);
    const rows = await loadMenuRows(sb, summaries.slice(0, RECENT), catalog);
    const latest = summaries[0];
    return (
      <section className={w.hubSection}>
        <div className={w.listHead}>
          <h2 className={w.heading}>My menus</h2>
          <Button variant="primary" size="sm" href={`${MENUS_HREF}/new`}>
            New menu
          </Button>
        </div>
        {latest && (
          <p className={w.foot}>
            <Link className={w.link} href={`${MENUS_HREF}/${latest.id}`}>
              Continue {latest.name}
            </Link>
          </p>
        )}
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
    );
  }

  const [outings, identity] = await Promise.all([loadOutingsWith(createAdminClient(), centralToday()), getIdentitySessionIfValid()]);
  const signedIn = viewer?.kind === 'leader' || identity != null;
  let scoutsMenus: React.ReactNode = null;
  if (viewer?.kind === 'leader') {
    const sb = createAdminClient();
    const all = await listAllMenusWith(sb);
    const shown = all.slice(0, LEADER_RECENT);
    const owners = await ownerCreditNamesWith(sb, shown.map((m) => m.ownerPersonId));
    const rows = await loadMenuRows(sb, shown, catalog, owners);
    scoutsMenus = (
      <section className={w.hubSection}>
        <div className={w.listHead}>
          <h2 className={w.heading}>Scouts’ menus</h2>
        </div>
        <MenusList rows={rows} readOnly emptyText="No scout has saved a menu yet." />
        {all.length > LEADER_RECENT && (
          <p className={w.foot}>
            <Link className={w.link} href={MENUS_HREF}>
              All scouts’ menus
            </Link>
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      {signedIn ? (
        // Already signed in as an adult or leader: a sign-in link would be a dead end.
        <p className={w.foot}>Your menu stays on this computer. Saving to My menus is for signed-in scouts.</p>
      ) : (
        <p className={w.foot}>
          <Link className={w.link} href={`/signin?next=${encodeURIComponent(MENU_HUB_HREF)}`}>
            Sign in to save your menus
          </Link>
          . Until then, your menu stays on this computer.
        </p>
      )}
      <LocalPlan catalog={catalog} outings={outings} hub />
      {scoutsMenus}
    </>
  );
}
