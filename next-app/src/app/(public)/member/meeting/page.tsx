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
  loadScoutBoard,
  loadUpcomingMeetings,
  othersByKeyFor,
  type BoardScout
} from '@/lib/meeting-board';
import { isAgendaPublished, loadTeachBoard, loadTeachView, offerChoices, OFFER_DATES, teacherTags } from '@/lib/meeting-board-supply';
import { loadMatchOrPlacement } from '@/lib/meeting-live';
import { taughtOnly } from '@/lib/meeting-live-shared';
import { seatLines, teachingLines } from '@/lib/meeting-board-match';
import { boardName, effectiveIntent, firstNameOf, isPastSoftClose, onBehalfAccess, scoutLine, type Intent } from '@/lib/meeting-board-shared';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { MemberProxyBanner } from '../member-proxy-banner';
import memberStyles from '../member.module.css';
import { ScoutBoard } from './scout-board';
import { TeachBoard } from './teach-board';
import { PlanNotice } from './plan-notice';
import styles from './meeting.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sunday’s meeting — Scout Troop 79'
};

type Search = { viewScout?: string; for?: string; scout?: string };

function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Finn is coming. Maya hasn't said." */
function householdSummary(rows: { name: string; intent: Intent | null }[]): string {
  const by = { coming: [] as string[], undecided: [] as string[], not_coming: [] as string[], none: [] as string[] };
  for (const r of rows) by[r.intent ?? 'none'].push(r.name);
  const parts: string[] = [];
  if (by.coming.length) parts.push(`${joinNames(by.coming)} ${by.coming.length > 1 ? 'are' : 'is'} coming.`);
  if (by.undecided.length) parts.push(`${joinNames(by.undecided)} ${by.undecided.length > 1 ? 'aren’t' : 'isn’t'} sure yet.`);
  if (by.not_coming.length) parts.push(`${joinNames(by.not_coming)} can’t make it.`);
  if (by.none.length) parts.push(`${joinNames(by.none)} ${by.none.length > 1 ? 'haven’t' : 'hasn’t'} said.`);
  return parts.join(' ');
}

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
  const dayName = fmtDateFull(meeting.date).split(',')[0];
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

  const chosen = subjects.find((s) => String(s.personId) === params.scout) ?? subjects[0] ?? null;
  const rowOf = new Map(everyone.map((r) => [r.personId, r]));
  const mine = chosen
    ? await loadScoutBoard(sb, meeting, chosen, catalog, {
        viewerPersonId: actorPersonId,
        othersByKey: othersByKeyFor(everyone, chosen.personId),
        teacherByKey: teacherTags(teach),
        freeform: teach.freeform
      })
    : null;
  const isSelf = !onBehalf && !proxy && session?.personId === chosen?.personId;
  const linkFor = (personId: number) => {
    const q = new URLSearchParams();
    if (proxy) q.set('viewScout', String(proxy.personId));
    q.set('scout', String(personId));
    return `/member/meeting?${q}`;
  };

  // Phase 3a: the live match, the same computation as Who’s coming and the editor's tray, said as "so far".
  // Once the meeting's agenda is published the agenda is the answer: the page links to it and says nothing personal
  // from the match (the agenda's scout names are free text a leader may have edited, so they aren't mapped back).
  const planSet = await isAgendaPublished(sb, meeting.entryId);
  // Rotations L3 (qa-lead): a class with no teacher yet isn't something a family is told they're in.
  const match = !planSet ? taughtOnly(await loadMatchOrPlacement(sb, meeting, everyone, teach)) : null;
  const lineSrc = { catalog, people: teach.people, freeformTitles: teach.freeformTitles, members: teach.members, scoutNames: new Map(everyone.map((r) => [r.personId, boardName(r.name)])) };
  const assigned = match && chosen ? seatLines(match, chosen.personId, lineSrc) : [];
  const teaching = match && teacher ? teachingLines(match, teacher.personId, lineSrc) : [];

  const upcoming = showTeach ? await loadUpcomingMeetings(sb, OFFER_DATES, meeting.date) : [];
  const teachView = showTeach ? await loadTeachView(sb, meeting, catalog, teacher!.personId, { board: everyone, upcoming, teach }) : null;
  const teacherIsSelf = !onBehalf && session?.personId === teacherId;
  const enteringFor = onBehalf ? (chosen?.name ?? teacher?.displayName ?? '') : '';

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
      {chosen && subjects.length > 1 && (
        <>
          <p className={styles.household}>
            {householdSummary(
              subjects.map((s) => {
                const r = rowOf.get(s.personId);
                return { name: firstNameOf(s.name), intent: r ? effectiveIntent(r.intent, r.picks) : null };
              })
            )}
          </p>
          <nav className={styles.switcher} aria-label="Your scouts">
            {subjects.map((s) => {
              const r = rowOf.get(s.personId);
              return (
                <Link key={s.personId} href={linkFor(s.personId)} aria-current={s.personId === chosen.personId ? 'page' : undefined}>
                  {firstNameOf(s.name)}
                  <span>· {scoutLine(r?.intent ?? null, r?.picks ?? [])}</span>
                </Link>
              );
            })}
          </nav>
        </>
      )}
      {chosen && mine && (
        <ScoutBoard
          key={chosen.personId}
          entryId={meeting.entryId}
          dayName={dayName}
          subject={{ personId: chosen.personId, firstName: firstNameOf(chosen.name), isSelf }}
          initial={mine.view}
          pickList={mine.pickList}
          onBehalf={onBehalf}
          readOnly={proxy != null || onBehalfReadOnly}
          assigned={assigned}
        />
      )}
      {teachView && teacher && (
        <TeachBoard
          key={`${teacher.personId}:${teachView.intent ?? ''}`}
          entryId={meeting.entryId}
          subject={{ personId: teacher.personId, firstName: firstNameOf(teacher.displayName), isSelf: teacherIsSelf }}
          initial={teachView}
          choices={offerChoices(teacher, catalog, upcoming)}
          onBehalf={onBehalf}
          readOnly={onBehalfReadOnly}
          teaching={teaching}
        />
      )}
    </>
  );
}
