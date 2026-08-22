/**
 * Bulk patrol assignment (Patrick, 2026-08-22: "build a bulk patrol assignment
 * screen").
 *
 * WHY IT EXISTS. 23 of 28 active scouts carry no patrol, because the only way
 * to set one was the per-scout Roster editor — 28 individual saves, which is
 * the kind of chore that never gets done. The Patrols page on the family
 * roster is correct and useless until this is filled in.
 *
 * `scouts.patrol` IS FREE TEXT with no lookup table behind it. That is a
 * deliberate choice elsewhere in this codebase (a category with a template is
 * a row; a patrol name is a word), but it means the discipline a table would
 * have given for free has to live somewhere: one spelling per patrol, no stray
 * whitespace, blank and null meaning the same thing, and a way to notice when
 * two spellings of one patrol have drifted apart. That is this module.
 *
 * Everything here is pure so the screen's behaviour is asserted without a
 * browser; the Server Action does nothing but apply the diff these functions
 * produce.
 */

export interface PatrolScout {
  id: string;
  display_name: string;
  patrol: string | null;
  current_rank: string | null;
  graduation_year: number | null;
  active: boolean;
}

/** A pending edit set: scout id → the patrol they should end up in. */
export type PatrolDraft = Record<string, string | null>;

export interface PatrolChange {
  id: string;
  from: string | null;
  to: string | null;
}

export interface PatrolCount {
  /** null is the Unassigned bucket. */
  name: string | null;
  count: number;
}

const MAX_PATROL_NAME = 60;

/**
 * The one spelling rule. Trims, collapses runs of whitespace, caps length, and
 * maps blank to null — the DB already holds at least one `'   '`, and blank
 * has to mean unassigned everywhere or the counts disagree with the roster.
 */
export function normalizePatrolName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.slice(0, MAX_PATROL_NAME);
}

/** Case- and space-insensitive identity, for dedupe and comparison. */
function fold(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Every patrol name in use, one per spelling, alphabetical.
 *
 * INACTIVE SCOUTS COUNT here even though they cannot be assigned: a patrol
 * whose only member left is exactly the patrol you are about to move someone
 * back into, and dropping it from the list would make that impossible without
 * retyping the name from memory.
 */
export function distinctPatrols(scouts: PatrolScout[]): string[] {
  const seen = new Map<string, string>();
  for (const s of scouts) {
    const name = normalizePatrolName(s.patrol);
    if (!name) continue;
    if (!seen.has(fold(name))) seen.set(fold(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Pairs of names that are the same patrol typed two ways. Surfaced on the
 * screen rather than auto-merged — "Hawks" and "hawks" are almost certainly
 * one patrol, but that is the leader's call, not ours.
 */
export function duplicateSpellings(names: string[]): [string, string][] {
  const byFold = new Map<string, string[]>();
  for (const n of names) {
    const k = fold(n);
    byFold.set(k, [...(byFold.get(k) ?? []), n]);
  }
  const out: [string, string][] = [];
  for (const group of byFold.values()) {
    for (let i = 1; i < group.length; i++) out.push([group[0], group[i]]);
  }
  return out;
}

/**
 * Values that are in the patrol column but are not patrols.
 *
 * "Junior Leader" is the live case: `scouts.junior_leader_override` is its own
 * column (Participant Classification, D-176), so a scout carrying it as a
 * patrol has two systems crammed into one field. Flagged, never auto-fixed.
 */
export const NON_PATROL_VALUES: readonly string[] = ['junior leader', 'jr leader', 'jl'];

export function suspectPatrolValues(names: string[]): string[] {
  return names.filter((n) => NON_PATROL_VALUES.includes(fold(n)));
}

/** Who the screen may edit: active scouts, by name. */
export function assignableScouts(scouts: PatrolScout[]): PatrolScout[] {
  return scouts
    .filter((s) => s.active)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Set every selected scout to `patrol` (null clears). Returns a new draft. */
export function applyBulk(draft: PatrolDraft, ids: string[], patrol: string | null): PatrolDraft {
  if (ids.length === 0) return { ...draft };
  const value = normalizePatrolName(patrol);
  const next: PatrolDraft = { ...draft };
  for (const id of ids) next[id] = value;
  return next;
}

/**
 * What actually needs writing.
 *
 * Three guards, all of which matter because the draft comes from a browser:
 * an id not on the roster is ignored, an inactive scout is ignored, and a
 * value equal to what is already stored produces no row. The last one is why
 * choosing "Unassigned" for the scout whose column holds `'   '` is correctly
 * a no-op rather than a pointless write.
 */
export function diffAssignments(scouts: PatrolScout[], draft: PatrolDraft): PatrolChange[] {
  const byId = new Map(scouts.map((s) => [s.id, s]));
  const out: PatrolChange[] = [];
  for (const [id, rawTo] of Object.entries(draft)) {
    const scout = byId.get(id);
    if (!scout || !scout.active) continue;
    const from = normalizePatrolName(scout.patrol);
    const to = normalizePatrolName(rawTo);
    if (from === to) continue;
    out.push({ id, from, to });
  }
  return out;
}

/** Where the draft would leave everyone — the live counts on the screen. */
export function patrolCounts(scouts: PatrolScout[], draft: PatrolDraft): PatrolCount[] {
  const active = scouts.filter((s) => s.active);
  const counts = new Map<string, number>();
  // Seed with every known patrol so one that empties out stays on screen —
  // otherwise the patrol you just cleared by mistake vanishes and you cannot
  // put anyone back into it.
  for (const name of distinctPatrols(scouts)) counts.set(name, 0);

  let unassigned = 0;
  for (const s of active) {
    const value = Object.prototype.hasOwnProperty.call(draft, s.id)
      ? normalizePatrolName(draft[s.id])
      : normalizePatrolName(s.patrol);
    if (!value) {
      unassigned++;
      continue;
    }
    // A name typed fresh in the draft joins the list.
    const existing = [...counts.keys()].find((k) => fold(k) === fold(value));
    const key = existing ?? value;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const named = [...counts.entries()]
    .map(([name, count]) => ({ name: name as string | null, count }))
    .sort((a, b) => (a.name as string).localeCompare(b.name as string));
  return [...named, { name: null, count: unassigned }];
}
