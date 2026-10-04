/**
 * "What we bought" — the reads and writes (Plans/Menu-Monster-Brands-Gear.md, release 4;
 * 20261009100000_mm_bought.sql). A line is written on its own (mm_set_bought_line merges it atomically), so
 * two scouts entering two receipts never overwrite each other, and nothing here touches the menu's version.
 * Takes a SupabaseClient (always the service role: the mm_* tables have RLS on with zero policies).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeBought, type Bought, type BoughtItem } from './bought';
import { cleanScoutText } from './scout-text';

/** A menu's recorded purchases; empty when the menu is gone. */
export async function loadBoughtWith(sb: SupabaseClient, menuId: string): Promise<Bought> {
  const { data, error } = await sb.from('mm_menus').select('bought').eq('id', menuId).maybeSingle();
  if (error) throw new Error(`bought: ${error.message}`);
  return sanitizeBought(data?.bought);
}

/** Several menus' recorded purchases in one query; a menu with none is absent. */
export async function loadBoughtManyWith(sb: SupabaseClient, menuIds: readonly string[]): Promise<Map<string, Bought>> {
  const out = new Map<string, Bought>();
  // 100 ids a query keeps the URL short; the table is small.
  for (let i = 0; i < menuIds.length; i += 100) {
    const { data, error } = await sb.from('mm_menus').select('id, bought').in('id', menuIds.slice(i, i + 100));
    if (error) throw new Error(`bought: ${error.message}`);
    for (const r of (data ?? []) as { id: string; bought: unknown }[]) out.set(r.id, sanitizeBought(r.bought));
  }
  return out;
}

export interface Recorder {
  personId: number | null;
  name: string;
}

/** One line set (bought with items, or not bought) or cleared (null). False when the menu is gone or the payload is refused. */
export async function setBoughtLineWith(
  sb: SupabaseClient,
  menuId: string,
  ingredientId: string,
  line: { status: 'bought'; items: BoughtItem[] } | { status: 'not_bought' } | null,
  who: Recorder
): Promise<boolean> {
  const stamp = { by: cleanScoutText(who.name, 60), personId: who.personId, at: new Date().toISOString() };
  const payload = line == null ? null : line.status === 'not_bought' ? { status: 'not_bought', items: [], ...stamp } : { status: 'bought', items: line.items, ...stamp };
  const { data, error } = await sb.rpc('mm_set_bought_line', { p_menu: menuId, p_ingredient: ingredientId, p_line: payload });
  if (error) {
    if (error.message.includes('MM_BAD_BOUGHT')) return false;
    throw new Error(`set bought line: ${error.message}`);
  }
  return data === true;
}

/** "We're done shopping", on or off. False when the menu is gone. */
export async function setShoppingDoneWith(sb: SupabaseClient, menuId: string, done: boolean, who: Recorder): Promise<boolean> {
  const { data, error } = await sb.rpc('mm_set_shopping_done', { p_menu: menuId, p_done: done, p_person: who.personId, p_label: cleanScoutText(who.name, 60) });
  if (error) throw new Error(`shopping done: ${error.message}`);
  return data === true;
}
