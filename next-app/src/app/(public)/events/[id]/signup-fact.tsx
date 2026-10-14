/**
 * The "Signup deadline" card in the event page's fact grid — and, while signups are open, the way in: the whole card
 * is a button-link to /events/[id]/signup (Patrick, 2026-10-13). The old "Signing up" section at the foot of the page
 * folded into it: its status line ("You're signed up: …", spots taken, Closed) is the card's small print, and the
 * family's car/tent placements moved to the signup page, a click away. Rendered inside the page's <dl>, so the link
 * sits in the <dd> and stretches over the card (a <dt>/<dd> may not live inside an <a>).
 */
import Link from 'next/link';
import styles from './event-detail.module.css';

export interface SignupFactProps {
  entryId: number;
  /** Already formatted (fmtDay). */
  deadline: string;
  locked: boolean;
  /** The signed-in family's names on this signup; empty when none (or not signed in). */
  signedUp: string[];
  capacity: { taken: number; of: number; waitlist: boolean } | null;
}

export function SignupFact({ entryId, deadline, locked, signedUp, capacity }: SignupFactProps) {
  const status = locked ? 'Closed' : signedUp.length > 0 ? `✓ You’re signed up: ${signedUp.join(', ')}` : 'Open now';
  const spots =
    capacity &&
    `${capacity.taken} of ${capacity.of} spots taken${capacity.waitlist && capacity.taken >= capacity.of ? ' — waitlist is open' : ''}`;
  return (
    <div className={`${styles.fact} ${locked ? '' : styles.factAction}`} id="signup">
      <dt>Signup deadline</dt>
      <dd>
        {locked ? (
          deadline
        ) : (
          <Link
            href={`/events/${entryId}/signup`}
            className={styles.factLink}
            aria-label={`${signedUp.length > 0 ? 'Change your signup' : 'Sign up'} — deadline ${deadline}`}
          >
            {deadline}
          </Link>
        )}
        <span className={styles.factSub}>{status}</span>
        {spots && <span className={styles.factSub}>{spots}</span>}
        {!locked && (
          <span className={styles.factArrow} aria-hidden="true">
            ›
          </span>
        )}
      </dd>
    </div>
  );
}
