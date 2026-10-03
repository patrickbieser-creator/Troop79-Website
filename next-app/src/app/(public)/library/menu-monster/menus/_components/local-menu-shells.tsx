'use client';

/**
 * The local menu's pages, as thin client shells (IA correction, 2026-10-02).
 * A visitor's or leader's menu lives in this browser, so these read it after
 * mount (nothing renders before, which avoids a hydration mismatch) and hand it
 * to the SAME Plan, meal and Shopping components a scout's saved menu uses —
 * only the store differs (local-menu-store.ts).
 *
 * Two tabs: the `storage` event reloads this tab from the other tab's write
 * (last write wins) by remounting the editor on a new `rev`. A catalog change
 * that dropped recipes since the menu was stored gets one quiet line.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Catalog } from '@/lib/menu-monster/types';
import { blankMenu, type Menu } from '@/lib/menu-monster/menus';
import type { Outing } from '@/lib/menu-monster/menu-view';
import { onLocalMenuChange, readLocalMenu } from '@/lib/menu-monster/local-menu';
import { LOCAL_MENU_HREFS, localMenuStore } from '@/lib/menu-monster/local-menu-store';
import { TabStrip } from '@/app/_components/tab-strip';
import { MealEditor } from './meal-editor';
import { PlanTab } from './plan-tab';
import { ShoppingTab } from './shopping-tab';
import s from './workspace.module.css';

const HUB_HREF = '/library/topic/menu-monster';

interface Local {
  ready: boolean;
  menu: Menu | null;
  dropped: number;
  /** Bumps on every (re)load so an editor remounts on another tab's change. */
  rev: number;
}

function useLocalMenu(catalog: Catalog): Local {
  const [state, setState] = useState<Local>({ ready: false, menu: null, dropped: 0, rev: 0 });
  useEffect(() => {
    const load = () => {
      const read = readLocalMenu(catalog);
      setState((cur) => ({ ready: true, menu: read.menu, dropped: read.dropped, rev: cur.rev + 1 }));
    };
    load();
    return onLocalMenuChange(load);
  }, [catalog]);
  return state;
}

function DroppedLine({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <p className={s.foot} role="status">
      {n === 1 ? '1 recipe on this menu is' : `${n} recipes on this menu are`} no longer in the library, so {n === 1 ? 'it was' : 'they were'} left out.
    </p>
  );
}

function LocalTabs({ active }: { active: 'plan' | 'shopping' }) {
  return (
    <TabStrip
      ariaLabel="Menu sections"
      activeKey={active}
      items={[
        { key: 'plan', label: 'Plan', href: LOCAL_MENU_HREFS.plan },
        { key: 'shopping', label: 'Shopping', href: LOCAL_MENU_HREFS.shopping }
      ]}
    />
  );
}

/** The local Plan tab. On the hub (`hub`) it sits under the page's own h1 and has no tab strip. */
export function LocalPlan({ catalog, outings, hub = false }: { catalog: Catalog; outings: Outing[]; hub?: boolean }) {
  const store = useMemo(() => localMenuStore(catalog), [catalog]);
  const { ready, menu, dropped, rev } = useLocalMenu(catalog);
  if (!ready) return null;
  return (
    <>
      <DroppedLine n={dropped} />
      <PlanTab
        key={rev}
        catalog={catalog}
        menuId={menu ? 'local' : null}
        menu={menu ?? blankMenu()}
        updatedAt={null}
        outings={outings}
        store={store}
        titleAs={hub ? 'h2' : 'h1'}
        tabs={!hub && menu ? <LocalTabs active="plan" /> : undefined}
      />
    </>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <p className={s.foot}>
      {text}{' '}
      <Link className={s.link} href={HUB_HREF}>
        Plan a menu
      </Link>
    </p>
  );
}

export function LocalShopping({ catalog }: { catalog: Catalog }) {
  const store = useMemo(() => localMenuStore(catalog), [catalog]);
  const { ready, menu, dropped, rev } = useLocalMenu(catalog);
  if (!ready) return null;
  if (!menu) return <Missing text="There is no menu saved on this computer yet." />;
  return (
    <>
      <DroppedLine n={dropped} />
      <ShoppingTab key={rev} catalog={catalog} menu={menu} updatedAt={null} snapshot={null} store={store} tabs={<LocalTabs active="shopping" />} />
    </>
  );
}

export function LocalMeal({ catalog, mealId }: { catalog: Catalog; mealId: string }) {
  const store = useMemo(() => localMenuStore(catalog), [catalog]);
  const { ready, menu, dropped, rev } = useLocalMenu(catalog);
  if (!ready) return null;
  if (!menu || !menu.meals.some((m) => m.id === mealId)) return <Missing text="That meal isn’t on the menu saved on this computer." />;
  return (
    <>
      <DroppedLine n={dropped} />
      <MealEditor key={rev} catalog={catalog} menu={menu} mealId={mealId} updatedAt={null} store={store} />
    </>
  );
}
