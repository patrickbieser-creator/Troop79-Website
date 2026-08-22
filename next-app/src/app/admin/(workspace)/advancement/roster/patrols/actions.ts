'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { diffAssignments, type PatrolDraft, type PatrolScout } from '@/lib/patrol-assign';

/**
 * Save a whole screen of patrol changes at once.
 *
 * THE DRAFT IS NOT TRUSTED. It arrives from a browser as a scout-id → patrol
 * map, and the only thing that reaches the database is what diffAssignments()
 * produces after re-reading the roster server-side: unknown ids, inactive
 * scouts and no-op values are all dropped there, not here. That also means a
 * tab left open while someone else edited the roster cannot resurrect a stale
 * value for a scout it no longer knows about.
 */

interface Result {
  ok: boolean;
  error?: string;
  /** How many rows actually changed — the screen reports it back. */
  changed?: number;
}

const SCOUT_COLS = 'id, display_name, patrol, current_rank, graduation_year, active';

export async function savePatrolAssignments(draft: PatrolDraft): Promise<Result> {
  try {
    await requireCapability('roster.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }

  const supabase = createAdminClient();
  let scouts: PatrolScout[];
  try {
    scouts = await fetchAllRows<PatrolScout>((f, t) =>
      supabase.from('scouts').select(SCOUT_COLS).range(f, t)
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the roster' };
  }

  const changes = diffAssignments(scouts, draft);
  if (changes.length === 0) return { ok: true, changed: 0 };

  /*
   * One UPDATE per changed scout rather than an upsert of the whole set.
   * `scouts` rows carry far more than a patrol — an upsert would need every
   * column and would happily blank anything omitted. At troop scale this is a
   * few dozen tiny writes, which is not worth trading correctness for.
   */
  for (const change of changes) {
    const { error } = await supabase
      .from('scouts')
      .update({ patrol: change.to })
      .eq('id', change.id);
    if (error) return { ok: false, error: error.message };
  }

  // Every surface that shows a patrol: the roster, this screen, the printable
  // family roster's Patrols page, the public advancement table and its filter,
  // the meeting plan (which splits cohorts by patrol), and scout pages.
  revalidatePath('/admin/advancement/roster');
  revalidatePath('/admin/advancement/roster/patrols');
  revalidatePath('/admin/roster-print');
  revalidatePath('/admin/advancement/meeting-plan');
  revalidatePath('/advancement');
  revalidatePath('/', 'layout');

  return { ok: true, changed: changes.length };
}
