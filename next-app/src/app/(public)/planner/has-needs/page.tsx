/**
 * /planner/has-needs — Has/Needs, the planner's last tab (Plans/Build-A-Plan.md, B7): "who is where on this?". Pick
 * requirements from the four lower ranks or any merit badge; the active scouts split into Has · Needs · Partial. The
 * selection lives in the URL (?pick=<key>,<key>), so a view can be shared.
 *
 * Gated like the other planner tabs: anyone with planner View sees it (Patrick). A seed holder also gets the add hook
 * (one requirement → "Add <code> to <meeting> plan", Build a Plan's own action, checked again on the server).
 *
 * One load (lib/has-needs-db): the cached catalog, the active scouts, the ledger and awarded badges, and for a seed
 * holder the next meetings and what is on their plans. The split runs on the client, so ticking costs no round trip.
 * Admin's /admin/advancement/has-needs stays until Patrick approves this page.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format-date';
import { loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerLists } from '@/lib/people-lists';
import { PLAN_MEETINGS } from '@/lib/build-plan';
import { loadHasNeedsPage, type HasNeedsPage } from '@/lib/has-needs-db';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { HasNeedsView } from './has-needs-client';
import styles from '../planner.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Has/Needs — Meeting Planner — Scout Troop 79'
};

export default async function HasNeedsPlannerPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/has-needs');
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
  let data: HasNeedsPage | null = null;
  try {
    data = await loadHasNeedsPage(sb, {
      canSeed: access.canSeed,
      loadMeetings: async () => {
        const lists = await loadPlannerLists();
        return (await loadUpcomingMeetings(sb, PLAN_MEETINGS * 2, undefined, lists.meetingLabels))
          .filter((m) => !m.closed)
          .slice(0, PLAN_MEETINGS)
          .map((m) => ({ entryId: m.entryId, date: m.date }));
      }
    });
  } catch {
    data = null;
  }

  return (
    <div className={styles.page}>
      <PlannerTabs active="hasneeds" />
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Meeting Planner</p>
          <h1 className={styles.title}>Who has it, who needs it</h1>
        </div>
      </header>
      {data ? (
        <HasNeedsView
          ranks={data.ranks}
          badges={data.badges}
          scouts={data.scouts}
          allRanks={data.allRanks}
          meetings={data.meetings.map((m) => ({ entryId: m.entryId, label: fmtDate(m.date, { year: false }) }))}
          onPlan={data.onPlan}
          canSeed={access.canSeed}
        />
      ) : (
        <div className={styles.noticeWrap}>
          <Notice tone="error">Has/Needs didn’t load. Refresh the page to try again.</Notice>
        </div>
      )}
    </div>
  );
}
