import {
  loadEventDetail,
  loadPartySignup,
  loadPartyPlacements,
  loadPartyMemberships,
  loadHouseholdGuests,
  isSlotFirst,
  signupLocked,
  type PartyMembership,
  type HouseholdGuest
} from '@/lib/event-signup';
import { summarizePlacements, type PlacementLine } from '@/lib/transport';
import type { HouseholdEntry } from '@/lib/event-signup';
import { cache } from 'react';
import {
  householdKeyForPerson,
  loadHouseholds,
  loadHouseholdByKey,
  storedHouseholdId,
  type Household
} from '@/lib/households';
import {
  gateAudience,
  getIdentitySessionIfValid,
  verifiedSignupVerdict,
  canSwitchHousehold as canSwitchHouseholdFn,
  type SignupWriteVerdict
} from '@/lib/family-access';
import { resolveEffectiveHouseholdKey } from '@/lib/identity-session';
import { leaderSessionPersonId } from '@/lib/session-person';

/**
 * Everything both halves of an event need to know about WHO is looking and
 * what they have already signed up for.
 *
 * Extracted when signup moved to its own route (step 4 of
 * Plans/Calendar-Detail-And-Signup-Split.md). The detail page needs this to
 * answer "are we already signed up?"; the signup page needs it to prefill the
 * form. Duplicating it would mean two copies of the identity resolution below,
 * which is subtle enough that the two would drift — and drifting on WHICH
 * household a visitor is treated as is a data problem, not a cosmetic one.
 */

export interface SignupContext {
  detail: NonNullable<Awaited<ReturnType<typeof loadEventDetail>>>;
  /** null when nothing has cleared the gate. */
  audience: Awaited<ReturnType<typeof gateAudience>>;
  gatedIn: boolean;
  households: Household[];
  household: Household | null;
  householdKey: string | undefined;
  /** This party's live entries for this signup. Empty when not gated in. */
  existing: HouseholdEntry[];
  /** Slot claims mapped to the forms' person keys (s0/s1…, a0/a1…). */
  existingClaims: { slotId: number; personKey: string; comment: string | null }[];
  /** This party's own car/tent/patrol placements, family-visible sets only
   *  (Plans/Event-Logistics.md §A/§B). Family name for cars, nothing more. */
  placements: PlacementLine[];
  /** Raw set→group memberships for the form's self-select pickers. */
  memberships: PartyMembership[];
  /** The household's guests on record (named mode only) — the form's
   *  "add again" picks (Plans/Guests-As-People.md). */
  householdGuests: HouseholdGuest[];
  gateState: 'anon' | 'no-household' | 'ready';
  slotFirst: boolean;
  locked: boolean;
  /** Verified Signup (2026-08-26): may this visitor WRITE a signup? The page
   *  branches on it — 'sign-in' and 'parent' get an explanatory panel instead
   *  of the picker/form; the Server Actions enforce the same rule. */
  verdict: SignupWriteVerdict;
  /** Household scope (2026-08-27): may this visitor pick another household?
   *  True for a leader session or a `roster.manage` holder; the picker and
   *  "Change household" render only then. The Server Actions enforce it. */
  canSwitchHousehold: boolean;
  /** Who is signed in, for the status bar — a verified person's display name
   *  or a leader's label. Null for the troop-password-only visitor. */
  signedInAs: string | null;
}

/**
 * `cache()`d: the signup page calls this from generateMetadata AND the page
 * body, the event page from the body and its sidebar — each was a separate
 * ~30-round-trip walk to the same answer (Plans/Performance-Review-2026-08-27.md
 * #1). One walk per request now; the key is (entryId, householdKeyParam).
 */
export const loadSignupContext = cache(async function loadSignupContext(
  entryId: number,
  householdKeyParam: string | undefined
): Promise<SignupContext | null> {
  const [detail, audience] = await Promise.all([loadEventDetail(entryId), gateAudience()]);
  if (!detail) return null;

  const { signup, slots } = detail;
  const gatedIn = audience !== null;
  const slotFirst = isSlotFirst(signup, slots);

  /*
   * Identity prefill (Plans/Family-Identity-Auth.md Phase 2) — see
   * resolveEffectiveHouseholdKey()'s own doc for the undefined-vs-empty
   * distinction that keeps the "Not you? Change" switch affordance working.
   *
   * Both session shapes that identify a PERSON feed this, not just the
   * verified-household one. gateAudience() checks the leader cookie FIRST and
   * returns its role, so a signed-in leader is 'leader' and never 'household'
   * — which meant the prefill was skipped for the most strongly authenticated
   * visitor on the site.
   */
  const verifiedSession = audience === 'household' ? await getIdentitySessionIfValid() : null;
  const verdict = verifiedSignupVerdict(audience, verifiedSession?.subjectKind ?? null);
  // Household scope (Patrick, 2026-08-27): only a superuser — leader session
  // or roster.manage — may name a household other than their own. Everyone
  // else is pinned to the session's household: the URL param is ignored HERE
  // (the page just shows their own family), the write actions REJECT a
  // mismatched key outright, and the roster of OTHER families (names) is
  // never even sent to the page.
  const canSwitchHousehold = gatedIn ? await canSwitchHouseholdFn(audience, verifiedSession) : false;

  // Household roster and any existing entries are gate-only: they carry names.
  // A superuser gets the whole roster (the picker needs it); everyone else
  // gets exactly their own household, read by key — not the whole troop
  // filtered down to one (Plans/Performance-Review-2026-08-27.md #3).
  let households: Household[] = [];
  let householdKey: string | undefined;
  if (gatedIn && signup && canSwitchHousehold) {
    households = await loadHouseholds();
    const sessionPersonId =
      verifiedSession?.personId ?? (audience === 'leader' ? await leaderSessionPersonId() : null);
    // Resolved against the already-loaded roster rather than
    // resolveHouseholdKeyForPerson(), which would load every household a
    // second time on a page that has them in hand.
    const sessionHouseholdKey =
      verifiedSession?.householdKey ??
      (sessionPersonId != null ? householdKeyForPerson(households, sessionPersonId) : null);
    householdKey = resolveEffectiveHouseholdKey(householdKeyParam, sessionHouseholdKey);
  } else if (gatedIn && signup && verifiedSession) {
    householdKey = verifiedSession.householdKey;
    const own = await loadHouseholdByKey(householdKey);
    households = own ? [own] : [];
  }

  const household = householdKey ? (households.find((h) => h.key === householdKey) ?? null) : null;

  // "scout:<id>" (unassigned scout) and "leader:<code>" parties have no stored
  // household row, so their entries carry a null household_id and are found by
  // identity instead.
  const existing =
    household && signup
      ? await loadPartySignup(signup.id, storedHouseholdId(household.key), {
          personIds: [
            ...household.scouts.map((s) => s.personId).filter((v): v is number => v != null),
            ...household.adults.map((a) => a.personId)
          ]
        })
      : [];

  // person_id is the whole match — the scout_id / scout_parent_id /
  // leader_code fallbacks went with their columns (D-066).
  const existingClaims = household
    ? existing.flatMap((e) => {
        let key: string | null = null;
        const si = household.scouts.findIndex((s) => s.personId === e.person_id);
        if (si >= 0) key = `s${si}`;
        const ai = household.adults.findIndex((a) => a.personId === e.person_id);
        if (ai >= 0) key = `a${ai}`;
        return key
          ? e.claims.map((slotId) => ({
              slotId,
              personKey: key!,
              comment: e.claimComments[slotId] ?? null
            }))
          : [];
      })
    : [];

  const entryIds = existing.map((e) => e.id);
  const [placementRows, memberships] =
    signup && entryIds.length > 0
      ? await Promise.all([loadPartyPlacements(signup.id, entryIds), loadPartyMemberships(entryIds)])
      : [[], []];
  const placements = summarizePlacements(placementRows);

  const householdGuests =
    household && signup && signup.guest_mode === 'named'
      ? await loadHouseholdGuests(storedHouseholdId(household.key))
      : [];

  return {
    detail,
    audience,
    gatedIn,
    households,
    household,
    householdKey,
    existing,
    existingClaims,
    placements,
    memberships,
    householdGuests,
    gateState: !gatedIn ? 'anon' : household ? 'ready' : 'no-household',
    slotFirst,
    locked: signup ? signupLocked(signup) : false,
    verdict,
    canSwitchHousehold,
    signedInAs: verifiedSession?.displayName ?? (audience === 'leader' ? 'a leader' : null)
  };
});

/**
 * Who in this party is already signed up, for the detail page's status line.
 *
 * The FORM used to answer this as a side effect of being on the page. With
 * signup on its own route, a family scanning the calendar would otherwise have
 * no way to see they had already responded — and the predictable result of
 * that is a second submission.
 *
 * Cancelled entries never reach here: loadPartySignup filters them out, so a
 * withdrawn signup correctly reads as "not signed up".
 */
export function signedUpNames(ctx: SignupContext): string[] {
  const { household, existing } = ctx;
  if (!household) return [];
  const byPerson = new Map<number, string>();
  for (const s of household.scouts) if (s.personId != null) byPerson.set(s.personId, s.displayName);
  for (const a of household.adults) byPerson.set(a.personId, a.name);
  return existing
    .filter((e) => e.status === 'yes' || e.status === 'waitlist')
    // A guest row's person is not in the household — it shows by its
    // resolved guest name (Plans/Guests-As-People.md).
    .map((e) => (e.person_id != null ? byPerson.get(e.person_id) : undefined) ?? e.guest_name ?? undefined)
    .filter((n): n is string => !!n);
}
