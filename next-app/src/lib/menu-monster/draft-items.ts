/**
 * Menu Monster — the troop's DRAFT items, by name (Patrick, 2026-10-06: "Cookies" did not appear in a meal's
 * search and nothing said why). The planner lists published items only; the meal panel's no-match line uses this
 * short list to say "Cookies is a draft in the troop's list — a leader can publish it". Names, ids and meal fit
 * only — never lines, prices or a scout's draft (those are their author's alone).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MealSlot } from './types';

export interface DraftItem {
  id: string;
  name: string;
  mealFit: MealSlot[];
}

/** The troop's own drafts (no author), A to Z. */
export async function listDraftItemsWith(sb: SupabaseClient): Promise<DraftItem[]> {
  const { data, error } = await sb.from('mm_recipes').select('id, name, meal_fit').eq('status', 'draft').is('author_person_id', null).order('name').limit(500);
  if (error) throw new Error(`draft items: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, mealFit: (r.meal_fit ?? []) as MealSlot[] }));
}

/** The drafts a search for `query` in a `slot` meal would have listed had they been published: at most three, A to Z. */
export function draftsMatching(drafts: readonly DraftItem[], query: string, slot: MealSlot): DraftItem[] {
  const term = query.trim().toLowerCase();
  if (term === '') return [];
  return drafts
    .filter((d) => d.mealFit.includes(slot) && d.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 3);
}
