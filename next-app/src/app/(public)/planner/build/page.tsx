/**
 * /planner/build — Build a Plan, the planner's first tab (Plans/Build-A-Plan.md, B1). One meeting's plan: every class
 * the board counts on it (seeded, scout-picked, teacher-offered), a one-line summary rail, and the engine's
 * suggestions for that date to Add from.
 *
 * Gated like /planner: any planner right sees the plan read-only; the planning team (meeting_planner.seed) adds and
 * removes (checked again by every action). The switcher offers the next 4 published, open troop meetings, the next
 * one by default; the choice lives in the URL (?meeting=<entryId>). Suggestions stream behind Suspense so the plan
 * never waits for the engine (it reads the whole ledger); viewers don't load them.
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDate, fmtDay } from '@/lib/format-date';
import { loadUpcomingMeetings, type BoardMeeting } from '@/lib/meeting-board';
import { boardName } from '@/lib/meeting-board-shared';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerPage } from '@/lib/meeting-planner-load';
import { loadPlannerLists } from '@/lib/people-lists';
import { loadEngineInput } from '@/lib/meeting-suggest/load-input';
import { buildMeetingPlan } from '@/lib/meeting-suggest/engine';
import { pickMeeting, planRows, PLAN_MEETINGS, rankSuggestions, SUGGESTION_LIMIT } from '@/lib/build-plan';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { BuildPlanView, SuggestionsFeed } from './build-client';
import styles from '../planner.module.css';
import s from './build.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Build a Plan — Meeting Planner — Scout Troop 79'
};

/** The engine's suggestions for one meeting, minus what is on the plan (a few spare, so an Add still leaves 8). */
async function Suggested({ meeting, onPlan }: { meeting: BoardMeeting; onPlan: string[] }) {
  return <SuggestionsFeed list={await suggestionsFor(meeting, onPlan)} />;
}

/**
 * The engine's ranked suggestions for one meeting, cached for two minutes (qa-lead, 2026-10-22): the engine reads the
 * whole ledger, and every poller refresh (someone's pick, someone's answer) re-renders this page. A short TTL is the
 * simpler of the two options (the other: recompute only on refreshes a seed change caused); suggestions are advice,
 * and what is already on the plan is filtered out per render, so an Add never shows its own suggestion again.
 * JSON-only values (an array of plain objects). Null (the engine refused) is not cached.
 */
const CACHE_TOP = 40;
const rankedFor = unstable_cache(
  async (date: string, title: string) => {
    const res = await loadEngineInput(date, title);
    if (!res.ok) throw new Error('engine input');
    return rankSuggestions(buildMeetingPlan(res.input), new Set(), CACHE_TOP).map((x) => ({ ...x, bestTeacher: x.bestTeacher ? boardName(x.bestTeacher) : null }));
  },
  ['build-plan-suggestions'],
  { revalidate: 120 }
);

async function suggestionsFor(meeting: BoardMeeting, onPlan: string[]) {
  try {
    const on = new Set(onPlan);
    return (await rankedFor(meeting.date, meeting.title)).filter((x) => !on.has(x.key)).slice(0, SUGGESTION_LIMIT * 2);
  } catch {
    return null;
  }
}

export default async function BuildPlanPage({ searchParams }: { searchParams: Promise<{ meeting?: string | string[] }> }) {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/build');
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
  const meetings = (await loadUpcomingMeetings(sb, PLAN_MEETINGS * 2, undefined, lists.meetingLabels)).filter((m) => !m.closed).slice(0, PLAN_MEETINGS);
  const meeting = pickMeeting(meetings, (await searchParams).meeting);
  if (!meeting) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="build" />
        <div className={styles.noticeWrap}>
          <Notice tone="info">There’s no troop meeting on the calendar yet. Plans open once one is published.</Notice>
        </div>
      </div>
    );
  }

  const page = await loadPlannerPage(sb, meeting, lists);
  if (!page) return null;
  const rows = planRows(page.board);
  const heading = (
    <header className={styles.head}>
      <div>
        <p className={styles.kicker}>Meeting Planner</p>
        <h1 className={styles.title}>
          {page.meeting.dateLabel} · {page.meeting.title}
        </h1>
        <ul className={s.switcher} aria-label="Meeting">
          {meetings.map((m) => (
            <li key={m.entryId}>
              <Link href={`/planner/build?meeting=${m.entryId}`} className={m.entryId === meeting.entryId ? s.meetingOn : s.meetingLink} aria-current={m.entryId === meeting.entryId ? 'page' : undefined}>
                {fmtDay(m.date)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
  return (
    <div className={styles.page}>
      <PlannerTabs active="build" />
      <BuildPlanView
        key={meeting.entryId}
        entryId={meeting.entryId}
        rows={rows}
        canSeed={access.canSeed}
        canEdit={access.canEdit}
        dayLabel={fmtDate(meeting.date, { year: false })}
        stamp={page.stamp}
        heading={heading}
        feed={
          access.canSeed ? (
            <Suspense fallback={null}>
              <Suggested meeting={meeting} onPlan={rows.map((r) => r.key)} />
            </Suspense>
          ) : undefined
        }
      />
    </div>
  );
}
