/**
 * /member — the signed-in member's home.
 *
 * One place a family lands after signing in, rather than having to know that
 * their household details live at /profile and nothing else has a home yet.
 * Scout account balances now live at /member/scout-account
 * (Plans/Troop-Finances.md Phase 3) — the rest of what belongs here still
 * does not exist: paying for a campout, national registration status,
 * health form dates, wreath sale. Those stay listed as "coming soon" ON
 * PURPOSE — a member who can see what is planned stops asking whether the
 * site does it, and it costs nothing to say.
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
import { createAdminClient } from '@/lib/supabase/server';
import { listPasskeys, passkeysConfigured } from '@/lib/passkeys';
import { PasskeyManager } from './passkey-manager';
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

  const isAdult = session.subjectKind === 'adult';
  // Adults only — see PasskeyManager's header for why scouts stay on codes.
  const passkeys = isAdult ? await listPasskeys(createAdminClient(), session.personId) : [];

  return (
    <>
      <PageHeader kicker="Members" title="Members" />
      <PageShell>
        <div className={styles.identityRow}>
          <p className={styles.intro}>
            Signed in as <strong>{session.displayName}</strong>. Everything here is yours &mdash;
            your household&rsquo;s details, and, as we build them out, the rest of the things
            families ask us for.
          </p>
          {/* Paired with the identity it acts on, rather than stranded at the
              bottom of the page — "this is who you are" and "stop being them"
              belong on the same line. */}
          <form action={logOutEverywhereAction} className={styles.signOutForm}>
            <input type="hidden" name="next" value="/" />
            <button type="submit" className={styles.signOutBtn}>
              Sign Out
            </button>
          </form>
        </div>

      <div className={styles.grid}>
        {CARDS.map((card) => {
          // A scout's session is deliberately narrower than an adult's: it
          // never reaches household demographics. Rather than hiding the card
          // and leaving them wondering, say why.
          const live = card.href != null && (!card.adultOnly || isAdult);

          if (live) {
            return (
              <Link
                key={card.title}
                href={card.href!}
                className={`${surface.card} ${styles.card} ${styles.cardLive}`}
              >
                <p className={styles.cardTitle}>{card.title}</p>
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

      {isAdult && (
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
