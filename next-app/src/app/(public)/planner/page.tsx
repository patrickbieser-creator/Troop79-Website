/**
 * /planner — the Meeting Planner, This week (Plans/Meeting-Planner-III.md). Reached from the account menu for anyone
 * holding meeting_planner.view, .edit or .seed. Emailed links (reminders, requests) point here.
 *
 * One meeting's plan from its focus: every active scout in a group for the rank they work on (or the Merit badge
 * group), the checklist of what each could work on, the gaps, the teachers, and Live at the meeting as a second view
 * of the same plan (Decision 10). The switcher offers the next PLANNER_WEEKS open meetings (?meeting=<entryId>), the
 * next one by default. Viewers see everything read-only; the planning team (seed) sets the focus and badges; editors
 * place scouts and teachers; adult editors publish (email).
 *
 * B8: once the last meeting is over, editors get "Would you like to update attendance?" under the tabs.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDateFull, fmtDay } from '@/lib/format-date';
import { centralToday, instantToCentral } from '@/lib/dates';
import { loadAttendancePrompt } from '@/lib/meeting-live';
import { loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerLists } from '@/lib/people-lists';
import { loadFocusSets } from '@/lib/meeting-focus-db';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { pickMeeting } from '@/lib/build-plan';
import { buildThisWeek, PLANNER_WEEKS } from '@/lib/this-week';
import { loadFocusNames, loadThisWeekData } from '@/lib/this-week-db';
import { snapshotPayload } from '@/lib/plan-snapshot';
import { loadSnapshotState } from '@/lib/plan-snapshot-db';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { AttendancePrompt } from './attendance-review';
import { PlannerProvider } from './planner-client';
import { PlannerTabs } from './planner-tabs';
import { ThisWeekView } from './this-week-client';
import styles from './planner.module.css';

export const dynamic = 'force-dynamic';
// Server Actions take the page's maxDuration. Reminders and Publish send emails a few at a time and start no new batch
// after 40 s, so their cleanup always runs inside this.
export const maxDuration = 60;

export const metadata = {
  title: 'Meeting Planner — Scout Troop 79'
};

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ meeting?: string | string[] }> }) {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner');
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
  const lists = await loadPlannerLists();
  const [upcoming, prompt] = await Promise.all([
    loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, lists.meetingLabels),
    access.canEdit
      ? loadAttendancePrompt(sb, instantToCentral(new Date().toISOString())).catch((err) => {
          console.error('Attendance prompt failed to load:', err);
          return null;
        })
      : null
  ]);
  const meetings = upcoming.filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
  const meeting = pickMeeting(meetings, (await searchParams).meeting);
  const promptEl = prompt ? <AttendancePrompt key={prompt.entryId} review={prompt} label={fmtDay(prompt.date)} /> : null;
  if (!meeting) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="week" />
        {promptEl}
        <div className={styles.noticeWrap}>
          <Notice tone="info">There’s no troop meeting on the calendar yet. Plans open once one is published.</Notice>
        </div>
      </div>
    );
  }

  const [data, focusNames, sets, presence] = await Promise.all([
    loadThisWeekData(sb, meeting, lists),
    loadFocusNames(sb, meetings.map((m) => m.entryId)),
    loadAdvancementCatalog().then((c) => loadFocusSets(sb, c)),
    sb.from('meeting_live_presence').select('person_id').eq('calendar_entry_id', meeting.entryId).eq('present', true)
  ]);
  const view = buildThisWeek(data.input);
  const snapshot = await loadSnapshotState(
    sb,
    meeting.entryId,
    snapshotPayload(view),
    data.input.scouts.map((s) => s.personId)
  );
  const adults = view.everyone.filter((t) => t.kind === 'adult').map((t) => ({ personId: t.personId, name: t.name }));

  return (
    <PlannerProvider entryId={meeting.entryId} canEdit={access.canEdit} canEmail={access.canEmail} canSeed={access.canSeed} adults={adults} stamp={data.stamp}>
      <div className={styles.page}>
        <PlannerTabs active="week" />
        {promptEl}
        <ThisWeekView
          key={meeting.entryId}
          entryId={meeting.entryId}
          dayLabel={fmtDateFull(meeting.date)}
          title={meeting.title}
          weeks={meetings.map((m) => ({ entryId: m.entryId, dayLabel: fmtDay(m.date), focus: (focusNames.get(m.entryId) ?? []).join(' + '), current: m.entryId === meeting.entryId }))}
          view={view}
          sets={sets.map((x) => ({ id: x.id, name: x.name, labels: x.labels, count: x.items.length, lastUsed: x.lastUsed, mbId: x.mbId ?? null }))}
          badges={data.catalog.meritBadges.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name))}
          stamp={data.stamp}
          canSeed={access.canSeed}
          isToday={meeting.date === centralToday()}
          snapshot={snapshot}
          live={{ present: ((presence.data ?? []) as { person_id: number }[]).map((r) => r.person_id) }}
        />
      </div>
    </PlannerProvider>
  );
}
