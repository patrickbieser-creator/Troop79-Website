/**
 * How a meeting email to a PARENT names their own scouts (Patrick, 2026-10-22): by first name ("Anjali", not
 * "Anjali S"). Two scouts in one email who share a first name keep their last initial, those two only. Teacher-facing
 * lines, leader screens and the audit trail keep the board name. Pure and client-safe.
 */
import { boardName, firstNameOf } from '@/lib/meeting-board-shared';

/** personId → the name a parent's email uses. `name` may be a full name or a board name ('Anjali S'). */
export function scoutFirstNames(scouts: readonly { personId: number; name: string }[]): Map<number, string> {
  const unique = [...new Map(scouts.map((s) => [s.personId, s.name])).entries()];
  const count = new Map<string, number>();
  for (const [, name] of unique) count.set(firstNameOf(name), (count.get(firstNameOf(name)) ?? 0) + 1);
  return new Map(unique.map(([id, name]) => [id, (count.get(firstNameOf(name)) ?? 0) > 1 ? boardName(name) : firstNameOf(name)]));
}
