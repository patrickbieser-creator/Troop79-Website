import type { Household } from '@/lib/households';

/**
 * The two signup forms key a household's people differently:
 *   slot-first  — by position: `s0`, `s1`, `a0`, `a1` (what signup-context
 *                 emits for existing claims, and what submit expects back)
 *   person-first — by identity: `s:<scoutId>`, `a:<adult.key>`
 *
 * signup-context speaks the positional dialect, so the person-first form
 * must translate on the way in — it never did, and an existing claim's chip
 * fell back to printing the raw key ("a2" under "Bring a salad"; Patrick,
 * 2026-08-26). Pure so it is unit-tested.
 */
export function positionalToIdentityKey(household: Household, key: string): string | null {
  const m = /^([sa])(\d+)$/.exec(key);
  if (!m) return key.includes(':') ? key : null;
  const i = Number(m[2]);
  if (m[1] === 's') {
    const s = household.scouts[i];
    return s ? `s:${s.id}` : null;
  }
  const a = household.adults[i];
  return a ? `a:${a.key}` : null;
}
