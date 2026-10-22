/**
 * /admin/advancement/meeting-plan — retired (Build a Plan B4, Decision 3; B5). Admin's generator (Generate Plan / Group
 * Sessions), Publish to Site and, since B5, By Scout and Teaching Roster all live in Build a Plan's Suggestions mode,
 * so old links and bookmarks land there. A leader without planner rights couldn't open it, so they land on Admin's
 * Home instead, with no error.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { plannerAccess } from '@/lib/meeting-planner-access';

export default async function MeetingPlanPage() {
  const actor = await resolveAdminActor();
  redirect(plannerAccess(actor).canView ? '/planner/build?view=suggestions' : '/admin');
}
