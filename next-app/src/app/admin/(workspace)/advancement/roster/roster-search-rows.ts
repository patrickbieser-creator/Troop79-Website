/**
 * The one row shape behind the roster's global search (Patrick, 2026-08-26;
 * Jenna's spec 2026-08-27). Every tab — scouts, leaders, adults, guests —
 * normalizes to this so the search component never sees three id types:
 * scout tabs open by scout code (A02), people tabs and guests by people.id,
 * and that difference is absorbed here, in `href`.
 *
 * Pure: page.tsx builds it from data it already fetched for the tab counts.
 */
import type { DirectoryPerson } from './people-table';
import type { GuestTabRow } from '@/lib/guest-people';

export type RosterKind = DirectoryPerson['tab'] | 'guest';

export const ROSTER_KIND_LABEL: Record<RosterKind, string> = {
  active_scout: 'Active Scout',
  inactive_scout: 'Inactive Scout',
  leader: 'Leader',
  adult: 'Adult',
  guest: 'Guest'
};

export interface RosterSearchRow {
  key: string;
  kind: RosterKind;
  name: string;
  email: string | null;
  phone: string | null;
  /** Household label, or "Guest of <host>" — the one detail column. */
  detail: string | null;
  href: string;
}

const ROSTER = '/admin/advancement/roster';

export function buildRosterSearchRows(input: {
  directory: DirectoryPerson[];
  guests: GuestTabRow[];
  householdByPerson: Record<number, number>;
  householdLabel: Map<number, string>;
}): RosterSearchRow[] {
  const people = input.directory.map((p): RosterSearchRow => {
    const isScout = p.tab === 'active_scout' || p.tab === 'inactive_scout';
    const open = isScout && p.scout_id ? p.scout_id : String(p.person_id);
    const hh = input.householdByPerson[p.person_id];
    return {
      key: `p${p.person_id}`,
      kind: p.tab,
      name: p.display_name,
      email: p.primary_email,
      phone: p.primary_phone,
      detail: hh !== undefined ? (input.householdLabel.get(hh) ?? null) : null,
      href: `${ROSTER}?tab=${p.tab}&open=${encodeURIComponent(open)}`
    };
  });
  const guests = input.guests.map(
    (g): RosterSearchRow => ({
      key: `g${g.personId}`,
      kind: 'guest',
      name: g.name,
      email: null,
      phone: g.phone,
      detail: `Guest of ${g.hostLabel}`,
      href: `${ROSTER}?tab=guest&open=${g.personId}`
    })
  );
  return [...people, ...guests];
}
