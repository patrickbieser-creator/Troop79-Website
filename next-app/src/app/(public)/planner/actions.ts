'use server';

/**
 * Meeting Planner server actions (Plans/Meeting-Planner-II.md). P1 has one: the board's version stamp for the poller,
 * open to anyone who may view the planner, and only for the meeting the planner shows (the next one). P2 adds the
 * writes, each gated by plannerAccess on the server.
 */
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadBoardStamp, loadNextMeeting } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';

export async function plannerStampAction(entryId: number): Promise<{ ok: true; stamp: string } | { ok: false }> {
  if (!plannerAccess(await resolveAdminActor()).canView || !Number.isInteger(entryId)) return { ok: false };
  try {
    const sb = createAdminClient();
    if ((await loadNextMeeting(sb))?.entryId !== entryId) return { ok: false };
    return { ok: true, stamp: await loadBoardStamp(sb, entryId) };
  } catch {
    return { ok: false };
  }
}
