/**
 * Purchases — what each outing's menus planned to spend and what was paid, for the leader tools
 * (Plans/Menu-Monster-Brands-Gear.md, release 6; Admin › Menu Monster › Purchases).
 *
 * Read-only: the numbers are the ones each menu's "What we bought" tab shows (bought.ts boughtTotals), read
 * against the public catalog as the outing's crew reads them. A leader corrects a purchase on that tab — one
 * place to record, not two. Takes a SupabaseClient (always the service role).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Catalog } from './types';
import { resolveMenuAliases, type Menu } from './menus';
import { redactMenu } from './menu-access';
import { buildMenuList } from './menu-view';
import { boughtFromActuals, boughtRows, boughtTotals, recorders, type Bought, type BoughtTotals, type Stamp } from './bought';
import { loadBoughtManyWith } from './bought-store';
import { listLinkedMenusWith, ownerCreditNamesWith } from './menus-store';

export interface PurchaseMenu {
  id: string;
  /** The patrol, or the menu's name when it names none. */
  label: string;
  name: string;
  planner: string;
  totals: BoughtTotals;
  /** "We're done shopping", or null. */
  done: Stamp | null;
  /** Everyone who recorded a line, first to last. */
  recordedBy: string[];
}

export interface PurchaseOuting {
  id: number;
  title: string;
  startDate: string;
  endDate: string | null;
  menus: PurchaseMenu[];
  planned: number;
  paid: number;
  /** True while any of its menus has lines nobody recorded and no "done" tick. */
  projected: boolean;
}


/** One menu's planned / paid, exactly as its "What we bought" tab totals them. */
export function menuPurchase(menu: Menu, updatedAt: string, bought: Bought, catalog: Catalog): { totals: BoughtTotals; recordedBy: string[] } {
  const seen = resolveMenuAliases(redactMenu(menu, 'crew', catalog).menu, catalog.aliases);
  const rows = boughtRows(buildMenuList(seen, catalog).lines, { ...bought, lines: { ...boughtFromActuals(seen.actuals, catalog, updatedAt), ...bought.lines } });
  return { totals: boughtTotals(rows, bought.done != null), recordedBy: recorders(bought).names };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every outing that has a menu, latest outing first; its menus oldest first. */
export async function listPurchasesWith(sb: SupabaseClient, catalog: Catalog): Promise<PurchaseOuting[]> {
  const stored = (await listLinkedMenusWith(sb)).filter((m) => m.menu.meals.some((x) => x.recipeIds.length > 0));
  if (stored.length === 0) return [];
  const entryIds = [...new Set(stored.map((m) => m.menu.calendarEntryId as number))];
  const [bought, names, entries] = await Promise.all([
    loadBoughtManyWith(sb, stored.map((m) => m.id)),
    ownerCreditNamesWith(sb, stored.map((m) => m.ownerPersonId)),
    sb.from('calendar_entries').select('id, title, entry_date, end_date').in('id', entryIds)
  ]);
  if (entries.error) throw new Error(`purchase outings: ${entries.error.message}`);
  const outings = new Map<number, PurchaseOuting>();
  for (const e of (entries.data ?? []) as { id: number; title: string; entry_date: string; end_date: string | null }[]) {
    outings.set(e.id, { id: e.id, title: e.title, startDate: e.entry_date, endDate: e.end_date, menus: [], planned: 0, paid: 0, projected: false });
  }
  for (const m of stored) {
    const outing = outings.get(m.menu.calendarEntryId as number);
    if (!outing) continue;
    const b = bought.get(m.id) ?? { lines: {}, done: null };
    const p = menuPurchase(m.menu, m.updatedAt, b, catalog);
    outing.menus.push({ id: m.id, label: m.menu.patrol || m.menu.name || 'Untitled menu', name: m.menu.name, planner: names.get(m.ownerPersonId) ?? '', totals: p.totals, done: b.done, recordedBy: p.recordedBy });
    outing.planned = round2(outing.planned + p.totals.planned);
    outing.paid = round2(outing.paid + p.totals.paid);
    outing.projected = outing.projected || p.totals.projected;
  }
  return [...outings.values()].filter((o) => o.menus.length > 0).sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
}

/** Outings that are over (ended before `today`) whose shopping nobody finished recording. */
export function unfinishedPurchases(outings: readonly PurchaseOuting[], today: string): PurchaseOuting[] {
  return outings.filter((o) => (o.endDate ?? o.startDate) < today && o.projected);
}
