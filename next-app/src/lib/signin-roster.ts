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
 * THE ENUMERATION TRADE, STATED (Open Question 1, resolved 2026-08-16). This
 * list tells whoever can see it who is on the roster — a deliberate reversal
 * of Family-Identity-Auth.md Phase 1's "no membership oracle" rule. Three
 * things make it acceptable:
 *
 *   1. It sits behind the troop password. FAMILY_PASSWORD stops being a
 *      credential that grants access and becomes the gate on this list only.
 *   2. Names shown are first name + last initial — already Tier 0 public on
 *      the advancement pages.
 *   3. Destinations are MASKED and masked SERVER-SIDE. The raw address never
 *      reaches the browser, so the list leaks no contact details.
 *
 * What it buys is a family who can actually finish signing in.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { maskEmail } from '@/lib/identity-challenge';

export interface SignInCandidate {
  personId: number;
  /** First name + last initial — never the full name. */
  displayName: string;
  isScout: boolean;
  /** "d•••@gmail.com", or null when we hold no deliverable address. */
  maskedEmail: string | null;
}

/** First name + last initial, matching how names appear on the public
 *  advancement pages. person_directory.display_name is the full name. */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} ${last[0]}.`;
}

/**
 * Everyone who could sign in: active people who belong to a household.
 *
 * A person with no deliverable address is still LISTED, with
 * `maskedEmail: null`. Hiding them would recreate the dead end this whole
 * change exists to remove — they need to see their own name and be told to
 * ask a leader, not silently fail to find themselves and conclude the site is
 * broken.
 */
export async function loadSignInCandidates(): Promise<SignInCandidate[]> {
  const supabase = createAdminClient();

  const [{ data: directory }, { data: people }, { data: members }] = await Promise.all([
    supabase.from('person_directory').select('person_id, display_name, tab'),
    supabase.from('people').select('id, primary_email').eq('active', true),
    supabase.from('household_members').select('person_id')
  ]);

  const emailById = new Map<number, string | null>(
    ((people ?? []) as { id: number; primary_email: string | null }[]).map((p) => [
      p.id,
      p.primary_email?.trim() || null
    ])
  );
  const inHousehold = new Set(
    ((members ?? []) as { person_id: number }[]).map((m) => m.person_id)
  );

  const rows = ((directory ?? []) as { person_id: number; display_name: string; tab: string }[])
    // A person with no household cannot be issued an identity session at all
    // (targetForPerson requires a household key), so listing them would offer
    // a name that can never work.
    .filter((d) => emailById.has(d.person_id) && inHousehold.has(d.person_id))
    .map((d) => ({
      personId: d.person_id,
      displayName: shortName(d.display_name),
      isScout: d.tab === 'active_scout',
      // Masked here, on the server. See the module header.
      maskedEmail: emailById.get(d.person_id) ? maskEmail(emailById.get(d.person_id)!) : null
    }));

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return rows;
}
