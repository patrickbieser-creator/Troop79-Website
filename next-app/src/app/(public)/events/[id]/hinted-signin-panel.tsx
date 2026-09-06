import type { ReactNode } from 'react';
import { Button } from '@/app/_components/button';
import type { SignInHint, HintCandidate } from '@/lib/signin-hint';
import { TroubleLine } from './signup-panels';
import styles from './event-detail.module.css';

/**
 * Where a Bugle "Register Now" click lands when nobody who can write is
 * signed in (Plans/Bugle-Register-Now-Links.md). The newsletter's address
 * has already been resolved into the hint cookie; this only has to ask.
 *
 * Three shapes, one component (decisions B3, B4, B9):
 *   one adult        → "Continue as Dana Rivera?"  [Email me a code]
 *   several people   → one button per person, adults first
 *   scout(s) only    → the household's adults, by name (D-246: a code goes
 *                      only to the picked person's own inbox — never
 *                      rerouted from a scout to a parent silently)
 *
 * `passkey` is the one-tap control the page renders when this browser is a
 * known passkey holder (B6, passkeyPlacement); it leads, the code follows.
 * "Not you?" always reaches the ordinary sign-in — a forwarded newsletter
 * must never trap the reader behind someone else's name.
 *
 * Pure: the page reads the cookie and hands the result in, so the dom tests
 * render this without a request context.
 */
export function HintedSignInPanel({
  hint,
  next,
  sendAction,
  passkey
}: {
  hint: SignInHint;
  next: string;
  sendAction: (formData: FormData) => Promise<void>;
  passkey: ReactNode | null;
}) {
  const adultsOnly = hint.candidates.every((c) => c.subjectKind === 'adult');
  const scoutsOnly = hint.candidates.every((c) => c.subjectKind === 'scout');
  const single = hint.candidates.length === 1 && adultsOnly ? hint.candidates[0] : null;

  const notYou = (
    <p className={styles.hintNotYou}>
      <Button variant="ghost" href={`/signin?next=${encodeURIComponent(next)}`}>
        Not you? Sign in as someone else
      </Button>
    </p>
  );

  if (single) {
    return (
      <section className={styles.signInPanel} aria-labelledby="hinted-sign-in">
        <h2 id="hinted-sign-in" className={styles.signInPanelTitle}>
          Continue as <strong>{single.displayName}</strong>?
        </h2>
        <p className={styles.signInPanelText}>
          Signing a family up needs a parent&rsquo;s sign-in, so the troop knows who said yes.
          We&rsquo;ll email a one-time code to <strong>{single.maskedEmail}</strong>
          {' '}&mdash; it keeps you signed in on this device for four months.
        </p>
        {passkey}
        <SendForm person={single} next={next} sendAction={sendAction} label="Email me a code" />
        {notYou}
        <TroubleLine />
      </section>
    );
  }

  if (scoutsOnly) {
    const scoutNames = hint.candidates.map((c) => c.displayName).join(' and ');
    return (
      <section className={styles.signInPanel} aria-labelledby="hinted-sign-in">
        <h2 id="hinted-sign-in" className={styles.signInPanelTitle}>
          Sign in as a parent
        </h2>
        <p className={styles.signInPanelText}>
          That address is <strong>{scoutNames}</strong>&rsquo;s, and signing up for an event needs a
          parent or guardian to say yes.
          {hint.parents.length > 0 ? (
            <> We can email a one-time code to:</>
          ) : (
            <>
              {' '}
              We don&rsquo;t have an email on file for a parent in this household &mdash; ask a leader
              to add one, and they can sign your family up meanwhile.
            </>
          )}
        </p>
        {hint.parents.length > 0 && (
          <div className={styles.hintChoices}>
            {hint.parents.map((p) => (
              <SendForm key={p.personId} person={p} next={next} sendAction={sendAction} label={`Email ${p.displayName} a code`} />
            ))}
          </div>
        )}
        {notYou}
        <TroubleLine />
      </section>
    );
  }

  return (
    <section className={styles.signInPanel} aria-labelledby="hinted-sign-in">
      <h2 id="hinted-sign-in" className={styles.signInPanelTitle}>
        Who&rsquo;s signing in?
      </h2>
      <p className={styles.signInPanelText}>
        That address is shared. Pick yourself and we&rsquo;ll email a one-time code to{' '}
        <strong>{hint.candidates[0].maskedEmail}</strong>. Signing a family up needs a parent, so a scout
        who picks their own name will be asked to hand this to one.
      </p>
      {passkey}
      <div className={styles.hintChoices}>
        {hint.candidates.map((c) => (
          <SendForm key={c.personId} person={c} next={next} sendAction={sendAction} label={`Email ${c.displayName} a code`} />
        ))}
      </div>
      {notYou}
      <TroubleLine />
    </section>
  );
}

function SendForm({
  person,
  next,
  sendAction,
  label
}: {
  person: HintCandidate;
  next: string;
  sendAction: (formData: FormData) => Promise<void>;
  label: string;
}) {
  return (
    <form action={sendAction}>
      <input type="hidden" name="personId" value={person.personId} />
      <input type="hidden" name="next" value={next} />
      <Button variant="primary" type="submit">
        {label}
      </Button>
    </form>
  );
}
