/**
 * /member — the signed-in member's home.
 *
 * One place a family lands after signing in, rather than having to know that
 * their household details live at /profile and nothing else has a home yet.
 * Most of what belongs here does not exist: Scout account balances, paying
 * for a campout, national registration status, health form dates, wreath
 * sale. Those are listed as "coming soon" ON PURPOSE — a member who can see
 * what is planned stops asking whether the site does it, and it costs nothing
 * to say.
 *
 * Access is a VERIFIED identity, adult or scout. The troop password is not
 * enough: everything reachable from here is that person's own record.
 *
 * THIS PAGE IS THE SITE'S FRONT DOOR FOR SIGNING IN (Patrick, 2026-08-16).
 * Sign in and sign out were removed from the utility bar; the Member tab is
 * always in the nav and dead-ends here with a prompt. A sign-in link that
 * only appears once you are signed in cannot be how anyone signs in, and the
 * old utility-bar link was easy to miss on a phone.
 */

import Link from 'next/link';
import { getIdentitySessionIfValid } from '@/lib/family-access';
import { logOutEverywhereAction } from '@/app/_components/site-nav-actions';
// Page furniture (kicker, title, rule, column widths) comes from the same
// stylesheet /signin and /library use — a bare <main> renders unstyled
// against this shell, which is exactly how this page first shipped.
import shell from '../library/library.module.css';
import styles from './member.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Member — Scout Troop 79'
};

interface Card {
  title: string;
  body: string;
  href?: string;
  /** Adults only — /profile is Tier 2 and refuses a scout session. */
  adultOnly?: boolean;
}

const CARDS: Card[] = [
  {
    title: 'Your household',
    body: 'Addresses, phone numbers, birthdates, schools, and the things we should know about your scouts. Changes go to a leader for review.',
    href: '/profile',
    adultOnly: true
  },
  {
    title: 'Scout account',
    body: 'What’s in your scout’s account from fundraising, and what it has been spent on.'
  },
  {
    title: 'Pay for a campout',
    body: 'Settle up for an event online instead of remembering a cheque on the night.'
  },
  {
    title: 'Registration',
    body: 'Your current registration with the national Scouting America office, and when it renews.'
  },
  {
    title: 'Health forms',
    body: 'Which parts of the annual health form we have on file for each member of your household, and when they expire.'
  },
  {
    title: 'Wreath sale',
    body: 'Your orders, totals, and what’s owed during the wreath fundraiser.'
  }
];

export default async function MemberPage() {
  const session = await getIdentitySessionIfValid();

  if (!session) {
    return (
      <>
        <div className={shell.pageHeader}>
          <p className={shell.kicker}>Members</p>
          <h1 className={shell.pageTitle}>Member Sign In</h1>
          <div className={shell.headRule} />
        </div>
        <main className={`${shell.main} ${shell.mainNarrow}`}>
          <div className={styles.gate}>
          <p>
            This is where your own troop information lives &mdash; your household&rsquo;s details
            today, and your scout account, campout payments, registration and health forms as we
            build them.
          </p>
          <p>
            There&rsquo;s no password to remember. Enter the troop password, find your name, and
            we&rsquo;ll send a one-time code to the address we already have for you.
          </p>
          <p style={{ marginTop: '1.5rem' }}>
            <Link
              className={styles.signInBtn}
              href={`/signin?next=${encodeURIComponent('/member')}`}
            >
              Sign in
            </Link>
          </p>
          <p style={{ fontSize: '0.9rem' }}>
            Trouble signing in? Ask a leader &mdash; they can check what address we have for you.
          </p>
          <p style={{ fontSize: '0.9rem' }}>
            Leaders working in the admin: <Link href="/admin/login">troop leader sign in</Link>.
          </p>
          </div>
        </main>
      </>
    );
  }

  const isAdult = session.subjectKind === 'adult';

  return (
    <>
      <div className={shell.pageHeader}>
        <p className={shell.kicker}>Members</p>
        <h1 className={shell.pageTitle}>Members</h1>
        <div className={shell.headRule} />
      </div>
      <main className={shell.main}>
        <p className={styles.intro}>
        Signed in as <strong>{session.displayName}</strong>. Everything here is yours &mdash; your
        household&rsquo;s details, and, as we build them out, the rest of the things families ask us
        for.
      </p>

      <div className={styles.grid}>
        {CARDS.map((card) => {
          // A scout's session is deliberately narrower than an adult's: it
          // never reaches household demographics. Rather than hiding the card
          // and leaving them wondering, say why.
          const live = card.href != null && (!card.adultOnly || isAdult);

          if (live) {
            return (
              <Link key={card.title} href={card.href!} className={`${styles.card} ${styles.cardLive}`}>
                <p className={styles.cardTitle}>{card.title}</p>
                <p className={styles.cardBody}>{card.body}</p>
              </Link>
            );
          }

          const blockedForScout = card.href != null && card.adultOnly && !isAdult;
          return (
            <div key={card.title} className={`${styles.card} ${styles.cardSoon}`}>
              <p className={styles.cardTitle}>
                {card.title}
                <span className={styles.soonTag}>{blockedForScout ? 'Parents' : 'Soon'}</span>
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

      {/* Sign out lives here now rather than in the utility bar — same reason
          sign in does. */}
      <form action={logOutEverywhereAction} style={{ marginBottom: '1.5rem' }}>
        <input type="hidden" name="next" value="/" />
        <button type="submit" className={styles.signOutBtn}>
          Sign out
        </button>
      </form>

      <p className={styles.note}>
          The greyed-out cards aren&rsquo;t built yet. They&rsquo;re listed so you can see
          what&rsquo;s coming &mdash; if one of them would save you a phone call, tell a leader and
          it&rsquo;ll move up the list.
        </p>
      </main>
    </>
  );
}
