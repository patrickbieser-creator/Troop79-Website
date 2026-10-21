/**
 * Meeting Planner P3: focus sets, pure and client-safe (Plans/Meeting-Planner-II.md, Decision 10). The shapes the
 * Focus sets screen and the seed drawer share, and the rules for a set's draft. The database side is
 * lib/meeting-focus-db.ts.
 */

export interface FocusSetItem {
  key: string;
  kind: 'rank' | 'mb';
  sourceId: string;
  /** 'Tenderfoot', 'First Aid'. */
  sourceName: string;
  code: string;
  label: string;
}

export interface FocusSetView {
  id: number;
  name: string;
  createdBy: number | null;
  /** Lower-case, sorted. */
  labels: string[];
  items: FocusSetItem[];
  /** The last time it was seeded on a meeting (an instant), or null. */
  lastUsed: string | null;
  updatedAt: string;
}

export interface FocusSearchRow extends FocusSetItem {
  /** The requirement it sits under: '1 · Safety and first aid'; null at the top level. */
  parent: string | null;
  topLevel: boolean;
}

export interface FocusSource {
  kind: 'rank' | 'mb';
  id: string;
  name: string;
  /** Matching requirements in it. */
  n: number;
}

export const SET_NAME_MAX = 80;
export const LABEL_MAX = 30;

/** A label as stored: trimmed, inner whitespace collapsed, lower-case. */
export function normalizeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A set's draft as the editor holds it. */
export interface SetDraft {
  name: string;
  labels: string[];
  items: FocusSetItem[];
}

/** One string per draft, for the dirty gate (D-331: Save is greyed only when nothing changed). */
export function draftKey(d: SetDraft): string {
  return JSON.stringify([d.name.trim().replace(/\s+/g, ' '), [...d.labels].sort(), d.items.map((i) => i.key)]);
}

/** What stops a draft from saving, or null. */
export function draftProblem(d: SetDraft): { at: 'name' | 'label'; text: string } | null {
  const name = d.name.trim();
  if (!name) return { at: 'name', text: 'Give the set a name.' };
  if (name.length > SET_NAME_MAX) return { at: 'name', text: `Keep the name to ${SET_NAME_MAX} characters.` };
  return null;
}

/** The items grouped by rank or badge, in the order they were added. */
export function groupItems<T extends Pick<FocusSetItem, 'sourceId' | 'sourceName'>>(items: readonly T[]): { sourceId: string; sourceName: string; items: T[] }[] {
  const out: { sourceId: string; sourceName: string; items: T[] }[] = [];
  for (const i of items) {
    const g = out.find((x) => x.sourceId === i.sourceId);
    if (g) g.items.push(i);
    else out.push({ sourceId: i.sourceId, sourceName: i.sourceName, items: [i] });
  }
  return out;
}
