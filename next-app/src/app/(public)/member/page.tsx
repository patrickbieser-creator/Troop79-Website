/**
 * /member — the signed-in member's home.
 *
 * One place a family lands after signing in, rather than having to know that
 * their household details live at /profile and nothing else has a home yet.
 * Scout account balances now live at /member/scout-account
 * (Plans/Troop-Finances.md Phase 3), national registration at
 * /member/registration (2026-10-20) — the rest of what belongs here still
 * does not exist: paying for a campout, health form dates. Those stay listed as "coming soon" ON
 * PURPOSE — a member who can see what is planned stops asking whether the
 * site does it, and it costs nothing to say.
 *
 * Access is a VERIFIED identity, adult or scout. The troop password is not
 * enough: everything reachable from here is that person's own record.
 *
 * Signing in and out happen from the nav's account control on every page
 * (2026-10-19; it replaced the Members tab and this page's Sign Out button).
 * "My page" in that menu lands here; a visitor who arrives signed out still
 * gets a sign-in prompt.
 */

import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { createAdminClient } from '@/lib/supabase/server';
import { listPasskeys, passkeysConfigured } from '@/lib/passkeys';
import { PasskeyManager } from './passkey-manager';
import { MemberProxyBanner } from './member-proxy-banner';
import { resolveMemberViewer } from '@/lib/member-viewer';
import { loadTeachingKind } from '@/lib/teaching-skills';
import { centralToday } from '@/lib/dates';
import { loadAdvancementCatalog } from '@/lib/advancement-catalog';
import { fmtDateFull } from '@/lib/format-date';
import { loadBoardScouts, loadEffectivePicks, loadHouseholdScoutPersonIds, loadIntents, loadNextMeeting } from '@/lib/meeting-board';
import { firstNameOf, scoutLine } from '@/lib/meeting-board-shared';
import { teacherLine } from '@/lib/meeting-board-teach';
import { loadTeacherState } from '@/lib/meeting-board-supply';
import { resolveFamilyScope } from '@/lib/household-scope';
import { loadRegistrationsFor } from '@/lib/bsa-roster-db';
import { registrationLine, visibleRegistrations } from '@/lib/member-registration';
import { isEpochCurrent } from '@/lib/identity-session';
import {
  passkeyRegisterOptionsAction,
  passkeyRegisterVerifyAction,
  deletePasskeyAction
} from '../signin/actions';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { Badge } from '@/app/_components/badge';
import surface from '@/app/_components/card.module.css';
import styles from './member.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Member — Scout Troop 79'
};

interface Card {
  title: string;
  body: string;
  href?: string;
  /** Live state shown above the body ("Coming · 3 picks"), one line each. */
  live?: string[];
  /** Adults only — /profile is Tier 2 and refuses a scout session. */
  adultOnly?: boolean;
}

/** Only for adults and Junior Leaders, so it is added per viewer rather than listed for everyone. */
const TEACHING_CARD: Card = {
  title: 'What I can teach',
  body: 'Check the skills you can teach at a troop meeting. Leaders use it to match teachers with what scouts ask for.',
  href: '/member/teaching'
};

const CARDS: Card[] = [
  {
    title: 'Your household',
    body: 'Addresses, phone numbers, birthdates, schools, and the things we should know about your scouts. Changes go to a leader for review.',
    href: '/profile',
    adultOnly: true
  },
  {
    title: 'Scout account',
    body: 'What’s in your scout’s account from fundraising, and what it has been spent on.',
    href: '/member/scout-account'
  },
  {
    title: 'Reimbursements',
    body: 'Paid for something out of pocket for the troop? Submit it with a receipt and track it here.',
    href: '/member/reimbursements'
  },
  {
    title: 'Pay for a campout',
    body: 'Settle up for an event online instead of remembering a cheque on the night.'
  },
  {
    title: 'Registration',
    body: 'Your current registration with the national Scouting America office, and when it renews.',
    href: '/member/registration'
  },
  {
    title: 'Health forms',
    body: 'Which parts of the annual health form we have on file for each member of your household, and when they expire.'
  },
  {
    title: 'Wreath sale',
    body: 'Your orders, totals, and what’s owed during the wreath fundraiser.',
    href: '/member/wreaths'
  }
];

export default async function MemberPage({
  searchParams
}: {
  searchParams: Promise<{ viewScout?: string }>;
}) {
  const { viewScout } = await searchParams;
  const session = await getIdentitySessionIfValid();
  // Read-only superuser proxy (library.proxy_view; lib/member-viewer.ts).
  const viewer = await resolveMemberViewer(createAdminClient(), viewScout);

  // A leader with proxy rights but no family of their own has no session
  // worth a sign-in gate: they get the picker (or, once chosen, the family).
  if (viewer.kind === 'proxy-available') {
    return (
      <>
        <PageHeader kicker="Members" title="Members" />
        <PageShell>
          <MemberProxyBanner viewer={viewer} />
          <p className={styles.intro}>
            Pick a scout to see the Members area exactly as their family sees it. Nothing here can be
            changed while you are viewing.
          </p>
        </PageShell>
      </>
    );
  }

  const proxy = viewer.kind === 'proxy' ? viewer : null;

  if (!session && !proxy) {
    return (
      <>
        <PageHeader kicker="Members" title="Member Sign In" />
        {/* Full-width shell, not "narrow": the narrow shell centers its
            column under the left-aligned header (Patrick, 2026-08-21: "left
            aligned like the rest of the content"). .gate caps the measure. */}
        <PageShell>
          <div className={styles.gate}>
          <p>
            This is where your own troop information lives &mdash; your household&rsquo;s details
            today, and your scout account, campout payments, registration and health forms as we
            build them.
          </p>
          <hr className={styles.gateRule} />
          <p>
            There&rsquo;s no password to remember. Enter the troop password, find your name, and
            we&rsquo;ll send a one-time code to the address we already have for you.
          </p>
          <p className={styles.gapTopLg}>
            <Button variant="primary" href={`/signin?next=${encodeURIComponent('/member')}`}>
              Sign in
            </Button>
          </p>
          <hr className={styles.gateRule} />
          <p className={styles.finePrint}>
            Trouble signing in? Ask a leader &mdash; they can check what address we have for you.
          </p>
          <p className={styles.finePrint}>
            Leaders working in the admin: <Link href="/admin/login">troop leader sign in</Link>.
          </p>
          </div>
        </PageShell>
      </>
    );
  }

  // Proxying: the household card is live (adult-only gating is about the
  // VIEWER being a scout, irrelevant here) and every link carries the choice.
  const isAdult = proxy ? true : session!.subjectKind === 'adult';
  // Adults only — see PasskeyManager's header for why scouts stay on codes.
  // Never the proxy viewer's own passkeys while viewing a family.
  const passkeys = !proxy && isAdult ? await listPasskeys(createAdminClient(), session!.personId) : [];
  const withProxy = (href: string) => (proxy ? `${href}?viewScout=${proxy.personId}` : href);
  const loadedKind = await loadTeachingKind(createAdminClient(), proxy ? proxy.personId : session!.personId, centralToday());
  // A scout sign-in never counts as an adult here, even if their scout row is no longer active.
  const teachingKind = !proxy && loadedKind === 'adult' && !isAdult ? 'none' : loadedKind;
  const after = CARDS.findIndex((c) => c.href === '/member/reimbursements') + 1;
  const meetingCard = await loadMeetingCard(proxy ? proxy.personId : session!.personId, !proxy && !isAdult, proxy != null, !proxy && teachingKind !== 'none');
  const withTeaching = teachingKind === 'none' ? CARDS : [...CARDS.slice(0, after), TEACHING_CARD, ...CARDS.slice(after)];
  // Family registration names children, so a revoked session (stale epoch) gets no lines, the same gate as /member/registration.
  const registrationLines =
    proxy || (await isEpochCurrent(createAdminClient(), session!))
      ? await loadRegistrationLines(proxy ? proxy.personId : session!.personId, proxy != null || !isAdult)
      : undefined;
  const withRegistration = withTeaching.map((c) => (c.href === '/member/registration' ? { ...c, live: registrationLines } : c));
  const cards = meetingCard ? [meetingCard, ...withRegistration] : withRegistration;

  return (
    <>
      <PageHeader kicker="Members" title="Members" />
      <PageShell>
        <MemberProxyBanner viewer={viewer} />
        {proxy ? (
          <p className={styles.intro}>
            This is what <strong>{proxy.name}</strong>&rsquo;s family sees. It is read-only while you are
            viewing.
          </p>
        ) : (
        <div className={styles.identityRow}>
          <p className={styles.intro}>
            Signed in as <strong>{session!.displayName}</strong>. Everything here is yours &mdash;
            your household&rsquo;s details, and, as we build them out, the rest of the things
            families ask us for.
          </p>
          {/* Sign out lives in the nav's account menu (2026-10-19), on every page. */}
        </div>
        )}

      <div className={styles.grid}>
        {cards.map((card) => {
          // A scout's session is deliberately narrower than an adult's: it
          // never reaches household demographics. Rather than hiding the card
          // and leaving them wondering, say why.
          const live = card.href != null && (!card.adultOnly || isAdult);

          if (live) {
            return (
              <Link
                key={card.title}
                href={withProxy(card.href!)}
                className={`${surface.card} ${styles.card} ${styles.cardLive}`}
              >
                <p className={styles.cardTitle}>{card.title}</p>
                {card.live?.map((line) => (
                  <p key={line} className={styles.cardLiveLine}>
                    {line}
                  </p>
                ))}
                <p className={styles.cardBody}>{card.body}</p>
              </Link>
            );
          }

          const blockedForScout = card.href != null && card.adultOnly && !isAdult;
          return (
            <div key={card.title} className={`${surface.card} ${styles.card} ${styles.cardSoon}`}>
              <p className={styles.cardTitle}>
                {card.title}
                <Badge tone="neutral">{blockedForScout ? 'Parents' : 'Soon'}</Badge>
              </p>
              <p className={styles.cardBody}>
                {blockedForScout
                  ? 'A parent or guardian in your household can update these — scouts don’t have access to household contact details.'
                  : card.body}
              </p>
            </div>
          );
        })}
      </div>

      {isAdult && !proxy && (
        <PasskeyManager
          passkeys={passkeys}
          configured={passkeysConfigured()}
          getOptions={passkeyRegisterOptionsAction}
          verify={passkeyRegisterVerifyAction}
          remove={deletePasskeyAction}
        />
      )}

      <p className={styles.note}>
          The greyed-out cards aren&rsquo;t built yet. They&rsquo;re listed so you can see
          what&rsquo;s coming &mdash; if one of them would save you a phone call, tell a leader and
          it&rsquo;ll move up the list.
        </p>
      </PageShell>
    </>
  );
}

/**
 * The "Sunday's meeting" card (Plans/Meeting-Requests-And-Teaching-Offers.md): live state per scout ("Coming · 3
 * picks"), linking to /member/meeting. A scout sees their own line; an adult one line per scout in the household.
 * Phase 2: anyone who can teach (an adult, with or without scouts, or a Junior Leader) gets the card too, with their
 * own line ("You: Coming · teaching 1"). Null = no card.
 */
async function loadMeetingCard(personId: number, viewerIsScout: boolean, proxying: boolean, teaches: boolean): Promise<Card | null> {
  const sb = createAdminClient();
  const meeting = await loadNextMeeting(sb);
  if (!meeting) return null;
  const ids = viewerIsScout ? [personId] : proxying ? [personId, ...(await loadHouseholdScoutPersonIds(sb, personId))] : await loadHouseholdScoutPersonIds(sb, personId);
  const scouts = await loadBoardScouts(sb, ids);
  if (!scouts.length && !teaches) return null;
  const day = fmtDateFull(meeting.date);
  const title = `${day.split(',')[0]}’s meeting`;
  if (meeting.closed) {
    return { title, body: `${meeting.title}, ${day}.`, href: '/member/meeting', live: ['No sign-ups this week'] };
  }
  const [picks, intents, me] = await Promise.all([
    scouts.length ? loadEffectivePicks(sb, meeting, scouts, await loadAdvancementCatalog()) : Promise.resolve(new Map()),
    loadIntents(sb, meeting.entryId, scouts.map((s) => s.personId)),
    teaches ? loadTeacherState(sb, meeting.entryId, personId) : Promise.resolve(null)
  ]);
  const line = (s: (typeof scouts)[number]) => scoutLine(intents.get(s.personId) ?? null, picks.get(s.personId)?.picks ?? []);
  const scoutLines = viewerIsScout ? scouts.slice(0, 1).map(line) : scouts.map((s) => `${firstNameOf(s.name)}: ${line(s)}`);
  // A Junior Leader's answer is their scout line; only what they teach is added. An adult gets their own line.
  const teachLines = !me ? [] : viewerIsScout ? (me.count ? [`Teaching ${me.count}`] : []) : [`You: ${teacherLine(me.intent, me.count)}`];
  const body = scouts.length
    ? `${day}. Say if you’re coming and pick what to work on${teaches ? ', or what you’ll teach' : ''}.`
    : `${day}. Say if you’re coming and what you’ll teach.`;
  return { title, body, href: '/member/meeting', live: [...scoutLines, ...teachLines] };
}

/** The Registration card's live lines: one per person shown ("Ben: Registered through Mar 31, 2027"), or the bare
 *  line when only one person is shown. Who is shown is visibleRegistrations, the same as /member/registration. */
async function loadRegistrationLines(personId: number, selfOnly: boolean): Promise<string[]> {
  const sb = createAdminClient();
  const scope = selfOnly ? [personId] : await resolveFamilyScope(sb, personId, 'adult');
  const regs = await loadRegistrationsFor(sb, scope);
  const today = centralToday();
  const shown = visibleRegistrations(regs, personId);
  if (shown.length === 1) return [registrationLine(shown[0], today)];
  return shown.map((r) => `${r.personId === personId ? 'You' : firstNameOf(r.name)}: ${registrationLine(r, today)}`);
}
