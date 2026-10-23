/**
 * /admin/advancement/has-needs — retired (Build a Plan B7; Patrick approved the planner tab 2026-10-23). The tool lives
 * at /planner/has-needs, so old links and bookmarks land there. A leader without planner rights couldn't open it, so
 * they land on Admin's Home instead, with no error.
 */
import { permanentRedirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { plannerAccess } from '@/lib/meeting-planner-access';

export default async function HasNeedsPage() {
  const actor = await resolveAdminActor();
  permanentRedirect(plannerAccess(actor).canView ? '/planner/has-needs' : '/admin');
}
