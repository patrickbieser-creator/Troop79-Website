/**
 * /signin — passwordless sign-in (Plans/Family-Identity-Auth.md Phase 1).
 * Two states on one page: request (enter email) → sent (enter the 6-digit
 * code, or use the link in the email instead — that lands on /signin/verify).
 * Form furniture comes from the shared public components (_components/form,
 * button, notice — Public Design System Phase A); signin.module.css keeps
 * only this screen's own layout.
 */
import { emailConfigured } from '@/lib/email';
import { hasFamilyAccess } from '@/lib/family-access';
import { NameSearch } from './name-search';
import { cookies } from 'next/headers';
import { PasskeyButton } from './passkey-button';
import { PasskeyAutofill } from './passkey-autofill';
import { TroubleLine } from '../events/[id]/signup-panels';
import { passkeysConfigured, passkeyPlacement, PASSKEY_HINT_COOKIE } from '@/lib/passkeys';
import {
  passkeyAuthOptionsAction,
  passkeyAuthVerifyAction,
  requestSignInAction,
  verifyCodeAction,
  unlockRosterAction,
  requestForPersonAction,
  verifyCodeForPersonAction,
  searchRosterAction
} from './actions';
import styles from './signin.module.css';
import { PageHeader } from '@/app/_components/page-header';
import { PageShell } from '@/app/_components/page-shell';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import { FormCard, Field, TextInput, FieldHint } from '@/app/_components/form';
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
  'rate-limited':
    'You’ve asked for several codes in a short time, so we’ve paused sending. Use the most recent email you received, or wait a few minutes and try again.',
  failed: 'Something went wrong sending that code. Try again in a moment.',
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
    // `pick=1` still arrives on the redirect unlockRosterAction issues
    // (harmless — it's cosmetic now) and on old bookmarked/history URLs, but
    // it is deliberately NOT read here anymore. See the security note on
    // rosterUnlocked below.
    person?: string;
    masked?: string;
    via?: string;
  }>;
}) {
  const { sent, email, next, err, person, masked, via } = await searchParams;
  const configured = emailConfigured();
  // The troop password gates the roster, nothing else (Phase D, decision 3).
  //
  // SECURITY: this must be the ONLY check. It used to be `pick === '1' ||
  // hasFamilyAccess()` — unlockRosterAction sets the real session cookie
  // and THEN redirects to `?pick=1` so the picker renders on the very next
  // request, but `pick=1` is a public URL parameter with no relationship to
  // that cookie. Once it's in the address bar or browser history, anyone
  // who revisits it — no cookie, no password, ever — skipped the gate
  // entirely (found live in production 2026-08-17, reported as recurring:
  // "this has happened several times"). hasFamilyAccess() alone is
  // sufficient — the cookie unlockRosterAction sets is already present by
  // the time this redirect lands, so dropping the `pick` branch changes
  // nothing for the legitimate flow and closes the forgery.
  const rosterUnlocked = await hasFamilyAccess();
  const passkeys = passkeysConfigured();
  // Placement only (Patrick, 2026-08-21): a browser that has registered or
  // used a passkey here carries an identity-free hint cookie → the one-tap
  // button leads; otherwise it sits quietly at the bottom so a first-time
  // member isn't asked for something they don't have. Both paths render.
  const deviceSeen = (await cookies()).get(PASSKEY_HINT_COOKIE.name)?.value === '1';
  const placement = passkeyPlacement(deviceSeen);

  return (
    <>
      <PageHeader
        kicker="Sign In"
        title="Sign In"
        lede={
          <>
            No password to remember — find your name and we&rsquo;ll send a one-time code to the
            email we already have for you.
          </>
        }
      />

      <PageShell width="narrow" className={pick.shell}>
        {!configured && (
          <Notice tone="error" className={pick.errGap}>
            Email sign-in isn&rsquo;t configured on this server yet — ask a leader for a
            one-time code instead.
          </Notice>
        )}

        {sent !== '1' && passkeys && (
          <PasskeyAutofill next={next} getOptions={passkeyAuthOptionsAction} verify={passkeyAuthVerifyAction} />
        )}
        {sent !== '1' && passkeys && placement === 'primary' && (
          <PasskeyButton
            next={next}
            getOptions={passkeyAuthOptionsAction}
            verify={passkeyAuthVerifyAction}
          />
        )}

        {sent === '1' ? (
          person ? (
            <PersonCodeForm personId={person} masked={masked} viaParent={via === 'parent'} next={next} err={err} />
          ) : (
            <CodeForm email={email} next={next} err={err} />
          )
        ) : rosterUnlocked ? (
          <NamePicker next={next} err={err} configured={configured} />
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
        <TroubleLine />

        <p className={styles.centerRow}>
          <Button variant="ghost" href="/admin/login">
            Leader or Scout? Sign in with the troop password
          </Button>
        </p>
      </PageShell>
    </>
  );
}


function CodeForm({ email, next, err }: { email?: string; next?: string; err?: string }) {
  return (
    <>
      <FormCard>
        <div className={pick.confirmDone}>
          <div className={pick.bigCheck} aria-hidden="true">
            ✓
          </div>
          <h2 className={pick.confirmTitle}>Check your email</h2>
          <p className={pick.confirmText}>
            If that address is on our roster, a 6-digit code and a sign-in link are on the
            way. Enter the code below, or tap the link in the email — either one works.
          </p>
        </div>

        {err && ERR_MESSAGES[err] && (
          <Notice tone="error" className={pick.errGap}>
            {ERR_MESSAGES[err]}
          </Notice>
        )}

        <form action={verifyCodeAction}>
          <input type="hidden" name="email" value={email ?? ''} />
          {next && <input type="hidden" name="next" value={next} />}
          <Field label="6-digit code">
            <TextInput
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              name="code"
              maxLength={6}
              placeholder="123456"
            />
          </Field>
          <Button variant="primary" type="submit">
            Continue
          </Button>
        </form>
      </FormCard>

      <form action={requestSignInAction} className={styles.centerRowSm}>
        <input type="hidden" name="email" value={email ?? ''} />
        {next && <input type="hidden" name="next" value={next} />}
        <Button variant="secondary" type="submit">
          Resend code
        </Button>
      </form>

      <p className={styles.centerRowMd}>
        <Button variant="ghost" href="/signin">
          Use a different email
        </Button>
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
    <FormCard>
      <form action={unlockRosterAction}>
        {next && <input type="hidden" name="next" value={next} />}
        {err && ERR_MESSAGES[err] && (
          <Notice tone="error" className={pick.errGap}>
            {ERR_MESSAGES[err]}
          </Notice>
        )}

        <Field
          label="Troop password"
          hint={
            <>
              The one from the Bugle. This just brings up the list of names &mdash; you&rsquo;ll
              still sign in as yourself on the next screen.
            </>
          }
        >
          {/* `webauthn` token (alone — NOT "username"/"current-password", which
              would invite password managers to save the shared troop password):
              lets the browser offer a stored passkey for this site in this
              field's autofill via the conditional-UI ceremony PasskeyAutofill
              starts on load. Browsers without one show nothing here. */}
          <TextInput type="password" name="password" autoComplete="webauthn" />
        </Field>

        <Button variant="primary" type="submit">
          Find my name
        </Button>
      </form>
    </FormCard>
  );
}


/**
 * Step 2 — "find yourself".
 *
 * A search box, not a list (Patrick, 2026-08-16). The first cut rendered
 * every eligible person; it did not resolve well on a phone, and it handed
 * the whole roster to anyone with the troop password. Nothing appears until
 * two characters are typed, and the matching happens server-side, so the
 * roster never reaches the browser at all.
 *
 * Matching runs against the FULL name — typing "Bieser" finds "Patrick B." —
 * while only the abbreviated label comes back. The surname is a search key
 * the server holds, never a value the client is handed.
 */
function NamePicker({
  next,
  err,
  configured
}: {
  next?: string;
  err?: string;
  configured: boolean;
}) {
  return (
    <FormCard>
      {err && ERR_MESSAGES[err] && (
        <Notice tone="error" className={pick.errGap}>
          {ERR_MESSAGES[err]}
        </Notice>
      )}
      <FieldHint className={pick.hintTop}>
        Find your name and we&rsquo;ll send a one-time code to the address we already have for you
        &mdash; you don&rsquo;t need to remember which one it is.
      </FieldHint>

      <NameSearch
        next={next}
        configured={configured}
        search={searchRosterAction}
        onPick={requestForPersonAction}
      />

      <details className={pick.pickFallback}>
        <summary>Can&rsquo;t find yourself, or the address shown is wrong?</summary>
        <FieldHint>
          Type an address instead &mdash; or ask a leader, who can fix what we have on file.
        </FieldHint>
        <form action={requestSignInAction}>
          {next && <input type="hidden" name="next" value={next} />}
          <TextInput
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            disabled={!configured}
          />
          <Button variant="primary" type="submit" disabled={!configured}>
            Send Code
          </Button>
        </form>
      </details>
    </FormCard>
  );
}

/** Code entry for the picker path — keyed on the person, not an address. */
function PersonCodeForm({
  personId,
  masked,
  viaParent = false,
  next,
  err
}: {
  personId: string;
  masked?: string;
  /** The code went to a PARENT's address (scout with no email of their own). */
  viaParent?: boolean;
  next?: string;
  err?: string;
}) {
  return (
    <FormCard>
      <div className={pick.confirmDone}>
        <div className={pick.bigCheck} aria-hidden="true">
          &#10003;
        </div>
        <p>
          {viaParent ? (
            <>
              You don&rsquo;t have an email on the roster, so the code went to a parent&rsquo;s address
              {masked ? <> &mdash; <strong>{masked}</strong></> : null}. Ask them for it.
            </>
          ) : (
            <>Code sent{masked ? <> to <strong>{masked}</strong></> : null}.</>
          )}{' '}
          It expires in 15 minutes.
        </p>
      </div>

      {err && ERR_MESSAGES[err] && (
        <Notice tone="error" className={pick.errGap}>
          {ERR_MESSAGES[err]}
        </Notice>
      )}

      <form action={verifyCodeForPersonAction}>
        <input type="hidden" name="personId" value={personId} />
        {masked && <input type="hidden" name="masked" value={masked} />}
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="6-digit code">
          <TextInput
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
          />
        </Field>
        <Button variant="primary" type="submit">
          Sign In
        </Button>
      </form>

      <form action={requestForPersonAction} className={pick.resendRow}>
        <input type="hidden" name="personId" value={personId} />
        {next && <input type="hidden" name="next" value={next} />}
        <Button variant="ghost" type="submit">
          Send another code
        </Button>
      </form>
    </FormCard>
  );
}
