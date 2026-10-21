/**
 * /planner/live — Meeting Live (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8c, 12; P4a). The next meeting's
 * classes by rotation: the board's match as a preview until someone starts Meeting Live, then the saved placement,
 * which is the truth from then on. Anyone who may view the planner sees it; an editor (the SPL included) starts it and
 * (P4b) edits it in place. Rank meetings only: a meeting set up in Admin as a merit badge night keeps v1's stations.
 * Phones get one rotation at a time with a switcher. It polls every ~3 s: several leaders run it at once in the room.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardStamp, loadNextMeeting } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadLiveChoices, loadLiveView } from '@/lib/meeting-live';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerPoller } from '../planner-poller';
import { PlannerTabs } from '../planner-tabs';
import { LiveBoard } from './live-board';
import styles from '../planner.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Meeting Live — Meeting Planner — Scout Troop 79'
};

export default async function MeetingLivePage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/live');
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
  const meeting = await loadNextMeeting(sb);
  if (!meeting || meeting.mode !== 'rank') {
    return (
      <div className={styles.page}>
        <PlannerTabs active="live" />
        <div className={styles.noticeWrap}>
          <Notice tone="info">{!meeting
              ? 'There’s no troop meeting on the calendar yet.'
              : meeting.mode === 'closed'
                ? 'No sign-ups this week, so there’s nothing to run.'
                : 'This meeting is set up as a merit badge night in Admin, which runs from its stations.'}</Notice>
        </div>
      </div>
    );
  }

  const [view, stamp, choices] = await Promise.all([
    loadLiveView(sb, meeting),
    loadBoardStamp(sb, meeting.entryId),
    access.canEdit ? loadLiveChoices(sb, meeting) : undefined
  ]);
  return (
    <div className={styles.page}>
      <PlannerTabs active="live" />
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Meeting Planner</p>
          <h1 className={styles.title}>{fmtDateFull(meeting.date)} · Rotations</h1>
          <p className={styles.sub}>
            <PlannerPoller entryId={meeting.entryId} stamp={stamp} pollMs={3_000} jitterMs={1_000} />
          </p>
        </div>
      </header>
      <LiveBoard view={view} canEdit={access.canEdit} entryId={meeting.entryId} choices={choices} />
    </div>
  );
}
