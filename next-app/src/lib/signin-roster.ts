/**
 * The "find yourself" roster for /signin
 * (Plans/Unified-Identity-And-Capabilities.md Phase D).
 *
 * WHY A PICKER AT ALL. The email-only flow dead-ends on the most common
 * failure by far: a parent who cannot remember which address the troop has
 * for them. Every other failure — a bounce, a stale address, no email — is
 * rarer than simply not knowing. Asking "who are you" instead of "what is
 * your email" removes recall from the flow entirely.
 *
 * SEARCH, NOT A LIST (Patrick, 2026-08-16). The first cut rendered all ~70
 * people at once. Two problems with that: it does not resolve well on a
 * phone, which is where this gets used, and it hands the whole roster to
 * anyone holding the troop password. Nothing renders now until someone types
 * two characters, and only matches come back.
 *
 * FILTERING HAPPENS ON THE SERVER, AND SO DOES MASKING. Two consequences that
 * are the point rather than an implementation detail:
 *
 *   - The full roster never reaches the browser. Client-side filtering would
 *     have shipped every name to every visitor and merely hidden them with
 *     CSS, which is not the same thing at all.
 *   - Matching runs against the FULL name while only the abbreviated label is
 *     returned. Typing "Bieser" finds "Patrick B." — the surname is a search
 *     key the server holds, never a value the client is given.
 *
 * THE ENUMERATION TRADE, STATED (Open Question 1, resolved 2026-08-16). A
 * search box behind the troop password still confirms membership to whoever
 * guesses a name. That is a deliberate reversal of Family-Identity-Auth.md
 * Phase 1's "no membership oracle" rule, bounded by the password gate, the
 * two-character floor, the result cap, and masked destinations. What it buys
 * is a family who can actually finish signing in.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { maskEmail } from '@/lib/identity-challenge';
import { autoLoginLabels } from '@/lib/authorized-adults';
import { loadHouseholds } from '@/lib/households';

export interface SignInCandidate {
  personId: number;
  /** Abbreviated: "Patrick B.", disambiguated to "Michael Ba." where needed.
   *  Never the full surname — that stays server-side as a search key. */
  displayName: string;
  isScout: boolean;
  /** "d•••@gmail.com", or null when we hold no deliverable address. */
  maskedEmail: string | null;
}

/** Below this, nothing is returned at all — the roster is not browsable. */
export const MIN_QUERY_LENGTH = 2;

/** Enough that a real search finds you; few enough that a two-letter query
 *  cannot be used to page through the troop. */
export const MAX_RESULTS = 12;

export interface SignInSearchResult {
  candidates: SignInCandidate[];
  /** True when matches were cut off — the UI says "keep typing". */
  truncated: boolean;
}

interface InternalCandidate extends SignInCandidate {
  /** Server-only. Never returned to a caller that can reach the client. */
  fullName: string;
}

/**
 * Every eligible person, labelled and masked.
 *
 * Labels are computed across the WHOLE set before any filtering, so
 * "Michael Ba." stays "Michael Ba." even when a query matches only one of the
 * two Michaels. Disambiguating post-filter would make a person's name change
 * depending on what you typed.
 */
async function loadAllCandidates(): Promise<InternalCandidate[]> {
  const supabase = createAdminClient();

  const [{ data: directory }, { data: people }, households] = await Promise.all([
    supabase.from('person_directory').select('person_id, display_name, tab'),
    supabase.from('people').select('id, primary_email').eq('active', true),
    loadHouseholds()
  ]);

  const emailById = new Map<number, string | null>(
    ((people ?? []) as { id: number; primary_email: string | null }[]).map((p) => [
      p.id,
      p.primary_email?.trim() || null
    ])
  );

  // Reachable = "resolveHouseholdKeyForPerson() would return a key" — NOT
  // "has a stored household_members row". loadHouseholds() already gives a
  // synthetic household-of-one to any adult with no stored row (households.ts:
  // "so nobody is unreachable in the picker"), and a leader with no scout in
  // the troop is exactly that case. Checking household_members directly here
  // (the bug, found live 2026-08-17: Alex Schaapveld, a leader with no scout
  // in the troop, had a real email but never surfaced in the picker at all)
  // silently excluded everyone that fallback exists to cover.
  const reachable = new Set<number>();
  for (const h of households) {
    for (const s of h.scouts) if (s.personId !== null) reachable.add(s.personId);
    for (const a of h.adults) reachable.add(a.personId);
  }

  const eligible = ((directory ?? []) as { person_id: number; display_name: string; tab: string }[])
    // A person who resolveHouseholdKeyForPerson() can't place cannot be
    // issued an identity session at all (targetForPerson requires a
    // household key), so offering their name would offer something that can
    // never work — but that's a narrower exclusion than "no stored row".
    .filter((d) => emailById.has(d.person_id) && reachable.has(d.person_id));

  // Same algorithm the admin login pool uses (lib/authorized-adults.ts): the
  // surname prefix extends only as far as uniqueness requires, so two
  // "Michael B."s become "Michael Ba." and "Michael Bl.". Picking the wrong
  // one would send a sign-in code to a different family's inbox.
  const labels = autoLoginLabels(
    eligible.map((d) => ({ code: String(d.person_id), name: d.display_name }))
  );

  return eligible.map((d) => {
    const email = emailById.get(d.person_id);
    return {
      personId: d.person_id,
      displayName: labels.get(String(d.person_id)) ?? d.display_name,
      isScout: d.tab === 'active_scout',
      maskedEmail: email ? maskEmail(email) : null,
      fullName: d.display_name
    };
  });
}

/**
 * Find people whose full name contains `query`.
 *
 * Returns nothing below MIN_QUERY_LENGTH — deliberately, so the roster cannot
 * be browsed by submitting an empty query. Matching is against the full name
 * including the surname; the surname is never in the result.
 */
export async function searchSignInCandidates(query: string): Promise<SignInSearchResult> {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return { candidates: [], truncated: false };

  const all = await loadAllCandidates();
  const matches = all
    .filter((c) => c.fullName.toLowerCase().includes(needle))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Strip fullName on the way out. The type would let it through otherwise,
  // and it is the one field that must not cross the wire.
  const candidates: SignInCandidate[] = matches
    .slice(0, MAX_RESULTS)
    .map(({ personId, displayName, isScout, maskedEmail }) => ({
      personId,
      displayName,
      isScout,
      maskedEmail
    }));

  return { candidates, truncated: matches.length > MAX_RESULTS };
}
