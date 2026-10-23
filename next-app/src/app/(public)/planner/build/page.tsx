/**
 * /planner/build — Build a Plan, the planner's first tab (Plans/Build-A-Plan.md, B1). One meeting's plan: every class
 * the board counts on it (seeded, scout-picked, teacher-offered), a one-line summary rail, and the engine's
 * suggestions for that date to Add from.
 *
 * Gated like /planner: any planner right sees the plan read-only; the planning team (meeting_planner.seed) adds and
 * removes (checked again by every action). The switcher offers the next 4 published, open troop meetings, the next
 * one by default; the choice lives in the URL (?meeting=<entryId>).
 *
 * ?view= is the sub-view (lib/build-plan-view): suggestions, or (seed holders) add-requirement | add-set | new-mix.
 * B5: ?view=suggestions is Suggestions mode (every viewer; read-only without the Seed right). Entering it costs the
 * plan rows plus ONE engine read (cached two minutes), streamed behind Suspense so the plan rail never waits for the
 * ledger. B9: the plan view streams the orphan count from that same cached engine read plus one scoutCandidatesMany.
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDate, fmtDay } from '@/lib/format-date';
import { loadUpcomingMeetings, type BoardMeeting } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerPage } from '@/lib/meeting-planner-load';
import { loadPlannerLists } from '@/lib/people-lists';
import { loadSuggestionsData } from '@/lib/build-plan-suggest-db';
import { pickMeeting, planRows, PLAN_MEETINGS } from '@/lib/build-plan';
import { parseBuildView } from '@/lib/build-plan-view';
import { loadLikelyScouts } from '@/lib/meeting-invite-digest-db';
import { loadOrphans } from '@/lib/build-plan-orphans-db';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { BuildPlanView, LikelyFeed, OrphansFeed, SuggestionsFeed } from './build-client';
import styles from '../planner.module.css';
import s from './build.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Build a Plan — Meeting Planner — Scout Troop 79'
};

/**
 * Each row's likely scouts (the "Likely: …" line), streamed so the plan never waits for them: one scoutCandidatesMany
 * for every row nobody signed up for yet. A failure shows no line rather than an error.
 */
async function Likely({ entryId, keys }: { entryId: number; keys: string[] }) {
  const byKey = await loadLikelyScouts(createAdminClient(), entryId, keys).catch(() => null);
  return <LikelyFeed byKey={byKey} />;
}

/**
 * Suggestions mode's one read (B5): the engine run shaped for every lens, cached for two minutes per meeting
 * (qa-lead, 2026-10-22): the engine reads the whole ledger, and every poller refresh (someone's pick, someone's
 * answer) re-renders this page. Suggestions are advice; what is on the plan is the client's own rows, so an Add shows
 * On plan at once. JSON-only values. A failure (the engine refused) is not cached.
 */
const suggestionsCached = unstable_cache(async (date: string, title: string) => loadSuggestionsData(date, title), ['build-plan-suggestions-b9-reasons'], { revalidate: 120 });

/**
 * B9: "N scouts have nothing on this plan", streamed so the plan never waits for it: the cached engine read (shared with
 * Suggestions mode) plus ONE scoutCandidatesMany over the plan's and the suggestions' keys. A failure shows nothing.
 */
async function Orphans({ meeting, keys }: { meeting: BoardMeeting; keys: string[] }) {
  const data = await suggestionsCached(meeting.date, meeting.title)
    .then((sug) => loadOrphans(createAdminClient(), meeting.entryId, keys, sug))
    .catch(() => null);
  return <OrphansFeed data={data} />;
}

/** Streams the one engine read into the workspace; null (it failed) says so there. */
async function Suggestions({ meeting }: { meeting: BoardMeeting }) {
  const data = await suggestionsCached(meeting.date, meeting.title).catch(() => null);
  return <SuggestionsFeed data={data} />;
}

export default async function BuildPlanPage({ searchParams }: { searchParams: Promise<{ meeting?: string | string[]; view?: string | string[] }> }) {
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
  const params = await searchParams;
  const meeting = pickMeeting(meetings, params.meeting);
  const view = parseBuildView(params.view, access.canSeed);
  const suggesting = view === 'suggestions';
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
  const hrefOf = (entryId: number, suggestions = suggesting) => `/planner/build?meeting=${entryId}${suggestions ? '&view=suggestions' : ''}`;
  const switcher = (
    <ul className={s.switcher} aria-label="Meeting">
      {meetings.map((m) => (
        <li key={m.entryId}>
          <Link href={hrefOf(m.entryId)} className={m.entryId === meeting.entryId ? s.meetingOn : s.meetingLink} aria-current={m.entryId === meeting.entryId ? 'page' : undefined}>
            {fmtDay(m.date)}
          </Link>
        </li>
      ))}
    </ul>
  );
  const heading = (
    <header className={styles.head}>
      <div>
        <p className={styles.kicker}>Meeting Planner</p>
        <h1 className={styles.title}>
          {page.meeting.dateLabel} · {page.meeting.title}
        </h1>
        {suggesting ? null : switcher}
      </div>
    </header>
  );
  return (
    <div className={styles.page}>
      <PlannerTabs active="build" />
      <BuildPlanView
        key={`${meeting.entryId}:${suggesting ? "s" : "p"}`}
        entryId={meeting.entryId}
        rows={rows}
        canSeed={access.canSeed}
        canEdit={access.canEdit}
        dayLabel={fmtDate(meeting.date, { year: false })}
        stamp={page.stamp}
        heading={heading}
        mode={suggesting ? 'suggestions' : 'plan'}
        view={view}
        planHref={hrefOf(meeting.entryId, false)}
        suggestionsHref={hrefOf(meeting.entryId, true)}
        switcher={suggesting ? switcher : undefined}
        lookupsHref={actor.capabilities.has('roster.manage') ? '/admin/advancement/lookups' : undefined}
        feed={
          suggesting ? (
            <Suspense fallback={null}>
              <Suggestions meeting={meeting} />
            </Suspense>
          ) : (
            <>
              <Suspense fallback={null}>
                <Likely entryId={meeting.entryId} keys={rows.filter((r) => !r.scouts).map((r) => r.key)} />
              </Suspense>
              <Suspense fallback={null}>
                <Orphans meeting={meeting} keys={rows.map((r) => r.key)} />
              </Suspense>
            </>
          )
        }
      />
    </div>
  );
}
