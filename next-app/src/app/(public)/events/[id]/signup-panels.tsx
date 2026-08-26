import { Button } from '@/app/_components/button';
import { troopEmail } from '@/lib/email';
import styles from './event-detail.module.css';

/**
 * The two "you can't write yet" panels (Plans/Verified-Signup.md Phase A).
 * The troop password got the visitor to first base — they can read the event
 * and reach /signin — and these say what second base is.
 */

/** "Trouble signing in?" — no phone number and no title on the site
 *  (Patrick, 2026-08-26): families have his number through other channels,
 *  and Mindy is the Scoutmaster. Shown on /signin and on the panel. */
export function TroubleLine() {
  return (
    <p className={styles.troubleLine}>
      Trouble signing in? Text Patrick &mdash; or email{' '}
      <a href={`mailto:${troopEmail()}`}>{troopEmail()}</a>.
    </p>
  );
}

export function SignInToSignUpPanel({ next }: { next: string }) {
  return (
    <section className={styles.signInPanel} aria-labelledby="sign-in-to-sign-up">
      <h2 id="sign-in-to-sign-up" className={styles.signInPanelTitle}>
        Sign in to sign up
      </h2>
      <p className={styles.signInPanelText}>
        Signing a family up needs a parent&rsquo;s sign-in, so the troop knows who said yes. Find
        your name and we&rsquo;ll email you a one-time code &mdash; about a minute, and it keeps
        you signed in on this device for four months.
      </p>
      <Button variant="primary" href={`/signin?next=${encodeURIComponent(next)}`}>
        Sign in
      </Button>
      <TroubleLine />
    </section>
  );
}

export function AskAParentPanel({ signedInAs, next }: { signedInAs: string | null; next: string }) {
  return (
    <section className={styles.signInPanel} aria-labelledby="ask-a-parent">
      <h2 id="ask-a-parent" className={styles.signInPanelTitle}>
        Ask a parent to sign in
      </h2>
      <p className={styles.signInPanelText}>
        {signedInAs ? (
          <>
            You&rsquo;re signed in as <strong>{signedInAs}</strong>.{' '}
          </>
        ) : null}
        Signing up for an event needs a parent or guardian to say yes. Hand them this device, or
        send them the link &mdash; they sign in with their own name and the signup is theirs.
      </p>
      <Button variant="primary" href={`/signin?next=${encodeURIComponent(next)}`}>
        Parent sign-in
      </Button>
      <TroubleLine />
    </section>
  );
}
