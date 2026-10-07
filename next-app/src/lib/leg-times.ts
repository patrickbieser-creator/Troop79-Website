/**
 * Leg times on a family signup (Plans/Event-Signup-Arrival-Times.md), checked
 * BEFORE the submit RPC. The RPC casts `out_departs_at` / `back_departs_at`
 * straight from the posted JSON with `::timestamptz`, so without this a bad
 * value was a raw cast error (surfaced as the generic "something went wrong")
 * and a far-off instant stamped a car with a wave nobody meant (qa-lead on
 * v1.191.0). Pure, so the rule is testable without a database.
 */

/** Days either side of the event a leg time may fall in. A family may arrive
 *  the evening before or stay a day after; anything further is a typo. */
export const LEG_TIME_WINDOW_DAYS = 2;

const DAY_MS = 86_400_000;
const LEG_KEYS = ['out_departs_at', 'back_departs_at'] as const;

export interface LegTimeWindow {
  /** The calendar entry's first day ('YYYY-MM-DD'). */
  entryDate: string;
  /** Its last day, or null for a one-day entry. */
  endDate: string | null;
  /** The signup's transportation switch. Off = there are no car sets and the
   *  form never showed the fields, so any posted time is dropped. */
  driversNeeded: boolean;
}

export type LegTimesResult = { ok: true; entries: unknown[] } | { ok: false; error: string };

function dayStartUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Validates (and when transportation is off, strips) the two leg times on
 * every entry. Entries that are not objects pass through untouched — the RPC
 * has its own answer for those. Returns the entries to send.
 */
export function checkLegTimes(entries: readonly unknown[], window: LegTimeWindow): LegTimesResult {
  // The window is the event's days plus the margin, in UTC day terms. A UTC
  // day boundary is off from Central by a few hours; the two-day margin
  // absorbs that rather than importing the timezone math for a sanity check.
  const lo = dayStartUtc(window.entryDate) - LEG_TIME_WINDOW_DAYS * DAY_MS;
  const hi = dayStartUtc(window.endDate ?? window.entryDate) + DAY_MS + LEG_TIME_WINDOW_DAYS * DAY_MS;

  const out: unknown[] = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      out.push(e);
      continue;
    }
    const row = { ...(e as Record<string, unknown>) };
    for (const key of LEG_KEYS) {
      const v = row[key];
      if (!window.driversNeeded) {
        row[key] = null;
        continue;
      }
      if (v == null || v === '') {
        row[key] = null;
        continue;
      }
      const ms = typeof v === 'string' ? Date.parse(v) : NaN;
      if (Number.isNaN(ms)) return { ok: false, error: 'One of the arrival or departure times is not valid. Pick it again.' };
      if (ms < lo || ms > hi)
        return {
          ok: false,
          error: `An arrival or departure time must be within ${LEG_TIME_WINDOW_DAYS} days of the event. Check the day you picked.`
        };
    }
    out.push(row);
  }
  return { ok: true, entries: out };
}
