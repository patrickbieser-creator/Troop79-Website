/**
 * Group sets — the campout sheet's Patrol / Crew / Tent / Team columns as
 * per-event sets (Plans/Event-Logistics.md §B). Pure helpers for the
 * builder's Assignments block, the board, and the family picker; the Server
 * Actions only apply what these validate.
 *
 * Cars are a set too (kind='car', a leg) but are never created here — they
 * come from the Drivers block via the drivers_needed trigger.
 */

export const SET_KINDS = ['patrol', 'crew', 'tent', 'cabin', 'car', 'team', 'meal', 'custom'] as const;
export type SetKind = (typeof SET_KINDS)[number];
export const SET_KIND_LABEL: Record<SetKind, string> = {
  patrol: 'Patrol',
  crew: 'Crew',
  tent: 'Tent',
  cabin: 'Cabin',
  car: 'Car',
  team: 'Team',
  meal: 'Meal group',
  custom: 'Other'
};
export function isSetKind(v: unknown): v is SetKind {
  return typeof v === 'string' && (SET_KINDS as readonly string[]).includes(v);
}

export interface SetPreset {
  kind: SetKind;
  label: string;
  seedFromRoster: boolean;
  selfSelect: boolean;
  familyVisible: boolean;
  defaultCapacity: number | null;
}

const PATROLS: SetPreset = { kind: 'patrol', label: 'Patrols', seedFromRoster: true, selfSelect: false, familyVisible: true, defaultCapacity: null };
const TENTS: SetPreset = { kind: 'tent', label: 'Tents', seedFromRoster: false, selfSelect: true, familyVisible: true, defaultCapacity: 2 };
const CREWS: SetPreset = { kind: 'crew', label: 'Crews', seedFromRoster: false, selfSelect: false, familyVisible: true, defaultCapacity: null };
const TEAMS: SetPreset = { kind: 'team', label: 'Teams', seedFromRoster: false, selfSelect: false, familyVisible: true, defaultCapacity: null };

/** Defaults per calendar category — toggles, never a lock. Cars are the
 *  Drivers block's business. */
const PRESETS: Record<string, SetPreset[]> = {
  'Campout / Overnight': [PATROLS, TENTS],
  'High Adventure': [CREWS],
  'Summer Camp': [PATROLS, TENTS],
  'Service Project': [TEAMS]
};
export function presetSetsFor(category: string): SetPreset[] {
  return (PRESETS[category] ?? []).map((p) => ({ ...p }));
}

const MAX_LABEL = 60;
function collapse(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, MAX_LABEL) : null;
}
export const normalizeSetLabel = collapse;
export const normalizeGroupName = collapse;

/** null when fine, else the reason a leader can read. */
export function validateNewSet(input: { kind: string; label: string }, existingLabels: readonly string[]): string | null {
  if (!isSetKind(input.kind)) return 'Pick a kind of group.';
  if (input.kind === 'car') return 'Cars come from the Drivers block — turn on "Drivers" instead.';
  const label = normalizeSetLabel(input.label);
  if (!label) return 'Give the set a label.';
  if (existingLabels.some((l) => l.trim().toLowerCase() === label.toLowerCase())) {
    return `A set called "${label}" already exists on this event.`;
  }
  return null;
}

export interface PlacementPick {
  personKey: string;
  setId: number;
  /** null = "leader will decide" (clears a prior family pick). */
  groupId: number | null;
}

/** The family form's hidden `placements` field: { personKey: { setId: groupId|'' } }.
 *  Only self-select sets are honoured — the set list is the server's, not the
 *  client's. Non-numeric group ids are dropped. */
export function placementPayloadFromForm(raw: string | null | undefined, selfSelectSetIds: ReadonlySet<number>): PlacementPick[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const out: PlacementPick[] = [];
  for (const [personKey, picks] of Object.entries(parsed as Record<string, unknown>)) {
    if (!picks || typeof picks !== 'object') continue;
    for (const [setIdRaw, groupRaw] of Object.entries(picks as Record<string, unknown>)) {
      const setId = Number(setIdRaw);
      if (!Number.isInteger(setId) || !selfSelectSetIds.has(setId)) continue;
      if (groupRaw === '' || groupRaw === null) {
        out.push({ personKey, setId, groupId: null });
        continue;
      }
      const groupId = Number(groupRaw);
      if (!Number.isInteger(groupId) || groupId < 1) continue;
      out.push({ personKey, setId, groupId });
    }
  }
  return out;
}
