/**
 * /member/meeting — Sunday's meeting (Phase 1 of Plans/Meeting-Requests-And-Teaching-Offers.md; prototype
 * prototypes/meeting-board/meeting.html).
 *
 * A scout says whether they're coming and picks up to five things to work on; a parent does it for the scouts in
 * their household, one scout at a time (a switcher, with a one-line household summary above it); a leader opens it
 * from Admin › Meeting Plan with ?for=<personId> to enter for someone who phoned or texted. Everything saves on tap.
 *
 * Which meeting: the next published Troop Meeting entry on or after today (Central), so Sunday's board stays up all
 * of Sunday. A closed meeting says "No sign-ups this week."; every other meeting, merit badge nights included, is the
 * same board (P5a, Decision 10 of Plans/Meeting-Planner-II.md). After 5:30 pm Sunday the page says the plan is set, and
 * still takes answers.
 *
 * Access is a VERIFIED identity, as on the rest of /member. A leader proxy-viewing a family sees it read-only.
 *
 * Phase 2: "Teach at a meeting" renders below the scout section for an adult (leader or parent, with or without
 * scouts) and for a Junior Leader, and a leader's ?for= opens it for an adult too. A parent who teaches sees both.
 * Scouts see one quiet "Teacher: Mr. Vest" tag on a topic someone is teaching, and freeform offers under "Also offered
 * this week".
 *
 * Phase 3a: once the live match has a session for the scout, the page says so ("So far, you're in First aid, your #2"),
 * and a teacher sees the sessions they're teaching. Once the agenda is published the page links to it instead
 * ("This week's plan is set: see the agenda"). Never "too late".
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { isEpochCurrent } from '@/lib/identity-session';
import { createAdminClient } from '@/lib/supabase/server';
import { loadProxyFamily, resolveMemberViewer } from '@/lib/member-viewer';
import { actorHas, resolveAdminActor } from '@/lib/admin-actor';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { formatTimeOfDay } from '@/lib/calendar-shared';
import { fmtDateFull } from '@/lib/format-date';
import {
  loadBoardScouts,
  loadBoardState,
  loadHouseholdScoutPersonIds,
  loadNextMeeting,
  loadUpcomingMeetings,
  type BoardScout
} from '@/lib/meeting-board';
import { isAgendaPublished, loadTeachBoard, loadTeachView, offerChoices, OFFER_DATES } from '@/lib/meeting-board-supply';
import { loadFamilyWeek } from '@/lib/family-week';
import { firstNameOf, isPastSoftClose, onBehalfAccess } from '@/lib/meeting-board-shared';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { MemberProxyBanner } from '../member-proxy-banner';
import memberStyles from '../member.module.css';
import { FamilyWeekMember } from './family-week-member';
import { TeachBoard } from './teach-board';
import { PlanNotice } from './plan-notice';
import styles from './meeting.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sunday’s meeting — Scout Troop 79'
};

type Search = { viewScout?: string; for?: string; scout?: string };

export default async function MeetingBoardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const sb = createAdminClient();
  const viewer = await resolveMemberViewer(sb, params.viewScout);
  const proxy = viewer.kind === 'proxy' ? viewer : null;
  const session = await getIdentitySessionIfValid();
  const signedIn = !!session && (await isEpochCurrent(sb, session));

  const header = <PageHeader kicker="Members" title="Sunday’s meeting" />;

  if (viewer.kind === 'proxy-available') {
    return (
      <>
        {header}
        <PageShell>
          <MemberProxyBanner viewer={viewer} />
        </PageShell>
      </>
    );
  }

  // On behalf: a leader holding meeting_plan.use (not a scout session) entering for one scout.
  const forId = params.for ? Number(params.for) : null;
  let onBehalf = false;
  let onBehalfReadOnly = false;
  let actorPersonId: number | null = session?.personId ?? null;
  if (forId != null && Number.isInteger(forId)) {
    const actor = await resolveAdminActor();
    const access = onBehalfAccess({
      holdsMeetingPlan: actorHas(actor, 'meeting_plan.use'),
      actorIsScout: actor?.subjectKind === 'scout',
      hasVerifiedSignIn: signedIn
    });
    if (access !== 'none') {
      onBehalf = true;
      onBehalfReadOnly = access === 'read-only';
      actorPersonId = actor?.personId ?? actorPersonId;
    }
  }

  if (!proxy && !onBehalf && !signedIn) {
    return (
      <>
        <PageHeader kicker="Members" title="Sign In" />
        <PageShell width="narrow">
          <div className={memberStyles.gate}>
            <p>Sign in to say if you&rsquo;re coming to the next troop meeting and pick what to work on.</p>
            <p>
              <Button variant="primary" href={`/signin?next=${encodeURIComponent('/member/meeting')}`}>
                Sign in
              </Button>
            </p>
          </div>
        </PageShell>
      </>
    );
  }

  // Whose picks this page shows.
  let subjects: BoardScout[];
  if (onBehalf) subjects = await loadBoardScouts(sb, [forId!]);
  else if (proxy) subjects = await loadBoardScouts(sb, (await loadProxyFamily(proxy.personId)).personIds);
  else if (session!.subjectKind === 'scout') subjects = await loadBoardScouts(sb, [session!.personId]);
  else subjects = await loadBoardScouts(sb, await loadHouseholdScoutPersonIds(sb, session!.personId));
  // Who might teach (Phase 2): the signed-in person themself (an adult, or a scout who is a Junior Leader), or the
  // person a leader opened on behalf. A proxy view is a family's scouts only.
  const teacherId = onBehalf ? forId! : proxy ? null : session!.personId;

  const back = onBehalf
    ? { href: '/planner', label: '← Back to the Meeting Planner' }
    : { href: proxy ? `/member?viewScout=${proxy.personId}` : '/member', label: '← Back to Members' };
  const meeting = await loadNextMeeting(sb);

  const shell = (body: ReactNode) => (
    <>
      {header}
      <PageShell>
        <div className={styles.page}>
          <MemberProxyBanner viewer={viewer} />
          <p className={styles.back}>
            <Link href={back.href}>{back.label}</Link>
          </p>
          {body}
        </div>
      </PageShell>
    </>
  );

  if (!meeting) return shell(<p className={memberStyles.intro}>There&rsquo;s no troop meeting on the calendar yet.</p>);

  const dateLine = [fmtDateFull(meeting.date), meeting.startTime ? formatTimeOfDay(meeting.startTime) : null, meeting.location].filter(Boolean).join(' · ');
  const meetLine = <p className={styles.meetLine}>{dateLine}</p>;

  if (meeting.closed) {
    return shell(
      <>
        {meetLine}
        <div className={styles.notice}>
          <p>
            <strong className={styles.big}>No sign-ups this week.</strong>
          </p>
          <p>{meeting.title}.</p>
        </div>
      </>
    );
  }

  const catalog = await loadAdvancementCatalog();
  const everyone = await loadBoardState(sb, meeting, catalog);
  const teach = await loadTeachBoard(sb, meeting, catalog, everyone, teacherId != null ? [teacherId] : []);
  const teacher = teacherId != null ? (teach.people.get(teacherId) ?? null) : null;
  const showTeach = teacher != null;

  if (!subjects.length && !showTeach) {
    return shell(
      <>
        {meetLine}
        <p className={memberStyles.intro}>
          {onBehalf ? 'That person isn’t an active scout or a teacher.' : 'There are no scouts in your household to pick for. If that’s wrong, ask a leader.'}
        </p>
      </>
    );
  }

  // Meeting Planner III (Decision 5): every scout of the household on one page, the published plan's options with
  // their suggestions marked. A proxy (a leader viewing a family) sees it read-only; entering for someone is the
  // planner's person drawer.
  const week = subjects.length ? await loadFamilyWeek(sb, meeting, subjects.map((s) => s.personId), catalog, actorPersonId) : null;
  const planSet = await isAgendaPublished(sb, meeting.entryId);
  const upcoming = showTeach ? await loadUpcomingMeetings(sb, OFFER_DATES, meeting.date) : [];
  const teachView = showTeach ? await loadTeachView(sb, meeting, catalog, teacher!.personId, { board: everyone, upcoming, teach }) : null;
  const teacherIsSelf = !onBehalf && session?.personId === teacherId;
  const enteringFor = onBehalf ? (subjects[0]?.name ?? teacher?.displayName ?? '') : '';

  return shell(
    <>
      {meetLine}
      {onBehalf &&
        (onBehalfReadOnly ? (
          <p className={styles.banner}>Sign in with your own account to edit for someone.</p>
        ) : (
          <p className={styles.banner}>
            <strong>Entering for {enteringFor}</strong> (phone or text). Changes save as entered by you.
          </p>
        ))}
      <PlanNotice planSet={planSet} pastClose={isPastSoftClose(meeting.date)} entryId={meeting.entryId} />
      {week && week.scouts.length ? <FamilyWeekMember week={week} readOnly={proxy != null || onBehalf} /> : null}
      {teachView && teacher && (
        <TeachBoard
          key={`${teacher.personId}:${teachView.intent ?? ''}`}
          entryId={meeting.entryId}
          subject={{ personId: teacher.personId, firstName: firstNameOf(teacher.displayName), name: teacher.displayName, isSelf: teacherIsSelf }}
          initial={teachView}
          choices={offerChoices(teacher, catalog, upcoming)}
          onBehalf={onBehalf}
          readOnly={onBehalfReadOnly}
          teaching={[]}
        />
      )}
    </>
  );
}
