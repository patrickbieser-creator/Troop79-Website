/**
 * A meeting plan is only publishable under the date it was generated FOR.
 *
 * Its sessions come from that meeting's attendance and advancement state, so
 * the payload's date and the date the leader has selected are not
 * interchangeable labels — if they disagree, the plan in hand is stale.
 *
 * This exists as a named rule rather than an inline `!==` because the bug it
 * guards was exactly the two dates silently diverging: the date field could be
 * changed without discarding the previously generated plan, and Publish then
 * wrote that plan under ITS date while the screen showed the new one. Reported
 * as "the date reverts to the next meeting on its own" (2026-08-08). The
 * builder clears the stale plan and the publish action refuses the mismatch;
 * both call this, so neither can quietly stop agreeing with the other.
 */
export function stalePlanError(payloadDate: string, selectedDate: string): string | null {
  // No selected date sent (an older client, or a caller that doesn't track
  // one) — nothing to contradict, so the payload stands on its own.
  if (!selectedDate) return null;
  if (selectedDate === payloadDate) return null;
  return `This plan was generated for ${payloadDate}, not ${selectedDate} — generate a plan for ${selectedDate} first.`;
}
