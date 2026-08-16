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
import { hasFamilyAccess } from '@/lib/family-access';
import { loadSignInCandidates, type SignInCandidate } from '@/lib/signin-roster';
import {
  requestSignInAction,
  verifyCodeAction,
  unlockRosterAction,
  requestForPersonAction,
  verifyCodeForPersonAction
} from './actions';
import styles from '../library/library.module.css';
import pick from './signin.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign In — Scout Troop 79'
};

const ERR_MESSAGES: Record<string, string> = {
  missing: 'Enter your email to continue.',
  'bad-password': 'That isn’t the troop password — check the Bugle, or ask a leader.',
  'not-configured': 'The troop password isn’t set on this server yet — ask a leader.',
  unreachable:
    'We don’t have an email address on file for you, so there’s nothing to send. Ask a leader — they can add one, or sign you in another way.',
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
  searchParams: Promise<{
    sent?: string;
    email?: string;
    next?: string;
    err?: string;
    pick?: string;
    person?: string;
    masked?: string;
  }>;
}) {
  const { sent, email, next, err, pick, person, masked } = await searchParams;
  const configured = emailConfigured();
  // The troop password gates the roster, nothing else (Phase D, decision 3).
  const rosterUnlocked = pick === '1' || (await hasFamilyAccess());
  const candidates = rosterUnlocked && sent !== '1' ? await loadSignInCandidates() : [];

  return (
    <>
      <div className={styles.pageHeader}>
        <p className={styles.kicker}>Sign In</p>
        <h1 className={styles.pageTitle}>Sign In</h1>
        <p className={styles.pageLede}>
          No password to remember — find your name and we&rsquo;ll send a one-time code to the
          email we already have for you.
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
          person ? (
            <PersonCodeForm personId={person} masked={masked} next={next} err={err} />
          ) : (
            <CodeForm email={email} next={next} err={err} />
          )
        ) : rosterUnlocked ? (
          <NamePicker candidates={candidates} next={next} err={err} configured={configured} />
        ) : (
          <PasswordGate next={next} err={err} />
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

/**
 * Step 1 — the troop password, in its new job.
 *
 * It grants nothing. It unlocks the roster on the next screen, and the thing
 * you leave that screen with is still a per-person, revocable identity
 * session. Kept as a familiar single string so nothing gets harder for a
 * family that already knows it.
 */
function PasswordGate({ next, err }: { next?: string; err?: string }) {
  return (
    <form className={styles.formCard} action={unlockRosterAction}>
      {next && <input type="hidden" name="next" value={next} />}
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="password">
          Troop password
        </label>
        <input
          className={styles.textInput}
          type="password"
          id="password"
          name="password"
          autoComplete="off"
        />
        <p className={styles.fieldHint}>
          The one from the Bugle. This just brings up the list of names &mdash; you&rsquo;ll still
          sign in as yourself on the next screen.
        </p>
      </div>

      <button className={styles.btnPrimary} type="submit">
        Find my name
      </button>
    </form>
  );
}

function CandidateRow({
  candidate,
  next,
  configured
}: {
  candidate: SignInCandidate;
  next?: string;
  configured: boolean;
}) {
  if (!candidate.maskedEmail) {
    // Listed, not hidden. Hiding someone with no address recreates the dead
    // end this whole change removes: they need to see their own name and be
    // told what to do, not fail to find themselves and assume it is broken.
    return (
      <div className={pick.pickRowEmpty}>
        <span>{candidate.displayName}</span>
        <span className={pick.pickMeta}>no email on file &mdash; ask a leader</span>
      </div>
    );
  }
  return (
    <form action={requestForPersonAction}>
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="personId" value={candidate.personId} />
      <button type="submit" className={pick.pickRow} disabled={!configured}>
        <span className={pick.pickName}>{candidate.displayName}</span>
        <span className={pick.pickMeta}>{candidate.maskedEmail}</span>
      </button>
    </form>
  );
}

/**
 * Step 2 — "find yourself".
 *
 * The destination is shown MASKED, resolved server-side (lib/signin-roster.ts).
 * Showing it is the whole point: the failure this replaces is a parent who
 * cannot remember which address the troop holds, and a masked hint answers
 * that without handing out contact details.
 */
function NamePicker({
  candidates,
  next,
  err,
  configured
}: {
  candidates: SignInCandidate[];
  next?: string;
  err?: string;
  configured: boolean;
}) {
  const groups: [string, SignInCandidate[]][] = [
    ['Parents & leaders', candidates.filter((c) => !c.isScout)],
    ['Scouts', candidates.filter((c) => c.isScout)]
  ];

  return (
    <div className={styles.formCard}>
      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}
      <p className={styles.fieldHint} style={{ marginTop: 0 }}>
        Tap your name. We&rsquo;ll send a one-time code to the address shown &mdash; you
        don&rsquo;t need to remember which one it is.
      </p>

      {groups.map(([label, rows]) =>
        rows.length === 0 ? null : (
          <div key={label} className={pick.pickGroup}>
            <p className={styles.fieldLabel}>{label}</p>
            <ul className={pick.pickList}>
              {rows.map((c) => (
                <li key={c.personId}>
                  <CandidateRow candidate={c} next={next} configured={configured} />
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      <details className={pick.pickFallback}>
        <summary>Not on the list, or the address shown is wrong?</summary>
        <p className={styles.fieldHint}>
          Type an address instead &mdash; or ask a leader, who can fix what we have on file.
        </p>
        <form action={requestSignInAction}>
          {next && <input type="hidden" name="next" value={next} />}
          <input
            className={styles.textInput}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            disabled={!configured}
          />
          <button className={styles.btnPrimary} type="submit" disabled={!configured}>
            Send Code
          </button>
        </form>
      </details>
    </div>
  );
}

/** Code entry for the picker path — keyed on the person, not an address. */
function PersonCodeForm({
  personId,
  masked,
  next,
  err
}: {
  personId: string;
  masked?: string;
  next?: string;
  err?: string;
}) {
  return (
    <div className={styles.formCard}>
      <div className={styles.confirmDone}>
        <div className={styles.bigCheck} aria-hidden="true">
          &#10003;
        </div>
        <p>
          Code sent{masked ? <> to <strong>{masked}</strong></> : null}. It expires in 15 minutes.
        </p>
      </div>

      {err && ERR_MESSAGES[err] && <p className={styles.fieldError}>{ERR_MESSAGES[err]}</p>}

      <form action={verifyCodeForPersonAction}>
        <input type="hidden" name="personId" value={personId} />
        {masked && <input type="hidden" name="masked" value={masked} />}
        {next && <input type="hidden" name="next" value={next} />}
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="code">
            6-digit code
          </label>
          <input
            className={styles.textInput}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
          />
        </div>
        <button className={styles.btnPrimary} type="submit">
          Sign In
        </button>
      </form>

      <form action={requestForPersonAction} className={pick.resendRow}>
        <input type="hidden" name="personId" value={personId} />
        {next && <input type="hidden" name="next" value={next} />}
        <button type="submit" className={pick.resendBtn}>
          Send another code
        </button>
      </form>
    </div>
  );
}
