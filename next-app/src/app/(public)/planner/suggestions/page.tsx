/**
 * /planner/suggestions — Suggestions, the planner tab after Has/Needs (prototypes/meeting-plan-III/README.md, "Screen:
 * Suggestions"; restored from Build a Plan's Suggestions mode). What scouts need next, from the advancement ledger:
 * Group sessions, By scout and Teaching, with Needs another setting below.
 *
 * Gated like Has/Needs: anyone with planner View sees it. Add, ticks and Save as a focus set need the Seed right; a
 * Teaching chip sets a teacher with the Edit right (adding it first needs Seed too). Every write is checked again on
 * the server.
 *
 * One cached engine read (two minutes, JSON-only) for the next meeting's date, and one plan read for the toolbar's
 * meetings (the next PLAN_MEETINGS open ones). The For switch, the view, the filters and the ticks are client state.
 */
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDate, fmtDay } from '@/lib/format-date';
import { loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerLists } from '@/lib/people-lists';
import { PLAN_MEETINGS } from '@/lib/build-plan';
import { loadPlanStates, loadSuggestionsData } from '@/lib/planner-suggest-db';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { SuggestionsView } from './suggestions-client';
import styles from '../planner.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Suggestions — Meeting Planner — Scout Troop 79'
};

const suggestionsCached = unstable_cache(async (date: string, title: string) => loadSuggestionsData(date, title), ['planner-suggestions'], { revalidate: 120 });

export default async function SuggestionsPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/suggestions');
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
  const head = (
    <header className={styles.head}>
      <div>
        <p className={styles.kicker}>Meeting Planner</p>
        <h1 className={styles.title}>Suggestions</h1>
        <p className={styles.sub}>
          What scouts need next, worked out from the advancement ledger: who needs what, who can teach it, and what only a campout or a pool can cover.
          {access.canSeed ? ' Add anything to a meeting’s plan, or save a set of picks as a focus set.' : ''}
        </p>
      </div>
    </header>
  );
  if (!meetings.length) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="suggestions" canEmail={access.canEmail} />
        {head}
        <div className={styles.noticeWrap}>
          <Notice tone="info">There’s no troop meeting on the calendar yet.</Notice>
        </div>
      </div>
    );
  }

  const first = meetings[0];
  const [data, plans] = await Promise.all([suggestionsCached(first.date, first.title).catch(() => null), loadPlanStates(sb, meetings.map((m) => m.entryId)).catch(() => null)]);

  return (
    <div className={styles.page}>
      <PlannerTabs active="suggestions" canEmail={access.canEmail} />
      {head}
      {data && plans ? (
        <SuggestionsView
          data={data}
          meetings={meetings.map((m) => ({ entryId: m.entryId, label: fmtDay(m.date), short: fmtDate(m.date, { year: false }), ...plans[m.entryId] }))}
          canSeed={access.canSeed}
          canEdit={access.canEdit}
          lookupsHref={actor.capabilities.has('roster.manage') ? '/admin/advancement/lookups?card=adult-skills' : undefined}
        />
      ) : (
        <div className={styles.noticeWrap}>
          <Notice tone="error">Suggestions didn’t load. Refresh the page to try again.</Notice>
        </div>
      )}
    </div>
  );
}
