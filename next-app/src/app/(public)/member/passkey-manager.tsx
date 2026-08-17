'use client';

/**
 * Passkey setup and management, on the Members page
 * (Plans/Family-Identity-Auth.md Phase 4).
 *
 * The plan puts the offer "immediately after a family's first successful
 * verification", and that placement matters: it's the one moment the person
 * has just proven who they are, is already in a security frame of mind, and
 * has a reason to care. /member is where they land after signing in, so the
 * offer is here rather than on a settings page nobody visits.
 *
 * Adults only — a scout registering a passkey on a shared school Chromebook is
 * a foreseeable mess, so the card simply isn't rendered for a scout session.
 */

import { useState, useSyncExternalStore, useTransition } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import styles from './member.module.css';

export interface PasskeyRow {
  id: number;
  nickname: string | null;
  created_at: string;
  last_used_at: string | null;
}


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

export function PasskeyManager({
  passkeys,
  configured,
  getOptions,
  verify,
  remove
}: {
  passkeys: PasskeyRow[];
  configured: boolean;
  getOptions: () => Promise<string | null>;
  verify: (responseJson: string, nickname: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (formData: FormData) => Promise<void>;
}) {
  const supported = useWebAuthnSupported();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();


  if (!configured) return null;

  return (
    <section className={styles.passkeySection}>
      <h2 className={styles.passkeyHeading}>One-tap sign in</h2>
      <p className={styles.passkeyIntro}>
        Set up a passkey and this device signs you in with a fingerprint or your face &mdash;
        nothing to type, and nothing to wait for in your inbox. Emailed codes keep working, so
        you&rsquo;re never locked out if you lose the device.
      </p>

      {passkeys.length > 0 && (
        <ul className={styles.passkeyList}>
          {passkeys.map((k) => (
            <li key={k.id} className={styles.passkeyItem}>
              <span>
                <strong>{k.nickname || 'This device'}</strong>
                <span className={styles.passkeyMeta}>
                  {k.last_used_at
                    ? ` · last used ${k.last_used_at.slice(0, 10)}`
                    : ` · added ${k.created_at.slice(0, 10)}`}
                </span>
              </span>
              <form action={remove}>
                <input type="hidden" name="credentialId" value={k.id} />
                <button type="submit" className={styles.passkeyRemove}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {done ? (
        <p className={styles.passkeyDone} role="status">
          Passkey saved. Next time, just tap &ldquo;Sign in with a passkey&rdquo;.
        </p>
      ) : supported ? (
        <button
          type="button"
          className={styles.passkeyAdd}
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
                const response = await startRegistration({
                  optionsJSON: JSON.parse(optionsJson)
                });
                // A human-readable device label, so someone with three devices
                // can tell which one they're removing later.
                const nickname =
                  typeof navigator !== 'undefined' && /iPhone|iPad|Android|Mac|Windows/.exec(navigator.userAgent)?.[0]
                    ? `${/iPhone|iPad|Android|Mac|Windows/.exec(navigator.userAgent)![0]}`
                    : 'This device';
                const result = await verify(JSON.stringify(response), nickname);
                if (result.ok) setDone(true);
                else setError(result.error ?? 'That didn’t work.');
              } catch (e) {
                const msg = e instanceof Error ? e.message : '';
                if (/abort|cancel|NotAllowed/i.test(msg)) return;
                if (/already registered|excluded/i.test(msg)) {
                  setError('This device already has a passkey for your account.');
                  return;
                }
                setError('Your device didn’t complete that — try again.');
              }
            });
          }}
        >
          {pending
            ? 'Waiting for your device…'
            : passkeys.length > 0
              ? 'Add another device'
              : 'Set up one-tap sign in'}
        </button>
      ) : (
        <p className={styles.passkeyMeta}>This browser doesn&rsquo;t support passkeys.</p>
      )}

      {error ? (
        <p className={styles.passkeyError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
