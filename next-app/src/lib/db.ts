/**
 * Make a failed read LOUD.
 *
 * WHY THIS EXISTS. On 2026-08-16 a migration shipped to production behind the
 * code that needed it. Every public calendar surface — the month grid, the
 * list, the homepage, the event pages and the .ics subscription feed — went
 * silently empty and returned HTTP 200. Nothing alerted, because the loaders
 * were written as:
 *
 *     const { data } = await supabase.from('calendar_entries')...
 *     return (data ?? []) as CalendarEntry[];
 *
 * PostgREST reported "column does not exist", `data` came back null, `error`
 * was dropped on the floor, and the page rendered "no upcoming events" — which
 * is indistinguishable from a troop that genuinely has none. That shape was
 * already on the backlog ("loadCalendarCategories's `const { data } = await …`
 * turned a missing table into a silent site-wide grey-out; that shape is
 * everywhere") and it cost a live outage before it got fixed.
 *
 * An empty page is the WORST failure mode available here: a 500 gets noticed
 * in minutes, an empty calendar looks like the truth. So these helpers throw.
 *
 * WHAT NOT TO CONVERT. Plenty of reads in this codebase are silent ON PURPOSE
 * and must stay that way:
 *
 *   - lib/identity-challenge.ts swallows lookup failures because the sign-in
 *     flow is enumeration-safe: any distinguishable outcome tells a guesser
 *     whether an address is on the roster.
 *   - `.maybeSingle()` reads where "no row" is an ordinary answer — a person
 *     with no household, an article that does not exist — should keep
 *     returning null rather than throwing.
 *
 * The rule is narrow: if a caller renders a LIST to the public and would show
 * an empty state on failure, wrap it. Everything else, leave alone.
 */

export interface Postgrestish<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null } | null;
}

/**
 * Unwrap a list read, throwing if the query failed.
 *
 * `context` should name the surface, not the table — it lands in the server
 * log and in a Next.js error overlay, and "calendar: upcoming entries" is a
 * better lead than "select failed".
 */
export function mustList<T>(res: Postgrestish<T[]>, context: string): T[] {
  if (res.error) {
    throw new Error(
      `${context} — database read failed: ${res.error.message}` +
        (res.error.code ? ` [${res.error.code}]` : '')
    );
  }
  return res.data ?? [];
}

/**
 * Unwrap a single-row read that is allowed to find nothing.
 *
 * Distinguishes "the query broke" (throws) from "no such row" (returns null),
 * which `const { data }` collapses into the same value. That collapse is the
 * whole bug.
 */
export function mustMaybe<T>(res: Postgrestish<T>, context: string): T | null {
  if (res.error) {
    throw new Error(
      `${context} — database read failed: ${res.error.message}` +
        (res.error.code ? ` [${res.error.code}]` : '')
    );
  }
  return res.data;
}
