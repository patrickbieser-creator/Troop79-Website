/**
 * /planner — the Meeting Planner, This week (Plans/Meeting-Planner-III.md). Reached from the account menu for anyone
 * holding meeting_planner.view, .edit or .seed. Emailed links (reminders, requests) point here.
 *
 * One meeting's plan from its focus: every active scout in a group for the rank they work on (or the Merit badge
 * group), the checklist of what each could work on, the gaps, the teachers, and Live at the meeting as a second view
 * of the same plan (Decision 10). The switcher offers the next PLANNER_WEEKS open meetings (?meeting=<entryId>), the
 * next one by default. Viewers see everything read-only; the planning team (seed) sets the focus and badges; editors
 * place scouts and teachers; adult editors send email from the Emails screen (/planner/emails).
 *
 * B8: once the last meeting is over, editors get "Would you like to update attendance?" under the tabs.
 *
 * Past meetings (2026-11-09): ?meeting=<a past entryId> opens that meeting VIEW ONLY for everyone, as it stood that
 * night (ranks and advancement from ledger rows dated before it), with "What happened" (roll call, sign-offs that
 * day) below. "Earlier weeks" on This week opens the latest one. Print PDF (/planner/print/<id>) works for any.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDateFull, fmtDay } from '@/lib/format-date';
import { centralToday, instantToCentral } from '@/lib/dates';
import { loadAttendancePrompt } from '@/lib/meeting-live';
import { loadUpcomingMeetings, type BoardMeeting } from '@/lib/meeting-board';
import { loadHappenedRows, loadPastMeetings } from '@/lib/past-meeting-db';
import { buildHappened, pastWeekPage, plannedKeyTest } from '@/lib/past-meeting';
import { topicWords } from '@/lib/meeting-board-picklist';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerLists, type PlannerLists } from '@/lib/people-lists';
import { loadFocusSets } from '@/lib/meeting-focus-db';
import { listSavedPlans } from '@/lib/saved-plans';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { pickMeeting } from '@/lib/build-plan';
import { buildThisWeek, PLANNER_WEEKS } from '@/lib/this-week';
import { loadFocusNames, loadThisWeekData } from '@/lib/this-week-db';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { AttendancePrompt } from './attendance-review';
import { PlannerProvider } from './planner-client';
import { PlannerTabs } from './planner-tabs';
import { ThisWeekView } from './this-week-client';
import { PastHappened } from './past-happened';
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
  const today = centralToday();
  const [upcoming, pastMeetings, prompt] = await Promise.all([
    loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, lists.meetingLabels),
    loadPastMeetings(sb, today, lists.meetingLabels),
    access.canEdit
      ? loadAttendancePrompt(sb, instantToCentral(new Date().toISOString())).catch((err) => {
          console.error('Attendance prompt failed to load:', err);
          return null;
        })
      : null
  ]);
  const meetings = upcoming.filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
  const wanted = (await searchParams).meeting;
  const pastMeeting = pastMeetings.find((m) => m.entryId === Number(Array.isArray(wanted) ? wanted[0] : wanted));
  if (pastMeeting) return <PastMeetingPage sb={sb} meeting={pastMeeting} past={pastMeetings} lists={lists} canEmail={access.canEmail} />;
  const meeting = pickMeeting(meetings, wanted);
  const promptEl = prompt ? <AttendancePrompt key={prompt.entryId} review={prompt} label={fmtDay(prompt.date)} /> : null;
  if (!meeting) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="week" canEmail={access.canEmail} />
        {promptEl}
        <div className={styles.noticeWrap}>
          <Notice tone="info">There’s no troop meeting on the calendar yet. Plans open once one is published.</Notice>
        </div>
      </div>
    );
  }

  const [data, focusNames, sets, presence, savedPlans] = await Promise.all([
    loadThisWeekData(sb, meeting, lists),
    loadFocusNames(sb, meetings.map((m) => m.entryId)),
    loadAdvancementCatalog().then((c) => loadFocusSets(sb, c)),
    sb.from('meeting_live_presence').select('person_id').eq('calendar_entry_id', meeting.entryId).eq('present', true),
    // Saved meeting plans are the planning team's: nobody else's page reads them.
    access.canSeed ? listSavedPlans(sb) : Promise.resolve([])
  ]);
  const view = buildThisWeek(data.input);
  const adults = view.everyone.filter((t) => t.kind === 'adult').map((t) => ({ personId: t.personId, name: t.name }));

  return (
    <PlannerProvider entryId={meeting.entryId} canEdit={access.canEdit} canEmail={access.canEmail} canSeed={access.canSeed} adults={adults} stamp={data.stamp}>
      <div className={styles.page}>
        <PlannerTabs active="week" canEmail={access.canEmail} />
        {promptEl}
        <ThisWeekView
          key={meeting.entryId}
          entryId={meeting.entryId}
          dayLabel={fmtDateFull(meeting.date)}
          title={meeting.title}
          weeks={meetings.map((m) => ({ entryId: m.entryId, dayLabel: fmtDay(m.date), planned: (focusNames.get(m.entryId) ?? []).length > 0, current: m.entryId === meeting.entryId }))}
          view={view}
          sets={sets.map((x) => ({ id: x.id, name: x.name, labels: x.labels, count: x.items.length, lastUsed: x.lastUsed, mbId: x.mbId ?? null }))}
          badges={data.catalog.meritBadges.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name))}
          stamp={data.stamp}
          canSeed={access.canSeed}
          isToday={meeting.date === centralToday()}
          live={{ present: ((presence.data ?? []) as { person_id: number }[]).map((r) => r.person_id) }}
          meetingDate={meeting.date}
          savedPlans={savedPlans}
          earlierHref={pastMeetings[0] ? `/planner?meeting=${pastMeetings[0].entryId}` : null}
        />
      </div>
    </PlannerProvider>
  );
}

/** A past meeting, view only: the plan as it stood that night, then what happened. */
async function PastMeetingPage({
  sb,
  meeting,
  past,
  lists,
  canEmail
}: {
  sb: ReturnType<typeof createAdminClient>;
  meeting: BoardMeeting;
  past: readonly BoardMeeting[];
  lists: PlannerLists;
  canEmail: boolean;
}) {
  const page = pastWeekPage(past, meeting.entryId)!;
  const [data, focusNames, rows] = await Promise.all([
    loadThisWeekData(sb, meeting, lists, undefined, { asOfMeeting: true }),
    loadFocusNames(sb, page.weeks.map((m) => m.entryId)),
    loadHappenedRows(sb, meeting)
  ]);
  const view = buildThisWeek(data.input);
  const { catalog, input } = data;
  const more = { mbReqs: catalog.meritBadgeRequirements };
  const words = (key: string) => {
    const w = topicWords(key, catalog.ranks, catalog.rankRequirements, catalog.meritBadges, input.titles, more);
    return w ? (w.codeLabel ? `${w.codeLabel} ${w.label}` : w.label) : key;
  };
  const rankName = new Map(catalog.ranks.map((r) => [r.id, r.display_name]));
  const mbName = new Map(catalog.meritBadges.map((m) => [m.id, m.name]));
  const happened = buildHappened({
    ...rows,
    scoutPersonIds: new Set(lists.pool.scouts.map((x) => x.person_id)),
    personNames: new Map(lists.pool.people.map((p) => [p.id, p.display_name])),
    scoutNames: new Map(lists.pool.scouts.map((x) => [x.id, x.display_name])),
    planned: plannedKeyTest(input),
    words,
    awardWords: (code, kind) => (kind === 'rank_award' ? (rankName.get(code) ?? code) : `${mbName.get(code.slice(3)) ?? code.slice(3)} merit badge`)
  });
  const href = (id: number | null) => (id == null ? null : `/planner?meeting=${id}`);
  return (
    <PlannerProvider entryId={meeting.entryId} canEdit={false} canEmail={false} canSeed={false} adults={[]} stamp={data.stamp}>
      <div className={styles.page}>
        <PlannerTabs active="week" canEmail={canEmail} />
        <ThisWeekView
          key={meeting.entryId}
          entryId={meeting.entryId}
          dayLabel={fmtDateFull(meeting.date)}
          title={meeting.title}
          weeks={page.weeks.map((m) => ({ entryId: m.entryId, dayLabel: fmtDay(m.date), planned: (focusNames.get(m.entryId) ?? []).length > 0, current: m.entryId === meeting.entryId }))}
          view={view}
          sets={[]}
          badges={[]}
          stamp={data.stamp}
          canSeed={false}
          isToday={false}
          live={{ present: [] }}
          meetingDate={meeting.date}
          savedPlans={[]}
          past={{ olderHref: href(page.olderId), newerHref: href(page.newerId) }}
        />
        <PastHappened happened={happened} dateLabel={fmtDay(meeting.date)} />
      </div>
    </PlannerProvider>
  );
}
