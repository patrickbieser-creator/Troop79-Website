/**
 * The "back to where you were" link for a calendar entry's own page.
 *
 * /events carries its whole browsing position in the query string — which view
 * (list or month), which month, which category, which search. An event page
 * reached from there is handed those same params, and hands them back on the
 * way out, so leaving an event returns the visitor to the October grid filtered
 * to Campouts rather than to the top of the list.
 *
 * A PURE FUNCTION over params rather than history.back() on purpose: a page
 * opened in a new tab, reached from a shared link, or arrived at from search
 * has no history to go back to, and a back button that sometimes leaves the
 * site is worse than one that always goes to the calendar.
 *
 * Only the four params /events actually reads are carried. Anything else a URL
 * happens to hold — a tracking tag, a stray edit — is dropped rather than
 * reflected back into a link this app generates.
 */

/** Params /events understands. Anything else is not carried back. */
const CARRIED = ['view', 'm', 'category', 'q'] as const;

export interface CalendarReturn {
  href: string;
  /** True when the visitor arrived carrying a position worth returning to. */
  hasPosition: boolean;
  /** "Back to August 2026" reads better than "Back to calendar" when we know. */
  label: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** 'YYYY-MM' → 'August 2026', or null if it isn't a month we recognise. */
function monthLabel(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return null;
  return `${MONTH_NAMES[idx]} ${m[1]}`;
}

/**
 * Build the return link from the search params an event page was given.
 *
 * Accepts the loose `Record<string, string | string[] | undefined>` shape Next
 * hands a page, so callers don't have to normalise first. A repeated param
 * (`?view=a&view=b`) takes its first value — the alternative is dropping it,
 * and one of the two is what the visitor actually had.
 */
export function calendarReturn(
  params: Record<string, string | string[] | undefined> | undefined
): CalendarReturn {
  const out = new URLSearchParams();
  for (const key of CARRIED) {
    const raw = params?.[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim() !== '') out.set(key, value);
  }

  const qs = out.toString();
  const month = monthLabel(out.get('m') ?? undefined);
  return {
    href: qs ? `/events?${qs}` : '/events',
    hasPosition: qs !== '',
    label:
      out.get('view') === 'month' && month ? `Back to ${month}` : 'Back to the calendar'
  };
}
