import styles from './event-detail.module.css';

/**
 * WHO is signed in, and for WHICH household — one bar, both signup forms
 * (Plans/Verified-Signup.md, Patrick 2026-08-26: "be consistently obvious as
 * to who's logged in"). Replaces the person-first page's household line and
 * the slot-first board's own status bar, which said the household but never
 * the person.
 *
 * No hooks, no server-only imports: the slot-first form (a Client Component)
 * renders it inside its own <form>, so sign-out there is a `formAction`
 * button rather than a nested form (nested forms are invalid HTML and React
 * reports a hydration error). The page renders it standalone with `nested`
 * off and gets a real <form>.
 */
export function SignupStatusBar({
  signedInAs,
  household,
  changeHref,
  signOut,
  nested = false
}: {
  /** Display name of the verified person or leader; null = troop-password-only. */
  signedInAs: string | null;
  /** The household being signed up, or null when none is chosen yet. */
  household: { label: string; standaloneAdult: boolean } | null;
  /** "Change household" target — omit to hide the link. */
  changeHref?: string;
  /** Sign-out Server Action + where to land; null hides the button. */
  signOut: { action: (fd: FormData) => void; next: string } | null;
  nested?: boolean;
}) {
  const inner = (
    <>
      <span>
        {signedInAs ? (
          <>
            Signed in as <strong>{signedInAs}</strong>
          </>
        ) : (
          <>&#10003; You&rsquo;re signed in</>
        )}
        {household ? (
          household.standaloneAdult ? (
            <> &mdash; signing up {household.label}</>
          ) : (
            <>
              {' '}
              &mdash; signing up the <strong>{household.label}</strong> household
            </>
          )
        ) : (
          <> &mdash; no family chosen yet</>
        )}
      </span>
      <span className={styles.boardStatusActions}>
        {household && changeHref && (
          <a href={changeHref} className={styles.linkBtn}>
            Change household
          </a>
        )}
        {signOut && (
          <button type="submit" className={styles.linkBtn} formAction={nested ? signOut.action : undefined}>
            Sign out
          </button>
        )}
      </span>
    </>
  );
  if (nested || !signOut) return <div className={styles.boardStatus}>{inner}</div>;
  return (
    <form action={signOut.action} className={styles.boardStatus}>
      <input type="hidden" name="next" value={signOut.next} />
      {inner}
    </form>
  );
}
