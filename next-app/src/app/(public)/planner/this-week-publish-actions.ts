'use server';

/**
 * Publish snapshot (Plans/Meeting-Planner-III.md, Decision 5): adults holding meeting_planner.edit, on one of the next
 * meetings. Email is adults only (Decision 5 of Planner II): a scout editor, the SPL included, is refused before
 * anything is written. The plan is rebuilt here from the database, never taken from the client.
 */
import { loadBoardScouts, loadBoardStamp } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { plannerSeeder } from '@/lib/meeting-planner-seeder';
import { resolveAdminActor } from '@/lib/admin-actor';
import { loadPlannerLists } from '@/lib/people-lists';
import { buildThisWeek, PLANNER_WEEKS } from '@/lib/this-week';
import { loadThisWeekData } from '@/lib/this-week-db';
import { publishPlan } from '@/lib/plan-publish';
import { revokePlanPages } from '@/lib/plan-pages';

export type PublishResult = { ok: true; message: string; stamp: string } | { ok: false; error: string };

export async function twPublishAction(input: { entryId: number; everyone: boolean }): Promise<PublishResult> {
  if (typeof input?.everyone !== 'boolean') return { ok: false, error: 'Malformed request' };
  if (!plannerAccess(await resolveAdminActor()).canEmail) return { ok: false, error: 'Only adults with the edit right send email.' };
  const s = await plannerSeeder(input.entryId, { within: PLANNER_WEEKS, right: 'edit' });
  if (!s.ok) return s;
  try {
    const lists = await loadPlannerLists();
    const data = await loadThisWeekData(s.sb, s.meeting, lists);
    const view = buildThisWeek(data.input);
    const scouts = await loadBoardScouts(s.sb);
    const res = await publishPlan(s.sb, { meeting: s.meeting, view, scouts, actorPersonId: s.actorPersonId, everyone: input.everyone });
    if (!res.ok) return res;
    const not = res.skipped.length ? ` Not sent: ${res.skipped.map((x) => `${x.name} (${x.reason})`).join('; ')}.` : '';
    return { ok: true, message: `Snapshot ${res.n} published: ${res.emailed} email${res.emailed === 1 ? '' : 's'} sent.${not}`, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
  } catch (e) {
    console.error('publish failed:', e);
    return { ok: false, error: 'Publishing didn’t finish. Try again.' };
  }
}

/** Cancel a publish: every family link for this meeting closes. The snapshots stay as history. */
export async function twRevokeLinksAction(input: { entryId: number }): Promise<PublishResult> {
  if (!plannerAccess(await resolveAdminActor()).canEmail) return { ok: false, error: 'Only adults with the edit right can do that.' };
  const s = await plannerSeeder(input?.entryId, { within: PLANNER_WEEKS, right: 'edit' });
  if (!s.ok) return s;
  const n = await revokePlanPages(s.sb, s.meeting.entryId);
  return { ok: true, message: `${n} family link${n === 1 ? '' : 's'} closed.`, stamp: await loadBoardStamp(s.sb, s.meeting.entryId) };
}
