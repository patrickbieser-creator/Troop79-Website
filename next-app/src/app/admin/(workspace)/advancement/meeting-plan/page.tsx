/**
 * /admin/advancement/meeting-plan — retired (Build a Plan B4, Decision 3). Admin's generator (Generate Plan / Group
 * Sessions) and Publish to Site are gone: Build a Plan is the plan of record and its Suggested column is the
 * generator, so old links and bookmarks land there. By Scout and Teaching Roster live on at ./by-scout, which is
 * where a leader without planner rights lands (they couldn't open Build).
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { plannerAccess } from '@/lib/meeting-planner-access';

export default async function MeetingPlanPage() {
  const actor = await resolveAdminActor();
  redirect(plannerAccess(actor).canView ? '/planner/build' : '/admin/advancement/meeting-plan/by-scout');
}
