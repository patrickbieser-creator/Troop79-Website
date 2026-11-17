/**
 * Who has no BSA member ID (Plans/Completed/Admin-Portal-Nav.md decision 11): ACTIVE scouts and ACTIVE adult leaders only.
 * Parents and other adults on the roster are not counted. Home's At a glance tile and the Missing BSA IDs report both
 * read this, so the number and the list never disagree.
 *
 * An adult leader is an active, non-scout person with a `leaders` row that carries a role. A leaders row with no role
 * is a sign-off-initials record (D-sign-off-initials), not a leader position.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/paginate';

export interface MissingBsaPerson {
  personId: number;
  name: string;
  /** The scout's rank, or the leader's role(s). */
  detail: string | null;
}

export interface MissingBsaIds {
  scouts: MissingBsaPerson[];
  leaders: MissingBsaPerson[];
  /** Every active scout the rule looked at (test people left out), so Home's Active scouts tile agrees with it. */
  activeScouts: number;
}

export interface PersonIn {
  id: number;
  display_name: string;
  active: boolean;
  bsa_member_id: string | null;
  is_test: boolean;
  merged_into_person_id: number | null;
}
export interface ScoutIn {
  person_id: number | null;
  active: boolean;
  is_webelos: boolean | null;
  current_rank: string | null;
}
export interface LeaderIn {
  person_id: number | null;
  role: string | null;
}

const blank = (v: string | null | undefined) => v == null || v.trim() === '';
const byName = (a: MissingBsaPerson, b: MissingBsaPerson) => a.name.localeCompare(b.name);

/** Pure: the rule, over rows already read. */
export function missingBsaIds(people: readonly PersonIn[], scouts: readonly ScoutIn[], leaders: readonly LeaderIn[], rankName: (id: string) => string = (id) => id): MissingBsaIds {
  const person = new Map(people.filter((p) => !p.is_test && p.merged_into_person_id == null).map((p) => [p.id, p]));
  // Only a CURRENT scout is left out of the leaders list: a scout who aged out and now holds a position is a leader.
  const activeScoutPeople = new Set(scouts.flatMap((s) => (s.active && !s.is_webelos && s.person_id != null ? [s.person_id] : [])));

  const outScouts: MissingBsaPerson[] = [];
  let activeScouts = 0;
  for (const s of scouts) {
    if (!s.active || s.is_webelos || s.person_id == null) continue;
    const p = person.get(s.person_id);
    if (!p) continue;
    activeScouts += 1;
    if (!blank(p.bsa_member_id)) continue;
    outScouts.push({ personId: p.id, name: p.display_name, detail: s.current_rank ? rankName(s.current_rank) : null });
  }

  const roles = new Map<number, string[]>();
  for (const l of leaders) {
    if (l.person_id == null || blank(l.role) || activeScoutPeople.has(l.person_id)) continue;
    roles.set(l.person_id, [...(roles.get(l.person_id) ?? []), l.role!.trim()]);
  }
  const outLeaders: MissingBsaPerson[] = [];
  for (const [personId, r] of roles) {
    const p = person.get(personId);
    if (!p || !p.active || !blank(p.bsa_member_id)) continue;
    outLeaders.push({ personId, name: p.display_name, detail: [...new Set(r)].join(', ') });
  }
  return { scouts: outScouts.sort(byName), leaders: outLeaders.sort(byName), activeScouts };
}

export async function loadMissingBsaIds(sb: SupabaseClient): Promise<MissingBsaIds> {
  const [people, scouts, leaders, ranks] = await Promise.all([
    fetchAllRows<PersonIn>((from, to) =>
      sb.from('people').select('id, display_name, active, bsa_member_id, is_test, merged_into_person_id').order('id').range(from, to)
    ),
    fetchAllRows<ScoutIn>((from, to) => sb.from('scouts').select('person_id, active, is_webelos, current_rank').order('id').range(from, to)),
    fetchAllRows<LeaderIn>((from, to) => sb.from('leaders').select('person_id, role').order('code').range(from, to)),
    sb.from('ranks').select('id, display_name')
  ]);
  const rankNames = new Map(((ranks.data ?? []) as { id: string; display_name: string }[]).map((r) => [r.id, r.display_name]));
  return missingBsaIds(people, scouts, leaders, (id) => rankNames.get(id) ?? id);
}
