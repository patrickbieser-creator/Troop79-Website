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

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { rememberPasskeyDeviceAction } from '../signin/actions';
import { Button } from '@/app/_components/button';
import { Notice } from '@/app/_components/notice';
import surface from '@/app/_components/card.module.css';
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

  // A signed-in HOLDER is, by definition, on a browser that should offer the
  // one-tap button next time — seed the remembered-device hint here, once,
  // so people who registered before the hint existed (2026-08-21) see the
  // passkey on /signin without having to use the code flow first. The
  // action is identity-free and idempotent; nothing on screen depends on it.
  const holder = passkeys.length > 0;
  useEffect(() => {
    if (!holder) return;
    void rememberPasskeyDeviceAction().catch(() => {});
  }, [holder]);


  if (!configured) return null;

  return (
    <section className={`${surface.card} ${styles.passkeySection}`}>
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
                <Button variant="dangerGhost" type="submit">
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {done ? (
        <Notice tone="success">
          Passkey saved. Next time, just tap &ldquo;Sign in with a passkey&rdquo;.
        </Notice>
      ) : supported ? (
        <Button
          variant="primary"
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
                // startRegistration() wraps native errors as WebAuthnError
                // (@simplewebauthn/browser), which carries a stable `.code`
                // alongside the message — sturdier to branch on than message
                // text, whose wording varies by platform (the library's own
                // helpers/identifyRegistrationError.js comment: "Platforms
                // are overloading this error beyond what the spec defines").
                const code = e instanceof Error && 'code' in e ? (e as { code?: string }).code : undefined;
                const msg = e instanceof Error ? e.message : '';
                // The gap userVerification: 'required' opens up (found
                // 2026-08-16 — see Registration_RequiresUserVerification):
                // an authenticator with no PIN/biometric/fingerprint
                // configured can no longer silently create a weak passkey,
                // but it also can't silently succeed at all — say why,
                // rather than leaving "Set up one-tap sign in" reset with
                // nothing explained.
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
          }}
        >
          {pending
            ? 'Waiting for your device…'
            : passkeys.length > 0
              ? 'Add another device'
              : 'Set up one-tap sign in'}
        </Button>
      ) : (
        <p className={styles.passkeyMeta}>This browser doesn&rsquo;t support passkeys.</p>
      )}

      {error ? (
        <Notice tone="error" className={styles.passkeyNotice}>
          {error}
        </Notice>
      ) : null}
    </section>
  );
}
