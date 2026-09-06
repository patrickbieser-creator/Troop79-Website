/**
 * Identity-hinted sign-in for the Bugle's "Register Now" button
 * (Plans/Bugle-Register-Now-Links.md, approach B — Patrick, 2026-09-05).
 *
 * EmailOctopus merges the recipient's own address into the newsletter link.
 * That address is NOT a credential and grants nothing: it lets the site skip
 * the troop password and the name search and go straight to "Continue as
 * {name}? Email me a code". Everything after the tap is the existing
 * challenge (lib/identity-challenge.ts) — rate limits, 15-minute code,
 * POST-only redemption, the normal 120-day session. Nothing here mints a
 * session, and nothing here ever needs to.
 *
 * THE ADDRESS NEVER STAYS IN THE URL (decision B2). The intake route reads
 * it once, resolves it, stores the RESULT (person ids + display names) in
 * this short-lived signed cookie, and redirects to the clean URL — so the
 * address is not in browser history on a shared Chromebook, not in a
 * rendered page, and in exactly one request log line.
 *
 * ONE ADDRESS CAN BE SEVERAL PEOPLE (decision B4). people.primary_email is
 * not unique — two parents can share an address, and a few scouts carry
 * their own. resolveChallengeTarget() takes the first match, which could
 * pick a scout for a shared address and dead-end a parent in "ask a parent".
 * This resolves ALL of them, adults first, and the panel lets the person
 * pick. A scout-only address offers the household's adults instead (D-246:
 * a code goes only to the picked person's own address, never rerouted).
 *
 * THE PEEK IS AN ORACLE, BOUNDED (decision B7). Without the troop password,
 * "Continue as Dana R.?" tells whoever holds an address whether it is on the
 * roster and whose it is. Patrick accepted that residual disclosure
 * (2026-09-05) — the address holder already has the address, and the same
 * names sit behind the password printed in the same newsletter — with a
 * per-IP cap on resolves that find nobody, logged to login_events so the
 * failed-logins dashboard shows a probe for what it is.
 *
 * Framework-agnostic (no next/headers) so it is testable in the db project
 * and usable from the route handler; the cookie is read by
 * lib/signin-hint-server.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { signToken, verifyToken } from '@/lib/signed-cookie';
import { maskEmail, targetForPerson, deliverableEmailFor } from '@/lib/identity-challenge';
import { loadHouseholdByKey } from '@/lib/households';
import type { IdentitySubjectKind } from '@/lib/identity-session';

export interface HintCandidate {
  personId: number;
  displayName: string;
  subjectKind: IdentitySubjectKind;
  /** Where a code for this person would go, masked ("d•••@gmail.com"). */
  maskedEmail: string | null;
}

export interface SignInHint {
  /** Always 'hint'. Every cookie type shares LEADER_SESSION_SECRET, so this
   *  literal is what stops a replayed identity/family token verifying here. */
  role: 'hint';
  /** The people the hinted address belongs to, adults first. */
  candidates: HintCandidate[];
  /** Only when every candidate is a scout: the household's adults who can
   *  sign in instead (each with their own deliverable address). */
  parents: HintCandidate[];
  /** Issued-at, ms since epoch — verifySignInHint() enforces the max age
   *  itself, because signed cookies carry no expiry of their own. */
  iat: number;
}

export const HINT_COOKIE = {
  name: 't79_signin_hint',
  /** Long enough to cover a code's 15-minute life plus a resend; short
   *  enough that a shared device forgets who the newsletter was for. */
  maxAgeSeconds: 20 * 60
} as const;

/** Resolves that found nobody, per IP, per hour, before the hint is ignored. */
export const HINT_PEEK_MAX_PER_IP_HOUR = 20;

export function hintCookieOptions(nodeEnv: string | undefined = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    // A click from an email is a top-level cross-site navigation — 'strict'
    // would drop the cookie on the very arrival it exists for.
    sameSite: 'lax' as const,
    secure: nodeEnv === 'production',
    path: '/',
    maxAge: HINT_COOKIE.maxAgeSeconds
  };
}

/**
 * The address as EmailOctopus merged it, cleaned up (decision B8).
 *
 * A `+` in the local part (pat+troop@gmail.com) becomes a space in a query
 * string by the time it reaches the server, so a space before the `@` is
 * put back as `+`. A space anywhere else is not an address at all. Empty
 * string means "no usable address" — an unmerged `{{EmailAddress}}` tag,
 * a blank, or garbage all land there rather than being looked up.
 */
export function normaliseHintAddress(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '';
  const local = value.slice(0, at).replace(/ /g, '+');
  const domain = value.slice(at + 1);
  if (!local || /[\s{}]/.test(local) || /[\s{}@]/.test(domain) || !domain.includes('.')) return '';
  return `${local}@${domain}`;
}

export async function signSignInHint(hint: Omit<SignInHint, 'role'>): Promise<string> {
  return signToken({ role: 'hint', ...hint });
}

function isCandidate(v: unknown): v is HintCandidate {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<HintCandidate>;
  return (
    typeof c.personId === 'number' &&
    typeof c.displayName === 'string' &&
    (c.subjectKind === 'adult' || c.subjectKind === 'scout') &&
    (c.maskedEmail === null || typeof c.maskedEmail === 'string')
  );
}

/** Signature, shape AND age — a valid signature only proves we minted it. */
export async function verifySignInHint(token: string | undefined, now = Date.now()): Promise<SignInHint | null> {
  const parsed = (await verifyToken(token)) as Partial<SignInHint> | null;
  if (!parsed) return null;
  if (
    parsed.role !== 'hint' ||
    !Array.isArray(parsed.candidates) ||
    !parsed.candidates.every(isCandidate) ||
    !Array.isArray(parsed.parents) ||
    !parsed.parents.every(isCandidate) ||
    typeof parsed.iat !== 'number'
  ) {
    return null;
  }
  if (now - parsed.iat > HINT_COOKIE.maxAgeSeconds * 1000) return null;
  return { role: 'hint', candidates: parsed.candidates, parents: parsed.parents, iat: parsed.iat };
}

/** May this hint request a code for `personId`? Only for the people it
 *  resolved to (or the adults offered in place of a scout) — the hint is
 *  the authorisation for the send, so it must be exactly that narrow. */
export function hintAllowsPerson(hint: SignInHint | null, personId: number): boolean {
  if (!hint) return false;
  return hint.candidates.some((c) => c.personId === personId) || hint.parents.some((p) => p.personId === personId);
}

/**
 * Every active, householded person the address belongs to — adults first.
 * Reuses targetForPerson() so the eligibility rules (active, directory row,
 * household key) cannot drift from the picker's and the challenge's own.
 */
export async function resolveHintCandidates(supabase: SupabaseClient, address: string): Promise<HintCandidate[]> {
  const needle = normaliseHintAddress(address);
  if (!needle) return [];

  const [{ data: direct }, { data: viaEmails }] = await Promise.all([
    supabase.from('people').select('id').eq('active', true).ilike('primary_email', needle),
    supabase
      .from('person_emails')
      .select('person_id')
      .ilike('email', needle)
      .is('bounced_at', null)
      .is('unsubscribed_at', null)
  ]);

  const ids: number[] = [];
  for (const row of (direct ?? []) as { id: number }[]) if (!ids.includes(row.id)) ids.push(row.id);
  for (const row of (viaEmails ?? []) as { person_id: number }[]) if (!ids.includes(row.person_id)) ids.push(row.person_id);
  if (ids.length === 0) return [];

  const masked = maskEmail(needle);
  const targets = await Promise.all(ids.map((id) => targetForPerson(supabase, id)));
  const candidates: HintCandidate[] = [];
  for (const t of targets) {
    if (!t) continue;
    candidates.push({ personId: t.personId, displayName: t.displayName, subjectKind: t.subjectKind, maskedEmail: masked });
  }
  // Stable: adults keep their relative order, then scouts keep theirs.
  return [...candidates.filter((c) => c.subjectKind === 'adult'), ...candidates.filter((c) => c.subjectKind === 'scout')];
}

/**
 * The full hint for an address, or null when it is nobody's. When the
 * address belongs only to scouts, `parents` carries the household adults a
 * code could go to instead — by name, with their own masked address — so the
 * parent holding the newsletter is one tap from a code in their own inbox.
 */
export async function buildSignInHint(
  supabase: SupabaseClient,
  address: string
): Promise<Omit<SignInHint, 'role'> | null> {
  const candidates = await resolveHintCandidates(supabase, address);
  if (candidates.length === 0) return null;

  let parents: HintCandidate[] = [];
  if (candidates.every((c) => c.subjectKind === 'scout')) {
    const householdKeys = Array.from(new Set(
      (await Promise.all(candidates.map((c) => targetForPerson(supabase, c.personId))))
        .map((t) => t?.householdKey)
        .filter((k): k is string => !!k)
    ));
    const seen = new Set<number>();
    for (const key of householdKeys) {
      const household = await loadHouseholdByKey(key);
      for (const adult of household?.adults ?? []) {
        if (seen.has(adult.personId)) continue;
        seen.add(adult.personId);
        const email = await deliverableEmailFor(supabase, adult.personId);
        if (!email) continue;
        parents.push({ personId: adult.personId, displayName: adult.name, subjectKind: 'adult', maskedEmail: maskEmail(email) });
      }
    }
    parents = parents.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  return { candidates, parents, iat: Date.now() };
}

/**
 * Has this IP burned its hour of resolves-that-found-nobody? Counted from
 * login_events (method 'hint', success false) — one query, only on hinted
 * requests, and the same rows the failed-logins dashboard already shows, so
 * a probe is visible to a leader without a new table. No IP (local dev)
 * means no cap, same as the send limiter.
 */
export async function hintRateLimitExceeded(supabase: SupabaseClient, ip: string | null | undefined): Promise<boolean> {
  if (!ip) return false;
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('login_events')
    .select('id', { count: 'exact', head: true })
    .eq('method', 'hint')
    .eq('success', false)
    .eq('ip', ip)
    .gte('created_at', hourAgo);
  return (count ?? 0) >= HINT_PEEK_MAX_PER_IP_HOUR;
}
