/**
 * The person drawer's "Tonight" for a scout (Patrick, 2026-10-29): where This week has them, and where a planner can
 * put them instead: another group, Help teach, a class from requests and offers, Unassigned (no group tonight, and it
 * sticks), or "let the planner place", which hands them back to placement (no hand role, no family "help teach"). The
 * same choices as a row's Place… menu. Pure; client-safe.
 */
import type { ThisWeek } from '@/lib/this-week';

/** What twSetRoleAction takes (this-week-actions RoleInput), restated here so a client module can import it. */
export type PlaceRole =
  | { role: 'teach' }
  | { role: 'none' }
  | { role: 'group'; key: string }
  | { role: 'request'; key: string }
  /** Station rotations step 4: into rotation Group N, or back to the draft (null): twRotationMoveAction. */
  | { role: 'rotate'; group: number | null };

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
  /** What undoing it sends: back to placement, or back to the rotation draft. */
  unassignRole: PlaceRole | { role: null };
  /** Station rotations step 4: "also" choices on top of the primary place (any group or class but the current one). */
  also: { key: string; label: string; on: boolean }[];
}

export function placeChoices(view: ThisWeek, personId: number): PlaceChoices | null {
  const rot = view.rotation?.on && !view.rotation.problem ? view.rotation : null;
  const rotGroup = rot?.groups.find((g) => g.members.some((m) => m.personId === personId)) ?? null;
  const member = rotGroup?.members.find((m) => m.personId === personId) ?? null;
  const row = view.sections.flatMap((s) => s.rows).find((r) => r.personId === personId);
  if (!row && !rotGroup) return null;
  const group = row?.groupKey ? view.groups.find((g) => g.key === row.groupKey) : undefined;
  const extra = row?.requestKey ? view.extras.find((x) => x.key === row.requestKey) : undefined;
  // The group's own title: 'Tenderfoot group', 'First Aid merit badge', or a split's 'Scout Group 2'.
  const groupWords = (g: { title: string }) => g.title;
  const stationWords = (g: { name: string }) => `${g.name} · Stations`;
  const now = rotGroup
    ? stationWords(rotGroup)
    : row!.status === 'teach'
      ? group
        ? `Helping teach the ${groupWords(group)}`
        : 'Helping teach'
      : row!.status === 'unassigned'
        ? 'Unassigned'
        : extra
          ? extra.title
          : group
            ? groupWords(group)
            : 'Nothing assigned yet';
  const helping = row?.status === 'teach';
  const options: PlaceChoice[] = [
    ...(rot?.groups ?? []).map((g) => ({ id: `rot:${g.number}`, label: stationWords(g), role: { role: 'rotate' as const, group: g.number }, current: rotGroup?.number === g.number })),
    ...view.groups.filter((g) => g.kind !== 'station').map((g) => ({
      id: g.key,
      label: groupWords(g),
      role: { role: 'group' as const, key: g.key },
      current: !!row && !helping && row.groupKey === g.key
    })),
    ...view.extras.map((x) => ({ id: x.key, label: x.title, role: { role: 'request' as const, key: x.key }, current: !!row && row.requestKey === x.key })),
    { id: 'teach', label: 'Help teach', role: { role: 'teach' }, current: helping && !group },
    { id: 'none', label: 'Unassigned', role: { role: 'none' }, current: row?.status === 'unassigned' }
  ];
  // "Also" (Patrick, 2026-11-08): any group or class but where they already are; flagged on the plan, never refused.
  const primaryKey = row?.requestKey ?? row?.groupKey ?? null;
  const on = new Set(view.doubles?.find((d) => d.personId === personId)?.keys ?? []);
  const also = [...view.groups.filter((g) => g.kind !== 'station').map((g) => ({ key: g.key, label: groupWords(g) })), ...view.extras.map((x) => ({ key: x.key, label: x.title }))]
    .filter((a) => a.key !== primaryKey)
    .map((a) => ({ ...a, on: on.has(a.key) }));
  return rotGroup
    ? { now, options, canUnassign: !!member?.hand, unassignRole: { role: 'rotate', group: null }, also }
    : { now, options, canUnassign: row!.hand, unassignRole: { role: null }, also };
}
