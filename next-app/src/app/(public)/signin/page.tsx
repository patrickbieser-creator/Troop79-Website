/**
 * /signin — passwordless sign-in (Plans/Family-Identity-Auth.md Phase 1).
 * Two states on one page: request (enter email) → sent (enter the 6-digit
 * code, or use the link in the email instead — that lands on /signin/verify).
 * Reuses the Library's form/gate styling (library.module.css) rather than
 * duplicating another near-identical CSS module — see that file for the
 * class shapes (formCard/fieldRow/btnPrimary/etc.) already used by every
 * other gated form in this app.
 */
import Link from 'next/link';
import { emailConfigured } from '@/lib/email';
import { requestSignInAction, verifyCodeAction } from './actions';
import styles from '../library/library.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign In — Scout Troop 79'
};

const ERR_MESSAGES: Record<string, string> = {
  missing: 'Enter your email to continue.',
  // Deliberately the SAME message whether the code was simply wrong or the
  // token is now locked out after too many attempts — a distinguishable
  // ?err= value between the two would let a guesser learn whether an email
  // is on the roster by whether repeated wrong guesses ever "lock"
  // (qa-lead review 2026-08-06; see signin/actions.ts's verifyCodeAction).
  invalid: 'That code didn’t match — check it and try again, or use the link in the email instead.'
};

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ sent?: string; email?: string; next?: string; err?: string }>;
}) {
  const { sent, email, next, err } = await searchParams;
  const configured = emailConfigured();

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>Sign In</p>
        <h1 className={styles.pageTitle}>Sign In</h1>
        <p className={styles.pageLede}>
          No password to remember — enter your email and we&rsquo;ll send you a one-time code
          and link.
        </p>
        <div className={styles.headRule} />
      </div>

      <main className={`${styles.main} ${styles.mainNarrow}`} style={{ maxWidth: 480 }}>
        {!configured && (
          <p className={styles.fieldError} style={{ marginBottom: 16 }}>
            Email sign-in isn&rsquo;t configured on this server yet — ask a leader for a
            one-time code instead.
          </p>
        )}

        {sent === '1' ? (
          <CodeForm email={email} next={next} err={err} />
        ) : (
          <RequestForm email={email} next={next} err={err} configured={configured} />
        )}

        {/* Consolidated nav login (Patrick, 2026-08-06: "Consolidate all
            logins under member login. Having two sign ins is confusing.") —
            the public nav now has one entry point, this page. Leaders and
            scouts still use the separate shared-password login
            (lib/leader-session.ts is a different credential entirely, not a
            passwordless email — see that module's header), reached from
            here rather than a second top-level nav link. */}
        <p style={{ marginTop: 24, textAlign: 'center' }}>
          <Link className={styles.divLink} href="/admin/login">
            Leader or Scout? Sign in with the troop password
          </Link>
        </p>
      </main>
    </>
  );
}

function RequestForm({
  email,
  next,
  err,
  configured
}: {
  email?: string;
  next?: string;
  err?: string;
  configured: boolean;
}) {
  return (
    <form className={styles.formCard} action={requestSignInAction}>
      {next && <input type="hidden" name="next" value={next} />}
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="email">
          Email
        </label>
        <input
          className={styles.textInput}
          type="email"
          id="email"
          name="email"
          autoComplete="email"
          defaultValue={email}
          placeholder="you@example.com"
          disabled={!configured}
        />
        <p className={styles.fieldHint}>
          If that address is on our roster, a code is on its way. Nothing happens for an
          address we don&rsquo;t recognize — no error either way.
        </p>
      </div>

      <button className={styles.btnPrimary} type="submit" disabled={!configured}>
        Send Code
      </button>
    </form>
  );
}

function CodeForm({ email, next, err }: { email?: string; next?: string; err?: string }) {
  return (
    <>
      <div className={styles.formCard}>
        <div className={styles.confirmDone}>
          <div className={styles.bigCheck} aria-hidden="true">
            ✓
          </div>
          <h2 className={styles.confirmTitle}>Check your email</h2>
          <p className={styles.confirmText}>
            If that address is on our roster, a 6-digit code and a sign-in link are on the
            way. Enter the code below, or tap the link in the email — either one works.
          </p>
        </div>

        {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

        <form action={verifyCodeAction}>
          <input type="hidden" name="email" value={email ?? ''} />
          {next && <input type="hidden" name="next" value={next} />}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="code">
              6-digit code
            </label>
            <input
              className={styles.textInput}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              id="code"
              name="code"
              maxLength={6}
              placeholder="123456"
            />
          </div>
          <button className={styles.btnPrimary} type="submit">
            Continue
          </button>
        </form>
      </div>

      <form action={requestSignInAction} style={{ marginTop: 12, textAlign: 'center' }}>
        <input type="hidden" name="email" value={email ?? ''} />
        {next && <input type="hidden" name="next" value={next} />}
        <button className={styles.btnSecondary} type="submit">
          Resend code
        </button>
      </form>

      <p style={{ marginTop: 16, textAlign: 'center' }}>
        <Link className={styles.divLink} href="/signin">
          Use a different email
        </Link>
      </p>
    </>
  );
}
