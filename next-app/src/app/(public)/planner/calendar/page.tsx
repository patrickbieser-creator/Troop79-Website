/**
 * /planner/calendar — the Theme calendar (Plans/Meeting-Planner-III.md, P5): the focus of each coming meeting, how
 * many scouts working on Scout through First Class would have rank work that week before anyone signs up, and who
 * the run covers (each rank group × week). No target is shown. A week opens on This week to change its focus. Any
 * planner right sees it.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { fmtDay } from '@/lib/format-date';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { loadUpcomingMeetings } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { boardScoutsOf, loadPlannerLists } from '@/lib/people-lists';
import { loadLeafCodes } from '@/lib/this-week-db';
import { PLANNER_WEEKS } from '@/lib/this-week';
import { buildThemeCalendar } from '@/lib/theme-calendar';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import styles from '../planner.module.css';
import s from '../this-week.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Theme Calendar — Meeting Planner — Scout Troop 79' };

type TopicRow = { calendar_entry_id: number; title: string | null; meeting_topic_members: { item_key: string }[] | null };
type BadgeRow = { calendar_entry_id: number; mb_id: string; merit_badges: { name: string } | { name: string }[] | null };

export default async function ThemeCalendarPage() {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/calendar');
  if (!plannerAccess(actor).canView) {
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
  const meetings = (await loadUpcomingMeetings(sb, PLANNER_WEEKS * 2, undefined, lists.meetingLabels)).filter((m) => !m.closed).slice(0, PLANNER_WEEKS);
  const ids = meetings.map((m) => m.entryId);
  const scouts = boardScoutsOf(lists);
  const [catalog, progress, topics, badges] = await Promise.all([
    loadAdvancementCatalog(),
    loadLeafCodes(sb, scouts.map((x) => x.scoutId)),
    ids.length
      ? sb.from('meeting_topics').select('calendar_entry_id, title, meeting_topic_members(item_key)').in('calendar_entry_id', ids).eq('kind', 'focus_group').not('seeded_at', 'is', null).order('seeded_at')
      : { data: [] },
    ids.length ? sb.from('meeting_night_badges').select('calendar_entry_id, mb_id, merit_badges(name)').in('calendar_entry_id', ids).order('created_at') : { data: [] }
  ]);
  const topicRows = (topics.data ?? []) as unknown as TopicRow[];
  const badgeRows = (badges.data ?? []) as unknown as BadgeRow[];
  const mbName = (b: BadgeRow) => (Array.isArray(b.merit_badges) ? b.merit_badges[0]?.name : b.merit_badges?.name) ?? b.mb_id;
  const cal = buildThemeCalendar(
    {
      ranks: catalog.ranks,
      rankReqs: catalog.rankRequirements,
      meritBadges: catalog.meritBadges,
      mbReqs: catalog.meritBadgeRequirements,
      scouts: scouts.map((x) => ({ personId: x.personId, scoutId: x.scoutId, name: x.name, currentRank: x.currentRank, intent: null })),
      progress
    },
    meetings.map((m) => {
      const mine = topicRows.filter((t) => t.calendar_entry_id === m.entryId);
      const mbs = badgeRows.filter((b) => b.calendar_entry_id === m.entryId);
      return {
        entryId: m.entryId,
        date: m.date,
        focusNames: [...mine.map((t) => t.title ?? ''), ...mbs.map((b) => `${mbName(b)} merit badge`)].filter(Boolean),
        focusKeys: mine.flatMap((t) => (t.meeting_topic_members ?? []).map((x) => x.item_key)),
        badgeIds: mbs.map((b) => b.mb_id)
      };
    })
  );

  return (
    <div className={styles.page}>
      <PlannerTabs active="week" canEmail={plannerAccess(actor).canEmail} />
      <div className={s.wrap}>
        <div>
          <p className={s.muted}>
            <Link href="/planner">Meeting Planner</Link> › Theme calendar
          </p>
          <h1 className={s.cardTitle}>Theme calendar</h1>
          <p className={s.cardSub}>
            The focus for the coming Sundays. Each week shows how many scouts working on Scout through First Class would have rank work, before anyone signs up.
          </p>
        </div>
        {meetings.length ? null : <Notice tone="info">There’s no troop meeting on the calendar yet.</Notice>}
        {cal.weeks.map((w) => (
          <section key={w.entryId} className={s.coverage} aria-label={fmtDay(w.date)}>
            <div className={s.covMain}>
              <span className={s.covNum}>
                {fmtDay(w.date)} · {w.focusNames.join(' + ') || 'Not planned yet'}
              </span>
              {w.planned ? (
                <>
                  <span className={s.muted}>
                    Rank work: {w.rankWork} of {w.counted} · {w.pct}% · {w.nothing} would have nothing open
                  </span>
                  <svg className={s.covBar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                    <rect className={s.covTrack} x="0" y="0" width="100" height="10" rx="5" />
                    <rect className={s.covFill} x="0" y="0" width={w.pct} height="10" rx="5" />
                  </svg>
                </>
              ) : null}
            </div>
            <Link className={s.quiet} href={`/planner?meeting=${w.entryId}`}>
              {w.planned ? 'Change focus' : 'Pick a focus'}
            </Link>
          </section>
        ))}
        {cal.weeks.length ? (
          <section className={s.gridCard} aria-labelledby="run-h">
            <h2 id="run-h" className={s.cardTitle}>
              Who the run covers
            </h2>
            <p className={s.cardSub}>Scouts in each group with rank work that week. A low number means that group needs something else that night.</p>
            <div className={s.scroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col" className={s.nameCol}>
                      Group
                    </th>
                    {cal.weeks.map((w) => (
                      <th key={w.entryId} scope="col" className={s.noteCol}>
                        {fmtDay(w.date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cal.bands.map((b) => (
                    <tr key={b.rankId}>
                      <th scope="row" className={s.nameCol}>
                        <span className={`${s.bandName} ${s[`tone-${b.rankId}`]}`}>{b.name}</span> <span className={s.muted}>{b.size} scouts</span>
                      </th>
                      {b.withWork.map((n, i) => (
                        <td key={cal.weeks[i].entryId} className={s.noteCol}>
                          {n == null ? '—' : `${n} of ${b.size}`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
