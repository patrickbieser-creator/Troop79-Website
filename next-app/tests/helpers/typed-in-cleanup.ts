import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Removes the typed-in ingredients (x- ids) that the db tests created -- and nothing else. Production mints real
 * scouts' typed-ins with the same x- prefix (and may give them sp- packages), so a bare `like 'x-%'` sweep is
 * unsafe once production data is synced to local: one real package blocks the whole delete (ON DELETE RESTRICT)
 * and every fixture row survives. A test row is one that is owned by the test scout, is named like a fixture
 * ('Vitest …' / 'cap …'), or has a fixture id (x-0000aa…). Deletion is always by explicit id list, in FK order.
 */
export const TEST_SCOUT = 39;

export async function testTypedInIds(admin: SupabaseClient, extraIds: string[] = []): Promise<string[]> {
  const { data } = await admin
    .from('mm_ingredients')
    .select('id')
    .like('id', 'x-%')
    .or(`added_by_person_id.eq.${TEST_SCOUT},name.ilike.Vitest%,name.ilike.cap %,id.like.x-0000aa%`);
  return [...new Set([...((data ?? []) as { id: string }[]).map((r) => r.id), ...extraIds])];
}

export async function cleanupTypedIns(admin: SupabaseClient, extraIds: string[] = []): Promise<string[]> {
  const ids = await testTypedInIds(admin, extraIds);
  if (!ids.length) return ids;
  await admin.from('mm_recipe_lines').delete().in('ingredient_id', ids);
  await admin.from('mm_variation_lines').delete().in('ingredient_id', ids);
  await admin.from('mm_variation_lines').delete().in('base_ingredient_id', ids);
  await admin.from('mm_packages').delete().in('ingredient_id', ids);
  await admin.from('mm_brands').delete().in('ingredient_id', ids);
  await admin.from('mm_conversions').delete().in('ingredient_id', ids);
  await admin.from('mm_ingredients').update({ merged_into_id: null }).in('id', ids);
  await admin.from('mm_ingredients').update({ merged_into_id: null }).in('merged_into_id', ids);
  await admin.from('mm_ingredients').delete().in('id', ids);
  return ids;
}
