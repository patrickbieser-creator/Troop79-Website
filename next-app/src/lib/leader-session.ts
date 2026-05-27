/**
 * Stub "leader session" — a signed cookie that proves the bearer logged in
 * via /admin/login. NOT real authentication. The login form accepts any
 * non-empty username + any password (matching the prototype's behavior).
 *
 * Designed so we can swap in real Supabase Auth later without touching the
 * admin pages: replace this module + the login route, leave everything else.
 *
 * Uses Web Crypto so the same code works in both the Edge middleware and
 * the Node server runtime.
 */

const COOKIE_NAME = 't79_leader_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface LeaderSession {
  /** Username they typed at login (e.g. 'pbieser'). Used for display only. */
  leader: string;
  /** Issued-at timestamp, ms since epoch. */
  iat: number;
}

function getSecret(): string {
  const s = process.env.LEADER_SESSION_SECRET;
  if (!s) {
    throw new Error(
      'LEADER_SESSION_SECRET is not set. Add it to next-app/.env.local.'
    );
  }
  return s;
}

function b64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
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

export async function signSession(session: LeaderSession): Promise<string> {
  const payload = b64UrlEncode(JSON.stringify(session));
  const sig = await hmacSign(payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string | undefined): Promise<LeaderSession | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!(await hmacVerify(payload, signature))) return null;
  try {
    const json = new TextDecoder().decode(b64UrlDecode(payload));
    const parsed = JSON.parse(json) as LeaderSession;
    if (typeof parsed.leader !== 'string' || typeof parsed.iat !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export const LEADER_COOKIE = {
  name: COOKIE_NAME,
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS
};
