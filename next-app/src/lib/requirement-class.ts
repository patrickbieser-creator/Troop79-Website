/**
 * Requirement classes (Plans/Requirement-Classification.md, Patrick 2026-10-28). PURE and client-safe.
 *
 * A class is a TAG saying where a requirement can be done (M Troop meeting, C Campout, O Outdoor event, A Aquatics,
 * S Service project, H Home / independent, E Expert / external visit, L Leadership / administrative). A requirement
 * carries any number of tags or none, with no precedence: it fits a gathering when ONE of its tags is something that
 * gathering holds. Untagged inherits the parent's tags; untagged all the way up reads as M.
 *
 * The tags only shape what Suggestions offers. Adding a requirement by hand (+ Requirement, focus sets) is never
 * filtered by them.
 */

/** A class code: one uppercase letter (requirement_classes.code). */
export type ClassCode = string;

export const MEETING_CLASS: ClassCode = 'M';
/** Never offered at a gathering and never listed under Needs another setting (was lib/rank-calculus NOT_PLANNABLE). */
export const LEADERSHIP_CLASS: ClassCode = 'L';
export const UNTAGGED: readonly ClassCode[] = [];

/** What each kind of gathering holds. A new kind (a day hike, a camporee) is one line here. */
export const GATHERING_HOLDS = {
  meeting: new Set<ClassCode>([MEETING_CLASS]),
  campout: new Set<ClassCode>([MEETING_CLASS, 'C', 'O'])
} as const satisfies Record<string, ReadonlySet<ClassCode>>;
export type Gathering = keyof typeof GATHERING_HOLDS;

/** A requirement's own tags, else its parent's effective tags, else M. */
export function effectiveClasses(own: readonly ClassCode[] | null | undefined, parentEffective?: readonly ClassCode[]): ClassCode[] {
  if (own && own.length) return [...own];
  if (parentEffective && parentEffective.length) return [...parentEffective];
  return [MEETING_CLASS];
}

/** One shared tag is enough. */
export function fitsGathering(tags: readonly ClassCode[], gathering: Gathering): boolean {
  const holds: ReadonlySet<ClassCode> = GATHERING_HOLDS[gathering];
  return tags.some((t) => holds.has(t));
}

/** The "Needs another setting" headings an item goes under: each tag the gathering lacks, except L. */
export function settingGroups(tags: readonly ClassCode[], gathering: Gathering): ClassCode[] {
  const holds: ReadonlySet<ClassCode> = GATHERING_HOLDS[gathering];
  return tags.filter((t) => !holds.has(t) && t !== LEADERSHIP_CLASS);
}

/** Request input → tags: single letters, uppercased, first occurrence kept. Null for anything else. */
export function normalizeClassCodes(raw: unknown): ClassCode[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ClassCode[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !/^[A-Za-z]$/.test(v)) return null;
    const c = v.toUpperCase();
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** A row of the requirement_classes lookup. */
export interface RequirementClass {
  code: ClassCode;
  name: string;
  description: string;
  sortOrder: number;
  retired: boolean;
}
