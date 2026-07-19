/**
 * HMAC-signed cookie primitives, shared by every stub session in the app
 * (lib/leader-session.ts, lib/family-session.ts).
 *
 * Extracted so a second session type doesn't mean a second copy of the
 * signing code — a bug fixed in one copy and missed in the other is exactly
 * the failure mode worth designing out of security-relevant code.
 *
 * Uses Web Crypto so the same module works in both the Edge middleware and
 * the Node server runtime.
 */

/** The app's cookie-signing key. Shared across session types; the *passwords*
 *  that mint each session are separate and rotate independently. */
export function getSessionSecret(): string {
  const s = process.env.LEADER_SESSION_SECRET;
  if (!s) {
    throw new Error('LEADER_SESSION_SECRET is not set. Add it to next-app/.env.local.');
  }
  return s;
}

export function b64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(payload: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(payload);
  if (expected.length !== signature.length) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/** `<base64url(json)>.<base64url(hmac)>` */
export async function signToken(payload: unknown): Promise<string> {
  const encoded = b64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${await hmacSign(encoded)}`;
}

/**
 * Verifies the signature and returns the decoded payload, or null if the
 * token is absent, malformed, or not signed by this server. Callers are
 * responsible for validating the payload's SHAPE — a valid signature only
 * proves we minted it, not that its fields are what this caller expects.
 */
export async function verifyToken(token: string | undefined): Promise<unknown | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!(await hmacVerify(payload, signature))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64UrlDecode(payload)));
  } catch {
    return null;
  }
}

/** Constant-time shared-secret compare. Length difference leaks, which is
 *  acceptable for a shared troop password. */
export function secretMatches(input: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = new TextEncoder().encode(input);
  const b = new TextEncoder().encode(secret);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
