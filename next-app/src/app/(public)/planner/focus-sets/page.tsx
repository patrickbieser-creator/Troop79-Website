/**
 * /planner/focus-sets — Focus sets (Plans/Meeting-Planner-II.md Decision 10, P3; prototypes/meeting-plan-II/README.md
 * "Screen 4"). The planning team groups and labels requirements once, then adds a set to one of the next 4 meetings'
 * plans (Build a Plan B4: through Build's own add).
 * Anyone who may view the planner sees the sets and can search, read-only; creating, editing, deleting and seeding
 * are for meeting_planner.seed holders (checked again on the server by every action).
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDay } from '@/lib/format-date';
import { loadUpcomingMeetings } from '@/lib/meeting-board';
import { PLAN_MEETINGS } from '@/lib/build-plan';
import { loadFocusSets, searchCounts } from '@/lib/meeting-focus-db';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { FocusSetsClient } from './focus-sets-client';
import styles from '../planner.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Focus sets — Meeting Planner — Scout Troop 79'
};

export default async function FocusSetsPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/focus-sets');
  const access = plannerAccess(actor);
  if (!access.canView) {
    return (
      <>
        <PageHeader kicker="Members" title="Meeting Planner" />
        <PageShell width="narrow">
          <Notice tone="info">You don’t have access to the Meeting Planner. A troop leader can give it to you.</Notice>
        </PageShell>
      </>
    );
  }

  const sb = createAdminClient();
  const catalog = await loadAdvancementCatalog();
  const [sets, sources, meetings] = await Promise.all([loadFocusSets(sb, catalog), searchCounts(sb, { text: '', kind: 'all' }), loadUpcomingMeetings(sb, 8)]);
  return (
    <div className={styles.page}>
      <PlannerTabs active="focus" />
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Meeting Planner</p>
          <h1 className={styles.title}>Focus sets</h1>
          <p className={styles.sub}>Group requirements once, then seed any meeting with a set.</p>
        </div>
      </header>
      <FocusSetsClient
        canSeed={access.canSeed}
        sets={sets}
        sources={sources}
        meetings={meetings.filter((m) => !m.closed).slice(0, PLAN_MEETINGS).map((m) => ({ entryId: m.entryId, label: fmtDay(m.date) }))}
      />
    </div>
  );
}
