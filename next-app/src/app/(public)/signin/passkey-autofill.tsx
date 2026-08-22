'use client';

/**
 * WebAuthn CONDITIONAL UI — passkeys offered in the browser's own autofill
 * (Patrick, 2026-08-21: first-time members shouldn't be asked for a passkey
 * they don't have). This renders nothing. On mount, if the browser supports
 * conditional mediation, it starts a long-lived, silent authentication
 * ceremony; a browser that HOLDS a passkey for troop-79.com then offers it in
 * the autofill dropdown of any input carrying the `webauthn` autocomplete
 * token (the troop-password field below has one), and picking it signs the
 * person in. A browser with no passkey shows nothing at all — which is the
 * whole point. Browsers without support resolve to "no" and this stays inert.
 *
 * Starting the explicit "Sign in with a passkey" button aborts this pending
 * request (SimpleWebAuthn's WebAuthnAbortService cancels any in-flight
 * ceremony when a new one starts); the resulting AbortError is swallowed.
 */

import { useEffect } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

export function PasskeyAutofill({
  next,
  getOptions,
  verify
}: {
  next?: string;
  getOptions: () => Promise<string | null>;
  verify: (
    responseJson: string,
    next: string
  ) => Promise<{ ok: boolean; error?: string; redirectTo?: string }>;
}) {
  useEffect(() => {
    let cancelled = false;
    const pkc = (typeof window !== 'undefined' ? window.PublicKeyCredential : undefined) as
      | (typeof PublicKeyCredential & { isConditionalMediationAvailable?: () => Promise<boolean> })
      | undefined;
    if (!pkc || typeof pkc.isConditionalMediationAvailable !== 'function') return;

    (async () => {
      try {
        if (!(await pkc.isConditionalMediationAvailable!())) return;
        const optionsJson = await getOptions();
        if (!optionsJson || cancelled) return;
        const response = await startAuthentication({
          optionsJSON: JSON.parse(optionsJson),
          useBrowserAutofill: true,
          // The gate input carries autocomplete="webauthn"; on the roster
          // picker step there may be no such input yet, and a thrown
          // "no autofill input" error would be noise — let the browser decide.
          verifyBrowserAutofillInput: false
        });
        if (cancelled) return;
        const result = await verify(JSON.stringify(response), next ?? '');
        if (result.ok && result.redirectTo) window.location.href = result.redirectTo;
        // A failed verify is silent here: the explicit button and the code
        // path remain on the page for the person to try deliberately.
      } catch {
        // AbortError (a new ceremony started, or unmount), NotAllowedError
        // (dismissed), or a browser that advertised support it lacks — all
        // quiet by design; this path never shows an error.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-once: the ceremony is long-lived and must not restart on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
