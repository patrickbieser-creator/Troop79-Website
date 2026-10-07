/**
 * Menu Monster leader tools — deleting a troop recipe (Patrick, 2026-10-06). The database function
 * mm_delete_recipe does the check and the delete under one lock; this wraps it and counts the saved
 * menus that still use a recipe, for the dialog at the foot of the recipe page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';

export interface MenusUsing {
  count: number;
  /** Up to three menu names, A–Z. */
  names: string[];
}

interface MenuMealsRow {
  name: string;
  meals: { recipeIds?: string[] }[] | null;
}

/** The saved menus whose meals still list this recipe. */
export async function menusUsingRecipeWith(sb: SupabaseClient, recipeId: string): Promise<MenusUsing> {
  const all = await fetchAllRows<MenuMealsRow>((from, to) => sb.from('mm_menus').select('name, meals').order('id').range(from, to));
  const using = all.filter((m) => (m.meals ?? []).some((meal) => meal.recipeIds?.includes(recipeId))).map((m) => m.name);
  return { count: using.length, names: using.sort((a, b) => a.localeCompare(b)).slice(0, 3) };
}

export type DeleteRecipeResult = 'ok' | 'gone' | 'tied' | 'scout' | 'on_menu';

export async function deleteRecipeWith(sb: SupabaseClient, id: string): Promise<DeleteRecipeResult> {
  const { data, error } = await sb.rpc('mm_delete_recipe', { p_id: id });
  if (error) throw new Error(`delete recipe: ${error.message}`);
  return data as DeleteRecipeResult;
}
