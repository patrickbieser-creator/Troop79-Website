/**
 * Passkeys — WebAuthn registration and sign-in
 * (Plans/Family-Identity-Auth.md Phase 4, shipped 2026-08-16).
 *
 * The magic link proves who you are ONCE; a passkey makes every sign-in after
 * that one tap with nothing typed. Today's mail-gateway bug is the argument in
 * miniature — a sign-in link is a secret that has to survive an email, a
 * transport, a rewriter and a browser, and a passkey never leaves the device.
 *
 * FOUR NON-NEGOTIABLES, all from the plan and all easy to get wrong:
 *
 *   1. The magic link is never removed. A passkey-only account is a family
 *      locked out with no self-service way back in.
 *   2. PASSKEY_RP_ID is pinned in env, never derived from the request host.
 *      Credentials are bound to the registrable domain and do not survive a
 *      move; deriving it means a preview deployment registers credentials
 *      that are useless in production, and the failure is silent until
 *      someone tries to sign in.
 *   3. Do NOT hard-fail on sign_count. Many platform authenticators always
 *      return 0; treating a non-incrementing counter as cloning evidence
 *      would lock out iPhones.
 *   4. Adults only. A scout registering a passkey on a shared school
 *      Chromebook is a foreseeable mess; Tier 2-S stays on emailed codes.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON
} from '@simplewebauthn/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const CHALLENGE_TTL_MINUTES = 5;

export interface PasskeyConfig {
  rpId: string;
  rpName: string;
  origin: string;
}

/**
 * Null when passkeys are not configured on this server — every caller degrades
 * to the emailed-code flow rather than throwing, exactly as the email path
 * degrades when RESEND_API_KEY is unset.
 */
export function passkeyConfig(): PasskeyConfig | null {
  const rpId = process.env.PASSKEY_RP_ID?.trim();
  if (!rpId) return null;
  // Origin must match what the browser reports. Derived from the pinned RP ID
  // rather than the request, for the same reason the RP ID itself is pinned.
  const origin =
    process.env.PASSKEY_ORIGIN?.trim() ||
    (rpId === 'localhost' ? 'http://localhost:3000' : `https://${rpId}`);
  return { rpId, rpName: 'Scout Troop 79', origin };
}

export function passkeysConfigured(): boolean {
  return passkeyConfig() !== null;
}

interface StoredCredential {
  id: number;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[] | null;
}

/** bytea comes back from PostgREST as a `\x…` hex string. */
// Explicitly Uint8Array<ArrayBuffer>: TypeScript 5.7+ made the backing-buffer
// type a parameter, and SimpleWebAuthn's `credential.publicKey` will not
// accept the wider ArrayBufferLike that `new Uint8Array(n)` infers.
function decodePublicKey(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const out = new Uint8Array(new ArrayBuffer(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function encodePublicKey(bytes: Uint8Array): string {
  return '\\x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function storeChallenge(
  supabase: SupabaseClient,
  challenge: string,
  kind: 'register' | 'authenticate',
  personId: number | null
): Promise<void> {
  await supabase.from('passkey_challenges').insert({
    challenge,
    kind,
    person_id: personId,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60_000).toISOString()
  });
}

/** Single-use: consumed on first read, so a replayed response fails. */
async function takeChallenge(
  supabase: SupabaseClient,
  challenge: string,
  kind: 'register' | 'authenticate'
): Promise<{ personId: number | null } | null> {
  const { data } = await supabase
    .from('passkey_challenges')
    .select('id, person_id, expires_at, consumed_at')
    .eq('challenge', challenge)
    .eq('kind', kind)
    .maybeSingle();
  const row = data as
    | { id: number; person_id: number | null; expires_at: string; consumed_at: string | null }
    | null;
  if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) return null;

  await supabase
    .from('passkey_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id);
  return { personId: row.person_id };
}

// ── Registration ────────────────────────────────────────────────────────────

export async function beginRegistration(
  supabase: SupabaseClient,
  person: { personId: number; displayName: string }
) {
  const cfg = passkeyConfig();
  if (!cfg) return null;

  const { data } = await supabase
    .from('passkey_credentials')
    .select('credential_id, transports')
    .eq('person_id', person.personId);
  const existing = (data ?? []) as { credential_id: string; transports: string[] | null }[];

  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userName: person.displayName,
    userDisplayName: person.displayName,
    // Discoverable credentials (resident keys) are what make returning sign-in
    // "tap Sign in" with no email typed at all — the entire point.
    //
    // userVerification: 'required', not 'preferred' — found the hard way
    // 2026-08-16. Dashlane, asked for 'preferred', silently created a passkey
    // with NO fingerprint/PIN/vault prompt at all, no user-facing sign that
    // anything was skipped. A second browser's platform authenticator, asked
    // the identical 'preferred', DID prompt for a PIN — so "preferred" isn't
    // unreliable in some abstract way, it is UNDER THE AUTHENTICATOR'S OWN
    // DISCRETION, and at least one real one we tested exercises that
    // discretion by doing nothing. That's a materially weaker credential than
    // the card's own promise ("signs you in with a fingerprint or your
    // face") — a stolen unlocked device would be enough, no biometric or PIN
    // required. 'required' forces the authenticator to refuse creation
    // rather than silently downgrade it.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    // Stops a second credential being registered on a device that already has
    // one, which would otherwise silently accumulate duplicates.
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as never
    })),
    attestationType: 'none'
  });

  await storeChallenge(supabase, options.challenge, 'register', person.personId);
  return options;
}

export async function finishRegistration(
  supabase: SupabaseClient,
  personId: number,
  response: RegistrationResponseJSON,
  nickname: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = passkeyConfig();
  if (!cfg) return { ok: false, error: 'Passkeys are not enabled on this server.' };

  const challenge = response.response.clientDataJSON
    ? JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString()).challenge
    : null;
  if (!challenge) return { ok: false, error: 'That registration was malformed.' };

  const taken = await takeChallenge(supabase, challenge, 'register');
  // The challenge is bound to the person who asked for it: a response cannot
  // be replayed against a different account.
  if (!taken || taken.personId !== personId) {
    return { ok: false, error: 'That registration expired — try again.' };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpId
      // requireUserVerification defaults to true (library default) and is
      // deliberately left there — beginRegistration() now asks for
      // userVerification: 'required', so an authenticator that still skips
      // it (like Dashlane did under 'preferred') is a real authenticator
      // ignoring what was asked, not an authenticator making a permitted
      // choice. That should fail loudly here, not be waved through.
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not verify that passkey.' };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'Could not verify that passkey.' };
  }

  const { credential, aaguid, credentialBackedUp } = verification.registrationInfo;
  const { error } = await supabase.from('passkey_credentials').insert({
    person_id: personId,
    credential_id: credential.id,
    public_key: encodePublicKey(credential.publicKey),
    sign_count: credential.counter,
    transports: credential.transports ?? null,
    aaguid: aaguid ?? null,
    backed_up: credentialBackedUp,
    nickname: nickname?.trim() || null
  });
  if (error) return { ok: false, error: `Could not save that passkey: ${error.message}` };
  return { ok: true };
}

// ── Authentication ──────────────────────────────────────────────────────────

export async function beginAuthentication(supabase: SupabaseClient) {
  const cfg = passkeyConfig();
  if (!cfg) return null;

  const options = await generateAuthenticationOptions({
    rpID: cfg.rpId,
    // No allowCredentials: discoverable credentials mean the authenticator
    // tells US who the user is. Listing candidates would require knowing that
    // first, which is the friction this removes.
    userVerification: 'preferred'
  });
  await storeChallenge(supabase, options.challenge, 'authenticate', null);
  return options;
}

export async function finishAuthentication(
  supabase: SupabaseClient,
  response: AuthenticationResponseJSON
): Promise<{ ok: true; personId: number } | { ok: false; error: string }> {
  const cfg = passkeyConfig();
  if (!cfg) return { ok: false, error: 'Passkeys are not enabled on this server.' };

  const challenge = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString()
  ).challenge as string;

  const taken = await takeChallenge(supabase, challenge, 'authenticate');
  if (!taken) return { ok: false, error: 'That sign-in expired — try again.' };

  const { data } = await supabase
    .from('passkey_credentials')
    .select('id, credential_id, public_key, sign_count, transports, person_id')
    .eq('credential_id', response.id)
    .maybeSingle();
  const cred = data as (StoredCredential & { person_id: number }) | null;
  if (!cred) return { ok: false, error: 'That passkey isn’t registered here any more.' };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpId,
      credential: {
        id: cred.credential_id,
        publicKey: decodePublicKey(cred.public_key),
        counter: Number(cred.sign_count),
        transports: (cred.transports ?? undefined) as never
      },
      // DO NOT HARD-FAIL ON THE COUNTER. Many platform authenticators always
      // return 0; treating a non-incrementing counter as cloning evidence
      // would lock out every iPhone.
      requireUserVerification: false
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not verify that passkey.' };
  }
  if (!verification.verified) return { ok: false, error: 'Could not verify that passkey.' };

  await supabase
    .from('passkey_credentials')
    .update({
      sign_count: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString()
    })
    .eq('id', cred.id);

  return { ok: true, personId: cred.person_id };
}

export async function listPasskeys(supabase: SupabaseClient, personId: number) {
  const { data } = await supabase
    .from('passkey_credentials')
    .select('id, nickname, created_at, last_used_at')
    .eq('person_id', personId)
    .order('created_at', { ascending: true });
  return (data ?? []) as {
    id: number;
    nickname: string | null;
    created_at: string;
    last_used_at: string | null;
  }[];
}

export async function deletePasskey(
  supabase: SupabaseClient,
  personId: number,
  credentialRowId: number
): Promise<void> {
  // Scoped by person_id as well as id — a forged row id must not delete
  // someone else's device.
  await supabase
    .from('passkey_credentials')
    .delete()
    .eq('id', credentialRowId)
    .eq('person_id', personId);
}

// ── Remembered-device hint (2026-08-21) ─────────────────────────────────────
//
// A first-time member on /signin used to meet a PRIMARY "Sign in with a
// passkey" button with no way to know they had none (Patrick: "confusing new
// members"). No browser API will say "this user has a passkey for this site"
// — that's hidden on purpose — so the page keeps its own, non-sensitive
// memory: a cookie set when a passkey is REGISTERED or successfully USED from
// this browser. Value is a constant; it names nobody and grants nothing. It
// only decides placement: present → one-tap button first; absent → a quiet
// secondary link. Both paths always render (D-119 — the code path and the
// passkey path are both permanent).

export const PASSKEY_HINT_COOKIE = {
  name: 't79_passkey_hint',
  maxAgeSeconds: 365 * 24 * 60 * 60
} as const;

/** Cookie attributes for the hint — same shape as the session cookies. */
export function passkeyHintCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: nodeEnv === 'production',
    path: '/',
    maxAge: PASSKEY_HINT_COOKIE.maxAgeSeconds
  };
}

/** Where the passkey control sits on /signin. */
export function passkeyPlacement(deviceSeen: boolean): 'primary' | 'secondary' {
  return deviceSeen ? 'primary' : 'secondary';
}
