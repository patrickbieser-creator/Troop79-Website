/**
 * The roster's Created and Left columns (Patrick, 2026-11-01), derived from what the database already holds —
 * no new fact is recorded for them.
 *
 * Created: the earlier of the day the person's record was made (people.created_at, as a Central calendar day)
 * and, for anyone who has been a scout, their first ledger entry. Everyone imported has a record day of
 * 2026-07-20 (the people-spine build), so the ledger, which reaches back to 2020, is what dates a scout's real
 * start. Adults have no ledger, so theirs is the record day.
 *
 * Left: a scout's last ledger entry, meeting attendance included: when they stopped turning up, which is a
 * truer "dropped out" date than the day a leader marked them inactive.
 *
 * Inputs come from `people`, `scouts` and the `scout_tenure` view.
 */
import { instantToCentral } from './dates';

export interface ScoutTenure {
  scout_id: string;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

export interface RosterDates {
  /** people.id → 'YYYY-MM-DD'. */
  created: Record<number, string>;
  /** scouts.id → 'YYYY-MM-DD'. */
  left: Record<string, string>;
}

export function rosterDates({
  people,
  scouts,
  tenure
}: {
  people: readonly { id: number; created_at: string | null }[];
  scouts: readonly { id: string; person_id: number | null }[];
  tenure: readonly ScoutTenure[];
}): RosterDates {
  const byScout = new Map(tenure.map((t) => [t.scout_id, t]));
  const scoutOfPerson = new Map<number, string>();
  for (const s of scouts) if (s.person_id != null) scoutOfPerson.set(s.person_id, s.id);

  const created: Record<number, string> = {};
  for (const p of people) {
    const scoutId = scoutOfPerson.get(p.id);
    const first = scoutId ? byScout.get(scoutId)?.first_activity_date : null;
    const made = instantToCentral(p.created_at).date || null;
    const day = [made, first].filter((d): d is string => !!d).sort()[0];
    if (day) created[p.id] = day;
  }

  const left: Record<string, string> = {};
  for (const s of scouts) {
    const last = byScout.get(s.id)?.last_activity_date;
    if (last) left[s.id] = last;
  }
  return { created, left };
}
