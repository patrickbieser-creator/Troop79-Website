/**
 * Who the Adult Skills and Scout Instructors cards list, and who their Add offers (Patrick, 2026-10-26: "full CRUD").
 * A row is a person who teaches: listed once they hold a teaching skill, gone once they hold none (Delete clears every
 * skill). Add offers the rest of the pool: adults in the person picker, and scouts who can offer to teach today
 * (First Class+ or a Junior Leader). A scout who holds a skill stays listed after losing eligibility, so it can be
 * cleared.
 */
import type { AssignCandidate, AssignPerson } from './skill-assign-editor';

export interface TeachingAdult {
  personId: number;
  name: string;
  /** Leader role, or 'Parent'. */
  sub: string | null;
  /** In the person picker (person_directory.in_picker): only these are offered by Add. */
  inPicker: boolean;
}

export interface TeachingScout {
  personId: number;
  name: string;
  /** Rank name. */
  sub: string | null;
  /** May offer to teach today (lib/can-offer-to-teach). */
  eligible: boolean;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * The adult pool, one entry per person, first source wins: the person picker's leaders and adults (a leader carries
 * their role), adult leaders the picker misses, then people who teach without being offered — parents with no leader
 * code, and inactive scouts who still hold skills (so Delete can reach them). Active scouts are never adults here;
 * they teach under Scout Instructors.
 */
export function collectTeachingAdults({
  directory,
  adultLeaders,
  otherTeachers,
  formerScouts,
  activeScoutIds
}: {
  directory: { personId: number; name: string; tab: string; inPicker: boolean }[];
  adultLeaders: { personId: number; name: string; role: string | null }[];
  otherTeachers: { personId: number; name: string }[];
  formerScouts: { personId: number; name: string }[];
  activeScoutIds: Set<number>;
}): TeachingAdult[] {
  const role = new Map(adultLeaders.map((l) => [l.personId, l.role]));
  const out = new Map<number, TeachingAdult>();
  const put = (a: TeachingAdult) => {
    if (!activeScoutIds.has(a.personId) && !out.has(a.personId)) out.set(a.personId, a);
  };
  for (const d of directory) put({ personId: d.personId, name: d.name, sub: role.get(d.personId) ?? (d.tab === 'leader' ? 'Leader' : 'Parent'), inPicker: d.inPicker });
  for (const l of adultLeaders) put({ personId: l.personId, name: l.name, sub: l.role, inPicker: true });
  for (const p of otherTeachers) put({ personId: p.personId, name: p.name, sub: 'Parent', inPicker: false });
  for (const s of formerScouts) put({ personId: s.personId, name: s.name, sub: 'Former scout', inPicker: false });
  return [...out.values()];
}

export function buildTeachingRows({
  adults,
  scouts,
  skillIdsByPerson
}: {
  adults: TeachingAdult[];
  scouts: TeachingScout[];
  skillIdsByPerson: Map<number, string[]>;
}): { adultRows: AssignPerson[]; adultCandidates: AssignCandidate[]; scoutRows: AssignPerson[]; scoutCandidates: AssignCandidate[] } {
  const split = <P extends { personId: number; name: string; sub: string | null }>(pool: P[], offer: (p: P) => boolean) => {
    const rows: AssignPerson[] = [];
    const candidates: AssignCandidate[] = [];
    for (const p of pool) {
      const skillIds = skillIdsByPerson.get(p.personId) ?? [];
      const base = { key: String(p.personId), name: p.name, sub: p.sub };
      if (skillIds.length > 0) rows.push({ ...base, skillIds });
      else if (offer(p)) candidates.push(base);
    }
    return { rows: rows.sort(byName), candidates: candidates.sort(byName) };
  };
  const a = split(adults, (p) => p.inPicker);
  const s = split(scouts, (p) => p.eligible);
  return { adultRows: a.rows, adultCandidates: a.candidates, scoutRows: s.rows, scoutCandidates: s.candidates };
}
