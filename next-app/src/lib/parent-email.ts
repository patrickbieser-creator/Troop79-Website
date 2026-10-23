/**
 * Meeting emails to a PARENT about their own scouts (Patrick, 2026-10-22):
 *   - name them by first name ("Anjali", not "Anjali S"); two scouts in one email who share a first name keep their
 *     last initial, those two only; when that collides too, two letters of the last name ("Sam Sm", "Sam Sh"), and
 *     when even that can't tell them apart, a number ("Sam S 1", "Sam S 2"). Teacher-facing lines, leader screens and the audit trail keep the board name.
 *   - when a scout the email names has NO email address on file (no person_emails row; an address that is merely
 *     unverified or under 13 still counts as on file), end with a P.S. inviting the parent to add one on /profile.
 *     It rides after the button (renderMarkdownEmail `postscript`), never in the editable template. A scout's own
 *     copy never gets it.
 * scoutFirstNames and scoutEmailPs are pure; personIdsWithEmail is the one read.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { boardName, firstNameOf } from '@/lib/meeting-board-shared';

/** Where a parent adds a scout's email: the household editor on /profile. */
export const SCOUT_EMAIL_PATH = '/profile';

/** personId → the name a parent's email uses. `name` may be a full name or a board name ('Anjali S'). */
export function scoutFirstNames(scouts: readonly { personId: number; name: string }[]): Map<number, string> {
  const unique = [...new Map(scouts.map((s) => [s.personId, s.name])).entries()];
  const tally = (names: readonly string[]) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const lastOf = (name: string) => name.trim().split(/\s+/).slice(1).pop() ?? '';
  const twoLetters = (name: string) => {
    const last = lastOf(name);
    return last.length > 1 ? `${firstNameOf(name)} ${last[0].toUpperCase()}${last[1].toLowerCase()}` : boardName(name);
  };
  const firsts = tally(unique.map(([, n]) => firstNameOf(n)));
  const step1 = unique.map(([id, n]) => [id, (firsts.get(firstNameOf(n)) ?? 0) > 1 ? boardName(n) : firstNameOf(n)] as const);
  const boards = tally(step1.map(([, n]) => n));
  const step2 = step1.map(([id, n], i) => [id, (boards.get(n) ?? 0) > 1 ? twoLetters(unique[i][1]) : n] as const);
  const twos = tally(step2.map(([, n]) => n));
  const seen = new Map<string, number>();
  return new Map(
    step2.map(([id, n], i) => {
      if ((twos.get(n) ?? 0) < 2) return [id, n];
      const base = step1[i][1];
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      return [id, `${base} ${k}`];
    })
  );
}

/** "Anjali", "Anjali or Leo", "Anjali, Leo or Sam". */
const orList = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);

/** The P.S. (markdown) naming scouts with no email on file, or null when there are none. No pronouns: the name again. */
export function scoutEmailPs(names: readonly string[], url: string): string | null {
  if (!names.length) return null;
  const who = names.length === 1 ? names[0] : 'they';
  return `P.S. If ${orList(names)} has an email address, you’re welcome to add it on your [member page](${url}) so ${who} can get these emails directly. You’ll keep getting a copy.`;
}

/** Which of these people have an email address on file (any person_emails row). A failed read counts as "has one". */
export async function personIdsWithEmail(sb: SupabaseClient, personIds: readonly number[]): Promise<Set<number>> {
  if (!personIds.length) return new Set();
  const { data, error } = await sb.from('person_emails').select('person_id').in('person_id', [...new Set(personIds)]);
  if (error) return new Set(personIds);
  return new Set(((data ?? []) as { person_id: number }[]).map((r) => r.person_id));
}

/** The P.S. for a parent's email about these scouts (first names as the email uses them), or null. */
export function parentPs(scouts: readonly { personId: number; name: string }[], withEmail: ReadonlySet<number>, site: string): string | null {
  const missing = scouts.filter((s) => !withEmail.has(s.personId));
  return scoutEmailPs([...new Set(missing.map((s) => s.name))], `${site}${SCOUT_EMAIL_PATH}`);
}
