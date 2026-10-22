/**
 * /planner/invite — the Invite tab (Plans/Build-A-Plan.md, B6): invites come after the plan is built, so they get a
 * whole screen. Tabs: Build a Plan · Invite · Who's coming · Meeting Live · Focus sets. The same meeting switcher as
 * Build (?meeting=<entryId>); ?offering=<key> opens with that offering selected (Build's row ⋯ → Invite).
 *
 * Gated like the other planner tabs: any planner right sees it; viewers and the SPL read-only (Send greyed with "Only
 * adults send email", refused on the server). A past or closed meeting is read-only. An empty plan shows an
 * EmptyState linking to Build.
 *
 * Round trips (pinned in a test): the board as Build reads it (loadPlannerPage, which already reads the meeting's
 * invite history), then ONE loadInviteTab for every offering (one scoutCandidatesMany, one teacher-choices batch, the
 * history reused) and the digest template for Preview. Ticks are client state until Send.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveAdminActor } from '@/lib/admin-actor';
import { createAdminClient } from '@/lib/supabase/server';
import { centralToday } from '@/lib/dates';
import { fmtDateFull, fmtDay } from '@/lib/format-date';
import { loadMeetingById, loadUpcomingMeetings, type BoardMeeting } from '@/lib/meeting-board';
import { plannerAccess } from '@/lib/meeting-planner-access';
import { loadPlannerPage } from '@/lib/meeting-planner-load';
import { loadPlannerLists } from '@/lib/people-lists';
import { pickMeeting, planRows, PLAN_MEETINGS } from '@/lib/build-plan';
import { loadInviteTab } from '@/lib/meeting-invite-digest-db';
import { loadDigestTemplate } from '@/lib/meeting-invite-digest-send';
import type { InviteTabData } from '@/lib/meeting-invite-digest';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Notice } from '@/app/_components/notice';
import { PlannerTabs } from '../planner-tabs';
import { InviteView } from './invite-client';
import styles from '../planner.module.css';
import s from '../build/build.module.css';

export const dynamic = 'force-dynamic';
// Send goes out a few emails at a time and starts no new batch after 40 s (lib/meeting-invite-digest-send).
export const maxDuration = 60;

export const metadata = {
  title: 'Invite — Meeting Planner — Scout Troop 79'
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ meeting?: string | string[]; offering?: string | string[] }> }) {
  const actor = await resolveAdminActor();
  if (!actor) redirect('/signin?next=/planner/invite');
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
  const params = await searchParams;
  const meetings = (await loadUpcomingMeetings(sb, PLAN_MEETINGS * 2, undefined, lists.meetingLabels)).slice(0, PLAN_MEETINGS);
  const wanted = Number(one(params.meeting));
  // A meeting off the switcher (one that has passed) still opens, read-only.
  let meeting: BoardMeeting | null = meetings.find((m) => m.entryId === wanted) ?? null;
  if (!meeting && Number.isInteger(wanted) && wanted > 0) meeting = await loadMeetingById(sb, wanted).catch(() => null);
  meeting ??= pickMeeting(meetings, undefined);
  if (!meeting) {
    return (
      <div className={styles.page}>
        <PlannerTabs active="invite" />
        <div className={styles.noticeWrap}>
          <Notice tone="info">There’s no troop meeting on the calendar yet. Plans open once one is published.</Notice>
        </div>
      </div>
    );
  }
  const past = meeting.date < centralToday();
  const readOnly = past ? ('past' as const) : meeting.closed ? ('closed' as const) : null;

  const page = await loadPlannerPage(sb, meeting, lists);
  if (!page) return null;
  const rows = planRows(page.board);
  let data: InviteTabData | null = { sections: [], recipients: {} };
  const [tab, template] = await Promise.all([
    readOnly || !rows.length ? Promise.resolve(data) : loadInviteTab(sb, meeting, rows.map((r) => r.key), { history: page.inviteRows }).catch(() => null),
    loadDigestTemplate(sb)
  ]);
  data = tab;

  const switcher = (
    <ul className={s.switcher} aria-label="Meeting">
      {meetings.map((m) => (
        <li key={m.entryId}>
          <Link href={`/planner/invite?meeting=${m.entryId}`} className={m.entryId === meeting.entryId ? s.meetingOn : s.meetingLink} aria-current={m.entryId === meeting.entryId ? 'page' : undefined}>
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
        {switcher}
      </div>
    </header>
  );
  const offering = one(params.offering);
  return (
    <div className={styles.page}>
      <PlannerTabs active="invite" />
      <InviteView
        key={meeting.entryId}
        entryId={meeting.entryId}
        rows={rows}
        data={data}
        canEmail={access.canEmail}
        readOnly={readOnly}
        buildHref={`/planner/build?meeting=${meeting.entryId}`}
        initialKey={offering && rows.some((r) => r.key === offering) ? offering : null}
        template={template}
        day={fmtDateFull(meeting.date)}
        heading={heading}
      />
    </div>
  );
}
