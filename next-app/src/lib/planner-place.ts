/**
 * The person drawer's "Tonight" for a scout (Patrick, 2026-10-29): where This week has them, and where a planner can
 * put them instead: another group, Help teach, a class from requests and offers, Unassigned (no group tonight, and it
 * sticks), or "let the planner place", which hands them back to placement (no hand role, no family "help teach"). The
 * same choices as a row's Place… menu. Pure; client-safe.
 */
import type { ThisWeek } from '@/lib/this-week';

/** What twSetRoleAction takes (this-week-actions RoleInput), restated here so a client module can import it. */
export type PlaceRole = { role: 'teach' } | { role: 'none' } | { role: 'group'; key: string } | { role: 'request'; key: string };

export interface PlaceChoice {
  id: string;
  label: string;
  role: PlaceRole;
  current: boolean;
}

export interface PlaceChoices {
  /** 'Helping teach the Second Class group', 'Tenderfoot group', 'First Aid merit badge', 'Nothing assigned yet'. */
  now: string;
  options: PlaceChoice[];
  /** Someone put the scout there by hand (a planner, or the family's "help teach"): Unassign undoes it. */
  canUnassign: boolean;
}

export function placeChoices(view: ThisWeek, personId: number): PlaceChoices | null {
  const row = view.sections.flatMap((s) => s.rows).find((r) => r.personId === personId);
  if (!row) return null;
  const group = row.groupKey ? view.groups.find((g) => g.key === row.groupKey) : undefined;
  const extra = row.requestKey ? view.extras.find((x) => x.key === row.requestKey) : undefined;
  const groupWords = (g: { name: string; kind: string }) => (g.kind === 'badge' ? `${g.name} merit badge` : `${g.name} group`);
  const now =
    row.status === 'teach'
      ? group
        ? `Helping teach the ${groupWords(group)}`
        : 'Helping teach'
      : row.status === 'unassigned'
        ? 'Unassigned'
        : extra
          ? extra.title
          : group
            ? groupWords(group)
            : 'Nothing assigned yet';
  const helping = row.status === 'teach';
  const options: PlaceChoice[] = [
    ...view.groups.map((g) => ({
      id: g.key,
      label: groupWords(g),
      role: { role: 'group' as const, key: g.key },
      current: !helping && row.groupKey === g.key
    })),
    ...view.extras.map((x) => ({ id: x.key, label: x.title, role: { role: 'request' as const, key: x.key }, current: row.requestKey === x.key })),
    { id: 'teach', label: 'Help teach', role: { role: 'teach' }, current: helping && !group },
    { id: 'none', label: 'Unassigned', role: { role: 'none' }, current: row.status === 'unassigned' }
  ];
  return { now, options, canUnassign: row.hand };
}
