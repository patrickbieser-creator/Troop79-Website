/**
 * One event's leader surfaces as tabs — Builder · Roster · [one tab per
 * assignment set: Patrols · Tents · Cars there · Cars back …] · Money ·
 * Snapshot — the shared TabStrip in link mode (the articles / library /
 * advancement-roster pattern, /admin/styleguide/admin → Tabs).
 *
 * Patrick, 2026-08-22: "all of those links are really important — buttons or
 * tabs consistent with the other admin screens", then "expose the entire
 * navigation at the top at all times … the Ride Assignments button can go
 * away; move Patrols, Tents, Cars There, Cars Back in its place, so Money and
 * Snapshot are the last things." Each set tab opens the assignments board on
 * that set (`?set=<id>`); the board no longer carries its own set tabs. An
 * event with no sets yet keeps a single "Rides & assignments" tab so the board
 * (and its "add sets in the Builder" hint) stays reachable.
 *
 * "All signups" (back to the list) and the public event page are not sibling
 * surfaces — they stay as the muted links in PageTitle's sub line.
 */
import { TabStrip } from '../../_components/tab-strip';

export type EventNavKey = 'builder' | 'roster' | 'assignments' | 'money' | 'snapshot' | `set:${number}`;

export interface EventNavSet {
  id: number;
  label: string;
}

/** Tabs follow the features the event actually uses (Patrick, 2026-08-22,
 *  the Unity Church service project: "Rides and Assignments and Money,
 *  neither of which are relevant"): one tab per assignment set that exists
 *  (no sets → no set tabs, and no "Rides & assignments" placeholder), and
 *  Money only when the event has prices or any money activity — or when the
 *  Money page is the one being viewed, so it never loses its own tab. */
export function eventNavItems(
  signupId: number,
  sets: readonly EventNavSet[] = [],
  opts: { hasMoney?: boolean; active?: EventNavKey; entryId?: number } = {}
): { key: EventNavKey; label: string; href: string }[] {
  const showMoney = (opts.hasMoney ?? true) || opts.active === 'money';
  // Builder is the calendar entry workbench's Signup tab (Patrick, 2026-08-25:
  // "calendar be the central point of activity"); the standalone
  // /admin/events/[id] page is a redirect there. Keyed by the ENTRY, so the
  // signup id alone can't build it — callers pass entryId from loadEventNav.
  const builderHref = opts.entryId ? `/admin/calendar/${opts.entryId}?tab=signup` : `/admin/events/${signupId}`;
  return [
    { key: 'builder', label: 'Builder', href: builderHref },
    { key: 'roster', label: 'Roster', href: `/admin/rosters/${signupId}` },
    ...sets.map((s) => ({ key: `set:${s.id}` as const, label: s.label, href: `/admin/rosters/${signupId}/assignments?set=${s.id}` })),
    ...(showMoney ? [{ key: 'money' as const, label: 'Money', href: `/admin/rosters/${signupId}/money` }] : []),
    { key: 'snapshot', label: 'Snapshot', href: `/admin/rosters/${signupId}/snapshot` }
  ];
}

export function EventNav({
  signupId,
  entryId,
  active,
  sets = [],
  hasMoney = true
}: {
  signupId: number;
  /** The calendar entry the signup belongs to — where the Builder tab opens. */
  entryId: number;
  active: EventNavKey;
  sets?: readonly EventNavSet[];
  /** false hides Money (no prices, no money rows) unless active === 'money'. */
  hasMoney?: boolean;
}) {
  return (
    <TabStrip ariaLabel="Event pages" activeKey={active} items={eventNavItems(signupId, sets, { hasMoney, active, entryId })} />
  );
}
