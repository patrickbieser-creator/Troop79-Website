/**
 * /i/plan/<token>: the published plan's family link (Plans/Meeting-Planner-III.md, Decision 5; qa-lead 2026-10-28).
 * The GET only reads (inspectPlanPage writes nothing, so a mail scanner's prefetch spends nothing). It shows each of
 * the recipient's scouts' live plan and lets them answer for their own scouts on this meeting; no sign-in. ?a= is the
 * email button's answer, applied by the page after load (lib/family-week, Emails E2). A closed link (unknown, expired, revoked) reads the same to anyone and hands the client nothing about
 * who or which scouts; a superseded one points at the newer email. Headers (no-referrer, no-store, noindex) come from
 * next.config.ts's /i/:path* rule.
 *
 * F5: a link minted as_teacher also shows the recipient's own teacher card when they may teach on the meeting date
 * (loadTeacherPeople), writing through planPageTeachAction; "Offer something" lists this meeting only. As on
 * /member/meeting, a Junior Leader's own link shows only the teaching card.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardState, loadMeetingById, loadUpcomingMeetings } from '@/lib/meeting-board';
import { loadTeachBoard, loadTeachView, offerChoices, OFFER_DATES } from '@/lib/meeting-board-supply';
import { loadTeacherWeek } from '@/lib/teacher-week';
import { tooManyInviteFailures } from '@/lib/meeting-invites-db';
import { loadFamilyWeek } from '@/lib/family-week';
import { inspectPlanPage } from '@/lib/plan-pages';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { PlanPageClient, type PlanTeacher } from './plan-page-client';
import { familyLede, teacherLede, type FamilyChoice } from '@/lib/family-week-shared';
import styles from '../../../member/meeting/family-week.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'This Week’s Troop Meeting — Scout Troop 79',
  robots: { index: false, follow: false }
};

const ANSWERS: readonly FamilyChoice[] = ['ok', 'change', 'out', 'mb', 'help'];

export default async function PlanPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ a?: string }> }) {
  const { token } = await params;
  // The email's button (Emails E2): read here, applied once by the page after it loads (never by this GET).
  const a = (await searchParams).a;
  const initialAnswer = ANSWERS.find((x) => x === a) ?? null;
  const sb = createAdminClient();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const limited = await tooManyInviteFailures(sb, ip);
  const { state, page } = limited ? { state: 'closed' as const, page: null } : await inspectPlanPage(sb, token);
  const meeting = state === 'open' && page ? await loadMeetingById(sb, page.entryId) : null;
  if (state !== 'open' || !page || !meeting) {
    return (
      <>
        <PageHeader kicker="Troop Meeting" title="This week’s meeting" />
        <PageShell width="narrow">
          <p className={styles.closed}>
            {page?.reason === 'superseded'
              ? 'There’s a newer plan for this meeting. Use the link in the troop’s latest email.'
              : 'This link has closed.'}{' '}
            You can always <Link href="/member/meeting">sign in to the member page</Link> to answer.
          </p>
        </PageShell>
      </>
    );
  }
  const catalog = await loadAdvancementCatalog();
  // The teacher card (F5): only on a teacher link, only for someone who may teach on the meeting date.
  let teacher: PlanTeacher | null = null;
  if (page.asTeacher && !meeting.closed) {
    const board = await loadBoardState(sb, meeting, catalog);
    const teach = await loadTeachBoard(sb, meeting, catalog, board, [page.recipientId]);
    const me = teach.people.get(page.recipientId);
    const tw = me ? await loadTeacherWeek(sb, meeting, catalog, page.recipientId) : null;
    if (me && tw) {
      const upcoming = await loadUpcomingMeetings(sb, OFFER_DATES, meeting.date);
      const view = await loadTeachView(sb, meeting, catalog, page.recipientId, { board, upcoming, teach });
      // "Offer something" from the link is for this Sunday only.
      if (view) teacher = { week: tw, view, choices: offerChoices(me, catalog, [meeting]) };
    }
  }
  // A Junior Leader's own link: one card, the teaching one.
  const juniorSelf = teacher?.week.junior === true && page.scoutIds.includes(page.recipientId);
  const scoutIds = page.scoutIds.filter((id) => !(juniorSelf && id === page.recipientId));
  const week = scoutIds.length ? await loadFamilyWeek(sb, meeting, scoutIds, catalog, page.recipientId) : null;
  const names = week?.scouts.map((s) => s.firstName) ?? [];
  const lede = names.length
    ? familyLede(teacher ? [...names, 'you'] : names, !teacher && page.recipientId === week?.scouts[0]?.personId && names.length === 1)
    : teacher
      ? teacherLede(teacher.week.firstName, teacher.week.junior)
      : 'There’s nothing on this link to answer.';
  return (
    <>
      <PageHeader kicker="Troop Meeting" title={fmtDateFull(meeting.date)} />
      <PageShell width="narrow">
        <PlanPageClient token={token.toLowerCase()} entryId={meeting.entryId} date={meeting.date} week={week} teacher={teacher} initialAnswer={initialAnswer} lede={lede} />
        <footer className={styles.foot}>
          <p>Plans can change before Sunday. If a group or teacher changes, we&rsquo;ll email you.</p>
          <p>
            You opened this from an email link, so there&rsquo;s no sign-in. The link works until 6:00 PM on {fmtDateFull(meeting.date)}. This page is for {page.recipientName}; if that isn&rsquo;t you,
            please don&rsquo;t answer here. <Link href="/member/meeting">Sign in</Link> for more.
          </p>
        </footer>
      </PageShell>
    </>
  );
}
