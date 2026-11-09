/**
 * A merit badge's registered counselors, by name (moved from the retired admin MB Progress drill-in, Patrick
 * 2026-11-09). A counselor is a person, or a non-person source such as Summer Camp (a leaders row with
 * is_person = false). The public badge page shows these to signed-in troop members only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CounselorRow {
  person_id: number | null;
  leader_code: string | null;
  people: { display_name: string } | { display_name: string }[] | null;
}

export interface CounselorSource {
  code: string;
  name: string;
  person_id: number | null;
  is_person: boolean;
}

export function counselorNames(rows: readonly CounselorRow[], leaders: readonly CounselorSource[]): string[] {
  const sourceName = new Map(leaders.filter((l) => !l.is_person).map((l) => [l.code, l.name]));
  return rows.flatMap((c) => {
    if (c.person_id == null) {
      const name = sourceName.get(c.leader_code ?? '') ?? c.leader_code;
      return name ? [name] : [];
    }
    const person = Array.isArray(c.people) ? c.people[0] : c.people;
    return person?.display_name ? [person.display_name] : [];
  });
}

export async function loadMbCounselors(sb: SupabaseClient, mbId: string): Promise<string[]> {
  const [counselors, leaders] = await Promise.all([
    sb.from('merit_badge_counselors').select('person_id, leader_code, people(display_name)').eq('mb_id', mbId).order('sort_order'),
    sb.from('leaders').select('code, name, person_id, is_person').eq('is_person', false)
  ]);
  if (counselors.error) throw new Error(counselors.error.message);
  return counselorNames((counselors.data ?? []) as unknown as CounselorRow[], (leaders.data ?? []) as CounselorSource[]);
}
