'use client';

/**
 * The one-time "sign in faster next time" offer (Plans/Verified-Signup.md,
 * Phase A acceptance criterion): shown once, right after a code/link
 * sign-in that started from a signup page — the one moment someone has just
 * proven who they are and is already in a security frame of mind.
 *
 * MOUNTING IS THE PAGE'S JOB, NOT THIS COMPONENT'S. This component knows
 * nothing about who is signed in or whether they already hold a passkey —
 * the page decides whether to render it at all (the `?welcome=1` signal set
 * by signin/actions.ts's withWelcomeFlag(), AND hasPasskey() from
 * lib/passkeys.ts coming back false). Adults-only is enforced independently,
 * server-side, by passkeyRegisterOptionsAction()'s requireAdultForPasskey()
 * — a scout session gets a thrown error here, not a UI branch, exactly the
 * same ceremony passkey-manager.tsx (/member) uses.
 *
 * Dismissed-or-registered is remembered in localStorage so the offer never
 * reappears on this browser. Default state matches what the server rendered
 * (shown) — the stored value is read back in an effect, after mount, the
 * same lazy-hydration shape as library/mb-grid.tsx's view-mode memory, so
 * there is no hydration mismatch between server and first client render.
 */

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { passkeyRegisterOptionsAction, passkeyRegisterVerifyAction } from '../../signin/actions';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import surface from '@/app/_components/card.module.css';
import styles from './passkey-offer.module.css';

const DISMISSED_KEY = 't79_passkey_offer_dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private mode / blocked storage — showing the offer again is harmless.
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Remembering the dismissal is a convenience, not a feature.
  }
}

/** `next` names where this offer is being shown from (the signup page's own
 *  path) — kept as part of the props contract so the "Manage on your
 *  profile" link can carry it forward as a return path, the same `next`
 *  convention every other identity surface in this app uses. */
export function PasskeyOffer({ next }: { next: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (readDismissed()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(true);
    }
  }, []);

  if (dismissed) return null;

  function dismiss() {
    rememberDismissed();
    setDismissed(true);
  }

  function register() {
    setError(null);
    startTransition(async () => {
      try {
        const optionsJson = await passkeyRegisterOptionsAction();
        if (!optionsJson) {
          setError('Passkeys aren’t set up on this server yet.');
          return;
        }
        const response = await startRegistration({ optionsJSON: JSON.parse(optionsJson) });
        // A human-readable device label — same heuristic as passkey-manager.tsx.
        const uaMatch =
          typeof navigator !== 'undefined' ? /iPhone|iPad|Android|Mac|Windows/.exec(navigator.userAgent) : null;
        const nickname = uaMatch ? uaMatch[0] : 'This device';
        const result = await passkeyRegisterVerifyAction(JSON.stringify(response), nickname);
        if (result.ok) {
          rememberDismissed();
          setDone(true);
        } else {
          setError(result.error ?? 'That didn’t work.');
        }
      } catch (e) {
        // startRegistration() wraps native errors as a WebAuthnError
        // (@simplewebauthn/browser) with a stable `.code` — same branching as
        // passkey-manager.tsx, including the UV-unsupported case (D-124).
        const code = e instanceof Error && 'code' in e ? (e as { code?: string }).code : undefined;
        const msg = e instanceof Error ? e.message : '';
        if (
          code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' ||
          code === 'ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE'
        ) {
          setError(
            'This device needs a fingerprint, PIN, or passcode set up before it can be used as a passkey here.'
          );
          return;
        }
        if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || /already registered|excluded/i.test(msg)) {
          setError('This device already has a passkey for your account.');
          return;
        }
        if (code === 'ERROR_CEREMONY_ABORTED' || /abort|cancel|NotAllowed/i.test(msg)) return;
        setError('Your device didn’t complete that — try again.');
      }
    });
  }

  return (
    <div className={`${surface.card} ${surface.cardPad} ${styles.offer}`}>
      <h2 className={styles.heading}>
        Next time, sign in with your phone, fingerprint, or face &mdash; no code to type.
      </h2>

      {done ? (
        <>
          <Notice tone="success">Done &mdash; next time it&rsquo;s one tap.</Notice>
          <p className={styles.manage}>
            <Link href={`/member?next=${encodeURIComponent(next)}`}>Manage on your profile</Link>
          </p>
        </>
      ) : (
        <div className={styles.actions}>
          <Button variant="primary" disabled={pending} onClick={register}>
            {pending ? 'Waiting for your device…' : 'Set it up'}
          </Button>
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      )}

      {error ? (
        <Notice tone="error" className={styles.notice}>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
