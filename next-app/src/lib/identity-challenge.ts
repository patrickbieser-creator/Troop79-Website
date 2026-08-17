/**
 * Mint / send / verify a passwordless sign-in challenge (Plans/Family-Identity-Auth.md
 * Phase 1). Framework-agnostic (no next/headers) so it stays usable from the
 * Edge runtime if proxy.ts ever needs it — the cookie itself is minted by the
 * caller (the /signin Server Actions) via lib/identity-session.ts.
 *
 * REVERSE LOOKUP IS REAL WORK, NOT REUSE. lib/email-recipients.ts only walks
 * scout → parents (recipientsForScouts); sign-in needs the opposite
 * direction, email/phone → person, which goes straight at `people`
 * (people_email_idx already indexes lower(trim(primary_email))) plus
 * `scout_parent_emails` — not through the scout graph, so an adult with no
 * parent_of edge (committee member, chartered-org rep, an ASM whose kids
 * were never in the troop) is still reachable.
 *
 * ENUMERATION SAFETY. requestChallenge() always resolves the same way
 * (void, no thrown distinction) whether or not the contact matches anyone —
 * callers must render one identical message either way ("If that address is
 * on our roster, a code is on its way"). This is not a timing-safe
 * implementation (no artificial delay padding) — the plan's acceptance
 * criterion is an identical RESPONSE, which this satisfies; a true
 * constant-time guarantee was not asked for and would need justifying its
 * own complexity.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { b64UrlEncode } from '@/lib/signed-cookie';
import { isDeliverable } from '@/lib/email-recipients';
import { resolveHouseholdKeyForPerson } from '@/lib/households';
import { sendEmail, renderEmail } from '@/lib/email';
import type { IdentitySubjectKind } from '@/lib/identity-session';

const TOKEN_TTL_MINUTES = 15;
const MAX_PER_PERSON_15MIN = 3;
const MAX_PER_IP_HOUR = 10;
const MAX_WRONG_ATTEMPTS = 5;

export interface ChallengeTarget {
  personId: number;
  displayName: string;
  subjectKind: IdentitySubjectKind;
  householdKey: string;
}

export interface RedeemedIdentity {
  personId: number;
  displayName: string;
  subjectKind: IdentitySubjectKind;
  householdKey: string;
  epoch: number;
  nextPath: string | null;
}

function getPepper(): string {
  const p = process.env.IDENTITY_TOKEN_PEPPER;
  if (!p) throw new Error('IDENTITY_TOKEN_PEPPER is not set. Add it to next-app/.env.local.');
  return p;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256(value || server-side pepper) — a database dump of login_tokens
 *  alone yields no usable credential (Technical Approach). */
async function hashSecret(raw: string): Promise<string> {
  return sha256Hex(`${raw}${getPepper()}`);
}

function randomLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64UrlEncode(bytes);
}

function randomCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

/**
 * Reverse email/phone → person lookup. Only ACTIVE, currently-householded
 * people resolve — resolveHouseholdKeyForPerson() returning null (inactive,
 * merged away, no household row) makes this whole function return null, the
 * same "not found" shape enumeration-safety already requires.
 */
async function resolveChallengeTarget(
  supabase: SupabaseClient,
  contact: string
): Promise<ChallengeTarget | null> {
  const needle = contact.trim().toLowerCase();
  if (!needle) return null;

  // people.primary_email direct hit (people_email_idx covers this). Not
  // declared unique in the schema — a young scout can share a parent's
  // address — so this takes the first match rather than .maybeSingle(),
  // which would throw on a real, expected duplicate.
  const { data: directPeople } = await supabase
    .from('people')
    .select('id')
    .eq('active', true)
    .ilike('primary_email', needle)
    .limit(1);

  let personId = ((directPeople ?? []) as { id: number }[])[0]?.id ?? null;

  // scout_parent_emails fallback (a tracked address that isn't people.primary_email —
  // e.g. a parent who signs in with a different address than the one on file).
  // Unlike the direct lookup above, this table has no active flag of its
  // own — the resolved person's OWN active status is checked explicitly
  // below rather than relying only on email deliverability.
  if (!personId) {
    const { data: addrRows } = await supabase
      .from('scout_parent_emails')
      .select('person_id, bounced_at, unsubscribed_at')
      .ilike('email', needle)
      .limit(1);
    const addr = ((addrRows ?? []) as { person_id: number; bounced_at: string | null; unsubscribed_at: string | null }[])[0];
    if (addr && isDeliverable(addr)) personId = addr.person_id;
  }

  if (!personId) return null;

  // Explicit, defense-in-depth active check (qa-lead review 2026-08-06) —
  // don't rely solely on resolveHouseholdKeyForPerson()/loadHouseholds()
  // incidentally filtering inactive people for an unrelated (signup-picker)
  // reason. A departed/merged person must never redeem a sign-in, and that
  // must stay true even if loadHouseholds()'s filter changes later for a
  // reason that has nothing to do with auth.
  const { data: activeCheck } = await supabase
    .from('people')
    .select('id')
    .eq('id', personId)
    .eq('active', true)
    .maybeSingle();
  if (!activeCheck) return null;

  const { data: directoryRow } = await supabase
    .from('person_directory')
    .select('person_id, display_name, tab')
    .eq('person_id', personId)
    .maybeSingle();
  const directory = directoryRow as { person_id: number; display_name: string; tab: string } | null;
  if (!directory) return null;

  const householdKey = await resolveHouseholdKeyForPerson(personId);
  if (!householdKey) return null;

  return {
    personId,
    displayName: directory.display_name,
    subjectKind: directory.tab === 'active_scout' ? 'scout' : 'adult',
    householdKey
  };
}


/**
 * MASKING HAPPENS SERVER-SIDE, ALWAYS. The raw address never crosses the wire
 * to the name picker — masking in the browser would defeat the entire point
 * of showing a hint instead of the value.
 *
 * Keeps the first character and the domain: "d****@gmail.com". Enough for a
 * parent to recognise their own address, not enough to reconstruct someone
 * else's. The padding is clamped so the mask does not advertise how long the
 * real local part is.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '\u2022\u2022\u2022';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local[0] ?? '';
  const pad = '\u2022'.repeat(Math.max(2, Math.min(5, local.length - 1)));
  return `${head}${pad}@${domain}`;
}

/** The address a challenge for this person would actually go to, honouring
 *  the same bounce/unsubscribe rule as the contact-string path. Null when we
 *  hold no deliverable way to reach them. */
async function deliverableEmailFor(
  supabase: SupabaseClient,
  personId: number
): Promise<string | null> {
  const { data: person } = await supabase
    .from('people')
    .select('primary_email')
    .eq('id', personId)
    .eq('active', true)
    .maybeSingle();
  const primary = (person as { primary_email: string | null } | null)?.primary_email?.trim();
  if (primary) return primary;

  const { data: rows } = await supabase
    .from('scout_parent_emails')
    .select('email, bounced_at, unsubscribed_at')
    .eq('person_id', personId);
  for (const r of (rows ?? []) as {
    email: string;
    bounced_at: string | null;
    unsubscribed_at: string | null;
  }[]) {
    if (r.email?.trim() && isDeliverable(r)) return r.email.trim();
  }
  return null;
}

/** ChallengeTarget for a known person id — the picker's equivalent of
 *  resolveChallengeTarget(), minus the ambiguous email lookup. Keeps every one
 *  of that function's defence-in-depth checks (active, directory row,
 *  household) so the two paths cannot drift apart on who may sign in. */
async function targetForPerson(
  supabase: SupabaseClient,
  personId: number
): Promise<ChallengeTarget | null> {
  const { data: activeCheck } = await supabase
    .from('people')
    .select('id')
    .eq('id', personId)
    .eq('active', true)
    .maybeSingle();
  if (!activeCheck) return null;

  const { data: directoryRow } = await supabase
    .from('person_directory')
    .select('person_id, display_name, tab')
    .eq('person_id', personId)
    .maybeSingle();
  const directory = directoryRow as { person_id: number; display_name: string; tab: string } | null;
  if (!directory) return null;

  const householdKey = await resolveHouseholdKeyForPerson(personId);
  if (!householdKey) return null;

  return {
    personId,
    displayName: directory.display_name,
    subjectKind: directory.tab === 'active_scout' ? 'scout' : 'adult',
    householdKey
  };
}

/**
 * Mints a challenge and emails it, IF the contact resolves to a real,
 * reachable person — silently no-ops otherwise (rate-limited, not found, or
 * undeliverable). The caller renders the SAME confirmation message either
 * way; this function's return value is deliberately void so nothing can leak
 * through it.
 */
export async function requestChallenge(
  supabase: SupabaseClient,
  contact: string,
  opts: { nextPath?: string | null; ip?: string | null } = {}
): Promise<void> {
  const target = await resolveChallengeTarget(supabase, contact);
  if (!target) return;
  // Outcome deliberately discarded — see MintOutcome. This path must look
  // identical whether or not the address is on the roster.
  await mintAndSend(supabase, target, contact, opts);
}

/**
 * Same challenge, but for a person we ALREADY know — the name-picker path
 * (Plans/Unified-Identity-And-Capabilities.md Phase D).
 *
 * WHY THIS EXISTS RATHER THAN LOOKING UP THE EMAIL AND CALLING
 * requestChallenge(): a scout can share a parent's address (see
 * resolveChallengeTarget's own note), and that resolver takes the FIRST match.
 * Routing the picker through a contact string would mint a token for the
 * PARENT when a scout picked their own name, and sign the scout in as their
 * parent. The picker knows who this is; it must not throw that away and
 * re-derive it from an ambiguous key.
 *
 * Returns the masked destination actually used, or {sent:false} when the
 * person has no deliverable address — the caller needs to distinguish "sent"
 * from "we have no way to reach you", which is a legitimate thing to say to
 * someone who already cleared the troop-password gate and picked themselves
 * off a list we showed them.
 */
export async function requestChallengeForPerson(
  supabase: SupabaseClient,
  personId: number,
  opts: { nextPath?: string | null; ip?: string | null } = {}
): Promise<
  { sent: true; masked: string } | { sent: false; reason: 'unreachable' | 'rate-limited' | 'failed' }
> {
  const target = await targetForPerson(supabase, personId);
  if (!target) return { sent: false, reason: 'unreachable' };

  const address = await deliverableEmailFor(supabase, personId);
  if (!address) return { sent: false, reason: 'unreachable' };

  const outcome = await mintAndSend(supabase, target, address, opts);
  if (outcome !== 'sent') return { sent: false, reason: outcome };
  return { sent: true, masked: maskEmail(address) };
}

/**
 * Returns WHY nothing was sent, when nothing was sent.
 *
 * requestChallenge() throws the reason away on purpose — that path must be
 * enumeration-safe, so every outcome has to look identical. The picker path
 * is already past the troop-password gate and is not enumeration-safe, so it
 * can and should tell the truth: claiming "code sent" when the rate limiter
 * silently dropped it sends someone to their inbox to wait for mail that will
 * never arrive, and then to an older email whose link is dead.
 */
type MintOutcome = 'sent' | 'rate-limited' | 'failed';

async function mintAndSend(
  supabase: SupabaseClient,
  target: ChallengeTarget,
  contact: string,
  opts: { nextPath?: string | null; ip?: string | null }
): Promise<MintOutcome> {

  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count: personCount } = await supabase
    .from('login_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', target.personId)
    .gte('created_at', fifteenMinAgo);
  if ((personCount ?? 0) >= MAX_PER_PERSON_15MIN) return 'rate-limited';

  if (opts.ip) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: ipCount } = await supabase
      .from('login_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('created_ip', opts.ip)
      .gte('created_at', hourAgo);
    if ((ipCount ?? 0) >= MAX_PER_IP_HOUR) return 'rate-limited';
  }

  const rawToken = randomLinkToken();
  const rawCode = randomCode();
  const [tokenHash, codeHash] = await Promise.all([hashSecret(rawToken), hashSecret(rawCode)]);

  const { error } = await supabase.from('login_tokens').insert({
    person_id: target.personId,
    channel: 'email',
    sent_to: contact.trim().toLowerCase(),
    token_hash: tokenHash,
    code_hash: codeHash,
    next_path: opts.nextPath || null,
    expires_at: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
    created_ip: opts.ip || null
  });
  if (error) return 'failed';

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const link = `${siteUrl}/signin/verify?token=${encodeURIComponent(rawToken)}`;

  // Minimal content by policy (Technical Approach) — troop name and the code
  // itself, nothing that names a scout, a household, or what this sign-in is
  // for. A sign-in message is the one piece of troop mail most likely to be
  // forwarded, screenshotted, or read on a lock screen.
  const { html, text } = renderEmail({
    heading: 'Your Troop 79 sign-in code',
    intro: 'Enter this code, or tap the button below.',
    bullets: [`Code: ${rawCode}`],
    actionUrl: link,
    actionLabel: 'Continue signing in',
    outro: 'Expires in 15 minutes. Didn’t request this? You can ignore it.'
  });

  // NARROW, DOCUMENTED EXCEPTION to lib/email.ts's "nothing sends
  // automatically" rule (Plans/Family-Identity-Auth.md decision 7 — see that
  // module's own header for the full exception text). This is the opposite
  // shape from the mass-send risk the rule guards against: one recipient, an
  // address already on the roster, triggered by that person's own action,
  // rate-limited above, and useless to anyone who didn't ask for it.
  await sendEmail({ to: [contact], subject: 'Your Troop 79 sign-in code', html, text, confirm: true });
  return 'sent';
}

/** Re-resolves the CURRENT identity for a person at redemption time — never
 *  trust anything except person_id off the stored token row. */
async function currentIdentityFor(
  supabase: SupabaseClient,
  personId: number,
  nextPath: string | null
): Promise<RedeemedIdentity | null> {
  const { data: directoryRow } = await supabase
    .from('person_directory')
    .select('person_id, display_name, tab')
    .eq('person_id', personId)
    .maybeSingle();
  const directory = directoryRow as { person_id: number; display_name: string; tab: string } | null;
  if (!directory) return null;

  const { data: personRow } = await supabase
    .from('people')
    .select('session_epoch, active')
    .eq('id', personId)
    .maybeSingle();
  const person = personRow as { session_epoch: number; active: boolean } | null;
  // Explicit, defense-in-depth active check (qa-lead review 2026-08-06) —
  // a person deactivated in the window between requesting a challenge and
  // redeeming it must not complete sign-in, independent of whatever
  // resolveHouseholdKeyForPerson()'s incidental filtering does.
  if (!person || person.session_epoch == null || !person.active) return null;
  const epoch = person.session_epoch;

  const householdKey = await resolveHouseholdKeyForPerson(personId);
  if (!householdKey) return null;

  return {
    personId,
    displayName: directory.display_name,
    subjectKind: directory.tab === 'active_scout' ? 'scout' : 'adult',
    householdKey,
    epoch,
    nextPath
  };
}

/** Marks every OTHER outstanding token for this person dead — redemption
 *  invalidates siblings (Technical Approach), so a forwarded/leaked link
 *  from the same challenge round can't also be redeemed after the real
 *  recipient signs in. */
async function invalidateSiblingTokens(
  supabase: SupabaseClient,
  personId: number,
  exceptId: number
): Promise<void> {
  await supabase
    .from('login_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('person_id', personId)
    .is('consumed_at', null)
    .neq('id', exceptId);
}

interface TokenRow {
  id: number;
  person_id: number;
  next_path: string | null;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
}

/**
 * GET-safe lookup by the raw link token — consumes NOTHING. The landing page
 * renders "Continue as {name}" from this; a scanner prefetching the link on
 * GET cannot burn it, because nothing here writes.
 */
export async function peekTokenChallenge(
  supabase: SupabaseClient,
  rawToken: string
): Promise<{ displayName: string } | null> {
  return (await inspectTokenChallenge(supabase, rawToken)).target;
}

/**
 * Why a link did not work, not just that it didn't.
 *
 * The landing page said "This link has expired or was already used" for THREE
 * different states — expired, consumed, and never-existed — and the commonest
 * of them is the least alarming: you already signed in with the code from the
 * same email, which invalidates its link. Reported as a bug 2026-08-16 by
 * someone who had done exactly that, and read it as the site being broken.
 *
 * Distinguishing them leaks nothing a link-holder does not already have: they
 * hold the token, so "this token was used" tells them only about themselves.
 */
export type TokenState = 'valid' | 'consumed' | 'expired' | 'unknown';

export async function inspectTokenChallenge(
  supabase: SupabaseClient,
  rawToken: string
): Promise<{ state: TokenState; target: { displayName: string } | null }> {
  if (!rawToken) return { state: 'unknown', target: null };
  const tokenHash = await hashSecret(rawToken);
  const { data } = await supabase
    .from('login_tokens')
    .select('id, person_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  const row = data as Pick<TokenRow, 'id' | 'person_id' | 'expires_at' | 'consumed_at'> | null;
  if (!row) return { state: 'unknown', target: null };
  if (row.consumed_at) return { state: 'consumed', target: null };
  if (new Date(row.expires_at) < new Date()) return { state: 'expired', target: null };

  const { data: directoryRow } = await supabase
    .from('person_directory')
    .select('display_name')
    .eq('person_id', row.person_id)
    .maybeSingle();
  const displayName = (directoryRow as { display_name: string } | null)?.display_name;
  // No directory row means the person is no longer listable — treat it as an
  // unknown token rather than inventing a name to confirm.
  return displayName ? { state: 'valid', target: { displayName } } : { state: 'unknown', target: null };
}

/** POST-consume by the raw link token. */
export async function redeemToken(
  supabase: SupabaseClient,
  rawToken: string
): Promise<RedeemedIdentity | null> {
  if (!rawToken) return null;
  const tokenHash = await hashSecret(rawToken);
  const { data } = await supabase
    .from('login_tokens')
    .select('id, person_id, next_path, expires_at, consumed_at, attempts')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  const row = data as TokenRow | null;
  if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) return null;

  const identity = await currentIdentityFor(supabase, row.person_id, row.next_path);
  if (!identity) return null;

  await supabase.from('login_tokens').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
  await invalidateSiblingTokens(supabase, row.person_id, row.id);
  return identity;
}

export type RedeemCodeResult =
  | { ok: true; identity: RedeemedIdentity }
  | { ok: false; reason: 'invalid' | 'locked' };

/**
 * POST-consume by the 6-digit code. Needs the ORIGINAL contact alongside the
 * code — code_hash alone can't disambiguate two simultaneously-pending
 * tokens that happen to land on the same 6-digit code for different people
 * (low odds, but the hash gives no signal either way, so the contact is what
 * actually scopes which row to check).
 */
export async function redeemCode(
  supabase: SupabaseClient,
  contact: string,
  code: string
): Promise<RedeemCodeResult> {
  const target = await resolveChallengeTarget(supabase, contact);
  // Same "invalid" shape whether the contact doesn't resolve to anyone, or it
  // does but the code is wrong — a wrong-code guesser learns nothing about
  // which is true.
  if (!target) return { ok: false, reason: 'invalid' };
  return redeemCodeForTarget(supabase, target, code);
}

/**
 * Redeem by PERSON rather than by contact string — the name-picker path.
 *
 * Same reason requestChallengeForPerson exists: a scout can share a parent's
 * address, and resolving a code by that address would consume the parent's
 * token and sign the scout in as the parent. Once the picker has told us who
 * this is, that identity must survive to redemption rather than being
 * re-derived from an ambiguous key.
 */
export async function redeemCodeForPerson(
  supabase: SupabaseClient,
  personId: number,
  code: string
): Promise<RedeemCodeResult> {
  const target = await targetForPerson(supabase, personId);
  if (!target) return { ok: false, reason: 'invalid' };
  return redeemCodeForTarget(supabase, target, code);
}

async function redeemCodeForTarget(
  supabase: SupabaseClient,
  target: ChallengeTarget,
  code: string
): Promise<RedeemCodeResult> {

  const { data } = await supabase
    .from('login_tokens')
    .select('id, person_id, next_path, expires_at, consumed_at, attempts')
    .eq('person_id', target.personId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as TokenRow | null;
  if (!row || new Date(row.expires_at) < new Date()) return { ok: false, reason: 'invalid' };
  if (row.attempts >= MAX_WRONG_ATTEMPTS) return { ok: false, reason: 'locked' };

  const codeHash = await hashSecret(code.trim());
  const { data: matchRow } = await supabase
    .from('login_tokens')
    .select('id')
    .eq('id', row.id)
    .eq('code_hash', codeHash)
    .maybeSingle();

  if (!matchRow) {
    const nextAttempts = row.attempts + 1;
    await supabase.from('login_tokens').update({ attempts: nextAttempts }).eq('id', row.id);
    return { ok: false, reason: nextAttempts >= MAX_WRONG_ATTEMPTS ? 'locked' : 'invalid' };
  }

  const identity = await currentIdentityFor(supabase, row.person_id, row.next_path);
  if (!identity) return { ok: false, reason: 'invalid' };

  await supabase.from('login_tokens').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
  await invalidateSiblingTokens(supabase, row.person_id, row.id);
  return { ok: true, identity };
}
