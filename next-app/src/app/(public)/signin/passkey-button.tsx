'use client';

/**
 * "Sign in with a passkey" — the one-tap path
 * (Plans/Family-Identity-Auth.md Phase 4).
 *
 * Uses DISCOVERABLE credentials, so nothing is typed at all: no email, no
 * name. The authenticator tells the server who you are.
 *
 * SITS BESIDE THE CODE FLOW, NEVER REPLACING IT. Signing out clears the
 * session but leaves the credential registered, so the next visit is one tap;
 * signing in as somebody else — a second parent on a shared iPad — means using
 * the code path below. Both routes stay on the page permanently, and the
 * emailed link remains the recovery path when a phone is lost or a passkey
 * sync fails.
 *
 * Renders nothing when the browser has no WebAuthn support, rather than
 * offering a button that cannot work.
 */

import { useState, useSyncExternalStore, useTransition } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import styles from './signin.module.css';


/**
 * Client-only capability check without setState-in-an-effect (which triggers
 * cascading renders and is a lint error). getServerSnapshot returns false so
 * the server and the first client render agree, then the real answer arrives.
 */
function useWebAuthnSupported(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => typeof window !== 'undefined' && !!window.PublicKeyCredential,
    () => false
  );
}

export function PasskeyButton({
  next,
  placement = 'primary',
  getOptions,
  verify
}: {
  next?: string;
  /**
   * 'primary' — the full-width CTA at the top, for a browser that has
   * registered or used a passkey here before (hint cookie, lib/passkeys).
   * 'secondary' — a quiet ghost link at the bottom for everyone else, so a
   * first-time member isn't led with a prompt for something they don't have
   * (Patrick, 2026-08-21). Same ceremony either way; never omitted (D-119).
   */
  placement?: 'primary' | 'secondary';
  getOptions: () => Promise<string | null>;
  verify: (
    responseJson: string,
    next: string
  ) => Promise<{ ok: boolean; error?: string; redirectTo?: string }>;
}) {
  const supported = useWebAuthnSupported();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();


  if (!supported) return null;

  const secondary = placement === 'secondary';

  return (
    <div className={secondary ? styles.passkeySecondary : styles.passkeyBlock}>
      <Button
        variant={secondary ? 'ghost' : 'primary'}
        className={secondary ? undefined : styles.fullWidth}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const optionsJson = await getOptions();
              if (!optionsJson) {
                setError('Passkeys aren’t set up on this server yet.');
                return;
              }
              const response = await startAuthentication({
                optionsJSON: JSON.parse(optionsJson)
              });
              const result = await verify(JSON.stringify(response), next ?? '');
              if (result.ok && result.redirectTo) {
                window.location.href = result.redirectTo;
              } else {
                setError(result.error ?? 'That didn’t work — try the code instead.');
              }
            } catch (e) {
              // Cancelling the OS prompt lands here. Not an error worth
              // shouting about — the person simply changed their mind.
              const msg = e instanceof Error ? e.message : '';
              if (/abort|cancel|NotAllowed/i.test(msg)) return;
              setError('That passkey didn’t work — use the code instead.');
            }
          });
        }}
      >
        {pending
          ? 'Waiting for your device…'
          : secondary
            ? 'Already set up a passkey? Sign in with it'
            : 'Sign in with a passkey'}
      </Button>
      {!secondary && (
        <p className={styles.passkeyHint}>
          One tap &mdash; this browser has used a passkey here before. New here, or signing in as
          someone else? Use the troop password and your name below instead.
        </p>
      )}
      {error ? (
        <Notice tone="error" className={styles.passkeyNotice}>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
