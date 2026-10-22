/**
 * /planner/live — Meeting Live (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8c, 12; P4a). The next meeting's
 * classes by rotation: the board's match as a preview until someone starts Meeting Live, then the saved placement,
 * which is the truth from then on. Anyone who may view the planner sees it; an editor (the SPL included) starts it and
 * (P4b) edits it in place. Any open meeting runs here; a merit badge night is just a meeting (P5a, Decision 10).
 * Phones get one rotation at a time with a switcher. It polls every ~3 s: several leaders run it at once in the room.
 * P4c: here / not here on the meeting day (Central) only. A viewer sees a red banner: they can't record attendance.
 * B8 (D-429): nothing is automatic. Opening Live records nobody (the day-of seed is gone); the taps are a draft, and
 * once the meeting is over an editor approves them through "Would you like to update attendance?". Start asks to
 * confirm for a future meeting.
 */
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDateFull, fmtDay } from '@/lib/format-date';
import { centralToday, instantToCentral } from '@/lib/dates';
import { loadBoardStamp, loadNextMeeting } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadAttendancePrompt, loadLiveChoices, loadLiveView } from '@/lib/meeting-live';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerPoller } from '../planner-poller';
import { PlannerTabs } from '../planner-tabs';
import { AttendancePrompt } from '../attendance-review';
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
  if (!meeting || meeting.closed) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="live" />
        <div className={styles.noticeWrap}>
          <Notice tone="info">{!meeting ? 'There’s no troop meeting on the calendar yet.' : 'No sign-ups this week, so there’s nothing to run.'}</Notice>
        </div>
      </div>
    );
  }

  const today = centralToday();
  const meetingDay = meeting.date === today;
  const attendance = {
    open: meetingDay,
    note: meetingDay ? null : `Attendance opens on ${fmtDay(meeting.date)}.`
  };
  const [view, stamp, choices, prompt] = await Promise.all([
    loadLiveView(sb, meeting),
    loadBoardStamp(sb, meeting.entryId),
    access.canEdit ? loadLiveChoices(sb, meeting) : undefined,
    access.canEdit ? loadPromptQuietly(sb) : null
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
      {prompt ? <AttendancePrompt key={JSON.stringify(prompt)} review={prompt} label={fmtDay(prompt.date)} /> : null}
      <LiveBoard
        view={view}
        canEdit={access.canEdit}
        entryId={meeting.entryId}
        choices={choices}
        attendance={attendance}
        meeting={{ label: fmtDay(meeting.date), future: meeting.date > today }}
      />
    </div>
  );
}

/** The attendance prompt never blocks the page: a failed load is logged and the prompt is left off. */
async function loadPromptQuietly(sb: ReturnType<typeof createAdminClient>) {
  try {
    return await loadAttendancePrompt(sb, instantToCentral(new Date().toISOString()));
  } catch (err) {
    console.error('Attendance prompt failed to load:', err);
    return null;
  }
}
