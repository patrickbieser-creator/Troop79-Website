'use client';

/**
 * The local menu's pages, as thin client shells (IA correction, 2026-10-02).
 * A visitor's or leader's menu lives in this browser, so these read it after
 * mount (nothing renders before, which avoids a hydration mismatch) and hand it
 * to the SAME Plan and Shopping components a scout's saved menu uses —
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

function LocalTabs({ active }: { active: 'people' | 'plan' | 'shopping' }) {
  return (
    <TabStrip
      ariaLabel="Menu sections"
      activeKey={active}
      items={[
        { key: 'people', label: 'Who’s eating', href: LOCAL_MENU_HREFS.people },
        { key: 'plan', label: 'Meals', href: LOCAL_MENU_HREFS.plan },
        { key: 'shopping', label: 'Shopping', href: LOCAL_MENU_HREFS.shopping }
      ]}
    />
  );
}

/**
 * The local Who's eating (`page="people"`) and Meals (the default) steps, two routes like a saved menu's. A menu
 * not stored yet has no meals to show, so it always starts on Who's eating. On the hub (`hub`) it sits under
 * the page's own h1.
 */
export function LocalPlan({ catalog, outings, hub = false, openMeal = null, page = 'plan' }: { catalog: Catalog; outings: Outing[]; hub?: boolean; openMeal?: string | null; page?: 'people' | 'plan' }) {
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
        page={menu && page === 'plan' ? 'meals' : 'people'}
        store={store}
        titleAs={hub ? 'h2' : 'h1'}
        // The hub has no tab strip of its own, but a stored menu's two steps are two pages: the strip is how you reach the other one.
        tabs={menu ? <LocalTabs active={page} /> : undefined}
        openMeal={openMeal}
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
