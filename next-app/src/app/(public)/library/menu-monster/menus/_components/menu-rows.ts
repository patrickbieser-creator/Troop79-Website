/**
 * Turns a scout's menu summaries into the rows My menus (and the Menu Monster
 * hub) draw: context label, linked outing, meal count and the per-person-per-
 * meal cost. One loader so the two screens can never disagree. A leader's rows
 * also carry the owner's credit name (`owners`, person id -> "Sam K.") and the
 * last-edited stamp.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { centralToday } from '@/lib/dates';
import { MENU_CONTEXTS } from '@/lib/menu-monster/menus';
import { loadMenuWith, type MenuSummary } from '@/lib/menu-monster/menus-store';
import { loadOutingsWith } from '@/lib/menu-monster/menus-data';
import { menuCost } from '@/lib/menu-monster/menu-view';
import type { Catalog } from '@/lib/menu-monster/types';
import type { MenuRowData } from './menus-list';

export async function loadMenuRows(
  sb: SupabaseClient,
  summaries: MenuSummary[],
  catalog: Catalog,
  owners?: ReadonlyMap<number, string>
): Promise<MenuRowData[]> {
  const [stored, outings] = await Promise.all([
    Promise.all(summaries.map((m) => loadMenuWith(sb, m.id))),
    loadOutingsWith(
      sb,
      centralToday(),
      summaries.flatMap((m) => (m.calendarEntryId != null ? [m.calendarEntryId] : []))
    )
  ]);
  const outingName = new Map(outings.map((o) => [o.id, o.title]));

  return summaries.map((m, i) => {
    const menu = stored[i]?.menu;
    const cost = menu ? menuCost(menu, catalog) : null;
    return {
      id: m.id,
      name: m.name,
      contextLabel: MENU_CONTEXTS.find((c) => c.key === m.context)?.label ?? m.context,
      outingName: m.calendarEntryId != null ? (outingName.get(m.calendarEntryId) ?? null) : null,
      mealCount: m.mealCount,
      perPersonMeal: cost && cost.total > 0 ? cost.perPersonMeal : null,
      updatedAt: m.updatedAt,
      ownerName: m.ownerPersonId != null ? (owners?.get(m.ownerPersonId) ?? null) : null
    };
  });
}
