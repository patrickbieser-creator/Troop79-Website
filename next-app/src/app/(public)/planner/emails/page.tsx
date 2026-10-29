/**
 * /planner/emails — the Meeting Planner's Emails screen (Plans/Meeting-Planner-III-Emails.md, E3;
 * prototypes/meeting-plan-III/Emails.dc.html). Every email about a meeting in one place: plan emails to families,
 * teacher invites and "Coming?" reminders, plus the Sent log. Nothing sends until an adult presses Send; each email
 * goes out one at a time and is logged. Adults holding meeting_planner.edit only (Q9), the Sent log included.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerLists } from '@/lib/people-lists';
import { pickMeeting } from '@/lib/build-plan';
import { PLANNER_WEEKS } from '@/lib/this-week';
import { loadEmailScreen } from '@/lib/meeting-email-screen';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { EmailsClient } from './emails-client';
import styles from '../planner.module.css';

export const dynamic = 'force-dynamic';
// One email per Server Action call (lib/meeting-emails), each well inside this.
export const maxDuration = 60;

export const metadata = {
  title: 'Meeting Planner Emails — Scout Troop 79'
};

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ meeting?: string | string[] }> }) {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/emails');
  if (!plannerAccess(actor).canEmail) {
    return (
      <>
        <PageHeader kicker="Meeting Planner" title="Emails" />
        <PageShell width="narrow">
          <Notice tone="info">Emails are for adults who can edit the Meeting Planner. A troop leader can give you that.</Notice>
        </PageShell>
      </>
    );
  }
  const sb = createAdminClient();
  const lists = await loadPlannerLists();
  const meetings = (await loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, lists.meetingLabels)).filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
  const meeting = pickMeeting(meetings, (await searchParams).meeting);
  if (!meeting) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="week" />
        <div className={styles.noticeWrap}>
          <Notice tone="info">There’s no troop meeting on the calendar yet.</Notice>
        </div>
      </div>
    );
  }
  const screen = await loadEmailScreen(sb, meeting, lists, await loadAdvancementCatalog());
  return (
    <div className={styles.page}>
      <PlannerTabs active="week" />
      <div className={styles.noticeWrap}>
        <Link href={`/planner?meeting=${meeting.entryId}`}>← Back to This week</Link>
      </div>
      <EmailsClient key={meeting.entryId} screen={screen} day={fmtDateFull(meeting.date)} />
    </div>
  );
}
